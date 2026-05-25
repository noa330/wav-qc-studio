import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  WorkspaceId,
  WorkspaceRuntimeEnvironmentId,
  WorkspaceRuntimeEnvironmentInstallResult,
  WorkspaceRuntimeEnvironmentRequirement,
  WorkspaceRuntimeEnvironmentStatus,
  WorkspaceTerminalUpdate,
} from "@shared/ipc";
import { createBackendEnvironment } from "../process/python-runner";
import { runPtyCommand } from "../process/pty-runner";
import { readRawTerminalSnapshot, readTextIfExists } from "../process/terminal-log";
import { resolveProjectRoot } from "../project/layout";

type WorkspaceRuntimeProgressHandler = (terminal: WorkspaceTerminalUpdate) => void;

const ENVIRONMENT_LABELS: Record<WorkspaceRuntimeEnvironmentId, string> = {
  main: "기본 런타임 (.venv)",
  noise: "화자 런타임 (.venv_noise)",
  slice: "슬라이스 런타임 (.ven_slice)",
};

export function checkWorkspaceRuntimeEnvironment(workspaceId: WorkspaceId): WorkspaceRuntimeEnvironmentStatus {
  const projectRoot = resolveProjectRoot();
  const requirements = requiredEnvironments(workspaceId).map((id): WorkspaceRuntimeEnvironmentRequirement => ({
    id,
    label: ENVIRONMENT_LABELS[id],
    path: pythonPathForEnvironment(projectRoot, id),
    installed: existsSync(pythonPathForEnvironment(projectRoot, id)),
  }));

  return {
    workspaceId,
    ok: requirements.every((item) => item.installed),
    checkedAt: new Date().toISOString(),
    requirements,
  };
}

export async function installWorkspaceRuntimeEnvironment(
  workspaceId: WorkspaceId,
  onProgress?: WorkspaceRuntimeProgressHandler,
  signal?: AbortSignal,
): Promise<WorkspaceRuntimeEnvironmentInstallResult> {
  const before = checkWorkspaceRuntimeEnvironment(workspaceId);
  if (before.ok) {
    return {
      ok: true,
      workspaceId,
      status: before,
      exitCode: 0,
      stdout: "필요한 런타임이 이미 설치되어 있습니다.",
    };
  }

  const projectRoot = resolveProjectRoot();
  const setupScript = join(projectRoot, "setup_and_run.ps1");
  const logPath = join(projectRoot, ".tmp", "workspace-runtime-install", `${workspaceId}_${timestamp()}.log`);
  const required = new Set(requiredEnvironments(workspaceId));
  const powershell = resolvePowerShellExe();
  const args = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    setupScript,
    "-InstallMain",
    required.has("main") ? "true" : "false",
    "-InstallNoise",
    required.has("noise") ? "true" : "false",
    "-InstallSlice",
    required.has("slice") ? "true" : "false",
  ];
  const command = `${powershell} ${args.map(quoteCommandArg).join(" ")}`;

  await mkdir(join(projectRoot, ".tmp", "workspace-runtime-install"), { recursive: true });
  await writeFile(logPath, [
    "=== 런타임 설치 ===",
    `작업 화면: ${workspaceId}`,
    `명령: ${command}`,
    "",
  ].join("\r\n"), "utf8");

  const progressTimer = setInterval(() => {
    void emitInstallProgress(logPath, command, onProgress);
  }, 650);
  void emitInstallProgress(logPath, command, onProgress);

  try {
    const outcome = await runPtyCommand({
      file: powershell,
      args,
      cwd: projectRoot,
      env: {
        ...createBackendEnvironment(),
        PYTHONUTF8: "1",
        PYTHONIOENCODING: "utf-8",
      },
      logPath,
      signal,
    });
    const exitCode = outcome.exitCode;
    clearInterval(progressTimer);
    await emitInstallProgress(logPath, command, onProgress);

    const status = checkWorkspaceRuntimeEnvironment(workspaceId);
    const stdout = await readTextIfExists(logPath);
    const ok = exitCode === 0 && status.ok;
    return {
      ok,
      workspaceId,
      status,
      exitCode,
      error: ok ? undefined : exitCode === 130 ? "런타임 설치가 취소되었습니다." : "런타임 설치에 실패했습니다.",
      stdout,
      stderr: ok ? undefined : lastLines(stdout, 28),
      logPath,
      command,
    };
  } finally {
    clearInterval(progressTimer);
  }
}

function requiredEnvironments(workspaceId: WorkspaceId): WorkspaceRuntimeEnvironmentId[] {
  switch (workspaceId) {
    case "slice":
    case "tagging":
      return ["slice"];
    case "speaker":
      return ["noise"];
    default:
      return ["main"];
  }
}

function pythonPathForEnvironment(projectRoot: string, id: WorkspaceRuntimeEnvironmentId): string {
  switch (id) {
    case "main":
      return join(projectRoot, ".venv", "Scripts", "python.exe");
    case "noise":
      return join(projectRoot, ".venv_noise", "Scripts", "python.exe");
    case "slice":
      return join(projectRoot, ".ven_slice", "Scripts", "python.exe");
  }
}

function resolvePowerShellExe(): string {
  const windir = process.env.WINDIR || process.env.SystemRoot || "C:\\Windows";
  return join(windir, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

async function emitInstallProgress(logPath: string, command: string, onProgress?: WorkspaceRuntimeProgressHandler): Promise<void> {
  if (!onProgress) {
    return;
  }

  const terminal = await readRawTerminalSnapshot({
    primaryLogPath: logPath,
    logPath,
    backendLogPath: logPath,
    command,
  });
  if (!terminal) {
    return;
  }

  onProgress(terminal);
}

function lastLines(text: string, count: number): string {
  return text.split(/\r?\n/u).slice(-count).join("\n");
}

function quoteCommandArg(value: string): string {
  return /\s/u.test(value) ? `"${value.replace(/"/gu, '\\"')}"` : value;
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
