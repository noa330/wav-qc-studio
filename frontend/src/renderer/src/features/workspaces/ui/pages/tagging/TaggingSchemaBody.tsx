import { forwardRef, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { ScrollWindowViewport, type ScrollWindowHandle } from "@/shared/components/virtual-scroll";
import { softPressTap, timelineFocusItemVariants, timelineFocusTransition } from "@/shared/motion";
import {
  createFrameTagRowClassifier,
  formatTagScore,
  parseFrameTagRows,
  type FrameTagDisplayRow,
  type FrameTagRow,
  type TagScoreRule,
} from "../../../model/pretrained-sed-tagging";
import type { WorkspaceRuntime } from "../../../state/use-workspace-runtime";
import { EmptyPanel } from "../../shared/workspace-panel-primitives";
import { requestWorkspaceAudioSeek, useWorkspaceAudioSync } from "../../shared/workspace-audio-sync";

const frameTagRowHeight = 126;
const frameTagRowGap = 8;
const frameTagBufferScreens = 1;

type FrameRevealRequest = {
  index: number;
  timeoutIds: number[];
};

const schemaText = {
  noSelectedFile: "\uc120\ud0dd\ub41c \ud30c\uc77c\uc774 \uc5c6\uc2b5\ub2c8\ub2e4.",
  noTagScores: "\uc120\ud0dd\ub41c \ud30c\uc77c\uc758 \ud0dc\uadf8 \uc810\uc218\uac00 \uc5c6\uc2b5\ub2c8\ub2e4.",
} as const;

export function TaggingSchemaBody({ runtime }: { runtime: WorkspaceRuntime }) {
  const state = runtime.getState("tagging");
  const audioSync = useWorkspaceAudioSync("tagging");
  const selectedRow = useMemo(() => state.table.rows.find((row) => row.id === state.selectedRowId) ?? state.table.rows[0], [state.selectedRowId, state.table.rows]);
  const frames = useMemo(() => parseFrameTagRows(selectedRow), [selectedRow]);
  const audioSyncReady = sameAudioPath(audioSync.audioPath, state.selectedAudioPath);
  const schemaCurrentTime = audioSyncReady ? audioSync.currentTime : 0;
  const schemaFocusRequestId = audioSyncReady ? audioSync.focusRequest?.id : undefined;
  const frameSetKey = useMemo(
    () => `${selectedRow?.id ?? "empty"}:${frames.length}:${frames[0]?.startSec ?? 0}:${frames[frames.length - 1]?.endSec ?? 0}`,
    [frames, selectedRow?.id],
  );

  if (!selectedRow) {
    return <EmptyPanel text={schemaText.noSelectedFile} />;
  }

  if (frames.length === 0) {
    return <EmptyPanel text={schemaText.noTagScores} />;
  }

  return <FrameTagList frames={frames} rules={runtime.tagScoreRules} currentTime={schemaCurrentTime} focusRequestId={schemaFocusRequestId} autoFocusEnabled={audioSyncReady} frameSetKey={frameSetKey} />;
}

function FrameTagList({
  frames,
  rules,
  currentTime,
  focusRequestId,
  autoFocusEnabled,
  frameSetKey,
}: {
  frames: FrameTagRow[];
  rules: TagScoreRule[];
  currentTime: number;
  focusRequestId?: number;
  autoFocusEnabled: boolean;
  frameSetKey: string;
}) {
  const scrollRef = useRef<ScrollWindowHandle | null>(null);
  const activeIndex = useMemo(() => findActiveFrameIndex(frames, currentTime), [currentTime, frames]);
  const lastFocusRequestRef = useRef<number | undefined>(undefined);
  const lastAutoFocusedIndexRef = useRef<number | undefined>(undefined);
  const lastFrameSetKeyRef = useRef<string | undefined>(undefined);
  const frameRevealRequestRef = useRef<FrameRevealRequest | undefined>(undefined);
  const rulesCacheKey = useMemo(() => buildTagRuleCacheKey(rules), [rules]);
  const frameCacheKey = useMemo(() => `${frames.length}:${frames[0]?.startSec ?? 0}:${frames[frames.length - 1]?.endSec ?? 0}`, [frames]);
  const classifyFrame = useMemo(() => createFrameTagRowClassifier(rules), [rules]);
  const seekFrame = useCallback((time: number) => requestWorkspaceAudioSeek("tagging", time), []);

  useEffect(() => () => clearFrameRevealRequest(frameRevealRequestRef.current), []);

  useLayoutEffect(() => {
    if (!scrollRef.current) {
      return;
    }

    const frameSetChanged = frameSetKey !== lastFrameSetKeyRef.current;
    if (frameSetChanged) {
      lastFrameSetKeyRef.current = frameSetKey;
      clearFrameRevealRequest(frameRevealRequestRef.current);
      frameRevealRequestRef.current = undefined;
      lastAutoFocusedIndexRef.current = undefined;
      lastFocusRequestRef.current = focusRequestId;
    }

    if (activeIndex < 0) {
      return;
    }

    if (!autoFocusEnabled) {
      if (frameSetChanged) {
        scrollRef.current.scrollToIndex(0, "start");
        lastAutoFocusedIndexRef.current = 0;
      }
      return;
    }

    const requested = focusRequestId !== undefined && focusRequestId !== lastFocusRequestRef.current;
    const shouldAutoFocus = activeIndex !== lastAutoFocusedIndexRef.current;
    if (requested || shouldAutoFocus) {
      clearFrameRevealRequest(frameRevealRequestRef.current);
      frameRevealRequestRef.current = { index: activeIndex, timeoutIds: [] };
      scrollRef.current.scrollToIndex(activeIndex, "center");
      scheduleFrameReveal(frameRevealRequestRef.current, scrollRef);
    }
    if (requested) {
      lastFocusRequestRef.current = focusRequestId;
    }
    if (shouldAutoFocus) {
      lastAutoFocusedIndexRef.current = activeIndex;
    }
  }, [activeIndex, autoFocusEnabled, focusRequestId, frameSetKey]);

  return (
    <ScrollWindowViewport
      ref={scrollRef}
      itemCount={frames.length}
      itemSize={frameTagRowHeight}
      itemGap={frameTagRowGap}
      bufferScreens={frameTagBufferScreens}
      cacheKey={`${frameCacheKey}:${rulesCacheKey}`}
      className="px-1 py-1 pr-2"
      getItemKey={(index) => {
        const frame = frames[index];
        return `${frame.startSec}:${frame.endSec}`;
      }}
      resolveItem={(index) => classifyFrame(frames[index])}
      renderItem={({ index, item }) => {
        return (
          <FrameTagListRow
            frame={item as FrameTagDisplayRow}
            index={index}
            active={index === activeIndex}
            onSeek={seekFrame}
          />
        );
      }}
    />
  );
}

const FrameTagListRow = memo(forwardRef<HTMLButtonElement, { frame: FrameTagDisplayRow; index: number; active: boolean; onSeek: (time: number) => void }>(function FrameTagListRow({ frame, index, active, onSeek }, ref) {
  return (
    <motion.button
      ref={ref}
      type="button"
      data-frame-index={index}
      onClick={() => onSeek(frame.startSec)}
      whileTap={softPressTap}
      variants={timelineFocusItemVariants}
      animate={active ? "active" : "idle"}
      transition={timelineFocusTransition}
      aria-pressed={active}
      className={cn(
        "grid h-full w-full grid-cols-[92px_minmax(0,1fr)] gap-3 overflow-hidden rounded-[5px] border px-3 py-2 text-left transition-colors",
        active
          ? "border-[var(--nav-selected-bg)] bg-[rgba(124,77,255,.13)]"
          : "border-[var(--panel-stroke)] bg-[var(--field-bg)] hover:bg-[var(--soft-selection-hover)]",
      )}
    >
      <div className="text-[12px] leading-5 text-[var(--secondary-text)]">
        <div>{formatFrameTime(frame.startSec)}</div>
        <div>{formatFrameTime(frame.endSec)}</div>
      </div>
      <div className="flex min-w-0 flex-wrap content-start gap-1.5 overflow-hidden">
        {frame.tags.length > 0 ? frame.tags.map((tag) => (
          <span
            key={`${tag.label}-${tag.rank}`}
            className={cn(
              "inline-flex max-w-full items-center gap-1 rounded-[4px] border px-2 py-1 text-[12px] leading-none",
              tag.isNg
                ? "border-[#ff6b78]/70 bg-[#5b1b1b] text-[#ffb4b4]"
                : "border-[var(--panel-stroke)] bg-[rgba(148,163,184,.10)] text-[var(--primary-text)]",
            )}
            title={`${tag.label} ${formatTagScore(tag.score)}`}
          >
            <span className="min-w-0 truncate">{tag.displayLabel}</span>
            <span className={cn("shrink-0", tag.isNg ? "text-[#ffd1d5]" : "text-[var(--secondary-text)]")}>{formatTagScore(tag.score)}</span>
          </span>
        )) : <span className="text-sm text-[var(--secondary-text)]">-</span>}
      </div>
    </motion.button>
  );
}));

function buildTagRuleCacheKey(rules: TagScoreRule[]): string {
  return rules.map((rule) => `${rule.id}:${rule.isAutoApplied ? 1 : 0}:${rule.cutoffScore}`).join("|");
}

function scheduleFrameReveal(request: FrameRevealRequest, scrollRef: RefObject<ScrollWindowHandle | null>): void {
  const delays = [0, 80, 180];
  for (const delay of delays) {
    const timeoutId = window.setTimeout(() => {
      scrollRef.current?.scrollToIndex(request.index, "center");
    }, delay);
    request.timeoutIds.push(timeoutId);
  }

  const cleanupId = window.setTimeout(() => {
    clearFrameRevealRequest(request);
  }, 260);
  request.timeoutIds.push(cleanupId);
}

function clearFrameRevealRequest(request: FrameRevealRequest | undefined): void {
  if (!request) {
    return;
  }

  for (const timeoutId of request.timeoutIds) {
    window.clearTimeout(timeoutId);
  }
  request.timeoutIds = [];
}

function findActiveFrameIndex(frames: FrameTagRow[], time: number): number {
  if (!Number.isFinite(time) || frames.length === 0) {
    return -1;
  }

  const epsilon = 0.000001;
  let low = 0;
  let high = frames.length - 1;
  let candidate = -1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const frame = frames[mid];
    if (frame.startSec <= time + epsilon) {
      candidate = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  if (candidate >= 0) {
    return candidate;
  }

  return time + epsilon >= frames[0].startSec ? 0 : -1;
}

function sameAudioPath(left?: string, right?: string): boolean {
  const normalizedLeft = normalizeAudioPath(left);
  const normalizedRight = normalizeAudioPath(right);
  return normalizedLeft.length > 0 && normalizedLeft === normalizedRight;
}

function normalizeAudioPath(path?: string): string {
  return path?.trim().replace(/\\/gu, "/").toLocaleLowerCase() ?? "";
}

function formatFrameTime(value: number): string {
  if (!Number.isFinite(value)) {
    return "00:00.000";
  }

  const minutes = Math.floor(value / 60);
  const seconds = value % 60;
  return `${minutes.toString().padStart(2, "0")}:${seconds.toFixed(3).padStart(6, "0")}`;
}
