import { existsSync, readdirSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { AUDIO_INPUT_EXTENSIONS, WAV_AUDIO_EXTENSIONS } from "@shared/ipc";

export function normalizeRunAudioPath(path: string): string {
  return path.trim().replace(/\\/gu, "/").toLowerCase();
}

export function isSupportedAudioPath(path: string): boolean {
  const extension = extname(path).toLowerCase();
  return AUDIO_INPUT_EXTENSIONS.includes(extension as (typeof AUDIO_INPUT_EXTENSIONS)[number]);
}

export function isWavAudioPath(path: string): boolean {
  const extension = extname(path).toLowerCase();
  return WAV_AUDIO_EXTENSIONS.includes(extension as (typeof WAV_AUDIO_EXTENSIONS)[number]);
}

export function findFirstInputAudio(inputPath: string): string {
  if (!inputPath || !existsSync(inputPath)) {
    return "";
  }

  try {
    const stats = statSync(inputPath);
    if (stats.isFile() && isSupportedAudioPath(inputPath)) {
      return inputPath;
    }
    if (!stats.isDirectory()) {
      return "";
    }

    const stack = [inputPath];
    while (stack.length > 0) {
      const folder = stack.shift();
      if (!folder) {
        continue;
      }
      for (const entry of readdirSync(folder, { withFileTypes: true })) {
        const path = join(folder, entry.name);
        if (entry.isFile() && isSupportedAudioPath(path)) {
          return path;
        }
        if (entry.isDirectory()) {
          stack.push(path);
        }
      }
    }
  } catch {
    return "";
  }

  return "";
}
