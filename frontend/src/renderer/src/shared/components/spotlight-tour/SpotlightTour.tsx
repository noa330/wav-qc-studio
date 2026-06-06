import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { ClipboardPaste, Copy, MousePointer2, ChevronLeft, ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { menuMotion, softPressTap, subtleSpring, tightPressTap } from "@/shared/motion";
import { computeTourPanelPosition, getTourPanelWidth } from "./geometry";
import { useSpotlightTarget } from "./use-spotlight-target";
import type { SpotlightRect, SpotlightSize, SpotlightTourStep } from "./types";

const spotlightPadding = 8;
const spotlightViewportInset = 2;
const defaultPanelHeight = 184;
const spotlightTransition = subtleSpring;
const panelMoveTransition = subtleSpring;
const cueDotSize = 18;
const resizeCueDuration = 3.2;

type SpotlightTourProps = {
  open: boolean;
  steps: readonly SpotlightTourStep[];
  ariaLabel: string;
  onClose: () => void;
  onStepChange?: (stepIndex: number, step: SpotlightTourStep) => void;
};

export function SpotlightTour({ open, steps, ariaLabel, onClose, onStepChange }: SpotlightTourProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const [panelWidth, setPanelWidth] = useState(() => getTourPanelWidth());
  const [panelHeight, setPanelHeight] = useState(defaultPanelHeight);
  const [lockedPanelPosition, setLockedPanelPosition] = useState<{ stepId: string; left: number; top: number } | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const currentStep = steps[stepIndex];
  const { rect, missing } = useSpotlightTarget(currentStep?.target, open, Boolean(currentStep?.visualCue));
  const panelSize: SpotlightSize = useMemo(() => ({ width: panelWidth, height: panelHeight }), [panelHeight, panelWidth]);
  const panelPosition = useMemo(
    () => computeTourPanelPosition(rect, currentStep?.placement ?? "bottom", panelSize),
    [currentStep?.placement, panelSize, rect],
  );
  const panelPositionLocked = currentStep ? shouldLockPanelPosition(currentStep) : false;
  const visiblePanelPosition = panelPositionLocked && lockedPanelPosition?.stepId === currentStep?.id ? lockedPanelPosition : panelPosition;

  useEffect(() => {
    if (open) {
      setStepIndex(0);
    }
  }, [open]);

  useEffect(() => {
    if (!open || !currentStep) {
      return;
    }

    onStepChange?.(stepIndex, currentStep);
  }, [currentStep, onStepChange, open, stepIndex]);

  useEffect(() => {
    if (!open || !currentStep || !shouldLockPanelPosition(currentStep)) {
      setLockedPanelPosition(null);
      return;
    }

    setLockedPanelPosition((current) => current?.stepId === currentStep.id ? current : { stepId: currentStep.id, left: panelPosition.left, top: panelPosition.top });
  }, [currentStep, open, panelPosition.left, panelPosition.top]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const updateWidth = () => setPanelWidth(getTourPanelWidth());
    updateWidth();
    window.addEventListener("resize", updateWidth);
    return () => window.removeEventListener("resize", updateWidth);
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !panelRef.current) {
      return undefined;
    }

    const updateHeight = () => {
      setPanelHeight(panelRef.current?.offsetHeight ?? defaultPanelHeight);
    };

    updateHeight();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(updateHeight) : undefined;
    if (observer && panelRef.current) {
      observer.observe(panelRef.current);
    }
    return () => observer?.disconnect();
  }, [currentStep?.id, open]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        setStepIndex((current) => Math.min(current + 1, steps.length - 1));
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setStepIndex((current) => Math.max(current - 1, 0));
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open, steps.length]);

  if (!open || !currentStep || typeof document === "undefined") {
    return null;
  }

  const firstStep = stepIndex === 0;
  const lastStep = stepIndex === steps.length - 1;
  const paddedRect = rect ? buildSpotlightRect(rect) : null;
  const pointerBlockers = buildPointerBlockers(paddedRect);
  const stepGroupProgress = getStepGroupProgress(steps, stepIndex);
  const progressDots = getProgressDots(stepGroupProgress.steps.length, stepGroupProgress.index);

  return createPortal(
    <div className="fixed inset-0 z-[3000]" role="dialog" aria-modal="true" aria-label={ariaLabel}>
      {pointerBlockers.map((blocker) => (
        <div
          key={blocker.key}
          className="pointer-events-auto fixed"
          style={{
            top: blocker.top,
            left: blocker.left,
            width: blocker.width,
            height: blocker.height,
          }}
        />
      ))}
      <AnimatePresence initial={false}>
        {paddedRect ? (
          <motion.div
            className="pointer-events-none fixed rounded-[7px] border-2 border-[var(--accent-blue)]"
            initial={buildBoundedRect(expandRect(paddedRect, 10))}
            animate={paddedRect}
            transition={spotlightTransition}
            style={{
              boxShadow: "var(--app-tour-backdrop)",
            }}
          />
        ) : null}
      </AnimatePresence>
      {paddedRect && currentStep.visualCue ? <SpotlightVisualCue rect={paddedRect} type={currentStep.visualCue} /> : null}

      <motion.div
        ref={panelRef}
        className="fixed z-[3001] rounded-[5px] border border-[var(--panel-stroke)] bg-[var(--panel-bg)] p-4 text-[var(--primary-text)] shadow-[var(--app-spotlight-shadow)]"
        initial={{ ...menuMotion.initial, left: visiblePanelPosition.left, top: visiblePanelPosition.top }}
        animate={{ ...menuMotion.animate, left: visiblePanelPosition.left, top: visiblePanelPosition.top }}
        exit={menuMotion.exit}
        transition={panelMoveTransition}
        style={{
          width: panelWidth,
        }}
      >
        <div className="mb-3 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
          <div className="min-w-0">
            <p className="mb-1 text-[13px] font-normal leading-[18px] text-[var(--secondary-text)]">
              {currentStep.caption ? `${currentStep.caption} · ` : null}{stepGroupProgress.index + 1} / {stepGroupProgress.steps.length}
            </p>
            <h2 className="text-base font-normal leading-5 text-[var(--primary-text)]">{currentStep.title}</h2>
          </div>
          <motion.button
            type="button"
            className="flex size-7 items-center justify-center rounded-[4px] text-[var(--control-arrow)] hover:bg-[var(--soft-selection-hover)] hover:text-[var(--primary-text)]"
            aria-label="가이드 닫기"
            onClick={onClose}
            whileTap={tightPressTap}
          >
            <X className="size-4" strokeWidth={1.8} />
          </motion.button>
        </div>
        <p className="text-sm font-normal leading-5 text-[var(--secondary-text)]">{currentStep.description}</p>
        {currentStep.bullets?.length ? (
          <ul className="mt-3 space-y-1.5 text-[13px] leading-[18px] text-[var(--secondary-text)]">
            {currentStep.bullets.map((bullet) => (
              <li key={bullet} className="grid grid-cols-[10px_minmax(0,1fr)] gap-2">
                <span className="mt-[7px] size-1.5 rounded-full bg-current" aria-hidden="true" />
                <span>{bullet}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {missing ? (
          <p className="mt-3 rounded-[5px] border border-[var(--panel-stroke)] bg-[var(--field-bg)] px-3 py-2 text-[13px] font-normal leading-[18px] text-[var(--secondary-text)]">
            현재 화면 배치에서 이 단계의 대상이 보이지 않습니다. 창 크기를 조정하거나 다음 단계로 계속 진행할 수 있습니다.
          </p>
        ) : null}
        <div className="mt-4 flex items-center justify-between gap-3 border-t border-[var(--panel-stroke)] pt-3">
          <div className="flex max-h-5 min-w-0 flex-1 flex-wrap content-center items-center gap-x-1.5 gap-y-1 overflow-hidden" aria-hidden="true">
            {progressDots.map((dot) => (
              <span
                key={dot.key}
                className={cn("size-1.5 shrink-0 rounded-full", dot.active ? "bg-[var(--accent-blue)]" : "bg-[var(--slider-rail)]")}
              />
            ))}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <motion.button
              type="button"
              className={cn("wpf-button flex h-8 items-center justify-center px-3 text-sm font-normal", firstStep && "pointer-events-none opacity-40")}
              disabled={firstStep}
              onClick={() => setStepIndex((current) => Math.max(current - 1, 0))}
              whileTap={firstStep ? undefined : softPressTap}
            >
              <ChevronLeft className="mr-1 size-3.5" strokeWidth={1.8} />
              이전
            </motion.button>
            <motion.button
              type="button"
              className="wpf-primary-button flex h-8 items-center justify-center px-3 text-sm font-normal"
              onClick={() => {
                if (lastStep) {
                  onClose();
                  return;
                }
                setStepIndex((current) => Math.min(current + 1, steps.length - 1));
              }}
              whileTap={softPressTap}
            >
              {lastStep ? "완료" : "다음"}
              {lastStep ? null : <ChevronRight className="ml-1 size-3.5" strokeWidth={1.8} />}
            </motion.button>
          </div>
        </div>
      </motion.div>
    </div>,
    document.body,
  );
}

function SpotlightVisualCue({ rect, type }: { rect: SpotlightRect; type: NonNullable<SpotlightTourStep["visualCue"]> }) {
  if (type === "context-menu") {
    return <ContextMenuCue rect={rect} />;
  }

  if (type === "cell-resize") {
    return <CellResizeCue rect={rect} />;
  }

  return <PanelResizeCue rect={rect} />;
}

function PanelResizeCue({ rect }: { rect: SpotlightRect }) {
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;

  return (
    <div className="pointer-events-none fixed z-[3001]" style={{ left: centerX, top: centerY }} aria-hidden="true">
      <motion.span
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/90 bg-white shadow-[0_0_22px_rgba(255,255,255,.86)]"
        style={{ width: cueDotSize, height: cueDotSize }}
        animate={{ x: [-28, 28, -28], scale: [0.92, 1.08, 0.92] }}
        transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
      />
    </div>
  );
}

function CellResizeCue({ rect }: { rect: SpotlightRect }) {
  const right = rect.left + rect.width;
  const bottom = rect.top + rect.height;
  const centerY = rect.top + rect.height / 2;
  const centerX = rect.left + rect.width / 2;
  const phaseTimes = [0, 0.08, 0.5, 0.58, 1];

  return (
    <div className="pointer-events-none fixed inset-0 z-[3001]" aria-hidden="true">
      <motion.span
        className="fixed -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/90 bg-white shadow-[0_0_22px_rgba(255,255,255,.86)]"
        style={{ left: right, top: centerY, width: cueDotSize, height: cueDotSize }}
        animate={{ x: [0, 34, 0, 0, 0], opacity: [1, 1, 1, 0, 0], scale: [0.94, 1.06, 0.94, 0.94, 0.94] }}
        transition={{ duration: resizeCueDuration, repeat: Infinity, ease: "easeInOut", times: phaseTimes }}
      />
      <motion.span
        className="fixed -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/90 bg-white shadow-[0_0_22px_rgba(255,255,255,.86)]"
        style={{ left: centerX, top: bottom, width: cueDotSize, height: cueDotSize }}
        animate={{ y: [0, 0, 0, 26, 0], opacity: [0, 0, 1, 1, 1], scale: [0.94, 0.94, 0.94, 1.06, 0.94] }}
        transition={{ duration: resizeCueDuration, repeat: Infinity, ease: "easeInOut", times: phaseTimes }}
      />
    </div>
  );
}

function ContextMenuCue({ rect }: { rect: SpotlightRect }) {
  const menuWidth = 184;
  const menuLeft = clamp(rect.left + Math.min(rect.width - 12, 110), 12, window.innerWidth - menuWidth - 12);
  const menuTop = clamp(rect.top + Math.min(rect.height + 8, 34), 12, window.innerHeight - 178);

  return (
    <div className="pointer-events-none fixed inset-0 z-[3001]" aria-hidden="true">
      <motion.div
        className="fixed min-w-[184px] rounded-[4px] border border-[var(--panel-stroke)] bg-[var(--popover)] py-1 text-sm text-[var(--primary-text)] shadow-[var(--app-menu-shadow)]"
        style={{ left: menuLeft, top: menuTop }}
        initial={{ opacity: 0, scale: 0.96, y: -4 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={menuMotion.transition}
      >
        <ContextMenuCueItem icon={<Copy className="size-4" />} label="복사" />
        <ContextMenuCueItem icon={<ClipboardPaste className="size-4" />} label="붙여넣기" muted />
        <div className="my-1 h-px bg-[var(--panel-stroke)]" />
        <ContextMenuCueItem icon={<MousePointer2 className="size-4" />} label="전체 선택" />
      </motion.div>
    </div>
  );
}

function ContextMenuCueItem({ icon, label, muted }: { icon: ReactNode; label: string; muted?: boolean }) {
  return (
    <div className={cn("grid h-9 w-full grid-cols-[22px_minmax(0,1fr)] items-center gap-2 px-3 text-left", muted && "text-[var(--secondary-text)] opacity-55")}>
      {icon}
      <span>{label}</span>
    </div>
  );
}

function shouldLockPanelPosition(step: SpotlightTourStep): boolean {
  return step.visualCue === "panel-resize" || step.visualCue === "cell-resize";
}

function getProgressDots(totalSteps: number, activeIndex: number): Array<{ key: string; active: boolean }> {
  return Array.from({ length: Math.max(0, totalSteps) }, (_, index) => ({
    key: `dot-${index}`,
    active: index === activeIndex,
  }));
}

function getStepGroupProgress(
  steps: readonly SpotlightTourStep[],
  stepIndex: number,
): { steps: readonly SpotlightTourStep[]; index: number } {
  const currentStep = steps[stepIndex];
  const groupKey = currentStep?.caption ?? "";
  let start = stepIndex;
  let end = stepIndex;

  while (start > 0 && (steps[start - 1]?.caption ?? "") === groupKey) {
    start -= 1;
  }

  while (end < steps.length - 1 && (steps[end + 1]?.caption ?? "") === groupKey) {
    end += 1;
  }

  return {
    steps: steps.slice(start, end + 1),
    index: stepIndex - start,
  };
}

function buildPointerBlockers(target: SpotlightRect | null): Array<SpotlightRect & { key: string }> {
  if (typeof window === "undefined") {
    return [];
  }

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  if (!target) {
    return [{ key: "full", top: 0, left: 0, width: viewportWidth, height: viewportHeight }];
  }

  const top = clamp(target.top, 0, viewportHeight);
  const left = clamp(target.left, 0, viewportWidth);
  const right = clamp(target.left + target.width, 0, viewportWidth);
  const bottom = clamp(target.top + target.height, 0, viewportHeight);

  return [
    { key: "top", top: 0, left: 0, width: viewportWidth, height: top },
    { key: "left", top, left: 0, width: left, height: Math.max(0, bottom - top) },
    { key: "right", top, left: right, width: Math.max(0, viewportWidth - right), height: Math.max(0, bottom - top) },
    { key: "bottom", top: bottom, left: 0, width: viewportWidth, height: Math.max(0, viewportHeight - bottom) },
  ].filter((scrim) => scrim.width > 0 && scrim.height > 0);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function buildSpotlightRect(rect: SpotlightRect): SpotlightRect {
  if (typeof window === "undefined") {
    return expandRect(rect, spotlightPadding);
  }

  return buildBoundedRect(expandRect(rect, spotlightPadding));
}

function buildBoundedRect(rect: SpotlightRect): SpotlightRect {
  if (typeof window === "undefined") {
    return rect;
  }

  const left = clamp(rect.left, spotlightViewportInset, window.innerWidth - spotlightViewportInset);
  const top = clamp(rect.top, spotlightViewportInset, window.innerHeight - spotlightViewportInset);
  const right = clamp(rect.left + rect.width, left, window.innerWidth - spotlightViewportInset);
  const bottom = clamp(rect.top + rect.height, top, window.innerHeight - spotlightViewportInset);

  return {
    top,
    left,
    width: right - left,
    height: bottom - top,
  };
}

function expandRect(rect: SpotlightRect, amount: number): SpotlightRect {
  return {
    top: rect.top - amount,
    left: rect.left - amount,
    width: rect.width + amount * 2,
    height: rect.height + amount * 2,
  };
}
