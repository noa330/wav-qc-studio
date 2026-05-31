import { useEffect, useMemo, useState } from "react";
import { useRef, type CSSProperties } from "react";
import { Compass, Download, Moon, PanelLeftClose, PanelLeftOpen, Play, RotateCcw, Square, Sun, Terminal } from "lucide-react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { AppCompositionRoot } from "@/app/AppCompositionRoot";
import { AppTour } from "@/app/AppTour";
import { createGuideRuntime } from "@/app/app-guide-runtime";
import { useAppPersistence } from "@/app/app-persistence";
import { useTheme } from "@/app/theme-provider";
import { appTourSteps } from "@/app/app-tour-steps";
import { createWorkspaceTransitionSurfaceHtml } from "@/app/workspace-transition-surface";
import { cn } from "@/lib/utils";
import { pressTap, quickEase, softPressTap, tightPressTap, uiSpring } from "@/shared/motion";
import { defaultWorkspaceId, workspaces, type WorkspaceDefinition } from "@/features/workspaces/model/workspace-config";
import { useWorkspaceRuntime } from "@/features/workspaces/state/use-workspace-runtime";
import { useWorkspaceAudioSync } from "@/features/workspaces/ui/shared/workspace-audio-sync";
import { WorkspaceFloatingAudioPlayer } from "@/features/workspaces/ui/shared/WorkspaceFloatingAudioPlayer";
import { WorkspaceFrame } from "@/features/workspaces/ui/frame/WorkspaceFrame";
import { createWorkspaceHeaderStatusItems, useCompactWorkspaceHeader } from "@/features/workspaces/ui/frame/WorkspaceStatusWidget";
import { ProjectSelector } from "@/features/workspaces/ui/shared/WorkspaceProjectSelector";
import type { WorkspaceId } from "@shared/ipc";

type WorkspaceTransitionRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type WorkspaceTransitionCardVariant = "full" | "horizontal" | "vertical" | "compact";

type WorkspaceTransitionCardSnapshot = {
  layoutId: string;
  variant: WorkspaceTransitionCardVariant;
  rect: WorkspaceTransitionRect;
  surfaceHtml: string;
};

type WorkspaceTransitionCard = {
  layoutId: string;
  variant: WorkspaceTransitionCardVariant;
  source: WorkspaceTransitionRect;
  target: WorkspaceTransitionRect;
  surfaceHtml: string;
  entering: boolean;
  exiting: boolean;
};

type WorkspaceTransitionState = {
  id: number;
  animating: boolean;
  cards: WorkspaceTransitionCard[];
};

const workspaceTransitionDurationMs = 280;
const workspaceTransitionSettleFrames = 3;

export function AppShell() {
  return (
    <MotionConfig reducedMotion="user" transition={uiSpring}>
      <AppCompositionRoot>
        <AppShellContent />
      </AppCompositionRoot>
    </MotionConfig>
  );
}

function AppShellContent() {
  const persistence = useAppPersistence();
  const { theme, toggleTheme } = useTheme();
  const initialShellStateRef = useRef(persistence.initialState.shell);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<WorkspaceId>(initialShellStateRef.current.selectedWorkspaceId);
  const [appTourOpen, setAppTourOpen] = useState(false);
  const [appTourStepIndex, setAppTourStepIndex] = useState(0);
  const [sidebarCollapsedByUser, setSidebarCollapsedByUser] = useState(initialShellStateRef.current.sidebarCollapsedByUser);
  const [guideAutoShown, setGuideAutoShown] = useState(initialShellStateRef.current.guideAutoShown);
  const [autoSidebarCollapsed, setAutoSidebarCollapsed] = useState(false);
  const [workspaceTransition, setWorkspaceTransition] = useState<WorkspaceTransitionState | null>(null);
  const [terminalDockOpen, setTerminalDockOpen] = useState(false);
  const [terminalBubblePinned, setTerminalBubblePinned] = useState(true);
  const workspaceTransitionIdRef = useRef(0);
  const initialGuideHandledRef = useRef(false);
  const runtime = useWorkspaceRuntime();
  const clickCountRef = useRef(0);
  const lastClickTimeRef = useRef(0);
  const [menuBarVisible, setMenuBarVisible] = useState(false);

  const handleTitleClick = () => {
    const now = Date.now();
    if (now - lastClickTimeRef.current < 500) {
      clickCountRef.current += 1;
    } else {
      clickCountRef.current = 1;
    }
    lastClickTimeRef.current = now;

    if (clickCountRef.current === 5) {
      clickCountRef.current = 0;
      const nextVisible = !menuBarVisible;
      setMenuBarVisible(nextVisible);
      window.studioShell.setMenuBarVisibility(nextVisible);
    }
  };
  const compactHeader = useCompactWorkspaceHeader();
  const activeTourStep = appTourOpen ? appTourSteps[appTourStepIndex] : undefined;
  const visibleWorkspaceId = activeTourStep?.workspaceId ?? selectedWorkspaceId;
  const visibleRuntime = useMemo(() => (activeTourStep ? createGuideRuntime(runtime, activeTourStep) : runtime), [activeTourStep, runtime]);
  const selectedWorkspace = useMemo<WorkspaceDefinition>(
    () => workspaces.find((workspace) => workspace.id === visibleWorkspaceId) ?? workspaces[0],
    [visibleWorkspaceId],
  );
  const selectedState = visibleRuntime.getState(visibleWorkspaceId);
  const canRun = visibleRuntime.canRun(visibleWorkspaceId);
  const canRetry = visibleRuntime.canRetry(visibleWorkspaceId);
  const canExport = visibleRuntime.canExport(visibleWorkspaceId);
  const isRunning = selectedState.isRunning;
  const isExporting = selectedState.isExporting;
  const isBusy = selectedState.isRunning || selectedState.isExporting || selectedState.isBatchSpeakerRunning;
  const progressPercent = Math.max(0, Math.min(100, Math.round(selectedState.progressPercent)));
  const sidebarCollapsed = sidebarCollapsedByUser || autoSidebarCollapsed;
  const sidebarWidth = sidebarCollapsed ? 56 : 240;
  const sidebarGap = sidebarCollapsed ? 10 : 14;
  const statusItems = createWorkspaceHeaderStatusItems(selectedState);
  const syncState = useWorkspaceAudioSync(visibleWorkspaceId);
  const isFloatingPlayerVisible = useMemo(() => {
    const isSupported = visibleWorkspaceId === "tagging" || visibleWorkspaceId === "batch";
    const hasAudio = Boolean(selectedState.selectedAudioPath || syncState.audioPath);
    if (!isSupported || !hasAudio) return false;

    if (!syncState.activeTabId) return false; // Default to active (hidden player)
    if (visibleWorkspaceId === "tagging") {
      return syncState.activeTabId === "tagging-queue";
    }
    if (visibleWorkspaceId === "batch") {
      return syncState.activeTabId === "batch-timeline";
    }
    return false;
  }, [visibleWorkspaceId, selectedState.selectedAudioPath, syncState.audioPath, syncState.activeTabId]);
  const projectSwitchingDisabled = useMemo(() => {
    if (visibleRuntime.guideMode) return true;
    return workspaces.some((definition) => {
      const workspaceState = visibleRuntime.getState(definition.id);
      return workspaceState.isRunning || workspaceState.isExporting || workspaceState.isBatchSpeakerRunning || visibleRuntime.isVoiceModelRuntimeInstalling(definition.id);
    });
  }, [visibleRuntime]);

  useEffect(() => {
    const updateSidebarMode = () => {
      setAutoSidebarCollapsed(window.innerWidth < 1410);
    };
    updateSidebarMode();
    window.addEventListener("resize", updateSidebarMode);
    return () => window.removeEventListener("resize", updateSidebarMode);
  }, []);

  useEffect(() => {
    persistence.recordShellSnapshot({
      selectedWorkspaceId,
      sidebarCollapsedByUser,
      guideAutoShown,
      theme,
    });
  }, [guideAutoShown, persistence, selectedWorkspaceId, sidebarCollapsedByUser, theme]);

  useEffect(() => {
    if (initialShellStateRef.current.guideAutoShown || initialGuideHandledRef.current) {
      return undefined;
    }

    initialGuideHandledRef.current = true;
    setGuideAutoShown(true);
    const timer = window.setTimeout(() => {
      setAppTourStepIndex(0);
      setAppTourOpen(true);
    }, 360);
    return () => window.clearTimeout(timer);
  }, []);

  const selectWorkspace = (workspaceId: WorkspaceId) => {
    if (appTourOpen) return;
    if (workspaceId === selectedWorkspaceId) return;
    if (workspaceTransition) return;

    const sourceCards = readWorkspaceTransitionCards();
    if (sourceCards.length === 0) {
      setSelectedWorkspaceId(workspaceId);
      return;
    }

    const transitionId = workspaceTransitionIdRef.current + 1;
    workspaceTransitionIdRef.current = transitionId;
    setWorkspaceTransition({
      id: transitionId,
      animating: false,
      cards: sourceCards.map((card) => ({
        layoutId: card.layoutId,
        variant: card.variant,
        source: card.rect,
        target: card.rect,
        surfaceHtml: card.surfaceHtml,
        entering: false,
        exiting: false,
      })),
    });
    setSelectedWorkspaceId(workspaceId);

    afterAnimationFrames(workspaceTransitionSettleFrames, () => {
      if (workspaceTransitionIdRef.current !== transitionId) return;

      const targetCards = readWorkspaceTransitionCards();
      setWorkspaceTransition({
        id: transitionId,
        animating: true,
        cards: resolveWorkspaceTransitionCards(sourceCards, targetCards),
      });
      window.setTimeout(() => {
        if (workspaceTransitionIdRef.current === transitionId) {
          setWorkspaceTransition(null);
        }
      }, workspaceTransitionDurationMs + 80);
    });
  };

  const openGuide = () => {
    setAppTourStepIndex(0);
    setAppTourOpen(true);
  };

  const closeGuide = () => {
    setAppTourOpen(false);
    setAppTourStepIndex(0);
  };

  const handleToggleTerminal = () => {
    setTerminalDockOpen((current) => {
      const next = !current;
      if (next) setTerminalBubblePinned(true);
      return next;
    });
  };

  return (
    <main className={cn("flex h-screen flex-col overflow-hidden bg-[var(--window-background)] text-[var(--primary-text)]", workspaceTransition && "workspace-transition-active")}>
      {/* ── 상단바: 전체 너비, 사이드바와 동일 배경 ── */}
      {!compactHeader ? (
        <header
          className="flex py-[15px] shrink-0 items-center border-b border-[var(--panel-stroke)] bg-[var(--shell-chrome-card-bg)]"
          data-app-tour-target="workspace-header"
        >
          {/* 사이드바 너비만큼 앱 타이틀 + 토글 영역 */}
          <div
            className={cn(
              "flex shrink-0 items-center",
              sidebarCollapsed ? "w-[56px] justify-center px-2" : "justify-between gap-2 px-4",
            )}
            style={{ width: sidebarWidth }}
          >
            <AnimatePresence initial={false}>
              {sidebarCollapsed ? null : (
                <motion.h1
                  key="app-title"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={quickEase}
                  className="min-w-0 truncate text-xl font-bold text-[var(--primary-text)] cursor-pointer select-none"
                  onClick={handleTitleClick}
                >
                  WAV QC Studio
                </motion.h1>
              )}
            </AnimatePresence>
            <motion.button
              type="button"
              className="flex size-8 shrink-0 items-center justify-center rounded-[4px] text-[var(--primary-text)] hover:bg-[var(--soft-selection-hover)]"
              aria-label={sidebarCollapsed ? "왼쪽 탭 펼치기" : "왼쪽 탭 접기"}
              onClick={() => setSidebarCollapsedByUser((current) => !current)}
              whileTap={tightPressTap}
            >
              {sidebarCollapsed ? <PanelLeftOpen className="size-4" strokeWidth={1.8} /> : <PanelLeftClose className="size-4" strokeWidth={1.8} />}
            </motion.button>
          </div>

          {/* gap 영역 */}
          <div style={{ width: sidebarGap }} className="shrink-0" aria-hidden="true" />

          {/* 상단바 콘텐츠 */}
          <div className="flex min-w-0 flex-1 items-center pl-[4px] pr-8">
            <ProjectSelector disabled={projectSwitchingDisabled} />
            <span className="mx-[18px] h-4 w-px shrink-0 bg-[var(--panel-stroke)] opacity-85" />
            {isBusy ? (
              <>
                <div className="mr-3 h-2 w-[120px] overflow-hidden rounded bg-[var(--slider-rail)]">
                  <div className="h-full rounded bg-[var(--accent-blue)] transition-[width] duration-300" style={{ width: `${progressPercent}%` }} />
                </div>
                <span className="mr-3 min-w-[38px] text-right text-sm font-normal text-[var(--primary-text)]">{progressPercent}%</span>
                <span className="mr-[18px] h-4 w-px shrink-0 bg-[var(--panel-stroke)] opacity-85" />
              </>
            ) : null}
            {statusItems.map((item, index) => (
              <div key={item.label} className="flex items-center">
                {index > 0 ? <span className="mx-[18px] h-4 w-px bg-[var(--panel-stroke)] opacity-85" /> : null}
                <span className="mr-2 text-sm font-normal text-[var(--secondary-text)]">{item.label}</span>
                <span className="max-w-36 truncate text-sm font-normal tabular-nums text-[var(--primary-text)]">{item.value}</span>
              </div>
            ))}
            <div className="ml-auto flex items-center gap-4">
              {/* Retry 버튼 */}
              {(canRetry || selectedState.table.rows.length > 0 || selectedState.lastRun) ? (
                <motion.button
                  type="button"
                  disabled={!canRetry}
                  onClick={() => void visibleRuntime.retry(visibleWorkspaceId)}
                  className={cn("wpf-button flex h-[38px] items-center gap-2 px-3 text-[13px]", !canRetry && "opacity-40")}
                  aria-label="다시 실행"
                  whileTap={canRetry ? softPressTap : undefined}
                >
                  <RotateCcw className="size-3.5" strokeWidth={1.7} />
                  RETRY
                </motion.button>
              ) : null}
              {/* Run Processing 버튼 */}
              <motion.button
                type="button"
                disabled={!isRunning && !canRun}
                onClick={() => void (isRunning ? visibleRuntime.cancelWorkspace(visibleWorkspaceId) : visibleRuntime.run(visibleWorkspaceId))}
                className={cn(
                  "flex h-[38px] items-center gap-2 px-3 text-[13px]",
                  isRunning ? "wpf-danger-button" : "wpf-primary-button",
                  !isRunning && !canRun && "opacity-40",
                )}
                aria-label={isRunning ? "실행 중지" : "Run Processing"}
                whileTap={isRunning || canRun ? pressTap : undefined}
              >
                {isRunning
                  ? <Square className="size-3.5" fill="currentColor" strokeWidth={1.7} />
                  : <Play className="size-3.5" fill="currentColor" />}
                {isRunning ? "STOP" : "Run Processing"}
              </motion.button>
              {/* Export 버튼 */}
              <motion.button
                type="button"
                disabled={!isExporting && !canExport}
                onClick={() => void (isExporting ? visibleRuntime.cancelWorkspace(visibleWorkspaceId) : visibleRuntime.exportWorkspace(visibleWorkspaceId))}
                className={cn(
                  "wpf-button flex h-[38px] items-center gap-2 px-3 text-[13px]",
                  isExporting ? "wpf-danger-button" : "wpf-button",
                  !isExporting && !canExport && "opacity-40",
                )}
                aria-label={isExporting ? "내보내기 중지" : "내보내기"}
                whileTap={isExporting || canExport ? pressTap : undefined}
              >
                {isExporting
                  ? <Square className="size-3.5" fill="currentColor" strokeWidth={1.7} />
                  : <Download className="size-3.5" strokeWidth={1.7} />}
                {isExporting ? "STOP" : "Export Results"}
              </motion.button>
              {/* 터미널 이모지 버튼 */}
              <motion.button
                type="button"
                onClick={handleToggleTerminal}
                whileTap={softPressTap}
                data-app-tour-target="workspace-console-button"
                className="flex size-[38px] items-center justify-center rounded-[4px] hover:bg-[var(--soft-selection-hover)] text-[var(--primary-text)]"
                aria-label={terminalDockOpen ? "콘솔 닫기" : "콘솔 열기"}
                title={terminalDockOpen ? "콘솔 닫기" : "콘솔 열기"}
              >
                <Terminal className="size-[18px]" strokeWidth={1.8} />
              </motion.button>
              {/* 가이드 이모지 버튼 */}
              <motion.button
                type="button"
                onClick={openGuide}
                className="flex size-[38px] items-center justify-center rounded-[4px] hover:bg-[var(--soft-selection-hover)] text-[var(--primary-text)]"
                aria-label="기능 가이드 열기"
                data-app-tour-target="guide-button"
                whileTap={pressTap}
              >
                <Compass className="size-[18px]" strokeWidth={1.7} />
              </motion.button>
            </div>
          </div>
        </header>
      ) : null}

      {/* ── 본문: 사이드바 | gap | 콘텐츠 ── */}
      <div className="grid min-h-0 flex-1" style={{ gridTemplateColumns: `${sidebarWidth}px ${sidebarGap}px minmax(0,1fr)` }}>
        <aside
          className="flex overflow-hidden flex-col border-r border-[var(--panel-stroke)] bg-[var(--shell-chrome-card-bg)] pt-3"
          data-app-tour-target="sidebar"
        >
          <nav
            className={cn("app-scrollbar min-h-0 flex-1 overflow-y-auto pb-4", sidebarCollapsed ? "px-2" : "px-4")}
            aria-label="작업 화면"
            data-app-tour-target="workspace-nav"
          >
            <div className="space-y-2">
              {workspaces.map((workspace) => (
                <WorkspaceNavItem
                  key={workspace.id}
                  workspace={workspace}
                  selected={visibleWorkspaceId === workspace.id}
                  collapsed={sidebarCollapsed}
                  onClick={() => selectWorkspace(workspace.id)}
                />
              ))}
            </div>
          </nav>

          <div
            className={cn(sidebarCollapsed ? "mx-2 mb-4 mt-3 border-t border-[var(--panel-stroke)] pt-3 flex justify-center" : "m-4 rounded-md border border-[var(--panel-stroke)] p-[14px] flex items-center justify-between")}
            data-app-tour-target="run-controls"
          >
            {sidebarCollapsed ? (
              <motion.button
                type="button"
                onClick={toggleTheme}
                whileTap={softPressTap}
                className="flex size-8 items-center justify-center rounded-[4px] hover:bg-[var(--soft-selection-hover)] text-[var(--primary-text)]"
                aria-label={theme === "light" ? "다크 모드로 전환" : "라이트 모드로 전환"}
                title={theme === "light" ? "다크 모드" : "라이트 모드"}
              >
                {theme === "light" ? <Moon className="size-[18px]" strokeWidth={1.8} /> : <Sun className="size-[18px]" strokeWidth={1.8} />}
              </motion.button>
            ) : (
              <>
                <span className="text-[13px] font-normal text-[var(--secondary-text)]">v0.1.3</span>
                <motion.button
                  type="button"
                  onClick={toggleTheme}
                  whileTap={softPressTap}
                  className="flex size-8 items-center justify-center rounded-[4px] hover:bg-[var(--soft-selection-hover)] text-[var(--primary-text)]"
                  aria-label={theme === "light" ? "다크 모드로 전환" : "라이트 모드로 전환"}
                  title={theme === "light" ? "다크 모드" : "라이트 모드"}
                >
                  {theme === "light" ? <Moon className="size-[18px]" strokeWidth={1.8} /> : <Sun className="size-[18px]" strokeWidth={1.8} />}
                </motion.button>
              </>
            )}
          </div>
        </aside>

        <div aria-hidden="true" />

        <section className="min-h-0 min-w-0">
          <WorkspaceFrame
            key={selectedWorkspace.id}
            workspace={selectedWorkspace}
            runtime={visibleRuntime}
            terminalDockOpen={terminalDockOpen}
            terminalBubblePinned={terminalBubblePinned}
            onTerminalDockOpenChange={setTerminalDockOpen}
            onTerminalBubblePinnedChange={setTerminalBubblePinned}
          />
        </section>
      </div>

      {workspaceTransition ? <WorkspaceTransitionOverlay transition={workspaceTransition} /> : null}
      <AppTour open={appTourOpen} onClose={closeGuide} onStepChange={(stepIndex) => setAppTourStepIndex(stepIndex)} />
      <WorkspaceFloatingAudioPlayer workspaceId={visibleWorkspaceId} runtime={visibleRuntime} />
    </main>
  );
}

function WorkspaceTransitionOverlay({ transition }: { transition: WorkspaceTransitionState }) {
  return (
    <div className="workspace-transition-layer" aria-hidden="true">
      {transition.cards.map((card) => (
        <div
          key={card.layoutId}
          className={cn("workspace-transition-card", `workspace-transition-card--${card.variant}`)}
          style={workspaceTransitionCardStyle(card, transition.animating)}
        >
          <WorkspaceTransitionSurface html={card.surfaceHtml} />
        </div>
      ))}
    </div>
  );
}

function WorkspaceTransitionSurface({ html }: { html: string }) {
  return <div className="workspace-transition-surface" dangerouslySetInnerHTML={{ __html: html }} />;
}

function workspaceTransitionCardStyle(card: WorkspaceTransitionCard, animating: boolean): CSSProperties {
  const frame = animating ? card.target : card.source;
  const opacity = card.entering && !animating ? 0 : animating && card.exiting ? 0 : 1;

  return {
    left: 0,
    top: 0,
    width: frame.width,
    height: frame.height,
    opacity,
    transform: `translate3d(${frame.left}px, ${frame.top}px, 0)`,
    transitionDuration: `${workspaceTransitionDurationMs}ms, ${workspaceTransitionDurationMs}ms, ${workspaceTransitionDurationMs}ms, 160ms`,
  };
}

function readWorkspaceTransitionCards(): WorkspaceTransitionCardSnapshot[] {
  if (typeof document === "undefined") {
    return [];
  }

  return Array.from(document.querySelectorAll<HTMLElement>("[data-workspace-card-layout-id]"))
    .map((element) => {
      const layoutId = element.dataset.workspaceCardLayoutId;
      const rect = element.getBoundingClientRect();
      if (!layoutId || rect.width <= 1 || rect.height <= 1) {
        return undefined;
      }

      return {
        layoutId,
        variant: resolveWorkspaceTransitionCardVariant(element),
        rect: {
          left: Math.round(rect.left),
          top: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
        surfaceHtml: createWorkspaceTransitionSurfaceHtml(element),
      };
    })
    .filter((card): card is WorkspaceTransitionCardSnapshot => Boolean(card));
}

function resolveWorkspaceTransitionCards(sourceCards: WorkspaceTransitionCardSnapshot[], targetCards: WorkspaceTransitionCardSnapshot[]): WorkspaceTransitionCard[] {
  const sourceById = new Map(sourceCards.map((card) => [card.layoutId, card]));
  const targetById = new Map(targetCards.map((card) => [card.layoutId, card]));
  const cards: WorkspaceTransitionCard[] = sourceCards.map((source) => {
    const target = targetById.get(source.layoutId);
    return {
      layoutId: source.layoutId,
      variant: source.variant,
      source: source.rect,
      target: target?.rect ?? source.rect,
      surfaceHtml: target?.surfaceHtml ?? source.surfaceHtml,
      entering: false,
      exiting: !target,
    };
  });

  for (const target of targetCards) {
    if (sourceById.has(target.layoutId)) {
      continue;
    }
    cards.push({
      layoutId: target.layoutId,
      variant: target.variant,
      source: target.rect,
      target: target.rect,
      surfaceHtml: target.surfaceHtml,
      entering: true,
      exiting: false,
    });
  }

  return cards;
}

function resolveWorkspaceTransitionCardVariant(element: HTMLElement): WorkspaceTransitionCardVariant {
  const collapseMode = element.dataset.collapseMode;
  if (collapseMode === "horizontal" || collapseMode === "vertical" || collapseMode === "compact") {
    return collapseMode;
  }

  const rect = element.getBoundingClientRect();
  if (rect.width <= 72 && rect.height <= 72) return "compact";
  if (rect.width <= 72) return "vertical";
  if (rect.height <= 72) return "horizontal";
  return "full";
}

function afterAnimationFrames(count: number, callback: () => void): void {
  if (typeof window === "undefined" || count <= 0) {
    callback();
    return;
  }

  window.requestAnimationFrame(() => afterAnimationFrames(count - 1, callback));
}

function WorkspaceNavItem({ workspace, selected, collapsed, onClick }: { workspace: WorkspaceDefinition; selected: boolean; collapsed: boolean; onClick: () => void }) {
  const Icon = workspace.icon;

  return (
    <motion.button
      type="button"
      aria-label={workspace.navLabel}
      aria-pressed={selected}
      onClick={onClick}
      whileTap={pressTap}
      className={cn(
        "relative flex w-full items-center overflow-hidden rounded-[5px] text-left text-sm font-normal transition-colors",
        collapsed ? "justify-center px-0 py-[15px]" : "px-[16px] py-[15px]",
        selected 
          ? "bg-transparent text-[var(--accent-foreground)] font-semibold" 
          : "bg-transparent text-[var(--primary-text)] hover:bg-[var(--soft-selection-hover)]",
      )}
    >
      {selected ? <motion.span layoutId="workspace-nav-selection" className="absolute inset-0 rounded-[5px] bg-[var(--nav-selected-bg)]" /> : null}
      <Icon className={cn("relative z-10 size-5 shrink-0 transition-colors", selected ? "text-[var(--accent-foreground)]" : "text-[var(--primary-text)]")} strokeWidth={1.65} />
      {collapsed ? null : <span className="relative z-10 ml-3 min-w-0 truncate">{workspace.navLabel}</span>}
    </motion.button>
  );
}
