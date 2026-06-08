import { createHash } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { appendFile, mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { WorkspaceId, WorkspaceRunMetadata } from "@shared/ipc";
import { runPtyCommand } from "./pty-runner";
import { readTextIfExists } from "./terminal-log";
import { resolveProjectRoot } from "../project/layout";

const BLOCKED_LOCAL_PROXY_PATTERN = /^https?:\/\/127\.0\.0\.1:9\/?$/iu;
const PROXY_ENV_NAMES = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"] as const;

export type PythonRunPlan = {
  workspaceId: WorkspaceId;
  projectRoot: string;
  pythonPath: string;
  scriptPath: string;
  inputPath: string;
  displayInputPath?: string;
  audioSourceMappings?: Array<{ sourcePath: string; cachedPath: string }>;
  outputPath: string;
  manifestPath?: string;
  outputCsvPath?: string;
  logPath: string;
  args: string[];
  cancelPath?: string;
  signal?: AbortSignal;
};

export type PythonRunOutcome = {
  exitCode: number;
  stdout: string;
  stderr: string;
  metadata: WorkspaceRunMetadata;
};

export function assertRunnableLayout(plan: Pick<PythonRunPlan, "pythonPath" | "scriptPath">): void {
  const layoutError = getRunnableLayoutError(plan);
  if (layoutError) {
    throw new Error(layoutError);
  }
}

export function formatCommand(pythonPath: string, args: string[]): string {
  return [pythonPath, ...args].map(quoteArgument).join(" ");
}

export async function runPythonPlan(plan: PythonRunPlan): Promise<PythonRunOutcome> {
  const hostLogPath = resolveHostLogPath(plan.logPath);
  await initializeHostLog(plan, hostLogPath);
  await resetCancelFile(plan.cancelPath);
  const removeAbortListener = installCancelFileWriter(plan);

  try {
    const layoutError = getRunnableLayoutError(plan);
    if (layoutError) {
      await appendHostLog(hostLogPath, `[ERROR] ${layoutError}\r\n`);
      return {
        exitCode: 1,
        stdout: "",
        stderr: layoutError,
        metadata: createMetadata(plan, hostLogPath),
      };
    }

    const outcome = await runPtyCommand({
      file: plan.pythonPath,
      args: plan.args,
      cwd: plan.projectRoot,
      env: createBackendEnvironment(),
      logPath: hostLogPath,
      signal: plan.signal,
    });
    const exitCode = outcome.exitCode;
    await appendHostLog(hostLogPath, `\r\n--- Python process exited with code ${exitCode} ---\r\n`);
    const hostLog = await readTextIfExists(hostLogPath);
    const backendLog = await readTextIfExists(plan.logPath);
    const combinedLog = hostLog || backendLog;

    return {
      exitCode,
      stdout: combinedLog || outcome.output,
      stderr: exitCode === 0 ? "" : lastLines([combinedLog || outcome.output].filter(Boolean).join("\n"), 28),
      metadata: createMetadata(plan, hostLogPath),
    };
  } finally {
    removeAbortListener();
  }
}

async function resetCancelFile(cancelPath: string | undefined): Promise<void> {
  if (!cancelPath) {
    return;
  }

  try {
    await unlink(cancelPath);
  } catch {
    // No stale cancel file to remove.
  }
}

function installCancelFileWriter(plan: PythonRunPlan): () => void {
  if (!plan.signal || !plan.cancelPath) {
    return () => undefined;
  }

  const requestCancel = () => {
    void writeCancelFile(plan.cancelPath);
  };

  if (plan.signal.aborted) {
    requestCancel();
    return () => undefined;
  }

  plan.signal.addEventListener("abort", requestCancel, { once: true });
  return () => plan.signal?.removeEventListener("abort", requestCancel);
}

function installProcessAbortHandler(signal: AbortSignal | undefined, child: ChildProcess, hostLogPath: string): () => void {
  if (!signal) {
    return () => undefined;
  }

  let requested = false;
  const requestAbort = () => {
    if (requested) {
      return;
    }

    requested = true;
    void appendHostLog(hostLogPath, "\r\n--- Stop requested. Terminating backend process tree. ---\r\n");
    terminateProcessTree(child);
  };

  if (signal.aborted) {
    requestAbort();
    return () => undefined;
  }

  signal.addEventListener("abort", requestAbort, { once: true });
  return () => signal.removeEventListener("abort", requestAbort);
}

function terminateProcessTree(child: ChildProcess): void {
  const pid = child.pid;
  if (!pid) {
    child.kill();
    return;
  }

  if (process.platform === "win32") {
    const killer = spawn("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    killer.on("error", () => {
      child.kill();
    });
    return;
  }

  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 1500);
  timer.unref();
}

async function writeCancelFile(cancelPath: string | undefined): Promise<void> {
  if (!cancelPath) {
    return;
  }

  await mkdir(dirname(cancelPath), { recursive: true });
  await writeFile(cancelPath, `cancelled ${new Date().toISOString()}\r\n`, "utf8");
}

async function runPythonPlanInVisibleConsole(plan: PythonRunPlan, hostLogPath: string): Promise<PythonRunOutcome> {
  const commandPath = resolveTerminalCommandPath(plan);
  const statusPath = resolveTerminalStatusPath(plan);
  const payloadPath = resolveTerminalPayloadPath(plan);
  const launcherPath = resolveTerminalLauncherPath(plan);
  await resetTerminalStatus(statusPath);
  await writeTerminalCommand(plan, commandPath, statusPath, payloadPath, launcherPath);
  await appendHostLog(hostLogPath, `Terminal: cmd.exe payload launcher\r\n\r\n`);

  const child = spawn("cmd.exe", ["/d", "/c", "call", commandPath], {
    cwd: plan.projectRoot,
    detached: true,
    windowsHide: false,
    stdio: "ignore",
    env: createBackendEnvironment(),
  });
  const removeProcessAbortListener = installProcessAbortHandler(plan.signal, child, hostLogPath);

  let stdout = "";
  let stderr = "";

  let rawExitCode = 1;
  try {
    rawExitCode = await new Promise<number>((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (code) => resolve(code ?? 1));
    });
  } finally {
    removeProcessAbortListener();
    await removeTerminalCommand(commandPath);
    await removeTerminalCommand(payloadPath);
    await removeTerminalCommand(launcherPath);
  }

  const terminalExitCode = await readTerminalExitCode(statusPath);
  await removeTerminalStatus(statusPath);
  const exitCode = plan.signal?.aborted ? 130 : terminalExitCode ?? rawExitCode;
  if (stdout || stderr) {
    await appendHostLog(hostLogPath, `\r\n--- Terminal process output ---\r\n${stdout}${stderr}\r\n`);
  }
  const hostLog = await readTextIfExists(hostLogPath);
  const backendLog = await readTextIfExists(plan.logPath);
  const combinedLog = [hostLog, backendLog].filter(Boolean).join("\r\n");

  return {
    exitCode,
    stdout: combinedLog,
    stderr: exitCode === 0 ? stderr : lastLines([stderr, combinedLog].filter(Boolean).join("\n"), 28),
    metadata: createMetadata(plan, hostLogPath),
  };
}

function getRunnableLayoutError(plan: Pick<PythonRunPlan, "pythonPath" | "scriptPath">): string | undefined {
  if (!existsSync(plan.pythonPath)) {
    return `Python executable not found: ${plan.pythonPath}`;
  }

  if (!existsSync(plan.scriptPath)) {
    return `Backend script not found: ${plan.scriptPath}`;
  }

  return undefined;
}

function createMetadata(plan: PythonRunPlan, hostLogPath: string, launcherPath?: string): WorkspaceRunMetadata {
  return {
    projectRoot: plan.projectRoot,
    pythonPath: plan.pythonPath,
    scriptPath: plan.scriptPath,
    inputPath: plan.inputPath,
    outputPath: plan.outputPath,
    manifestPath: plan.manifestPath,
    outputCsvPath: plan.outputCsvPath,
    logPath: hostLogPath,
    backendLogPath: plan.logPath,
    launcherPath,
    command: formatCommand(plan.pythonPath, plan.args),
  };
}

async function initializeHostLog(plan: PythonRunPlan, hostLogPath: string): Promise<void> {
  await mkdir(dirname(hostLogPath), { recursive: true });
  const lines = [
    "",
    `===== Electron backend launch ${new Date().toISOString()} =====`,
    `Project root: ${plan.projectRoot}`,
    `Python: ${plan.pythonPath}`,
    `Script: ${plan.scriptPath}`,
    `Input: ${plan.inputPath}`,
    `Output: ${plan.outputPath}`,
    `Backend log: ${plan.logPath}`,
    `Command: ${formatCommand(plan.pythonPath, plan.args)}`,
    "",
  ];
  await appendHostLog(hostLogPath, lines.join("\r\n"));
}

async function appendHostLog(hostLogPath: string, text: string): Promise<void> {
  await appendFile(hostLogPath, text, "utf8");
}

export function createBackendEnvironment(): NodeJS.ProcessEnv {
  const pathWithBundledTools = withBundledToolPath(process.env.Path ?? process.env.PATH);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: pathWithBundledTools,
    Path: pathWithBundledTools,
    PYTHONUNBUFFERED: "1",
    PYTHONIOENCODING: "utf-8",
  };

  for (const name of PROXY_ENV_NAMES) {
    if (isBlockedLocalProxy(env[name])) {
      delete env[name];
    }
  }

  return env;
}

function withBundledToolPath(pathValue: string | undefined): string {
  const entries = bundledToolPathEntries();
  if (entries.length === 0) {
    return pathValue ?? "";
  }

  const current = (pathValue ?? "").split(";").filter(Boolean);
  const normalizedCurrent = new Set(current.map(normalizePathEntry));
  const missing = entries.filter((entry) => !normalizedCurrent.has(normalizePathEntry(entry)));
  return [...missing, ...current].join(";");
}

function bundledToolPathEntries(): string[] {
  const projectRoot = resolveProjectRoot();
  const parentRoot = dirname(projectRoot);
  const localAppData = process.env.LOCALAPPDATA || process.env.LocalAppData;
  const candidates = [
    join(projectRoot, "tools", "mingit", "cmd"),
    join(projectRoot, "tools", "git", "cmd"),
    join(projectRoot, ".tools", "mingit", "cmd"),
    join(projectRoot, ".tools", "git", "cmd"),
    join(parentRoot, "tools", "mingit", "cmd"),
    join(parentRoot, "tools", "git", "cmd"),
    ...(localAppData
      ? [
          join(localAppData, "WAV QC Studio", "tools", "mingit", "cmd"),
          join(localAppData, "WAV QC Studio", "tools", "git", "cmd"),
        ]
      : []),
  ];
  return candidates.filter((entry) => existsSync(join(entry, "git.exe")));
}

function normalizePathEntry(value: string): string {
  return value.replace(/\\/gu, "/").replace(/\/+$/u, "").toLowerCase();
}

function isBlockedLocalProxy(value: string | undefined): boolean {
  return BLOCKED_LOCAL_PROXY_PATTERN.test(value ?? "");
}

export function resolveHostLogPath(logPath: string): string {
  return logPath.replace(/\.log$/iu, ".electron.log") || `${logPath}.electron.log`;
}

function lastLines(value: string, count: number): string {
  const lines = value
    .split(/\r?\n/u)
    .map((line) => line.trimEnd())
    .filter(Boolean);
  return lines.slice(-count).join("\n");
}

function quoteArgument(value: string): string {
  if (/^[A-Za-z0-9_./:\\-]+$/u.test(value)) {
    return value;
  }

  return `"${value.replace(/"/gu, '""')}"`;
}

function resolveTerminalCommandPath(plan: PythonRunPlan): string {
  const digest = createHash("sha1").update(plan.logPath).digest("hex").slice(0, 16);
  return join(plan.projectRoot, ".tmp", "backend-terminal", `${digest}.cmd`);
}

function resolveTerminalStatusPath(plan: PythonRunPlan): string {
  const digest = createHash("sha1").update(plan.logPath).digest("hex").slice(0, 16);
  return join(plan.projectRoot, ".tmp", "backend-terminal", `${digest}.exitcode`);
}

function resolveTerminalPayloadPath(plan: PythonRunPlan): string {
  const digest = createHash("sha1").update(plan.logPath).digest("hex").slice(0, 16);
  return join(plan.projectRoot, ".tmp", "backend-terminal", `${digest}.json`);
}

function resolveTerminalLauncherPath(plan: PythonRunPlan): string {
  const digest = createHash("sha1").update(plan.logPath).digest("hex").slice(0, 16);
  return join(plan.projectRoot, ".tmp", "backend-terminal", `${digest}.py`);
}

async function writeTerminalCommand(plan: PythonRunPlan, commandPath: string, statusPath: string, payloadPath: string, launcherPath: string): Promise<void> {
  await mkdir(dirname(commandPath), { recursive: true });
  await writeFile(
    payloadPath,
    JSON.stringify(
      {
        pythonPath: plan.pythonPath,
        args: plan.args,
        projectRoot: plan.projectRoot,
        statusPath,
        env: {
          PYTHONUNBUFFERED: "1",
          PYTHONIOENCODING: "utf-8",
        },
      },
      null,
      2,
    ),
    "utf8",
  );
  await writeFile(
    launcherPath,
    [
      "import json",
      "import os",
      "import subprocess",
      "import sys",
      "",
      "with open(sys.argv[1], 'r', encoding='utf-8-sig') as payload_file:",
      "    payload = json.load(payload_file)",
      "",
      "env = os.environ.copy()",
      "env.update(payload.get('env') or {})",
      "completed = subprocess.run(",
      "    [payload['pythonPath'], *payload['args']],",
      "    cwd=payload['projectRoot'],",
      "    env=env,",
      ")",
      "status_path = payload.get('statusPath')",
      "if status_path:",
      "    os.makedirs(os.path.dirname(status_path), exist_ok=True)",
      "    with open(status_path, 'w', encoding='ascii') as status_file:",
      "        status_file.write(str(completed.returncode))",
      "raise SystemExit(completed.returncode)",
      "",
    ].join("\n"),
    "utf8",
  );
  const command = [
    "@echo off",
    "chcp 65001 >nul",
    `cd /d ${quoteBatchArgument(plan.projectRoot)}`,
    [plan.pythonPath, launcherPath, payloadPath].map(quoteBatchArgument).join(" "),
    "set EXIT_CODE=%ERRORLEVEL%",
    `if not exist ${quoteBatchArgument(statusPath)} > ${quoteBatchArgument(statusPath)} echo %EXIT_CODE%`,
    "exit /b %EXIT_CODE%",
    "",
  ].join("\r\n");
  await writeFile(commandPath, command, "utf8");
}

async function resetTerminalStatus(statusPath: string): Promise<void> {
  try {
    await unlink(statusPath);
  } catch {
    // No stale status file to remove.
  }
}

async function readTerminalExitCode(statusPath: string): Promise<number | undefined> {
  const text = (await readTextIfExists(statusPath)).trim();
  const code = Number.parseInt(text, 10);
  return Number.isFinite(code) ? code : undefined;
}

async function removeTerminalStatus(statusPath: string): Promise<void> {
  try {
    await unlink(statusPath);
  } catch {
    // The terminal may not have created the status file.
  }
}

async function removeTerminalCommand(commandPath: string): Promise<void> {
  try {
    await unlink(commandPath);
  } catch {
    // The command file may already be gone if the run was interrupted.
  }
}

function quoteBatchArgument(value: string): string {
  return quoteWindowsArgument(value).replace(/%/gu, "%%");
}

function quoteWindowsArgument(value: string): string {
  if (value && !/[\s"&|<>^%]/u.test(value)) {
    return value;
  }

  let result = '"';
  let slashCount = 0;
  for (const char of value) {
    if (char === "\\") {
      slashCount += 1;
      continue;
    }

    if (char === '"') {
      result += "\\".repeat(slashCount * 2 + 1);
      result += '"';
      slashCount = 0;
      continue;
    }

    result += "\\".repeat(slashCount);
    result += char;
    slashCount = 0;
  }

  result += "\\".repeat(slashCount * 2);
  result += '"';
  return result;
}
