import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, join, resolve } from "node:path";
import type { TrainingCheckpointSummary, TrainingModelListRequest, TrainingModelListResult, TrainingModelSummary, VoiceTrainingModel, VoiceTrainingSettings } from "@shared/ipc";
import { createBackendLayout } from "./project-layout";

type ModelDraft = {
  name: string;
  path: string;
  modifiedAt?: number;
};

export async function listTrainingModels(request: TrainingModelListRequest): Promise<TrainingModelListResult> {
  const layout = createBackendLayout({ markerScript: "voice_train_main.py", venvFolder: ".venv" });
  const selectedModel: VoiceTrainingModel = request.settings.selectedModel === "omnivoice" ? "omnivoice" : "gpt-sovits";
  const toolRoot = resolveTrainingToolRoot(layout.projectRoot, request.settings);

  try {
    const models = selectedModel === "omnivoice"
      ? await listOmniVoiceModels(toolRoot)
      : await listGptSovitsModels(toolRoot, request.settings.gptVersion);
    return { selectedModel, models };
  } catch (error) {
    return {
      selectedModel,
      models: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function listGptSovitsModels(toolRoot: string, version: string): Promise<TrainingModelSummary[]> {
  const gptRepo = join(toolRoot, "vendor", "repos", "GPT-SoVITS");
  const workDir = join(toolRoot, "work", "gpt_sovits");
  const models = new Map<string, ModelDraft>();

  for (const directory of await safeDirectories(join(gptRepo, "logs"))) {
    addModel(models, basename(directory), directory, await mtime(directory));
  }
  for (const directory of await safeDirectories(workDir)) {
    addModel(models, basename(directory), directory, await mtime(directory));
  }

  const summaries = await Promise.all(
    [...models.values()].map(async (model) => ({
      name: model.name,
      path: model.path,
      modifiedAt: model.modifiedAt,
      tensorBoardLogDir: gptSovitsTensorBoardLogDir(toolRoot, model.name),
      checkpoints: await listGptSovitsCheckpoints(gptRepo, model.name, version),
    })),
  );
  return sortModels(summaries);
}

async function listGptSovitsCheckpoints(gptRepo: string, modelName: string, version: string): Promise<TrainingCheckpointSummary[]> {
  const versionSuffix = version === "v1" ? "" : `_${version}`;
  const expDir = join(gptRepo, "logs", modelName);
  const checkpoints = [
    ...await fileCheckpoints(join(expDir, `logs_s2_${version}`), ["pth"], "sovits", { role: "resume" }),
    ...await fileCheckpoints(join(expDir, `logs_s1_${version}`, "ckpt"), ["ckpt"], "gpt", { role: "resume", component: "semantic" }),
    ...await fileCheckpoints(join(gptRepo, `SoVITS_weights${versionSuffix}`), ["pth"], "sovits", { role: "inference", component: "generator", modelNameFilter: modelName }),
    ...await fileCheckpoints(join(gptRepo, `GPT_weights${versionSuffix}`), ["ckpt"], "gpt", { role: "inference", component: "semantic", modelNameFilter: modelName }),
  ];
  return sortCheckpoints(checkpoints);
}

async function listOmniVoiceModels(toolRoot: string): Promise<TrainingModelSummary[]> {
  const root = join(toolRoot, "work", "omnivoice");
  const summaries = await Promise.all(
    (await safeDirectories(root)).map(async (directory) => ({
      name: basename(directory),
      path: directory,
      modifiedAt: await mtime(directory),
      tensorBoardLogDir: omniVoiceTensorBoardLogDir(directory),
      checkpoints: await listOmniVoiceCheckpoints(directory),
    })),
  );
  return sortModels(summaries);
}

async function listOmniVoiceCheckpoints(modelDir: string): Promise<TrainingCheckpointSummary[]> {
  const expDir = join(modelDir, "exp");
  const checkpoints: TrainingCheckpointSummary[] = [];
  for (const directory of await safeDirectories(expDir)) {
    if (!basename(directory).toLowerCase().startsWith("checkpoint-")) {
      continue;
    }
    const files = await safeFiles(directory);
    const hasWeights = files.some((file) => /^model.*\.safetensors$/iu.test(basename(file)) || basename(file).toLowerCase() === "pytorch_model.bin");
    if (!hasWeights) {
      continue;
    }
    const stats = await safeStat(directory);
    const step = omniVoiceCheckpointStep(directory);
    checkpoints.push({
      id: directory,
      label: `OmniVoice 이어하기/추론용 step ${step || basename(directory).replace(/^checkpoint-/iu, "")}`,
      path: directory,
      kind: "omnivoice",
      role: "resume-inference",
      component: "model",
      step,
      modifiedAt: stats?.mtimeMs,
    });
  }
  return sortCheckpoints(checkpoints);
}

async function fileCheckpoints(
  directory: string,
  extensions: string[],
  kind: "gpt" | "sovits",
  options: {
    role: TrainingCheckpointSummary["role"];
    component?: TrainingCheckpointSummary["component"];
    modelNameFilter?: string;
  },
): Promise<TrainingCheckpointSummary[]> {
  const modelNeedle = options.modelNameFilter?.toLowerCase();
  const files = await safeFiles(directory);
  const summaries: TrainingCheckpointSummary[] = [];
  for (const file of files) {
    const extension = extname(file).replace(".", "").toLowerCase();
    if (!extensions.includes(extension)) {
      continue;
    }
    if (modelNeedle && !basename(file).toLowerCase().includes(modelNeedle)) {
      continue;
    }
    const stats = await safeStat(file);
    const epoch = gptSovitsCheckpointEpoch(file);
    const component = options.component ?? checkpointComponent(kind, file);
    summaries.push({
      id: file,
      label: checkpointLabel(kind, file, options.role, component, epoch),
      path: file,
      kind,
      role: options.role,
      component,
      epoch,
      sizeBytes: stats?.size,
      modifiedAt: stats?.mtimeMs,
    });
  }
  return summaries;
}

function checkpointLabel(
  kind: "gpt" | "sovits",
  file: string,
  role: TrainingCheckpointSummary["role"],
  component: TrainingCheckpointSummary["component"],
  epoch?: string,
): string {
  const prefix = checkpointPrefix(kind, role, component);
  if (epoch) {
    return `${prefix} epoch ${epoch}`;
  }
  return `${prefix} ${basename(file)}`;
}

function checkpointPrefix(kind: "gpt" | "sovits", role: TrainingCheckpointSummary["role"], component: TrainingCheckpointSummary["component"]): string {
  const roleText = role === "resume" ? "이어하기용" : "추론용";
  if (kind === "gpt") {
    return `GPT ${roleText}`;
  }
  if (component === "discriminator") {
    return `SoVITS ${roleText} D`;
  }
  if (component === "generator") {
    return `SoVITS ${roleText} G`;
  }
  return `SoVITS ${roleText}`;
}

function checkpointComponent(kind: "gpt" | "sovits", file: string): TrainingCheckpointSummary["component"] {
  if (kind === "gpt") {
    return "semantic";
  }

  const name = basename(file).toLowerCase();
  if (name.startsWith("d_")) {
    return "discriminator";
  }
  return "generator";
}

function gptSovitsCheckpointEpoch(path: string): string | undefined {
  const normalized = path.replace(/\\/gu, "/");
  const epochMatch = normalized.match(/epoch[=_-]?(\d+)|(?:^|[/_-])e(\d+)(?:[/_.-]|$)/iu);
  return firstMatchedGroup(epochMatch);
}

function omniVoiceCheckpointStep(path: string): string | undefined {
  const normalized = path.replace(/\\/gu, "/");
  const stepMatch = normalized.match(/checkpoint-(\d+)|step[=_-]?(\d+)|(?:^|[/_-])s(\d+)(?:[/_.-]|$)/iu);
  return firstMatchedGroup(stepMatch);
}

function firstMatchedGroup(match: RegExpMatchArray | null): string | undefined {
  return match?.slice(1).find(Boolean);
}

function addModel(models: Map<string, ModelDraft>, name: string, path: string, modifiedAt?: number): void {
  const key = name.toLowerCase();
  const existing = models.get(key);
  if (!existing || (modifiedAt ?? 0) > (existing.modifiedAt ?? 0)) {
    models.set(key, { name, path, modifiedAt });
  }
}

async function safeDirectories(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => join(root, entry.name));
  } catch {
    return [];
  }
}

async function safeFiles(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    return entries.filter((entry) => entry.isFile()).map((entry) => join(root, entry.name));
  } catch {
    return [];
  }
}

async function safeStat(path: string): Promise<{ mtimeMs: number; size: number } | undefined> {
  try {
    const stats = await stat(path);
    return { mtimeMs: stats.mtimeMs, size: stats.size };
  } catch {
    return undefined;
  }
}

async function mtime(path: string): Promise<number | undefined> {
  return (await safeStat(path))?.mtimeMs;
}

function sortModels(models: TrainingModelSummary[]): TrainingModelSummary[] {
  return [...models].sort((left, right) => (right.modifiedAt ?? 0) - (left.modifiedAt ?? 0) || left.name.localeCompare(right.name));
}

function sortCheckpoints(checkpoints: TrainingCheckpointSummary[]): TrainingCheckpointSummary[] {
  return [...checkpoints].sort((left, right) =>
    safeNumber(right.epoch) - safeNumber(left.epoch)
    || safeNumber(right.step) - safeNumber(left.step)
    || (right.modifiedAt ?? 0) - (left.modifiedAt ?? 0)
    || right.path.localeCompare(left.path),
  );
}

function safeNumber(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : -1;
}

function resolveProjectRelativePath(projectRoot: string, value: string): string {
  if (isAbsolute(value)) {
    return value;
  }
  const resolved = resolve(projectRoot, value);
  return existsSync(resolved) ? resolved : resolved;
}

export function resolveTrainingToolRoot(projectRoot: string, settings: Pick<VoiceTrainingSettings, "toolRoot">): string {
  return resolveProjectRelativePath(projectRoot, settings.toolRoot.trim() || "training");
}

export function resolveTrainingTensorBoardLogDir(toolRoot: string, selectedModel: VoiceTrainingModel, modelName: string): string {
  return selectedModel === "omnivoice"
    ? omniVoiceTensorBoardLogDir(join(toolRoot, "work", "omnivoice", modelName))
    : gptSovitsTensorBoardLogDir(toolRoot, modelName);
}

function gptSovitsTensorBoardLogDir(toolRoot: string, modelName: string): string {
  return join(toolRoot, "vendor", "repos", "GPT-SoVITS", "logs", modelName);
}

function omniVoiceTensorBoardLogDir(modelDir: string): string {
  return join(modelDir, "exp", "tensorboard");
}
