import { forwardRef, type CSSProperties, type MouseEventHandler, type ReactNode } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { menuMotion, softPressTap } from "@/shared/motion";
import { SelectionCheck } from "./controls/basic-fields";

export type DropdownMenuGeometry = {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
};

export function estimateDropdownOptionHeight(label: string, width: number, { leadingSlot = true, suffix = false }: { leadingSlot?: boolean; suffix?: boolean } = {}): number {
  const horizontalPadding = 24 + (leadingSlot ? 30 : 0) + (suffix ? 58 : 0);
  const availableWidth = Math.max(32, width - horizontalPadding);
  const estimatedWidth = Array.from(label).reduce((sum, character) => sum + (character.charCodeAt(0) > 127 ? 13 : 7), 0);
  const lines = Math.max(1, Math.ceil(estimatedWidth / availableWidth));
  return Math.max(32, lines * 20 + 12);
}

export const DropdownMenuSurface = forwardRef<HTMLDivElement, {
  children: ReactNode;
  className?: string;
  id?: string;
  role?: string;
  style?: CSSProperties;
  onMouseDown?: MouseEventHandler<HTMLDivElement>;
}>(({ children, className, id, role, style, onMouseDown }, ref) => (
    <motion.div
      ref={ref}
      {...menuMotion}
      id={id}
      role={role}
      style={style}
      onMouseDown={onMouseDown}
      className={cn(
        "app-scrollbar fixed origin-top overflow-auto rounded-[3px] border border-[var(--panel-stroke)] bg-[var(--popover)] py-1 text-sm text-[var(--primary-text)] shadow-[var(--app-menu-shadow)]",
        className,
      )}
    >
      {children}
    </motion.div>
  ));
DropdownMenuSurface.displayName = "DropdownMenuSurface";

export function DropdownMenuHeader({ children }: { children: ReactNode }) {
  return <div className="px-3 pb-1.5 pt-1 text-[13px] leading-5 text-[var(--secondary-text)]">{children}</div>;
}

export function DropdownMenuSeparator({ className }: { className?: string }) {
  return <div className={cn("my-1 h-px bg-[var(--panel-stroke)]", className)} />;
}

export function DropdownMenuEmpty({ children }: { children: ReactNode }) {
  return <div className="min-h-[32px] px-3 py-1.5 leading-5 text-[var(--secondary-text)]">{children}</div>;
}

export function DropdownMenuOption({
  label,
  checked = false,
  checkable = true,
  icon,
  suffix,
  disabled,
  className,
  children,
  onClick,
  onMouseDown,
  role,
  type = "button",
  "aria-selected": ariaSelected,
  "aria-checked": ariaChecked,
}: {
  label?: ReactNode;
  checked?: boolean;
  checkable?: boolean;
  icon?: ReactNode;
  suffix?: ReactNode;
  disabled?: boolean;
  className?: string;
  children?: ReactNode;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  onMouseDown?: MouseEventHandler<HTMLButtonElement>;
  role?: string;
  type?: "button" | "submit" | "reset";
  "aria-selected"?: boolean;
  "aria-checked"?: boolean;
}) {
  const leading = checkable || icon;

  return (
    <motion.button
      type={type}
      disabled={disabled}
      role={role}
      aria-selected={ariaSelected}
      aria-checked={ariaChecked}
      onClick={onClick}
      onMouseDown={onMouseDown}
      whileTap={disabled ? undefined : softPressTap}
      className={cn(
        "grid min-h-[32px] w-full items-start gap-2 px-3 py-1.5 text-left text-sm leading-5 text-[var(--primary-text)] hover:bg-[var(--soft-selection-hover)] disabled:pointer-events-none",
        leading && suffix ? "grid-cols-[22px_minmax(0,1fr)_auto]" : leading ? "grid-cols-[22px_minmax(0,1fr)]" : suffix ? "grid-cols-[minmax(0,1fr)_auto]" : "grid-cols-1",
        checked && "bg-[var(--nav-selected-bg)] hover:bg-[var(--nav-selected-bg)]",
        disabled && !checked && "text-[var(--secondary-text)] opacity-55 hover:bg-transparent",
        className,
      )}
    >
      {leading ? (
        <span className="flex size-[22px] shrink-0 items-center justify-center">
          {icon ?? <SelectionCheck checked={checked} size={18} />}
        </span>
      ) : null}
      <span className="min-w-0 whitespace-normal break-words">{children ?? label}</span>
      {suffix ? <span className="shrink-0 whitespace-nowrap pt-px text-[12px] text-[var(--secondary-text)]">{suffix}</span> : null}
    </motion.button>
  );
}
