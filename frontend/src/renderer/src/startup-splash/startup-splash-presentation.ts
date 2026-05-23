import { useEffect, useMemo, useRef, useState } from "react";
import type { StartupSplashProgress, StartupSplashStep } from "@shared/ipc";
import { startupSplashFullRevealAnimationMs } from "@shared/startup-splash";

const maxProgress = 100;

export type PresentedStartupSplash = {
  progressPercent: number;
  steps: StartupSplashStep[];
};

export function useStartupSplashPresentation(progress: StartupSplashProgress, fallbackSteps: StartupSplashStep[]): PresentedStartupSplash {
  const targetPercent = clampProgress(progress.progressPercent);
  const [presentedPercent, setPresentedPercent] = useState(0);
  const targetRef = useRef(targetPercent);
  const frameRef = useRef<number | undefined>(undefined);
  const lastFrameAtRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    targetRef.current = Math.max(targetRef.current, targetPercent);

    if (frameRef.current !== undefined) {
      return;
    }

    const progressPerMs = maxProgress / startupSplashFullRevealAnimationMs;

    const tick = (frameAt: number) => {
      const lastFrameAt = lastFrameAtRef.current ?? frameAt;
      lastFrameAtRef.current = frameAt;
      const elapsedMs = Math.max(0, frameAt - lastFrameAt);
      let reachedTarget = false;

      setPresentedPercent((currentPercent) => {
        const target = targetRef.current;
        if (currentPercent >= target) {
          reachedTarget = true;
          return currentPercent;
        }

        const nextPercent = Math.min(target, currentPercent + elapsedMs * progressPerMs);
        reachedTarget = nextPercent >= target;
        return nextPercent;
      });

      if (reachedTarget) {
        frameRef.current = undefined;
        lastFrameAtRef.current = undefined;
        return;
      }

      frameRef.current = window.requestAnimationFrame(tick);
    };

    frameRef.current = window.requestAnimationFrame(tick);

    return () => {
      if (frameRef.current !== undefined) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = undefined;
      }
      lastFrameAtRef.current = undefined;
    };
  }, [targetPercent]);

  const sourceSteps = progress.steps?.length ? progress.steps : fallbackSteps;
  const steps = useMemo(() => derivePresentedSteps(sourceSteps, presentedPercent), [sourceSteps, presentedPercent]);

  return {
    progressPercent: Math.round(deriveCurrentStepProgress(sourceSteps, presentedPercent)),
    steps,
  };
}

function derivePresentedSteps(steps: StartupSplashStep[], progressPercent: number): StartupSplashStep[] {
  if (steps.length === 0) {
    return steps;
  }

  const segmentSize = maxProgress / steps.length;
  const activeIndex = Math.min(steps.length - 1, Math.floor(progressPercent / segmentSize));

  return steps.map((step, index) => {
    const doneAt = segmentSize * (index + 1);
    const state = progressPercent >= doneAt ? "done" : index === activeIndex ? "active" : "pending";
    return { ...step, state };
  });
}

function deriveCurrentStepProgress(steps: StartupSplashStep[], progressPercent: number): number {
  if (steps.length === 0) {
    return clampProgress(progressPercent);
  }

  if (progressPercent >= maxProgress) {
    return maxProgress;
  }

  const segmentSize = maxProgress / steps.length;
  const activeIndex = Math.min(steps.length - 1, Math.floor(progressPercent / segmentSize));
  const segmentStart = segmentSize * activeIndex;
  const localProgress = ((progressPercent - segmentStart) / segmentSize) * maxProgress;
  return clampProgress(localProgress);
}

function clampProgress(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(maxProgress, value));
}
