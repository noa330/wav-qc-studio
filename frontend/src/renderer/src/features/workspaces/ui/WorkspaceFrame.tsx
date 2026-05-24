import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { ChartNoAxesColumnIncreasing, ChevronDown, Download, EllipsisVertical, Filter, ListChecks, Pencil, Plus, Search, Terminal, X } from "lucide-react";
import type { DataTableRow, VoiceModelRuntimeStatus, WorkspaceId, WorkspaceRuntimeEnvironmentStatus, WorkspaceSettings } from "@shared/ipc";
import { useAppPersistence, type PersistedBatchReplaceState } from "@/app/app-persistence";
import { cn } from "@/lib/utils";
import { ChevronGlyph, NumericField, ToggleSwitch } from "@/shared/components/controls";
import { ColumnSearchField } from "@/shared/components/column-search-field";
import { DataGrid, type CellRenderContext, type DataGridViewState } from "@/shared/components/data-grid";
import { AppDialog, DialogTextField } from "@/shared/components/dialog";
import { DropdownMenuHeader, DropdownMenuOption, DropdownMenuSeparator, DropdownMenuSurface } from "@/shared/components/dropdown-menu";
import { FileBrowser } from "@/shared/components/file-browser";
import { MotionUnderlineTab } from "@/shared/components/motion-tabs";
import { WpfCard } from "@/shared/components/wpf-card";
import { dialogPanelMotion, menuMotion, pressTap, progressSpring, softPressTap, subtleSpring, tightPressTap, workspaceCardSpring, workspaceContentMotion } from "@/shared/motion";
import { getPanelBodyLayoutMode, getPanelBodyMinSize, resolveMeasuredPanelCollapseMode, useElementBoxSize, useElementResizeCollapseMode } from "./layout/workspace-card-overflow";
import { WorkspaceCenterPanels, WorkspaceRightPanels } from "./layout/workspace-page-layouts";
import { PanelResizeHandle, WorkspaceLayoutResizeProvider, constrainPairPixels, useWorkspaceLayoutResizeState } from "./layout/workspace-splitters";
import { cardCollapsedSize, clampResizablePanelSize, workspaceSplitterSize } from "./layout/workspace-panel-sizing";
import { type PanelAutoCollapseSuppression, type PanelCollapseMode, type WorkspacePanelRenderer, type WorkspaceResizeAxis } from "./layout/workspace-layout-types";
import { workspaces as workspaceDefinitions, type WorkspaceDefinition, type WorkspacePanel } from "../model/workspace-config";
import type { WorkspaceRuntimeState, WorkspaceTerminalState } from "../state/workspace-runtime-store";
import type { WorkspaceRuntime } from "../state/use-workspace-runtime";
import { resolveBrowserTree } from "../model/workspace-browser-tree";
import { readBatchWords, type BatchWordAlignment } from "../model/batch-alignment";
import { collectBatchSpeakers } from "../model/batch-filter";
import { overviewMetricColumns, type OverviewMetricColumn, type OxFilterState } from "../model/overview-filter";
import { BatchAudioHeaderControls, BatchAudioPlaybackPanel, BatchAutoTranscriptCell, BatchModelSettingsBody, BatchSpeakerSelectionBody, BatchTimelineBody } from "./pages/batch/BatchPanels";
import { OverviewModelSettingsBody, OverviewModulesBody } from "./pages/overview/OverviewPanels";
import { FilterChipEditorDialog } from "./pages/overview/widgets/overview-filter/FilterChipEditorDialog";
import { SliceEditorBody, SliceEditorHeaderControls, focusSliceViewOnRow, setSliceViewRange, type SliceEditorViewActions, type SliceEditorViewContext, type SliceEditorViewState, zoomSliceView } from "./pages/slice/SliceEditorPanel";
import { SliceSettingsBody } from "./pages/slice/SliceSettingsPanel";
import { SpeakerAudioComparisonPanel } from "./pages/speaker/SpeakerAudioComparisonPanel";
import { SpeakerModelBody, SpeakerSettingsBody } from "./pages/speaker/SpeakerPanels";
import { TaggingSchemaBody, TaggingScoreCutDialog } from "./pages/tagging/TaggingPanels";
import { TaggingSettingsBody } from "./pages/tagging/TaggingSettingsPanel";
import { TrainingModelBody, TrainingPlanBody, TrainingPlanHeaderControl, TrainingSettingsBody } from "./pages/training/TrainingPanels";
import { VoiceTensorBoardDialog } from "./pages/training/VoiceTensorBoardPanel";
import { InferenceModelBody, InferenceOutputBody, InferenceReferenceBody, InferenceSettingsBody } from "./pages/inference/InferencePanels";
import { WorkspaceAudioPlaybackPanel } from "./shared/WorkspaceAudioPlaybackPanel";
import { useWorkspaceAudioSync } from "./shared/workspace-audio-sync";
import { BackendStatusBody, DetailFieldList } from "./shared/workspace-panel-primitives";
import { WorkspaceTerminalDialog } from "./shared/WorkspaceTerminalDialog";
import { WorkspaceTerminalDock } from "./shared/WorkspaceTerminalDock";
import { findSelectedRow } from "./shared/workspace-ui-utils";

const overviewDetailHelp: Record<string, string> = {
  ID: "현재 결과 테이블에 표시되는 행 번호입니다.",
  파일명: "분석 대상 오디오 파일명입니다.",
  "원본 경로": "분석 대상 원본 오디오의 전체 경로입니다.",
  "길이(초)": "오디오 전체 길이를 초 단위로 계산한 값입니다.",
  샘플레이트: "오디오 파일의 sample rate입니다.",
  채널: "오디오 채널 수입니다.",
  전사: "자동 전사 결과 텍스트입니다.",
  언어: "자동 전사 또는 발음 분석에서 감지한 언어 코드입니다.",
  "발음 점수": "발음 분석 결과를 1~5 점수로 요약한 값입니다.",
  "발음 불량": "발음 점수가 기준보다 낮아 검수가 필요한 상태입니다.",
  BAK: "DNSMOS 계열 노이즈 분석의 background 점수입니다.",
  SIG: "DNSMOS 계열 노이즈 분석의 speech signal 점수입니다.",
  OVRL: "DNSMOS 계열 노이즈 분석의 overall 점수입니다.",
  "P808 MOS": "P.808 MOS 예측 점수입니다.",
  오류: "처리 중 백엔드가 기록한 오류 메시지입니다.",
};

type WorkspaceFrameProps = {
  workspace: WorkspaceDefinition;
  runtime: WorkspaceRuntime;
};

type WorkspaceOuterLayoutSizes = {
  left: number;
  right: number;
};

const defaultOuterLayoutSizes: WorkspaceOuterLayoutSizes = {
  left: 292,
  right: 322,
};

const outerPanelMin = {
  left: cardCollapsedSize,
  right: cardCollapsedSize,
  center: cardCollapsedSize,
};

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function fitOuterLayoutSizes(sizes: WorkspaceOuterLayoutSizes, availableWidth: number, visible: { left: boolean; right: boolean }): WorkspaceOuterLayoutSizes {
  const handleWidth = (visible.left ? workspaceSplitterSize : 0) + (visible.right ? workspaceSplitterSize : 0);
  const availableForSidePanels = Math.max(0, availableWidth - handleWidth - outerPanelMin.center);
  const leftMin = visible.left ? outerPanelMin.left : 0;
  const rightMin = visible.right ? outerPanelMin.right : 0;
  const leftMax = visible.left ? Math.max(leftMin, availableForSidePanels - rightMin) : sizes.left;
  const rightMax = visible.right ? Math.max(rightMin, availableForSidePanels - leftMin) : sizes.right;
  let left = visible.left ? clampResizablePanelSize(sizes.left, leftMin, leftMax) : sizes.left;
  let right = visible.right ? clampResizablePanelSize(sizes.right, rightMin, rightMax) : sizes.right;

  const sideTotal = (visible.left ? left : 0) + (visible.right ? right : 0);
  if (sideTotal <= availableForSidePanels) {
    return left === sizes.left && right === sizes.right ? sizes : { left, right };
  }

  const overflow = sideTotal - availableForSidePanels;
  const leftFlex = visible.left ? Math.max(0, left - leftMin) : 0;
  const rightFlex = visible.right ? Math.max(0, right - rightMin) : 0;
  const flexTotal = leftFlex + rightFlex;
  if (flexTotal > 0) {
    if (visible.left) {
      left -= overflow * (leftFlex / flexTotal);
    }
    if (visible.right) {
      right -= overflow * (rightFlex / flexTotal);
    }
  }

  left = visible.left ? clampResizablePanelSize(left, leftMin, leftMax) : left;
  right = visible.right ? clampResizablePanelSize(right, rightMin, rightMax) : right;
  return left === sizes.left && right === sizes.right ? sizes : { left, right };
}

function useCompactWorkspaceHeader(): boolean {
  const [compact, setCompact] = useState(() => (typeof window === "undefined" ? false : window.innerHeight < 860));

  useEffect(() => {
    const update = () => setCompact(window.innerHeight < 860);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return compact;
}

function ProjectSelector({ disabled = false, compact = false }: { disabled?: boolean; compact?: boolean }) {
  const persistence = useAppPersistence();
  const [open, setOpen] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [menuGeometry, setMenuGeometry] = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuDisabled = disabled || persistence.projectSwitching;

  const updateMenuGeometry = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }

    const width = Math.max(230, Math.min(320, window.innerWidth - 16));
    const left = clampNumber(rect.right - width, 8, Math.max(8, window.innerWidth - width - 8));
    const estimatedHeight = Math.min(360, 58 + persistence.projects.length * 36);
    const belowTop = rect.bottom + 6;
    const belowSpace = window.innerHeight - belowTop - 8;
    const aboveSpace = rect.top - 14;
    const opensAbove = belowSpace < 150 && aboveSpace > belowSpace;
    const maxHeight = opensAbove ? Math.max(132, aboveSpace) : Math.max(132, belowSpace);
    const top = opensAbove ? Math.max(8, rect.top - Math.min(estimatedHeight, maxHeight) - 6) : belowTop;

    setMenuGeometry({ left, top, width, maxHeight });
  }, [persistence.projects.length]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    updateMenuGeometry();
    window.addEventListener("resize", updateMenuGeometry);
    window.addEventListener("scroll", updateMenuGeometry, true);
    return () => {
      window.removeEventListener("resize", updateMenuGeometry);
      window.removeEventListener("scroll", updateMenuGeometry, true);
    };
  }, [open, updateMenuGeometry]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const close = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target || triggerRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }

      setOpen(false);
    };

    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  useEffect(() => {
    if (menuDisabled) {
      setOpen(false);
    }
  }, [menuDisabled]);

  const handleCreateProject = () => {
    setOpen(false);
    setCreateDialogOpen(true);
  };

  const handleSwitchProject = (projectId: string) => {
    setOpen(false);
    void persistence.switchProject(projectId);
  };

  return (
    <>
    <div className={cn("flex min-w-0 items-center", compact && "max-w-[210px]")} data-status-widget-interactive="true" onPointerDown={(event) => event.stopPropagation()}>
      <span className="mr-2 text-sm font-normal text-[var(--secondary-text)]">프로젝트</span>
      <motion.button
        ref={triggerRef}
        type="button"
        disabled={menuDisabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="프로젝트 선택"
        title={menuDisabled ? "실행 중에는 프로젝트를 바꿀 수 없습니다." : persistence.activeProject.name}
        onClick={() => setOpen((current) => !current)}
        whileTap={menuDisabled ? undefined : softPressTap}
        className={cn("flex h-8 min-w-0 items-center gap-1.5 bg-transparent px-0 text-sm font-normal text-[var(--primary-text)] outline-none transition-colors hover:text-[var(--accent-blue)] disabled:pointer-events-none disabled:opacity-45", compact ? "max-w-36" : "max-w-48")}
      >
        <span className="min-w-0 truncate">{persistence.activeProject.name}</span>
        <ChevronDown className={cn("size-3.5 shrink-0 text-[var(--control-arrow)] transition-transform", open && "rotate-180")} strokeWidth={1.9} />
      </motion.button>
      {open && menuGeometry
        ? createPortal(
            <DropdownMenuSurface
              ref={menuRef}
              role="menu"
              className="z-[1160]"
              style={{ left: menuGeometry.left, top: menuGeometry.top, width: menuGeometry.width, maxHeight: menuGeometry.maxHeight }}
            >
              <DropdownMenuHeader>{"\ud504\ub85c\uc81d\ud2b8 \uc120\ud0dd"}</DropdownMenuHeader>
              <DropdownMenuOption
                role="menuitem"
                checkable={false}
                icon={<Plus className="size-4" strokeWidth={1.9} />}
                label={"\uc0c8 \ud504\ub85c\uc81d\ud2b8 \ucd94\uac00"}
                onClick={handleCreateProject}
              />
              <DropdownMenuSeparator className="opacity-80" />
              {persistence.projects.map((project) => {
                const selected = project.id === persistence.activeProjectId;
                return (
                  <DropdownMenuOption
                    key={project.id}
                    role="menuitemradio"
                    aria-checked={selected}
                    disabled={selected}
                    checked={selected}
                    label={project.name}
                    onClick={() => handleSwitchProject(project.id)}
                  />
                );
              })}
            </DropdownMenuSurface>,
            document.body,
          )
        : null}
    </div>
    {createDialogOpen ? <ProjectCreateDialog onClose={() => setCreateDialogOpen(false)} /> : null}
    </>
  );
}

function ProjectCreateDialog({ onClose }: { onClose: () => void }) {
  const persistence = useAppPersistence();
  const [name, setName] = useState(() => nextProjectName(persistence.projects.map((project) => project.name)));
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (creating) {
      return;
    }

    const projectName = normalizeProjectDraftName(name);
    if (!projectName) {
      setError("프로젝트 이름을 입력하세요.");
      return;
    }
    if (persistence.projects.some((project) => normalizeProjectDraftName(project.name).toLocaleLowerCase() === projectName.toLocaleLowerCase())) {
      setError("같은 이름의 프로젝트가 이미 있습니다.");
      return;
    }

    setCreating(true);
    setError("");
    void persistence.createProject(projectName)
      .then((result) => {
        if (result.ok) {
          onClose();
          return;
        }

        setError(result.error ?? "프로젝트를 만들 수 없습니다.");
        setCreating(false);
      })
      .catch((createError: unknown) => {
        setError(createError instanceof Error ? createError.message : String(createError));
        setCreating(false);
      });
  };

  return (
    <AppDialog
      title="새 프로젝트"
      onClose={creating ? () => undefined : onClose}
      footer={
        <>
          <button type="button" className="wpf-button px-4 text-sm" onClick={onClose} disabled={creating}>취소</button>
          <button type="submit" form="project-create-form" className="wpf-primary-button px-4 text-sm disabled:opacity-60" disabled={creating}>
            {creating ? "생성 중..." : "생성"}
          </button>
        </>
      }
    >
      <form id="project-create-form" onSubmit={submit}>
        <DialogTextField
          id="project-name"
          label="프로젝트 이름"
          value={name}
          placeholder="프로젝트 이름"
          autoFocus
          disabled={creating}
          error={error}
          onChange={(value) => {
            setName(value);
            if (error) {
              setError("");
            }
          }}
        />
      </form>
    </AppDialog>
  );
}

function nextProjectName(names: string[]): string {
  const normalizedNames = new Set(names.map((name) => normalizeProjectDraftName(name).toLocaleLowerCase()).filter(Boolean));
  for (let index = 1; index < 1000; index += 1) {
    const candidate = `프로젝트${index}`;
    if (!normalizedNames.has(candidate.toLocaleLowerCase())) {
      return candidate;
    }
  }

  return `프로젝트${Date.now().toString(36)}`;
}

function normalizeProjectDraftName(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

type WorkspaceHeaderStatusItem = {
  label: string;
  value: string;
};

function createWorkspaceHeaderStatusItems(state: WorkspaceRuntimeState): WorkspaceHeaderStatusItem[] {
  const completedRows = state.table.rows.length;
  const progress = state.progress ?? state.lastRun?.progress;
  const finishedByProgress = (progress?.completed ?? completedRows) + (progress?.failed ?? 0);
  const hasPendingWork = progress && progress.total > 0 ? finishedByProgress < progress.total : true;
  const processing = state.isRunning || state.isBatchSpeakerRunning
    ? hasPendingWork ? 1 : 0
    : 0;

  return [
    { label: "처리중", value: `${processing}` },
    { label: "완료", value: `${completedRows}` },
  ];
}

function WorkspaceStatusWidget({
  statusItems,
  progressPercent,
  projectSelectorDisabled,
  terminal,
  terminalTitle,
  terminalBubblePinned,
  runtimeEnvironmentStatus,
  runtimeEnvironmentInstalling,
  voiceModelRuntimeStatus,
  voiceModelRuntimeInstalling,
  onTerminalBubblePinnedChange,
  onInstallRuntime,
  onInstallVoiceModelRuntime,
  onOpenFullTerminal,
}: {
  statusItems: WorkspaceHeaderStatusItem[];
  progressPercent: number;
  projectSelectorDisabled: boolean;
  terminal: WorkspaceTerminalState;
  terminalTitle: string;
  terminalBubblePinned: boolean;
  runtimeEnvironmentStatus?: WorkspaceRuntimeEnvironmentStatus;
  runtimeEnvironmentInstalling: boolean;
  voiceModelRuntimeStatus?: VoiceModelRuntimeStatus;
  voiceModelRuntimeInstalling: boolean;
  onTerminalBubblePinnedChange: (pinned: boolean) => void;
  onInstallRuntime: () => void;
  onInstallVoiceModelRuntime: () => void;
  onOpenFullTerminal: () => void;
}) {
  const [position, setPosition] = useState({ right: 20, top: 20 });
  const [terminalBubbleGeometry, setTerminalBubbleGeometry] = useState({ width: 360, rightOffset: 0, caretLeft: 180 });
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; startRight: number; startTop: number } | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const terminalSlotRef = useRef<HTMLSpanElement | null>(null);
  const borderProgress = Math.max(0, Math.min(100, progressPercent));
  const progressRatio = borderProgress / 100;
  const edgeProgress = {
    top: Math.min(1, progressRatio / 0.38),
    right: Math.min(1, Math.max(0, progressRatio - 0.38) / 0.12),
    bottom: Math.min(1, Math.max(0, progressRatio - 0.5) / 0.38),
    left: Math.min(1, Math.max(0, progressRatio - 0.88) / 0.12),
  };
  const items = statusItems;

  const beginDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement | null)?.closest("[data-status-widget-interactive='true']")) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startRight: position.right,
      startTop: position.top,
    };
  };

  const drag = (event: React.PointerEvent<HTMLDivElement>) => {
    const current = dragRef.current;
    if (!current || current.pointerId !== event.pointerId) {
      return;
    }
    const nextRight = Math.max(8, Math.min(window.innerWidth - 160, current.startRight - (event.clientX - current.startX)));
    const nextTop = Math.max(8, Math.min(window.innerHeight - 48, current.startTop + event.clientY - current.startY));
    setPosition({ right: nextRight, top: nextTop });
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
    }
  };

  useEffect(() => {
    const bar = barRef.current;
    const slot = terminalSlotRef.current;
    if (!bar || !slot) {
      return;
    }

    const update = () => {
      const barRect = bar.getBoundingClientRect();
      const slotRect = slot.getBoundingClientRect();
      const bubbleWidth = Math.max(300, Math.min(barRect.width / 2, barRect.width));
      const rightOffset = Math.max(0, barRect.right - slotRect.right);
      const slotCenterFromBubbleLeft = bubbleWidth - rightOffset - slotRect.width / 2;
      setTerminalBubbleGeometry({
        width: bubbleWidth,
        rightOffset,
        caretLeft: Math.max(16, Math.min(bubbleWidth - 16, slotCenterFromBubbleLeft)),
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(bar);
    observer.observe(slot);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [position.right, position.top]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.98 }}
      transition={menuMotion.transition}
      className="fixed z-[2100]"
      style={{ right: position.right, top: position.top }}
      data-app-tour-target="compact-status"
    >
      <motion.div
        ref={barRef}
        role="button"
        tabIndex={0}
        aria-label="상태 위젯"
        onPointerDown={beginDrag}
        onPointerMove={drag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        whileTap={softPressTap}
        className="relative flex h-10 max-w-[min(860px,calc(100vw-40px))] cursor-move select-none items-center overflow-visible rounded-[5px] border border-[var(--panel-stroke)] bg-[#0d131c]/95 px-2 shadow-[0_16px_36px_rgba(0,0,0,.28)] backdrop-blur"
      >
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[5px]">
          <motion.span className="absolute left-0 top-0 h-[2px] w-full origin-left bg-[var(--accent-blue)]" initial={false} animate={{ scaleX: edgeProgress.top }} transition={progressSpring} />
          <motion.span className="absolute right-0 top-0 h-full w-[2px] origin-top bg-[var(--accent-blue)]" initial={false} animate={{ scaleY: edgeProgress.right }} transition={progressSpring} />
          <motion.span className="absolute bottom-0 right-0 h-[2px] w-full origin-right bg-[var(--accent-blue)]" initial={false} animate={{ scaleX: edgeProgress.bottom }} transition={progressSpring} />
          <motion.span className="absolute bottom-0 left-0 h-full w-[2px] origin-bottom bg-[var(--accent-blue)]" initial={false} animate={{ scaleY: edgeProgress.left }} transition={progressSpring} />
        </div>
        <div className="relative z-10 flex min-w-0 items-center">
          <ProjectSelector disabled={projectSelectorDisabled} compact />
          <span className="mx-2 h-4 w-px shrink-0 bg-[var(--panel-stroke)] opacity-85" />
          {items.map((item, index) => (
            <div key={`${item.label}-${index}`} className="flex shrink-0 items-center gap-1.5 px-1.5">
              {index > 0 ? <span className="mr-1 h-4 w-px bg-[var(--panel-stroke)]" /> : null}
              <span className="whitespace-nowrap text-[13px] font-normal leading-[18px] text-[var(--secondary-text)]">{item.label}</span>
              <span className="max-w-16 truncate text-[13px] font-normal tabular-nums text-[var(--primary-text)]">{item.value}</span>
            </div>
          ))}
          <span className="mx-2 h-4 w-px shrink-0 bg-[var(--panel-stroke)] opacity-85" />
          <span ref={terminalSlotRef} className="relative shrink-0" data-status-widget-interactive="true" onPointerDown={(event) => event.stopPropagation()}>
            <WorkspaceTerminalDock
              terminal={terminal}
              title={terminalTitle}
              bubblePinned={terminalBubblePinned}
              onBubblePinnedChange={onTerminalBubblePinnedChange}
              onOpenFull={onOpenFullTerminal}
              placement="bottom"
              compact
              embedded
              style={{
                "--terminal-dock-bubble-width": `${terminalBubbleGeometry.width}px`,
                "--terminal-dock-bubble-right-offset": `${terminalBubbleGeometry.rightOffset}px`,
                "--terminal-dock-caret-left": `${terminalBubbleGeometry.caretLeft}px`,
                "--terminal-dock-bubble-gap": "18px",
              } as CSSProperties}
            />
          </span>
          {runtimeEnvironmentStatus && !runtimeEnvironmentStatus.ok ? (
            <>
              <span className="mx-2 h-4 w-px shrink-0 bg-[var(--panel-stroke)] opacity-85" />
              <WorkspaceRuntimeInstallDock
                status={runtimeEnvironmentStatus}
                installing={runtimeEnvironmentInstalling}
                onInstall={onInstallRuntime}
                compact
                embedded
              />
            </>
          ) : null}
          {voiceModelRuntimeStatus && !voiceModelRuntimeStatus.ok ? (
            <>
              <span className="mx-2 h-4 w-px shrink-0 bg-[var(--panel-stroke)] opacity-85" />
              <WorkspaceVoiceModelInstallDock
                status={voiceModelRuntimeStatus}
                installing={voiceModelRuntimeInstalling}
                onInstall={onInstallVoiceModelRuntime}
                compact
                embedded
              />
            </>
          ) : null}
        </div>
      </motion.div>
    </motion.div>
  );
}

function WorkspaceRuntimeInstallDock({
  status,
  installing,
  onInstall,
  compact = false,
  embedded = false,
  className,
}: {
  status: WorkspaceRuntimeEnvironmentStatus;
  installing: boolean;
  onInstall: () => void;
  compact?: boolean;
  embedded?: boolean;
  className?: string;
}) {
  const missing = status.requirements.filter((item) => !item.installed);
  if (status.ok || missing.length === 0) {
    return null;
  }

  const label = missing.map((item) => item.label).join(", ");
  return (
    <motion.div
      layout={embedded ? false : true}
      className={cn(
        "relative flex h-10 min-w-0 items-center gap-2 rounded-[5px] border border-[var(--panel-stroke)] bg-[#0d131c]/95 px-3 text-sm font-normal text-[var(--primary-text)] shadow-[0_16px_36px_rgba(0,0,0,.28)] backdrop-blur",
        compact && "h-7 min-w-[176px] px-2 shadow-none",
        embedded && "min-w-0 border-transparent bg-transparent px-0 shadow-none backdrop-blur-0",
        className,
      )}
      transition={embedded ? { duration: 0 } : undefined}
      data-status-widget-interactive="true"
      title={label}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {embedded ? null : (
        <span className="flex size-7 shrink-0 items-center justify-center rounded-[5px] border border-[var(--neutral-button-stroke)] bg-[var(--table-header-bg)] text-[var(--primary-text)]">
          <Download className="size-3.5" strokeWidth={1.8} />
        </span>
      )}
      <span className="min-w-0 flex-1 truncate">{embedded ? "런타임" : label}</span>
      <span className={cn("size-2 shrink-0 rounded-full", installing ? "bg-[var(--accent-blue)]" : "bg-[#f7c34a]")} />
      <span className="shrink-0 text-[13px] font-normal leading-[18px] text-[var(--primary-text)]">{installing ? "설치 중" : "없음"}</span>
      <motion.button
        type="button"
        whileTap={installing ? undefined : softPressTap}
        onClick={onInstall}
        disabled={installing}
        className="ml-1 flex h-7 shrink-0 items-center justify-center rounded-[4px] bg-[var(--accent-blue)] px-2.5 text-[12px] font-normal text-white hover:brightness-110 disabled:opacity-55"
      >
        {installing ? "..." : "설치"}
      </motion.button>
    </motion.div>
  );
}

function WorkspaceVoiceModelInstallDock({
  status,
  installing,
  onInstall,
  compact = false,
  embedded = false,
  className,
}: {
  status: VoiceModelRuntimeStatus;
  installing: boolean;
  onInstall: () => void;
  compact?: boolean;
  embedded?: boolean;
  className?: string;
}) {
  if (status.ok) {
    return null;
  }

  const label = `${status.label} 모델`;
  const title = status.error ? `${label}: ${status.error}` : `${label}: ${status.path}`;
  return (
    <motion.div
      layout={embedded ? false : true}
      className={cn(
        "relative flex h-10 min-w-0 items-center gap-2 rounded-[5px] border border-[var(--panel-stroke)] bg-[#0d131c]/95 px-3 text-sm font-normal text-[var(--primary-text)] shadow-[0_16px_36px_rgba(0,0,0,.28)] backdrop-blur",
        compact && "h-7 min-w-[198px] px-2 shadow-none",
        embedded && "min-w-0 border-transparent bg-transparent px-0 shadow-none backdrop-blur-0",
        className,
      )}
      transition={embedded ? { duration: 0 } : undefined}
      data-status-widget-interactive="true"
      title={title}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {embedded ? null : (
        <span className="flex size-7 shrink-0 items-center justify-center rounded-[5px] border border-[var(--neutral-button-stroke)] bg-[var(--table-header-bg)] text-[var(--primary-text)]">
          <Download className="size-3.5" strokeWidth={1.8} />
        </span>
      )}
      <span className="min-w-0 flex-1 truncate">{embedded ? "모델" : label}</span>
      <span className={cn("size-2 shrink-0 rounded-full", installing ? "bg-[var(--accent-blue)]" : "bg-[#f7c34a]")} />
      <span className="shrink-0 text-[13px] font-normal leading-[18px] text-[var(--primary-text)]">{installing ? "설치 중" : "없음"}</span>
      <motion.button
        type="button"
        whileTap={installing ? undefined : softPressTap}
        onClick={onInstall}
        disabled={installing}
        className="ml-1 flex h-7 shrink-0 items-center justify-center rounded-[4px] bg-[var(--accent-blue)] px-2.5 text-[12px] font-normal text-white hover:brightness-110 disabled:opacity-55"
      >
        {installing ? "..." : "설치"}
      </motion.button>
    </motion.div>
  );
}

type VoiceModelRuntimeKey = Pick<VoiceModelRuntimeStatus, "selectedModel" | "toolRoot" | "gptVersion" | "settingsKey">;

function voiceModelRuntimeKeyForWorkspace(workspaceId: WorkspaceId, settings: WorkspaceSettings): VoiceModelRuntimeKey | undefined {
  if (workspaceId === "training") {
    const selectedModel = settings.training.selectedModel === "omnivoice" ? "omnivoice" : "gpt-sovits";
    return {
      selectedModel,
      toolRoot: settings.training.toolRoot,
      gptVersion: selectedModel === "gpt-sovits" ? settings.training.gptVersion : undefined,
      settingsKey: [
        workspaceId,
        selectedModel,
        settings.training.toolRoot.trim(),
        selectedModel === "gpt-sovits" ? settings.training.gptVersion : "",
      ].join("|"),
    };
  }

  if (workspaceId === "inference") {
    const selectedModel = settings.inference.selectedModel === "omnivoice" ? "omnivoice" : "gpt-sovits";
    return {
      selectedModel,
      toolRoot: settings.inference.toolRoot,
      gptVersion: selectedModel === "gpt-sovits" ? settings.inference.gptVersion : undefined,
      settingsKey: [
        workspaceId,
        selectedModel,
        settings.inference.toolRoot.trim(),
        selectedModel === "gpt-sovits" ? settings.inference.gptVersion : "",
      ].join("|"),
    };
  }

  return undefined;
}

function voiceModelRuntimeStatusMatchesKey(status: VoiceModelRuntimeStatus, key: VoiceModelRuntimeKey): boolean {
  return status.settingsKey === key.settingsKey;
}

export function WorkspaceFrame({ workspace, runtime }: WorkspaceFrameProps) {
  const persistence = useAppPersistence();
  const initialWorkspaceUiRef = useRef(persistence.getWorkspaceUiSnapshot(workspace.id));
  const layoutRootRef = useRef<HTMLDivElement | null>(null);
  const workspaceGridRef = useRef<HTMLDivElement | null>(null);
  const state = runtime.getState(workspace.id);
  const statusItems = createWorkspaceHeaderStatusItems(state);
  const isBusy = state.isRunning || state.isExporting || state.isBatchSpeakerRunning;
  const progressPercent = Math.max(0, Math.min(100, Math.round(state.progressPercent)));
  const compactHeader = useCompactWorkspaceHeader();
  const projectSwitchingDisabled = useMemo(() => {
    if (runtime.guideMode) {
      return true;
    }

    return workspaceDefinitions.some((definition) => {
      const workspaceState = runtime.getState(definition.id);
      return workspaceState.isRunning || workspaceState.isExporting || workspaceState.isBatchSpeakerRunning || runtime.isVoiceModelRuntimeInstalling(definition.id);
    });
  }, [runtime]);
  const [outerLayoutSizes, setOuterLayoutSizes] = useState<WorkspaceOuterLayoutSizes>(() => initialWorkspaceUiRef.current.outerLayoutSizes ?? defaultOuterLayoutSizes);
  const [layoutResizeState, setLayoutResizeState] = useState<{ resizing: boolean; axis?: WorkspaceResizeAxis }>({ resizing: false });
  const [terminalDialogOpen, setTerminalDialogOpen] = useState(false);
  const [terminalDockOpen, setTerminalDockOpen] = useState(false);
  const [terminalBubblePinned, setTerminalBubblePinned] = useState(true);
  const restoreTerminalDockAfterDialogRef = useRef(false);
  const handledTerminalOpenRequestRef = useRef<Record<string, number>>({});
  if (handledTerminalOpenRequestRef.current[workspace.id] === undefined) {
    handledTerminalOpenRequestRef.current[workspace.id] = state.terminalOpenRequestId;
  }
  const setLayoutResizing = useCallback((resizing: boolean, axis?: WorkspaceResizeAxis) => {
    const nextAxis = resizing ? axis : undefined;
    setLayoutResizeState((current) => (current.resizing === resizing && current.axis === nextAxis ? current : { resizing, axis: nextAxis }));
  }, []);
  const layoutResizeContext = useMemo(
    () => ({ resizing: layoutResizeState.resizing, axis: layoutResizeState.axis, setResizing: setLayoutResizing }),
    [layoutResizeState.axis, layoutResizeState.resizing, setLayoutResizing],
  );
  const renderPanelCard: WorkspacePanelRenderer = (props) => <PanelCard {...props} />;
  const rightPanelsVisible = workspace.right.length > 0;
  const workspaceGridColumns = [
    "var(--workspace-left-width)",
    `${workspaceSplitterSize}px`,
    "minmax(0,1fr)",
    rightPanelsVisible ? `${workspaceSplitterSize}px` : "0px",
    rightPanelsVisible ? "var(--workspace-right-width)" : "0px",
  ].join(" ");
  const workspaceGridStyle = {
    gridTemplateColumns: workspaceGridColumns,
    "--workspace-left-width": `${outerLayoutSizes.left}px`,
    "--workspace-right-width": `${outerLayoutSizes.right}px`,
  } as CSSProperties;
  const guideTerminalOpen = Boolean(runtime.guideMode?.terminalOpen);
  const terminalDockVisible = terminalDockOpen || guideTerminalOpen;
  const runtimeEnvironmentStatus = runtime.getRuntimeEnvironmentStatus(workspace.id);
  const runtimeEnvironmentInstalling = runtime.isRuntimeEnvironmentInstalling(workspace.id);
  const runtimeEnvironmentVisible = Boolean(runtimeEnvironmentStatus && !runtimeEnvironmentStatus.ok);
  const voiceModelRuntimeStatus = runtime.getVoiceModelRuntimeStatus(workspace.id);
  const voiceModelRuntimeInstalling = runtime.isVoiceModelRuntimeInstalling(workspace.id);
  const voiceModelRuntimeKey = useMemo(
    () => voiceModelRuntimeKeyForWorkspace(workspace.id, runtime.settings),
    [
      runtime.settings.inference.gptVersion,
      runtime.settings.inference.selectedModel,
      runtime.settings.inference.toolRoot,
      runtime.settings.training.gptVersion,
      runtime.settings.training.selectedModel,
      runtime.settings.training.toolRoot,
      workspace.id,
    ],
  );
  const voiceModelRuntimeVisible = Boolean(
    voiceModelRuntimeKey
      && runtimeEnvironmentStatus?.ok === true
      && voiceModelRuntimeStatus
      && voiceModelRuntimeStatusMatchesKey(voiceModelRuntimeStatus, voiceModelRuntimeKey)
      && !voiceModelRuntimeStatus.ok,
  );

  useEffect(() => {
    if (!runtime.guideMode) {
      void runtime.checkRuntimeEnvironment(workspace.id);
    }
  }, [runtime.checkRuntimeEnvironment, runtime.guideMode, workspace.id]);

  useEffect(() => {
    if (!runtime.guideMode && runtimeEnvironmentStatus?.ok === true && voiceModelRuntimeKey) {
      void runtime.checkVoiceModelRuntime(workspace.id);
    }
  }, [runtime.checkVoiceModelRuntime, runtime.guideMode, runtimeEnvironmentStatus?.ok, voiceModelRuntimeKey, workspace.id]);

  useEffect(() => {
    persistence.recordWorkspaceUiSnapshot(workspace.id, {
      outerLayoutSizes,
    });
  }, [outerLayoutSizes, persistence, workspace.id]);

  useEffect(() => {
    const handledRequestId = handledTerminalOpenRequestRef.current[workspace.id] ?? 0;
    if (state.terminalOpenRequestId > handledRequestId) {
      handledTerminalOpenRequestRef.current[workspace.id] = state.terminalOpenRequestId;
      setTerminalDockOpen(true);
      setTerminalBubblePinned(true);
    }
  }, [state.terminalOpenRequestId, workspace.id]);

  useEffect(() => {
    const root = layoutRootRef.current;
    if (!root) {
      return;
    }

    const update = () => {
      const availableWidth = Math.max(cardCollapsedSize, root.getBoundingClientRect().width);
      setOuterLayoutSizes((current) => fitOuterLayoutSizes(current, availableWidth, { left: true, right: rightPanelsVisible }));
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(root);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [rightPanelsVisible]);

  const resizeOuterPanel = (side: "left" | "right", startClientX: number) => {
    const grid = workspaceGridRef.current;
    if (!grid) {
      return;
    }

    const rootWidth = Math.max(cardCollapsedSize, layoutRootRef.current?.getBoundingClientRect().width ?? window.innerWidth);
    const startSizes = outerLayoutSizes;
    const visibleHandleWidth = workspaceSplitterSize + (rightPanelsVisible ? workspaceSplitterSize : 0);
    const activeLeftWidth = startSizes.left;
    const activeRightWidth = rightPanelsVisible ? startSizes.right : 0;
    const activeCenterWidth = Math.max(outerPanelMin.center, rootWidth - activeLeftWidth - activeRightWidth - visibleHandleWidth);
    const maxLeft = Math.max(outerPanelMin.left, rootWidth - activeRightWidth - outerPanelMin.center - visibleHandleWidth);
    const maxRight = Math.max(outerPanelMin.right, rootWidth - activeLeftWidth - outerPanelMin.center - visibleHandleWidth);
    let nextSizes = startSizes;

    const applySizes = (delta: number) => {
      if (side === "left") {
        const [nextLeft] = constrainPairPixels(startSizes.left, activeCenterWidth, delta, outerPanelMin.left);
        const left = clampResizablePanelSize(nextLeft, outerPanelMin.left, maxLeft);
        nextSizes = { ...startSizes, left };
        grid.style.setProperty("--workspace-left-width", `${left}px`);
        return;
      }

      const [nextRight] = constrainPairPixels(startSizes.right, activeCenterWidth, -delta, outerPanelMin.right);
      const right = clampResizablePanelSize(nextRight, outerPanelMin.right, maxRight);
      nextSizes = { ...startSizes, right };
      grid.style.setProperty("--workspace-right-width", `${right}px`);
    };

    const handleMove = (event: MouseEvent) => {
      applySizes(event.clientX - startClientX);
    };
    const handleUp = () => {
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setOuterLayoutSizes(nextSizes);
      setLayoutResizing(false);
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    setLayoutResizing(true, "width");
    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleUp);
  };

  return (
    <WorkspaceLayoutResizeProvider value={layoutResizeContext}>
    <div className="relative flex h-[calc(100vh-24px)] min-h-0 flex-col bg-transparent">
      <AnimatePresence initial={false}>
        {compactHeader ? (
          <motion.div key={`compact-status-${workspace.id}`} {...workspaceContentMotion}>
            <WorkspaceStatusWidget
              key="compact-status-widget"
              statusItems={statusItems}
              progressPercent={progressPercent}
              projectSelectorDisabled={projectSwitchingDisabled}
              terminal={state.terminal}
              terminalTitle={`${workspace.title} 콘솔`}
              terminalBubblePinned={terminalDockVisible && (terminalBubblePinned || guideTerminalOpen)}
              runtimeEnvironmentStatus={runtimeEnvironmentStatus}
              runtimeEnvironmentInstalling={runtimeEnvironmentInstalling}
              voiceModelRuntimeStatus={voiceModelRuntimeVisible ? voiceModelRuntimeStatus : undefined}
              voiceModelRuntimeInstalling={voiceModelRuntimeInstalling}
              onTerminalBubblePinnedChange={(pinned) => {
                setTerminalDockOpen(true);
                setTerminalBubblePinned(pinned);
              }}
              onInstallRuntime={() => void runtime.installRuntimeEnvironment(workspace.id)}
              onInstallVoiceModelRuntime={() => void runtime.installVoiceModelRuntime(workspace.id)}
              onOpenFullTerminal={() => setTerminalDialogOpen(true)}
            />
          </motion.div>
        ) : null}
      </AnimatePresence>
      {!compactHeader ? (
        <motion.header
          key={`workspace-header-${workspace.id}`}
          {...workspaceContentMotion}
          className="mb-4 mt-1.5 grid grid-cols-[auto_minmax(140px,1fr)_auto_auto] grid-rows-[38px_auto] items-center"
          data-app-tour-target="workspace-header"
        >
          <h2 className="col-start-1 row-start-1 h-[38px] whitespace-nowrap text-xl font-bold leading-[38px] text-[var(--primary-text)]">{workspace.title}</h2>
          <p className="col-span-4 col-start-1 row-start-2 mt-0.5 text-[13px] font-normal leading-5 text-[var(--secondary-text)]">{workspace.subtitle}</p>
          {isBusy ? (
            <>
              <div className="col-start-2 row-start-1 mx-[18px] h-2 min-w-[140px] overflow-hidden rounded bg-[var(--slider-rail)]">
                <div className="h-full rounded bg-[var(--accent-blue)] transition-[width] duration-300" style={{ width: `${progressPercent}%` }} />
              </div>
              <div className="col-start-3 row-start-1 min-w-[42px] text-right text-sm font-normal text-[var(--primary-text)]">{progressPercent}%</div>
            </>
          ) : null}
          <div className="col-start-4 row-start-1 ml-7 flex items-center justify-end">
            <ProjectSelector disabled={projectSwitchingDisabled} />
            <span className="mx-[18px] h-4 w-px shrink-0 bg-[var(--panel-stroke)] opacity-85" />
            {statusItems.map((item, index) => (
              <div key={item.label} className="flex items-center">
                {index > 0 ? <span className="mx-[18px] h-4 w-px bg-[var(--panel-stroke)] opacity-85" /> : null}
                <span className="mr-2 text-sm font-normal text-[var(--secondary-text)]">{item.label}</span>
                <span className="max-w-36 truncate text-sm font-normal text-[var(--primary-text)]">{item.value}</span>
              </div>
            ))}
            <motion.button
              type="button"
              onClick={() => {
                setTerminalDockOpen((current) => {
                  const nextOpen = !current;
                  if (nextOpen) {
                    setTerminalBubblePinned(true);
                  }
                  return nextOpen;
                });
              }}
              whileTap={softPressTap}
              className="wpf-button ml-[18px] flex h-8 items-center gap-2 px-3 text-[13px]"
            >
              <Terminal className="size-3.5" strokeWidth={1.8} />
              {terminalDockVisible ? "콘솔 닫기" : "콘솔 열기"}
            </motion.button>
          </div>
        </motion.header>
      ) : null}

      <AnimatePresence>
      {state.error ? (
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={menuMotion.transition} className="pointer-events-none absolute left-0 right-0 top-[74px] z-40 flex justify-center px-4">
          <motion.div layout className="pointer-events-auto relative max-h-[224px] w-[min(1040px,100%)] overflow-auto rounded-[5px] border border-[#7b3540] bg-[#2b1519]/90 px-4 py-3 pr-11 text-sm leading-5 text-[#ffb8bf] shadow-2xl backdrop-blur">
            <button
              type="button"
              onClick={() => runtime.clearError(workspace.id)}
              className="absolute right-2 top-2 flex size-7 items-center justify-center rounded-[4px] text-[#ffd4d8] hover:bg-[#5a2a33]"
              aria-label="오류 알림 닫기"
            >
              <X className="size-4" strokeWidth={1.8} />
            </button>
            <div className="whitespace-pre-wrap font-sans">{state.error}</div>
          </motion.div>
        </motion.div>
      ) : null}
      </AnimatePresence>

      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div ref={layoutRootRef} className="relative min-h-0 flex-1" data-app-tour-target="workspace-layout">
        <div ref={workspaceGridRef} className="grid h-full min-h-0" style={workspaceGridStyle}>
          <PanelCard key={workspace.left.id} layoutId="workspace-card-left" workspaceId={workspace.id} panel={workspace.left} runtime={runtime} collapseMode="none" />
          <PanelResizeHandle orientation="vertical" onMouseDown={(event) => resizeOuterPanel("left", event.clientX)} />
          <WorkspaceCenterPanels workspace={workspace} runtime={runtime} renderPanel={renderPanelCard} />
          {rightPanelsVisible ? <PanelResizeHandle orientation="vertical" onMouseDown={(event) => resizeOuterPanel("right", event.clientX)} /> : <div aria-hidden="true" />}
          {rightPanelsVisible ? <WorkspaceRightPanels workspace={workspace} runtime={runtime} renderPanel={renderPanelCard} /> : <div />}
        </div>
        </div>
      </div>
      <AnimatePresence>
        {!compactHeader && terminalDockVisible ? (
          <motion.div
            key={`${workspace.id}-terminal-dock`}
            initial={{ opacity: 0, y: 10, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.985 }}
            transition={menuMotion.transition}
            className="fixed right-6 z-[2100]"
            style={{ bottom: runtimeEnvironmentVisible || voiceModelRuntimeVisible ? 78 : 24 }}
          >
            <WorkspaceTerminalDock
              terminal={state.terminal}
              title={`${workspace.title} 콘솔`}
              bubblePinned={terminalBubblePinned || guideTerminalOpen}
              onBubblePinnedChange={setTerminalBubblePinned}
              onOpenFull={() => {
                restoreTerminalDockAfterDialogRef.current = true;
                setTerminalDockOpen(false);
                setTerminalDialogOpen(true);
              }}
              placement="top"
              className="w-[420px]"
            />
          </motion.div>
        ) : null}
      </AnimatePresence>
      <AnimatePresence>
        {!compactHeader && runtimeEnvironmentStatus && !runtimeEnvironmentStatus.ok ? (
          <motion.div
            key={`${workspace.id}-runtime-install-dock`}
            initial={{ opacity: 0, y: 10, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.985 }}
            transition={menuMotion.transition}
            className="fixed bottom-6 right-6 z-[2100]"
          >
            <WorkspaceRuntimeInstallDock
              status={runtimeEnvironmentStatus}
              installing={runtimeEnvironmentInstalling}
              onInstall={() => void runtime.installRuntimeEnvironment(workspace.id)}
              className="w-[420px]"
            />
          </motion.div>
        ) : null}
      </AnimatePresence>
      <AnimatePresence>
        {!compactHeader && voiceModelRuntimeVisible && voiceModelRuntimeStatus ? (
          <motion.div
            key={`${workspace.id}-voice-model-install-dock`}
            initial={{ opacity: 0, y: 10, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.985 }}
            transition={menuMotion.transition}
            className="fixed bottom-6 right-6 z-[2100]"
          >
            <WorkspaceVoiceModelInstallDock
              status={voiceModelRuntimeStatus}
              installing={voiceModelRuntimeInstalling}
              onInstall={() => void runtime.installVoiceModelRuntime(workspace.id)}
              className="w-[420px]"
            />
          </motion.div>
        ) : null}
      </AnimatePresence>
      <AnimatePresence>
        {terminalDialogOpen ? (
          <WorkspaceTerminalDialog
            key={`${workspace.id}-terminal`}
            title={`${workspace.title} 터미널`}
            terminal={state.terminal}
            onClear={() => runtime.clearTerminal(workspace.id)}
            onClose={() => {
              setTerminalDialogOpen(false);
              if (restoreTerminalDockAfterDialogRef.current) {
                restoreTerminalDockAfterDialogRef.current = false;
                setTerminalDockOpen(true);
              }
            }}
          />
        ) : null}
      </AnimatePresence>
    </div>
    </WorkspaceLayoutResizeProvider>
  );
}

function collapseModeUsesAxis(mode: PanelCollapseMode, axis: WorkspaceResizeAxis): boolean {
  return axis === "width" ? mode === "vertical" || mode === "compact" : mode === "horizontal" || mode === "compact";
}

function resolvePanelTourRegion(layoutId?: string): "left" | "center" | "right" | undefined {
  if (!layoutId) {
    return undefined;
  }

  if (layoutId.includes("-left")) {
    return "left";
  }

  if (layoutId.includes("-center")) {
    return "center";
  }

  if (layoutId.includes("-right")) {
    return "right";
  }

  return undefined;
}

function resolveAutoCollapseSuppression(
  base: PanelAutoCollapseSuppression | undefined,
  activeResizeAxis: WorkspaceResizeAxis | undefined,
  previousMode: PanelCollapseMode,
): PanelAutoCollapseSuppression | undefined {
  if (!activeResizeAxis) {
    return base;
  }

  const suppressedAxis: WorkspaceResizeAxis = activeResizeAxis === "width" ? "height" : "width";
  if (collapseModeUsesAxis(previousMode, suppressedAxis)) {
    return base;
  }

  const resizedAxisSuppression: PanelAutoCollapseSuppression = { [suppressedAxis]: true };
  return {
    ...base,
    ...resizedAxisSuppression,
  };
}

function PanelCard({
  layoutId,
  workspaceId,
  panel,
  runtime,
  className,
  detail = false,
  collapseMode,
  contentSizing = false,
  autoCollapseSuppression,
}: {
  layoutId?: string;
  workspaceId: WorkspaceId;
  panel: WorkspacePanel;
  runtime: WorkspaceRuntime;
  className?: string;
  detail?: boolean;
  collapseMode: PanelCollapseMode;
  contentSizing?: boolean;
  autoCollapseSuppression?: PanelAutoCollapseSuppression;
}) {
  const Icon = panel.icon;
  const cardRef = useRef<HTMLElement | null>(null);
  const { resizing: layoutResizing, axis: layoutResizeAxis } = useWorkspaceLayoutResizeState();
  const previousMeasuredCollapseModeRef = useRef<PanelCollapseMode>("none");
  const activeAutoCollapseSuppression = resolveAutoCollapseSuppression(autoCollapseSuppression, layoutResizing ? layoutResizeAxis : undefined, previousMeasuredCollapseModeRef.current);
  const cardSize = useElementBoxSize(cardRef, layoutResizing);
  const resizeCollapseMode = useElementResizeCollapseMode(cardRef, layoutResizing, collapseMode, activeAutoCollapseSuppression);
  const isSliceEditor = workspaceId === "slice" && panel.kind === "waveform";
  const isBatchAudioPanel = workspaceId === "batch" && panel.id === "batch-audio";
  const persistence = useAppPersistence();
  const initialWorkspaceUiRef = useRef(persistence.getWorkspaceUiSnapshot(workspaceId));
  const [sliceEditorState, setSliceEditorState] = useState<SliceEditorViewState>(() => initialWorkspaceUiRef.current.sliceEditor);
  const sliceEditorActions = useMemo<SliceEditorViewActions>(
    () => ({
      setLoopPreview: (enabled) => setSliceEditorState((current) => ({ ...current, loopPreview: enabled })),
      zoomIn: () => setSliceEditorState((current) => zoomSliceView(current, 0.68, 0.5)),
      zoomOut: () => setSliceEditorState((current) => zoomSliceView(current, 1.45, 0.5)),
      zoomAt: (anchor, deltaY) => setSliceEditorState((current) => zoomSliceView(current, deltaY > 0 ? 1.18 : 0.84, anchor)),
      setViewRange: (start, end) => setSliceEditorState((current) => setSliceViewRange(current, start, end)),
      focusSelection: (rows, selectedRow, totalSeconds) => setSliceEditorState((current) => focusSliceViewOnRow(current, rows, selectedRow, totalSeconds)),
    }),
    [],
  );
  const workspaceState = runtime.getState(workspaceId);
  const sliceEditorContext = useMemo<SliceEditorViewContext>(
    () => ({
      state: sliceEditorState,
      actions: sliceEditorActions,
    }),
    [sliceEditorActions, sliceEditorState],
  );
  const sliceEditorEnabled = Boolean(workspaceState.selectedAudioPath);

  useEffect(() => {
    if (isSliceEditor) {
      persistence.recordWorkspaceUiSnapshot(workspaceId, { sliceEditor: sliceEditorState });
    }
  }, [isSliceEditor, persistence, sliceEditorState, workspaceId]);
  const isTablePanel = panel.kind === "table" || panel.kind === "progress";
  const measuredCollapseMode = resizeCollapseMode ?? resolveMeasuredPanelCollapseMode(collapseMode, cardSize, activeAutoCollapseSuppression);
  const physicallyCollapsed = collapseMode !== "none" && measuredCollapseMode !== "none";
  const expanded = measuredCollapseMode === "none";
  const layoutAnimationEnabled = !layoutResizing && expanded;
  const verticalCollapsed = measuredCollapseMode === "vertical";
  const horizontalCollapsed = measuredCollapseMode === "horizontal";
  const compactCollapsed = measuredCollapseMode === "compact";
  const panelTourRegion = resolvePanelTourRegion(layoutId);
  const bodyMinSize = getPanelBodyMinSize(panel, detail);
  const bodyLayoutMode = getPanelBodyLayoutMode(panel);
  const bodyFillsAvailableSpace = bodyLayoutMode === "fill";
  const effectiveBodyLayoutMode = bodyFillsAvailableSpace ? "fill" : "content";
  const bodyScrollFillsAvailableSpace = bodyFillsAvailableSpace || contentSizing;
  const bodyGridRowsClass = expanded
    ? contentSizing
      ? "mt-3 flex-auto grid-rows-[minmax(0,1fr)]"
      : "mt-3 flex-1 grid-rows-[minmax(0,1fr)]"
    : "mt-0 grid-rows-[0fr]";
  const motionLayoutId = layoutAnimationEnabled && layoutId ? `${workspaceId}:${layoutId}` : undefined;
  const collapsedClass =
    measuredCollapseMode === "horizontal"
      ? "h-[56px] min-h-0 max-h-[56px] w-full self-start overflow-hidden"
      : measuredCollapseMode === "vertical"
        ? "h-full min-h-0 w-[56px] min-w-[56px] max-w-[56px] self-stretch overflow-hidden"
        : "h-[56px] min-h-0 max-h-[56px] w-[56px] min-w-[56px] max-w-[56px] self-start overflow-hidden";

  useEffect(() => {
    previousMeasuredCollapseModeRef.current = measuredCollapseMode;
  }, [measuredCollapseMode]);

  return (
    <WpfCard
      ref={cardRef}
      layout={layoutAnimationEnabled ? "position" : false}
      layoutId={motionLayoutId}
      transition={layoutAnimationEnabled ? workspaceCardSpring : { duration: 0 }}
      className={cn("workspace-panel-card flex min-w-0 flex-col", layoutAnimationEnabled && "will-change-transform", physicallyCollapsed ? collapsedClass : cn(contentSizing ? "min-h-[56px]" : "min-h-0", "min-w-0", className))}
      data-workspace-card-layout-id={layoutId}
      data-collapse-mode={measuredCollapseMode}
      data-app-tour-panel-id={panel.id}
      data-app-tour-panel-kind={panel.kind}
      data-app-tour-panel-region={panelTourRegion}
    >
      <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col", detail ? "p-5" : panel.kind === "waveform" ? "p-[15px]" : "p-4", verticalCollapsed && "h-full items-center px-2 py-4", compactCollapsed && "items-center p-1", horizontalCollapsed && "justify-center")}>
        <div className={cn("flex min-h-[24px] min-w-0 items-center justify-between gap-2 overflow-hidden", verticalCollapsed && "h-full min-h-0 flex-col justify-start gap-3 overflow-hidden", compactCollapsed && "flex-col justify-start gap-0.5 overflow-hidden")}>
          <div className={cn("flex min-w-0 shrink items-center gap-2 text-left", verticalCollapsed && "min-h-0 flex-1 flex-col justify-start", compactCollapsed && "justify-center")}>
            <Icon className="size-[18px] shrink-0 text-[var(--icon-brush)]" strokeWidth={1.65} />
            {verticalCollapsed ? (
              <h3 key="vertical-title" className="[writing-mode:vertical-rl] min-h-0 flex-1 truncate text-base font-normal leading-5 text-[var(--primary-text)]">{panel.title}</h3>
            ) : compactCollapsed ? null : (
              <h3 key="normal-title" className="min-w-0 truncate whitespace-nowrap text-base font-normal leading-5 text-[var(--primary-text)]">{panel.title}</h3>
            )}
          </div>
          <div className={cn("flex min-w-max shrink-0 items-center gap-2", (verticalCollapsed || compactCollapsed) && "flex-col gap-1")}>
            {expanded && workspaceId === "training" && panel.id === "training-plan" ? <TrainingPlanHeaderControl runtime={runtime} /> : null}
            {expanded && isTablePanel ? <TableHeaderSearch workspaceId={workspaceId} runtime={runtime} /> : null}
            {expanded && isSliceEditor ? <SliceEditorHeaderControls view={sliceEditorContext.state} actions={sliceEditorContext.actions} disabled={!sliceEditorEnabled} /> : null}
            {expanded && isBatchAudioPanel ? <BatchAudioHeaderControls runtime={runtime} disabled={!workspaceState.selectedAudioPath} /> : null}
            <span
              className="flex size-6 shrink-0 items-center justify-center"
              data-app-tour-panel-tools="true"
            >
              <EllipsisVertical className="size-4 text-[var(--control-arrow)]" strokeWidth={1.9} />
            </span>
          </div>
        </div>
        <div aria-hidden={!expanded} className={cn("grid min-h-0 min-w-0", !expanded && "pointer-events-none", bodyGridRowsClass)}>
          <div className="min-h-0 min-w-0 overflow-hidden">
            <div className={cn("workspace-panel-body-scroll app-scrollbar min-h-0 min-w-0 overflow-auto", expanded ? "opacity-100" : "opacity-0", bodyScrollFillsAvailableSpace ? "h-full" : "max-h-full")}>
              <div
                data-body-layout={effectiveBodyLayoutMode}
                className={cn("workspace-panel-body-content min-h-0 min-w-0", bodyFillsAvailableSpace ? "h-full" : "h-auto")}
                style={{
                  minWidth: bodyMinSize.width > 0 ? bodyMinSize.width : undefined,
                  minHeight: bodyMinSize.height > 0 ? bodyMinSize.height : undefined,
                }}
              >
                {renderPanelBody(workspaceId, panel, runtime, isSliceEditor ? sliceEditorContext : undefined, layoutResizing)}
              </div>
            </div>
          </div>
        </div>
      </div>
    </WpfCard>
  );
}

function renderPanelBody(workspaceId: WorkspaceId, panel: WorkspacePanel, runtime: WorkspaceRuntime, sliceEditorContext?: SliceEditorViewContext, layoutResizing = false) {
  const state = runtime.getState(workspaceId);
  const table = runtime.getTable(workspaceId);

  if (panel.kind === "browser") {
    const inputTree = resolveBrowserTree(workspaceId, "input", state.inputTree, table, state.inputPath);
    const outputTree = resolveBrowserTree(workspaceId, "output", state.outputTree, table, state.outputPath);

    return (
      <FileBrowser
        workspaceId={workspaceId}
        inputPath={state.inputPath}
        outputPath={state.outputPath}
        inputTree={inputTree}
        outputTree={outputTree}
        selectedPath={state.selectedFilePath}
        rowChecks={state.rowExportChecks}
        preferredSection={state.browserPreferredSection}
        sectionRequestId={state.browserSectionRequestId}
        revealRequestId={state.browserRevealRequestId}
        onSelectInputFolder={() => runtime.selectInputFolder(workspaceId)}
        onSelectOutputFolder={() => runtime.selectOutputFolder(workspaceId)}
        inputActionLabel={workspaceId === "training" ? "데이터셋 파일" : undefined}
        outputActionLabel={workspaceId === "training" ? "체크포인트 폴더" : undefined}
        onRequestWindow={(purpose, direction, metrics, targetPath) => runtime.loadFileBrowserWindow(workspaceId, purpose, direction, metrics, targetPath)}
        onSelectNode={(node) => runtime.selectFileNode(workspaceId, node)}
      />
    );
  }

  if (workspaceId === "tagging" && panel.id === "tagging-queue") {
    return <TaggingSchemaBody runtime={runtime} />;
  }

  if (workspaceId === "batch" && panel.id === "batch-timeline") {
    return <BatchTimelineBody row={findSelectedRow(state.table.rows, state.selectedRowId)} />;
  }

  if (panel.kind === "table" || panel.kind === "progress") {
    return <WorkspaceDataGrid workspaceId={workspaceId} runtime={runtime} table={table} suspendWidthTracking={layoutResizing} />;
  }

  if (panel.kind === "waveform") {
    return (
      <SliceEditorBody
        row={findSelectedRow(state.table.rows, state.selectedRowId)}
        rows={state.table.rows}
        audioPath={state.selectedAudioPath}
        view={sliceEditorContext?.state ?? { viewStart: 0, viewEnd: 1, loopPreview: false }}
        actions={sliceEditorContext?.actions}
        onPrevious={() => runtime.selectAdjacentRow(workspaceId, -1)}
        onNext={() => runtime.selectAdjacentRow(workspaceId, 1)}
        onSplitOrUnmergeSegment={(sourceRow, componentIds) => runtime.splitOrUnmergeSliceSegment(workspaceId, sourceRow, componentIds)}
        onMergeSegments={() => runtime.mergeSliceSegments(workspaceId)}
        onUpdateSegmentBounds={(sourceRow, startSec, endSec) => runtime.updateSliceSegmentBounds(workspaceId, sourceRow, startSec, endSec)}
        onSelectRow={(nextRow, options) => runtime.selectRow(workspaceId, nextRow, options)}
        onAddSegment={(startSec, endSec) => runtime.addSliceSegment(workspaceId, findSelectedRow(state.table.rows, state.selectedRowId), startSec, endSec)}
        onCopySegment={(sourceRow) => runtime.copyRows(workspaceId, [sourceRow.id])}
        onDeleteSegment={(sourceRow) => runtime.deleteSliceSegment(workspaceId, sourceRow)}
        selectedRowIds={state.selectedRowIds}
      />
    );
  }

  if (workspaceId === "speaker" && panel.kind === "playback") {
    return <SpeakerAudioComparisonPanel row={findSelectedRow(state.table.rows, state.selectedRowId)} originalPath={state.selectedAudioPath} resultPath={state.selectedResultAudioPath} audioEditScopeId={state.activeSheetId} />;
  }

  if (workspaceId === "batch" && panel.kind === "playback") {
    return <BatchAudioPlaybackPanel row={findSelectedRow(state.table.rows, state.selectedRowId)} audioPath={state.selectedAudioPath} playTranscriptOutside={runtime.settings.batch.playTranscriptOutside} audioEditScopeId={state.activeSheetId} />;
  }

  if (workspaceId === "overview" && panel.kind === "playback") {
    return <WorkspaceAudioPlaybackPanel row={findSelectedRow(state.table.rows, state.selectedRowId)} audioPath={state.selectedAudioPath} cropEnabled audioEditScopeId={state.activeSheetId} />;
  }

  if (workspaceId === "tagging" && panel.kind === "playback") {
    return <WorkspaceAudioPlaybackPanel row={findSelectedRow(state.table.rows, state.selectedRowId)} audioPath={state.selectedAudioPath} cropEnabled emptyText="오디오 행을 선택하세요." syncKey="tagging" audioEditScopeId={state.activeSheetId} />;
  }

  if (workspaceId === "inference" && panel.id === "inference-reference") {
    return <InferenceReferenceBody runtime={runtime} />;
  }

  if (workspaceId === "inference" && panel.id === "inference-output") {
    return <InferenceOutputBody runtime={runtime} />;
  }

  if (workspaceId === "speaker" && panel.kind === "model") {
    return <SpeakerModelBody runtime={runtime} />;
  }

  if (workspaceId === "training" && panel.kind === "model") {
    return <TrainingModelBody runtime={runtime} />;
  }

  if (workspaceId === "training" && panel.id === "training-plan") {
    return <TrainingPlanBody runtime={runtime} />;
  }

  if (workspaceId === "inference" && panel.kind === "model") {
    return <InferenceModelBody runtime={runtime} />;
  }

  if (workspaceId === "slice" && panel.kind === "settings") {
    return <SliceSettingsBody runtime={runtime} />;
  }

  if (workspaceId === "tagging" && panel.kind === "settings") {
    return <TaggingSettingsBody runtime={runtime} />;
  }

  if (workspaceId === "speaker" && panel.kind === "settings") {
    return <SpeakerSettingsBody runtime={runtime} />;
  }

  if (workspaceId === "overview" && panel.id === "overview-modules") {
    return <OverviewModulesBody runtime={runtime} />;
  }

  if (workspaceId === "overview" && panel.id === "overview-detail") {
    return <OverviewModelSettingsBody runtime={runtime} />;
  }

  if (workspaceId === "batch" && panel.id === "batch-speakers") {
    return <BatchSpeakerSelectionBody runtime={runtime} rows={state.table.rows} />;
  }

  if (workspaceId === "batch" && panel.id === "batch-detail") {
    return <BatchModelSettingsBody runtime={runtime} />;
  }

  if (workspaceId === "training" && panel.id === "training-settings") {
    return <TrainingSettingsBody runtime={runtime} />;
  }

  if (workspaceId === "inference" && panel.id === "inference-settings") {
    return <InferenceSettingsBody runtime={runtime} />;
  }

  if (panel.kind === "detail") {
    return workspaceId === "overview" ? (
      <DetailFieldList fields={state.details} helpByLabel={overviewDetailHelp} />
    ) : (
      <DetailFieldList fields={state.details} />
    );
  }

  if (panel.kind === "queue") {
    return <BackendStatusBody status={state.statusText} />;
  }

  return <BackendStatusBody status={state.statusText} />;
}

function WorkspaceDataGrid({ workspaceId, runtime, table, suspendWidthTracking = false }: { workspaceId: WorkspaceId; runtime: WorkspaceRuntime; table: ReturnType<WorkspaceRuntime["getTable"]>; suspendWidthTracking?: boolean }) {
  const persistence = useAppPersistence();
  const initialWorkspaceUiRef = useRef(persistence.getWorkspaceUiSnapshot(workspaceId));
  const [overviewEditorOpen, setOverviewEditorOpen] = useState(() => workspaceId === "overview" && initialWorkspaceUiRef.current.dialogs.overviewEditorOpen);
  const [batchReplaceOpen, setBatchReplaceOpen] = useState(() => workspaceId === "batch" && initialWorkspaceUiRef.current.dialogs.batchReplaceOpen);
  const [taggingScoreCutOpen, setTaggingScoreCutOpen] = useState(() => workspaceId === "tagging" && initialWorkspaceUiRef.current.dialogs.taggingScoreCutOpen);
  const [trainingTensorBoardOpen, setTrainingTensorBoardOpen] = useState(() => workspaceId === "training" && initialWorkspaceUiRef.current.dialogs.trainingTensorBoardOpen);
  const [visibleGridRows, setVisibleGridRows] = useState<DataTableRow[]>([]);
  const state = runtime.getState(workspaceId);
  const batchAudioSync = useWorkspaceAudioSync(workspaceId === "batch" ? "batch" : undefined);
  const batchAudioActive = workspaceId === "batch" && sameAudioPath(batchAudioSync.audioPath, state.selectedAudioPath);
  const recordGridViewState = useCallback((grid: DataGridViewState) => {
    persistence.recordWorkspaceUiSnapshot(workspaceId, { grid });
  }, [persistence, workspaceId]);
  const recordBatchReplaceState = useCallback((batchReplace: PersistedBatchReplaceState) => {
    persistence.recordWorkspaceUiSnapshot("batch", { batchReplace });
  }, [persistence]);

  useEffect(() => {
    persistence.recordWorkspaceUiSnapshot(workspaceId, {
      dialogs: {
        overviewEditorOpen,
        batchReplaceOpen,
        taggingScoreCutOpen,
        trainingTensorBoardOpen,
      },
    });
  }, [batchReplaceOpen, overviewEditorOpen, persistence, taggingScoreCutOpen, trainingTensorBoardOpen, workspaceId]);

  return (
    <>
      <DataGrid
        table={table}
        sheets={state.sheets}
        activeSheetId={state.activeSheetId}
        onSelectSheet={(sheetId) => runtime.selectSheet(workspaceId, sheetId)}
        onCreateSheet={() => runtime.createSheet(workspaceId)}
        onDeleteSheet={state.isRunning || state.isExporting || state.isBatchSpeakerRunning ? undefined : () => runtime.deleteSheet(workspaceId)}
        selectedRowId={state.selectedRowId}
        selectedRowIds={state.selectedRowIds}
        selectedRowRevealRequestId={state.tableRevealRequestId}
        onSelectRow={(row, additive) => runtime.selectRow(workspaceId, row, { additive })}
        onSelectRows={(rowIds) => runtime.selectRows(workspaceId, rowIds)}
        clipboardRows={runtime.getClipboardRows(workspaceId)}
        onCopyRows={(rowIds) => runtime.copyRows(workspaceId, rowIds)}
        onPasteRows={(duplicateMode) => runtime.pasteRows(workspaceId, duplicateMode)}
        rowChecks={state.rowExportChecks}
        onToggleRowCheck={(row) => runtime.toggleRowExportCheck(workspaceId, row)}
        onToggleAllRows={(checked) => runtime.setAllRowExportChecks(workspaceId, checked, table.rows)}
        onToggleRowsCheck={(checked, rowIds) => runtime.setRowsExportChecks(workspaceId, checked, rowIds)}
        sheetToolbar={
          workspaceId === "overview" ? (
            <TableFilterButton ariaLabel="커스텀 필터" onClick={() => setOverviewEditorOpen(true)} />
          ) : workspaceId === "batch" ? (
            <TableFilterButton ariaLabel="내용 검색 및 바꾸기" onClick={() => setBatchReplaceOpen(true)} />
          ) : workspaceId === "tagging" ? (
            <TableFilterButton ariaLabel="태그 디코딩 설정" onClick={() => setTaggingScoreCutOpen(true)}>
              <ListChecks className="size-4" strokeWidth={2} />
            </TableFilterButton>
          ) : workspaceId === "training" ? (
            <TableFilterButton ariaLabel="TensorBoard 그래프" onClick={() => setTrainingTensorBoardOpen(true)}>
              <ChartNoAxesColumnIncreasing className="size-4" strokeWidth={2} />
            </TableFilterButton>
          ) : null
        }
        columnMenus={buildColumnMenus(workspaceId, runtime)}
        renderCell={
          workspaceId === "batch"
            ? (context) => (
                <BatchEditableCell
                  context={context}
                  runtime={runtime}
                  currentTime={batchAudioSync.currentTime}
                  audioActive={batchAudioActive && context.row.id === state.selectedRowId}
                />
              )
            : workspaceId === "tagging"
              ? (context) => <TaggingResultCell context={context} />
              : undefined
        }
        onVisibleRowsChange={(rows) => {
          setVisibleGridRows((current) => (sameRowIds(current, rows) ? current : rows));
        }}
        viewState={initialWorkspaceUiRef.current.grid}
        onViewStateChange={recordGridViewState}
        suspendWidthTracking={suspendWidthTracking}
      />
      <AnimatePresence initial={false}>
        {taggingScoreCutOpen ? <TaggingScoreCutDialog key="tagging-score-cut-dialog" runtime={runtime} onClose={() => setTaggingScoreCutOpen(false)} /> : null}
      </AnimatePresence>
      <AnimatePresence initial={false}>
        {overviewEditorOpen ? <FilterChipEditorDialog key="overview-filter-editor" filter={runtime.overviewFilter} onApply={runtime.setOverviewFilter} onClose={() => setOverviewEditorOpen(false)} /> : null}
      </AnimatePresence>
      <AnimatePresence initial={false}>
        {batchReplaceOpen ? (
          <BatchTranscriptReplaceDialog
            key="batch-replace-dialog"
            allRows={state.table.rows}
            displayedRows={table.rows}
            visibleRows={visibleGridRows}
            rowChecks={state.rowExportChecks}
            sheets={state.sheets}
            activeSheetId={state.activeSheetId}
            defaultTimelineScoreThreshold={runtime.settings.batch.wordAlignmentLowScoreThreshold}
            onSelectSheet={(sheetId) => runtime.selectSheet("batch", sheetId)}
            onApply={(rowId, value) => runtime.editBatchCell(rowId, "editedTranscript", value)}
            onClose={() => setBatchReplaceOpen(false)}
            initialState={initialWorkspaceUiRef.current.batchReplace}
            onStateChange={recordBatchReplaceState}
          />
        ) : null}
      </AnimatePresence>
      <AnimatePresence initial={false}>
        {trainingTensorBoardOpen ? (
          <VoiceTensorBoardDialog
            key="training-tensorboard-dialog"
            settings={runtime.settings.training}
            onClose={() => setTrainingTensorBoardOpen(false)}
          />
        ) : null}
      </AnimatePresence>
    </>
  );
}

function sameRowIds(left: DataTableRow[], right: DataTableRow[]): boolean {
  return left.length === right.length && left.every((row, index) => row.id === right[index]?.id);
}

function sameAudioPath(left?: string, right?: string): boolean {
  const normalizedLeft = (left ?? "").trim().replace(/\\/gu, "/").toLowerCase();
  const normalizedRight = (right ?? "").trim().replace(/\\/gu, "/").toLowerCase();
  return normalizedLeft.length > 0 && normalizedLeft === normalizedRight;
}

function TableHeaderSearch({ workspaceId, runtime }: { workspaceId: WorkspaceId; runtime: WorkspaceRuntime }) {
  const state = runtime.getState(workspaceId);
  const baseTable = workspaceId === "training" ? runtime.getTable(workspaceId) : state.table;
  const searchColumns = baseTable.columns
    .filter((column) => column.key !== "index")
    .map((column) => ({ key: column.key, label: column.label }));
  const search = readSearchState(workspaceId, runtime);
  const [draftQuery, setDraftQuery] = useState(search.query);
  const [draftColumns, setDraftColumns] = useState<string[]>(search.columns);
  useEffect(() => {
    setDraftQuery(search.query);
    setDraftColumns(search.columns);
  }, [search.query, search.columns]);
  const applySearch = () => {
    runtime.setTableSearch(workspaceId, { query: draftQuery, columns: draftColumns });
  };
  useEffect(() => {
    const timer = window.setTimeout(applySearch, 3000);
    return () => window.clearTimeout(timer);
  }, [draftColumns, draftQuery]);

  return (
    <div className="w-[clamp(72px,42vw,292px)] min-w-0 max-w-full shrink">
      <ColumnSearchField
        value={draftQuery}
        onChange={setDraftQuery}
        options={searchColumns}
        selectedKeys={draftColumns}
        onSelectedKeysChange={setDraftColumns}
        ariaLabel="검색"
        onSubmit={applySearch}
      />
    </div>
  );
}

function readSearchState(workspaceId: WorkspaceId, runtime: WorkspaceRuntime): { query: string; columns: string[] } {
  if (workspaceId === "overview") {
    return { query: runtime.overviewFilter.textQuery, columns: runtime.overviewFilter.textColumns };
  }

  const state = runtime.getState(workspaceId);
  if (workspaceId === "batch") {
    return { query: state.batchFilter.query, columns: state.batchFilter.queryColumns };
  }

  return { query: state.tableSearchQuery, columns: state.tableSearchColumns };
}

function TableFilterButton({ ariaLabel, onClick, children }: { ariaLabel: string; onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void; children?: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex size-8 items-center justify-center rounded-[5px] border border-[var(--neutral-button-stroke)] bg-[var(--table-header-bg)] text-[var(--primary-text)] hover:bg-[var(--soft-selection-hover)]"
      aria-label={ariaLabel}
    >
      {children ?? <Filter className="size-4" strokeWidth={2} />}
    </button>
  );
}

function buildColumnMenus(workspaceId: WorkspaceId, runtime: WorkspaceRuntime): Record<string, ReactNode> {
  if (workspaceId === "overview") {
    return Object.fromEntries(
      overviewMetricColumns.map((column) => [
        column,
        <OverviewMetricColumnMenu key={column} column={column} runtime={runtime} />,
      ]),
    );
  }

  if (workspaceId === "batch") {
    return {
      qcStatus: <BatchStatusColumnMenu runtime={runtime} />,
    };
  }

  return {};
}

function OverviewMetricColumnMenu({ column, runtime }: { column: OverviewMetricColumn; runtime: WorkspaceRuntime }) {
  const filter = runtime.overviewFilter;
  const current = filter.columnFilters?.[column] ?? "all";
  const activeCustomId = filter.customChips.find((chip) => chip.active)?.id;
  const visibleCustomChips = filter.customChips.filter((chip) => chip.visible ?? true);
  const setBasic = (value: OxFilterState) => {
    runtime.setOverviewFilter((currentFilter) => ({
      ...currentFilter,
      noise: column === "noise_bak" ? value : currentFilter.noise,
      columnFilters: {
        ...currentFilter.columnFilters,
        [column]: value,
      },
      customChips: currentFilter.customChips.map((chip) => ({ ...chip, active: false })),
    }));
  };
  const selectCustom = (chipId: string) => {
    runtime.setOverviewFilter((currentFilter) => ({
      ...currentFilter,
      noise: "all",
      columnFilters: Object.fromEntries(overviewMetricColumns.map((item) => [item, "all"])) as Record<OverviewMetricColumn, OxFilterState>,
      customChips: currentFilter.customChips.map((chip) => ({ ...chip, active: chip.id === chipId && !chip.active })),
    }));
  };

  return (
    <div>
      <DropdownMenuHeader>{columnLabel(column)} 필터 선택</DropdownMenuHeader>
      <ColumnMenuOption label="전체" checked={current === "all" && !activeCustomId} onClick={() => setBasic("all")} />
      <DropdownMenuSeparator />
      <ColumnMenuOption label="NG" checked={(current === "all" || current === "o") && !activeCustomId} onClick={() => setBasic("o")} />
      <ColumnMenuOption label="OK" checked={(current === "all" || current === "x") && !activeCustomId} onClick={() => setBasic("x")} />
      {visibleCustomChips.length > 0 ? <DropdownMenuSeparator /> : null}
      {visibleCustomChips.map((chip) => (
        <ColumnMenuOption key={chip.id} label={chip.name} suffix="커스텀" checked={activeCustomId === chip.id} onClick={() => selectCustom(chip.id)} />
      ))}
    </div>
  );
}

function BatchStatusColumnMenu({ runtime }: { runtime: WorkspaceRuntime }) {
  const filter = runtime.getState("batch").batchFilter;
  const toggle = (key: "includeUnchecked" | "includeEdited" | "includeChecked", checked: boolean) => {
    runtime.setBatchFilter({ [key]: checked } as Partial<typeof filter>);
  };
  const allChecked = filter.includeUnchecked && filter.includeEdited && filter.includeChecked;

  return (
    <div>
      <DropdownMenuHeader>검수 상태 선택</DropdownMenuHeader>
      <ColumnMenuOption label="전체" checked={allChecked} onClick={() => runtime.setBatchFilter({ includeUnchecked: true, includeEdited: true, includeChecked: true })} />
      <DropdownMenuSeparator />
      <ColumnMenuOption label="검수전" checked={filter.includeUnchecked} onClick={() => toggle("includeUnchecked", !filter.includeUnchecked)} />
      <ColumnMenuOption label="수정됨" checked={filter.includeEdited} onClick={() => toggle("includeEdited", !filter.includeEdited)} />
      <ColumnMenuOption label="검수됨" checked={filter.includeChecked} onClick={() => toggle("includeChecked", !filter.includeChecked)} />
    </div>
  );
}

type BatchReplaceMode = "bulk" | "single";
type BatchReplaceScopes = {
  visible: boolean;
  checked: boolean;
  displayed: boolean;
};

function BatchTranscriptReplaceDialog({
  allRows,
  displayedRows,
  visibleRows,
  rowChecks,
  sheets,
  activeSheetId,
  defaultTimelineScoreThreshold,
  onSelectSheet,
  onApply,
  onClose,
  initialState,
  onStateChange,
}: {
  allRows: DataTableRow[];
  displayedRows: DataTableRow[];
  visibleRows: DataTableRow[];
  rowChecks: Record<string, boolean>;
  sheets: Array<{ id: string; label: string }>;
  activeSheetId?: string;
  defaultTimelineScoreThreshold: number;
  onSelectSheet: (sheetId: string) => void;
  onApply: (rowId: string, value: string) => void;
  onClose: () => void;
  initialState?: PersistedBatchReplaceState;
  onStateChange?: (state: PersistedBatchReplaceState) => void;
}) {
  const [mode, setMode] = useState<BatchReplaceMode>(() => initialState?.mode ?? "bulk");
  const [scopes, setScopes] = useState<BatchReplaceScopes>(() => initialState?.scopes ?? { visible: false, checked: false, displayed: true });
  const [query, setQuery] = useState(() => initialState?.query ?? "");
  const [replacement, setReplacement] = useState(() => initialState?.replacement ?? "");
  const [caseSensitive, setCaseSensitive] = useState(() => initialState?.caseSensitive ?? false);
  const [wholeWord, setWholeWord] = useState(() => initialState?.wholeWord ?? false);
  const [timelineScoreFilterEnabled, setTimelineScoreFilterEnabled] = useState(() => initialState?.timelineScoreFilterEnabled ?? false);
  const [timelineScoreThreshold, setTimelineScoreThreshold] = useState(() => {
    const persistedThreshold = initialState?.timelineScoreThreshold;
    return Math.max(0, persistedThreshold !== undefined && persistedThreshold >= 0 ? persistedThreshold : defaultTimelineScoreThreshold);
  });
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>(() => initialState?.selectedIds ?? {});

  const scopedRows = useMemo(() => {
    const displayedIds = new Set(displayedRows.map((row) => row.id));
    const visibleIds = new Set(visibleRows.map((row) => row.id));
    return allRows.filter((row) => {
      if (scopes.displayed && !displayedIds.has(row.id)) {
        return false;
      }
      if (scopes.visible && !visibleIds.has(row.id)) {
        return false;
      }
      if (scopes.checked && rowChecks[row.id] === false) {
        return false;
      }
      return true;
    });
  }, [allRows, displayedRows, visibleRows, rowChecks, scopes]);
  const matches = useMemo(
    () =>
      scopedRows
        .map((row) =>
          buildBatchReplaceMatch(row, query, replacement, {
            caseSensitive,
            wholeWord,
            timelineScoreFilterEnabled,
            timelineScoreThreshold,
          }),
        )
        .filter((match): match is BatchReplaceMatch => Boolean(match)),
    [caseSensitive, query, replacement, scopedRows, timelineScoreFilterEnabled, timelineScoreThreshold, wholeWord],
  );
  const matchByRowId = useMemo(() => new Map(matches.map((match) => [match.row.id, match])), [matches]);
  const resultTable = useMemo(
    () => ({
      columns: [
        { key: "index", label: "ID" },
        { key: "fileName", label: "파일명" },
        { key: "preview", label: "미리보기" },
        { key: "action", label: "작업" },
      ],
      rows: matches.map((match) => ({
        id: match.row.id,
        cells: {
          index: match.row.cells.index || match.row.id,
          fileName: rowFileNameForBatch(match.row),
          preview: "미리보기",
          action: "작업",
        },
        sourcePath: match.row.sourcePath,
        raw: match.row.raw,
      })),
    }),
    [matches],
  );
  const activeIds = matches.filter((match) => selectedIds[match.row.id] !== false).map((match) => match.row.id);

  useEffect(() => {
    setSelectedIds((current) => ({
      ...Object.fromEntries(matches.map((match) => [match.row.id, current[match.row.id] !== false])),
    }));
  }, [matches]);
  useEffect(() => {
    setSelectedIds({});
  }, [activeSheetId, caseSensitive, query, replacement, scopes, timelineScoreFilterEnabled, timelineScoreThreshold, wholeWord]);

  useEffect(() => {
    onStateChange?.({
      mode,
      scopes,
      query,
      replacement,
      caseSensitive,
      wholeWord,
      timelineScoreFilterEnabled,
      timelineScoreThreshold,
      selectedIds,
    });
  }, [caseSensitive, mode, onStateChange, query, replacement, scopes, selectedIds, timelineScoreFilterEnabled, timelineScoreThreshold, wholeWord]);

  const applyRows = (rowIds: string[]) => {
    const targets = new Set(rowIds);
    for (const match of matches) {
      if (targets.has(match.row.id)) {
        onApply(match.row.id, match.after);
      }
    }
  };
  return createPortal(
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={menuMotion.transition} className="fixed inset-0 z-[1200] flex items-center justify-center bg-[#05080dcc] px-6 py-6">
	      <motion.div {...dialogPanelMotion} className="flex h-[min(780px,calc(100vh-48px))] w-[min(1240px,calc(100vw-48px))] min-h-0 flex-col rounded-[5px] border border-[var(--panel-stroke)] bg-[var(--panel-bg)] p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-[5px] bg-[var(--table-header-bg)] text-[var(--primary-text)]">
              <Search className="size-4" strokeWidth={1.8} />
            </span>
            <h4 className="min-w-0 truncate text-base font-normal leading-5 text-[var(--primary-text)]">내용 검색 및 바꾸기</h4>
          </div>
          <motion.button type="button" onClick={onClose} whileTap={tightPressTap} className="flex size-8 items-center justify-center rounded-[5px] bg-[var(--table-header-bg)] text-[var(--primary-text)]" aria-label="닫기">
            <X className="size-4" />
          </motion.button>
        </div>

	        <div className="grid min-h-0 flex-1 grid-cols-[322px_16px_minmax(0,1fr)]">
	          <div className="flex min-h-0 flex-col rounded-[5px] border border-[var(--panel-stroke)] bg-transparent p-5">
	            <div className="border-b border-[var(--panel-stroke)]">
	              <div className="grid grid-cols-2">
	                <BatchReplaceTab label="일괄 수정" active={mode === "bulk"} onClick={() => setMode("bulk")} />
                <BatchReplaceTab label="개별 수정" active={mode === "single"} onClick={() => setMode("single")} />
              </div>
            </div>
	            <div className="app-scrollbar min-h-0 flex-1 overflow-auto pt-4">
	              <div className="mb-5">
	                <p className="mb-3 text-sm font-normal text-[var(--primary-text)]">검색할 내용</p>
	                <div className="relative">
	                  <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--icon-brush)]" />
	                  <input className="wpf-field h-[38px] w-full px-9 text-sm outline-none" placeholder="검색할 내용을 입력하세요." value={query} onChange={(event) => setQuery(event.target.value)} />
	                </div>
	              </div>

	              <div className="mb-5">
	                <p className="mb-3 text-sm font-normal text-[var(--primary-text)]">바꿀 내용</p>
	                <input className="wpf-field h-[38px] w-full px-3 text-sm outline-none" placeholder="바꿀 내용을 입력하세요." value={replacement} onChange={(event) => setReplacement(event.target.value)} />
	              </div>

	              <div className="mb-5 border-t border-[var(--panel-stroke)] pt-3">
	                <p className="mb-3 text-sm font-normal text-[var(--primary-text)]">검색 범위</p>
	                <div className="space-y-3">
	                  <BatchReplaceToggleRow label="현재 화면" checked={scopes.visible} onChange={(checked) => setScopes((current) => ({ ...current, visible: checked }))} />
                  <BatchReplaceToggleRow label="체크된 행" checked={scopes.checked} onChange={(checked) => setScopes((current) => ({ ...current, checked }))} />
                  <BatchReplaceToggleRow label="표시 내용" checked={scopes.displayed} onChange={(checked) => setScopes((current) => ({ ...current, displayed: checked }))} />
                </div>
              </div>

		              <div className="border-t border-[var(--panel-stroke)] pt-3">
		                <p className="mb-3 text-sm font-normal text-[var(--primary-text)]">옵션</p>
		                <div className="space-y-3">
                  <BatchReplaceToggleRow label="대소문자 구분" checked={caseSensitive} onChange={setCaseSensitive} />
                  <BatchReplaceToggleRow label="전체 단어 일치" checked={wholeWord} onChange={setWholeWord} />
                  <BatchReplaceScoreFilterRow
                    label="타임라인 점수 이상"
                    value={timelineScoreThreshold}
                    enabled={timelineScoreFilterEnabled}
                    onValueChange={(value) => setTimelineScoreThreshold(Math.max(0, value))}
                    onEnabledChange={setTimelineScoreFilterEnabled}
                  />
                </div>
              </div>
            </div>
            <div className="mt-4 border-t border-[var(--panel-stroke)] pt-4">
              <div className="grid grid-cols-[1fr_12px_1fr]">
            <motion.button type="button" className="wpf-primary-button text-sm font-normal" disabled={activeIds.length === 0} whileTap={activeIds.length === 0 ? undefined : tightPressTap} onClick={() => applyRows(activeIds)}>모두 바꾸기</motion.button>
                <div />
                <motion.button type="button" className="wpf-button text-sm font-normal" whileTap={tightPressTap} onClick={onClose}>취소</motion.button>
              </div>
            </div>
          </div>

          <div />

	          <div className="flex min-h-0 flex-col rounded-[5px] border border-[var(--panel-stroke)] bg-transparent p-4">
	            <div className="mb-3 flex items-center justify-between gap-3">
	              <div className="flex items-center gap-3">
	                <h5 className="text-sm font-normal leading-5 text-[var(--primary-text)]">검색 결과</h5>
	              </div>
	              <span className="text-[13px] text-[var(--secondary-text)]">현재 시트 {allRows.length}개 행</span>
	            </div>
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <DataGrid
                  table={resultTable}
                  sheets={sheets}
                  activeSheetId={activeSheetId}
                  fillRemainingColumnKey="preview"
                  onSelectSheet={onSelectSheet}
                  rowChecks={selectedIds}
                  onToggleRowCheck={(row) => setSelectedIds((current) => ({ ...current, [row.id]: current[row.id] === false }))}
                  onToggleAllRows={(checked) => setSelectedIds(Object.fromEntries(matches.map((match) => [match.row.id, checked])))}
                  onToggleRowsCheck={(checked, rowIds) => setSelectedIds((current) => ({ ...current, ...Object.fromEntries(rowIds.map((rowId) => [rowId, checked])) }))}
                  renderCell={(context) => (
                    <BatchReplaceResultCell
                      context={context}
                      match={matchByRowId.get(context.row.id)}
                      mode={mode}
                      query={query}
                      replacement={replacement}
                      caseSensitive={caseSensitive}
                      wholeWord={wholeWord}
                      onApply={applyRows}
                    />
                  )}
                  emptyText="검색 결과가 없습니다."
                />
              </div>
	          </div>
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}

function BatchReplaceTab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <MotionUnderlineTab label={label} active={active} onClick={onClick} className="px-4 pb-2 pt-0" underlineId="batch-replace-mode-tabs" />
  );
}

function BatchReplaceToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
      <span className="min-w-0 whitespace-normal break-words text-[13px] leading-[18px] text-[var(--secondary-text)]">{label}</span>
      <ToggleSwitch checked={checked} onChange={onChange} />
    </div>
  );
}

function BatchReplaceScoreFilterRow({
  label,
  value,
  enabled,
  onValueChange,
  onEnabledChange,
}: {
  label: string;
  value: number;
  enabled: boolean;
  onValueChange: (value: number) => void;
  onEnabledChange: (checked: boolean) => void;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(88px,116px)_auto] items-stretch gap-3">
      <span className="flex min-w-0 items-center whitespace-normal break-words text-[13px] leading-[18px] text-[var(--secondary-text)]">{label}</span>
      <NumericField value={value} min={0} step={0.01} onChange={onValueChange} ariaLabel={label} />
      <div className="flex items-center justify-end">
        <ToggleSwitch checked={enabled} onChange={onEnabledChange} />
      </div>
    </div>
  );
}

function BatchReplaceResultCell({
  context,
  match,
  mode,
  query,
  replacement,
  caseSensitive,
  wholeWord,
  onApply,
}: {
  context: CellRenderContext;
  match?: BatchReplaceMatch;
  mode: BatchReplaceMode;
  query: string;
  replacement: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  onApply: (rowIds: string[]) => void;
}) {
  const { column, value, row } = context;
  if (column.key === "fileName") {
    return <div className="truncate font-normal leading-5">{value || "-"}</div>;
  }

  if (column.key === "preview" && match) {
    return (
      <div className="my-2 rounded-[5px] border border-[var(--panel-stroke)] bg-[var(--field-bg)] p-3">
        <p className="mb-1 text-[13px] font-normal leading-[18px] text-[var(--secondary-text)]">변경 전</p>
        <p className="line-clamp-2 text-sm leading-5">{highlightReplaceText(match.before, query, { caseSensitive, wholeWord, className: "text-[#ff8c96] font-normal", ranges: match.ranges })}</p>
        <div className="my-2 h-px bg-[var(--panel-stroke)]" />
        <p className="mb-1 text-[13px] font-normal leading-[18px] text-[var(--secondary-text)]">변경 후</p>
        <p className="line-clamp-2 text-sm leading-5">{highlightReplaceText(match.after, replacement, { caseSensitive, wholeWord: false, className: "text-[#8ee36f] font-normal" })}</p>
      </div>
    );
  }

  if (column.key === "action") {
    return (
      <motion.button type="button" whileTap={mode === "single" ? tightPressTap : undefined} className="mx-auto flex size-9 items-center justify-center rounded-[5px] border border-[var(--panel-stroke)] bg-[var(--table-header-bg)] text-[var(--primary-text)] disabled:opacity-45" disabled={mode !== "single"} onClick={() => onApply([row.id])} aria-label="개별 적용">
        <Pencil className="size-4" strokeWidth={1.8} />
      </motion.button>
    );
  }

  return <div className="max-h-full overflow-hidden truncate whitespace-nowrap leading-5">{value || "-"}</div>;
}

type BatchReplaceMatch = {
  row: DataTableRow;
  before: string;
  after: string;
  ranges: BatchReplaceTextRange[];
};

type BatchReplaceTextRange = {
  start: number;
  end: number;
  text: string;
  score: number | null;
};

type BatchReplaceOptions = {
  caseSensitive: boolean;
  wholeWord: boolean;
  timelineScoreFilterEnabled: boolean;
  timelineScoreThreshold: number;
};

type BatchTimelineScoreSpan = {
  start: number;
  end: number;
  score: number;
};

function buildBatchReplaceMatch(row: DataTableRow, query: string, replacement: string, options: BatchReplaceOptions): BatchReplaceMatch | null {
  const before = row.cells.editedTranscript || row.raw?.editedTranscript || row.raw?.edited_transcript || "";
  const pattern = query.trim();
  if (!pattern) {
    return null;
  }

  const flags = options.caseSensitive ? "g" : "gi";
  const source = escapeRegExp(pattern);
  const bounded = options.wholeWord ? `\\b${source}\\b` : source;
  let regex: RegExp;
  try {
    regex = new RegExp(bounded, flags);
  } catch {
    return null;
  }

  const ranges = collectBatchReplaceRanges(row, before, regex, options);
  if (ranges.length === 0) {
    return null;
  }

  return { row, before, after: replaceBatchRanges(before, ranges, replacement), ranges };
}

function collectBatchReplaceRanges(row: DataTableRow, text: string, regex: RegExp, options: BatchReplaceOptions): BatchReplaceTextRange[] {
  const scoreSpans = options.timelineScoreFilterEnabled ? buildBatchTimelineScoreSpans(row, text, options.caseSensitive) : [];
  const ranges: BatchReplaceTextRange[] = [];
  regex.lastIndex = 0;

  for (const match of text.matchAll(regex)) {
    const start = match.index ?? 0;
    const matchText = match[0] ?? "";
    const end = start + matchText.length;
    if (!matchText || end <= start) {
      continue;
    }

    const score = options.timelineScoreFilterEnabled ? resolveTimelineScoreForRange(scoreSpans, start, end) : null;
    if (options.timelineScoreFilterEnabled && (score == null || score < options.timelineScoreThreshold)) {
      continue;
    }

    ranges.push({ start, end, text: matchText, score });
  }

  return ranges;
}

function buildBatchTimelineScoreSpans(row: DataTableRow, transcript: string, caseSensitive: boolean): BatchTimelineScoreSpan[] {
  const words = readBatchWords(row);
  const searchText = caseSensitive ? transcript : transcript.toLowerCase();
  const spans: BatchTimelineScoreSpan[] = [];
  let cursor = 0;

  for (const word of words) {
    const score = finiteScore(word);
    if (score == null) {
      continue;
    }

    const span = findBatchWordSpan(batchWordTextCandidates(word), searchText, cursor, caseSensitive);
    if (!span) {
      continue;
    }

    spans.push({ ...span, score });
    cursor = span.end;
  }

  return spans;
}

function batchWordTextCandidates(word: BatchWordAlignment): string[] {
  return Array.from(new Set([word.original, word.normalized].map((value) => (value || "").trim()).filter(Boolean)));
}

function findBatchWordSpan(tokens: string[], searchText: string, cursor: number, caseSensitive: boolean): { start: number; end: number } | null {
  for (const token of tokens) {
    const searchableToken = caseSensitive ? token : token.toLowerCase();
    const start = searchText.indexOf(searchableToken, cursor);
    if (start >= 0) {
      return { start, end: start + searchableToken.length };
    }
  }

  return null;
}

function finiteScore(word: BatchWordAlignment): number | null {
  const score = Number(word.score);
  return Number.isFinite(score) ? score : null;
}

function resolveTimelineScoreForRange(spans: BatchTimelineScoreSpan[], start: number, end: number): number | null {
  if (spans.length === 0) {
    return null;
  }

  const touched = new Set<BatchTimelineScoreSpan>();
  for (const span of spans) {
    if (span.start < end && span.end > start) {
      touched.add(span);
    }
  }
  addGapBoundarySpans(spans, start, touched);
  addGapBoundarySpans(spans, end, touched);

  if (touched.size === 0) {
    return null;
  }

  return Math.min(...[...touched].map((span) => span.score));
}

function addGapBoundarySpans(spans: BatchTimelineScoreSpan[], position: number, touched: Set<BatchTimelineScoreSpan>): void {
  let left: BatchTimelineScoreSpan | undefined;
  let right: BatchTimelineScoreSpan | undefined;
  for (const span of spans) {
    if (span.end <= position) {
      left = span;
      continue;
    }

    if (span.start >= position) {
      right = span;
    }
    break;
  }

  if (!left || !right || left.end >= right.start || position <= left.end || position >= right.start) {
    return;
  }

  touched.add(left);
  touched.add(right);
}

function replaceBatchRanges(text: string, ranges: BatchReplaceTextRange[], replacement: string): string {
  const parts: string[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start < cursor) {
      continue;
    }
    parts.push(text.slice(cursor, range.start), replacement);
    cursor = range.end;
  }
  parts.push(text.slice(cursor));
  return parts.join("");
}

function highlightReplaceText(text: string, pattern: string, options: { caseSensitive: boolean; wholeWord: boolean; className: string; ranges?: BatchReplaceTextRange[] }): ReactNode {
  const value = text || "-";
  if (options.ranges) {
    return highlightTextRanges(value, options.ranges, options.className);
  }

  const trimmedPattern = pattern.trim();
  if (!trimmedPattern) {
    return value;
  }

  const flags = options.caseSensitive ? "g" : "gi";
  const source = options.wholeWord ? `\\b${escapeRegExp(trimmedPattern)}\\b` : escapeRegExp(trimmedPattern);
  let regex: RegExp;
  try {
    regex = new RegExp(source, flags);
  } catch {
    return value;
  }

  const parts: ReactNode[] = [];
  let lastIndex = 0;
  for (const match of value.matchAll(regex)) {
    const index = match.index ?? 0;
    const matchText = match[0];
    if (!matchText) {
      continue;
    }
    if (index > lastIndex) {
      parts.push(value.slice(lastIndex, index));
    }
    parts.push(
      <span key={`${index}-${matchText}`} className={options.className}>
        {matchText}
      </span>,
    );
    lastIndex = index + matchText.length;
  }
  if (lastIndex < value.length) {
    parts.push(value.slice(lastIndex));
  }

  return parts.length > 0 ? parts : value;
}

function highlightTextRanges(text: string, ranges: BatchReplaceTextRange[], className: string): ReactNode {
  if (ranges.length === 0) {
    return text;
  }

  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start < cursor) {
      continue;
    }
    if (range.start > cursor) {
      parts.push(text.slice(cursor, range.start));
    }
    parts.push(
      <span key={`${range.start}-${range.end}`} className={className}>
        {text.slice(range.start, range.end)}
      </span>,
    );
    cursor = range.end;
  }
  if (cursor < text.length) {
    parts.push(text.slice(cursor));
  }

  return parts.length > 0 ? parts : text;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function rowFileNameForBatch(row: DataTableRow): string {
  return row.cells.fileName || row.raw?.fileName || row.raw?.file_name || row.sourcePath?.split(/[\\/]/u).pop() || row.id;
}

function TaggingResultCell({ context }: { context: CellRenderContext }) {
  const { column, value } = context;
  if (column.key === "ngTags" && value && value !== "-") {
    return <div className="max-h-full overflow-hidden break-words font-semibold leading-5 text-[#ff8c96]">{value}</div>;
  }

  return <div className="max-h-full overflow-hidden truncate whitespace-nowrap leading-5">{value || "-"}</div>;
}

function BatchEditableCell({ context, runtime, currentTime, audioActive }: { context: CellRenderContext; runtime: WorkspaceRuntime; currentTime: number; audioActive: boolean }) {
  const { row, column, value, rowLineClamp, selectRow } = context;
  const speakers = collectBatchSpeakers(runtime.getState("batch").table.rows);

  if (column.key === "autoTranscript") {
    return <BatchAutoTranscriptCell row={row} value={value} rowLineClamp={rowLineClamp} currentTime={currentTime} audioActive={audioActive} showAllAlignmentOutsideSegments={runtime.settings.batch.showAllAlignmentOutsideSegments} />;
  }

  if (column.key === "editedTranscript") {
    return <BatchTranscriptCell rowId={row.id} value={value} rowLineClamp={rowLineClamp} onSelect={selectRow} onCommit={(nextValue) => runtime.editBatchCell(row.id, "editedTranscript", nextValue)} />;
  }

  if (column.key === "speaker") {
    return <BatchSpeakerCell rowId={row.id} value={value} rowLineClamp={rowLineClamp} speakers={speakers} onSelect={selectRow} onCommit={(nextValue) => runtime.editBatchCell(row.id, "speaker", nextValue)} />;
  }

  if (column.key === "qcStatus") {
    return <BatchStatusCell value={value} onSelect={selectRow} onChange={(nextValue) => runtime.editBatchCell(row.id, "qcStatus", nextValue)} />;
  }

  return rowLineClamp <= 1 ? (
    <div className="max-h-full overflow-hidden truncate whitespace-nowrap leading-5">{value || "-"}</div>
  ) : (
    <div
      className="max-h-full overflow-hidden break-words leading-5"
      style={{ display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: rowLineClamp }}
    >
      {value || "-"}
    </div>
  );
}

function BatchTranscriptCell({ rowId, value, rowLineClamp, onSelect, onCommit }: { rowId: string; value: string; rowLineClamp: number; onSelect: () => void; onCommit: (value: string) => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (document.activeElement !== ref.current && ref.current) {
      ref.current.textContent = value || "";
    }
  }, [value]);
  const commit = () => {
    const nextValue = ref.current?.textContent ?? "";
    if (nextValue !== value) {
      onCommit(nextValue);
    }
  };

  return (
    <div
      ref={ref}
      role="textbox"
      tabIndex={0}
      contentEditable
      suppressContentEditableWarning
      aria-label={`${rowId} 편집 전사`}
      onMouseDown={onSelect}
      onFocus={onSelect}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
          (event.currentTarget as HTMLDivElement).blur();
        }
        if (event.key === "Escape") {
          event.currentTarget.textContent = value || "";
          (event.currentTarget as HTMLDivElement).blur();
        }
      }}
      className={cn("max-h-full min-h-5 overflow-hidden leading-5 outline-none", rowLineClamp <= 1 ? "truncate whitespace-nowrap" : "break-words")}
      style={rowLineClamp > 1 ? { display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: rowLineClamp } : undefined}
    >
      {value || ""}
    </div>
  );
}

function BatchSpeakerCell({ rowId, value, rowLineClamp, speakers, onSelect, onCommit }: { rowId: string; value: string; rowLineClamp: number; speakers: string[]; onSelect: () => void; onCommit: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const [menuGeometry, setMenuGeometry] = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const textRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (document.activeElement !== textRef.current && textRef.current) {
      textRef.current.textContent = value || "";
    }
  }, [value]);
  useEffect(() => {
    if (!open) {
      return;
    }
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }
    setMenuGeometry({
      left: rect.left,
      top: rect.bottom + 4,
      width: Math.max(rect.width, 180),
      maxHeight: Math.max(132, Math.min(240, window.innerHeight - rect.bottom - 8)),
    });
  }, [open, speakers.length]);
  useEffect(() => {
    if (!open) {
      return;
    }
    const close = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target || rootRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const commit = () => {
    const nextValue = (textRef.current?.textContent ?? "").trim();
    if (nextValue && nextValue !== value) {
      onCommit(nextValue);
    } else {
      if (textRef.current) {
        textRef.current.textContent = value || "";
      }
    }
  };
  const chooseSpeaker = (speaker: string) => {
    if (textRef.current) {
      textRef.current.textContent = speaker;
    }
    setOpen(false);
    onCommit(speaker);
  };

  return (
    <div ref={rootRef} className="relative flex h-full min-w-0 items-center pr-6" onMouseDown={onSelect}>
      <div
        ref={textRef}
        role="textbox"
        tabIndex={0}
        contentEditable
        suppressContentEditableWarning
        aria-label={`${rowId} 화자`}
        onFocus={onSelect}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            (event.currentTarget as HTMLDivElement).blur();
          }
          if (event.key === "Escape") {
            event.currentTarget.textContent = value || "";
            (event.currentTarget as HTMLDivElement).blur();
          }
        }}
        className={cn("min-w-0 flex-1 overflow-hidden leading-5 outline-none", rowLineClamp <= 1 ? "truncate whitespace-nowrap" : "break-words")}
        style={rowLineClamp > 1 ? { display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: rowLineClamp } : undefined}
      >
        {value || ""}
      </div>
      <motion.button type="button" whileTap={tightPressTap} className="absolute right-0 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center text-[var(--control-arrow)] hover:text-[var(--primary-text)]" aria-label="화자 선택" onClick={() => setOpen((current) => !current)}>
        <ChevronGlyph direction={open ? "up" : "down"} />
      </motion.button>
      {open && menuGeometry
        ? createPortal(
            <DropdownMenuSurface
              ref={menuRef}
              className="z-[1160]"
              style={{ left: menuGeometry.left, top: menuGeometry.top, width: menuGeometry.width, maxHeight: menuGeometry.maxHeight }}
            >
              <DropdownMenuHeader>{"\ud654\uc790 \uc120\ud0dd"}</DropdownMenuHeader>
              {speakers.map((speaker) => (
                <DropdownMenuOption key={speaker} checked={speaker === value} label={speaker} onClick={() => chooseSpeaker(speaker)} />
              ))}
            </DropdownMenuSurface>,
            document.body,
          )
        : null}
    </div>
  );
}

function BatchStatusCell({ value, onSelect, onChange }: { value: string; onSelect: () => void; onChange: (value: string) => void }) {
  const status = value === "검수됨" || value === "수정됨" || value === "검수전" ? value : "검수전";
  const [open, setOpen] = useState(false);
  const [menuGeometry, setMenuGeometry] = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const options = ["검수전", "수정됨", "검수됨"];
  useEffect(() => {
    if (!open) {
      return;
    }
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }
    setMenuGeometry({
      left: rect.left,
      top: rect.bottom + 4,
      width: Math.max(rect.width, 160),
      maxHeight: 132,
    });
  }, [open]);
  useEffect(() => {
    if (!open) {
      return;
    }
    const close = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target || rootRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const chooseStatus = (nextStatus: string) => {
    setOpen(false);
    onChange(nextStatus);
  };

  return (
    <div ref={rootRef} className="relative flex h-full min-w-0 items-center pr-6" onMouseDown={onSelect}>
      <span className="min-w-0 flex-1 overflow-hidden truncate whitespace-nowrap leading-5">
        {status}
      </span>
      <motion.button type="button" whileTap={tightPressTap} className="absolute right-0 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center text-[var(--control-arrow)] hover:text-[var(--primary-text)]" aria-label="검수 상태 선택" onClick={() => setOpen((current) => !current)}>
        <ChevronGlyph direction={open ? "up" : "down"} />
      </motion.button>
      {open && menuGeometry
        ? createPortal(
            <DropdownMenuSurface
              ref={menuRef}
              className="z-[1160]"
              style={{ left: menuGeometry.left, top: menuGeometry.top, width: menuGeometry.width, maxHeight: menuGeometry.maxHeight }}
            >
              <DropdownMenuHeader>{"\uac80\uc218 \uc0c1\ud0dc \uc120\ud0dd"}</DropdownMenuHeader>
              {options.map((option) => (
                <DropdownMenuOption key={option} checked={option === status} label={option} onClick={() => chooseStatus(option)} />
              ))}
            </DropdownMenuSurface>,
            document.body,
          )
        : null}
    </div>
  );
}

function ColumnMenuOption({ label, checked, suffix, onClick }: { label: string; checked: boolean; suffix?: string; onClick: () => void }) {
  return <DropdownMenuOption label={label} checked={checked} suffix={suffix} onClick={onClick} />;
}

function columnLabel(column: OverviewMetricColumn): string {
  switch (column) {
    case "noise_bak":
      return "BAK";
    case "noise_sig":
      return "SIG";
    case "noise_ovrl":
      return "OVRL";
    case "noise_p808_mos":
      return "P808";
    default:
      return column;
  }
}
