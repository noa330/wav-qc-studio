import type { DataTableRow } from "@shared/ipc";
import type { WaveformMarker } from "@/shared/components/waveform";
import { sliceComponentId } from "../../../model/slice-segments";
import { resolveSliceSourceIdentity } from "../../../model/workspace-runtime-selection";
import { clamp } from "../../shared/workspace-ui-utils";

export function buildDisplayMarkerParts(rowId: string, components: Array<{ startSec: number; endSec: number }>, markerStartSec: number, markerEndSec: number, totalSec: number, selectedComponentIds: string[]): NonNullable<WaveformMarker["parts"]> {
  return components.map((component, index) => {
    const componentId = sliceComponentId(rowId, index);
    const nextComponent = components[index + 1];
    const previousDisplayEnd = index > 0 ? Math.max(components[index - 1].endSec, component.startSec) : markerStartSec;
    const displayStartSec = index === 0 ? markerStartSec : previousDisplayEnd;
    const displayEndSec = nextComponent ? Math.max(component.endSec, nextComponent.startSec) : markerEndSec;

    return {
      id: componentId,
      start: clamp(component.startSec / totalSec, 0, 1),
      end: clamp(component.endSec / totalSec, 0, 1),
      displayStart: clamp(displayStartSec / totalSec, 0, 1),
      displayEnd: clamp(Math.max(displayStartSec + 0.001, displayEndSec) / totalSec, 0, 1),
      selected: selectedComponentIds.includes(componentId),
    };
  });
}

export function resolveOriginalPath(row: DataTableRow): string {
  return resolveSliceSourceIdentity(row);
}
