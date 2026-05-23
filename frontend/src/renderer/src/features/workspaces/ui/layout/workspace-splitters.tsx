import { Fragment, createContext, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { resizeHandleLineTransition, resizeHandleLineVariants } from "@/shared/motion";
import type { WorkspaceId } from "@shared/ipc";
import type { WorkspaceRuntime } from "../../state/use-workspace-runtime";
import { cardCollapseSnapSize, cardCollapsedSize, workspaceSplitterSize } from "./workspace-panel-sizing";
import { getDefaultPanelStackSizing, useElementBoxSize } from "./workspace-card-overflow";
import type { PanelAutoCollapseSuppression, PanelCollapseMode, WorkspacePanelItem, WorkspacePanelRenderer, WorkspacePanelStackSizing, WorkspaceResizeAxis } from "./workspace-layout-types";

const resizeHandleClass = "group relative flex items-stretch justify-center";
const sizeEpsilon = 0.0001;

type WorkspaceLayoutResizeState = {
  resizing: boolean;
  axis?: WorkspaceResizeAxis;
  setResizing: (resizing: boolean, axis?: WorkspaceResizeAxis) => void;
};

const WorkspaceLayoutResizeContext = createContext<WorkspaceLayoutResizeState>({
  resizing: false,
  setResizing: () => undefined,
});

export function WorkspaceLayoutResizeProvider({ value, children }: { value: WorkspaceLayoutResizeState; children: ReactNode }) {
  return <WorkspaceLayoutResizeContext.Provider value={value}>{children}</WorkspaceLayoutResizeContext.Provider>;
}

export function useWorkspaceLayoutResizeState(): WorkspaceLayoutResizeState {
  return useContext(WorkspaceLayoutResizeContext);
}

export function PanelResizeHandle({ orientation, onMouseDown }: { orientation: "vertical" | "horizontal"; onMouseDown: (event: ReactMouseEvent<HTMLButtonElement>) => void }) {
  const [active, setActive] = useState(false);

  return (
    <div className={cn(resizeHandleClass, orientation === "vertical" ? "w-[14px] cursor-col-resize" : "h-[14px] cursor-row-resize")}>
      <button
        type="button"
        aria-label={orientation === "vertical" ? "패널 폭 조절" : "패널 높이 조절"}
        onMouseEnter={() => setActive(true)}
        onMouseLeave={() => setActive(false)}
        onFocus={() => setActive(true)}
        onBlur={() => setActive(false)}
        onMouseDown={(event) => {
          event.preventDefault();
          setActive(true);
          onMouseDown(event);
        }}
        className="relative h-full w-full rounded-[3px] outline-none"
      >
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <motion.span
            variants={resizeHandleLineVariants}
            initial="idle"
            animate={active ? "active" : "idle"}
            transition={resizeHandleLineTransition}
            className={cn("rounded-full bg-[var(--accent-blue)]", orientation === "vertical" ? "h-[calc(100%-24px)] w-0.5" : "h-0.5 w-[calc(100%-24px)]")}
          />
        </span>
      </button>
    </div>
  );
}

export function ResizableRows({ storageKey, initialRatio, top, bottom }: { storageKey: string; initialRatio: number; top: ReactNode; bottom: ReactNode }) {
  return <ResizablePair storageKey={storageKey} orientation="horizontal" initialRatio={initialRatio} first={top} second={bottom} />;
}

export function ResizableColumns({ storageKey, initialRatio, left, right }: { storageKey: string; initialRatio: number; left: ReactNode; right: ReactNode }) {
  return <ResizablePair storageKey={storageKey} orientation="vertical" initialRatio={initialRatio} first={left} second={right} />;
}

function ResizablePair({
  storageKey,
  orientation,
  initialRatio,
  first,
  second,
}: {
  storageKey: string;
  orientation: "vertical" | "horizontal";
  initialRatio: number;
  first: ReactNode;
  second: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const { setResizing } = useWorkspaceLayoutResizeState();
  const [ratio, setRatio] = useState(() => clampNumber(initialRatio, 0.05, 0.95));

  useEffect(() => {
    setRatio(clampNumber(initialRatio, 0.05, 0.95));
  }, [storageKey, initialRatio]);

  const resize = (startClient: number) => {
    const root = rootRef.current;
    if (!root) {
      return;
    }

    const rect = rootRef.current?.getBoundingClientRect();
    const totalSize = Math.max(1, (orientation === "vertical" ? rect?.width ?? 1 : rect?.height ?? 1) - workspaceSplitterSize);
    const startFirst = totalSize * ratio;
    const startSecond = totalSize - startFirst;
    let nextRatio = ratio;

    const applyRatio = (value: number) => {
      nextRatio = value;
      root.style.setProperty("--workspace-split-first", `${value}fr`);
      root.style.setProperty("--workspace-split-second", `${1 - value}fr`);
    };

    const handleMove = (event: MouseEvent) => {
      const delta = orientation === "vertical" ? event.clientX - startClient : event.clientY - startClient;
      const [nextFirst, nextSecond] = constrainPairPixels(startFirst, startSecond, delta, cardCollapsedSize);
      applyRatio(nextFirst / Math.max(1, nextFirst + nextSecond));
    };
    const handleUp = () => {
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setRatio((current) => (Math.abs(current - nextRatio) > 0.0005 ? nextRatio : current));
      setResizing(false);
    };
    document.body.style.cursor = orientation === "vertical" ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
    setResizing(true, orientation === "vertical" ? "width" : "height");
    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleUp);
  };

  return (
    <div
      ref={rootRef}
      className="grid h-full min-h-0 min-w-0 overflow-hidden"
      style={{
        "--workspace-split-first": `${ratio}fr`,
        "--workspace-split-second": `${1 - ratio}fr`,
        ...(orientation === "vertical"
          ? { gridTemplateColumns: `minmax(0, var(--workspace-split-first)) ${workspaceSplitterSize}px minmax(0, var(--workspace-split-second))` }
          : { gridTemplateRows: `minmax(0, var(--workspace-split-first)) ${workspaceSplitterSize}px minmax(0, var(--workspace-split-second))` }),
      } as unknown as CSSProperties}
    >
      {first}
      <PanelResizeHandle orientation={orientation} onMouseDown={(event) => resize(orientation === "vertical" ? event.clientX : event.clientY)} />
      {second}
    </div>
  );
}

export function PanelStack({
  workspaceId,
  runtime,
  panelCollapseModes,
  onPanelCollapseModeChange,
  items,
  renderPanel,
}: {
  workspaceId: WorkspaceId;
  runtime: WorkspaceRuntime;
  panelCollapseModes: Record<string, PanelCollapseMode>;
  onPanelCollapseModeChange: (panelId: string, mode: PanelCollapseMode) => void;
  items: WorkspacePanelItem[];
  renderPanel: WorkspacePanelRenderer;
}) {
  const inheritedResizeState = useWorkspaceLayoutResizeState();
  const orderedItems = useMemo(
    () =>
      items
        .map((item, index) => ({ ...item, index, collapsed: (panelCollapseModes[item.panel.id] ?? "none") !== "none" }))
        .filter((item) => {
          const mode = panelCollapseModes[item.panel.id] ?? "none";
          return mode !== "vertical" && mode !== "horizontal" && mode !== "compact";
        })
        .sort((a, b) => Number(b.collapsed) - Number(a.collapsed) || a.index - b.index),
    [items, panelCollapseModes],
  );
  const stackKey = orderedItems.map((item) => item.panel.id).join("|");
  const stackRef = useRef<HTMLDivElement | null>(null);
  const stackSize = useElementBoxSize(stackRef, inheritedResizeState.resizing);
  const preservedRowSizesRef = useRef<Record<string, number>>({});
  const rowMeasurementWidthRef = useRef(0);
  const [manualSizes, setManualSizes] = useState<Record<string, number> | undefined>();

  useEffect(() => {
    setManualSizes(undefined);
    preservedRowSizesRef.current = {};
    rowMeasurementWidthRef.current = 0;
  }, [stackKey]);

  const stackResizeContext = inheritedResizeState;

  const policies = useMemo(() => orderedItems.map(resolvePanelStackSizing), [orderedItems]);
  const availableHeight = Math.max(0, stackSize.height - Math.max(0, orderedItems.length - 1) * workspaceSplitterSize);
  const manualRowSizes = useMemo(
    () => (manualSizes ? resolveManualStackRowSizes(orderedItems, policies, manualSizes, availableHeight) : undefined),
    [orderedItems, policies, manualSizes, availableHeight],
  );
  const freezeAutoRowMeasurement = shouldFreezeAutoRowMeasurement({
    hasManualRows: Boolean(manualRowSizes),
    resizeState: inheritedResizeState,
    width: stackSize.width,
    measuredWidth: rowMeasurementWidthRef.current,
  });
  const panelAutoCollapseSuppression = useMemo<PanelAutoCollapseSuppression | undefined>(
    () => (freezeAutoRowMeasurement ? { height: true } : undefined),
    [freezeAutoRowMeasurement],
  );
  const automaticRowSizes = useMemo(
    () => (manualRowSizes || freezeAutoRowMeasurement || !usesExplicitFillStackSizing(policies) ? undefined : resolveAutomaticStackRowSizes(policies, availableHeight)),
    [manualRowSizes, freezeAutoRowMeasurement, policies, availableHeight],
  );

  const getRenderedRowSizes = () => {
    const children = Array.from(stackRef.current?.children ?? []);
    return orderedItems.map((item, index) => {
      const element = children[index * 2];
      if (element instanceof HTMLElement) {
        return Math.max(resolveMinStackSize(policies[index] ?? defaultResolvedStackSizing), element.getBoundingClientRect().height);
      }
      return resolvePreferredStackSize(policies[index] ?? defaultResolvedStackSizing);
    });
  };

  useEffect(() => {
    if (freezeAutoRowMeasurement || orderedItems.length === 0) {
      return;
    }

    const renderedSizes = getRenderedRowSizes();
    rowMeasurementWidthRef.current = stackSize.width;
    preservedRowSizesRef.current = mergeRenderedRowSizes(orderedItems, policies, preservedRowSizesRef.current, renderedSizes);
  }, [orderedItems, policies, freezeAutoRowMeasurement, stackSize.width, stackSize.height]);

  const resizeStackSplit = (splitIndex: number, startClientY: number) => {
    const stack = stackRef.current;
    if (!stack) {
      return;
    }

    const startPixels = manualRowSizes ?? getRenderedRowSizes();
    let nextManualSizes = manualSizes ?? Object.fromEntries(orderedItems.map((item, index) => [item.panel.id, startPixels[index] ?? resolveMinStackSize(policies[index] ?? defaultResolvedStackSizing)]));

    const resolveNextManualSizes = (delta: number): Record<string, number> => {
      const firstPolicy = policies[splitIndex] ?? defaultResolvedStackSizing;
      const secondPolicy = policies[splitIndex + 1] ?? defaultResolvedStackSizing;
      const minimumSize = Math.max(resolveMinStackSize(firstPolicy), resolveMinStackSize(secondPolicy));
      const [nextFirst, nextSecond] = constrainPairPixels(startPixels[splitIndex] ?? 0, startPixels[splitIndex + 1] ?? 0, delta, minimumSize);
      const nextPixels = [...startPixels];
      nextPixels[splitIndex] = nextFirst;
      nextPixels[splitIndex + 1] = nextSecond;
      return Object.fromEntries(orderedItems.map((item, index) => [item.panel.id, nextPixels[index] ?? resolveMinStackSize(policies[index] ?? defaultResolvedStackSizing)]));
    };
    const applyManualSizes = (sizes: Record<string, number>) => {
      nextManualSizes = sizes;
      const resolvedSizes = resolveManualStackRowSizes(orderedItems, policies, sizes, availableHeight);
      const tracks = resolveStackRowTracks(orderedItems, policies, {
        resolvedRowSizes: resolvedSizes,
        preservedRowSizes: preservedRowSizesRef.current,
        usePreservedRows: false,
      });
      stack.style.gridTemplateRows = buildStackGridTemplateRows(tracks, orderedItems.length);
    };

    const handleMove = (event: MouseEvent) => {
      applyManualSizes(resolveNextManualSizes(event.clientY - startClientY));
    };
    const handleUp = () => {
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setManualSizes(nextManualSizes);
      inheritedResizeState.setResizing(false);
    };
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    inheritedResizeState.setResizing(true, "height");
    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleUp);
  };

  const resolvedRowSizes = manualRowSizes ?? automaticRowSizes;
  const rowTracks = resolveStackRowTracks(orderedItems, policies, {
    resolvedRowSizes,
    preservedRowSizes: preservedRowSizesRef.current,
    usePreservedRows: freezeAutoRowMeasurement,
  });
  const gridTemplateRows = buildStackGridTemplateRows(rowTracks, orderedItems.length);

  if (orderedItems.length === 0) {
    return null;
  }

  return (
    <WorkspaceLayoutResizeProvider value={stackResizeContext}>
      <div ref={stackRef} className="grid h-full min-h-0 min-w-0 overflow-hidden" style={{ gridTemplateRows }}>
        <AnimatePresenceShim>
          {orderedItems.map((item, index) => (
            <Fragment key={item.panel.id}>
              {renderPanel({
                workspaceId,
                panel: item.panel,
                runtime,
                className: item.className,
                detail: item.detail,
                layoutId: item.layoutId,
                collapseMode: panelCollapseModes[item.panel.id] ?? "none",
                contentSizing: (policies[index] ?? defaultResolvedStackSizing).mode === "content",
                autoCollapseSuppression: panelAutoCollapseSuppression,
                onCollapseModeChange: (mode) => onPanelCollapseModeChange(item.panel.id, mode),
              })}
              {index < orderedItems.length - 1 ? <PanelResizeHandle orientation="horizontal" onMouseDown={(event) => resizeStackSplit(index, event.clientY)} /> : null}
            </Fragment>
          ))}
        </AnimatePresenceShim>
      </div>
    </WorkspaceLayoutResizeProvider>
  );
}

function AnimatePresenceShim({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

type ResolvedStackSizing = Required<Pick<WorkspacePanelStackSizing, "mode" | "minSize" | "flex">> & {
  preferredSize?: number;
  maxSize?: number;
};

const defaultResolvedStackSizing: ResolvedStackSizing = {
  mode: "fill",
  minSize: cardCollapsedSize,
  flex: 1,
};

function shouldFreezeAutoRowMeasurement({
  hasManualRows,
  resizeState,
  width,
  measuredWidth,
}: {
  hasManualRows: boolean;
  resizeState: WorkspaceLayoutResizeState;
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

function mergeRenderedRowSizes(
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

function resolveStackRowTracks(
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

function buildStackGridTemplateRows(rowTracks: string[], itemCount: number): string {
  return rowTracks
    .flatMap((track, index) => (index < itemCount - 1 ? [track, `${workspaceSplitterSize}px`] : [track]))
    .join(" ");
}

function resolvePixelStackTrack(size: number): string {
  return `minmax(0, ${Math.max(cardCollapsedSize, Math.round(size))}px)`;
}

function resolvePanelStackSizing(item: WorkspacePanelItem): ResolvedStackSizing {
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

function resolveManualStackRowSizes(
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

function resolveAutomaticStackRowSizes(policies: ResolvedStackSizing[], availableHeight: number): number[] | undefined {
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

function usesExplicitFillStackSizing(policies: ResolvedStackSizing[]): boolean {
  return policies.some((policy) => policy.mode === "fill" && policy.preferredSize !== undefined);
}

function resolvePreferredStackSize(policy: ResolvedStackSizing): number {
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

function resolveMinStackSize(policy: ResolvedStackSizing): number {
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

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
