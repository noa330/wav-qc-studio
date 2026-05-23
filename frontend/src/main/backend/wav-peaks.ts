import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { WaveformData } from "@shared/ipc";

const MAX_BUCKETS = 4096;
const MIN_BUCKETS = 16;
const MAX_SAMPLED_FRAMES_PER_BUCKET = 4096;

type WaveFormat = {
  audioFormat: number;
  effectiveAudioFormat: number;
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
  blockAlign: number;
  dataOffset: number;
  dataSize: number;
};

const waveformCache = new Map<string, WaveformData>();

export async function readWaveformData(path: string, bucketCount = 720): Promise<WaveformData> {
  const safeBucketCount = clampInt(bucketCount, MIN_BUCKETS, MAX_BUCKETS);
  if (!path || !existsSync(path)) {
    return { path, durationSeconds: 0, peaks: [], error: "오디오 파일을 찾을 수 없습니다." };
  }

  const fileStat = statSync(path);
  const cacheKey = `${path}::${safeBucketCount}::${fileStat.size}::${fileStat.mtimeMs}`;
  const cached = waveformCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    const buffer = await readFile(path);
    const format = parseWaveFormat(buffer);
    if (!format) {
      return { path, durationSeconds: 0, peaks: [], error: "지원하지 않는 WAV 파일입니다." };
    }

    const peaks = buildPeaks(buffer, format, safeBucketCount);
    const durationSeconds = format.dataSize / format.blockAlign / format.sampleRate;
    const result = {
      path,
      durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : 0,
      peaks,
    };
    waveformCache.set(cacheKey, result);
    return result;
  } catch (error) {
    return {
      path,
      durationSeconds: 0,
      peaks: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function parseWaveFormat(buffer: Buffer): WaveFormat | null {
  if (buffer.length < 12) {
    return null;
  }

  const riffId = readFourCc(buffer, 0);
  const isRf64 = riffId === "RF64";
  if (riffId !== "RIFF" && !isRf64) {
    return null;
  }

  if (readFourCc(buffer, 8) !== "WAVE") {
    return null;
  }

  let offset = 12;
  let audioFormat = 0;
  let effectiveAudioFormat = 0;
  let channels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let blockAlign = 0;
  let dataOffset = -1;
  let dataSize = 0;
  let rf64DataSize = 0;

  while (offset + 8 <= buffer.length) {
    const chunkId = readFourCc(buffer, offset);
    const rawChunkSize = buffer.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    const chunkSize = rawChunkSize === 0xffffffff && isRf64 && chunkId === "data" ? rf64DataSize : rawChunkSize;
    const boundedChunkSize = Math.max(0, Math.min(chunkSize, buffer.length - chunkStart));
    const nextOffset = chunkStart + boundedChunkSize + (boundedChunkSize % 2);

    if (chunkId === "ds64" && isRf64 && boundedChunkSize >= 24) {
      rf64DataSize = safeReadUInt64(buffer, chunkStart + 8);
    } else if (chunkId === "fmt " && boundedChunkSize >= 16) {
      audioFormat = buffer.readUInt16LE(chunkStart);
      effectiveAudioFormat = audioFormat;
      channels = buffer.readUInt16LE(chunkStart + 2);
      sampleRate = buffer.readUInt32LE(chunkStart + 4);
      blockAlign = buffer.readUInt16LE(chunkStart + 12);
      bitsPerSample = buffer.readUInt16LE(chunkStart + 14);

      const remaining = boundedChunkSize - 16;
      if (audioFormat === 0xfffe && remaining >= 24) {
        const subFormatTag = buffer.readUInt16LE(chunkStart + 24);
        if (subFormatTag === 0x0001 || subFormatTag === 0x0003) {
          effectiveAudioFormat = subFormatTag;
        }
      }
    } else if (chunkId === "data") {
      dataOffset = chunkStart;
      dataSize = boundedChunkSize;
    }

    offset = nextOffset;
  }

  if (dataOffset < 0 || dataSize <= 0 || channels <= 0 || sampleRate <= 0 || bitsPerSample <= 0 || blockAlign <= 0) {
    return null;
  }

  return {
    audioFormat,
    effectiveAudioFormat,
    channels,
    sampleRate,
    bitsPerSample,
    blockAlign,
    dataOffset,
    dataSize,
  };
}

function buildPeaks(buffer: Buffer, format: WaveFormat, bucketCount: number): number[] {
  const totalFrames = Math.floor(format.dataSize / format.blockAlign);
  if (totalFrames <= 0) {
    return [];
  }

  const peaks = new Array<number>(bucketCount).fill(0);
  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const bucketStartFrame = Math.floor((bucket * totalFrames) / bucketCount);
    const bucketEndFrame = bucket === bucketCount - 1 ? totalFrames : Math.floor(((bucket + 1) * totalFrames) / bucketCount);
    const framesInBucket = Math.max(1, bucketEndFrame - bucketStartFrame);
    const sampleCount = Math.min(framesInBucket, MAX_SAMPLED_FRAMES_PER_BUCKET);
    const stride = Math.max(1, Math.floor(framesInBucket / sampleCount));
    let peak = 0;

    for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
      const frameIndex = Math.min(bucketEndFrame - 1, bucketStartFrame + sampleIndex * stride);
      const frameOffset = format.dataOffset + frameIndex * format.blockAlign;
      if (frameOffset < format.dataOffset || frameOffset + format.blockAlign > format.dataOffset + format.dataSize || frameOffset + format.blockAlign > buffer.length) {
        break;
      }

      peak = Math.max(peak, readFramePeak(buffer, frameOffset, format));
    }

    peaks[bucket] = peak;
  }

  return normalizePeaks(peaks);
}

function readFramePeak(buffer: Buffer, frameOffset: number, format: WaveFormat): number {
  const bytesPerSample = Math.max(1, Math.ceil(format.bitsPerSample / 8));
  let peak = 0;
  for (let channel = 0; channel < format.channels; channel += 1) {
    const sampleOffset = frameOffset + channel * bytesPerSample;
    if (sampleOffset + bytesPerSample > buffer.length) {
      break;
    }

    peak = Math.max(peak, Math.abs(readSample(buffer, sampleOffset, format.effectiveAudioFormat, format.bitsPerSample)));
  }

  return peak;
}

function readSample(buffer: Buffer, offset: number, audioFormat: number, bitsPerSample: number): number {
  if (audioFormat === 1) {
    switch (bitsPerSample) {
      case 8:
        return (buffer.readUInt8(offset) - 128) / 128;
      case 16:
        return buffer.readInt16LE(offset) / 32768;
      case 24:
        return readInt24(buffer, offset) / 8388608;
      case 32:
        return buffer.readInt32LE(offset) / 2147483648;
      default:
        return 0;
    }
  }

  if (audioFormat === 3) {
    if (bitsPerSample === 32) {
      return buffer.readFloatLE(offset);
    }

    if (bitsPerSample === 64) {
      return buffer.readDoubleLE(offset);
    }
  }

  return 0;
}

function normalizePeaks(peaks: number[]): number[] {
  const max = Math.max(...peaks);
  if (!Number.isFinite(max) || max <= 0) {
    return [];
  }

  return peaks.map((peak) => Math.pow(Math.max(0, Math.min(1, peak / max)), 0.82));
}

function readInt24(buffer: Buffer, offset: number): number {
  let value = buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16);
  if ((value & 0x800000) !== 0) {
    value |= 0xff000000;
  }

  return value;
}

function readFourCc(buffer: Buffer, offset: number): string {
  return buffer.toString("ascii", offset, offset + 4);
}

function safeReadUInt64(buffer: Buffer, offset: number): number {
  if (offset + 8 > buffer.length) {
    return 0;
  }

  const value = buffer.readBigUInt64LE(offset);
  return value > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(value);
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.trunc(Math.min(max, Math.max(min, value)));
}
