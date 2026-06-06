import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { WaveformData, WaveformReadOptions } from "@shared/ipc";

const MAX_BUCKETS = 4096;
const MIN_BUCKETS = 16;
const MAX_SAMPLED_FRAMES_PER_BUCKET = 4096;
const MAX_SAMPLE_LINE_FRAMES = 8192;
const MAX_WAVEFORM_CACHE_ENTRIES = 96;
const MAX_BUFFER_CACHE_ENTRIES = 2;
const MAX_CACHED_BUFFER_BYTES = 512 * 1024 * 1024;

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

type NormalizedWaveformReadOptions = {
  bucketCount: number;
  viewStart: number;
  viewEnd: number;
};

const waveformCache = new Map<string, WaveformData>();
const waveformBufferCache = new Map<string, Buffer>();

export async function readWaveformData(path: string, options?: number | WaveformReadOptions): Promise<WaveformData> {
  const request = normalizeReadOptions(options);
  if (!path || !existsSync(path)) {
    return { path, durationSeconds: 0, peaks: [], error: "Audio file not found." };
  }

  const fileStat = statSync(path);
  const fileKey = `${path}::${fileStat.size}::${fileStat.mtimeMs}`;
  const cacheKey = `${fileKey}::${request.bucketCount}::${request.viewStart.toFixed(8)}::${request.viewEnd.toFixed(8)}`;
  const cached = getCachedValue(waveformCache, cacheKey);
  if (cached) {
    return cached;
  }

  try {
    const buffer = await readWaveBuffer(fileKey, path, fileStat.size);
    const format = parseWaveFormat(buffer);
    if (!format) {
      return { path, durationSeconds: 0, peaks: [], error: "Unsupported WAV file." };
    }

    const result = buildWaveformData(path, buffer, format, request);
    setCachedValue(waveformCache, cacheKey, result, MAX_WAVEFORM_CACHE_ENTRIES);
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

async function readWaveBuffer(cacheKey: string, path: string, fileSize: number): Promise<Buffer> {
  const cached = getCachedValue(waveformBufferCache, cacheKey);
  if (cached) {
    return cached;
  }

  const buffer = await readFile(path);
  if (fileSize <= MAX_CACHED_BUFFER_BYTES) {
    setCachedValue(waveformBufferCache, cacheKey, buffer, MAX_BUFFER_CACHE_ENTRIES);
  }
  return buffer;
}

function buildWaveformData(path: string, buffer: Buffer, format: WaveFormat, request: NormalizedWaveformReadOptions): WaveformData {
  const totalFrames = Math.floor(format.dataSize / format.blockAlign);
  const durationSeconds = totalFrames / format.sampleRate;
  if (totalFrames <= 0 || !Number.isFinite(durationSeconds)) {
    return { path, durationSeconds: 0, peaks: [] };
  }

  const startFrame = clampInt(Math.floor(request.viewStart * totalFrames), 0, Math.max(0, totalFrames - 1));
  const endFrame = clampInt(Math.ceil(request.viewEnd * totalFrames), startFrame + 1, totalFrames);
  const visibleFrames = endFrame - startFrame;
  const common = {
    path,
    durationSeconds,
    sampleRate: format.sampleRate,
    viewStart: startFrame / totalFrames,
    viewEnd: endFrame / totalFrames,
  };

  if (visibleFrames <= MAX_SAMPLE_LINE_FRAMES) {
    const samples = buildSamples(buffer, format, startFrame, endFrame);
    return {
      ...common,
      peaks: samples.map((sample) => Math.abs(sample)),
      samples,
      mode: "samples",
    };
  }

  const { minPeaks, maxPeaks } = buildEnvelope(buffer, format, startFrame, endFrame, request.bucketCount);
  return {
    ...common,
    peaks: maxPeaks.map((maxPeak, index) => Math.max(Math.abs(minPeaks[index]), Math.abs(maxPeak))),
    minPeaks,
    maxPeaks,
    mode: "envelope",
  };
}

function buildSamples(buffer: Buffer, format: WaveFormat, startFrame: number, endFrame: number): number[] {
  const samples = new Array<number>(Math.max(0, endFrame - startFrame));
  for (let frame = startFrame; frame < endFrame; frame += 1) {
    samples[frame - startFrame] = readFrameValue(buffer, format.dataOffset + frame * format.blockAlign, format);
  }
  return samples;
}

function buildEnvelope(buffer: Buffer, format: WaveFormat, startFrame: number, endFrame: number, bucketCount: number): { minPeaks: number[]; maxPeaks: number[] } {
  const visibleFrames = Math.max(1, endFrame - startFrame);
  const safeBucketCount = Math.min(bucketCount, visibleFrames);
  const minPeaks = new Array<number>(safeBucketCount).fill(0);
  const maxPeaks = new Array<number>(safeBucketCount).fill(0);

  for (let bucket = 0; bucket < safeBucketCount; bucket += 1) {
    const bucketStartFrame = startFrame + Math.floor((bucket * visibleFrames) / safeBucketCount);
    const bucketEndFrame = bucket === safeBucketCount - 1 ? endFrame : startFrame + Math.floor(((bucket + 1) * visibleFrames) / safeBucketCount);
    const framesInBucket = Math.max(1, bucketEndFrame - bucketStartFrame);
    const sampleCount = Math.min(framesInBucket, MAX_SAMPLED_FRAMES_PER_BUCKET);
    const stride = Math.max(1, Math.floor(framesInBucket / sampleCount));
    let minPeak = 0;
    let maxPeak = 0;

    for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
      const frameIndex = Math.min(bucketEndFrame - 1, bucketStartFrame + sampleIndex * stride);
      const frameOffset = format.dataOffset + frameIndex * format.blockAlign;
      if (frameOffset < format.dataOffset || frameOffset + format.blockAlign > format.dataOffset + format.dataSize || frameOffset + format.blockAlign > buffer.length) {
        break;
      }

      const sample = readFrameValue(buffer, frameOffset, format);
      minPeak = Math.min(minPeak, sample);
      maxPeak = Math.max(maxPeak, sample);
    }

    minPeaks[bucket] = minPeak;
    maxPeaks[bucket] = maxPeak;
  }

  return { minPeaks, maxPeaks };
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

function readFrameValue(buffer: Buffer, frameOffset: number, format: WaveFormat): number {
  const bytesPerSample = Math.max(1, Math.ceil(format.bitsPerSample / 8));
  let strongestSample = 0;
  for (let channel = 0; channel < format.channels; channel += 1) {
    const sampleOffset = frameOffset + channel * bytesPerSample;
    if (sampleOffset + bytesPerSample > buffer.length) {
      break;
    }

    const sample = readSample(buffer, sampleOffset, format.effectiveAudioFormat, format.bitsPerSample);
    if (Math.abs(sample) > Math.abs(strongestSample)) {
      strongestSample = sample;
    }
  }

  return Number.isFinite(strongestSample) ? clamp(strongestSample, -1, 1) : 0;
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

function normalizeReadOptions(options?: number | WaveformReadOptions): NormalizedWaveformReadOptions {
  const raw = typeof options === "number" ? { bucketCount: options } : options;
  const bucketCount = clampInt(raw?.bucketCount ?? 720, MIN_BUCKETS, MAX_BUCKETS);
  const viewStart = clamp(raw?.viewStart ?? 0, 0, 1);
  const viewEnd = clamp(raw?.viewEnd ?? 1, viewStart, 1);
  return {
    bucketCount,
    viewStart,
    viewEnd: viewEnd > viewStart ? viewEnd : Math.min(1, viewStart + Number.EPSILON),
  };
}

function getCachedValue<T>(cache: Map<string, T>, key: string): T | undefined {
  const value = cache.get(key);
  if (value === undefined) {
    return undefined;
  }

  cache.delete(key);
  cache.set(key, value);
  return value;
}

function setCachedValue<T>(cache: Map<string, T>, key: string, value: T, maxEntries: number): void {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > maxEntries) {
    const oldestKey = cache.keys().next().value;
    if (typeof oldestKey !== "string") {
      break;
    }
    cache.delete(oldestKey);
  }
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
