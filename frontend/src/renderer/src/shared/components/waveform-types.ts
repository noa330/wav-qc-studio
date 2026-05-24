import type { MouseEvent as ReactMouseEvent } from "react";
import type { WaveformData } from "@shared/ipc";

export type SelectionHandleStyle = "grip" | "markerBadge" | "trimHandles" | "none";

export type ViewportSelection = {
  x: number;
  width: number;
};

export type WaveformSurfaceProps = {
  audioPath?: string;
  bucketCount?: number;
  className?: string;
  emptyText?: string;
  framedTrack?: boolean;
  allowsSelectionCreationOnClick?: boolean;
  markerHandleWidth?: number;
  selectedMarkerHandleStyle?: "line" | "markerBadge";
  selectedMarkerHandleWidth?: number;
  markers?: WaveformMarker[];
  muted?: boolean;
  revision?: number;
  showRuler?: boolean;
  selectionStart?: number;
  selectionEnd?: number;
  selectionHandleStyle?: SelectionHandleStyle;
  selectionOverlayOpacity?: number;
  selectionWaveOpacity?: number;
  draftSelectionOverlayOpacity?: number;
  draftSelectionWaveOpacity?: number;
  viewStart?: number;
  viewEnd?: number;
  playhead?: number;
  onData?: (data: WaveformData) => void;
  onMarkerSelect?: (markerId: string, additive: boolean) => void;
  onMarkerContextMenu?: (markerId: string, event: ReactMouseEvent<Element>) => void;
  onMarkerPartSelect?: (markerId: string, partId: string, additive: boolean) => void;
  onMarkerRangeChange?: (markerId: string, start: number, end: number) => void;
  onRangeCreate?: (start: number, end: number) => void;
  onSelectionChange?: (start: number, end: number) => void;
  onWheelZoom?: (anchor: number, deltaY: number) => void;
};

export type WaveformMarker = {
  id: string;
  start: number;
  end: number;
  selected?: boolean;
  parts?: Array<{
    id: string;
    start: number;
    end: number;
    displayStart?: number;
    displayEnd?: number;
    selected?: boolean;
  }>;
};

export type NormalizedMarkerPart = {
  markerId: string;
  part: NonNullable<WaveformMarker["parts"]>[number];
  index: number;
  selection: ViewportSelection;
};

export type NormalizedMarker = {
  marker: WaveformMarker;
  selection: ViewportSelection;
  parts: NormalizedMarkerPart[];
};

export const emptyWaveform: WaveformData = {
  path: "",
  durationSeconds: 0,
  peaks: [],
};
