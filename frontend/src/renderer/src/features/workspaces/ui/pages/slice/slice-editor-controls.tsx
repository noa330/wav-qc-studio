import { Copy, Trash2 } from "lucide-react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import type { ReactNode, RefObject } from "react";
import { cn } from "@/lib/utils";
import { menuMotion, pressTap, softPressTap } from "@/shared/motion";

export type SliceMarkerMenuState = {
  x: number;
  y: number;
  markerId: string;
};

export function SliceMarkerContextMenu({
  refEl,
  menu,
  splitLabel,
  canSplit,
  canMerge,
  onSplit,
  onCopy,
  onDelete,
  onMerge,
}: {
  refEl: RefObject<HTMLDivElement | null>;
  menu: SliceMarkerMenuState;
  splitLabel: string;
  canSplit: boolean;
  canMerge: boolean;
  onSplit: () => void;
  onCopy: () => void;
  onDelete: () => void;
  onMerge: () => void;
}) {
  return createPortal(
    <motion.div
      ref={refEl}
      {...menuMotion}
      className="fixed z-[1100] min-w-[180px] rounded-[4px] border border-[var(--panel-stroke)] bg-[var(--field-bg)] py-1 text-sm shadow-[0_14px_32px_rgba(0,0,0,.34)]"
      style={{ left: menu.x, top: menu.y }}
    >
      <SliceMarkerMenuItem icon={<Copy className="size-4" />} label="복사하기" disabled={!canSplit} onClick={onCopy} />
      <SliceMarkerMenuItem icon={<Trash2 className="size-4" />} label="선택한 마커만 지우기" disabled={!canSplit} onClick={onDelete} />
      <div className="my-1 h-px bg-[var(--panel-stroke)]" />
      <SliceMarkerMenuItem label={splitLabel} disabled={!canSplit} onClick={onSplit} />
      <div className="my-1 h-px bg-[var(--panel-stroke)]" />
      <SliceMarkerMenuItem label="선택 마커 병합" disabled={!canMerge} onClick={onMerge} />
    </motion.div>,
    document.body,
  );
}

function SliceMarkerMenuItem({ icon, label, disabled, onClick }: { icon?: ReactNode; label: string; disabled?: boolean; onClick: () => void }) {
  return (
    <motion.button
      type="button"
      disabled={disabled}
      onClick={onClick}
      whileTap={disabled ? undefined : softPressTap}
      className={cn(
        "grid h-9 w-full items-center gap-2 px-3 text-left text-[var(--primary-text)] hover:bg-[var(--soft-selection-hover)]",
        icon ? "grid-cols-[22px_minmax(0,1fr)]" : "grid-cols-[minmax(0,1fr)]",
        disabled && "text-[var(--secondary-text)] opacity-55 hover:bg-transparent",
      )}
    >
      {icon ? <span>{icon}</span> : null}
      <span>{label}</span>
    </motion.button>
  );
}

export function SliceTimeGrid({
  disabled,
  startValue,
  endValue,
  durationValue,
  previewValue,
}: {
  disabled: boolean;
  startValue: string;
  endValue: string;
  durationValue: string;
  previewValue: string;
}) {
  const inputClass = "wpf-field h-[38px] min-w-0 px-3 text-sm outline-none disabled:opacity-60";
  const buttonClass = "wpf-button h-[38px] min-w-0 truncate px-2 text-sm disabled:opacity-45";
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(36px,52px)_minmax(0,1fr)_minmax(36px,52px)_minmax(0,1fr)_minmax(0,1fr)] gap-x-2 gap-y-2">
      <p className="col-start-1 truncate text-[13px] text-[var(--secondary-text)]">시작 (Start)</p>
      <p className="col-start-3 truncate text-[13px] text-[var(--secondary-text)]">종료 (End)</p>
      <p className="col-start-5 truncate text-[13px] text-[var(--secondary-text)]">길이 (Duration)</p>
      <p className="col-start-6 truncate text-[13px] text-[var(--secondary-text)]">미리듣기 재생 위치</p>
      <input className={cn(inputClass, "col-start-1 row-start-2")} value={startValue} readOnly disabled={disabled} />
      <motion.button type="button" disabled={disabled} whileTap={disabled ? undefined : pressTap} className={cn(buttonClass, "col-start-2 row-start-2")}>
        이동
      </motion.button>
      <input className={cn(inputClass, "col-start-3 row-start-2")} value={endValue} readOnly disabled={disabled} />
      <motion.button type="button" disabled={disabled} whileTap={disabled ? undefined : pressTap} className={cn(buttonClass, "col-start-4 row-start-2")}>
        이동
      </motion.button>
      <input className={cn(inputClass, "col-start-5 row-start-2")} value={durationValue} readOnly disabled={disabled} />
      <input className={cn(inputClass, "col-start-6 row-start-2")} value={previewValue} readOnly disabled={disabled} />
    </div>
  );
}

export function estimateControlButtonWidth(label: string): number {
  const context = getSliceControlMeasureContext();
  const textWidth = context ? context.measureText(label).width : Array.from(label).reduce((width, char) => width + (char.charCodeAt(0) > 127 ? 14 : 7), 0);
  return Math.ceil(textWidth + 32);
}

let sliceControlMeasureContext: CanvasRenderingContext2D | null | undefined;

function getSliceControlMeasureContext(): CanvasRenderingContext2D | null {
  if (sliceControlMeasureContext !== undefined) {
    return sliceControlMeasureContext;
  }
  if (typeof document === "undefined") {
    sliceControlMeasureContext = null;
    return sliceControlMeasureContext;
  }
  const canvas = document.createElement("canvas");
  sliceControlMeasureContext = canvas.getContext("2d");
  if (sliceControlMeasureContext) {
    sliceControlMeasureContext.font = '14px "Noto Sans KR", "Segoe UI", system-ui, sans-serif';
  }
  return sliceControlMeasureContext;
}
