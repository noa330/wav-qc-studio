import { cardCollapseSnapSize, cardCollapsedSize, workspaceSplitterSize } from "./workspace-panel-sizing";
import { getDefaultPanelStackSizing } from "./workspace-card-overflow";
import type { WorkspacePanelItem, WorkspacePanelStackSizing, WorkspaceResizeAxis } from "./workspace-layout-types";

export type ResolvedStackSizing = Required<Pick<WorkspacePanelStackSizing, "mode" | "minSize" | "flex">> & {
  preferredSize?: number;
  maxSize?: number;
};

type ResizeState = {
  resizing: boolean;
  axis?: WorkspaceResizeAxis;
};

const sizeEpsilon = 0.0001;

export const defaultResolvedStackSizing: ResolvedStackSizing = {
  mode: "fill",
  minSize: cardCollapsedSize,
  flex: 1,
};

export function shouldFreezeAutoRowMeasurement({
  hasManualRows,
  resizeState,
  width,
  measuredWidth,
}: {
  hasManualRows: boolean;
  resizeState: ResizeState;
  width: number;
  measuredWidth: number;
}): boolean {
  if (hasManualRows) {
    return false;
  }

  const widthResizeActive = resizeState.resizing && resizeState.axis === "width";
  const widthContractedSinceLastMeasurement = measuredWidth > 0 && width > 0 && width < measuredWidth - 1;
  return widthResizeActive || widthContractedSinceLastMeasurement || isWithinWidthCollapseSnapRange(width);
}

function isWithinWidthCollapseSnapRange(width: number): boolean {
  return width > 0 && width <= cardCollapseSnapSize;
}

export function mergeRenderedRowSizes(
  items: WorkspacePanelItem[],
  policies: ResolvedStackSizing[],
  currentSizes: Record<string, number>,
  renderedSizes: number[],
): Record<string, number> {
  return {
    ...currentSizes,
    ...Object.fromEntries(
      items.map((item, index) => [item.panel.id, Math.round(renderedSizes[index] ?? resolveMinStackSize(policies[index] ?? defaultResolvedStackSizing))]),
    ),
  };
}

export function resolveStackRowTracks(
  items: WorkspacePanelItem[],
  policies: ResolvedStackSizing[],
  options: {
    resolvedRowSizes?: number[];
    preservedRowSizes: Record<string, number>;
    usePreservedRows: boolean;
  },
): string[] {
  if (options.usePreservedRows) {
    return policies.map((policy, index) => {
      const item = items[index];
      const preservedSize = item ? options.preservedRowSizes[item.panel.id] ?? 0 : 0;
      return preservedSize > 0 ? resolvePixelStackTrack(preservedSize) : resolveIntrinsicStackTrack(policy);
    });
  }

  if (options.resolvedRowSizes) {
    return options.resolvedRowSizes.map(resolvePixelStackTrack);
  }

  return policies.map(resolveIntrinsicStackTrack);
}

export function buildStackGridTemplateRows(rowTracks: string[], itemCount: number): string {
  return rowTracks
    .flatMap((track, index) => (index < itemCount - 1 ? [track, `${workspaceSplitterSize}px`] : [track]))
    .join(" ");
}

function resolvePixelStackTrack(size: number): string {
  return `minmax(0, ${Math.max(cardCollapsedSize, Math.round(size))}px)`;
}

export function resolvePanelStackSizing(item: WorkspacePanelItem): ResolvedStackSizing {
  const defaults = getDefaultPanelStackSizing(item.panel, item.detail);
  const sizing = { ...defaults, ...item.stackSizing };
  return {
    mode: sizing.mode ?? "fill",
    minSize: sizing.minSize ?? cardCollapsedSize,
    preferredSize: sizing.preferredSize,
    maxSize: sizing.maxSize ?? undefined,
    flex: sizing.flex ?? item.defaultRatio ?? 1,
  };
}

export function resolveManualStackRowSizes(
  items: WorkspacePanelItem[],
  policies: ResolvedStackSizing[],
  manualSizes: Record<string, number>,
  availableHeight: number,
): number[] {
  if (items.length === 0) {
    return [];
  }

  const minimumTotal = policies.reduce((total, policy) => total + resolveMinStackSize(policy), 0);
  const safeAvailableHeight = Math.max(minimumTotal, availableHeight || minimumTotal);
  return fitStackSizesToAvailable(
    items.map((item, index) => manualSizes[item.panel.id] ?? resolvePreferredStackSize(policies[index] ?? defaultResolvedStackSizing)),
    policies,
    safeAvailableHeight,
    true,
  );
}

export function resolveAutomaticStackRowSizes(policies: ResolvedStackSizing[], availableHeight: number): number[] | undefined {
  if (policies.length === 0) {
    return [];
  }

  const minimumTotal = policies.reduce((total, policy) => total + resolveMinStackSize(policy), 0);
  if (availableHeight <= 0) {
    return undefined;
  }

  return fitStackSizesToAvailable(
    policies.map((policy) => resolvePreferredStackSize(policy)),
    policies,
    Math.max(minimumTotal, availableHeight),
    false,
  );
}

export function usesExplicitFillStackSizing(policies: ResolvedStackSizing[]): boolean {
  return policies.some((policy) => policy.mode === "fill" && policy.preferredSize !== undefined);
}

export function resolvePreferredStackSize(policy: ResolvedStackSizing): number {
  const preferred = policy.preferredSize ?? resolveMinStackSize(policy);
  return clampStackSize(preferred, policy, Number.POSITIVE_INFINITY);
}

function resolveIntrinsicStackTrack(policy: ResolvedStackSizing): string {
  const minimum = resolveMinStackSize(policy);
  if (policy.mode === "content") {
    const maximum = policy.maxSize && Number.isFinite(policy.maxSize) ? Math.max(minimum, Math.round(policy.maxSize)) : undefined;
    return maximum ? `fit-content(${maximum}px)` : `minmax(${minimum}px, max-content)`;
  }
  return `minmax(${minimum}px, ${Math.max(sizeEpsilon, policy.flex)}fr)`;
}

function fitStackSizesToAvailable(sizes: number[], policies: ResolvedStackSizing[], availableHeight: number, preserveRelativeExtra: boolean): number[] {
  const next = sizes.map((size, index) => clampStackSize(size, policies[index] ?? defaultResolvedStackSizing, availableHeight));
  const minimums = policies.map(resolveMinStackSize);
  const minimumTotal = minimums.reduce((total, value) => total + value, 0);
  const safeAvailableHeight = Math.max(minimumTotal, availableHeight);
  let total = next.reduce((sum, value) => sum + value, 0);

  if (total > safeAvailableHeight) {
    let overflow = total - safeAvailableHeight;
    while (overflow > 0.5) {
      const shrinkable = next.map((size, index) => Math.max(0, size - minimums[index])).reduce((sum, value) => sum + value, 0);
      if (shrinkable <= 0) {
        break;
      }
      next.forEach((size, index) => {
        const room = Math.max(0, size - minimums[index]);
        const delta = Math.min(room, overflow * (room / shrinkable));
        next[index] -= delta;
      });
      const newTotal = next.reduce((sum, value) => sum + value, 0);
      if (Math.abs(total - newTotal) < 0.5) {
        break;
      }
      total = newTotal;
      overflow = total - safeAvailableHeight;
    }
    return next;
  }

  const fillIndexes = policies.map((policy, index) => (policy.mode === "fill" ? index : -1)).filter((index) => index >= 0);
  if (fillIndexes.length === 0) {
    return preserveRelativeExtra ? distributeExtraToAll(next, safeAvailableHeight, minimums) : next;
  }

  const extra = safeAvailableHeight - total;
  const growIndexes = fillIndexes.filter((index) => (policies[index]?.flex ?? 1) > 0);
  if (growIndexes.length > 0) {
    return distributeExtraWithinMax(next, policies, growIndexes, extra);
  }

  return preserveRelativeExtra ? distributeExtraToAll(next, safeAvailableHeight, minimums) : next;
}

function distributeExtraWithinMax(sizes: number[], policies: ResolvedStackSizing[], growIndexes: number[], extra: number): number[] {
  const next = [...sizes];
  let remaining = extra;
  let activeIndexes = growIndexes.filter((index) => getStackSizeGrowthCapacity(next[index], policies[index] ?? defaultResolvedStackSizing) > 0.5);

  while (remaining > 0.5 && activeIndexes.length > 0) {
    const totalFlex = activeIndexes.reduce((sum, index) => sum + Math.max(sizeEpsilon, policies[index]?.flex ?? 1), 0) || 1;
    let used = 0;

    activeIndexes.forEach((index) => {
      const policy = policies[index] ?? defaultResolvedStackSizing;
      const capacity = getStackSizeGrowthCapacity(next[index], policy);
      const share = remaining * (Math.max(sizeEpsilon, policy.flex) / totalFlex);
      const delta = Math.min(capacity, share);
      next[index] += delta;
      used += delta;
    });

    if (used <= 0.5) {
      break;
    }

    remaining -= used;
    activeIndexes = activeIndexes.filter((index) => getStackSizeGrowthCapacity(next[index], policies[index] ?? defaultResolvedStackSizing) > 0.5);
  }

  return next;
}

function getStackSizeGrowthCapacity(size: number, policy: ResolvedStackSizing): number {
  const maximum = policy.maxSize && Number.isFinite(policy.maxSize) ? Math.max(resolveMinStackSize(policy), policy.maxSize) : Number.POSITIVE_INFINITY;
  return Math.max(0, maximum - size);
}

function distributeExtraToAll(sizes: number[], availableHeight: number, minimums: number[]): number[] {
  const total = sizes.reduce((sum, value) => sum + value, 0);
  const extra = availableHeight - total;
  if (extra <= 0) {
    return sizes;
  }
  const growBase = sizes.map((size, index) => Math.max(sizeEpsilon, size - minimums[index]));
  const growTotal = growBase.reduce((sum, value) => sum + value, 0) || 1;
  return sizes.map((size, index) => size + extra * (growBase[index] / growTotal));
}

export function resolveMinStackSize(policy: ResolvedStackSizing): number {
  return Math.max(cardCollapsedSize, policy.minSize ?? cardCollapsedSize);
}

function clampStackSize(value: number, policy: ResolvedStackSizing, availableHeight: number): number {
  const minimum = resolveMinStackSize(policy);
  const maximum = Math.max(minimum, Math.min(policy.maxSize ?? Number.POSITIVE_INFINITY, availableHeight));
  return Math.min(maximum, Math.max(minimum, value));
}

export function constrainPairPixels(first: number, second: number, rawDelta: number, minimumSize: number = cardCollapsedSize): [number, number] {
  const pairTotal = Math.max(1, first + second);
  const pairMinimum = Math.min(minimumSize, pairTotal / 2);
  const minimumDelta = pairMinimum - first;
  const maximumDelta = second - pairMinimum;
  const delta = clampNumber(rawDelta, minimumDelta, maximumDelta);
  const nextFirst = first + delta;
  return snapPairPixels(nextFirst, pairTotal, pairMinimum, {
    firstStartedCollapsed: first <= pairMinimum + 1,
    secondStartedCollapsed: second <= pairMinimum + 1,
    firstIsShrinking: delta < 0,
    secondIsShrinking: delta > 0,
  });
}

function snapPairPixels(
  first: number,
  pairTotal: number,
  pairMinimum: number,
  direction: { firstStartedCollapsed: boolean; secondStartedCollapsed: boolean; firstIsShrinking: boolean; secondIsShrinking: boolean },
): [number, number] {
  const second = pairTotal - first;
  if (pairTotal <= pairMinimum * 2) {
    return [pairMinimum, second];
  }

  const firstNeedsSnap = first <= cardCollapseSnapSize && direction.firstIsShrinking && !direction.firstStartedCollapsed;
  const secondNeedsSnap = second <= cardCollapseSnapSize && direction.secondIsShrinking && !direction.secondStartedCollapsed;
  const firstShouldStayCollapsed = first <= cardCollapseSnapSize && direction.firstStartedCollapsed && !direction.firstIsShrinking;
  const secondShouldStayCollapsed = second <= cardCollapseSnapSize && direction.secondStartedCollapsed && !direction.secondIsShrinking;
  if (firstShouldStayCollapsed && secondShouldStayCollapsed) {
    return first <= second ? [pairMinimum, pairTotal - pairMinimum] : [pairTotal - pairMinimum, pairMinimum];
  }
  if (firstShouldStayCollapsed) {
    return [pairMinimum, pairTotal - pairMinimum];
  }
  if (secondShouldStayCollapsed) {
    return [pairTotal - pairMinimum, pairMinimum];
  }
  if (firstNeedsSnap && secondNeedsSnap) {
    return first <= second ? [pairMinimum, pairTotal - pairMinimum] : [pairTotal - pairMinimum, pairMinimum];
  }
  if (firstNeedsSnap) {
    return [pairMinimum, pairTotal - pairMinimum];
  }
  if (secondNeedsSnap) {
    return [pairTotal - pairMinimum, pairMinimum];
  }

  return [first, second];
}

export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
