import type { DataTableRow } from "@shared/ipc";
import { LoaderCircle, Square } from "lucide-react";
import { motion } from "motion/react";
import { useMemo } from "react";
import type { KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import { ToggleSwitch } from "@/shared/components/controls";
import { DataGrid } from "@/shared/components/data-grid";
import { loadingDotTransition, loadingSpinnerTransition, tightPressTap } from "@/shared/motion";
import { readBatchTranscriptGaps, readBatchTranscriptMuteIntervals, readBatchWords, type BatchTranscriptGap, type BatchWordAlignment } from "../../../model/batch-alignment";
import { collectBatchSpeakers } from "../../../model/batch-filter";
import type { WorkspaceRuntime } from "../../../state/use-workspace-runtime";
import { WorkspaceAudioPlaybackPanel } from "../../shared/WorkspaceAudioPlaybackPanel";
import { requestWorkspaceAudioPreview, requestWorkspaceAudioSeek, useWorkspaceAudioSync } from "../../shared/workspace-audio-sync";
import { EmptyPanel } from "../../shared/workspace-panel-primitives";

export { BatchModelSettingsBody } from "./BatchModelSettingsBody";

export function BatchSpeakerSelectionBody({ runtime, rows }: { runtime: WorkspaceRuntime; rows: DataTableRow[] }) {
  const state = runtime.getState("batch");
  const speakers = collectBatchSpeakers(rows);
  const selectedSpeakers = speakers.filter((speaker) => state.batchSpeakerChecks[speaker] !== false);
  const speakerStageRunning = rows.some((row) => {
    const activeStage = (row.raw?.activeStage || row.raw?.active_stage || "").toLowerCase();
    return activeStage === "diarizing" || activeStage === "preparing_diarization";
  });
  const speakerRunning = state.isBatchSpeakerRunning || speakerStageRunning;
  const canRunSpeaker = rows.length > 0 && Boolean(state.inputPath) && !state.isRunning && !state.isExporting && !speakerRunning;
  const canStopSpeaker = state.isBatchSpeakerRunning;
  const runSpeakerButton = (
    <motion.button
      type="button"
      disabled={speakerRunning ? !canStopSpeaker : !canRunSpeaker}
      onClick={() => void (speakerRunning ? runtime.cancelBatchSpeakerDiarization() : runtime.runBatchSpeakerDiarization())}
      whileTap={speakerRunning ? canStopSpeaker ? tightPressTap : undefined : canRunSpeaker ? tightPressTap : undefined}
      className={cn(
        "h-[38px] w-full min-w-0 truncate px-4 text-sm disabled:opacity-45",
        speakerRunning && canStopSpeaker ? "wpf-danger-button" : "wpf-button",
      )}
      aria-label={speakerRunning ? "화자 구분 중지" : "화자 구분 실행"}
    >
      {speakerRunning && canStopSpeaker ? (
        <span className="inline-flex min-w-0 items-center justify-center">
          <Square className="mr-2 size-3.5 shrink-0" fill="currentColor" strokeWidth={1.7} />
          STOP
        </span>
      ) : (
        "화자 구분 Run"
      )}
    </motion.button>
  );
  const speakerActions = (
    <div className="grid shrink-0 grid-cols-1 gap-2 pt-3">
      {runSpeakerButton}
      {speakers.length > 0 ? (
        <button
          type="button"
          disabled={selectedSpeakers.length < 2 || state.isRunning || state.isExporting || speakerRunning}
          onClick={() => runtime.mergeEnabledBatchSpeakers()}
          className="wpf-button h-[38px] w-full min-w-0 truncate px-4 text-sm disabled:opacity-45"
        >
          화자 병합
        </button>
      ) : null}
    </div>
  );

  const speakerContent = speakers.length === 0 && speakerRunning ? (
    <BatchSpeakerLoadingPanel />
  ) : speakers.length === 0 ? (
    <EmptyPanel text={rows.length > 0 ? "화자 구분 Run으로 화자 목록을 만들 수 있습니다." : "먼저 왼쪽 RUN으로 전사 결과를 만든 뒤, 여기서 화자 구분을 실행할 수 있습니다."} />
  ) : (
    <div className="app-scrollbar h-full min-h-0 space-y-3 overflow-auto pr-1">
      {speakerRunning ? <BatchSpeakerLoadingPanel compact /> : null}
      {speakers.map((speaker) => (
        <div key={speaker} className="grid grid-cols-[auto_1fr_auto] items-center">
          <span className="flex size-8 items-center justify-center rounded-full bg-[var(--nav-selected-bg)] text-sm text-[var(--primary-text)]">{speaker.slice(0, 1).toUpperCase()}</span>
          <p className="mx-[10px] truncate text-sm text-[var(--primary-text)]">{speaker}</p>
          <ToggleSwitch checked={state.batchSpeakerChecks[speaker] !== false} onChange={() => runtime.toggleBatchSpeaker(speaker)} />
        </div>
      ))}
    </div>
  );

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">{speakerContent}</div>
      {speakerActions}
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
        <span className="inline-flex min-w-0 justify-center" aria-label={text}>
          {[...text].map((char, index) => (
            <motion.span
              key={`${char}-${index}`}
              className={cn("inline-block", char === " " && "w-1.5")}
              animate={{ y: [0, -4, 0], opacity: [0.45, 1, 0.45] }}
              transition={{ ...loadingDotTransition, delay: index * 0.045 }}
              aria-hidden="true"
            >
              {char === " " ? "\u00a0" : char}
            </motion.span>
          ))}
        </span>
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
    <>
      <ToggleSwitch
        checked={checked}
        onChange={(value) => runtime.setSettings((current) => ({ ...current, batch: { ...current.batch, playTranscriptOutside: value } }))}
        disabled={disabled}
      />
      <span className={cn("text-sm text-[var(--primary-text)]", disabled && "opacity-45")}>Align외 구간 재생</span>
    </>
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
      showSheetTabs={false}
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
    return "bg-[#363b46] text-[#d8dde8]";
  }
  if (event.statusCode === "missing" || event.statusCode === "unalignable") {
    return "bg-[#5b1b1b] text-[#ffb4b4]";
  }
  const score = Number(event.score);
  if (Number.isFinite(score) && score < 0.32) {
    return "bg-[#5b1b1b] text-[#ffb4b4]";
  }
  if (event.statusCode !== "aligned" || (Number.isFinite(score) && score < 0.62)) {
    return "bg-[#5a4310] text-[#ffe08a]";
  }
  return "bg-[#145232] text-[#93f5b6]";
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
