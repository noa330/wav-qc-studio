import { useLayoutEffect, useState } from "react";
import { readSpotlightElementsRect, resolveSpotlightElements } from "./geometry";
import type { SpotlightRect, SpotlightTourTarget } from "./types";

type SpotlightTargetState = {
  rect: SpotlightRect | null;
  missing: boolean;
};

const targetSettleTrackingMs = 1200;
const targetEventTrackingMs = 420;

export function useSpotlightTarget(target: SpotlightTourTarget | undefined, active: boolean): SpotlightTargetState {
  const [state, setState] = useState<SpotlightTargetState>({ rect: null, missing: false });

  useLayoutEffect(() => {
    if (!active || !target || typeof document === "undefined") {
      setState({ rect: null, missing: false });
      return undefined;
    }

    let disposed = false;
    let retryTimer: number | undefined;
    let frame: number | undefined;
    let trackingFrame: number | undefined;
    let trackUntil = 0;
    let observer: ResizeObserver | undefined;
    let elements: HTMLElement[] = [];

    const setMeasuredState = (nextState: SpotlightTargetState) => {
      setState((current) => {
        if (current.missing === nextState.missing && sameRect(current.rect, nextState.rect)) {
          return current;
        }
        return nextState;
      });
    };

    const update = () => {
      if (disposed || elements.length === 0) {
        return;
      }

      setMeasuredState({ rect: readSpotlightElementsRect(elements), missing: false });
    };

    const followTargetMotion = (durationMs: number) => {
      if (typeof window === "undefined") {
        return;
      }

      trackUntil = Math.max(trackUntil, performance.now() + durationMs);
      if (trackingFrame !== undefined) {
        return;
      }

      const tick = () => {
        trackingFrame = undefined;
        if (disposed) {
          return;
        }

        update();
        if (performance.now() < trackUntil) {
          trackingFrame = window.requestAnimationFrame(tick);
        }
      };

      trackingFrame = window.requestAnimationFrame(tick);
    };

    const connect = (nextElements: HTMLElement[]) => {
      observer?.disconnect();
      elements = nextElements;
      elements[0]?.scrollIntoView({ block: "nearest", inline: "nearest" });
      update();
      followTargetMotion(targetSettleTrackingMs);

      if (typeof ResizeObserver !== "undefined") {
        observer = new ResizeObserver(update);
        for (const element of elements) {
          observer.observe(element);
        }
      }
    };

    const findTarget = (attempt: number) => {
      if (disposed) {
        return;
      }

      const nextElements = resolveSpotlightElements(target);
      if (nextElements.length > 0) {
        connect(nextElements);
        return;
      }

      if (attempt < 16) {
        retryTimer = window.setTimeout(() => findTarget(attempt + 1), 45);
        return;
      }

      setMeasuredState({ rect: null, missing: true });
    };

    frame = window.requestAnimationFrame(() => findTarget(0));

    const handleViewportChange = () => {
      update();
      followTargetMotion(targetEventTrackingMs);
    };

    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);

    return () => {
      disposed = true;
      if (frame !== undefined) {
        window.cancelAnimationFrame(frame);
      }
      if (retryTimer !== undefined) {
        window.clearTimeout(retryTimer);
      }
      if (trackingFrame !== undefined) {
        window.cancelAnimationFrame(trackingFrame);
      }
      observer?.disconnect();
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [active, target]);

  return state;
}

function sameRect(left: SpotlightRect | null, right: SpotlightRect | null): boolean {
  if (!left || !right) {
    return left === right;
  }

  return (
    nearlyEqual(left.top, right.top)
    && nearlyEqual(left.left, right.left)
    && nearlyEqual(left.width, right.width)
    && nearlyEqual(left.height, right.height)
  );
}

function nearlyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) < 0.5;
}
