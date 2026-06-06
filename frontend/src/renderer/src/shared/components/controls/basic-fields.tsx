import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/utils";
import { menuMotion, quickEase, softPressTap, tightPressTap } from "@/shared/motion";
import { CONTROL_ARROW_SLOT_CLASS } from "./control-styles";
import { ChevronGlyph } from "./chevron-glyph";

export function NumericField({
  value,
  onChange,
  ariaLabel,
  step = 0.1,
  wheelStep,
  min,
  max,
  variant = "default",
}: {
  value: number;
  onChange: (value: number, source?: "input" | "step") => void;
  ariaLabel: string;
  step?: number;
  wheelStep?: number;
  min?: number;
  max?: number;
  variant?: "default" | "ghost";
}) {
  const safeValue = Number.isFinite(value) ? value : 0;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const fieldRef = useRef<HTMLTextAreaElement | null>(null);
  const [draftValue, setDraftValue] = useState(Number.isFinite(value) ? String(value) : "");
  const [focused, setFocused] = useState(false);
  const displayValue = focused ? draftValue : Number.isFinite(value) ? String(value) : "";

  useEffect(() => {
    if (!focused) {
      setDraftValue(Number.isFinite(value) ? String(value) : "");
    }
  }, [focused, value]);

  const resizeField = useCallback(() => {
    const field = fieldRef.current;
    if (!field) {
      return;
    }
    field.style.height = "38px";
    field.style.height = `${Math.max(38, field.scrollHeight)}px`;
  }, []);

  useLayoutEffect(() => {
    resizeField();
    const root = rootRef.current;
    if (!root) {
      return undefined;
    }
    const observer = new ResizeObserver(resizeField);
    observer.observe(root);
    return () => observer.disconnect();
  }, [displayValue, resizeField]);

  const commitValue = (nextValue: number, source: "input" | "step" = "input") => {
    if (!Number.isFinite(nextValue)) {
      return;
    }

    const clamped = Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? Number.NEGATIVE_INFINITY, nextValue));
    const decimalPlaces = Math.max(0, resolveDecimalPlaces(step));
    const factor = 10 ** decimalPlaces;
    const rounded = Math.round(clamped * factor) / factor;
    setDraftValue(String(rounded));
    onChange(rounded, source);
  };
  const commitWheelDelta = (deltaY: number) => {
    const steps = Math.max(1, Math.round(Math.abs(deltaY) / 100));
    const deltaStep = wheelStep ?? step;
    commitValue(safeValue + (deltaY < 0 ? deltaStep : -deltaStep) * steps, "step");
  };

  useEffect(() => {
    const root = rootRef.current;
    if (!root) {
      return;
    }

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      commitWheelDelta(event.deltaY);
    };

    root.addEventListener("wheel", handleWheel, { capture: true, passive: false });
    return () => {
      root.removeEventListener("wheel", handleWheel, { capture: true });
    };
  }, [safeValue, step, wheelStep, min, max, onChange]);

  return (
    <div
      ref={rootRef}
      className={cn(
        "wpf-field relative min-h-[38px] w-full min-w-0",
        variant === "ghost" && "!border-transparent !bg-transparent",
      )}
    >
      <textarea
        ref={fieldRef}
        aria-label={ariaLabel}
        inputMode="decimal"
        rows={1}
        value={displayValue}
        onFocus={() => {
          setFocused(true);
          setDraftValue(Number.isFinite(value) ? String(value) : "");
        }}
        onBlur={() => {
          setFocused(false);
          const parsed = Number(draftValue);
          if (Number.isFinite(parsed)) {
            commitValue(parsed);
          } else {
            setDraftValue(Number.isFinite(value) ? String(value) : "");
          }
        }}
        onChange={(event) => {
          const nextValue = event.target.value.replace(/\r?\n/g, "");
          setDraftValue(nextValue);
          if (/^-?(?:\d+|\d*\.\d+)$/.test(nextValue.trim())) {
            commitValue(Number(nextValue));
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          }

          if (event.key === "ArrowUp") {
            event.preventDefault();
            commitValue(safeValue + step, "step");
          }

          if (event.key === "ArrowDown") {
            event.preventDefault();
            commitValue(safeValue - step, "step");
          }
        }}
        className="block min-h-[38px] w-full min-w-0 resize-none overflow-hidden break-all border-0 bg-transparent px-2 py-2 pr-7 text-sm leading-5 text-[var(--primary-text)] outline-none"
      />
      <div className={cn("absolute right-0 top-0 grid h-full min-h-[38px] grid-rows-2 px-1.5 py-1.5", CONTROL_ARROW_SLOT_CLASS)}>
        <button type="button" tabIndex={-1} onClick={() => commitValue(safeValue + step, "step")} className="flex items-center justify-center" aria-label={`${ariaLabel} 증가`}>
          <ChevronGlyph direction="up" />
        </button>
        <button type="button" tabIndex={-1} onClick={() => commitValue(safeValue - step, "step")} className="flex items-center justify-center" aria-label={`${ariaLabel} 감소`}>
          <ChevronGlyph direction="down" />
        </button>
      </div>
    </div>
  );
}

export function TextField({ value, onChange, ariaLabel }: { value: string; onChange: (value: string) => void; ariaLabel: string }) {
  return (
    <input
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="wpf-field h-[38px] w-full px-3 text-sm text-[var(--primary-text)] outline-none"
    />
  );
}

export function ToggleSwitch({ checked, onChange, disabled = false }: { checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }) {
  return (
    <motion.button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      whileTap={disabled ? undefined : tightPressTap}
      className={cn("relative ml-auto h-[18px] w-9 shrink-0 justify-self-end rounded-full transition", checked ? "bg-[var(--accent-blue)]" : "bg-[var(--switch-off-bg)]", disabled && "opacity-45")}
    >
      <motion.span
        initial={false}
        animate={{ x: checked ? 20 : 2 }}
        transition={quickEase}
        className="absolute left-0 top-0.5 size-3.5 rounded-full bg-white shadow-xs"
      />
    </motion.button>
  );
}

export function SelectionCheck({
  checked,
  mixed = false,
  disabled = false,
  size = 18,
  className,
}: {
  checked: boolean;
  mixed?: boolean;
  disabled?: boolean;
  size?: number;
  className?: string;
}) {
  const active = checked || mixed;
  const glyphSize = Math.max(10, Math.round(size * 0.62));
  const ringWidth = Math.max(1, Math.round(size * 0.08));

  return (
    <AnimatePresence mode="wait" initial={false}>
      {active ? (
        <motion.span
          key={mixed ? "mixed" : "checked"}
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.5, opacity: 0 }}
          transition={{ type: "spring", stiffness: 500, damping: 28 }}
          className={cn(
            "relative flex shrink-0 items-center justify-center rounded-full bg-[var(--model-card-check-bg)] text-white",
            disabled && "opacity-65",
            className,
          )}
          style={{ width: size, height: size, border: `${ringWidth}px solid var(--model-card-check-ring)`, boxSizing: "border-box" }}
          aria-hidden="true"
        >
          <svg
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth={mixed ? 2 : 1.85}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ width: glyphSize, height: glyphSize }}
          >
            {mixed ? (
              <motion.path
                d="M3 6H9"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.2, delay: 0.04, ease: "easeOut" }}
              />
            ) : (
              <motion.path
                d="M2.7 6.3L5 8.6L9.3 3.6"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.25, delay: 0.05, ease: "easeOut" }}
              />
            )}
          </svg>
        </motion.span>
      ) : (
        <motion.span
          key="unchecked"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className={cn(
            "flex shrink-0 items-center justify-center rounded-full border border-[var(--model-card-check-border)] bg-transparent transition-colors group-hover:border-[var(--model-option-hover-border)]",
            disabled && "opacity-45",
            className,
          )}
          style={{ width: size, height: size }}
          aria-hidden="true"
        />
      )}
    </AnimatePresence>
  );
}

export function Tooltip({ label, description, width, className, children }: { label: string; description?: string; width?: number; className?: string; children: ReactNode }) {
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number; placement: "top" | "bottom"; width: number }>({ left: 0, top: 0, placement: "bottom", width: 180 });

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const updatePosition = useCallback(() => {
    const root = rootRef.current;
    if (!root) {
      return;
    }
    const rect = root.getBoundingClientRect();
    const margin = 12;
    const tooltipWidth = width ?? Math.min(304, Math.max(180, label.length * 12 + 28));
    const left = Math.min(Math.max(margin, rect.left), Math.max(margin, window.innerWidth - tooltipWidth - margin));
    const bottomSpace = window.innerHeight - rect.bottom - margin;
    const topSpace = rect.top - margin;
    const placement = bottomSpace < (description ? 160 : 96) && topSpace > bottomSpace ? "top" : "bottom";
    const top = placement === "top" ? rect.top - 8 : rect.bottom + 8;
    setPosition({ left, top, placement, width: tooltipWidth });
  }, [description, label.length, width]);

  const show = useCallback(() => {
    clearCloseTimer();
    updatePosition();
    setOpen(true);
  }, [clearCloseTimer, updatePosition]);

  const scheduleHide = useCallback(() => {
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => setOpen(false), 90);
  }, [clearCloseTimer]);

  useLayoutEffect(() => {
    if (!open) {
      return undefined;
    }
    updatePosition();
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [open, updatePosition]);

  return (
    <span ref={rootRef} className={cn("inline-flex max-w-full min-w-0", className)} onPointerEnter={show} onPointerLeave={scheduleHide} onFocus={show} onBlur={scheduleHide}>
      {children}
      {open
        ? createPortal(
            <motion.div
              initial={{ opacity: 0, y: position.placement === "top" ? 4 : -4, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: position.placement === "top" ? 4 : -4, scale: 0.985 }}
              transition={menuMotion.transition}
              className="app-scrollbar fixed z-[1000] max-h-[360px] overflow-auto rounded-[5px] border border-[var(--panel-stroke)] bg-[var(--popover)]/95 p-3 text-[13px] leading-5 text-[var(--secondary-text)] shadow-[var(--app-popover-shadow)] backdrop-blur"
              style={{
                left: position.left,
                top: position.top,
                width: position.width,
                transform: position.placement === "top" ? "translateY(-100%)" : undefined,
              }}
              role="tooltip"
              onPointerEnter={show}
              onPointerLeave={scheduleHide}
            >
              <p className={cn("text-[13px] font-normal text-[var(--primary-text)]", description && "mb-1")}>{label}</p>
              {description ? <p>{description}</p> : null}
            </motion.div>,
            document.body,
          )
        : null}
    </span>
  );
}

export function CheckItem({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <motion.button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      whileTap={softPressTap}
      className="group flex items-center text-sm text-[var(--primary-text)]"
    >
      <SelectionCheck checked={checked} className="mr-2" />
      <span>{label}</span>
    </motion.button>
  );
}

function resolveDecimalPlaces(step: number): number {
  const text = String(step);
  const decimal = text.includes(".") ? text.split(".")[1]?.length ?? 0 : 0;
  return Math.min(6, decimal);
}
