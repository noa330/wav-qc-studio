import type { SpotlightRect, SpotlightSize, SpotlightTourPlacement, SpotlightTourTarget } from "./types";

const viewportMargin = 12;
const panelGap = 14;
const targetGuardPadding = 8;

export function resolveSpotlightElement(target: SpotlightTourTarget): HTMLElement | null {
  return resolveSpotlightElements(target)[0] ?? null;
}

export function resolveSpotlightElements(target: SpotlightTourTarget): HTMLElement[] {
  const { selectors, strategy } = normalizeSpotlightTarget(target);

  for (const selector of selectors) {
    if (strategy === "all") {
      const elements = Array.from(document.querySelectorAll<HTMLElement>(selector)).filter(isMeasurableElement);
      if (elements.length > 0) {
        return elements;
      }
      continue;
    }

    const element = document.querySelector<HTMLElement>(selector);
    if (element && isMeasurableElement(element)) {
      return [element];
    }
  }

  return [];
}

export function readSpotlightRect(element: HTMLElement): SpotlightRect {
  const rect = element.getBoundingClientRect();
  return {
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  };
}

export function readSpotlightElementsRect(elements: readonly HTMLElement[]): SpotlightRect | null {
  if (elements.length === 0) {
    return null;
  }

  let top = Number.POSITIVE_INFINITY;
  let left = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;

  for (const element of elements) {
    const rect = readSpotlightRect(element);
    top = Math.min(top, rect.top);
    left = Math.min(left, rect.left);
    right = Math.max(right, rect.left + rect.width);
    bottom = Math.max(bottom, rect.top + rect.height);
  }

  return {
    top,
    left,
    width: right - left,
    height: bottom - top,
  };
}

export function getTourPanelWidth(): number {
  if (typeof window === "undefined") {
    return 460;
  }

  return Math.min(460, Math.max(320, window.innerWidth - viewportMargin * 2));
}

export function computeTourPanelPosition(
  target: SpotlightRect | null,
  placement: SpotlightTourPlacement,
  panel: SpotlightSize,
): { top: number; left: number } {
  if (!target) {
    return centerPanel(panel);
  }

  const placements = orderPlacements(placement);
  let fallback = {
    position: clampPanelPosition(computePlacementPosition(target, placement, panel), panel),
    overlap: Number.POSITIVE_INFINITY,
  };
  const guardedTarget = expandRect(target, targetGuardPadding);

  for (const currentPlacement of placements) {
    const position = clampPanelPosition(computePlacementPosition(target, currentPlacement, panel), panel);
    const overlap = getIntersectionArea(toPanelRect(position, panel), guardedTarget);

    if (overlap === 0) {
      return position;
    }

    if (overlap < fallback.overlap) {
      fallback = { position, overlap };
    }
  }

  return fallback.position;
}

function computePlacementPosition(
  target: SpotlightRect,
  placement: SpotlightTourPlacement,
  panel: SpotlightSize,
): { top: number; left: number } {
  let top = target.top;
  let left = target.left;

  switch (placement) {
    case "top":
      top = target.top - panelGap - panel.height;
      left = target.left + target.width / 2 - panel.width / 2;
      break;
    case "bottom":
      top = target.top + target.height + panelGap;
      left = target.left + target.width / 2 - panel.width / 2;
      break;
    case "left":
      top = target.top + target.height / 2 - panel.height / 2;
      left = target.left - panelGap - panel.width;
      break;
    case "right":
      top = target.top + target.height / 2 - panel.height / 2;
      left = target.left + target.width + panelGap;
      break;
  }

  return { top, left };
}

function orderPlacements(preferred: SpotlightTourPlacement): SpotlightTourPlacement[] {
  const fallbackOrder: SpotlightTourPlacement[] = ["bottom", "right", "left", "top"];
  const opposite: Record<SpotlightTourPlacement, SpotlightTourPlacement> = {
    top: "bottom",
    bottom: "top",
    left: "right",
    right: "left",
  };

  return [
    preferred,
    opposite[preferred],
    ...fallbackOrder.filter((placement) => placement !== preferred && placement !== opposite[preferred]),
  ];
}

function centerPanel(panel: SpotlightSize): { top: number; left: number } {
  if (typeof window === "undefined") {
    return { top: viewportMargin, left: viewportMargin };
  }

  return clampPanelPosition(
    {
      top: window.innerHeight / 2 - panel.height / 2,
      left: window.innerWidth / 2 - panel.width / 2,
    },
    panel,
  );
}

function clampPanelPosition(position: { top: number; left: number }, panel: SpotlightSize): { top: number; left: number } {
  if (typeof window === "undefined") {
    return position;
  }

  const maxLeft = Math.max(viewportMargin, window.innerWidth - panel.width - viewportMargin);
  const maxTop = Math.max(viewportMargin, window.innerHeight - panel.height - viewportMargin);

  return {
    left: Math.min(Math.max(viewportMargin, position.left), maxLeft),
    top: Math.min(Math.max(viewportMargin, position.top), maxTop),
  };
}

function expandRect(rect: SpotlightRect, padding: number): SpotlightRect {
  return {
    top: rect.top - padding,
    left: rect.left - padding,
    width: rect.width + padding * 2,
    height: rect.height + padding * 2,
  };
}

function toPanelRect(position: { top: number; left: number }, panel: SpotlightSize): SpotlightRect {
  return {
    top: position.top,
    left: position.left,
    width: panel.width,
    height: panel.height,
  };
}

function getIntersectionArea(a: SpotlightRect, b: SpotlightRect): number {
  const x = Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left));
  const y = Math.max(0, Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top));
  return x * y;
}

function normalizeSpotlightTarget(target: SpotlightTourTarget): { selectors: readonly string[]; strategy: "first" | "all" } {
  if (isSpotlightTargetConfig(target)) {
    return {
      selectors: typeof target.selectors === "string" ? [target.selectors] : target.selectors,
      strategy: target.strategy ?? "first",
    };
  }

  return {
    selectors: typeof target === "string" ? [target] : target,
    strategy: "first",
  };
}

function isMeasurableElement(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function isSpotlightTargetConfig(
  target: SpotlightTourTarget,
): target is Extract<SpotlightTourTarget, { selectors: unknown }> {
  return typeof target !== "string" && !Array.isArray(target);
}
