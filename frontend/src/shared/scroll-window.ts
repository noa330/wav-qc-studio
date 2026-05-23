export const SCROLL_WINDOW_BUFFER_SCREENS = 1;

export type ScrollWindowMetrics = {
  visibleCount: number;
  chunkSize: number;
  stepSize: number;
};

export function resolveScrollWindowMetrics({
  viewportExtent,
  itemExtent,
  itemCount,
  bufferScreens = SCROLL_WINDOW_BUFFER_SCREENS,
}: {
  viewportExtent: number;
  itemExtent: number;
  itemCount: number;
  bufferScreens?: number;
}): ScrollWindowMetrics {
  const safeItemExtent = Math.max(1, itemExtent);
  const safeViewportExtent = Math.max(safeItemExtent, viewportExtent);
  const visibleCount = Math.max(1, Math.ceil(safeViewportExtent / safeItemExtent));
  const chunkExtent = safeViewportExtent * Math.max(1, 1 + bufferScreens * 2);
  const chunkSize = Math.min(Math.max(0, itemCount), Math.max(1, Math.ceil(chunkExtent / safeItemExtent)));
  return {
    visibleCount,
    chunkSize,
    stepSize: Math.max(1, visibleCount),
  };
}
