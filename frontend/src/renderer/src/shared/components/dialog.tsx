import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { dialogPanelMotion, menuMotion, tightPressTap } from "@/shared/motion";

export function AppDialog({
  title,
  description,
  children,
  footer,
  widthClassName = "w-[min(430px,calc(100vw-32px))]",
  onClose,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  footer: ReactNode;
  widthClassName?: string;
  onClose: () => void;
}) {
  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={menuMotion.transition}
      className="fixed inset-0 z-[2200] flex items-center justify-center bg-black/45 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="app-dialog-title"
    >
      <motion.div
        {...dialogPanelMotion}
        className={cn("rounded-[5px] border border-[var(--panel-stroke)] bg-[var(--shell-chrome-card-bg)] p-4 shadow-[var(--app-dialog-shadow)]", widthClassName)}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h4 id="app-dialog-title" className="text-base font-normal text-[var(--primary-text)]">{title}</h4>
            {description ? <p className="mt-2 text-sm leading-5 text-[var(--secondary-text)]">{description}</p> : null}
          </div>
          <motion.button
            type="button"
            aria-label="닫기"
            onClick={onClose}
            whileTap={tightPressTap}
            className="flex size-8 shrink-0 items-center justify-center rounded-[5px] bg-[var(--table-header-bg)] text-[var(--primary-text)] hover:bg-[var(--soft-selection-hover)]"
          >
            <X className="size-4" strokeWidth={1.8} />
          </motion.button>
        </div>
        <div className="mt-4">{children}</div>
        <div className="mt-5 flex justify-end gap-2">{footer}</div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}

export function DialogTextField({
  id,
  label,
  value,
  placeholder,
  autoFocus,
  disabled,
  error,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  placeholder?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  error?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label htmlFor={id} className="block">
      <span className="mb-2 block text-[13px] font-normal leading-[18px] text-[var(--secondary-text)]">{label}</span>
      <input
        id={id}
        className="wpf-field h-[38px] w-full px-3 text-sm text-[var(--primary-text)] outline-none placeholder:text-[var(--secondary-text)] disabled:opacity-60"
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
      {error ? <span className="mt-2 block text-[13px] leading-[18px] text-[#ff8c96]">{error}</span> : null}
    </label>
  );
}
