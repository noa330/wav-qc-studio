import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer, Socket } from "node:net";
import { join } from "node:path";
import type { TensorBoardSessionRequest, TensorBoardSessionResult, VoiceTrainingModel, VoiceTrainingSettings } from "@shared/ipc";
import { createBackendLayout } from "../project/layout";
import { resolveTrainingTensorBoardLogDir, resolveTrainingToolRoot } from "./training-models";

type TensorBoardTarget = {
  selectedModel: VoiceTrainingModel;
  modelName: string;
  logDir: string;
  command: string;
  baseArgs: string[];
  cwd: string;
};

type TensorBoardSession = {
  target: TensorBoardTarget;
  child: ChildProcess;
  url: string;
};

const sessions = new Map<string, TensorBoardSession>();
const tensorBoardStartupTimeoutMs = 15000;

export async function startTensorBoard(request: TensorBoardSessionRequest): Promise<TensorBoardSessionResult> {
  const target = resolveTensorBoardTarget(request.settings);
  const key = sessionKey(target);
  const existing = sessions.get(key);

  if (existing && isProcessRunning(existing.child)) {
    return sessionResult(target, existing.url);
  }
  sessions.delete(key);

  if (!existsSync(target.logDir)) {
    return {
      ok: false,
      selectedModel: target.selectedModel,
      modelName: target.modelName,
      logDir: target.logDir,
      error: "TensorBoard log directory was not found for the selected model.",
    };
  }

  const port = await findFreePort();
  const url = `http://127.0.0.1:${port}/`;
  const child = spawn(
    target.command,
    [
      ...target.baseArgs,
      "--logdir",
      target.logDir,
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--reload_interval",
      "5",
    ],
    {
      cwd: target.cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const stderrLines: string[] = [];
  child.stderr?.on("data", (chunk) => {
    stderrLines.push(String(chunk));
    if (stderrLines.length > 12) {
      stderrLines.splice(0, stderrLines.length - 12);
    }
  });
  child.once("exit", () => {
    if (sessions.get(key)?.child === child) {
      sessions.delete(key);
    }
  });

  try {
    await waitForPort(port, child, tensorBoardStartupTimeoutMs);
  } catch (error) {
    child.kill();
    return {
      ok: false,
      selectedModel: target.selectedModel,
      modelName: target.modelName,
      logDir: target.logDir,
      error: compactTensorBoardError(error, stderrLines.join("")),
    };
  }

  sessions.set(key, { target, child, url });
  return sessionResult(target, url);
}

export function cleanupTensorBoardSessions(): void {
  for (const session of sessions.values()) {
    if (isProcessRunning(session.child)) {
      session.child.kill();
    }
  }
  sessions.clear();
}

function resolveTensorBoardTarget(settings: VoiceTrainingSettings): TensorBoardTarget {
  const layout = createBackendLayout({ markerScript: "voice_train_main.py", venvFolder: ".venv" });
  const selectedModel: VoiceTrainingModel = settings.selectedModel === "omnivoice" ? "omnivoice" : "gpt-sovits";
  const modelName = settings.modelName.trim() || (selectedModel === "omnivoice" ? "omnivoice_train" : "gpt_sovits_train");
  const toolRoot = resolveTrainingToolRoot(layout.projectRoot, settings);
  const repoRoot = selectedModel === "omnivoice"
    ? join(toolRoot, "vendor", "repos", "OmniVoice")
    : join(toolRoot, "vendor", "repos", "GPT-SoVITS");
  const command = resolveTensorBoardCommand(toolRoot, repoRoot, layout.pythonPath);

  return {
    selectedModel,
    modelName,
    logDir: resolveTrainingTensorBoardLogDir(toolRoot, selectedModel, modelName),
    command: command.command,
    baseArgs: command.baseArgs,
    cwd: existsSync(repoRoot) ? repoRoot : layout.projectRoot,
  };
}

function resolveTensorBoardCommand(toolRoot: string, repoRoot: string, fallbackPythonPath: string): { command: string; baseArgs: string[] } {
  const executableCandidates = [
    join(repoRoot, ".conda", "Scripts", "tensorboard.exe"),
    join(repoRoot, ".venv", "Scripts", "tensorboard.exe"),
    join(toolRoot, "vendor", "repos", "GPT-SoVITS", ".conda", "Scripts", "tensorboard.exe"),
    join(toolRoot, "vendor", "repos", "GPT-SoVITS", ".venv", "Scripts", "tensorboard.exe"),
  ];
  const executable = executableCandidates.find((candidate) => existsSync(candidate));
  if (executable) {
    return { command: executable, baseArgs: [] };
  }

  const pythonCandidates = [
    join(repoRoot, ".conda", "python.exe"),
    join(repoRoot, ".venv", "Scripts", "python.exe"),
    join(toolRoot, "vendor", "repos", "GPT-SoVITS", ".conda", "python.exe"),
    join(toolRoot, "vendor", "repos", "GPT-SoVITS", ".venv", "Scripts", "python.exe"),
    fallbackPythonPath,
  ];
  return {
    command: pythonCandidates.find((candidate) => existsSync(candidate)) ?? fallbackPythonPath,
    baseArgs: ["-m", "tensorboard.main"],
  };
}

function sessionResult(target: TensorBoardTarget, url: string): TensorBoardSessionResult {
  return {
    ok: true,
    selectedModel: target.selectedModel,
    modelName: target.modelName,
    logDir: target.logDir,
    url,
  };
}

function sessionKey(target: TensorBoardTarget): string {
  return `${target.selectedModel}:${target.logDir}`;
}

function isProcessRunning(child: ChildProcess): boolean {
  return child.exitCode === null && !child.killed;
}

async function findFreePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolvePort(port));
    });
  });
}

async function waitForPort(port: number, child: ChildProcess, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!isProcessRunning(child)) {
      throw new Error("TensorBoard exited before it became available.");
    }
    if (await canConnect(port)) {
      return;
    }
    await delay(250);
  }
  throw new Error("Timed out waiting for TensorBoard to start.");
}

function canConnect(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new Socket();
    socket.setTimeout(750);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, "127.0.0.1");
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function compactTensorBoardError(error: unknown, stderr: string): string {
  const message = error instanceof Error ? error.message : String(error);
  const detail = stderr.trim().split(/\r?\n/u).slice(-4).join("\n").trim();
  return detail ? `${message}\n${detail}` : message;
}
