import { normalizeSelection } from "./waveform-geometry";
import type { WaveformBadgeAnchor } from "./waveform-handles";
import type { NormalizedMarker, NormalizedMarkerPart, SelectionHandleStyle, ViewportSelection, WaveformMarker } from "./waveform-types";

export function buildNormalizedMarkers(markers: WaveformMarker[], safeViewStart: number, safeViewEnd: number): NormalizedMarker[] {
  return markers
    .map((marker): NormalizedMarker | null => {
      const selection = normalizeSelection(marker.start, marker.end, safeViewStart, safeViewEnd);
      if (!selection) {
        return null;
      }

      const parts =
        marker.parts
          ?.map((part, index) => ({
            markerId: marker.id,
            part,
            index,
            selection: normalizeSelection(part.displayStart ?? part.start, part.displayEnd ?? part.end, safeViewStart, safeViewEnd),
          }))
          .filter((entry): entry is NormalizedMarkerPart => entry.selection !== null) ?? [];

      return { marker, selection, parts };
    })
    .filter((entry): entry is NormalizedMarker => entry !== null);
}

export function buildMarkerBadgeAnchors({
  displayedMarkers,
  displayedSelection,
  selectedMarkerHandleStyle,
  selectionHandleStyle,
}: {
  displayedMarkers: NormalizedMarker[];
  displayedSelection: ViewportSelection | null;
  selectedMarkerHandleStyle: "line" | "markerBadge";
  selectionHandleStyle: SelectionHandleStyle;
}): WaveformBadgeAnchor[] {
  const anchors: WaveformBadgeAnchor[] = [];

  if (selectedMarkerHandleStyle === "markerBadge") {
    for (const { marker, selection } of displayedMarkers) {
      if (!marker.selected) {
        continue;
      }

      anchors.push({ id: `${marker.id}-start`, x: selection.x });
      anchors.push({ id: `${marker.id}-end`, x: selection.x + selection.width });
    }
  }

  if (selectionHandleStyle === "markerBadge" && displayedSelection) {
    anchors.push({ id: "selection-start", x: displayedSelection.x });
    anchors.push({ id: "selection-end", x: displayedSelection.x + displayedSelection.width });
  }

  return anchors;
}
