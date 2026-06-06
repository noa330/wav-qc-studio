import type { ViewportSelection } from "./waveform-types";

export function createWavePath(peaks: number[], x: number, y: number, width: number, height: number): string {
  return createEnvelopePath(peaks.map((peak) => -peak), peaks, x, y, width, height);
}

export function createEnvelopePath(minPeaks: number[], maxPeaks: number[], x: number, y: number, width: number, height: number): string {
  const pointCount = Math.min(minPeaks.length, maxPeaks.length);
  if (pointCount === 0) {
    return "";
  }

  const centerY = y + height / 2;
  const maxHalf = Math.max(2, height / 2);
  const step = pointCount > 1 ? width / (pointCount - 1) : width;
  const topPoints = maxPeaks.slice(0, pointCount).map((peak, index) => {
    const px = Math.min(x + width, x + index * step);
    const py = centerY - clamp(peak, -1, 1) * maxHalf;
    return `${px.toFixed(3)} ${py.toFixed(3)}`;
  });
  const bottomPoints = minPeaks
    .slice(0, pointCount)
    .map((peak, index) => {
      const px = Math.min(x + width, x + index * step);
      const py = centerY - clamp(peak, -1, 1) * maxHalf;
      return `${px.toFixed(3)} ${py.toFixed(3)}`;
    })
    .reverse();

  return `M ${topPoints.join(" L ")} L ${bottomPoints.join(" L ")} Z`;
}

export function createSamplePath(samples: number[], x: number, y: number, width: number, height: number): string {
  if (samples.length === 0) {
    return "";
  }

  const centerY = y + height / 2;
  const maxHalf = Math.max(2, height / 2);
  const step = samples.length > 1 ? width / (samples.length - 1) : width;
  const points = samples.map((sample, index) => {
    const px = Math.min(x + width, x + index * step);
    const py = centerY - clamp(sample, -1, 1) * maxHalf;
    return `${px.toFixed(3)} ${py.toFixed(3)}`;
  });

  return `M ${points.join(" L ")}`;
}

export function normalizeSelection(start: number | undefined, end: number | undefined, viewStart: number, viewEnd: number): ViewportSelection | null {
  if (start === undefined || end === undefined || end <= start) {
    return null;
  }

  if (end < viewStart || start > viewEnd) {
    return null;
  }

  const x = progressToViewportX(Math.max(start, viewStart), viewStart, viewEnd);
  const right = progressToViewportX(Math.min(end, viewEnd), viewStart, viewEnd);
  if (x === null || right === null || right <= x) {
    return null;
  }

  return { x, width: right - x };
}

export function progressToViewportX(progress: number | undefined, viewStart: number, viewEnd: number): number | null {
  if (progress === undefined || progress < viewStart || progress > viewEnd) {
    return null;
  }

  const span = Math.max(0.0000001, viewEnd - viewStart);
  return clamp(((progress - viewStart) / span) * 100, 0, 100);
}

export function clientXToProgress(clientX: number, rect: DOMRect, viewStart: number, viewEnd: number): number {
  const viewportRatio = rect.width > 0 ? clamp((clientX - rect.left) / rect.width, 0, 1) : 0;
  return clamp(viewStart + viewportRatio * (viewEnd - viewStart), 0, 1);
}

export function resamplePeaks(source: number[], start: number, end: number, targetCount: number): number[] {
  if (source.length === 0 || targetCount <= 0) {
    return [];
  }

  const result = new Array<number>(Math.max(16, targetCount));
  const startIndex = clamp(start, 0, 1) * (source.length - 1);
  const endIndex = clamp(end, start + 0.0000001, 1) * (source.length - 1);
  const span = Math.max(1, endIndex - startIndex);

  for (let index = 0; index < result.length; index += 1) {
    const ratio = result.length === 1 ? 0 : index / (result.length - 1);
    const sourceIndex = startIndex + ratio * span;
    const lower = Math.floor(sourceIndex);
    const upper = Math.min(source.length - 1, lower + 1);
    const t = sourceIndex - lower;
    result[index] = source[lower] * (1 - t) + source[upper] * t;
  }

  return result;
}

export function formatTime(seconds: number): string {
  const safeSeconds = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const totalSeconds = Math.floor(safeSeconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export function areSelectionsNearlyEqual(left: ViewportSelection, right: ViewportSelection): boolean {
  return Math.abs(left.x - right.x) <= 0.04 && Math.abs(left.width - right.width) <= 0.04;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
