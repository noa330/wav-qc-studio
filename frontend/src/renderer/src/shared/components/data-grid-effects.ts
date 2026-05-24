import { useCallback, useEffect, useState, type Dispatch, type MouseEvent as ReactMouseEvent, type RefObject, type SetStateAction } from "react";
import { resolveColumnMenuState } from "./data-grid-model";
import type { ColumnMenuState, DataGridViewState } from "./data-grid-types";

export function useDataGridViewStateSync({
  pageSize,
  pageIndex,
  columnWidths,
  autoFitColumns,
  rowHeights,
  autoFitRowsActive,
  onViewStateChange,
}: {
  pageSize: number;
  pageIndex: number;
  columnWidths: Record<string, number>;
  autoFitColumns: Record<string, boolean>;
  rowHeights: Record<string, number>;
  autoFitRowsActive: boolean;
  onViewStateChange?: (state: DataGridViewState) => void;
}) {
  useEffect(() => {
    onViewStateChange?.({
      pageSize,
      pageIndex,
      columnWidths,
      autoFitColumns,
      rowHeights,
      autoFitRowsActive,
    });
  }, [autoFitColumns, autoFitRowsActive, columnWidths, onViewStateChange, pageIndex, pageSize, rowHeights]);
}

export function useDataGridViewportWidth({
  viewportRef,
  suspendWidthTracking,
  columnCount,
  rowCount,
}: {
  viewportRef: RefObject<HTMLDivElement | null>;
  suspendWidthTracking: boolean;
  columnCount: number;
  rowCount: number;
}): number | undefined {
  const [viewportWidth, setViewportWidth] = useState<number | undefined>();

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || suspendWidthTracking) {
      return;
    }

    let frameId = 0;
    const updateWidth = () => {
      frameId = 0;
      const nextWidth = Math.round(viewport.clientWidth || viewport.getBoundingClientRect().width);
      setViewportWidth((current) => (current === undefined || Math.abs(current - nextWidth) > 1 ? nextWidth : current));
    };
    const scheduleUpdateWidth = () => {
      if (frameId !== 0) {
        return;
      }
      frameId = window.requestAnimationFrame(updateWidth);
    };

    scheduleUpdateWidth();
    const observer = new ResizeObserver(scheduleUpdateWidth);
    observer.observe(viewport);
    window.addEventListener("resize", scheduleUpdateWidth);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", scheduleUpdateWidth);
      if (frameId !== 0) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [columnCount, rowCount, suspendWidthTracking, viewportRef]);

  return viewportWidth;
}

export function useDismissibleGridPortal({
  active,
  refEl,
  onClose,
}: {
  active: boolean;
  refEl: RefObject<HTMLDivElement | null>;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!active) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && refEl.current?.contains(target)) {
        return;
      }
      onClose();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [active, onClose, refEl]);
}

export function useColumnMenuController(setColumnMenu: Dispatch<SetStateAction<ColumnMenuState | undefined>>) {
  return useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>, key: string) => {
      event.preventDefault();
      event.stopPropagation();
      const triggerRect = event.currentTarget.getBoundingClientRect();
      setColumnMenu((current) => resolveColumnMenuState({ current, key, triggerRect, windowWidth: window.innerWidth, windowHeight: window.innerHeight }));
    },
    [setColumnMenu],
  );
}
