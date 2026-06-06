import { FastForward, Play, Rewind, Square, ExternalLink, HelpCircle } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { DetailField } from "@shared/ipc";
import { cn } from "@/lib/utils";
import { NumericField, SelectionCheck, Tooltip, ToggleSwitch } from "@/shared/components/controls";
import type { AudioTransport } from "@/shared/hooks/use-audio-transport";
import { checkPopMotion, tightPressTap, softPressTap } from "@/shared/motion";


const settingRowGridStyle: CSSProperties = {
  gridTemplateColumns: "minmax(0, clamp(72px, 34%, 128px)) minmax(0, 1fr)",
};

function SettingRow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("grid min-w-0 gap-4", className)} style={settingRowGridStyle}>
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
      <SettingLabel label={label} topAligned />
      <SettingControlSlot>
        <AutoResizeTextArea value={value} readOnly disabled={!editable} minHeight={38} />
      </SettingControlSlot>
    </SettingRow>
  );
}

export function DetailReadOnly({ label, value, help }: { label: string; value: string; help?: string }) {
  return (
    <SettingRow className="mb-3 items-start">
      <SettingLabel label={label} topAligned />
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
          <SettingLabel label={field.label} topAligned />
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
  const titleElement = <p className="text-[14px] font-medium text-[var(--primary-text)]">{title}</p>;

  return (
    <div className="mb-8 border-t border-[var(--panel-stroke)] pt-6 first:border-t-0 first:pt-0 transition-all duration-200">
      <div className="mb-4 flex min-h-5 items-center">
        {help ? (
          <Tooltip label={title} description={help} width={304}>
            <button
              type="button"
              className="max-w-full min-w-0 cursor-help appearance-none whitespace-normal break-words rounded-[3px] border-0 bg-transparent p-0 text-left transition-colors hover:text-[var(--primary)] focus-visible:text-[var(--primary)] focus-visible:outline-none"
              aria-label={`${title} 설명`}
            >
              {titleElement}
            </button>
          </Tooltip>
        ) : (
          titleElement
        )}
      </div>
      <div className="space-y-5">{children}</div>
    </div>
  );
}

function SettingLabel({ label, topAligned = false, help }: { label: string; topAligned?: boolean; help?: string }) {
  const textElement = <p className="min-w-0 whitespace-normal text-[13px] font-medium leading-[18px] break-words text-[var(--secondary-text)]">{label}</p>;

  return (
    <div className={cn("flex min-w-0", topAligned ? "items-start pt-[10px]" : "items-center")}>
      {help ? (
        <Tooltip label={label} description={help} width={260}>
          <button
            type="button"
            className="max-w-full min-w-0 cursor-help appearance-none whitespace-normal break-words rounded-[3px] border-0 bg-transparent p-0 text-left transition-colors hover:text-[var(--primary)] focus-visible:text-[var(--primary)] focus-visible:outline-none"
            aria-label={`${label} 설명`}
          >
            {textElement}
          </button>
        </Tooltip>
      ) : (
        textElement
      )}
    </div>
  );
}

export type SettingLayoutMode = "horizontal" | "vertical";

function SettingLayoutWrapper({
  label,
  layout = "horizontal",
  topAligned = true,
  alignControl = "start",
  help,
  children,
}: {
  label: string;
  layout?: SettingLayoutMode;
  topAligned?: boolean;
  alignControl?: "start" | "center" | "end";
  help?: string;
  children: ReactNode;
}) {
  if (layout === "vertical") {
    const textElement = <span className="text-[13px] font-medium leading-[18px] text-[var(--secondary-text)]">{label}</span>;
    return (
      <div className="flex flex-col gap-1.5 min-w-0 w-full">
        <div className="flex items-center min-w-0">
          {help ? (
            <Tooltip label={label} description={help} width={260}>
              <button
                type="button"
                className="max-w-full min-w-0 cursor-help appearance-none whitespace-normal break-words rounded-[3px] border-0 bg-transparent p-0 text-left transition-colors hover:text-[var(--primary)] focus-visible:text-[var(--primary)] focus-visible:outline-none"
                aria-label={`${label} 설명`}
              >
                {textElement}
              </button>
            </Tooltip>
          ) : (
            textElement
          )}
        </div>
        <div className="w-full flex items-center min-h-[38px]">{children}</div>
      </div>
    );
  }

  return (
    <SettingRow className={topAligned ? "items-start" : "items-center"}>
      <SettingLabel label={label} topAligned={topAligned} help={help} />
      <SettingControlSlot align={alignControl} className={alignControl === "center" ? "w-full" : undefined}>{children}</SettingControlSlot>
    </SettingRow>
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
  layout = "horizontal",
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  step?: number;
  min?: number;
  max?: number;
  wheelStep?: number;
  help?: string;
  layout?: SettingLayoutMode;
}) {
  return (
    <SettingLayoutWrapper label={label} layout={layout} help={help}>
      <NumericField value={value} step={step} min={min} max={max} wheelStep={wheelStep} onChange={onChange} ariaLabel={label} />
    </SettingLayoutWrapper>
  );
}

export function TextSetting({
  label,
  value,
  onChange,
  help,
  layout = "horizontal",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  help?: string;
  layout?: SettingLayoutMode;
}) {
  return (
    <SettingLayoutWrapper label={label} layout={layout} help={help}>
      <AutoResizeTextArea value={value} onChange={onChange} ariaLabel={label} minHeight={38} />
    </SettingLayoutWrapper>
  );
}

export function TextAreaSetting({
  label,
  value,
  onChange,
  help,
  layout = "horizontal",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  help?: string;
  layout?: SettingLayoutMode;
}) {
  return (
    <SettingLayoutWrapper label={label} layout={layout} help={help}>
      <AutoResizeTextArea value={value} onChange={onChange} ariaLabel={label} minHeight={38} />
    </SettingLayoutWrapper>
  );
}

export function SelectSetting({
  label,
  help,
  children,
  layout = "horizontal",
}: {
  label: string;
  help?: string;
  children: ReactNode;
  layout?: SettingLayoutMode;
}) {
  return (
    <SettingLayoutWrapper label={label} layout={layout} alignControl="center" help={help}>
      {children}
    </SettingLayoutWrapper>
  );
}

export function ToggleSetting({
  label,
  checked,
  onChange,
  help,
  disabled = false,
  layout = "horizontal",
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  help?: string;
  disabled?: boolean;
  layout?: SettingLayoutMode;
}) {
  return (
    <SettingLayoutWrapper label={label} layout={layout} alignControl="end" help={help}>
      <ToggleSwitch checked={checked} onChange={onChange} disabled={disabled} />
    </SettingLayoutWrapper>
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
      <div className="mb-5 text-left shrink-0 border-t border-[var(--panel-stroke)] pt-3 first:border-t-0 first:pt-0">
        <div className="flex min-h-5 items-center gap-1.5 mb-1">
          <p className="text-[14px] font-medium text-[var(--primary-text)]">{title}</p>
        </div>
        <p className="text-[13px] font-normal leading-[18px] text-[var(--secondary-text)]">
          {subtitle}
        </p>
      </div>

      {/* Model Option Cards */}
      <div className="flex flex-col gap-3 shrink-0">
        {options.map((option) => {
          const checked = selectedValue === option.value;
          return (
            <motion.button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={checked}
              onClick={() => onSelect(option.value)}
              whileTap={softPressTap}
              className={cn(
                "group relative grid w-full min-w-0 grid-cols-[22px_minmax(0,1fr)] gap-3 rounded-xl border px-4 py-4 text-left outline-none",
                "transition-all duration-200 ease-out",
                checked
                  ? "border-[var(--model-option-selected-border)] bg-[var(--model-option-selected-bg)]"
                  : "border-[var(--model-option-idle-border)] bg-[var(--field-bg)] hover:border-[var(--model-option-hover-border)] hover:bg-[var(--soft-selection-hover)]",
              )}
              style={{
                boxShadow: checked ? "var(--model-option-selected-glow)" : "none",
              }}
            >
              <span className="flex h-full min-h-[82px] items-start justify-center pt-1">
                <SelectionCheck checked={checked} />
              </span>

              <div className="flex min-w-0 flex-col gap-1.5 overflow-hidden">
                <span className="min-w-0 truncate text-[15px] font-semibold leading-snug text-[var(--primary-text)]">{option.title}</span>

                <p className="mb-0 text-[12px] leading-[16px] text-[var(--secondary-text)]">
                  {option.description}
                </p>

                {/* Tags */}
                {option.tags && option.tags.length > 0 && (
                  <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2 border-t border-[var(--tag-border)] pt-3">
                    {option.tags.map((tag) => (
                      <ModelMetaChip
                        key={tag}
                        className="border border-[var(--tag-border)] bg-transparent font-normal text-[var(--secondary-text)]"
                      >
                        {tag}
                      </ModelMetaChip>
                    ))}
                  </div>
                )}
              </div>
            </motion.button>
          );
        })}
      </div>

      {/* Spacer */}
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

function ModelMetaChip({ children, className, style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <span
      className={cn(
        "inline-flex min-h-6 max-w-full items-center rounded-full px-2.5 py-1 text-[11px] leading-4",
        className,
      )}
      style={style}
    >
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}
