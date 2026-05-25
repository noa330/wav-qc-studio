import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { DataTableRow, JsonValue, WorkspaceId, WorkspaceSettings } from "@shared/ipc";
import {
  createStartupSplashSteps,
  progressForStartupStep,
  type StartupSplashStepId,
} from "@shared/startup-splash";
import { studioBackend } from "@/services/studio-backend";
import { defaultWorkspaceId } from "@/features/workspaces/model/workspace-config";
import { defaultWorkspaceSettings } from "@/features/workspaces/model/default-settings";
import {
  createDefaultOverviewFilterState,
  type OverviewFilterState,
} from "@/features/workspaces/model/overview-filter";
import {
  createDefaultTagScoreRules,
  hydrateTagScoreRule,
  type TagScoreRule,
} from "@/features/workspaces/model/pretrained-sed-tagging";
import {
  createInitialRuntimeStore,
  createEmptyTerminalState,
  stateWithActiveSheet,
  workspaceIds,
  type WorkspaceRuntimeStore,
} from "@/features/workspaces/state/workspace-runtime-store";
import { findFirstAudioPath, findRowForPath, resolveAudioSelection, resolveInputAudioPath } from "@/features/workspaces/model/workspace-runtime-selection";
import {
  getAudioEditSessionSnapshot,
  normalizeAudioEditSessionSnapshot,
  restoreAudioEditSessionSnapshot,
  subscribeAudioEditSession,
} from "@/features/workspaces/state/audio-edit-session";
import {
  createDefaultPersistedAppState,
  createDefaultRuntimeSnapshot,
  createDefaultShellState,
  createDefaultWorkspaceUiState,
  createDefaultWorkspaceUiStore,
  type PersistedAppState,
  type PersistedBatchReplaceState,
  type PersistedDataGridState,
  type PersistedProjectMeta,
  type PersistedRowsClipboard,
  type PersistedRuntimeSnapshot,
  type PersistedShellState,
  type PersistedSliceEditorState,
  type PersistedWorkspaceUiState,
} from "./app-persistence-model";

export type {
  PersistedAppState,
  PersistedBatchReplaceState,
  PersistedDataGridState,
  PersistedProjectMeta,
  PersistedRowsClipboard,
  PersistedRuntimeSnapshot,
  PersistedShellState,
  PersistedSliceEditorState,
  PersistedWorkspaceUiState,
} from "./app-persistence-model";

const appStateSchemaVersion = 1;
const saveDebounceMs = 650;
const defaultProjectId = "default-project";

type PersistedProjectRecord = PersistedProjectMeta & {
  state: PersistedAppState | unknown;
};

type PersistedProjectStore = {
  activeProjectId: string;
  projects: PersistedProjectRecord[];
  activeState: PersistedAppState;
};

type ProjectStorePayload = {
  activeProjectId?: unknown;
  projects: unknown[];
};

type AppPersistenceContextValue = {
  initialState: PersistedAppState;
  activeProject: PersistedProjectMeta;
  activeProjectId: string;
  projects: PersistedProjectMeta[];
  projectSwitching: boolean;
  switchProject: (projectId: string) => Promise<void>;
  createProject: (name: string) => Promise<ProjectCreateActionResult>;
  getWorkspaceUiSnapshot: (workspaceId: WorkspaceId) => PersistedWorkspaceUiState;
  recordRuntimeSnapshot: (snapshot: PersistedRuntimeSnapshot) => void;
  recordShellSnapshot: (snapshot: PersistedShellState) => void;
  recordWorkspaceUiSnapshot: (workspaceId: WorkspaceId, patch: Partial<PersistedWorkspaceUiState>) => void;
  flush: () => Promise<void>;
  flushSync: () => void;
};

export type ProjectCreateActionResult = {
  ok: boolean;
  error?: string;
};

const AppPersistenceContext = createContext<AppPersistenceContextValue | null>(null);

export function AppPersistenceProvider({ children }: { children: ReactNode }) {
  const [loadState, setLoadState] = useState<{ ready: false } | { ready: true; initialState: PersistedAppState }>({ ready: false });
  const [activeProjectId, setActiveProjectId] = useState(defaultProjectId);
  const [projectMetas, setProjectMetas] = useState<PersistedProjectMeta[]>(() => [createDefaultProjectMeta()]);
  const [projectSwitching, setProjectSwitching] = useState(false);
  const projectSwitchingRef = useRef(false);
  const projectRecordsRef = useRef<PersistedProjectRecord[]>([createDefaultProjectRecord()]);
  const activeProjectIdRef = useRef(defaultProjectId);
  const runtimeSnapshotRef = useRef<PersistedRuntimeSnapshot>(createDefaultRuntimeSnapshot());
  const shellSnapshotRef = useRef<PersistedShellState>(createDefaultShellState());
  const workspaceUiSnapshotRef = useRef<Record<WorkspaceId, PersistedWorkspaceUiState>>(createDefaultWorkspaceUiStore());
  const saveTimerRef = useRef<number | undefined>(undefined);
  const dirtyVersionRef = useRef(0);
  const savedVersionRef = useRef(0);
  const saveInFlightRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const applyInitialStore = async (projectStore: PersistedProjectStore, loadError?: unknown) => {
      const initialState = projectStore.activeState;
      const activeProject = projectStore.projects.find((project) => project.id === projectStore.activeProjectId) ?? projectStore.projects[0] ?? createDefaultProjectRecord();
      const projectRecords = upsertProjectRecord(projectStore.projects, {
        ...activeProject,
        state: initialState,
      });
      projectRecordsRef.current = projectRecords;
      activeProjectIdRef.current = activeProject.id;
      setProjectMetas(projectRecords.map(projectRecordToMeta));
      setActiveProjectId(activeProject.id);
      runtimeSnapshotRef.current = initialState.runtime;
      shellSnapshotRef.current = initialState.shell;
      workspaceUiSnapshotRef.current = initialState.workspaceUi;
      restoreAudioEditSessionSnapshot(initialState.audioEditSession);

      if (loadError) {
        console.warn("Failed to load persisted app state:", loadError);
      }

      await reportStartupProgress(
        progressForStartupStep("app-state", 100),
        "공통 앱 상태 복원 완료",
        "저장된 화면 상태를 현재 앱 구조에 맞췄습니다.",
        "app-state",
      );

      setLoadState({ ready: true, initialState });
      if (!cancelled) {
        void studioBackend.completeStartupSplash().catch(() => undefined);
      }
    };

    void (async () => {
      await reportStartupProgress(
        progressForStartupStep("state-file", 0),
        "저장 상태 파일 확인 중...",
        "이전 실행 상태를 저장 파일에서 찾고 있습니다.",
        "state-file",
      );

      const result = await studioBackend.loadAppState();
      if (cancelled) {
        return;
      }

      await reportStartupProgress(
        progressForStartupStep("state-file", 100),
        "저장 상태 파일 읽기 완료",
        result.snapshot ? "저장된 상태 파일을 모두 읽었습니다." : "복원할 저장 상태가 없어 기본 상태로 시작합니다.",
        "state-file",
      );

      const projectStore = await normalizePersistedProjectStoreForStartup(result.snapshot?.payload, async (completedUnits, totalUnits) => {
        if (cancelled) {
          return;
        }

        await reportStartupProgress(
          progressForStartupStep("app-state", (completedUnits / totalUnits) * 100),
          "공통 앱 상태 복원 중...",
          `${completedUnits} / ${totalUnits} 복원 단위 처리`,
          "app-state",
        );
        await waitForStartupFrame();
      });

      if (cancelled) {
        return;
      }

      await applyInitialStore(projectStore, !result.ok && result.error ? result.error : undefined);
    })().catch((error: unknown) => {
      if (cancelled) {
        return;
      }

      void applyInitialStore(createDefaultPersistedProjectStore(), error);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const buildSnapshot = useCallback(() => {
    const activeState = captureActiveProjectState(runtimeSnapshotRef.current, shellSnapshotRef.current, workspaceUiSnapshotRef.current);
    projectRecordsRef.current = updateProjectRecordState(projectRecordsRef.current, activeProjectIdRef.current, activeState);

    return {
      schemaVersion: appStateSchemaVersion,
      savedAt: new Date().toISOString(),
      payload: toJsonValue(buildPersistedProjectPayload(projectRecordsRef.current, activeProjectIdRef.current)),
    };
  }, []);

  const flush = useCallback(async () => {
    if (saveTimerRef.current !== undefined) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = undefined;
    }

    const versionToSave = dirtyVersionRef.current;
    if (versionToSave === savedVersionRef.current || saveInFlightRef.current) {
      return;
    }

    saveInFlightRef.current = true;
    const snapshot = buildSnapshot();
    const result = await studioBackend.saveAppState({ snapshot });
    saveInFlightRef.current = false;

    if (result.ok) {
      savedVersionRef.current = Math.max(savedVersionRef.current, versionToSave);
    } else if (result.error) {
      console.warn("Failed to persist app state:", result.error);
    }

    if (dirtyVersionRef.current !== savedVersionRef.current) {
      await flush();
    }
  }, [buildSnapshot]);

  const flushSync = useCallback(() => {
    if (saveTimerRef.current !== undefined) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = undefined;
    }

    const versionToSave = dirtyVersionRef.current;
    if (versionToSave === savedVersionRef.current) {
      return;
    }

    const result = studioBackend.saveAppStateSync({ snapshot: buildSnapshot() });
    if (result.ok) {
      savedVersionRef.current = Math.max(savedVersionRef.current, versionToSave);
    } else if (result.error) {
      console.warn("Failed to synchronously persist app state:", result.error);
    }
  }, [buildSnapshot]);

  const scheduleSave = useCallback(() => {
    dirtyVersionRef.current += 1;
    if (saveTimerRef.current !== undefined) {
      window.clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = window.setTimeout(() => {
      void flush();
    }, saveDebounceMs);
  }, [flush]);

  const recordRuntimeSnapshot = useCallback((snapshot: PersistedRuntimeSnapshot) => {
    runtimeSnapshotRef.current = snapshot;
    scheduleSave();
  }, [scheduleSave]);

  const recordShellSnapshot = useCallback((snapshot: PersistedShellState) => {
    shellSnapshotRef.current = snapshot;
    scheduleSave();
  }, [scheduleSave]);

  const recordWorkspaceUiSnapshot = useCallback((workspaceId: WorkspaceId, patch: Partial<PersistedWorkspaceUiState>) => {
    workspaceUiSnapshotRef.current = {
      ...workspaceUiSnapshotRef.current,
      [workspaceId]: mergeRecords(workspaceUiSnapshotRef.current[workspaceId] ?? createDefaultWorkspaceUiState(), patch),
    };
    scheduleSave();
  }, [scheduleSave]);

  const getWorkspaceUiSnapshot = useCallback((workspaceId: WorkspaceId) => {
    return workspaceUiSnapshotRef.current[workspaceId] ?? createDefaultWorkspaceUiState();
  }, []);

  const applyProjectState = useCallback((projectId: string, state: PersistedAppState) => {
    activeProjectIdRef.current = projectId;
    runtimeSnapshotRef.current = state.runtime;
    shellSnapshotRef.current = state.shell;
    workspaceUiSnapshotRef.current = state.workspaceUi;
    restoreAudioEditSessionSnapshot(state.audioEditSession);
    setActiveProjectId(projectId);
    setLoadState({ ready: true, initialState: state });
  }, []);

  const switchProject = useCallback(async (projectId: string) => {
    if (projectSwitchingRef.current || projectId === activeProjectIdRef.current) {
      return;
    }

    const target = projectRecordsRef.current.find((project) => project.id === projectId);
    if (!target) {
      return;
    }

    projectSwitchingRef.current = true;
    setProjectSwitching(true);
    try {
      const activeState = captureActiveProjectState(runtimeSnapshotRef.current, shellSnapshotRef.current, workspaceUiSnapshotRef.current);
      projectRecordsRef.current = updateProjectRecordState(projectRecordsRef.current, activeProjectIdRef.current, activeState);
      scheduleSave();
      await flush();

      const loaded = target.rootPath
        ? await studioBackend.loadProjectState({ projectId: target.id, rootPath: target.rootPath })
        : { ok: true as const, state: undefined };
      if (!loaded.ok && loaded.error) {
        console.warn("Failed to load project state:", loaded.error);
      }

      const targetState = normalizePersistedAppState(loaded.state ?? target.state, createDefaultPersistedAppState());
      projectRecordsRef.current = updateProjectRecordState(projectRecordsRef.current, projectId, targetState);
      setProjectMetas(projectRecordsRef.current.map(projectRecordToMeta));
      applyProjectState(projectId, targetState);
      scheduleSave();
    } finally {
      projectSwitchingRef.current = false;
      setProjectSwitching(false);
    }
  }, [applyProjectState, flush, scheduleSave]);

  const createProject = useCallback(async (name: string): Promise<ProjectCreateActionResult> => {
    if (projectSwitchingRef.current) {
      return { ok: false, error: "프로젝트 전환이 끝난 뒤 다시 시도하세요." };
    }

    const requestedName = normalizeProjectName(name);
    if (!requestedName) {
      return { ok: false, error: "프로젝트 이름을 입력하세요." };
    }

    if (projectRecordsRef.current.some((project) => sameProjectName(project.name, requestedName))) {
      return { ok: false, error: "같은 이름의 프로젝트가 이미 있습니다." };
    }

    projectSwitchingRef.current = true;
    setProjectSwitching(true);
    try {
      const activeState = captureActiveProjectState(runtimeSnapshotRef.current, shellSnapshotRef.current, workspaceUiSnapshotRef.current);
      projectRecordsRef.current = updateProjectRecordState(projectRecordsRef.current, activeProjectIdRef.current, activeState);
      scheduleSave();
      await flush();

      const created = await studioBackend.createProject({ name: requestedName });
      if (!created.ok || !created.rootPath || !created.name) {
        return { ok: false, error: created.error ?? "프로젝트 폴더를 만들 수 없습니다." };
      }

      const existingProject = projectRecordsRef.current.find((project) => sameProjectRoot(project.rootPath, created.rootPath));
      if (existingProject) {
        applyProjectState(existingProject.id, normalizePersistedAppState(existingProject.state, createDefaultPersistedAppState()));
        return { ok: true };
      }

      const now = new Date().toISOString();
      const state = createDefaultPersistedAppState();
      const project: PersistedProjectRecord = {
        id: createProjectId(created.rootPath),
        name: created.name,
        rootPath: created.rootPath,
        createdAt: now,
        updatedAt: now,
        state,
      };
      projectRecordsRef.current = [...projectRecordsRef.current, project];
      setProjectMetas(projectRecordsRef.current.map(projectRecordToMeta));
      applyProjectState(project.id, state);
      scheduleSave();
      await flush();
      return { ok: true };
    } finally {
      projectSwitchingRef.current = false;
      setProjectSwitching(false);
    }
  }, [applyProjectState, flush, scheduleSave]);

  useEffect(() => {
    if (!loadState.ready) {
      return undefined;
    }

    return subscribeAudioEditSession(scheduleSave);
  }, [loadState.ready, scheduleSave]);

  useEffect(() => {
    const flushOnVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        void flush();
      }
    };
    const flushBeforeUnload = () => flushSync();

    document.addEventListener("visibilitychange", flushOnVisibilityChange);
    window.addEventListener("pagehide", flushBeforeUnload);
    window.addEventListener("beforeunload", flushBeforeUnload);

    return () => {
      document.removeEventListener("visibilitychange", flushOnVisibilityChange);
      window.removeEventListener("pagehide", flushBeforeUnload);
      window.removeEventListener("beforeunload", flushBeforeUnload);
      if (saveTimerRef.current !== undefined) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, [flush, flushSync]);

  const contextValue = useMemo<AppPersistenceContextValue | null>(() => {
    if (!loadState.ready) {
      return null;
    }

    return {
      initialState: loadState.initialState,
      activeProject: projectMetas.find((project) => project.id === activeProjectId) ?? projectMetas[0] ?? createDefaultProjectMeta(),
      activeProjectId,
      projects: projectMetas,
      projectSwitching,
      switchProject,
      createProject,
      getWorkspaceUiSnapshot,
      recordRuntimeSnapshot,
      recordShellSnapshot,
      recordWorkspaceUiSnapshot,
      flush,
      flushSync,
    };
  }, [
    flush,
    flushSync,
    activeProjectId,
    createProject,
    getWorkspaceUiSnapshot,
    loadState,
    projectMetas,
    projectSwitching,
    recordRuntimeSnapshot,
    recordShellSnapshot,
    recordWorkspaceUiSnapshot,
    switchProject,
  ]);

  if (!loadState.ready || !contextValue) {
    return null;
  }

  return createElement(AppPersistenceContext.Provider, { value: contextValue }, children);
}

export function useAppPersistence(): AppPersistenceContextValue {
  const context = useContext(AppPersistenceContext);
  if (!context) {
    throw new Error("useAppPersistence must be used inside AppPersistenceProvider.");
  }

  return context;
}

async function normalizePersistedProjectStoreForStartup(
  payload: unknown,
  onProgress: (completedUnits: number, totalUnits: number) => Promise<void>,
): Promise<PersistedProjectStore> {
  if (!isProjectStorePayload(payload)) {
    const activeState = await normalizePersistedAppStateForStartup(payload, onProgress);
    const project = createDefaultProjectRecord(activeState);
    return {
      activeProjectId: project.id,
      projects: [project],
      activeState,
    };
  }

  const rawProjects = payload.projects.filter(isRecord);
  if (rawProjects.length === 0) {
    return createDefaultPersistedProjectStore();
  }

  const projects = rawProjects.map((project, index) => normalizeProjectRecord(project, index));
  const fallbackProject = projects[0];
  const activeProject = projects.find((project) => project.id === payload.activeProjectId) ?? fallbackProject;
  const activeState = await normalizePersistedAppStateForStartup(activeProject.state, onProgress);
  const normalizedProjects = projects.map((project) => (project.id === activeProject.id ? { ...project, state: activeState } : project));

  return {
    activeProjectId: activeProject.id,
    projects: normalizedProjects,
    activeState,
  };
}

async function normalizePersistedAppStateForStartup(
  payload: unknown,
  onProgress: (completedUnits: number, totalUnits: number) => Promise<void>,
): Promise<PersistedAppState> {
  const defaults = createDefaultPersistedAppState();
  if (!isRecord(payload)) {
    return defaults;
  }

  const totalUnits = 4 + workspaceIds.length + 1 + workspaceIds.length + 1;
  let completedUnits = 0;
  const recordUnit = async () => {
    completedUnits += 1;
    await onProgress(completedUnits, totalUnits);
  };

  const runtime = await normalizeRuntimeSnapshotForStartup(payload.runtime, defaults.runtime, recordUnit);
  const shell = normalizeShellState(payload.shell, defaults.shell);
  await recordUnit();
  const workspaceUi = await normalizeWorkspaceUiStoreForStartup(payload.workspaceUi, defaults.workspaceUi, recordUnit);
  const audioEditSession = normalizeAudioEditSessionSnapshot(payload.audioEditSession);
  await recordUnit();

  return {
    runtime,
    shell,
    workspaceUi,
    audioEditSession,
  };
}

function createDefaultProjectMeta(): PersistedProjectMeta {
  const now = new Date().toISOString();
  return {
    id: defaultProjectId,
    name: "기본 프로젝트",
    createdAt: now,
    updatedAt: now,
  };
}

function createDefaultProjectRecord(state: PersistedAppState = createDefaultPersistedAppState()): PersistedProjectRecord {
  return {
    ...createDefaultProjectMeta(),
    state,
  };
}

function createDefaultPersistedProjectStore(): PersistedProjectStore {
  const activeState = createDefaultPersistedAppState();
  const project = createDefaultProjectRecord(activeState);
  return {
    activeProjectId: project.id,
    projects: [project],
    activeState,
  };
}

function captureActiveProjectState(
  runtime: PersistedRuntimeSnapshot,
  shell: PersistedShellState,
  workspaceUi: Record<WorkspaceId, PersistedWorkspaceUiState>,
): PersistedAppState {
  return {
    runtime: sanitizeRuntimeSnapshotForPersistence(runtime),
    shell,
    workspaceUi,
    audioEditSession: getAudioEditSessionSnapshot(),
  };
}

function buildPersistedProjectPayload(projects: PersistedProjectRecord[], activeProjectId: string): ProjectStorePayload {
  return {
    activeProjectId,
    projects: projects.map((project) => {
      const meta = {
        id: project.id,
        name: project.name,
        rootPath: project.rootPath,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      };

      return project.id === activeProjectId
        ? { ...meta, state: project.state }
        : meta;
    }),
  };
}

function updateProjectRecordState(
  projects: PersistedProjectRecord[],
  projectId: string,
  state: PersistedAppState,
): PersistedProjectRecord[] {
  const updatedAt = new Date().toISOString();
  let matched = false;
  const nextProjects = projects.map((project) => {
    if (project.id !== projectId) {
      return project;
    }

    matched = true;
    return {
      ...project,
      state,
      updatedAt,
    };
  });

  if (matched) {
    return nextProjects;
  }

  return [
    ...nextProjects,
    {
      ...createDefaultProjectMeta(),
      id: projectId,
      state,
      updatedAt,
    },
  ];
}

function upsertProjectRecord(projects: PersistedProjectRecord[], nextProject: PersistedProjectRecord): PersistedProjectRecord[] {
  let matched = false;
  const nextProjects = projects.map((project) => {
    if (project.id !== nextProject.id) {
      return project;
    }

    matched = true;
    return nextProject;
  });

  return matched ? nextProjects : [...nextProjects, nextProject];
}

function projectRecordToMeta(project: PersistedProjectRecord): PersistedProjectMeta {
  return {
    id: project.id,
    name: project.name,
    rootPath: project.rootPath,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

function normalizePersistedAppState(raw: unknown, defaults: PersistedAppState): PersistedAppState {
  if (!isRecord(raw)) {
    return defaults;
  }

  return {
    runtime: normalizeRuntimeSnapshot(raw.runtime, defaults.runtime),
    shell: normalizeShellState(raw.shell, defaults.shell),
    workspaceUi: normalizeWorkspaceUiStore(raw.workspaceUi, defaults.workspaceUi),
    audioEditSession: normalizeAudioEditSessionSnapshot(raw.audioEditSession),
  };
}

function isProjectStorePayload(value: unknown): value is ProjectStorePayload {
  return isRecord(value) && Array.isArray(value.projects);
}

function normalizeProjectRecord(raw: Record<string, unknown>, index: number): PersistedProjectRecord {
  const now = new Date().toISOString();
  const rootPath = typeof raw.rootPath === "string" && raw.rootPath.trim() ? raw.rootPath.trim() : undefined;
  const fallbackId = rootPath ? createProjectId(rootPath) : index === 0 ? defaultProjectId : `project-${index + 1}`;
  return {
    id: typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : fallbackId,
    name: typeof raw.name === "string" && raw.name.trim()
      ? raw.name.trim()
      : rootPath
        ? projectNameFromPath(rootPath)
        : `프로젝트 ${index + 1}`,
    rootPath,
    createdAt: typeof raw.createdAt === "string" && raw.createdAt.trim() ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === "string" && raw.updatedAt.trim() ? raw.updatedAt : now,
    state: raw.state,
  };
}

function createProjectId(rootPath?: string): string {
  if (rootPath) {
    return `project:${encodeURIComponent(normalizeProjectRoot(rootPath))}`;
  }

  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `project-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function sameProjectRoot(left?: string, right?: string): boolean {
  return normalizeProjectRoot(left) === normalizeProjectRoot(right);
}

function sameProjectName(left: string, right: string): boolean {
  return normalizeProjectName(left).toLocaleLowerCase() === normalizeProjectName(right).toLocaleLowerCase();
}

function normalizeProjectName(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function normalizeProjectRoot(path?: string): string {
  return path?.trim().replace(/\\/gu, "/").replace(/\/+$/u, "").toLocaleLowerCase() ?? "";
}

function projectNameFromPath(path: string): string {
  const normalized = path.trim().replace(/\\/gu, "/").replace(/\/+$/u, "");
  return normalized.split("/").filter(Boolean).pop() || "새 프로젝트";
}

async function reportStartupProgress(
  progressPercent: number,
  statusText: string,
  detailText: string,
  activeStepId?: StartupSplashStepId,
): Promise<void> {
  await studioBackend.updateStartupSplash({
    progressPercent,
    statusText,
    detailText,
    steps: createStartupSplashSteps(activeStepId),
  }).catch(() => undefined);
}

function waitForStartupFrame(): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, 16);
  });
}

function normalizeRuntimeSnapshot(raw: unknown, defaults: PersistedRuntimeSnapshot): PersistedRuntimeSnapshot {
  if (!isRecord(raw)) {
    return defaults;
  }

  return {
    settings: mergeRecords(defaultWorkspaceSettings, raw.settings) as WorkspaceSettings,
    tagScoreRules: normalizeTagScoreRules(raw.tagScoreRules),
    overviewFilter: mergeRecords(createDefaultOverviewFilterState(), raw.overviewFilter) as OverviewFilterState,
    rowsClipboard: normalizeRowsClipboard(raw.rowsClipboard),
    states: normalizeWorkspaceRuntimeStore(raw.states),
  };
}

async function normalizeRuntimeSnapshotForStartup(
  raw: unknown,
  defaults: PersistedRuntimeSnapshot,
  recordUnit: () => Promise<void>,
): Promise<PersistedRuntimeSnapshot> {
  if (!isRecord(raw)) {
    return defaults;
  }

  const settings = mergeRecords(defaultWorkspaceSettings, raw.settings) as WorkspaceSettings;
  await recordUnit();
  const tagScoreRules = normalizeTagScoreRules(raw.tagScoreRules);
  await recordUnit();
  const overviewFilter = mergeRecords(createDefaultOverviewFilterState(), raw.overviewFilter) as OverviewFilterState;
  await recordUnit();
  const rowsClipboard = normalizeRowsClipboard(raw.rowsClipboard);
  await recordUnit();
  const states = await normalizeWorkspaceRuntimeStoreForStartup(raw.states, recordUnit);

  return {
    settings,
    tagScoreRules,
    overviewFilter,
    rowsClipboard,
    states,
  };
}

function normalizeShellState(raw: unknown, defaults: PersistedShellState): PersistedShellState {
  if (!isRecord(raw)) {
    return defaults;
  }

  return {
    selectedWorkspaceId: isWorkspaceId(raw.selectedWorkspaceId) ? raw.selectedWorkspaceId : defaults.selectedWorkspaceId,
    sidebarCollapsedByUser: typeof raw.sidebarCollapsedByUser === "boolean" ? raw.sidebarCollapsedByUser : defaults.sidebarCollapsedByUser,
    guideAutoShown: typeof raw.guideAutoShown === "boolean" ? raw.guideAutoShown : defaults.guideAutoShown,
  };
}

function normalizeWorkspaceUiStore(raw: unknown, defaults: Record<WorkspaceId, PersistedWorkspaceUiState>): Record<WorkspaceId, PersistedWorkspaceUiState> {
  const source = isRecord(raw) ? raw : {};
  return Object.fromEntries(
    workspaceIds.map((workspaceId) => [
      workspaceId,
      mergeRecords(defaults[workspaceId], source[workspaceId]) as PersistedWorkspaceUiState,
    ]),
  ) as Record<WorkspaceId, PersistedWorkspaceUiState>;
}

async function normalizeWorkspaceUiStoreForStartup(
  raw: unknown,
  defaults: Record<WorkspaceId, PersistedWorkspaceUiState>,
  recordUnit: () => Promise<void>,
): Promise<Record<WorkspaceId, PersistedWorkspaceUiState>> {
  const source = isRecord(raw) ? raw : {};
  const entries: Array<[WorkspaceId, PersistedWorkspaceUiState]> = [];

  for (const workspaceId of workspaceIds) {
    entries.push([
      workspaceId,
      mergeRecords(defaults[workspaceId], source[workspaceId]) as PersistedWorkspaceUiState,
    ]);
    await recordUnit();
  }

  return Object.fromEntries(entries) as Record<WorkspaceId, PersistedWorkspaceUiState>;
}

function normalizeWorkspaceRuntimeStore(raw: unknown): WorkspaceRuntimeStore {
  const defaults = createInitialRuntimeStore();
  const source = isRecord(raw) ? raw : {};

  return Object.fromEntries(
    workspaceIds.map((workspaceId) => {
      const merged = mergeRecords(defaults[workspaceId], source[workspaceId]) as WorkspaceRuntimeStore[WorkspaceId];
      const sheets = Array.isArray(merged.sheets) && merged.sheets.length > 0 ? merged.sheets : defaults[workspaceId].sheets;
      const activeSheetId = sheets.some((sheet) => sheet.id === merged.activeSheetId)
        ? merged.activeSheetId
        : sheets[0]?.id;
      const wasBusy = merged.isRunning || merged.isExporting || merged.isBatchSpeakerRunning;
      const idleState = {
        ...merged,
        sheets: sheets.map((sheet) => repairWorkspaceAudioSelection(workspaceId, sheet)),
        activeSheetId,
        isRunning: false,
        isExporting: false,
        isBatchSpeakerRunning: false,
        progressPercent: 0,
        progress: wasBusy ? undefined : merged.progress,
        statusText: wasBusy ? "Stopped" : merged.statusText || defaults[workspaceId].statusText,
        error: undefined,
        terminal: createEmptyTerminalState(),
        terminalOpenRequestId: 0,
      };
      const activeRepairedSheet = idleState.sheets.find((sheet) => sheet.id === activeSheetId) ?? idleState.sheets[0];
      return [workspaceId, stateWithActiveSheet(idleState, activeRepairedSheet)];
    }),
  ) as WorkspaceRuntimeStore;
}

async function normalizeWorkspaceRuntimeStoreForStartup(raw: unknown, recordUnit: () => Promise<void>): Promise<WorkspaceRuntimeStore> {
  const defaults = createInitialRuntimeStore();
  const source = isRecord(raw) ? raw : {};
  const entries: Array<[WorkspaceId, WorkspaceRuntimeStore[WorkspaceId]]> = [];

  for (const workspaceId of workspaceIds) {
    const merged = mergeRecords(defaults[workspaceId], source[workspaceId]) as WorkspaceRuntimeStore[WorkspaceId];
    const sheets = Array.isArray(merged.sheets) && merged.sheets.length > 0 ? merged.sheets : defaults[workspaceId].sheets;
    const activeSheetId = sheets.some((sheet) => sheet.id === merged.activeSheetId)
      ? merged.activeSheetId
      : sheets[0]?.id;
    const wasBusy = merged.isRunning || merged.isExporting || merged.isBatchSpeakerRunning;
    const idleState = {
      ...merged,
      sheets: sheets.map((sheet) => repairWorkspaceAudioSelection(workspaceId, sheet)),
      activeSheetId,
      isRunning: false,
      isExporting: false,
      isBatchSpeakerRunning: false,
      progressPercent: 0,
      progress: wasBusy ? undefined : merged.progress,
      statusText: wasBusy ? "Stopped" : merged.statusText || defaults[workspaceId].statusText,
      error: undefined,
      terminal: createEmptyTerminalState(),
      terminalOpenRequestId: 0,
    };
    const activeRepairedSheet = idleState.sheets.find((sheet) => sheet.id === activeSheetId) ?? idleState.sheets[0];
    entries.push([workspaceId, stateWithActiveSheet(idleState, activeRepairedSheet)]);
    await recordUnit();
  }

  return Object.fromEntries(entries) as WorkspaceRuntimeStore;
}

type RepairableAudioSelectionState = {
  inputTree?: WorkspaceRuntimeStore[WorkspaceId]["inputTree"];
  table: WorkspaceRuntimeStore[WorkspaceId]["table"];
  selectedRowId?: string;
  selectedRowIds: string[];
  selectedFilePath?: string;
  selectedAudioPath?: string;
  selectedResultAudioPath?: string;
  inferenceMultiReferenceOpen?: boolean;
  inferenceAuxReferenceAudioPaths?: string[];
};

function repairWorkspaceAudioSelection<T extends RepairableAudioSelectionState>(workspaceId: WorkspaceId, state: T): T {
  const inputTree = repairWorkspaceInputTree(state);
  const rowById = new Map(state.table.rows.map((row) => [row.id, row]));
  const selectedRow = (state.selectedRowId ? rowById.get(state.selectedRowId) : undefined)
    ?? (state.selectedRowIds[0] ? rowById.get(state.selectedRowIds[0]) : undefined)
    ?? state.table.rows[0];
  const fallbackAudioPath = findFirstAudioPath(inputTree) || state.selectedAudioPath || state.selectedFilePath || "";
  const audioSelection = resolveAudioSelection(workspaceId, selectedRow, fallbackAudioPath);

  return {
    ...state,
    inputTree,
    selectedFilePath: audioSelection.selectedFilePath ?? state.selectedFilePath,
    selectedAudioPath: audioSelection.selectedAudioPath ?? state.selectedAudioPath,
    selectedResultAudioPath: audioSelection.selectedResultAudioPath ?? state.selectedResultAudioPath,
    inferenceMultiReferenceOpen: Boolean(state.inferenceMultiReferenceOpen),
    inferenceAuxReferenceAudioPaths: normalizePathList(state.inferenceAuxReferenceAudioPaths),
  };
}

function normalizePathList(value: unknown): string[] {
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const item of Array.isArray(value) ? value : []) {
    const path = String(item ?? "").trim();
    const key = path.replace(/\\/gu, "/").toLowerCase();
    if (!path || seen.has(key)) {
      continue;
    }
    seen.add(key);
    paths.push(path);
  }
  return paths;
}

function repairWorkspaceInputTree<T extends RepairableAudioSelectionState>(state: T): T["inputTree"] {
  const tree = state.inputTree;
  if (!tree || state.table.rows.length === 0) {
    return tree;
  }

  return {
    ...tree,
    nodes: tree.nodes.map((node) => repairWorkspaceInputTreeNode(node, state.table.rows)),
  };
}

function repairWorkspaceInputTreeNode(node: NonNullable<RepairableAudioSelectionState["inputTree"]>["nodes"][number], rows: RepairableAudioSelectionState["table"]["rows"]): typeof node {
  if (node.kind === "directory") {
    return {
      ...node,
      children: node.children?.map((child) => repairWorkspaceInputTreeNode(child, rows)),
    };
  }

  const row = findRowForPath(rows, node.path);
  const inputAudioPath = resolveInputAudioPath(row, node.path);
  if (!inputAudioPath || inputAudioPath === node.path) {
    return node;
  }

  return {
    ...node,
    id: inputAudioPath,
    name: fileName(inputAudioPath),
    path: inputAudioPath,
  };
}

function fileName(path: string): string {
  return path.split(/[\\/]/u).filter(Boolean).pop() || path;
}

function sanitizeRuntimeSnapshotForPersistence(snapshot: PersistedRuntimeSnapshot): PersistedRuntimeSnapshot {
  return {
    ...snapshot,
    states: normalizeWorkspaceRuntimeStore(snapshot.states),
  };
}

function normalizeTagScoreRules(raw: unknown): TagScoreRule[] {
  if (!Array.isArray(raw)) {
    return createDefaultTagScoreRules();
  }

  const rules = raw
    .filter(isRecord)
    .flatMap((rule) => {
      if (typeof rule.id !== "number" || typeof rule.label !== "string") {
        return [];
      }

      return [hydrateTagScoreRule(rule as Partial<TagScoreRule> & Pick<TagScoreRule, "id" | "label">)];
    });

  return rules.length > 0 ? rules : createDefaultTagScoreRules();
}

function normalizeRowsClipboard(raw: unknown): PersistedRowsClipboard | undefined {
  if (!isRecord(raw) || !isWorkspaceId(raw.workspaceId) || !Array.isArray(raw.rows)) {
    return undefined;
  }

  return {
    workspaceId: raw.workspaceId,
    rows: raw.rows.filter(isRecord) as DataTableRow[],
  };
}

function mergeRecords<T>(base: T, patch: unknown): T {
  if (Array.isArray(base)) {
    return Array.isArray(patch) ? patch as T : base;
  }

  if (!isRecord(base) || !isRecord(patch)) {
    return patch === undefined || patch === null ? base : patch as T;
  }

  const next: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const current = next[key];
    if (value === undefined) {
      continue;
    }

    next[key] = isRecord(current) && isRecord(value) && !Array.isArray(current)
      ? mergeRecords(current, value)
      : value;
  }

  return next as T;
}

function isWorkspaceId(value: unknown): value is WorkspaceId {
  return typeof value === "string" && workspaceIds.includes(value as WorkspaceId);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toJsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}
