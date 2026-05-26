export type SpotlightTourPlacement = "top" | "bottom" | "left" | "right";

export type SpotlightTourTargetSelector = string | readonly string[];

export type SpotlightTourTarget =
  | SpotlightTourTargetSelector
  | {
      selectors: SpotlightTourTargetSelector;
      strategy?: "first" | "all";
    };

export type SpotlightTourStep = {
  id: string;
  target: SpotlightTourTarget;
  title: string;
  description: string;
  caption?: string;
  bullets?: readonly string[];
  placement?: SpotlightTourPlacement;
  visualCue?: "panel-resize" | "cell-resize" | "context-menu";
};

export type SpotlightRect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

export type SpotlightSize = {
  width: number;
  height: number;
};
