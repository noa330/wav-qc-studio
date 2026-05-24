import { Fragment, createContext, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { resizeHandleLineTransition, resizeHandleLineVariants } from "@/shared/motion";
import type { WorkspaceId } from "@shared/ipc";
import type { WorkspaceRuntime } from "../../state/use-workspace-runtime";
import { cardCollapsedSize, workspaceSplitterSize } from "./workspace-panel-sizing";
import { useElementBoxSize } from "./workspace-card-overflow";
import type { PanelAutoCollapseSuppression, WorkspacePanelItem, WorkspacePanelRenderer, WorkspaceResizeAxis } from "./workspace-layout-types";
import {
  buildStackGridTemplateRows,
  clampNumber,
  constrainPairPixels,
  defaultResolvedStackSizing,
  mergeRenderedRowSizes,
  resolveAutomaticStackRowSizes,
  resolveManualStackRowSizes,
  resolveMinStackSize,
  resolvePanelStackSizing,
  resolvePreferredStackSize,
  resolveStackRowTracks,
  shouldFreezeAutoRowMeasurement,
  usesExplicitFillStackSizing,
} from "./workspace-stack-sizing";

export { constrainPairPixels } from "./workspace-stack-sizing";

const resizeHandleClass = "group relative flex items-stretch justify-center";

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
        aria-label={orientation === "vertical" ? "?⑤꼸 ??議곗젅" : "?⑤꼸 ?믪씠 議곗젅"}
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
  items,
  renderPanel,
}: {
  workspaceId: WorkspaceId;
  runtime: WorkspaceRuntime;
  items: WorkspacePanelItem[];
  renderPanel: WorkspacePanelRenderer;
}) {
  const inheritedResizeState = useWorkspaceLayoutResizeState();
  const orderedItems = items;
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
                collapseMode: "none",
                contentSizing: (policies[index] ?? defaultResolvedStackSizing).mode === "content",
                autoCollapseSuppression: panelAutoCollapseSuppression,
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
