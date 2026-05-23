import { FastForward, Play, Rewind, Square } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { DetailField } from "@shared/ipc";
import { cn } from "@/lib/utils";
import { NumericField, Tooltip } from "@/shared/components/controls";
import type { AudioTransport } from "@/shared/hooks/use-audio-transport";
import { checkPopMotion, tightPressTap } from "@/shared/motion";


const settingRowGridStyle: CSSProperties = {
  gridTemplateColumns: "minmax(0, clamp(58px, 34%, 112px)) minmax(0, 1fr)",
};

function SettingRow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("grid min-w-0 gap-2", className)} style={settingRowGridStyle}>
      {children}
    </div>
  );
}

export function SettingControlSlot({
  children,
  align = "start",
  className,
}: {
  children: ReactNode;
  align?: "start" | "center" | "end";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-[38px] min-w-0",
        align === "start" && "items-start",
        align === "center" && "items-center",
        align === "end" && "items-center justify-end",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function DetailTextArea({ label, value, editable, help }: { label: string; value: string; editable: boolean; help?: string }) {
  return (
    <SettingRow className="mb-3 items-start">
      <SettingLabel label={label} help={help} topAligned />
      <SettingControlSlot>
        <AutoResizeTextArea value={value} readOnly disabled={!editable} minHeight={38} />
      </SettingControlSlot>
    </SettingRow>
  );
}

export function DetailReadOnly({ label, value, help }: { label: string; value: string; help?: string }) {
  return (
    <SettingRow className="mb-3 items-start">
      <SettingLabel label={label} help={help} topAligned />
      <SettingControlSlot>
        <input className="wpf-field h-[38px] w-full px-3 text-sm text-[var(--primary-text)] outline-none" value={value} readOnly />
      </SettingControlSlot>
    </SettingRow>
  );
}

export function DetailFieldList({ fields, helpByLabel = {} }: { fields: DetailField[]; helpByLabel?: Record<string, string> }) {
  return (
    <div className="app-scrollbar h-full overflow-auto pr-1">
      {fields.map((field) => (
        <SettingRow key={field.label} className="mb-3 items-start">
          <SettingLabel label={field.label} help={helpByLabel[field.label]} topAligned />
          <SettingControlSlot>
            <input className="wpf-field h-[38px] w-full px-3 text-sm text-[var(--primary-text)] outline-none" value={field.value} readOnly />
          </SettingControlSlot>
        </SettingRow>
      ))}
    </div>
  );
}

export function BackendStatusBody({ status }: { status: string }) {
  return (
    <div className="rounded-[5px] border border-[var(--panel-stroke)] bg-[var(--field-bg)] p-4 text-sm text-[var(--secondary-text)]">
      현재 상태: <span className="text-[var(--primary-text)]">{status}</span>
    </div>
  );
}

export function SettingGroup({ title, help, children }: { title: string; help?: string; children: ReactNode }) {
  return (
    <div className="mb-5 border-t border-[var(--panel-stroke)] pt-3">
      <div className="mb-3 flex min-h-5 items-center gap-1.5">
        {help ? (
          <SettingTextTooltip label={title} help={help} titleClassName="text-sm font-normal leading-5 text-[var(--primary-text)]" />
        ) : (
          <p className="text-sm font-normal text-[var(--primary-text)]">{title}</p>
        )}
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function SettingTextTooltip({ label, help, titleClassName }: { label: string; help: string; titleClassName?: string }) {
  return (
    <Tooltip label={label} description={help} width={304}>
      <button
        type="button"
        className={cn(
          "max-w-full min-w-0 cursor-help appearance-none whitespace-normal break-words rounded-[3px] border-0 bg-transparent p-0 text-left transition-colors hover:text-[var(--primary-text)] focus-visible:text-[var(--primary-text)] focus-visible:outline-none",
          titleClassName ?? "text-[13px] font-normal leading-[18px] text-[var(--secondary-text)]",
        )}
        aria-label={`${label} 옵션 설명`}
      >
        {label}
      </button>
    </Tooltip>
  );
}
function SettingLabel({ label, help, topAligned = false }: { label: string; help?: string; topAligned?: boolean }) {
  return (
    <div className={cn("flex min-w-0", topAligned ? "items-start pt-[9px]" : "items-center")}>
      {help ? (
        <SettingTextTooltip label={label} help={help} />
      ) : (
        <p className="min-w-0 whitespace-normal text-[13px] leading-[18px] break-words text-[var(--secondary-text)]">{label}</p>
      )}
    </div>
  );
}

export function NumberSetting({
  label,
  value,
  onChange,
  step,
  min,
  max,
  wheelStep,
  help,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  step?: number;
  min?: number;
  max?: number;
  wheelStep?: number;
  help?: string;
}) {
  return (
    <SettingRow className="items-start">
      <SettingLabel label={label} help={help} topAligned />
      <SettingControlSlot>
        <NumericField value={value} step={step} min={min} max={max} wheelStep={wheelStep} onChange={onChange} ariaLabel={label} />
      </SettingControlSlot>
    </SettingRow>
  );
}

export function TextSetting({ label, value, onChange, help }: { label: string; value: string; onChange: (value: string) => void; help?: string }) {
  return (
    <SettingRow className="items-start">
      <SettingLabel label={label} help={help} topAligned />
      <SettingControlSlot>
        <AutoResizeTextArea value={value} onChange={onChange} ariaLabel={label} minHeight={38} />
      </SettingControlSlot>
    </SettingRow>
  );
}

export function TextAreaSetting({ label, value, onChange, help }: { label: string; value: string; onChange: (value: string) => void; help?: string }) {
  return (
    <SettingRow className="items-start">
      <SettingLabel label={label} help={help} topAligned />
      <SettingControlSlot>
        <AutoResizeTextArea value={value} onChange={onChange} ariaLabel={label} minHeight={38} />
      </SettingControlSlot>
    </SettingRow>
  );
}

export function SelectSetting({ label, help, children }: { label: string; help?: string; children: ReactNode }) {
  return (
    <SettingRow className="items-start">
      <SettingLabel label={label} help={help} topAligned />
      <SettingControlSlot align="center">{children}</SettingControlSlot>
    </SettingRow>
  );
}

function AutoResizeTextArea({
  value,
  onChange,
  ariaLabel,
  readOnly = false,
  disabled = false,
  minHeight,
}: {
  value: string;
  onChange?: (value: string) => void;
  ariaLabel?: string;
  readOnly?: boolean;
  disabled?: boolean;
  minHeight: number;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }

    const resize = () => {
      element.style.height = `${minHeight}px`;
      element.style.height = `${Math.max(minHeight, element.scrollHeight)}px`;
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element.parentElement ?? element);
    return () => observer.disconnect();
  }, [minHeight, value]);

  return (
    <textarea
      ref={ref}
      className="wpf-field min-h-[38px] w-full resize-none overflow-hidden px-3 py-2 text-sm leading-5 text-[var(--primary-text)] outline-none disabled:opacity-60"
      style={{ minHeight }}
      value={value}
      readOnly={readOnly}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(event) => onChange?.(event.target.value)}
    />
  );
}

export function EmptyPanel({ text, compact = false }: { text: string; compact?: boolean }) {
  return <div className={cn("flex h-full min-h-0 items-center justify-center text-center text-sm text-[var(--secondary-text)]", !compact && "min-h-[120px]")}>{text}</div>;
}

export function TransportButtons({ transport, disabled = false }: { transport?: AudioTransport; disabled?: boolean } = {}) {
  const isDisabled = disabled || !transport?.canPlay;

  return (
    <div className="flex items-center">
      <motion.button type="button" disabled={isDisabled} onClick={() => transport?.skip(-5)} whileTap={isDisabled ? undefined : tightPressTap} className="flex h-[38px] w-10 items-center justify-center text-[#D2D7E1] disabled:opacity-35" aria-label="5초 뒤로">
        <Rewind className="size-4" fill="currentColor" />
      </motion.button>
      <motion.button type="button" disabled={isDisabled} onClick={() => transport?.toggle()} whileTap={isDisabled ? undefined : tightPressTap} className="flex h-[38px] w-10 items-center justify-center text-[#D2D7E1] disabled:opacity-35" aria-label={transport?.isPlaying ? "정지" : "재생"}>
        <AnimatePresence mode="wait" initial={false}>
          {transport?.isPlaying ? (
            <motion.span key="stop" {...checkPopMotion}>
              <Square className="size-4" fill="currentColor" />
            </motion.span>
          ) : (
            <motion.span key="play" {...checkPopMotion}>
              <Play className="size-4" fill="currentColor" />
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>
      <motion.button type="button" disabled={isDisabled} onClick={() => transport?.skip(5)} whileTap={isDisabled ? undefined : tightPressTap} className="flex h-[38px] w-10 items-center justify-center text-[#D2D7E1] disabled:opacity-35" aria-label="5초 앞으로">
        <FastForward className="size-4" fill="currentColor" />
      </motion.button>
    </div>
  );
}
