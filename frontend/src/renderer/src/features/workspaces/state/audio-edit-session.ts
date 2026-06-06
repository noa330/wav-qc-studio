import { useSyncExternalStore } from "react";
import type { AudioEditOperation, AudioEditResult } from "@shared/ipc";
import { studioBackend } from "@/services/studio-backend";

export type AudioRangeMarker = {
  id: string;
  startSec: number;
  endSec: number;
  createdAt: number;
};

export type AudioEditEntry = {
  basePath: string;
  scopeId?: string;
  effectivePath: string;
  revision: number;
  durationSeconds?: number;
  viewStart: number;
  viewEnd: number;
  markers: AudioRangeMarker[];
  activeMarkerId?: string;
  busy: boolean;
  error?: string;
};

export type AudioEditClipboard = {
  path: string;
  durationSeconds: number;
  sourcePath: string;
};

export type AudioEditSessionSnapshot = {
  entries: AudioEditEntry[];
  clipboard?: AudioEditClipboard;
  nextMarkerCounter: number;
};

const minAudioViewSpan = 0.0000001;
const minMarkerSeconds = 0.005;
const entries = new Map<string, AudioEditEntry>();
const listeners = new Set<() => void>();
let clipboard: AudioEditClipboard | undefined;
let nextMarkerCounter = 1;

export function useAudioEditEntry(basePath: string | undefined, scopeId?: string): AudioEditEntry {
  return useSyncExternalStore(subscribeAudioEditSession, () => getAudioEditEntry(basePath, scopeId), () => getAudioEditEntry(basePath, scopeId));
}

export function useAudioEditClipboard(): AudioEditClipboard | undefined {
  return useSyncExternalStore(subscribeAudioEditSession, () => clipboard, () => clipboard);
}

export function resolveEditedAudioPath(basePath: string | undefined, scopeId?: string): string | undefined {
  if (!basePath?.trim()) {
    return basePath;
  }

  return getAudioEditEntry(basePath, scopeId).effectivePath || basePath;
}

export function getAudioEditExportMap(scopeId?: string): Record<string, string> {
  const map: Record<string, string> = {};
  const normalizedScope = normalizeScopeId(scopeId);
  for (const entry of entries.values()) {
    if (normalizeScopeId(entry.scopeId) !== normalizedScope || !entry.basePath || normalizePath(entry.basePath) === normalizePath(entry.effectivePath)) {
      continue;
    }
    map[entry.basePath] = entry.effectivePath;
  }
  return map;
}

export function getAudioEditSessionSnapshot(): AudioEditSessionSnapshot {
  return {
    entries: [...entries.values()].map((entry) => ({
      ...entry,
      markers: entry.markers.map((marker) => ({ ...marker })),
      busy: false,
      error: undefined,
    })),
    clipboard: clipboard ? { ...clipboard } : undefined,
    nextMarkerCounter,
  };
}

export function createEmptyAudioEditSessionSnapshot(): AudioEditSessionSnapshot {
  return {
    entries: [],
    nextMarkerCounter: 1,
  };
}

export function normalizeAudioEditSessionSnapshot(raw: unknown): AudioEditSessionSnapshot {
  if (!isRecord(raw)) {
    return createEmptyAudioEditSessionSnapshot();
  }

  return {
    entries: Array.isArray(raw.entries) ? raw.entries.flatMap(normalizeAudioEditEntry) : [],
    clipboard: normalizeAudioEditClipboard(raw.clipboard),
    nextMarkerCounter: Number.isFinite(raw.nextMarkerCounter) ? Math.max(1, Math.trunc(raw.nextMarkerCounter as number)) : 1,
  };
}

export function restoreAudioEditSessionSnapshot(raw: unknown): void {
  const snapshot = normalizeAudioEditSessionSnapshot(raw);
  entries.clear();
  for (const entry of snapshot.entries) {
    entries.set(entryKey(entry.basePath, entry.scopeId), entry);
  }
  clipboard = snapshot.clipboard;
  nextMarkerCounter = snapshot.nextMarkerCounter;
  emitAudioEditSession();
}

export function setAudioEditDuration(basePath: string | undefined, durationSeconds: number, scopeId?: string): void {
  if (!basePath?.trim() || !Number.isFinite(durationSeconds) || durationSeconds < 0) {
    return;
  }

  patchEntry(basePath, scopeId, (entry) => ({
    ...entry,
    durationSeconds,
    markers: clampMarkers(entry.markers, durationSeconds),
  }));
}

export function createAudioRangeMarker(basePath: string | undefined, startSec: number, endSec: number, scopeId?: string): void {
  if (!basePath?.trim()) {
    return;
  }

  patchEntry(basePath, scopeId, (entry) => {
    const durationSeconds = Math.max(0, entry.durationSeconds ?? Math.max(startSec, endSec));
    const marker = normalizeMarkerRange(createMarkerId(), startSec, endSec, durationSeconds);
    if (!marker) {
      return entry;
    }

    return {
      ...entry,
      markers: [...entry.markers, marker],
      activeMarkerId: marker.id,
      error: undefined,
    };
  });
}

export function selectAudioRangeMarker(basePath: string | undefined, markerId: string, scopeId?: string): void {
  if (!basePath?.trim()) {
    return;
  }

  patchEntry(basePath, scopeId, (entry) => ({
    ...entry,
    activeMarkerId: entry.markers.some((marker) => marker.id === markerId) ? markerId : entry.activeMarkerId,
  }));
}

export function updateAudioRangeMarkerBounds(basePath: string | undefined, markerId: string, startSec: number, endSec: number, scopeId?: string): void {
  if (!basePath?.trim()) {
    return;
  }

  patchEntry(basePath, scopeId, (entry) => {
    const durationSeconds = Math.max(0, entry.durationSeconds ?? Math.max(startSec, endSec));
    let changed = false;
    const markers = entry.markers.map((marker) => {
      if (marker.id !== markerId) {
        return marker;
      }

      const nextMarker = normalizeMarkerRange(marker.id, startSec, endSec, durationSeconds, marker.createdAt);
      if (!nextMarker) {
        return marker;
      }

      changed = changed || Math.abs(nextMarker.startSec - marker.startSec) > 0.0005 || Math.abs(nextMarker.endSec - marker.endSec) > 0.0005;
      return nextMarker;
    });

    if (!changed) {
      return entry;
    }

    return {
      ...entry,
      markers,
      activeMarkerId: markerId,
      error: undefined,
    };
  });
}

export function removeAudioRangeMarker(basePath: string | undefined, markerId: string, scopeId?: string): void {
  if (!basePath?.trim()) {
    return;
  }

  patchEntry(basePath, scopeId, (entry) => {
    const markerIndex = entry.markers.findIndex((marker) => marker.id === markerId);
    if (markerIndex < 0) {
      return entry;
    }

    const markers = entry.markers.filter((marker) => marker.id !== markerId);
    const activeMarkerId = entry.activeMarkerId === markerId
      ? markers[Math.min(markerIndex, Math.max(0, markers.length - 1))]?.id
      : entry.activeMarkerId;
    return {
      ...entry,
      markers,
      activeMarkerId,
      error: undefined,
    };
  });
}

export function zoomAudioEditView(basePath: string | undefined, anchor: number, deltaY: number, scopeId?: string): void {
  if (!basePath?.trim()) {
    return;
  }

  patchEntry(basePath, scopeId, (entry) => {
    const factor = deltaY < 0 ? 0.72 : 1.28;
    const currentStart = clamp(entry.viewStart, 0, 1);
    const currentEnd = clamp(entry.viewEnd, currentStart + minAudioViewSpan, 1);
    const currentSpan = currentEnd - currentStart;
    const nextSpan = clamp(currentSpan * factor, minAudioViewSpan, 1);
    const safeAnchor = clamp(anchor, 0, 1);
    let nextStart = currentStart + currentSpan * safeAnchor - nextSpan * safeAnchor;
    let nextEnd = nextStart + nextSpan;

    if (nextStart < 0) {
      nextEnd -= nextStart;
      nextStart = 0;
    }

    if (nextEnd > 1) {
      nextStart -= nextEnd - 1;
      nextEnd = 1;
    }

    return {
      ...entry,
      viewStart: clamp(nextStart, 0, 1 - minAudioViewSpan),
      viewEnd: clamp(nextEnd, minAudioViewSpan, 1),
    };
  });
}

export function setAudioEditViewRange(basePath: string | undefined, start: number, end: number, scopeId?: string): void {
  if (!basePath?.trim()) {
    return;
  }

  patchEntry(basePath, scopeId, (entry) => {
    const safeStart = clamp(start, 0, 1);
    const safeEnd = clamp(end, safeStart + minAudioViewSpan, 1);
    const span = Math.max(minAudioViewSpan, safeEnd - safeStart);
    const nextStart = clamp(safeStart, 0, 1 - span);
    return {
      ...entry,
      viewStart: nextStart,
      viewEnd: clamp(nextStart + span, minAudioViewSpan, 1),
    };
  });
}

export async function runAudioEditOperation(basePath: string | undefined, operation: AudioEditOperation, markerId?: string, scopeId?: string): Promise<AudioEditResult | undefined> {
  if (!basePath?.trim()) {
    return undefined;
  }

  const entry = getAudioEditEntry(basePath, scopeId);
  const marker = entry.markers.find((item) => item.id === (markerId ?? entry.activeMarkerId));
  if (!marker || marker.endSec <= marker.startSec || entry.busy) {
    return undefined;
  }

  if (operation === "paste" && !clipboard?.path) {
    return undefined;
  }

  patchEntry(basePath, scopeId, (current) => ({ ...current, busy: true, error: undefined }));

  try {
    const latestEntry = getAudioEditEntry(basePath, scopeId);
    const result = await studioBackend.editWave({
      sourcePath: latestEntry.effectivePath || basePath,
      operation,
      startSec: marker.startSec,
      endSec: marker.endSec,
      clipboardPath: operation === "paste" ? clipboard?.path : undefined,
    });

    if (operation === "copy") {
      if (!result.ok || !result.clipboardPath) {
        patchEntry(basePath, scopeId, (current) => ({ ...current, busy: false, error: result.error ?? "오디오 복사에 실패했습니다." }));
        return result;
      }

      clipboard = {
        path: result.clipboardPath,
        durationSeconds: Math.max(0, result.clipboardDurationSeconds ?? marker.endSec - marker.startSec),
        sourcePath: basePath,
      };
      patchEntry(basePath, scopeId, (current) => ({ ...current, activeMarkerId: marker.id, busy: false, error: undefined }));
      emitAudioEditSession();
      return result;
    }

    if (!result.ok || !result.outputPath) {
      patchEntry(basePath, scopeId, (current) => ({ ...current, busy: false, error: result.error ?? "오디오 편집에 실패했습니다." }));
      return result;
    }

    if (operation === "cut" && result.clipboardPath) {
      clipboard = {
        path: result.clipboardPath,
        durationSeconds: Math.max(0, result.clipboardDurationSeconds ?? marker.endSec - marker.startSec),
        sourcePath: basePath,
      };
    }

    const insertedDuration = operation === "paste" ? Math.max(0, result.clipboardDurationSeconds ?? clipboard?.durationSeconds ?? 0) : 0;
    const nextDuration = Math.max(0, result.durationSeconds ?? latestEntry.durationSeconds ?? 0);
    patchEntry(basePath, scopeId, (current) => {
      const transformed = transformMarkersAfterEdit(current.markers, operation, marker, nextDuration, insertedDuration);
      return {
        ...current,
        effectivePath: result.outputPath!,
        revision: current.revision + 1,
        durationSeconds: nextDuration,
        markers: transformed.markers,
        activeMarkerId: transformed.activeMarkerId,
        busy: false,
        error: undefined,
      };
    });

    emitAudioEditSession();
    return result;
  } catch (error) {
    patchEntry(basePath, scopeId, (current) => ({ ...current, busy: false, error: error instanceof Error ? error.message : String(error) }));
    return undefined;
  }
}

function transformMarkersAfterEdit(markers: AudioRangeMarker[], operation: AudioEditOperation, activeMarker: AudioRangeMarker, nextDuration: number, insertedDuration: number): { markers: AudioRangeMarker[]; activeMarkerId?: string } {
  const start = activeMarker.startSec;
  const end = activeMarker.endSec;
  const removedDuration = Math.max(0, end - start);

  if (operation === "keep") {
    const marker = normalizeMarkerRange(createMarkerId(), 0, nextDuration, nextDuration);
    return { markers: marker ? [marker] : [], activeMarkerId: marker?.id };
  }

  if (operation === "paste") {
    const pastedMarker = normalizeMarkerRange(createMarkerId(), start, start + insertedDuration, nextDuration);
    const delta = insertedDuration - removedDuration;
    const nextMarkers = markers.flatMap((marker) => {
      if (marker.id === activeMarker.id || rangesOverlap(marker.startSec, marker.endSec, start, end)) {
        return [];
      }
      if (marker.startSec >= end) {
        const shifted = normalizeMarkerRange(marker.id, marker.startSec + delta, marker.endSec + delta, nextDuration, marker.createdAt);
        return shifted ? [shifted] : [];
      }
      return [marker];
    });
    const finalMarkers = pastedMarker ? [...nextMarkers, pastedMarker] : nextMarkers;
    return { markers: finalMarkers, activeMarkerId: pastedMarker?.id ?? lastMarker(finalMarkers)?.id };
  }

  const delta = removedDuration;
  const nextMarkers = markers.flatMap((marker) => {
    if (marker.id === activeMarker.id || rangesOverlap(marker.startSec, marker.endSec, start, end)) {
      return [];
    }
    if (marker.startSec >= end) {
      const shifted = normalizeMarkerRange(marker.id, marker.startSec - delta, marker.endSec - delta, nextDuration, marker.createdAt);
      return shifted ? [shifted] : [];
    }
    return [marker];
  });

  const finalMarkers = clampMarkers(nextMarkers, nextDuration);
  return { markers: finalMarkers, activeMarkerId: lastMarker(finalMarkers)?.id };
}

function getAudioEditEntry(basePath: string | undefined, scopeId?: string): AudioEditEntry {
  const path = basePath?.trim() ?? "";
  const key = entryKey(path, scopeId);
  if (!path) {
    return emptyEntry;
  }

  const existing = entries.get(key);
  if (existing) {
    return existing;
  }

  const entry: AudioEditEntry = {
    basePath: path,
    scopeId: normalizeScopeId(scopeId),
    effectivePath: path,
    revision: 0,
    viewStart: 0,
    viewEnd: 1,
    markers: [],
    busy: false,
  };
  entries.set(key, entry);
  return entry;
}

const emptyEntry: AudioEditEntry = {
  basePath: "",
  scopeId: normalizeScopeId(undefined),
  effectivePath: "",
  revision: 0,
  viewStart: 0,
  viewEnd: 1,
  markers: [],
  busy: false,
};

function patchEntry(basePath: string, scopeId: string | undefined, updater: (entry: AudioEditEntry) => AudioEditEntry): void {
  const current = getAudioEditEntry(basePath, scopeId);
  const next = updater(current);
  if (next === current) {
    return;
  }
  entries.set(entryKey(current.basePath, current.scopeId), next);
  emitAudioEditSession();
}

export function subscribeAudioEditSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function normalizeAudioEditEntry(raw: unknown): AudioEditEntry[] {
  if (!isRecord(raw) || typeof raw.basePath !== "string" || !raw.basePath.trim()) {
    return [];
  }

  const basePath = raw.basePath.trim();
  const effectivePath = typeof raw.effectivePath === "string" && raw.effectivePath.trim() ? raw.effectivePath : basePath;
  return [{
    basePath,
    scopeId: typeof raw.scopeId === "string" ? normalizeScopeId(raw.scopeId) : undefined,
    effectivePath,
    revision: Number.isFinite(raw.revision) ? Math.max(0, Math.trunc(raw.revision as number)) : 0,
    durationSeconds: Number.isFinite(raw.durationSeconds) ? Math.max(0, raw.durationSeconds as number) : undefined,
    viewStart: clamp(Number.isFinite(raw.viewStart) ? raw.viewStart as number : 0, 0, 1 - minAudioViewSpan),
    viewEnd: clamp(Number.isFinite(raw.viewEnd) ? raw.viewEnd as number : 1, minAudioViewSpan, 1),
    markers: Array.isArray(raw.markers) ? raw.markers.flatMap(normalizeAudioRangeMarker) : [],
    activeMarkerId: typeof raw.activeMarkerId === "string" ? raw.activeMarkerId : undefined,
    busy: false,
    error: undefined,
  }];
}

function normalizeAudioRangeMarker(raw: unknown): AudioRangeMarker[] {
  if (!isRecord(raw) || typeof raw.id !== "string") {
    return [];
  }

  const startSec = Number.isFinite(raw.startSec) ? raw.startSec as number : 0;
  const endSec = Number.isFinite(raw.endSec) ? raw.endSec as number : startSec;
  if (endSec - startSec < minMarkerSeconds) {
    return [];
  }

  return [{
    id: raw.id,
    startSec,
    endSec,
    createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt as number : Date.now(),
  }];
}

function normalizeAudioEditClipboard(raw: unknown): AudioEditClipboard | undefined {
  if (!isRecord(raw) || typeof raw.path !== "string" || typeof raw.sourcePath !== "string") {
    return undefined;
  }

  return {
    path: raw.path,
    sourcePath: raw.sourcePath,
    durationSeconds: Number.isFinite(raw.durationSeconds) ? Math.max(0, raw.durationSeconds as number) : 0,
  };
}

function emitAudioEditSession(): void {
  for (const listener of listeners) {
    listener();
  }
}

function createMarkerId(): string {
  nextMarkerCounter += 1;
  return `audio-marker-${Date.now().toString(36)}-${nextMarkerCounter.toString(36)}`;
}

function normalizeMarkerRange(id: string, startSec: number, endSec: number, durationSeconds: number, createdAt = Date.now()): AudioRangeMarker | null {
  const duration = Math.max(0, durationSeconds);
  const start = clamp(Math.min(startSec, endSec), 0, duration);
  const end = clamp(Math.max(startSec, endSec), start, duration);
  if (end - start < minMarkerSeconds) {
    return null;
  }
  return { id, startSec: start, endSec: end, createdAt };
}

function clampMarkers(markers: AudioRangeMarker[], durationSeconds: number): AudioRangeMarker[] {
  return markers.flatMap((marker) => {
    const next = normalizeMarkerRange(marker.id, marker.startSec, marker.endSec, durationSeconds, marker.createdAt);
    return next ? [next] : [];
  });
}

function rangesOverlap(leftStart: number, leftEnd: number, rightStart: number, rightEnd: number): boolean {
  return leftStart < rightEnd && rightStart < leftEnd;
}

function lastMarker(markers: AudioRangeMarker[]): AudioRangeMarker | undefined {
  return markers.length > 0 ? markers[markers.length - 1] : undefined;
}

function entryKey(path: string, scopeId?: string): string {
  return `${normalizeScopeId(scopeId)}\u0000${normalizePath(path)}`;
}

function normalizeScopeId(scopeId: string | undefined): string {
  return scopeId?.trim() || "global";
}

function normalizePath(path: string): string {
  return path.trim().replace(/\\/gu, "/").toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}
