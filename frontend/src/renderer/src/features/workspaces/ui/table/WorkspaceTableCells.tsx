import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { ChevronGlyph } from "@/shared/components/controls";
import type { CellRenderContext } from "@/shared/components/data-grid";
import { DropdownMenuHeader, DropdownMenuOption, DropdownMenuSurface } from "@/shared/components/dropdown-menu";
import { tightPressTap } from "@/shared/motion";
import { collectBatchSpeakers } from "../../model/batch-filter";
import type { WorkspaceRuntime } from "../../state/use-workspace-runtime";
import { BatchAutoTranscriptCell } from "../pages/batch/BatchPanels";


export function TaggingResultCell({ context }: { context: CellRenderContext }) {
  const { column, value } = context;
  if (column.key === "ngTags" && value && value !== "-") {
    return <div className="max-h-full overflow-hidden break-words font-semibold leading-5 text-[#ff8c96]">{value}</div>;
  }

  return <div className="max-h-full overflow-hidden truncate whitespace-nowrap leading-5">{value || "-"}</div>;
}

export function BatchEditableCell({ context, runtime, currentTime, audioActive }: { context: CellRenderContext; runtime: WorkspaceRuntime; currentTime: number; audioActive: boolean }) {
  const { row, column, value, rowLineClamp, selectRow } = context;
  const speakers = collectBatchSpeakers(runtime.getState("batch").table.rows);

  if (column.key === "autoTranscript") {
    return <BatchAutoTranscriptCell row={row} value={value} rowLineClamp={rowLineClamp} currentTime={currentTime} audioActive={audioActive} showAllAlignmentOutsideSegments={runtime.settings.batch.showAllAlignmentOutsideSegments} />;
  }

  if (column.key === "editedTranscript") {
    return <BatchTranscriptCell rowId={row.id} value={value} rowLineClamp={rowLineClamp} onSelect={selectRow} onCommit={(nextValue) => runtime.editBatchCell(row.id, "editedTranscript", nextValue)} />;
  }

  if (column.key === "speaker") {
    return <BatchSpeakerCell rowId={row.id} value={value} rowLineClamp={rowLineClamp} speakers={speakers} onSelect={selectRow} onCommit={(nextValue) => runtime.editBatchCell(row.id, "speaker", nextValue)} />;
  }

  if (column.key === "qcStatus") {
    return <BatchStatusCell value={value} onSelect={selectRow} onChange={(nextValue) => runtime.editBatchCell(row.id, "qcStatus", nextValue)} />;
  }

  return rowLineClamp <= 1 ? (
    <div className="max-h-full overflow-hidden truncate whitespace-nowrap leading-5">{value || "-"}</div>
  ) : (
    <div
      className="max-h-full overflow-hidden break-words leading-5"
      style={{ display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: rowLineClamp }}
    >
      {value || "-"}
    </div>
  );
}

function BatchTranscriptCell({ rowId, value, rowLineClamp, onSelect, onCommit }: { rowId: string; value: string; rowLineClamp: number; onSelect: () => void; onCommit: (value: string) => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (document.activeElement !== ref.current && ref.current) {
      ref.current.textContent = value || "";
    }
  }, [value]);
  const commit = () => {
    const nextValue = ref.current?.textContent ?? "";
    if (nextValue !== value) {
      onCommit(nextValue);
    }
  };

  return (
    <div
      ref={ref}
      role="textbox"
      tabIndex={0}
      contentEditable
      suppressContentEditableWarning
      aria-label={`${rowId} 편집 전사`}
      onMouseDown={onSelect}
      onFocus={onSelect}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
          (event.currentTarget as HTMLDivElement).blur();
        }
        if (event.key === "Escape") {
          event.currentTarget.textContent = value || "";
          (event.currentTarget as HTMLDivElement).blur();
        }
      }}
      className={cn("max-h-full min-h-5 overflow-hidden leading-5 outline-none", rowLineClamp <= 1 ? "truncate whitespace-nowrap" : "break-words")}
      style={rowLineClamp > 1 ? { display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: rowLineClamp } : undefined}
    >
      {value || ""}
    </div>
  );
}

function BatchSpeakerCell({ rowId, value, rowLineClamp, speakers, onSelect, onCommit }: { rowId: string; value: string; rowLineClamp: number; speakers: string[]; onSelect: () => void; onCommit: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const [menuGeometry, setMenuGeometry] = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const textRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (document.activeElement !== textRef.current && textRef.current) {
      textRef.current.textContent = value || "";
    }
  }, [value]);
  useEffect(() => {
    if (!open) {
      return;
    }
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }
    setMenuGeometry({
      left: rect.left,
      top: rect.bottom + 4,
      width: Math.max(rect.width, 180),
      maxHeight: Math.max(132, Math.min(240, window.innerHeight - rect.bottom - 8)),
    });
  }, [open, speakers.length]);
  useEffect(() => {
    if (!open) {
      return;
    }
    const close = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target || rootRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const commit = () => {
    const nextValue = (textRef.current?.textContent ?? "").trim();
    if (nextValue && nextValue !== value) {
      onCommit(nextValue);
    } else {
      if (textRef.current) {
        textRef.current.textContent = value || "";
      }
    }
  };
  const chooseSpeaker = (speaker: string) => {
    if (textRef.current) {
      textRef.current.textContent = speaker;
    }
    setOpen(false);
    onCommit(speaker);
  };

  return (
    <div ref={rootRef} className="relative flex h-full min-w-0 items-center pr-6" onMouseDown={onSelect}>
      <div
        ref={textRef}
        role="textbox"
        tabIndex={0}
        contentEditable
        suppressContentEditableWarning
        aria-label={`${rowId} 화자`}
        onFocus={onSelect}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            (event.currentTarget as HTMLDivElement).blur();
          }
          if (event.key === "Escape") {
            event.currentTarget.textContent = value || "";
            (event.currentTarget as HTMLDivElement).blur();
          }
        }}
        className={cn("min-w-0 flex-1 overflow-hidden leading-5 outline-none", rowLineClamp <= 1 ? "truncate whitespace-nowrap" : "break-words")}
        style={rowLineClamp > 1 ? { display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: rowLineClamp } : undefined}
      >
        {value || ""}
      </div>
      <motion.button type="button" whileTap={tightPressTap} className="absolute right-0 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center text-[var(--control-arrow)] hover:text-[var(--primary-text)]" aria-label="화자 선택" onClick={() => setOpen((current) => !current)}>
        <ChevronGlyph direction={open ? "up" : "down"} />
      </motion.button>
      {open && menuGeometry
        ? createPortal(
            <DropdownMenuSurface
              ref={menuRef}
              className="z-[1160]"
              style={{ left: menuGeometry.left, top: menuGeometry.top, width: menuGeometry.width, maxHeight: menuGeometry.maxHeight }}
            >
              <DropdownMenuHeader>{"\ud654\uc790 \uc120\ud0dd"}</DropdownMenuHeader>
              {speakers.map((speaker) => (
                <DropdownMenuOption key={speaker} checked={speaker === value} label={speaker} onClick={() => chooseSpeaker(speaker)} />
              ))}
            </DropdownMenuSurface>,
            document.body,
          )
        : null}
    </div>
  );
}

function BatchStatusCell({ value, onSelect, onChange }: { value: string; onSelect: () => void; onChange: (value: string) => void }) {
  const status = value === "검수됨" || value === "수정됨" || value === "검수전" ? value : "검수전";
  const [open, setOpen] = useState(false);
  const [menuGeometry, setMenuGeometry] = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const options = ["검수전", "수정됨", "검수됨"];
  useEffect(() => {
    if (!open) {
      return;
    }
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }
    setMenuGeometry({
      left: rect.left,
      top: rect.bottom + 4,
      width: Math.max(rect.width, 160),
      maxHeight: 132,
    });
  }, [open]);
  useEffect(() => {
    if (!open) {
      return;
    }
    const close = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target || rootRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const chooseStatus = (nextStatus: string) => {
    setOpen(false);
    onChange(nextStatus);
  };

  return (
    <div ref={rootRef} className="relative flex h-full min-w-0 items-center pr-6" onMouseDown={onSelect}>
      <span className="min-w-0 flex-1 overflow-hidden truncate whitespace-nowrap leading-5">
        {status}
      </span>
      <motion.button type="button" whileTap={tightPressTap} className="absolute right-0 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center text-[var(--control-arrow)] hover:text-[var(--primary-text)]" aria-label="검수 상태 선택" onClick={() => setOpen((current) => !current)}>
        <ChevronGlyph direction={open ? "up" : "down"} />
      </motion.button>
      {open && menuGeometry
        ? createPortal(
            <DropdownMenuSurface
              ref={menuRef}
              className="z-[1160]"
              style={{ left: menuGeometry.left, top: menuGeometry.top, width: menuGeometry.width, maxHeight: menuGeometry.maxHeight }}
            >
              <DropdownMenuHeader>{"\uac80\uc218 \uc0c1\ud0dc \uc120\ud0dd"}</DropdownMenuHeader>
              {options.map((option) => (
                <DropdownMenuOption key={option} checked={option === status} label={option} onClick={() => chooseStatus(option)} />
              ))}
            </DropdownMenuSurface>,
            document.body,
          )
        : null}
    </div>
  );
}
