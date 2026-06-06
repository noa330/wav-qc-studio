import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { WorkspacePanel, WorkspacePanelKind } from "../../model/workspace-config";
import type { PanelAutoCollapseSuppression, PanelCollapseMode, WorkspacePanelStackSizing } from "./workspace-layout-types";
import { shouldRenderAdaptiveCollapse } from "./workspace-panel-sizing";

type ElementBoxSize = {
  width: number;
  height: number;
};

export type PanelBodyMinSize = {
  width: number;
  height: number;
};

export type PanelBodyLayoutMode = "fill" | "content";

const bodyLayoutModeByKind: Record<WorkspacePanelKind, PanelBodyLayoutMode> = {
  browser: "fill",
  filter: "content",
  table: "fill",
  detail: "content",
  settings: "fill",
  waveform: "fill",
  "slice-actions": "fill",
  queue: "fill",
  playback: "fill",
  "audio-comparison": "fill",
  progress: "fill",
  model: "fill",
};

const stackSizingByKind: Record<WorkspacePanelKind, WorkspacePanelStackSizing> = {
  browser: { mode: "fill", flex: 1 },
  filter: { mode: "content", preferredSize: 116, minSize: 56, maxSize: 260 },
  table: { mode: "fill", flex: 1 },
  detail: { mode: "content", preferredSize: 180, minSize: 56, maxSize: 360 },
  settings: { mode: "fill", minSize: 56, flex: 1 },
  waveform: { mode: "fill", flex: 1 },
  "slice-actions": { mode: "content", preferredSize: 56, minSize: 56, maxSize: 56 },
  queue: { mode: "fill", flex: 1 },
  playback: { mode: "fill", flex: 1 },
  "audio-comparison": { mode: "fill", flex: 1 },
  progress: { mode: "fill", flex: 1 },
  model: { mode: "content", preferredSize: 240, minSize: 56, maxSize: 420 },
};

const bodyMinSizeByKind: Record<WorkspacePanelKind, PanelBodyMinSize> = {
  browser: { width: 0, height: 0 },
  filter: { width: 0, height: 0 },
  table: { width: 360, height: 180 },
  detail: { width: 260, height: 96 },
  settings: { width: 0, height: 0 },
  waveform: { width: 360, height: 220 },
  "slice-actions": { width: 360, height: 56 },
  queue: { width: 0, height: 0 },
  playback: { width: 240, height: 220 },
  "audio-comparison": { width: 480, height: 220 },
  progress: { width: 360, height: 180 },
  model: { width: 0, height: 0 },
};

const fillBodyPanelIds = new Set(["overview-modules", "batch-speakers"]);

function usesFillBodyLayout(panel: WorkspacePanel): boolean {
  return bodyLayoutModeByKind[panel.kind] === "fill" || fillBodyPanelIds.has(panel.id);
}

export function useElementBoxSize<TElement extends HTMLElement>(ref: RefObject<TElement | null>, paused = false): ElementBoxSize {
  const [size, setSize] = useState<ElementBoxSize>({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || paused) {
      return;
    }

    let frameId = 0;
    let pendingEntry: ResizeObserverEntry | undefined;
    const update = () => {
      frameId = 0;
      const nextSize = readElementBoxSize(element, pendingEntry);
      pendingEntry = undefined;
      const width = nextSize.width;
      const height = nextSize.height;
      setSize((current) => (Math.abs(current.width - width) > 1 || Math.abs(current.height - height) > 1 ? { width, height } : current));
    };
    const scheduleUpdate = (entry?: ResizeObserverEntry) => {
      pendingEntry = entry ?? pendingEntry;
      if (frameId !== 0) {
        return;
      }
      frameId = window.requestAnimationFrame(update);
    };

    update();
    const observer = new ResizeObserver((entries) => scheduleUpdate(entries[0]));
    observer.observe(element);
    const scheduleWindowUpdate = () => scheduleUpdate();
    window.addEventListener("resize", scheduleWindowUpdate);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", scheduleWindowUpdate);
      if (frameId !== 0) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [paused, ref]);

  return size;
}

export function useElementResizeCollapseMode<TElement extends HTMLElement>(
  ref: RefObject<TElement | null>,
  active: boolean,
  requestedMode: PanelCollapseMode,
  autoCollapseSuppression?: PanelAutoCollapseSuppression,
): PanelCollapseMode | undefined {
  const [mode, setMode] = useState<PanelCollapseMode | undefined>();
  const modeRef = useRef<PanelCollapseMode | undefined>(undefined);
  const suppressWidth = Boolean(autoCollapseSuppression?.width);
  const suppressHeight = Boolean(autoCollapseSuppression?.height);

  useLayoutEffect(() => {
    if (!active) {
      modeRef.current = undefined;
      setMode(undefined);
      return;
    }

    const element = ref.current;
    if (!element) {
      modeRef.current = undefined;
      setMode(undefined);
      return;
    }

    const suppression: PanelAutoCollapseSuppression | undefined =
      suppressWidth || suppressHeight ? { width: suppressWidth || undefined, height: suppressHeight || undefined } : undefined;
    let frameId = 0;
    let pendingEntry: ResizeObserverEntry | undefined;
    const update = () => {
      frameId = 0;
      const nextMode = resolveMeasuredPanelCollapseMode(requestedMode, readElementBoxSize(element, pendingEntry), suppression);
      pendingEntry = undefined;
      if (modeRef.current !== nextMode) {
        modeRef.current = nextMode;
        setMode(nextMode);
      }
    };
    const scheduleUpdate = (entry?: ResizeObserverEntry) => {
      pendingEntry = entry ?? pendingEntry;
      if (frameId !== 0) {
        return;
      }
      frameId = window.requestAnimationFrame(update);
    };

    update();
    const observer = new ResizeObserver((entries) => scheduleUpdate(entries[0]));
    observer.observe(element);
    const scheduleWindowUpdate = () => scheduleUpdate();
    window.addEventListener("resize", scheduleWindowUpdate);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", scheduleWindowUpdate);
      if (frameId !== 0) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [active, ref, requestedMode, suppressHeight, suppressWidth]);

  return active ? mode : undefined;
}

function readElementBoxSize(element: HTMLElement, entry?: ResizeObserverEntry): ElementBoxSize {
  const borderBoxSize = entry?.borderBoxSize;
  const borderBox = Array.isArray(borderBoxSize) ? borderBoxSize[0] : borderBoxSize;
  if (borderBox) {
    return {
      width: Math.round(borderBox.inlineSize),
      height: Math.round(borderBox.blockSize),
    };
  }

  const rect = element.getBoundingClientRect();
  return {
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

export function resolveMeasuredPanelCollapseMode(requestedMode: PanelCollapseMode, size: ElementBoxSize, autoCollapseSuppression?: PanelAutoCollapseSuppression): PanelCollapseMode {
  if (requestedMode !== "none") {
    return requestedMode;
  }

  const widthIsPhysicallyCollapsed = !autoCollapseSuppression?.width && shouldRenderAdaptiveCollapse(size.width);
  const heightIsPhysicallyCollapsed = !autoCollapseSuppression?.height && shouldRenderAdaptiveCollapse(size.height);

  if (widthIsPhysicallyCollapsed && heightIsPhysicallyCollapsed) {
    return "compact";
  }
  if (widthIsPhysicallyCollapsed) {
    return "vertical";
  }
  if (heightIsPhysicallyCollapsed) {
    return "horizontal";
  }
  return "none";
}

export function getPanelBodyMinSize(panel: WorkspacePanel, detail = false): PanelBodyMinSize {
  const base = bodyMinSizeByKind[panel.kind];
  if (!detail || panel.kind !== "detail") {
    return base;
  }
  return {
    width: Math.max(base.width, 320),
    height: Math.max(base.height, 140),
  };
}

export function getPanelBodyLayoutMode(panel: WorkspacePanel): PanelBodyLayoutMode {
  return usesFillBodyLayout(panel) ? "fill" : "content";
}

export function getDefaultPanelStackSizing(panel: WorkspacePanel, detail = false): WorkspacePanelStackSizing {
  const base = stackSizingByKind[panel.kind];
  if (!detail || panel.kind !== "detail") {
    return base;
  }

  return {
    ...base,
    preferredSize: Math.max(base.preferredSize ?? 0, 220),
    maxSize: Math.max(base.maxSize ?? 0, 460),
  };
}
