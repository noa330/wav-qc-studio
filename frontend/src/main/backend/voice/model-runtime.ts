import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  VoiceModelRuntimeInstallResult,
  VoiceModelRuntimeRequest,
  VoiceModelRuntimeStatus,
  VoiceTrainingModel,
  WorkspaceId,
  WorkspaceSettings,
  WorkspaceTerminalUpdate,
} from "@shared/ipc";
import { createBackendEnvironment, formatCommand } from "../process/python-runner";
import { runPtyCommand } from "../process/pty-runner";
import { readRawTerminalSnapshot, readTextIfExists } from "../process/terminal-log";
import { createBackendLayout } from "../project/layout";
import { resolveTrainingToolRoot } from "./training-models";

type VoiceModelRuntimeProgressHandler = (terminal: WorkspaceTerminalUpdate) => void;

type VoiceModelRuntimeTarget = {
  workspaceId: WorkspaceId;
  selectedModel: VoiceTrainingModel;
  label: string;
  toolRoot: string;
  gptVersion?: WorkspaceSettings["training"]["gptVersion"];
  settingsKey: string;
};

type VoiceAssetCheckPayload = {
  ok?: boolean;
  model?: VoiceTrainingModel;
  label?: string;
  toolRoot?: string;
  path?: string;
  gptVersion?: WorkspaceSettings["training"]["gptVersion"];
  error?: string;
};

export async function checkVoiceModelRuntime(request: VoiceModelRuntimeRequest): Promise<VoiceModelRuntimeStatus> {
  const target = voiceRuntimeTarget(request);
  const layout = voiceAssetCliLayout();

  if (!existsSync(layout.pythonPath)) {
    return createStatus(target, {
      ok: false,
      path: target.toolRoot,
      error: `Main runtime Python was not found: ${layout.pythonPath}`,
    });
  }

  if (!existsSync(layout.scriptPath)) {
    return createStatus(target, {
      ok: false,
      path: target.toolRoot,
      error: `Voice model setup script was not found: ${layout.scriptPath}`,
    });
  }

  const args = voiceAssetCliArgs("check", target);
  try {
    const output = await runPythonCapture(layout.pythonPath, args, layout.projectRoot);
    return createStatus(target, parseCheckPayload(output));
  } catch (error) {
    return createStatus(target, {
      ok: false,
      path: target.toolRoot,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function installVoiceModelRuntime(
  request: VoiceModelRuntimeRequest,
  onProgress?: VoiceModelRuntimeProgressHandler,
  signal?: AbortSignal,
): Promise<VoiceModelRuntimeInstallResult> {
  const target = voiceRuntimeTarget(request);
  const before = await checkVoiceModelRuntime(request);
  if (before.ok) {
    return {
      ok: true,
      workspaceId: request.workspaceId,
      status: before,
      exitCode: 0,
      stdout: `${target.label} model runtime is already installed.`,
    };
  }

  const layout = voiceAssetCliLayout();
  if (!existsSync(layout.pythonPath) || !existsSync(layout.scriptPath)) {
    return {
      ok: false,
      workspaceId: request.workspaceId,
      status: before,
      exitCode: 1,
      error: before.error ?? "Voice model runtime setup cannot start because the main runtime is missing.",
      stderr: before.error,
    };
  }

  const logPath = join(layout.projectRoot, ".tmp", "voice-model-runtime-install", `${request.workspaceId}_${target.selectedModel}_${timestamp()}.log`);
  const args = [...voiceAssetCliArgs("prepare", target), "--log", logPath];
  const command = formatCommand(layout.pythonPath, args);

  await mkdir(join(layout.projectRoot, ".tmp", "voice-model-runtime-install"), { recursive: true });
  await writeFile(logPath, [
    "=== Voice model runtime setup ===",
    `Workspace: ${request.workspaceId}`,
    `Model: ${target.label}`,
    `Tool root: ${target.toolRoot}`,
    `Command: ${command}`,
    "",
  ].join("\r\n"), "utf8");

  const progressTimer = setInterval(() => {
    void emitInstallProgress(logPath, command, onProgress);
  }, 650);
  void emitInstallProgress(logPath, command, onProgress);

  try {
    const outcome = await runPtyCommand({
      file: layout.pythonPath,
      args,
      cwd: layout.projectRoot,
      env: createBackendEnvironment(),
      logPath,
      signal,
    });
    clearInterval(progressTimer);
    await emitInstallProgress(logPath, command, onProgress);

    const status = await checkVoiceModelRuntime(request);
    const stdout = await readTextIfExists(logPath);
    const ok = outcome.exitCode === 0 && status.ok;
    return {
      ok,
      workspaceId: request.workspaceId,
      status,
      exitCode: outcome.exitCode,
      error: ok ? undefined : outcome.exitCode === 130 ? `${target.label} setup was cancelled.` : `${target.label} setup failed.`,
      stdout,
      stderr: ok ? undefined : lastLines(stdout || outcome.output, 28),
      logPath,
      command,
    };
  } finally {
    clearInterval(progressTimer);
  }
}

function voiceAssetCliLayout(): { projectRoot: string; pythonPath: string; scriptPath: string } {
  const layout = createBackendLayout({ markerScript: "voice_train_main.py", venvFolder: ".venv" });
  return {
    ...layout,
    scriptPath: join(layout.projectRoot, "backend", "voice_assets_cli.py"),
  };
}

function voiceRuntimeTarget(request: VoiceModelRuntimeRequest): VoiceModelRuntimeTarget {
  const settings = request.workspaceId === "inference" ? request.settings.inference : request.settings.training;
  const selectedModel: VoiceTrainingModel = settings.selectedModel === "omnivoice" ? "omnivoice" : "gpt-sovits";
  const layout = voiceAssetCliLayout();
  const toolRoot = resolveTrainingToolRoot(layout.projectRoot, settings);
  return {
    workspaceId: request.workspaceId,
    selectedModel,
    label: selectedModel === "omnivoice" ? "OmniVoice" : "GPT-SoVITS",
    toolRoot,
    gptVersion: selectedModel === "gpt-sovits" ? settings.gptVersion : undefined,
    settingsKey: [
      request.workspaceId,
      selectedModel,
      settings.toolRoot.trim(),
      selectedModel === "gpt-sovits" ? settings.gptVersion : "",
    ].join("|"),
  };
}

function voiceAssetCliArgs(command: "check" | "prepare", target: VoiceModelRuntimeTarget): string[] {
  const args = [
    voiceAssetCliLayout().scriptPath,
    command,
    "--model",
    target.selectedModel,
    "--tool-root",
    target.toolRoot,
  ];
  if (target.gptVersion) {
    args.push("--gpt-version", target.gptVersion);
  }
  return args;
}

function createStatus(target: VoiceModelRuntimeTarget, payload: VoiceAssetCheckPayload): VoiceModelRuntimeStatus {
  return {
    workspaceId: target.workspaceId,
    selectedModel: payload.model ?? target.selectedModel,
    toolRoot: payload.toolRoot ?? target.toolRoot,
    gptVersion: payload.gptVersion ?? target.gptVersion,
    settingsKey: target.settingsKey,
    label: payload.label ?? target.label,
    path: payload.path ?? target.toolRoot,
    ok: Boolean(payload.ok),
    checkedAt: new Date().toISOString(),
    error: payload.error,
  };
}

function runPythonCapture(pythonPath: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonPath, args, {
      cwd,
      env: createBackendEnvironment(),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(new Error(lastLines([stdout, stderr].filter(Boolean).join("\n"), 28) || `Python process exited with code ${code ?? 1}`));
    });
  });
}

function parseCheckPayload(output: string): VoiceAssetCheckPayload {
  const line = output.split(/\r?\n/u).reverse().find((item) => item.trim().startsWith("{"));
  if (!line) {
    return {
      ok: false,
      path: "",
      error: "Voice model runtime check returned no status payload.",
    };
  }
  return JSON.parse(line) as VoiceAssetCheckPayload;
}

async function emitInstallProgress(logPath: string, command: string, onProgress?: VoiceModelRuntimeProgressHandler): Promise<void> {
  if (!onProgress) {
    return;
  }

  const terminal = await readRawTerminalSnapshot({
    primaryLogPath: logPath,
    logPath,
    backendLogPath: logPath,
    command,
  });
  if (terminal) {
    onProgress(terminal);
  }
}

function lastLines(text: string, count: number): string {
  return text.split(/\r?\n/u).slice(-count).join("\n");
}

function timestamp(): string {
  const now = new Date();
  const date = [
    now.getFullYear(),
    `${now.getMonth() + 1}`.padStart(2, "0"),
    `${now.getDate()}`.padStart(2, "0"),
  ].join("");
  const time = [`${now.getHours()}`.padStart(2, "0"), `${now.getMinutes()}`.padStart(2, "0"), `${now.getSeconds()}`.padStart(2, "0")].join("");
  return `${date}_${time}_${`${now.getMilliseconds()}`.padStart(3, "0")}`;
}
