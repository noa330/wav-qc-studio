import { Check, ChevronDown, ChevronRight, ChevronUp } from "lucide-react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/utils";
import { checkPopMotion, menuMotion, quickEase, softPressTap, tightPressTap, uiSpring } from "@/shared/motion";
import { DropdownMenuEmpty, DropdownMenuHeader, DropdownMenuOption, DropdownMenuSurface, estimateDropdownOptionHeight } from "@/shared/components/dropdown-menu";

export function ChevronGlyph({ direction = "down", className }: { direction?: "down" | "up" | "right"; className?: string }) {
  const Icon = direction === "up" ? ChevronUp : direction === "right" ? ChevronRight : ChevronDown;
  return <Icon aria-hidden="true" className={cn("size-3.5 shrink-0 text-[var(--control-arrow)]", className)} strokeWidth={1.9} />;
}

const CONTROL_ARROW_SLOT_CLASS = "w-7 shrink-0";
const CONTROL_TEXT_CLASS = "min-w-0 whitespace-normal break-words leading-5";

export function SelectField<T extends string>({
  value,
  options,
  onChange,
  onOpen,
  ariaLabel,
  placeholder,
  emptyText = "선택 가능한 항목이 없습니다.",
}: {
  value: T | "";
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  onOpen?: () => void | Promise<unknown>;
  ariaLabel: string;
  placeholder?: string;
  emptyText?: string;
}) {
  const [open, setOpen] = useState(false);
  const [opening, setOpening] = useState(false);
  const [menuGeometry, setMenuGeometry] = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const openRequestRef = useRef(0);
  const listboxId = useId();
  const selectedOption = options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) {
      return;
    }

    const updateGeometry = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }

      const viewportMargin = 8;
      const menuGap = 4;
      const estimatedMenuHeight = Math.min(280, Math.max(36, 30 + options.reduce((sum, option) => sum + estimateDropdownOptionHeight(option.label, rect.width), 4)));
      const spaceBelow = Math.max(0, window.innerHeight - rect.bottom - viewportMargin);
      const spaceAbove = Math.max(0, rect.top - viewportMargin);
      const openUp = spaceBelow < estimatedMenuHeight && spaceAbove > spaceBelow;
      const available = openUp ? spaceAbove : spaceBelow;
      const maxHeight = Math.max(36, Math.min(280, available || estimatedMenuHeight));
      const positionedHeight = Math.min(estimatedMenuHeight, maxHeight);
      setMenuGeometry({
        left: rect.left,
        top: openUp ? Math.max(viewportMargin, rect.top - positionedHeight - menuGap) : rect.bottom + menuGap,
        width: rect.width,
        maxHeight,
      });
    };

    updateGeometry();
    window.addEventListener("resize", updateGeometry);
    window.addEventListener("scroll", updateGeometry, true);
    return () => {
      window.removeEventListener("resize", updateGeometry);
      window.removeEventListener("scroll", updateGeometry, true);
    };
  }, [open, options]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target || rootRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }

      setOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        buttonRef.current?.focus();
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const closeMenu = useCallback(() => {
    openRequestRef.current += 1;
    setOpening(false);
    setOpen(false);
  }, []);

  const requestOpen = useCallback(() => {
    if (open || opening) {
      return;
    }

    const requestId = openRequestRef.current + 1;
    openRequestRef.current = requestId;
    setOpening(true);

    void Promise.resolve(onOpen?.())
      .catch((error) => {
        console.error(error);
      })
      .finally(() => {
        if (openRequestRef.current !== requestId) {
          return;
        }
        setOpening(false);
        setOpen(true);
      });
  }, [onOpen, open, opening]);

  const selectOption = (nextValue: T) => {
    onChange(nextValue);
    closeMenu();
    buttonRef.current?.focus();
  };

  return (
    <div ref={rootRef} className="relative min-h-[38px] w-full min-w-0">
      <button
        ref={buttonRef}
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-busy={opening}
        aria-controls={listboxId}
        aria-haspopup="listbox"
        className="wpf-field grid min-h-[38px] w-full min-w-0 grid-cols-[minmax(0,1fr)_28px] items-start px-2 py-2 pr-0 text-left text-sm text-[var(--primary-text)] outline-none focus-visible:border-[var(--nav-selected-bg)]"
        onClick={() => {
          if (open || opening) {
            closeMenu();
          } else {
            requestOpen();
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "Enter") {
            event.preventDefault();
            requestOpen();
          }
        }}
      >
        <span className={cn(CONTROL_TEXT_CLASS, "pr-2")}>{opening ? "불러오는 중..." : selectedOption?.label ?? placeholder ?? value}</span>
        <span className={cn(CONTROL_ARROW_SLOT_CLASS, "flex self-stretch items-start justify-center pt-[3px]")}>
          <ChevronGlyph direction={open || opening ? "up" : "down"} />
        </span>
      </button>
      {menuGeometry
        ? createPortal(
            <AnimatePresence>
              {open ? (
                <DropdownMenuSurface
                  ref={menuRef}
                  id={listboxId}
                  role="listbox"
                  className="z-[1000]"
                  style={{ left: menuGeometry.left, top: menuGeometry.top, width: menuGeometry.width, maxHeight: menuGeometry.maxHeight }}
                >
                  <DropdownMenuHeader>{ariaLabel}</DropdownMenuHeader>
                  {options.length > 0 ? (
                    options.map((option) => {
                      const selected = option.value === value;
                      return (
                        <DropdownMenuOption
                          key={option.value}
                          role="option"
                          aria-selected={selected}
                          checked={selected}
                          label={option.label}
                          onClick={() => selectOption(option.value)}
                        />
                      );
                    })
                  ) : (
                    <DropdownMenuEmpty>{emptyText}</DropdownMenuEmpty>
                  )}
                </DropdownMenuSurface>
              ) : null}
            </AnimatePresence>,
            document.body,
          )
        : null}
    </div>
  );
}

export function ComboboxField({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [menuGeometry, setMenuGeometry] = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const listboxId = useId();
  const visibleOptions = options;

  const resizeInput = useCallback(() => {
    const input = inputRef.current;
    if (!input) {
      return;
    }

    input.style.height = "38px";
    input.style.height = `${Math.max(38, input.scrollHeight)}px`;
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }

    const updateGeometry = () => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }

      const viewportMargin = 8;
      const menuGap = 4;
      const estimatedMenuHeight = Math.min(280, Math.max(36, 30 + visibleOptions.reduce((sum, option) => sum + estimateDropdownOptionHeight(option.label, rect.width), 4)));
      const spaceBelow = Math.max(0, window.innerHeight - rect.bottom - viewportMargin);
      const spaceAbove = Math.max(0, rect.top - viewportMargin);
      const openUp = spaceBelow < estimatedMenuHeight && spaceAbove > spaceBelow;
      const available = openUp ? spaceAbove : spaceBelow;
      const maxHeight = Math.max(36, Math.min(280, available || estimatedMenuHeight));
      const positionedHeight = Math.min(estimatedMenuHeight, maxHeight);
      setMenuGeometry({
        left: rect.left,
        top: openUp ? Math.max(viewportMargin, rect.top - positionedHeight - menuGap) : rect.bottom + menuGap,
        width: rect.width,
        maxHeight,
      });
    };

    updateGeometry();
    window.addEventListener("resize", updateGeometry);
    window.addEventListener("scroll", updateGeometry, true);
    return () => {
      window.removeEventListener("resize", updateGeometry);
      window.removeEventListener("scroll", updateGeometry, true);
    };
  }, [open, visibleOptions]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target || rootRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }

      setOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        inputRef.current?.focus();
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  useLayoutEffect(() => {
    resizeInput();
    const root = rootRef.current;
    if (!root) {
      return undefined;
    }

    const observer = new ResizeObserver(resizeInput);
    observer.observe(root);
    return () => observer.disconnect();
  }, [resizeInput, value]);

  const selectOption = (nextValue: string) => {
    onChange(nextValue);
    setOpen(false);
    inputRef.current?.focus();
  };

  return (
    <div ref={rootRef} className="relative min-h-[38px] w-full min-w-0">
      <div className="wpf-field grid min-h-[38px] w-full min-w-0 grid-cols-[minmax(0,1fr)_28px] items-start px-2 py-0 pr-0 text-left text-sm text-[var(--primary-text)] outline-none focus-within:border-[var(--nav-selected-bg)]">
        <textarea
          ref={inputRef}
          rows={1}
          value={value}
          aria-label={ariaLabel}
          aria-expanded={open}
          aria-controls={listboxId}
          aria-haspopup="listbox"
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            onChange(event.target.value.replace(/\r?\n/g, ""));
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setOpen(true);
            }
            if (event.key === "Enter" && open && visibleOptions.length > 0) {
              event.preventDefault();
              selectOption(visibleOptions[0].value);
            }
            if (event.key === "Enter") {
              event.preventDefault();
            }
          }}
          className="block min-h-[38px] min-w-0 resize-none overflow-hidden break-all border-0 bg-transparent p-0 py-2 pr-2 text-sm leading-5 text-[var(--primary-text)] outline-none"
        />
        <button
          type="button"
          tabIndex={-1}
          className={cn(CONTROL_ARROW_SLOT_CLASS, "flex self-stretch items-start justify-center pt-[11px]")}
          aria-label={`${ariaLabel} 목록`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            setOpen((current) => !current);
            inputRef.current?.focus();
          }}
        >
          <ChevronGlyph direction={open ? "up" : "down"} />
        </button>
      </div>
      {menuGeometry
        ? createPortal(
            <AnimatePresence>
              {open ? (
                <DropdownMenuSurface
                  ref={menuRef}
                  id={listboxId}
                  role="listbox"
                  className="z-[1000]"
                  style={{ left: menuGeometry.left, top: menuGeometry.top, width: menuGeometry.width, maxHeight: menuGeometry.maxHeight }}
                >
                  <DropdownMenuHeader>{ariaLabel}</DropdownMenuHeader>
                  {visibleOptions.length > 0 ? (
                    visibleOptions.map((option) => {
                      const selected = option.value === value;
                      return (
                        <DropdownMenuOption
                          key={option.value}
                          role="option"
                          aria-selected={selected}
                          checked={selected}
                          label={option.label}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => selectOption(option.value)}
                        />
                      );
                    })
                  ) : (
                    <DropdownMenuEmpty>일치하는 모델 없음</DropdownMenuEmpty>
                  )}
                </DropdownMenuSurface>
              ) : null}
            </AnimatePresence>,
            document.body,
          )
        : null}
    </div>
  );
}

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

function resolveDecimalPlaces(step: number): number {
  const text = String(step);
  const decimal = text.includes(".") ? text.split(".")[1]?.length ?? 0 : 0;
  return Math.min(6, decimal);
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
      className={cn("relative ml-auto h-[18px] w-9 shrink-0 justify-self-end rounded-full transition", checked ? "bg-[var(--accent-blue)]" : "bg-[#5A6470]", disabled && "opacity-45")}
    >
      <motion.span
        initial={false}
        animate={{ x: checked ? 20 : 2 }}
        transition={quickEase}
        className="absolute left-0 top-0.5 size-3.5 rounded-full bg-[var(--primary-text)]"
      />
    </motion.button>
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
    <span ref={rootRef} className={cn("inline-flex", className)} onPointerEnter={show} onPointerLeave={scheduleHide} onFocus={show} onBlur={scheduleHide}>
      {children}
      {open
        ? createPortal(
            <motion.div
              initial={{ opacity: 0, y: position.placement === "top" ? 4 : -4, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: position.placement === "top" ? 4 : -4, scale: 0.985 }}
              transition={menuMotion.transition}
              className="app-scrollbar fixed z-[1000] max-h-[360px] overflow-auto rounded-[5px] border border-[var(--panel-stroke)] bg-[#0d131c]/95 p-3 text-[13px] leading-5 text-[var(--secondary-text)] shadow-[0_16px_36px_rgba(0,0,0,.42)] backdrop-blur"
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
    <motion.button type="button" onClick={() => onChange(!checked)} whileTap={softPressTap} className="flex items-center text-sm text-[var(--primary-text)]">
      <span className={cn("mr-2 flex size-[18px] items-center justify-center rounded-[3px] border border-[var(--secondary-text)]", checked && "border-[var(--accent-blue)] bg-[var(--accent-blue)]")}>
        <AnimatePresence initial={false}>{checked ? <motion.span {...checkPopMotion}><Check className="size-3" /></motion.span> : null}</AnimatePresence>
      </span>
      {label}
    </motion.button>
  );
}
