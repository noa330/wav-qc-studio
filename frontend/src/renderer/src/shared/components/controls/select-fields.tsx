import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence } from "motion/react";
import { cn } from "@/lib/utils";
import { DropdownMenuEmpty, DropdownMenuHeader, DropdownMenuOption, DropdownMenuSurface, estimateDropdownOptionHeight } from "@/shared/components/dropdown-menu";
import { CONTROL_ARROW_SLOT_CLASS, CONTROL_TEXT_CLASS } from "./control-styles";
import { ChevronGlyph } from "./chevron-glyph";

export function SelectField<T extends string>({
  value,
  options,
  onChange,
  onOpen,
  ariaLabel,
  placeholder,
  emptyText = "선택 가능한 항목이 없습니다.",
  dropdownClassName,
}: {
  value: T | "";
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  onOpen?: () => void | Promise<unknown>;
  ariaLabel: string;
  placeholder?: string;
  emptyText?: string;
  dropdownClassName?: string;
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
                  className={cn("z-[1000]", dropdownClassName)}
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
