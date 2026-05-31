import { useSyncExternalStore } from "react";

type SeekRequest = {
  id: number;
  time: number;
};

type SegmentPreviewRequest = {
  id: number;
  start: number;
  end: number;
};

type PlayRequest = {
  id: number;
  play: boolean;
};

type VolumeRequest = {
  id: number;
  volume: number;
};

export type WorkspaceAudioSyncSnapshot = {
  audioPath?: string;
  currentTime: number;
  duration: number;
  isPlaying?: boolean;
  volume?: number;
  seekRequest?: SeekRequest;
  focusRequest?: SeekRequest;
  previewRequest?: SegmentPreviewRequest;
  activeTabId?: string;
  playRequest?: PlayRequest;
  volumeRequest?: VolumeRequest;
};

type WorkspaceAudioSyncStore = {
  snapshot: WorkspaceAudioSyncSnapshot;
  listeners: Set<() => void>;
};

const stores = new Map<string, WorkspaceAudioSyncStore>();
const emptySnapshot: WorkspaceAudioSyncSnapshot = {
  currentTime: 0,
  duration: 0,
};

export function useWorkspaceAudioSync(key: string | undefined): WorkspaceAudioSyncSnapshot {
  const storeKey = key ?? "";
  return useSyncExternalStore(
    (listener) => subscribeWorkspaceAudioSync(storeKey, listener),
    () => getWorkspaceAudioSnapshot(storeKey),
    () => getWorkspaceAudioSnapshot(storeKey),
  );
}

export function publishWorkspaceAudioPosition(
  key: string | undefined,
  patch: Pick<WorkspaceAudioSyncSnapshot, "audioPath" | "currentTime" | "duration" | "isPlaying" | "volume">
): void {
  if (!key) {
    return;
  }

  const current = ensureStore(key).snapshot;
  updateWorkspaceAudioSync(key, {
    ...patch,
    ...(current.audioPath !== patch.audioPath
      ? {
          seekRequest: undefined,
          focusRequest: undefined,
          previewRequest: undefined,
          playRequest: undefined,
          volumeRequest: undefined,
        }
      : {}),
  });
}

export function requestWorkspaceAudioSeek(key: string | undefined, time: number): void {
  if (!key || !Number.isFinite(time)) {
    return;
  }

  const safeTime = Math.max(0, time);
  const id = Date.now() + Math.random();
  updateWorkspaceAudioSync(key, {
    currentTime: safeTime,
    seekRequest: { id, time: safeTime },
    focusRequest: { id, time: safeTime },
  });
}

export function requestWorkspaceAudioPreview(key: string | undefined, start: number, end: number): void {
  if (!key || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return;
  }

  const safeStart = Math.max(0, start);
  const safeEnd = Math.max(safeStart, end);
  const id = Date.now() + Math.random();
  updateWorkspaceAudioSync(key, {
    currentTime: safeStart,
    focusRequest: { id, time: safeStart },
    previewRequest: { id, start: safeStart, end: safeEnd },
  });
}

export function requestWorkspaceAudioPlay(key: string | undefined, play: boolean): void {
  if (!key) {
    return;
  }

  const id = Date.now() + Math.random();
  updateWorkspaceAudioSync(key, {
    playRequest: { id, play },
  });
}

export function requestWorkspaceAudioVolume(key: string | undefined, volume: number): void {
  if (!key || !Number.isFinite(volume)) {
    return;
  }

  const id = Date.now() + Math.random();
  updateWorkspaceAudioSync(key, {
    volume,
    volumeRequest: { id, volume },
  });
}

export function publishWorkspaceActiveTab(key: string | undefined, tabId: string): void {
  if (!key) {
    return;
  }

  updateWorkspaceAudioSync(key, {
    activeTabId: tabId,
  });
}

function subscribeWorkspaceAudioSync(key: string, listener: () => void): () => void {
  if (!key) {
    return () => undefined;
  }

  const store = ensureStore(key);
  store.listeners.add(listener);
  return () => store.listeners.delete(listener);
}

function getWorkspaceAudioSnapshot(key: string): WorkspaceAudioSyncSnapshot {
  if (!key) {
    return emptySnapshot;
  }

  return ensureStore(key).snapshot;
}

function updateWorkspaceAudioSync(key: string, patch: Partial<WorkspaceAudioSyncSnapshot>): void {
  const store = ensureStore(key);
  const nextSnapshot = { ...store.snapshot, ...patch };
  if (sameSnapshot(store.snapshot, nextSnapshot)) {
    return;
  }

  store.snapshot = nextSnapshot;
  store.listeners.forEach((listener) => listener());
}

function ensureStore(key: string): WorkspaceAudioSyncStore {
  const existing = stores.get(key);
  if (existing) {
    return existing;
  }

  const store: WorkspaceAudioSyncStore = {
    snapshot: emptySnapshot,
    listeners: new Set(),
  };
  stores.set(key, store);
  return store;
}

function sameSnapshot(left: WorkspaceAudioSyncSnapshot, right: WorkspaceAudioSyncSnapshot): boolean {
  return (
    left.audioPath === right.audioPath &&
    left.currentTime === right.currentTime &&
    left.duration === right.duration &&
    left.isPlaying === right.isPlaying &&
    left.volume === right.volume &&
    left.seekRequest?.id === right.seekRequest?.id &&
    left.focusRequest?.id === right.focusRequest?.id &&
    left.previewRequest?.id === right.previewRequest?.id &&
    left.activeTabId === right.activeTabId &&
    left.playRequest?.id === right.playRequest?.id &&
    left.volumeRequest?.id === right.volumeRequest?.id
  );
}
