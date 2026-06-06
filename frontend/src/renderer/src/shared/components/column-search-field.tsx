import { Search } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence } from "motion/react";
import { cn } from "@/lib/utils";
import { ChevronGlyph } from "@/shared/components/controls";
import { DropdownMenuHeader, DropdownMenuOption, DropdownMenuSeparator, DropdownMenuSurface } from "@/shared/components/dropdown-menu";

export type ColumnSearchOption = {
  key: string;
  label: string;
};

export function ColumnSearchField({
  value,
  onChange,
  options,
  selectedKeys,
  onSelectedKeysChange,
  ariaLabel,
  placeholder = "\uac80\uc0c9\uc5b4\ub97c \uc785\ub825\ud558\uc138\uc694.",
  onSubmit,
  headerLabel = "\uac80\uc0c9 \uc5f4 \uc120\ud0dd",
  allOptionLabel = "\uc804\uccb4 \uc5f4",
  density = "default",
}: {
  value: string;
  onChange: (value: string) => void;
  options: ColumnSearchOption[];
  selectedKeys: string[];
  onSelectedKeysChange: (keys: string[]) => void;
  ariaLabel: string;
  placeholder?: string;
  onSubmit?: () => void;
  headerLabel?: string;
  allOptionLabel?: string;
  density?: "default" | "header";
}) {
  const [open, setOpen] = useState(false);
  const [menuGeometry, setMenuGeometry] = useState<{ left: number; top?: number; bottom?: number; transformOrigin?: string; width: number; maxHeight: number } | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) {
      return;
    }

    const updateGeometry = () => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }

      const spaceBelow = Math.max(0, window.innerHeight - rect.bottom - 8);
      const spaceAbove = Math.max(0, rect.top - 8);

      if (spaceBelow < 260 && spaceAbove > spaceBelow) {
        setMenuGeometry({
          left: rect.left,
          top: undefined,
          bottom: window.innerHeight - rect.top + 4,
          transformOrigin: "bottom",
          width: Math.max(rect.width, 240),
          maxHeight: Math.min(260, spaceAbove),
        });
      } else {
        setMenuGeometry({
          left: rect.left,
          top: rect.bottom + 4,
          bottom: undefined,
          transformOrigin: "top",
          width: Math.max(rect.width, 240),
          maxHeight: Math.max(142, Math.min(260, spaceBelow || 260)),
        });
      }
    };

    updateGeometry();
    window.addEventListener("resize", updateGeometry);
    window.addEventListener("scroll", updateGeometry, true);
    return () => {
      window.removeEventListener("resize", updateGeometry);
      window.removeEventListener("scroll", updateGeometry, true);
    };
  }, [open]);

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

  const toggleColumn = (key: string) => {
    if (selectedKeys.length === 0) {
      onSelectedKeysChange([key]);
      return;
    }

    const nextKeys = selectedKeys.includes(key) ? selectedKeys.filter((selectedKey) => selectedKey !== key) : [...selectedKeys, key];
    onSelectedKeysChange(nextKeys.length === options.length ? [] : nextKeys);
  };

  return (
    <div ref={rootRef} className="relative min-w-0">
      <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--icon-brush)]" />
      <input
        ref={inputRef}
        className={cn("wpf-field w-full min-w-0 truncate px-9 pr-8 text-sm outline-none", density === "header" ? "wpf-header-control" : "h-[38px]")}
        placeholder={placeholder}
        value={value}
        aria-label={ariaLabel}
        aria-controls={menuId}
        aria-expanded={open}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            onSubmit?.();
          }
        }}
      />
      <span className={cn("pointer-events-none absolute right-0 top-0 flex w-8 items-center justify-center text-[var(--control-arrow)]", density === "header" ? "h-8" : "h-[38px]")} aria-hidden="true">
        <ChevronGlyph direction={open ? "up" : "down"} />
      </span>
      {menuGeometry
        ? createPortal(
            <AnimatePresence>
              {open ? (
                <DropdownMenuSurface
                  ref={menuRef}
                  id={menuId}
                  className="z-[1300]"
                  style={{ left: menuGeometry.left, top: menuGeometry.top, bottom: menuGeometry.bottom, transformOrigin: menuGeometry.transformOrigin, width: menuGeometry.width, maxHeight: menuGeometry.maxHeight }}
                  onMouseDown={(event) => event.preventDefault()}
                >
                  <DropdownMenuHeader>{headerLabel}</DropdownMenuHeader>
                  <DropdownMenuOption label={allOptionLabel} checked={selectedKeys.length === 0} onClick={() => onSelectedKeysChange([])} />
                  <DropdownMenuSeparator />
                  {options.map((option) => (
                    <DropdownMenuOption key={option.key} label={option.label} checked={selectedKeys.length === 0 || selectedKeys.includes(option.key)} onClick={() => toggleColumn(option.key)} />
                  ))}
                </DropdownMenuSurface>
              ) : null}
            </AnimatePresence>,
            document.body,
          )
        : null}
    </div>
  );
}
