import { existsSync, statSync } from "node:fs";
import type { JsonValue } from "@shared/ipc";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function pathExists(path: string): boolean {
  try {
    return Boolean(path && existsSync(path));
  } catch {
    return false;
  }
}

export function pathIsDirectory(path: string): boolean {
  try {
    return Boolean(path && statSync(path).isDirectory());
  } catch {
    return false;
  }
}

export function toJsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

export function isNotFoundError(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}
