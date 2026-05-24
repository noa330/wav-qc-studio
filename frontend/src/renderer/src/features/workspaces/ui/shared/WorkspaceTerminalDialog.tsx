import { useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { Copy, Terminal, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { dialogPanelMotion, menuMotion, softPressTap, tightPressTap } from "@/shared/motion";
import type { WorkspaceTerminalState } from "../../state/workspace-runtime-store";

type WorkspaceTerminalDialogProps = {
  terminal: WorkspaceTerminalState;
  title: string;
  onClear: () => void;
  onClose: () => void;
};

export function WorkspaceTerminalDialog({ terminal, title, onClear, onClose }: WorkspaceTerminalDialogProps) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const lines = useMemo(() => splitTerminalLines(terminal.text), [terminal.text]);

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) {
      return;
    }

    body.scrollTop = body.scrollHeight;
  }, [terminal.text]);

  const copyTerminal = () => {
    if (!terminal.text.trim()) {
      return;
    }

    void navigator.clipboard?.writeText(terminal.text);
  };

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={menuMotion.transition}
      className="fixed inset-0 z-[1200] flex items-center justify-center bg-[#05080dcc] px-6 py-6"
    >
      <motion.div
        {...dialogPanelMotion}
        className="flex h-[min(780px,calc(100vh-48px))] w-[min(1240px,calc(100vw-48px))] min-h-0 flex-col rounded-[5px] border border-[var(--panel-stroke)] bg-[var(--panel-bg)] p-5 shadow-2xl"
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-[5px] bg-[var(--table-header-bg)] text-[var(--primary-text)]">
              <Terminal className="size-4" strokeWidth={1.8} />
            </span>
            <div className="min-w-0">
              <h4 className="truncate text-base font-normal leading-5 text-[var(--primary-text)]">{title}</h4>
              <div className="mt-0.5 flex min-w-0 items-center gap-2 text-[13px] font-normal leading-[18px] text-[var(--secondary-text)]">
                <span className={cn("size-2 rounded-full", statusDotClass(terminal.status))} />
                <span className="whitespace-nowrap">{statusLabel(terminal.status)}</span>
                {terminal.logPath ? <span className="truncate">· {terminal.logPath}</span> : null}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <motion.button type="button" onClick={copyTerminal} whileTap={softPressTap} className="wpf-button flex h-8 items-center gap-2 px-3 text-sm font-normal" disabled={!terminal.text.trim()}>
              <Copy className="size-3.5" strokeWidth={1.8} />
              복사
            </motion.button>
            <motion.button type="button" onClick={onClear} whileTap={softPressTap} className="wpf-button flex h-8 items-center gap-2 px-3 text-sm font-normal" disabled={!terminal.text.trim()}>
              <Trash2 className="size-3.5" strokeWidth={1.8} />
              지우기
            </motion.button>
            <motion.button type="button" onClick={onClose} whileTap={tightPressTap} className="flex size-8 items-center justify-center rounded-[5px] bg-[var(--table-header-bg)] text-[var(--primary-text)]" aria-label="터미널 닫기">
              <X className="size-4" strokeWidth={1.8} />
            </motion.button>
          </div>
        </div>
        {terminal.command ? (
          <div className="mb-3 min-h-[34px] truncate rounded-[5px] border border-[var(--panel-stroke)] bg-[var(--field-bg)] px-3 py-2 font-mono text-[13px] font-normal leading-[18px] text-[var(--secondary-text)]" title={terminal.command}>
            {terminal.command}
          </div>
        ) : null}
        <div
          ref={bodyRef}
          className="app-scrollbar min-h-0 flex-1 overflow-auto rounded-[5px] border border-[var(--panel-stroke)] bg-[var(--field-bg)] px-4 py-3 font-mono text-[13px] font-normal leading-5 text-[var(--secondary-text)]"
        >
          {lines.length > 0 ? (
            lines.map((line, index) => (
              <div key={`${index}-${line}`} className={cn("min-h-5 whitespace-pre-wrap break-words", lineToneClass(line))}>
                {line || " "}
              </div>
            ))
          ) : (
            <div className="flex h-full min-h-[180px] items-center justify-center text-center font-sans text-sm text-[var(--secondary-text)]">
              아직 표시할 터미널 로그가 없습니다.
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}

function splitTerminalLines(text: string): string[] {
  const lines = text.trimEnd().split(/\r\n|\n|\r/u).map((line) => line.trimEnd());
  const collapsed: string[] = [];
  let blankCount = 0;

  for (const line of lines) {
    if (line.trim()) {
      collapsed.push(line);
      blankCount = 0;
      continue;
    }

    blankCount += 1;
    if (blankCount <= 1) {
      collapsed.push("");
    }
  }

  return collapsed.filter((line, index, allLines) => line.trim() || index < allLines.length - 1);
}

function statusLabel(status: WorkspaceTerminalState["status"]): string {
  switch (status) {
    case "running":
      return "실행 중";
    case "completed":
      return "완료";
    case "failed":
      return "실패";
    case "cancelled":
      return "중지됨";
    default:
      return "대기";
  }
}

function statusDotClass(status: WorkspaceTerminalState["status"]): string {
  switch (status) {
    case "running":
      return "bg-[var(--accent-blue)]";
    case "completed":
      return "bg-[#34d399]";
    case "failed":
      return "bg-[#ff8c96]";
    case "cancelled":
      return "bg-[#fbbf24]";
    default:
      return "bg-[var(--slider-rail)]";
  }
}

function lineToneClass(line: string): string {
  if (/\b(error|failed|traceback|exception)\b/iu.test(line)) {
    return "text-[#ff8c96]";
  }

  if (/\b(warn|warning|low confidence)\b/iu.test(line)) {
    return "text-[#fbbf24]";
  }

  if (/\b(progress|running|loading)\b/iu.test(line)) {
    return "text-[#b99cff]";
  }

  if (/\b(done|completed|success|finished)\b/iu.test(line)) {
    return "text-[#8ee6b0]";
  }

  return "text-[var(--secondary-text)]";
}
