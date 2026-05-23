import type { TrainingCheckpointSummary, VoiceTrainingSettings } from "@shared/ipc";
import { gptPretrainedDefaults, shouldReplaceGptPretrainedPath, type GptPretrainedDefaults } from "./voice-training-pretrained";

export function filterTrainingCheckpoints(
  checkpoints: TrainingCheckpointSummary[],
  kind: TrainingCheckpointSummary["kind"],
  predicate: (checkpoint: TrainingCheckpointSummary) => boolean = () => true,
): TrainingCheckpointSummary[] {
  return checkpoints.filter((checkpoint) => checkpoint.kind === kind && predicate(checkpoint));
}

export function selectedCheckpointPath(path: string, checkpoints: TrainingCheckpointSummary[]): string {
  return checkpoints.some((checkpoint) => checkpoint.path === path) ? path : checkpoints[0]?.path ?? "";
}

export function settingsWithGptSovitsAutoCheckpoints(
  current: VoiceTrainingSettings,
  selectedCheckpoints: TrainingCheckpointSummary[],
): VoiceTrainingSettings {
  if (current.selectedModel !== "gpt-sovits") {
    return current;
  }

  const defaults = gptPretrainedDefaults[current.gptVersion];
  const sovitsGenerators = filterTrainingCheckpoints(
    selectedCheckpoints,
    "sovits",
    (checkpoint) => checkpoint.role === "resume" && checkpoint.component !== "discriminator",
  );
  const sovitsDiscriminators = filterTrainingCheckpoints(
    selectedCheckpoints,
    "sovits",
    (checkpoint) => checkpoint.role === "resume" && checkpoint.component === "discriminator",
  );
  const gptCheckpoints = filterTrainingCheckpoints(selectedCheckpoints, "gpt", (checkpoint) => checkpoint.role === "resume");
  const nextSovitsPath = selectedCheckpointPath(current.gptResumeSovitsPath, sovitsGenerators);
  const nextSovitsDPath = matchingSovitsDiscriminator(nextSovitsPath, sovitsDiscriminators)?.path ?? "";
  const nextGptPath = selectedCheckpointPath(current.gptResumeGptPath, gptCheckpoints);
  const nextPretrainedS2G = resolveManagedPretrainedPath(current.gptPretrainedS2G, nextSovitsPath, defaults.s2g, "s2g", selectedCheckpoints);
  const nextPretrainedS2D = resolveManagedPretrainedPath(current.gptPretrainedS2D, nextSovitsDPath, defaults.s2d, "s2d", selectedCheckpoints);
  const nextPretrainedS1 = resolveManagedPretrainedPath(current.gptPretrainedS1, nextGptPath, defaults.s1, "s1", selectedCheckpoints);

  if (
    nextSovitsPath === current.gptResumeSovitsPath
    && nextGptPath === current.gptResumeGptPath
    && nextPretrainedS2G === current.gptPretrainedS2G
    && nextPretrainedS2D === current.gptPretrainedS2D
    && nextPretrainedS1 === current.gptPretrainedS1
  ) {
    return current;
  }

  return {
    ...current,
    gptResumeSovitsPath: nextSovitsPath,
    gptResumeGptPath: nextGptPath,
    gptPretrainedS2G: nextPretrainedS2G,
    gptPretrainedS2D: nextPretrainedS2D,
    gptPretrainedS1: nextPretrainedS1,
  };
}

function matchingSovitsDiscriminator(generatorPath: string, discriminators: TrainingCheckpointSummary[]): TrainingCheckpointSummary | undefined {
  const generatorKey = sovitsCheckpointPairKey(generatorPath);
  if (!generatorKey) {
    return discriminators[0];
  }
  return discriminators.find((checkpoint) => sovitsCheckpointPairKey(checkpoint.path) === generatorKey) ?? discriminators[0];
}

function sovitsCheckpointPairKey(path: string): string {
  const name = path.split(/[\\/]/u).filter(Boolean).pop() ?? "";
  return name.replace(/^[GD]_/iu, "").replace(/\.[^.]+$/u, "").toLowerCase();
}

function resolveManagedPretrainedPath(
  currentPath: string,
  nextCheckpointPath: string,
  defaultPath: string,
  key: keyof GptPretrainedDefaults,
  selectedCheckpoints: TrainingCheckpointSummary[],
): string {
  if (nextCheckpointPath) {
    return nextCheckpointPath;
  }
  if (shouldReplaceGptPretrainedPath(currentPath, defaultPath, key) || isForeignManagedCheckpointPath(currentPath, selectedCheckpoints)) {
    return defaultPath;
  }
  return currentPath;
}

function isForeignManagedCheckpointPath(path: string, selectedCheckpoints: TrainingCheckpointSummary[]): boolean {
  const normalized = normalizeCheckpointPath(path);
  if (!normalized || !isManagedGptSovitsCheckpointPath(normalized)) {
    return false;
  }
  return !selectedCheckpoints.some((checkpoint) => normalizeCheckpointPath(checkpoint.path) === normalized);
}

function isManagedGptSovitsCheckpointPath(normalizedPath: string): boolean {
  return normalizedPath.includes("/vendor/repos/gpt-sovits/logs/")
    || normalizedPath.includes("/vendor/repos/gpt-sovits/gpt_weights")
    || normalizedPath.includes("/vendor/repos/gpt-sovits/sovits_weights");
}

function normalizeCheckpointPath(path: string): string {
  return path.trim().replace(/\\/gu, "/").toLowerCase();
}
