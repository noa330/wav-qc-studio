import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { copyFile, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import type { AudioCropRequest, AudioCropResult, AudioEditRequest, AudioEditResult } from "@shared/ipc";

type CropWaveFormat = {
  fmtChunk: Buffer;
  audioFormat: number;
  bitsPerSample: number;
  channels: number;
  blockAlign: number;
  sampleRate: number;
  dataOffset: number;
  dataSize: number;
};

export type WaveMuteInterval = {
  start: number;
  end: number;
};

export async function cropWaveFileWithBackup(request: AudioCropRequest): Promise<AudioCropResult> {
  const sourcePath = request.sourcePath.trim();
  let tempPath = "";

  if (!sourcePath || !existsSync(sourcePath)) {
    return { ok: false, sourcePath, error: "오디오 파일을 찾을 수 없습니다." };
  }

  try {
    const buffer = await readFile(sourcePath);
    const format = parseCropWaveFormat(buffer);
    if (!format) {
      return { ok: false, sourcePath, error: "지원하지 않는 WAV 파일입니다." };
    }

    const startRatio = clamp(request.startRatio, 0, 1);
    const endRatio = clamp(request.endRatio, startRatio + 0.01, 1);
    const cropped = buildCroppedWave(buffer, format, startRatio, endRatio);
    if (!cropped) {
      return { ok: false, sourcePath, error: "선택 구간을 WAV 데이터로 변환할 수 없습니다." };
    }

    const sourceDirectory = dirname(sourcePath);
    tempPath = join(sourceDirectory, `${basename(sourcePath, extname(sourcePath))}.${Date.now()}.crop.tmp.wav`);
    await writeFile(tempPath, cropped.buffer);

    const backupDirectory = join(sourceDirectory, "_audio_crop_backup");
    await mkdir(backupDirectory, { recursive: true });
    const backupPath = resolveBackupPath(backupDirectory, sourcePath);
    await copyFile(sourcePath, backupPath);
    await copyFile(tempPath, sourcePath);
    await unlink(tempPath).catch(() => undefined);

    return {
      ok: true,
      sourcePath,
      backupPath,
      durationSeconds: cropped.durationSeconds,
    };
  } catch (error) {
    if (tempPath) {
      await unlink(tempPath).catch(() => undefined);
    }

    return {
      ok: false,
      sourcePath,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function cropWaveFileToPath(sourcePath: string, targetPath: string, startSec: number, endSec: number): Promise<{ durationSeconds: number }> {
  if (!sourcePath.trim() || !existsSync(sourcePath)) {
    throw new Error("Audio file was not found.");
  }

  const buffer = await readFile(sourcePath);
  const format = parseCropWaveFormat(buffer);
  if (!format) {
    throw new Error("Unsupported WAV file.");
  }

  const totalFrames = Math.floor(format.dataSize / format.blockAlign);
  const durationSeconds = totalFrames / format.sampleRate;
  const startRatio = durationSeconds > 0 ? clamp(startSec / durationSeconds, 0, 1) : 0;
  const endRatio = durationSeconds > 0 ? clamp(endSec / durationSeconds, startRatio + 0.000001, 1) : 1;
  const cropped = buildCroppedWave(buffer, format, startRatio, endRatio);
  if (!cropped) {
    throw new Error("Selected range could not be converted to WAV data.");
  }

  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, cropped.buffer);
  return { durationSeconds: cropped.durationSeconds };
}


export async function editWaveFileInCache(request: AudioEditRequest): Promise<AudioEditResult> {
  const sourcePath = request.sourcePath.trim();

  if (!sourcePath || !existsSync(sourcePath)) {
    return { ok: false, sourcePath, error: "오디오 파일을 찾을 수 없습니다." };
  }

  try {
    const sourceBuffer = await readFile(sourcePath);
    const sourceFormat = parseCropWaveFormat(sourceBuffer);
    if (!sourceFormat) {
      return { ok: false, sourcePath, error: "지원하지 않는 WAV 파일입니다." };
    }

    const totalFrames = Math.floor(sourceFormat.dataSize / sourceFormat.blockAlign);
    const range = secondsToFrameRange(sourceFormat, request.startSec, request.endSec);
    if (range.endFrame <= range.startFrame) {
      return { ok: false, sourcePath, error: "선택 구간이 올바르지 않습니다." };
    }

    let clipboardPath: string | undefined;
    let clipboardDurationSeconds: number | undefined;
    let output: { buffer: Buffer; durationSeconds: number } | null = null;

    if (request.operation === "cut" || request.operation === "copy") {
      const cropped = buildWaveFromFrameRanges(sourceBuffer, sourceFormat, [[range.startFrame, range.endFrame]]);
      if (!cropped) {
        return { ok: false, sourcePath, error: request.operation === "copy" ? "복사할 구간을 만들 수 없습니다." : "잘라낸 구간을 만들 수 없습니다." };
      }

      clipboardPath = await writeAudioEditCacheFile(sourcePath, "clipboard", cropped.buffer);
      clipboardDurationSeconds = cropped.durationSeconds;
      if (request.operation === "copy") {
        return {
          ok: true,
          sourcePath,
          clipboardPath,
          durationSeconds: totalFrames > 0 ? totalFrames / sourceFormat.sampleRate : 0,
          clipboardDurationSeconds,
        };
      }

      output = buildWaveFromFrameRanges(sourceBuffer, sourceFormat, [[0, range.startFrame], [range.endFrame, totalFrames]]);
    } else if (request.operation === "delete") {
      output = buildWaveFromFrameRanges(sourceBuffer, sourceFormat, [[0, range.startFrame], [range.endFrame, totalFrames]]);
    } else if (request.operation === "keep") {
      output = buildWaveFromFrameRanges(sourceBuffer, sourceFormat, [[range.startFrame, range.endFrame]]);
    } else if (request.operation === "paste") {
      const clipboardSourcePath = request.clipboardPath?.trim() ?? "";
      if (!clipboardSourcePath || !existsSync(clipboardSourcePath)) {
        return { ok: false, sourcePath, error: "붙여넣을 오디오 구간이 없습니다." };
      }

      const clipboardBuffer = await readFile(clipboardSourcePath);
      const clipboardFormat = parseCropWaveFormat(clipboardBuffer);
      if (!clipboardFormat || !sameEditableWaveFormat(sourceFormat, clipboardFormat)) {
        return { ok: false, sourcePath, error: "붙여넣을 구간의 WAV 포맷이 현재 오디오와 다릅니다." };
      }

      output = buildWaveWithInsertedBuffer(sourceBuffer, sourceFormat, range.startFrame, range.endFrame, clipboardBuffer, clipboardFormat);
      clipboardPath = clipboardSourcePath;
      clipboardDurationSeconds = audioDurationSeconds(clipboardFormat);
    }

    if (!output) {
      return { ok: false, sourcePath, error: "오디오 편집 결과를 만들 수 없습니다." };
    }

    const outputPath = await writeAudioEditCacheFile(sourcePath, request.operation, output.buffer);
    return {
      ok: true,
      sourcePath,
      outputPath,
      clipboardPath,
      durationSeconds: output.durationSeconds,
      clipboardDurationSeconds,
    };
  } catch (error) {
    return {
      ok: false,
      sourcePath,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function muteWaveFileToPath(sourcePath: string, targetPath: string, intervals: WaveMuteInterval[]): Promise<{ durationSeconds: number; mutedIntervals: number }> {
  if (!sourcePath.trim() || !existsSync(sourcePath)) {
    throw new Error("Audio file was not found.");
  }

  const buffer = await readFile(sourcePath);
  const format = parseCropWaveFormat(buffer);
  if (!format) {
    throw new Error("Unsupported WAV file.");
  }

  const muted = buildMutedWave(buffer, format, intervals);
  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, muted.buffer);
  return {
    durationSeconds: muted.durationSeconds,
    mutedIntervals: muted.mutedIntervals,
  };
}

function parseCropWaveFormat(buffer: Buffer): CropWaveFormat | null {
  if (buffer.length < 12 || readFourCc(buffer, 0) !== "RIFF" || readFourCc(buffer, 8) !== "WAVE") {
    return null;
  }

  let offset = 12;
  let fmtChunk: Buffer | null = null;
  let audioFormat = 0;
  let bitsPerSample = 0;
  let channels = 0;
  let blockAlign = 0;
  let sampleRate = 0;
  let dataOffset = -1;
  let dataSize = 0;

  while (offset + 8 <= buffer.length) {
    const chunkId = readFourCc(buffer, offset);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    const boundedChunkSize = Math.max(0, Math.min(chunkSize, buffer.length - chunkStart));
    const nextOffset = chunkStart + boundedChunkSize + (boundedChunkSize % 2);

    if (chunkId === "fmt " && boundedChunkSize >= 16) {
      fmtChunk = Buffer.from(buffer.subarray(chunkStart, chunkStart + boundedChunkSize));
      audioFormat = buffer.readUInt16LE(chunkStart);
      channels = buffer.readUInt16LE(chunkStart + 2);
      sampleRate = buffer.readUInt32LE(chunkStart + 4);
      blockAlign = buffer.readUInt16LE(chunkStart + 12);
      bitsPerSample = buffer.readUInt16LE(chunkStart + 14);
    } else if (chunkId === "data") {
      dataOffset = chunkStart;
      dataSize = boundedChunkSize;
    }

    offset = nextOffset;
  }

  if (!fmtChunk || channels <= 0 || blockAlign <= 0 || sampleRate <= 0 || dataOffset < 0 || dataSize <= 0) {
    return null;
  }

  return {
    fmtChunk,
    audioFormat,
    bitsPerSample,
    channels,
    blockAlign,
    sampleRate,
    dataOffset,
    dataSize,
  };
}


function secondsToFrameRange(format: CropWaveFormat, startSec: number, endSec: number): { startFrame: number; endFrame: number } {
  const totalFrames = Math.floor(format.dataSize / format.blockAlign);
  const durationSeconds = totalFrames > 0 ? totalFrames / format.sampleRate : 0;
  const safeStartSec = clamp(startSec, 0, durationSeconds);
  const safeEndSec = clamp(endSec, safeStartSec + 0.000001, durationSeconds);
  const startFrame = clampInt(Math.floor(safeStartSec * format.sampleRate), 0, Math.max(0, totalFrames - 1));
  const endFrame = clampInt(Math.ceil(safeEndSec * format.sampleRate), startFrame + 1, totalFrames);
  return { startFrame, endFrame };
}

function audioDurationSeconds(format: CropWaveFormat): number {
  const totalFrames = Math.floor(format.dataSize / format.blockAlign);
  return totalFrames > 0 ? totalFrames / format.sampleRate : 0;
}

function sameEditableWaveFormat(left: CropWaveFormat, right: CropWaveFormat): boolean {
  return left.audioFormat === right.audioFormat && left.bitsPerSample === right.bitsPerSample && left.channels === right.channels && left.blockAlign === right.blockAlign && left.sampleRate === right.sampleRate;
}

function buildWaveWithInsertedBuffer(sourceBuffer: Buffer, sourceFormat: CropWaveFormat, startFrame: number, endFrame: number, insertBuffer: Buffer, insertFormat: CropWaveFormat): { buffer: Buffer; durationSeconds: number } | null {
  const totalFrames = Math.floor(sourceFormat.dataSize / sourceFormat.blockAlign);
  const insertFrames = Math.floor(insertFormat.dataSize / insertFormat.blockAlign);
  const insertAudioStart = insertFormat.dataOffset;
  const insertAudioEnd = insertFormat.dataOffset + insertFrames * insertFormat.blockAlign;
  return buildWaveFromAudioBuffers(sourceFormat, [
    sourceBuffer.subarray(sourceFormat.dataOffset, sourceFormat.dataOffset + startFrame * sourceFormat.blockAlign),
    insertBuffer.subarray(insertAudioStart, insertAudioEnd),
    sourceBuffer.subarray(sourceFormat.dataOffset + endFrame * sourceFormat.blockAlign, sourceFormat.dataOffset + totalFrames * sourceFormat.blockAlign),
  ]);
}

function buildWaveFromFrameRanges(buffer: Buffer, format: CropWaveFormat, ranges: Array<[number, number]>): { buffer: Buffer; durationSeconds: number } | null {
  const totalFrames = Math.floor(format.dataSize / format.blockAlign);
  const audioBuffers = ranges.flatMap(([startFrame, endFrame]) => {
    const safeStart = clampInt(startFrame, 0, totalFrames);
    const safeEnd = clampInt(endFrame, safeStart, totalFrames);
    if (safeEnd <= safeStart) {
      return [];
    }

    const audioStart = format.dataOffset + safeStart * format.blockAlign;
    const audioEnd = format.dataOffset + safeEnd * format.blockAlign;
    return [buffer.subarray(audioStart, audioEnd)];
  });

  return buildWaveFromAudioBuffers(format, audioBuffers);
}

function buildWaveFromAudioBuffers(format: CropWaveFormat, audioBuffers: Buffer[]): { buffer: Buffer; durationSeconds: number } | null {
  const audioBytes = Buffer.concat(audioBuffers.map((item) => Buffer.from(item)));
  const fmtPadding = format.fmtChunk.length % 2;
  const dataPadding = audioBytes.length % 2;
  const riffSize = 4 + (8 + format.fmtChunk.length + fmtPadding) + (8 + audioBytes.length + dataPadding);

  if (riffSize > 0xffffffff) {
    return null;
  }

  const output = Buffer.alloc(8 + riffSize);
  let offset = 0;
  offset += output.write("RIFF", offset, "ascii");
  output.writeUInt32LE(riffSize, offset);
  offset += 4;
  offset += output.write("WAVE", offset, "ascii");
  offset += output.write("fmt ", offset, "ascii");
  output.writeUInt32LE(format.fmtChunk.length, offset);
  offset += 4;
  format.fmtChunk.copy(output, offset);
  offset += format.fmtChunk.length;
  if (fmtPadding) {
    output.writeUInt8(0, offset);
    offset += 1;
  }

  offset += output.write("data", offset, "ascii");
  output.writeUInt32LE(audioBytes.length, offset);
  offset += 4;
  audioBytes.copy(output, offset);
  offset += audioBytes.length;
  if (dataPadding) {
    output.writeUInt8(0, offset);
  }

  const frames = format.blockAlign > 0 ? Math.floor(audioBytes.length / format.blockAlign) : 0;
  return {
    buffer: output,
    durationSeconds: frames > 0 ? frames / format.sampleRate : 0,
  };
}

async function writeAudioEditCacheFile(sourcePath: string, label: string, buffer: Buffer): Promise<string> {
  const cacheRoot = join(tmpdir(), "wav-qc-studio", "audio-edits", createHash("sha1").update(sourcePath.replace(/\\/gu, "/").toLowerCase()).digest("hex").slice(0, 16));
  await mkdir(cacheRoot, { recursive: true });
  const safeLabel = label.replace(/[^a-z0-9_-]+/giu, "_").slice(0, 32) || "edit";
  const outputPath = join(cacheRoot, `${Date.now()}_${process.hrtime.bigint().toString(36)}_${safeLabel}.wav`);
  await writeFile(outputPath, buffer);
  return outputPath;
}

function buildMutedWave(buffer: Buffer, format: CropWaveFormat, intervals: WaveMuteInterval[]): { buffer: Buffer; durationSeconds: number; mutedIntervals: number } {
  const totalFrames = Math.floor(format.dataSize / format.blockAlign);
  const durationSeconds = totalFrames > 0 ? totalFrames / format.sampleRate : 0;
  const output = Buffer.from(buffer);

  const muteRanges = buildMuteRanges(format, intervals);
  for (const [startFrame, endFrame] of muteRanges) {
    muteWaveFrameRange(output, format, startFrame, endFrame);
  }

  return { buffer: output, durationSeconds, mutedIntervals: muteRanges.length };
}

function buildMuteRanges(format: CropWaveFormat, intervals: WaveMuteInterval[]): Array<[number, number]> {
  const totalFrames = Math.floor(format.dataSize / format.blockAlign);
  const durationSeconds = totalFrames > 0 ? totalFrames / format.sampleRate : 0;
  const ranges: Array<[number, number]> = [];

  for (const interval of intervals) {
    const startSec = clamp(interval.start, 0, durationSeconds);
    const endSec = clamp(interval.end, startSec, durationSeconds);
    const rawStart = clampInt(Math.floor(startSec * format.sampleRate), 0, totalFrames);
    const rawEnd = clampInt(Math.ceil(endSec * format.sampleRate), rawStart, totalFrames);
    if (rawEnd <= rawStart) {
      continue;
    }

    ranges.push([rawStart, rawEnd]);
  }

  return ranges;
}

function muteWaveFrameRange(buffer: Buffer, format: CropWaveFormat, startFrame: number, endFrame: number): void {
  const startByte = format.dataOffset + startFrame * format.blockAlign;
  const endByte = format.dataOffset + endFrame * format.blockAlign;

  if (format.audioFormat === 1 && format.bitsPerSample === 8) {
    buffer.fill(0x80, startByte, endByte);
    return;
  }

  buffer.fill(0, startByte, endByte);
}

function buildCroppedWave(buffer: Buffer, format: CropWaveFormat, startRatio: number, endRatio: number): { buffer: Buffer; durationSeconds: number } | null {
  const totalFrames = Math.floor(format.dataSize / format.blockAlign);
  if (totalFrames <= 0) {
    return null;
  }

  const startFrame = clampInt(Math.floor(totalFrames * startRatio), 0, Math.max(0, totalFrames - 1));
  const endFrame = clampInt(Math.ceil(totalFrames * endRatio), startFrame + 1, totalFrames);
  const audioStart = format.dataOffset + startFrame * format.blockAlign;
  const audioEnd = format.dataOffset + endFrame * format.blockAlign;
  const audioBytes = Buffer.from(buffer.subarray(audioStart, audioEnd));
  const fmtPadding = format.fmtChunk.length % 2;
  const dataPadding = audioBytes.length % 2;
  const riffSize = 4 + (8 + format.fmtChunk.length + fmtPadding) + (8 + audioBytes.length + dataPadding);

  if (riffSize > 0xffffffff) {
    return null;
  }

  const output = Buffer.alloc(8 + riffSize);
  let offset = 0;
  offset += output.write("RIFF", offset, "ascii");
  output.writeUInt32LE(riffSize, offset);
  offset += 4;
  offset += output.write("WAVE", offset, "ascii");
  offset += output.write("fmt ", offset, "ascii");
  output.writeUInt32LE(format.fmtChunk.length, offset);
  offset += 4;
  format.fmtChunk.copy(output, offset);
  offset += format.fmtChunk.length;
  if (fmtPadding) {
    output.writeUInt8(0, offset);
    offset += 1;
  }

  offset += output.write("data", offset, "ascii");
  output.writeUInt32LE(audioBytes.length, offset);
  offset += 4;
  audioBytes.copy(output, offset);
  offset += audioBytes.length;
  if (dataPadding) {
    output.writeUInt8(0, offset);
  }

  return {
    buffer: output,
    durationSeconds: (endFrame - startFrame) / format.sampleRate,
  };
}

function resolveBackupPath(backupDirectory: string, sourcePath: string): string {
  const extension = extname(sourcePath) || ".wav";
  const stem = basename(sourcePath, extension);
  const timestamp = new Date().toISOString().replace(/\D/gu, "").slice(0, 14);
  let index = 0;

  while (true) {
    const suffix = index === 0 ? "" : `-${index}`;
    const candidate = join(backupDirectory, `${stem}.${timestamp}${suffix}${extension}`);
    if (!existsSync(candidate)) {
      return candidate;
    }

    index += 1;
  }
}

function readFourCc(buffer: Buffer, offset: number): string {
  return buffer.toString("ascii", offset, offset + 4);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, value));
}

function clampInt(value: number, min: number, max: number): number {
  return Math.trunc(clamp(value, min, max));
}
