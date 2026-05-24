import { readFile } from "node:fs/promises";
import type { WorkspaceTerminalUpdate } from "@shared/ipc";

const TERMINAL_SNAPSHOT_CHAR_LIMIT = 60000;

export type RawTerminalSnapshotOptions = {
  primaryLogPath: string;
  fallbackLogPath?: string;
  logPath?: string;
  backendLogPath?: string;
  command?: string;
};

export async function readRawTerminalSnapshot(options: RawTerminalSnapshotOptions): Promise<WorkspaceTerminalUpdate | undefined> {
  const primaryText = await readTextIfExists(options.primaryLogPath);
  const fallbackText = options.fallbackLogPath ? await readTextIfExists(options.fallbackLogPath) : "";
  const text = limitTerminalText(primaryText || fallbackText);
  if (!text.trim()) {
    return undefined;
  }

  return {
    text,
    logPath: options.logPath ?? options.primaryLogPath,
    backendLogPath: options.backendLogPath ?? options.fallbackLogPath ?? options.primaryLogPath,
    command: options.command,
    updatedAt: new Date().toISOString(),
  };
}

export async function readTextIfExists(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

export function limitTerminalText(text: string): string {
  if (text.length <= TERMINAL_SNAPSHOT_CHAR_LIMIT) {
    return text;
  }

  return `... earlier terminal output omitted ...\r\n${text.slice(-TERMINAL_SNAPSHOT_CHAR_LIMIT)}`;
}
