import type { DataTableRow } from "@shared/ipc";
import { LoaderCircle, Square, Pencil, MoreVertical, Sparkles, GitMerge, Power } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState, useEffect } from "react";
import type { KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import { SelectionCheck, ToggleSwitch } from "@/shared/components/controls";
import { DataGrid } from "@/shared/components/data-grid";
import { loadingDotTransition, loadingSpinnerTransition, tightPressTap, checkPopMotion, softPressTap, shapeMorphVariants, shapeMorphTransition } from "@/shared/motion";
import { readBatchTranscriptGaps, readBatchTranscriptMuteIntervals, readBatchWords, type BatchTranscriptGap, type BatchWordAlignment } from "../../../model/batch-alignment";
import { collectBatchSpeakers } from "../../../model/batch-filter";
import type { WorkspaceRuntime } from "../../../state/use-workspace-runtime";
import { WorkspaceAudioPlaybackPanel } from "../../shared/WorkspaceAudioPlaybackPanel";
import { requestWorkspaceAudioPreview, requestWorkspaceAudioSeek, useWorkspaceAudioSync } from "../../shared/workspace-audio-sync";
import { EmptyPanel } from "../../shared/workspace-panel-primitives";
import { ColumnSearchField } from "@/shared/components/column-search-field";

export { BatchModelSettingsBody } from "./BatchModelSettingsBody";

const SPEAKER_COLORS = [
  "#8B5CF6", // Purple
  "#10B981", // Green
  "#3B82F6", // Blue
  "#EF4444", // Red
  "#F59E0B", // Orange
  "#EC4899", // Pink
  "#06B6D4", // Cyan
  "#84CC16", // Lime
];

function getSpeakerColor(speaker: string): string {
  if (!speaker) return "#9CA3AF";
  let hash = 0;
  for (let i = 0; i < speaker.length; i++) {
    hash = speaker.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % SPEAKER_COLORS.length;
  return SPEAKER_COLORS[index];
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  if (clean.length !== 6) {
    return `rgba(156, 163, 175, ${alpha})`;
  }
  const red = Number.parseInt(clean.slice(0, 2), 16);
  const green = Number.parseInt(clean.slice(2, 4), 16);
  const blue = Number.parseInt(clean.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

export function BatchSpeakerSelectionBody({ runtime, rows }: { runtime: WorkspaceRuntime; rows: DataTableRow[] }) {
  const state = runtime.getState("batch");
  const speakers = collectBatchSpeakers(rows);
  const [checkedSpeakers, setCheckedSpeakers] = useState<Set<string>>(new Set());
  const [renamingSpeaker, setRenamingSpeaker] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  
  const [searchText, setSearchText] = useState("");
  const [filterKeys, setFilterKeys] = useState<string[]>([]);

  const totalDuration = useMemo(() => {
    let sum = 0;
    for (const row of rows) {
      const sec = Number(row.raw?.durationSec ?? row.raw?.duration_sec ?? 0);
      if (Number.isFinite(sec)) {
        sum += sec;
      }
    }
    return sum;
  }, [rows]);

  const formatTotalDuration = (seconds: number) => {
    const min = Math.floor(seconds / 60);
    const sec = Math.floor(seconds % 60);
    return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  };

  const searchOptions = useMemo(() => [
    { key: "active", label: "활성 화자만" },
    { key: "inactive", label: "비활성 화자만" }
  ], []);

  const handleSelectedKeysChange = (keys: string[]) => {
    if (keys.includes("active") && keys.includes("inactive")) {
      setFilterKeys([]);
    } else {
      setFilterKeys(keys);
    }
  };

  const filteredSpeakers = useMemo(() => {
    return speakers.filter((speaker) => {
      if (searchText.trim()) {
        const clean = searchText.trim().toLowerCase();
        if (!speaker.toLowerCase().includes(clean)) {
          return false;
        }
      }
      if (filterKeys.length > 0) {
        const isActive = state.batchSpeakerChecks[speaker] !== false;
        if (filterKeys.includes("active") && !isActive) {
          return false;
        }
        if (filterKeys.includes("inactive") && isActive) {
          return false;
        }
      }
      return true;
    });
  }, [speakers, searchText, filterKeys, state.batchSpeakerChecks]);

  useEffect(() => {
    if (speakers.length === 0) {
      setSearchText("");
      setFilterKeys([]);
    }
  }, [speakers]);

  useEffect(() => {
    setCheckedSpeakers((current) => {
      const next = new Set<string>();
      for (const speaker of current) {
        if (speakers.includes(speaker)) {
          next.add(speaker);
        }
      }
      return next;
    });
  }, [speakers]);

  const toggleChecked = (speaker: string) => {
    setCheckedSpeakers((current) => {
      const next = new Set(current);
      if (next.has(speaker)) {
        next.delete(speaker);
      } else {
        next.add(speaker);
      }
      return next;
    });
  };

  const startRename = (speaker: string) => {
    setRenamingSpeaker(speaker);
    setRenameValue(speaker);
  };

  const commitRename = (oldName: string) => {
    const cleanNew = renameValue.trim();
    if (cleanNew && cleanNew !== oldName) {
      runtime.renameBatchSpeaker(oldName, cleanNew);
    }
    setRenamingSpeaker(null);
  };

  const getSpeakerLineCount = (speaker: string) => {
    return rows.filter((row) => {
      const activeStage = (row.raw?.activeStage || row.raw?.active_stage || "").toLowerCase();
      if (activeStage === "diarizing" || activeStage === "preparing_diarization") {
        return false;
      }
      if (row.cells.speaker === "화자구분 중") {
        return false;
      }
      const currentSpeaker = row.raw?.speaker || row.raw?.speaker_groups || row.cells.speaker || "";
      return currentSpeaker === speaker;
    }).length;
  };

  const speakerStageRunning = rows.some((row) => {
    const activeStage = (row.raw?.activeStage || row.raw?.active_stage || "").toLowerCase();
    return activeStage === "diarizing" || activeStage === "preparing_diarization";
  });
  const speakerRunning = state.isBatchSpeakerRunning || speakerStageRunning;
  const canRunSpeaker = rows.length > 0 && Boolean(state.inputPath) && !state.isRunning && !state.isExporting && !speakerRunning;
  const canStopSpeaker = state.isBatchSpeakerRunning;

  // Execute Diarization (top purple button)
  const runSpeakerButton = (
    <motion.button
      type="button"
      disabled={speakerRunning ? !canStopSpeaker : !canRunSpeaker}
      onClick={() => void (speakerRunning ? runtime.cancelBatchSpeakerDiarization() : runtime.runBatchSpeakerDiarization())}
      whileTap={speakerRunning ? (canStopSpeaker ? tightPressTap : undefined) : canRunSpeaker ? tightPressTap : undefined}
      className={cn(
        "flex w-full items-center justify-center gap-2 transition shadow-sm",
        speakerRunning && canStopSpeaker 
          ? "wpf-danger-button disabled:opacity-45" 
          : "wpf-primary-button disabled:opacity-45 disabled:cursor-not-allowed"
      )}
      aria-label={speakerRunning ? "화자 구분 중지" : "화자 구분 실행"}
    >
      {speakerRunning && canStopSpeaker ? (
        <span className="inline-flex min-w-0 items-center justify-center">
          <Square className="mr-2 size-3.5 shrink-0" fill="currentColor" strokeWidth={1.7} />
          STOP (화자 구분 중지)
        </span>
      ) : (
        <span className="inline-flex min-w-0 items-center justify-center gap-2">
          <Sparkles className="size-4 shrink-0" />
          화자 구분 실행
        </span>
      )}
    </motion.button>
  );

  // Rerun selected speakers
  const handleRerunSelectedSpeakers = () => {
    if (checkedSpeakers.size === 0 || speakerRunning) {
      return;
    }
    void runtime.runSelectedSpeakersDiarization(Array.from(checkedSpeakers));
  };

  // Merge selected speakers
  const handleMergeSelectedSpeakers = () => {
    if (checkedSpeakers.size < 2 || speakerRunning) {
      return;
    }
    runtime.mergeEnabledBatchSpeakers(Array.from(checkedSpeakers));
    setCheckedSpeakers(new Set());
  };

  const speakerContent = (
    <div className="scroll-window-viewport mt-0 min-h-0 flex-1 overflow-y-scroll pb-2">
      {speakerRunning ? <BatchSpeakerLoadingPanel compact /> : null}
      {speakers.length === 0 && !speakerRunning ? (
        <div className="pr-1">
          <EmptyPanel text="표시할 결과가 없습니다." />
        </div>
      ) : filteredSpeakers.length === 0 ? (
        <div className="mr-1 flex h-full min-h-[120px] items-center justify-center text-center text-sm text-[var(--secondary-text)]">
          검색 결과가 없습니다.
        </div>
      ) : (
        <div className="flex flex-col gap-2 pr-1">
          {filteredSpeakers.map((speaker) => {
            const isChecked = checkedSpeakers.has(speaker);
            const speakerColor = getSpeakerColor(speaker);
            return (
              <div 
                key={speaker} 
                onClick={() => toggleChecked(speaker)}
                className={cn(
                  "group flex items-center gap-3 rounded-[var(--radius-md)] border px-4 py-3 transition cursor-pointer bg-[var(--field-bg)] hover:bg-[var(--soft-selection-hover)]",
                  isChecked ? "border-[var(--tag-border)]" : "border-[var(--panel-stroke)]",
                )}
                style={
                  {
                    "--speaker-color": speakerColor,
                    "--speaker-selection-halo": hexToRgba(speakerColor, 0.16),
                  } as React.CSSProperties
                }
              >
                {/* Color Dot / Checkbox */}
                <div className="relative flex size-[30px] shrink-0 items-center justify-center self-center">
                  {isChecked ? (
                    <motion.span
                      aria-hidden="true"
                      className="absolute size-6 rounded-full bg-[var(--speaker-selection-halo)]"
                      initial={{ opacity: 0, scale: 0.72 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0.18, ease: "easeOut" }}
                    />
                  ) : null}
                  <span
                    aria-hidden="true"
                    className={cn(
                      "absolute size-3 rounded-full bg-[var(--speaker-color)] transition-all duration-200",
                      "group-hover:scale-75 group-hover:opacity-0 group-focus-within:scale-75 group-focus-within:opacity-0",
                    )}
                  />
                  <span
                    className="absolute flex items-center justify-center opacity-0 scale-75 transition-all duration-200 group-hover:opacity-100 group-hover:scale-100 group-focus-within:opacity-100 group-focus-within:scale-100"
                    aria-hidden="true"
                  >
                    <SelectionCheck checked={isChecked} />
                  </span>
                </div>

                {/* Name + Line Count */}
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  {renamingSpeaker === speaker ? (
                    <input
                      type="text"
                      value={renameValue}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={() => commitRename(speaker)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRename(speaker);
                        if (e.key === "Escape") setRenamingSpeaker(null);
                      }}
                      autoFocus
                      className="min-w-0 flex-1 bg-transparent text-[13px] font-semibold text-[var(--primary-text)] outline-none border-b border-[var(--accent-blue)]"
                    />
                  ) : (
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-[13px] font-semibold leading-snug text-[var(--primary-text)]">
                        {speaker}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          startRename(speaker);
                        }}
                        className="inline-flex items-center text-[var(--secondary-text)] hover:text-[var(--primary-text)] transition opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                        title="이름 수정"
                      >
                        <Pencil className="size-3 shrink-0" />
                      </button>
                    </div>
                  )}
                  <span className="text-[12px] leading-none text-[var(--secondary-text)]">
                    대사 {getSpeakerLineCount(speaker)}개
                  </span>
                </div>

                {/* ToggleSwitch (Vertically Centered) */}
                <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
                  <ToggleSwitch 
                    checked={state.batchSpeakerChecks[speaker] !== false} 
                    onChange={() => runtime.toggleBatchSpeaker(speaker)} 
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      {/* ── 화자 구분 ── */}
      <div className="flex shrink-0 flex-col pb-5 pr-[14px]">
        <div className="mb-4 flex min-h-5 items-center justify-between">
          <p className="text-[14px] font-medium text-[var(--primary-text)]">화자 구분</p>
          {rows.length > 0 ? (
            <span className="text-[12px] tabular-nums text-[var(--secondary-text)]">
              {formatTotalDuration(totalDuration)}
            </span>
          ) : null}
        </div>
        {runSpeakerButton}
      </div>

      {/* ── 화자 목록 ── */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-t border-[var(--panel-stroke)] pt-4 pb-5">
        <div className="mb-2.5 flex shrink-0 items-center justify-between min-h-5 pr-[14px]">
          <p className="text-[14px] font-medium text-[var(--primary-text)]">화자 목록</p>
          {speakers.length > 0 ? (
            <span className="text-[12px] tabular-nums text-[var(--secondary-text)]">{speakers.length}명</span>
          ) : null}
        </div>

        {/* Search Field */}
        <div className="shrink-0 pb-2 pr-[14px]">
          <ColumnSearchField
            value={searchText}
            onChange={setSearchText}
            options={searchOptions}
            selectedKeys={filterKeys}
            onSelectedKeysChange={handleSelectedKeysChange}
            ariaLabel="화자 검색"
            placeholder="화자 검색..."
            headerLabel="검색 대상"
            allOptionLabel="전체 화자"
          />
        </div>

        {/* Main Speakers List Card */}
        {speakerContent}
      </div>

      {/* ── 선택 화자 작업 ── */}
      <div className="flex shrink-0 flex-col border-t border-[var(--panel-stroke)] pt-6 pb-1 pr-[14px]">
        <div className="flex flex-col gap-2.5 rounded-[5px] border border-[var(--panel-stroke)] bg-[var(--table-header-bg)] p-4">
          <div className="mb-0.5 flex min-h-5 items-center justify-between">
            <h5 className="text-[14px] font-medium text-[var(--primary-text)]">선택 화자 작업</h5>
            {checkedSpeakers.size > 0 ? (
              <span className="text-[12px] tabular-nums text-[var(--secondary-text)]">
                {checkedSpeakers.size}명 선택
              </span>
            ) : null}
          </div>

          {/* Merge Speakers */}
          <motion.button
            type="button"
            disabled={checkedSpeakers.size < 2 || state.isRunning || state.isExporting || speakerRunning}
            onClick={handleMergeSelectedSpeakers}
            whileTap={checkedSpeakers.size >= 2 && !speakerRunning ? softPressTap : undefined}
            className="wpf-action-button flex h-[38px] w-full items-center justify-center gap-2 px-4 text-sm font-semibold transition disabled:opacity-45 disabled:cursor-not-allowed"
          >
            <GitMerge className="size-4 shrink-0 transition" />
            선택 화자 병합
          </motion.button>

          {/* Rerun Selected Speakers */}
          <motion.button
            type="button"
            disabled={checkedSpeakers.size === 0 || state.isRunning || state.isExporting || speakerRunning}
            onClick={handleRerunSelectedSpeakers}
            whileTap={checkedSpeakers.size > 0 && !speakerRunning ? softPressTap : undefined}
            className="wpf-action-button flex h-[38px] w-full items-center justify-center gap-2 px-4 text-sm font-semibold transition disabled:opacity-45 disabled:cursor-not-allowed"
          >
            <Power className="size-4 shrink-0 transition" />
            선택 화자 재분리
          </motion.button>

          <div className="mt-2 flex flex-col gap-0.5 px-0.5 text-[12px] leading-5 text-[var(--secondary-text)]">
            <span>병합: 2명 이상 선택 시 첫 번째 화자로 병합합니다.</span>
            <span>재분리: 선택 화자의 오디오 구간만 다시 분리를 시도합니다.</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function BatchSpeakerLoadingPanel({ compact = false }: { compact?: boolean }) {
  const text = "화자구분 진행 중...";
  return (
    <div className={cn("flex min-w-0 items-center justify-center text-center text-sm text-[var(--secondary-text)]", compact ? "mb-3 h-[38px]" : "h-full min-h-[120px]")}>
      <div className="inline-flex min-w-0 items-center justify-center">
        <motion.span
          className="mr-2 inline-flex size-4 shrink-0 items-center justify-center text-[var(--primary-text)]"
          animate={{ rotate: 360 }}
          transition={loadingSpinnerTransition}
          aria-hidden="true"
        >
          <LoaderCircle className="size-4" strokeWidth={1.9} />
        </motion.span>
        <span>{text}</span>
      </div>
    </div>
  );
}

type BatchTimelineEvent = {
  id: string;
  kind: "word" | "extra";
  text: string;
  start: number;
  end: number;
  duration: number;
  hasTiming: boolean;
  scoreText: string;
  status: string;
  statusCode: string;
  note: string;
  score?: number | null;
};

export function BatchAudioHeaderControls({ runtime, disabled = false }: { runtime: WorkspaceRuntime; disabled?: boolean }) {
  const checked = runtime.settings.batch.playTranscriptOutside;
  return (
    <span className="flex min-w-max shrink-0 items-center gap-2" data-app-tour-target="batch-audio-header-controls">
      <ToggleSwitch
        checked={checked}
        onChange={(value) => runtime.setSettings((current) => ({ ...current, batch: { ...current.batch, playTranscriptOutside: value } }))}
        disabled={disabled}
      />
      <span className={cn("text-sm text-[var(--primary-text)]", disabled && "opacity-45")}>Align외 구간 재생</span>
    </span>
  );
}

export function BatchAudioPlaybackPanel({ row, audioPath, playTranscriptOutside, audioEditScopeId }: { row?: DataTableRow; audioPath?: string; playTranscriptOutside: boolean; audioEditScopeId?: string }) {
  const muteIntervals = useMemo(() => readBatchTranscriptMuteIntervals(row), [row]);
  return (
    <WorkspaceAudioPlaybackPanel
      row={row}
      audioPath={audioPath}
      cropEnabled
      emptyText="오디오 행을 선택하세요."
      syncKey="batch"
      muteIntervals={muteIntervals}
      muteIntervalsEnabled={!playTranscriptOutside}
      audioEditScopeId={audioEditScopeId}
    />
  );
}

export function BatchTimelineBody({ row }: { row?: DataTableRow }) {
  const audioSync = useWorkspaceAudioSync("batch");
  const events = useMemo(() => buildBatchTimelineEvents(row), [row]);
  const activeId = useMemo(() => findActiveTimelineEvent(events, audioSync.currentTime)?.id, [audioSync.currentTime, events]);
  const table = useMemo(
    () => ({
      columns: [
        { key: "text", label: "대본" },
        { key: "start", label: "시작" },
        { key: "end", label: "끝" },
        { key: "score", label: "점수" },
        { key: "note", label: "메모" },
      ],
      rows: events.map((event) => ({
        id: event.id,
        cells: {
          text: event.text,
          start: formatTimelineSeconds(event.start),
          end: formatTimelineSeconds(event.end),
          score: event.scoreText,
          note: event.note,
        },
        raw: {
          kind: event.kind,
          status: event.statusCode,
          start: String(event.start),
          end: String(event.end),
          score: event.score == null ? "" : String(event.score),
        },
      })),
    }),
    [events],
  );

  if (!row) {
    return <EmptyPanel text="오디오 행을 선택하세요." />;
  }

  if (events.length === 0) {
    return <EmptyPanel text="WordAlign 타임라인이 없습니다." />;
  }

  return (
    <DataGrid
      table={table}
      showPagination={false}
      selectedRowId={activeId}
      onSelectRow={(timelineRow) => {
        const start = Number(timelineRow.raw?.start || 0);
        requestWorkspaceAudioSeek("batch", Number.isFinite(start) ? start : 0);
      }}
      fillRemainingColumnKey="note"
      emptyText="WordAlign 타임라인이 없습니다."
    />
  );
}

export function BatchAutoTranscriptCell({
  row,
  value,
  rowLineClamp,
  currentTime,
  audioActive,
  showAllAlignmentOutsideSegments,
}: {
  row: DataTableRow;
  value: string;
  rowLineClamp: number;
  currentTime: number;
  audioActive: boolean;
  showAllAlignmentOutsideSegments: boolean;
}) {
  const events = useMemo(() => buildBatchTranscriptEvents(row, value), [row, value]);
  if (events.length === 0) {
    return defaultTranscriptText(value, rowLineClamp);
  }
  const activeEvent = audioActive ? findActiveTimelineEvent(events, currentTime) : undefined;
  const activeGapPreviousWordId = !showAllAlignmentOutsideSegments && activeEvent?.kind === "extra" ? findPreviousWordEventId(events, activeEvent.id) : undefined;

  return (
    <div
      className={cn("max-h-full overflow-hidden break-words leading-5", rowLineClamp <= 1 && "truncate whitespace-nowrap")}
      style={rowLineClamp > 1 ? { display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: rowLineClamp } : undefined}
    >
      {events.map((event) => {
        if (event.kind === "extra" && !showAllAlignmentOutsideSegments) {
          return null;
        }

        const displayEvent = activeGapPreviousWordId === event.id && activeEvent ? activeEvent : event;
        const morphingToGap = displayEvent.id !== event.id;
        const active = displayEvent.id === activeEvent?.id;
        const title = displayEvent.hasTiming
          ? `${formatTimelineSeconds(displayEvent.start)} - ${formatTimelineSeconds(displayEvent.end)} ${displayEvent.scoreText} ${displayEvent.status}`
          : `${displayEvent.status}${displayEvent.scoreText ? ` ${displayEvent.scoreText}` : ""}`;

        return (
          <span
            key={event.id}
            className={cn(transcriptTokenBaseClass, transcriptTokenClass(displayEvent), active && activeTranscriptTokenClass, morphingToGap && "relative")}
            title={title}
            role={displayEvent.hasTiming ? "button" : undefined}
            tabIndex={displayEvent.hasTiming ? 0 : undefined}
            onClick={() => seekBatchTimelineEvent(displayEvent)}
            onDoubleClick={() => previewBatchTimelineEvent(displayEvent)}
            onKeyDown={(keyboardEvent) => handleTimelineChipKeyDown(keyboardEvent, displayEvent)}
          >
            {morphingToGap ? (
              <>
                <span aria-hidden="true" className="invisible">
                  {event.text}
                </span>
                <span className="absolute inset-0 flex items-center justify-center">{displayEvent.text}</span>
              </>
            ) : (
              displayEvent.text
            )}
          </span>
        );
      })}
    </div>
  );
}

const transcriptTokenBaseClass = "m-0.5 inline-flex min-h-[24px] cursor-pointer items-center rounded-[4px] p-1.5 align-middle leading-4";
const activeTranscriptTokenClass = "ring-1 ring-inset ring-[var(--primary-text)]";

function seekBatchTimelineEvent(event: BatchTimelineEvent): void {
  if (!event.hasTiming) {
    return;
  }
  requestWorkspaceAudioSeek("batch", event.start);
}

function previewBatchTimelineEvent(event: BatchTimelineEvent): void {
  if (!event.hasTiming || event.end <= event.start) {
    return;
  }

  requestWorkspaceAudioPreview("batch", event.start, event.end);
}

function handleTimelineChipKeyDown(keyboardEvent: KeyboardEvent<HTMLElement>, event: BatchTimelineEvent): void {
  if (keyboardEvent.key !== "Enter" && keyboardEvent.key !== " ") {
    return;
  }
  keyboardEvent.preventDefault();
  seekBatchTimelineEvent(event);
}

function buildBatchTimelineEvents(row: DataTableRow | undefined): BatchTimelineEvent[] {
  const words = readBatchWords(row)
    .filter((word) => isFiniteTime(word.start) && isFiniteTime(word.end))
    .map((word) => wordToTimelineEvent(word));
  const extras = readBatchTranscriptGaps(row).map((item, index) => gapToTimelineEvent(item, index));
  return [...words, ...extras].sort((left, right) => left.start - right.start || (left.kind === "word" ? -1 : 1));
}

function buildBatchTranscriptEvents(row: DataTableRow, fallbackText: string): BatchTimelineEvent[] {
  if (!fallbackText.trim()) {
    return [];
  }
  const words = readBatchWords(row).map((word) => wordToTimelineEvent(word));
  const extras = readBatchTranscriptGaps(row).map((item, index) => gapToTimelineEvent(item, index));
  if (words.length === 0 && extras.length === 0) {
    return [];
  }

  const events: BatchTimelineEvent[] = [];
  let extraIndex = 0;
  for (const word of words) {
    if (word.hasTiming) {
      while (extraIndex < extras.length && extras[extraIndex].start <= word.start) {
        events.push(extras[extraIndex]);
        extraIndex += 1;
      }
    }
    events.push(word);
  }
  while (extraIndex < extras.length) {
    events.push(extras[extraIndex]);
    extraIndex += 1;
  }
  return events;
}

function wordToTimelineEvent(word: BatchWordAlignment): BatchTimelineEvent {
  const hasTiming = isFiniteTime(word.start) && isFiniteTime(word.end);
  const start = hasTiming ? Number(word.start) : 0;
  const end = hasTiming ? Number(word.end) : start;
  const statusCode = normalizeAlignmentStatus(word.status || "aligned");
  return {
    id: `w-${word.index}`,
    kind: "word",
    text: word.original || word.normalized || "-",
    start,
    end,
    duration: Number(word.duration ?? Math.max(0, end - start)),
    hasTiming,
    score: word.score,
    scoreText: word.score == null ? "" : word.score.toFixed(4),
    status: formatAlignmentStatus(statusCode),
    statusCode,
    note: word.note || "",
  };
}

function gapToTimelineEvent(item: BatchTranscriptGap, index: number): BatchTimelineEvent {
  const statusCode = normalizeAlignmentStatus(item.status);
  return {
    id: `x-${index}`,
    kind: "extra",
    text: "...",
    start: Number(item.start),
    end: Number(item.end),
    duration: Number(item.duration),
    hasTiming: true,
    score: null,
    scoreText: "",
    status: formatAlignmentStatus(statusCode),
    statusCode,
    note: item.note || "",
  };
}

function findActiveTimelineEvent(events: BatchTimelineEvent[], currentTime: number): BatchTimelineEvent | undefined {
  if (!Number.isFinite(currentTime)) {
    return undefined;
  }
  return events.find((event, index) => isActiveTimelineEvent(event, currentTime, index === events.length - 1))
    ?? events.find((event) => event.hasTiming && currentTime < event.start && event.start - currentTime <= 0.12);
}

function findPreviousWordEventId(events: BatchTimelineEvent[], targetId: string): string | undefined {
  const targetIndex = events.findIndex((event) => event.id === targetId);
  if (targetIndex <= 0) {
    return undefined;
  }

  for (let index = targetIndex - 1; index >= 0; index -= 1) {
    if (events[index].kind === "word") {
      return events[index].id;
    }
  }

  return undefined;
}

function isActiveTimelineEvent(event: BatchTimelineEvent, currentTime: number, isLastEvent: boolean): boolean {
  if (!event.hasTiming || event.end < event.start) {
    return false;
  }
  if (event.end === event.start) {
    return currentTime === event.start;
  }
  return event.start <= currentTime && (currentTime < event.end || (isLastEvent && currentTime <= event.end));
}

function isFiniteTime(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function formatTimelineSeconds(value: number): string {
  const safe = Math.max(0, Number.isFinite(value) ? value : 0);
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes.toString().padStart(2, "0")}:${seconds.toFixed(3).padStart(6, "0")}`;
}

function normalizeAlignmentStatus(status: string): string {
  const raw = status.trim();
  const lower = raw.toLowerCase();
  if (!lower || raw === "정상") {
    return "aligned";
  }
  if (lower === "review" || raw.includes("확인")) {
    return "review";
  }
  if (lower === "missing" || raw.includes("누락") || raw.includes("오타")) {
    return "missing";
  }
  if (lower === "unalignable" || raw.includes("정렬불가")) {
    return "unalignable";
  }
  if (lower === "transcript_gap" || raw.includes("빈 구간")) {
    return "transcript_gap";
  }
  return lower;
}

function formatAlignmentStatus(statusCode: string): string {
  switch (statusCode) {
    case "aligned":
      return "정상";
    case "review":
      return "확인필요";
    case "missing":
      return "누락의심";
    case "unalignable":
      return "정렬불가";
    case "transcript_gap":
      return "빈 구간";
    default:
      return statusCode || "-";
  }
}

function transcriptTokenClass(event: BatchTimelineEvent): string {
  if (event.kind === "extra") {
    return "bg-[var(--token-extra-bg)] text-[var(--token-extra-text)]";
  }
  if (event.statusCode === "missing" || event.statusCode === "unalignable") {
    return "bg-[var(--token-negative-bg)] text-[var(--token-negative-text)]";
  }
  const score = Number(event.score);
  if (Number.isFinite(score) && score < 0.32) {
    return "bg-[var(--token-negative-bg)] text-[var(--token-negative-text)]";
  }
  if (event.statusCode !== "aligned" || (Number.isFinite(score) && score < 0.62)) {
    return "bg-[var(--token-warning-bg)] text-[var(--token-warning-text)]";
  }
  return "bg-[var(--token-positive-bg)] text-[var(--token-positive-text)]";
}

function defaultTranscriptText(value: string, rowLineClamp: number) {
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
