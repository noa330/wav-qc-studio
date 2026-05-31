import { FastForward, Play, Rewind, Square, ExternalLink, HelpCircle } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { DetailField } from "@shared/ipc";
import { cn } from "@/lib/utils";
import { NumericField, Tooltip } from "@/shared/components/controls";
import type { AudioTransport } from "@/shared/hooks/use-audio-transport";
import { checkPopMotion, tightPressTap, softPressTap } from "@/shared/motion";


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
      <motion.button
        type="button"
        disabled={isDisabled}
        onClick={() => transport?.toggle()}
        whileTap={isDisabled ? undefined : tightPressTap}
        className={cn(
          "flex items-center justify-center size-10 rounded-full bg-[var(--accent-blue)] text-white hover:opacity-90 transition-opacity focus:outline-none mx-1.5 disabled:opacity-35"
        )}
        aria-label={transport?.isPlaying ? "정지" : "재생"}
      >
        <AnimatePresence mode="wait" initial={false}>
          {transport?.isPlaying ? (
            <motion.span key="stop" {...checkPopMotion} className="flex items-center justify-center">
              <Square className="size-4" fill="currentColor" />
            </motion.span>
          ) : (
            <motion.span key="play" {...checkPopMotion} className="flex items-center justify-center ml-0.5">
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

export interface ModelOptionItem<T extends string> {
  value: T;
  title: string;
  description: string;
  badgeText?: string;
  badgeType?: "purple" | "green" | "blue";
  tags?: string[];
}

export function ModelSelectionPanel<T extends string>({
  title,
  subtitle,
  options,
  selectedValue,
  onSelect,
  helpText,
  helpHref = "https://github.com",
}: {
  title: string;
  subtitle: string;
  options: ModelOptionItem<T>[];
  selectedValue: T;
  onSelect: (value: T) => void;
  helpText?: string;
  helpHref?: string;
}) {
  return (
    <div className="app-scrollbar h-full min-h-0 min-w-0 flex flex-col overflow-auto pr-1 text-left">
      {/* Title & Subtitle */}
      <div className="mb-4 text-left shrink-0 border-t border-[var(--panel-stroke)] pt-3 first:border-t-0 first:pt-0">
        <div className="flex min-h-5 items-center gap-1.5 mb-1.5">
          <p className="text-sm font-normal text-[var(--primary-text)]">{title}</p>
        </div>
        <p className="text-xs leading-4 text-[var(--secondary-text)] px-0.5">
          {subtitle}
        </p>
      </div>

      {/* Model Options */}
      <div className="space-y-3 shrink-0">
        {options.map((option) => {
          const checked = selectedValue === option.value;
          const badgeClasses = option.badgeType ? {
            purple: "bg-[var(--accent)] text-[var(--primary)]",
            green: "bg-[#E6F4EA] text-[#137333] dark:bg-[#1C3A27] dark:text-[#34D399]",
            blue: "bg-[#E8F0FE] text-[#1A73E8] dark:bg-[#1E293B] dark:text-[#60A5FA]",
          }[option.badgeType] : "";

          return (
            <motion.button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={checked}
              onClick={() => onSelect(option.value)}
              whileTap={softPressTap}
              className={cn(
                "grid w-full min-w-0 grid-cols-[18px_minmax(0,1fr)] items-start gap-4 rounded-xl border border-[var(--panel-stroke)] p-3.5 text-left transition focus-visible:outline-none shadow-sm",
                checked
                  ? "bg-[var(--soft-selection-hover)]"
                  : "bg-[var(--field-bg)] hover:bg-[var(--soft-selection-hover)]"
              )}
            >
              <span className={cn(
                "relative size-[18px] shrink-0 rounded-full border transition-colors mt-0.5",
                checked ? "border-[var(--accent-blue)] bg-transparent" : "border-[var(--secondary-text)] bg-transparent"
              )}>
                {checked ? (
                  <span className="absolute left-1/2 top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--accent-blue)]" />
                ) : null}
              </span>
              <div className="flex flex-col gap-1.5 min-w-0 w-full">
                {/* Title and Badge row */}
                <div className="flex items-center justify-between w-full">
                  <span className="text-sm font-semibold leading-5 text-[var(--primary-text)]">{option.title}</span>
                  {option.badgeText && (
                    <span className={cn("rounded-[3px] px-2 py-0.5 text-xs font-semibold leading-4", badgeClasses)}>
                      {option.badgeText}
                    </span>
                  )}
                </div>

                {/* Description row */}
                <p className="text-xs leading-normal text-[var(--secondary-text)]">
                  {option.description}
                </p>

                {/* Tags row */}
                {option.tags && option.tags.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 mt-1">
                    {option.tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-[3px] border border-[var(--panel-stroke)] bg-[var(--field-bg)] px-2.5 py-1 text-xs font-normal text-[var(--secondary-text)] leading-3"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </motion.button>
          );
        })}
      </div>

      {/* Spacer to push help card to the bottom */}
      <div className="flex-grow min-h-[30px]" />

      {/* Help Card */}
      {helpText && (
        <div className="mt-5 rounded-[5px] border border-[var(--panel-stroke)] bg-[var(--table-header-bg)] p-4 text-left shrink-0 mb-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[var(--primary-text)]">
              <HelpCircle className="size-[16px]" strokeWidth={2.2} />
              <span className="text-[14px] font-semibold">도움말</span>
            </div>
            <a
              href={helpHref}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--secondary-text)] hover:text-[var(--primary)] transition-colors"
              aria-label="도움말 외부 링크"
            >
              <ExternalLink className="size-4" strokeWidth={1.8} />
            </a>
          </div>
          <p className="mt-2 text-[12px] leading-5 text-[var(--secondary-text)]">
            {helpText}
          </p>
        </div>
      )}
    </div>
  );
}

