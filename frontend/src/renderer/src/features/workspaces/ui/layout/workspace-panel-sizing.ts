export const cardCollapsedSize = 56;
export const cardCollapseSnapMultiplier = 4;
export const cardCollapseSnapSize = cardCollapsedSize * cardCollapseSnapMultiplier;
export const cardCollapseRenderTolerance = 8;
export const cardCollapseRenderSize = cardCollapsedSize + cardCollapseRenderTolerance;
export const workspaceSplitterSize = 14;

export function shouldRenderAdaptiveCollapse(size: number): boolean {
  return size > 0 && size <= cardCollapseRenderSize;
}

export function shouldUseAdaptiveCollapse(size: number): boolean {
  return shouldRenderAdaptiveCollapse(size);
}

export function getInlinePanelStackSwitchSize(
  panelCount: number,
  splitterCount = Math.max(0, panelCount - 1),
  smallestPanelRatio = 1 / Math.max(1, panelCount),
): number {
  const safeSmallestPanelRatio = Math.min(1, Math.max(0.01, smallestPanelRatio));
  return cardCollapseSnapSize / safeSmallestPanelRatio + workspaceSplitterSize * splitterCount;
}

export function clampResizablePanelSize(value: number, min: number, max: number): number {
  const safeMax = Math.max(min, max);
  return Math.min(safeMax, Math.max(min, Math.round(value)));
}

export function snapResizablePanelSize(value: number, min: number, max: number): number {
  const safeMax = Math.max(min, max);
  const next = clampResizablePanelSize(value, min, safeMax);
  return next <= Math.min(cardCollapseSnapSize, safeMax) ? min : next;
}
