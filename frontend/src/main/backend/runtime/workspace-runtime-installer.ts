import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
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

type RuntimeReadiness = {
  ready: boolean;
  detail: string;
};

const ENVIRONMENT_LABELS: Record<WorkspaceRuntimeEnvironmentId, string> = {
  main: "Main runtime (.venv)",
  noise: "Denoise runtime (.venv_noise)",
  slice: "Slice runtime (.ven_slice)",
};

const REQUIRED_IMPORTS: Record<WorkspaceRuntimeEnvironmentId, string[]> = {
  main: [
    "numpy",
    "pandas",
    "scipy",
    "soundfile",
    "librosa",
    "torch",
    "torchaudio",
    "tqdm",
    "click",
    "uroman",
    "sklearn",
    "huggingface_hub",
    "transformers",
    "accelerate",
    "safetensors",
    "faster_whisper",
    "torchmetrics",
    "omegaconf",
    "toml",
    "cpuinfo",
    "py3nvml",
    "diarizen",
    "pyannote.audio",
  ],
  noise: [
    "numpy",
    "scipy",
    "soundfile",
    "librosa",
    "matplotlib",
    "pandas",
    "omegaconf",
    "rich",
    "tqdm",
    "resampy",
    "tabulate",
    "celluloid",
    "ptflops",
    "yaml",
    "huggingface_hub",
    "transformers",
    "torchlibrosa",
    "torch",
    "torchvision",
    "torchaudio",
    "resemble_enhance",
  ],
  slice: [
    "numpy",
    "scipy",
    "soundfile",
    "librosa",
    "torch",
    "torchaudio",
    "torchvision",
    "timm",
    "einops",
    "fireredvad",
    "pandas",
    "nnAudio",
    "av",
    "h5py",
    "jsonpickle",
    "datasets",
    "pytorch_lightning",
    "wandb",
    "intervaltree",
    "more_itertools",
  ],
};

export function checkWorkspaceRuntimeEnvironment(workspaceId: WorkspaceId): WorkspaceRuntimeEnvironmentStatus {
  const projectRoot = resolveProjectRoot();
  const requirements = requiredEnvironments(workspaceId).map((id): WorkspaceRuntimeEnvironmentRequirement => {
    const pythonPath = pythonPathForEnvironment(projectRoot, id);
    const readiness = checkEnvironmentReadiness(projectRoot, id);
    return {
      id,
      label: readiness.ready ? ENVIRONMENT_LABELS[id] : `${ENVIRONMENT_LABELS[id]} - ${readiness.detail}`,
      path: pythonPath,
      installed: readiness.ready,
    };
  });

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
      stdout: "Required Python runtime is already installed and verified.",
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
    "=== Workspace runtime install ===",
    `Workspace: ${workspaceId}`,
    `Command: ${command}`,
    "",
  ].join("\r\n"), "utf8");
  await removeIncompleteSelectedEnvironments(projectRoot, required, logPath);

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
      error: ok ? undefined : exitCode === 130 ? "Runtime installation was cancelled." : "Runtime installation failed or verification did not pass.",
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
  return join(environmentDirFor(projectRoot, id), "Scripts", "python.exe");
}

function environmentDirFor(projectRoot: string, id: WorkspaceRuntimeEnvironmentId): string {
  switch (id) {
    case "main":
      return join(projectRoot, ".venv");
    case "noise":
      return join(projectRoot, ".venv_noise");
    case "slice":
      return join(projectRoot, ".ven_slice");
  }
}

async function removeIncompleteSelectedEnvironments(projectRoot: string, required: Set<WorkspaceRuntimeEnvironmentId>, logPath: string): Promise<void> {
  const lines: string[] = [];
  for (const id of required) {
    const envDir = environmentDirFor(projectRoot, id);
    if (!existsSync(envDir)) {
      continue;
    }

    const readiness = checkEnvironmentReadiness(projectRoot, id);
    if (readiness.ready) {
      lines.push(`[runtime verified] ${ENVIRONMENT_LABELS[id]}: ${envDir}`);
      continue;
    }

    lines.push(`[runtime reset] Removing incomplete ${ENVIRONMENT_LABELS[id]}: ${envDir}`);
    lines.push(`[runtime reset] Reason: ${readiness.detail}`);
    await rm(envDir, { recursive: true, force: true });
  }

  if (lines.length > 0) {
    await writeFile(logPath, `${lines.join("\r\n")}\r\n\r\n`, { encoding: "utf8", flag: "a" });
  }
}

function checkEnvironmentReadiness(projectRoot: string, id: WorkspaceRuntimeEnvironmentId): RuntimeReadiness {
  const pythonPath = pythonPathForEnvironment(projectRoot, id);
  if (!existsSync(pythonPath)) {
    return { ready: false, detail: "python.exe missing" };
  }

  const imports = REQUIRED_IMPORTS[id];
  const code = [
    "import importlib, json, sys",
    "mods = sys.argv[1:]",
    "missing = []",
    "for mod in mods:",
    "    try:",
    "        importlib.import_module(mod)",
    "    except Exception as exc:",
    "        missing.append(f'{mod}: {type(exc).__name__}: {exc}')",
    "print(json.dumps({'missing': missing}, ensure_ascii=False))",
    "raise SystemExit(1 if missing else 0)",
  ].join("\n");
  const result = spawnSync(pythonPath, ["-c", code, ...imports], {
    cwd: projectRoot,
    env: {
      ...createBackendEnvironment(),
      PYTHONUTF8: "1",
      PYTHONIOENCODING: "utf-8",
    },
    encoding: "utf8",
    windowsHide: true,
    timeout: 120_000,
  });

  if (result.error) {
    return { ready: false, detail: result.error.message };
  }

  if (result.status === 0) {
    return { ready: true, detail: "verified" };
  }

  const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
  const missing = parseMissingImports(output);
  return { ready: false, detail: missing.length > 0 ? `missing imports: ${missing.slice(0, 4).join(", ")}` : lastLines(output, 6) || `probe exited with code ${result.status}` };
}

function parseMissingImports(output: string): string[] {
  const firstJsonLine = output.split(/\r?\n/u).find((line) => line.trim().startsWith("{"));
  if (!firstJsonLine) {
    return [];
  }

  try {
    const parsed = JSON.parse(firstJsonLine) as { missing?: unknown };
    if (Array.isArray(parsed.missing)) {
      return parsed.missing.map((item) => String(item));
    }
  } catch {
    return [];
  }

  return [];
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



