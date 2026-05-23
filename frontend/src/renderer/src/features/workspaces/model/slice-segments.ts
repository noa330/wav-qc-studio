import type { DataTableRow } from "@shared/ipc";

export type SliceComponent = {
  startSec: number;
  endSec: number;
};

export type SliceRowBounds = SliceComponent;

const minimumSliceDurationSec = 0.001;
const sliceTimeEpsilonSec = 0.0005;

export function readSliceRowBounds(row: DataTableRow | undefined): SliceRowBounds {
  return {
    startSec: numberFromSliceRow(row, "startSec"),
    endSec: numberFromSliceRow(row, "endSec"),
  };
}

export function readSliceComponents(row: DataTableRow): SliceComponent[] {
  const bounds = readSliceRowBounds(row);
  const raw = row.raw?.markerComponents || row.raw?.marker_components || "";
  const parsedComponents = parseSerializedSliceComponents(raw);
  if (parsedComponents.length > 0) {
    return normalizeSliceComponentsForRow(parsedComponents, bounds);
  }

  const count = Math.max(1, Math.trunc(Number(row.raw?.markerCount || row.cells.markerCount || 1)));
  if (count <= 1 || bounds.endSec <= bounds.startSec) {
    return bounds.endSec > bounds.startSec ? [bounds] : [];
  }

  const span = (bounds.endSec - bounds.startSec) / count;
  return Array.from({ length: count }, (_, index) => ({
    startSec: bounds.startSec + span * index,
    endSec: index === count - 1 ? bounds.endSec : bounds.startSec + span * (index + 1),
  }));
}

export function splitSingleSliceComponent(component: SliceComponent): SliceComponent[][] {
  const midpoint = component.startSec + (component.endSec - component.startSec) / 2;
  if (midpoint <= component.startSec || midpoint >= component.endSec) {
    return [[component]];
  }

  return [
    [{ startSec: component.startSec, endSec: midpoint }],
    [{ startSec: midpoint, endSec: component.endSec }],
  ];
}

export function partitionSliceComponents(rowId: string, components: SliceComponent[], componentIds: string[]): SliceComponent[][] {
  const selectedIndexes = new Set(
    componentIds
      .map(parseSliceComponentId)
      .filter((componentId): componentId is { rowId: string; index: number } => componentId !== null && componentId.rowId === rowId && componentId.index >= 0 && componentId.index < components.length)
      .map((componentId) => componentId.index),
  );
  if (selectedIndexes.size === 0) {
    return components.map((component) => [component]);
  }

  const groups: SliceComponent[][] = [];
  let current: SliceComponent[] = [];
  components.forEach((component, index) => {
    if (selectedIndexes.has(index)) {
      if (current.length > 0) {
        groups.push(current);
        current = [];
      }
      groups.push([component]);
      return;
    }

    current.push(component);
  });

  if (current.length > 0) {
    groups.push(current);
  }

  return groups;
}

export function retimeSliceComponents(row: DataTableRow, nextStartSec: number, nextEndSec: number): SliceComponent[] | undefined {
  const components = readSliceComponents(row);
  if (components.length <= 1) {
    return undefined;
  }

  const previousStartSec = Math.min(...components.map((component) => component.startSec));
  const previousEndSec = Math.max(...components.map((component) => component.endSec));
  const previousDurationSec = previousEndSec - previousStartSec;
  const nextDurationSec = nextEndSec - nextStartSec;
  if (previousDurationSec <= 0 || nextDurationSec <= 0) {
    return undefined;
  }

  const durationDelta = Math.abs(previousDurationSec - nextDurationSec);
  if (durationDelta <= 0.005) {
    const offsetSec = nextStartSec - previousStartSec;
    return normalizeSliceComponents(
      components.map((component) => ({
        startSec: component.startSec + offsetSec,
        endSec: component.endSec + offsetSec,
      })),
    );
  }

  const scale = nextDurationSec / previousDurationSec;
  return normalizeSliceComponents(
    components.map((component) => ({
      startSec: nextStartSec + (component.startSec - previousStartSec) * scale,
      endSec: nextStartSec + (component.endSec - previousStartSec) * scale,
    })),
  );
}

export function serializeSliceComponents(components: SliceComponent[]): string {
  return JSON.stringify(normalizeSliceComponents(components).map((component) => ({ startSec: component.startSec, endSec: component.endSec })));
}

export function sliceComponentId(rowId: string, index: number): string {
  return `${rowId}:${index}`;
}

export function sliceRowIdFromComponentId(componentId: string): string {
  return parseSliceComponentId(componentId)?.rowId ?? componentId;
}

export function numberFromSliceRow(row: DataTableRow | undefined, key: string): number {
  if (!row) {
    return 0;
  }

  const value = row.raw?.[key] || row.cells[key] || "";
  const text = String(value).trim();
  const timeMatch = text.match(/^(\d+):(\d+(?:\.\d+)?)$/u);
  if (timeMatch) {
    return Number(timeMatch[1]) * 60 + Number(timeMatch[2]);
  }

  const numeric = Number(text.replace(/[^0-9.+-]/gu, ""));
  return Number.isFinite(numeric) ? numeric : 0;
}

function parseSerializedSliceComponents(raw: string): SliceComponent[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return normalizeSliceComponents(
      parsed.flatMap((item) => {
        if (typeof item !== "object" || item === null) {
          return [];
        }

        const record = item as Record<string, unknown>;
        return [{
          startSec: Number(record.startSec),
          endSec: Number(record.endSec),
        }];
      }),
    );
  } catch {
    return [];
  }
}

function normalizeSliceComponentsForRow(components: SliceComponent[], bounds: SliceRowBounds): SliceComponent[] {
  const normalized = normalizeSliceComponents(components);
  if (normalized.length === 0) {
    return [];
  }

  const rowStartSec = bounds.startSec;
  const rowEndSec = bounds.endSec;
  const rowDurationSec = rowEndSec - rowStartSec;
  if (rowDurationSec <= 0) {
    return normalized;
  }

  const minComponentStartSec = Math.min(...normalized.map((component) => component.startSec));
  const maxComponentEndSec = Math.max(...normalized.map((component) => component.endSec));
  const fitsAbsoluteBounds = minComponentStartSec >= rowStartSec - sliceTimeEpsilonSec && maxComponentEndSec <= rowEndSec + sliceTimeEpsilonSec;
  const fitsRelativeBounds = minComponentStartSec >= -sliceTimeEpsilonSec && maxComponentEndSec <= rowDurationSec + sliceTimeEpsilonSec;
  const componentsInAbsoluteSeconds = fitsAbsoluteBounds || !fitsRelativeBounds || rowStartSec <= sliceTimeEpsilonSec
    ? normalized
    : normalized.map((component) => ({
        startSec: component.startSec + rowStartSec,
        endSec: component.endSec + rowStartSec,
      }));

  return normalizeSliceComponents(
    componentsInAbsoluteSeconds.map((component) => ({
      startSec: clamp(component.startSec, rowStartSec, rowEndSec),
      endSec: clamp(component.endSec, rowStartSec, rowEndSec),
    })),
  );
}

function normalizeSliceComponents(components: SliceComponent[]): SliceComponent[] {
  return components
    .flatMap((component) => {
      const startSec = Math.max(0, Number(component.startSec));
      const endSec = Math.max(0, Number(component.endSec));
      return Number.isFinite(startSec) && Number.isFinite(endSec) && endSec - startSec >= minimumSliceDurationSec ? [{ startSec, endSec }] : [];
    })
    .sort((left, right) => left.startSec - right.startSec || left.endSec - right.endSec);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function parseSliceComponentId(componentId: string): { rowId: string; index: number } | null {
  const separatorIndex = componentId.lastIndexOf(":");
  if (separatorIndex <= 0 || separatorIndex >= componentId.length - 1) {
    return null;
  }

  const index = Number(componentId.slice(separatorIndex + 1));
  if (!Number.isInteger(index)) {
    return null;
  }

  return {
    rowId: componentId.slice(0, separatorIndex),
    index,
  };
}
