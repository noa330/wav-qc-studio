import { spawn } from "node:child_process";
import { appendFile } from "node:fs/promises";
import * as pty from "@lydell/node-pty";

export type PtyCommandOptions = {
  file: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  logPath: string;
  signal?: AbortSignal;
  cols?: number;
  rows?: number;
};

export type PtyCommandResult = {
  exitCode: number;
  output: string;
};

export async function runPtyCommand(options: PtyCommandOptions): Promise<PtyCommandResult> {
  const terminal = pty.spawn(options.file, options.args, {
    name: "xterm-256color",
    cwd: options.cwd,
    env: options.env,
    cols: options.cols ?? 132,
    rows: options.rows ?? 32,
  });

  let output = "";
  let pendingLogWrite = Promise.resolve();
  const appendLog = (chunk: string) => {
    output += chunk;
    pendingLogWrite = pendingLogWrite
      .then(() => appendFile(options.logPath, chunk, "utf8"))
      .catch(() => undefined);
  };

  const abort = () => terminatePtyProcessTree(terminal);
  if (options.signal?.aborted) {
    abort();
  } else {
    options.signal?.addEventListener("abort", abort, { once: true });
  }

  terminal.onData(appendLog);

  try {
    const rawExitCode = await new Promise<number>((resolve) => {
      terminal.onExit(({ exitCode }) => resolve(exitCode ?? 1));
    });
    await pendingLogWrite;
    return {
      exitCode: options.signal?.aborted ? 130 : rawExitCode,
      output,
    };
  } finally {
    options.signal?.removeEventListener("abort", abort);
    try {
      terminal.kill();
    } catch {
      // Already closed.
    }
  }
}

function terminatePtyProcessTree(terminal: pty.IPty): void {
  if (process.platform === "win32") {
    const killer = spawn("taskkill.exe", ["/PID", String(terminal.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    killer.on("error", () => terminal.kill());
    return;
  }

  terminal.kill();
}
