import { useEffect, useMemo, useState } from "react";
import { useRef, type CSSProperties } from "react";
import { Compass, Download, PanelLeftClose, PanelLeftOpen, Play, RotateCcw, Square } from "lucide-react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { AppCompositionRoot } from "@/app/AppCompositionRoot";
import { AppTour } from "@/app/AppTour";
import { createGuideRuntime } from "@/app/app-guide-runtime";
import { useAppPersistence } from "@/app/app-persistence";
import { appTourSteps } from "@/app/app-tour-steps";
import { createWorkspaceTransitionSurfaceHtml } from "@/app/workspace-transition-surface";
import { cn } from "@/lib/utils";
import { pressTap, quickEase, tightPressTap, uiSpring } from "@/shared/motion";
import { defaultWorkspaceId, workspaces, type WorkspaceDefinition } from "@/features/workspaces/model/workspace-config";
import { useWorkspaceRuntime } from "@/features/workspaces/state/use-workspace-runtime";
import { WorkspaceFrame } from "@/features/workspaces/ui/WorkspaceFrame";
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
  const initialShellStateRef = useRef(persistence.initialState.shell);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<WorkspaceId>(initialShellStateRef.current.selectedWorkspaceId);
  const [appTourOpen, setAppTourOpen] = useState(false);
  const [appTourStepIndex, setAppTourStepIndex] = useState(0);
  const [sidebarCollapsedByUser, setSidebarCollapsedByUser] = useState(initialShellStateRef.current.sidebarCollapsedByUser);
  const [autoSidebarCollapsed, setAutoSidebarCollapsed] = useState(false);
  const [workspaceTransition, setWorkspaceTransition] = useState<WorkspaceTransitionState | null>(null);
  const workspaceTransitionIdRef = useRef(0);
  const runtime = useWorkspaceRuntime();
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
  const sidebarCollapsed = sidebarCollapsedByUser || autoSidebarCollapsed;
  const sidebarWidth = sidebarCollapsed ? 56 : 218;
  const sidebarGap = sidebarCollapsed ? 10 : 14;

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
    });
  }, [persistence, selectedWorkspaceId, sidebarCollapsedByUser]);

  const selectWorkspace = (workspaceId: WorkspaceId) => {
    if (appTourOpen) {
      return;
    }
    if (workspaceId === selectedWorkspaceId) {
      return;
    }
    if (workspaceTransition) {
      return;
    }

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
      if (workspaceTransitionIdRef.current !== transitionId) {
        return;
      }

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

  return (
    <main className={cn("min-h-screen overflow-hidden bg-[var(--window-background)] text-[var(--primary-text)]", workspaceTransition && "workspace-transition-active")}>
      <div className="grid min-h-screen" style={{ gridTemplateColumns: `${sidebarWidth}px ${sidebarGap}px minmax(0,1fr)` }}>
        <aside
          className="flex min-h-screen overflow-hidden flex-col border-r border-[var(--panel-stroke)] bg-[var(--shell-chrome-card-bg)] pt-[14px]"
          style={{ width: sidebarWidth }}
          data-app-tour-target="sidebar"
        >
          <div className={cn("mx-4 mb-[18px] mt-1 flex h-[38px] items-center", sidebarCollapsed ? "justify-center" : "justify-between gap-2")}>
            <AnimatePresence initial={false}>
              {sidebarCollapsed ? null : (
                <motion.h1
                  key="app-title"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={quickEase}
                  className="min-w-0 truncate text-xl font-bold leading-[38px] text-[var(--primary-text)]"
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

          <nav
            className={cn("app-scrollbar min-h-0 flex-1 overflow-y-auto pb-4", sidebarCollapsed ? "px-2" : "px-4")}
            aria-label="작업 화면"
            data-app-tour-target="workspace-nav"
          >
            <div className="space-y-1">
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
            className={cn(sidebarCollapsed ? "mx-2 mb-4 mt-3 border-t border-[var(--panel-stroke)] pt-3" : "m-4 rounded-md border border-[var(--panel-stroke)] p-[14px]")}
            data-app-tour-target="run-controls"
          >
            {sidebarCollapsed ? null : (
              <>
                <p className="text-[13px] font-normal text-[var(--secondary-text)]">Work</p>
                <p className="mb-[14px] mt-2 truncate text-base font-normal text-[var(--primary-text)]">{selectedState.statusText}</p>
              </>
            )}
            <motion.button
              type="button"
              disabled={!isRunning && !canRun}
              onClick={() => void (isRunning ? visibleRuntime.cancelWorkspace(visibleWorkspaceId) : visibleRuntime.run(visibleWorkspaceId))}
              className={cn("flex w-full items-center justify-center text-sm font-normal", isRunning ? "wpf-danger-button" : "wpf-primary-button", sidebarCollapsed && "px-0", !isRunning && !canRun && "opacity-40")}
              aria-label={isRunning ? "실행 중지" : "새 실행"}
              whileTap={isRunning || canRun ? pressTap : undefined}
            >
              {isRunning ? <Square className={cn("size-3.5", !sidebarCollapsed && "mr-2")} fill="currentColor" strokeWidth={1.7} /> : <Play className={cn("size-3.5", !sidebarCollapsed && "mr-2")} fill="currentColor" />}
              {sidebarCollapsed ? null : isRunning ? "STOP" : "NEW RUN"}
            </motion.button>
            {canRetry || selectedState.table.rows.length > 0 || selectedState.lastRun ? (
              <motion.button
                type="button"
                disabled={!canRetry}
                onClick={() => void visibleRuntime.retry(visibleWorkspaceId)}
                className={cn("mt-2 flex h-[38px] w-full items-center justify-center text-sm font-normal wpf-button", sidebarCollapsed && "px-0", !canRetry && "opacity-40")}
                aria-label="다시 실행"
                whileTap={canRetry ? pressTap : undefined}
              >
                <RotateCcw className={cn("size-3.5", !sidebarCollapsed && "mr-2")} strokeWidth={1.7} />
                {sidebarCollapsed ? null : "RETRY"}
              </motion.button>
            ) : null}
            <motion.button
              type="button"
              disabled={!isExporting && !canExport}
              onClick={() => void (isExporting ? visibleRuntime.cancelWorkspace(visibleWorkspaceId) : visibleRuntime.exportWorkspace(visibleWorkspaceId))}
              className={cn("mt-2 flex h-[38px] w-full items-center justify-center text-sm font-normal", isExporting ? "wpf-danger-button" : "wpf-button", sidebarCollapsed && "px-0", !isExporting && !canExport && "opacity-40")}
              aria-label={isExporting ? "내보내기 중지" : "내보내기"}
              whileTap={isExporting || canExport ? pressTap : undefined}
            >
              {isExporting ? <Square className={cn("size-3.5", !sidebarCollapsed && "mr-2")} fill="currentColor" strokeWidth={1.7} /> : <Download className={cn("size-3.5", !sidebarCollapsed && "mr-2")} strokeWidth={1.7} />}
              {sidebarCollapsed ? null : isExporting ? "STOP" : "EXPORT"}
            </motion.button>
            <motion.button
              type="button"
              onClick={openGuide}
              className={cn("mt-2 flex h-[38px] w-full items-center justify-center text-sm font-normal wpf-button", sidebarCollapsed && "px-0")}
              aria-label="기능 가이드 열기"
              data-app-tour-target="guide-button"
              whileTap={pressTap}
            >
              <Compass className={cn("size-3.5", !sidebarCollapsed && "mr-2")} strokeWidth={1.7} />
              {sidebarCollapsed ? null : "GUIDE"}
            </motion.button>
          </div>
        </aside>

        <div aria-hidden="true" />

        <section className="min-w-0 px-0 py-3 pr-4">
          <div className="h-full min-h-0">
            <WorkspaceFrame key={selectedWorkspace.id} workspace={selectedWorkspace} runtime={visibleRuntime} />
          </div>
        </section>
      </div>
      {workspaceTransition ? <WorkspaceTransitionOverlay transition={workspaceTransition} /> : null}
      <AppTour open={appTourOpen} onClose={closeGuide} onStepChange={(stepIndex) => setAppTourStepIndex(stepIndex)} />
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
  if (rect.width <= 72 && rect.height <= 72) {
    return "compact";
  }
  if (rect.width <= 72) {
    return "vertical";
  }
  if (rect.height <= 72) {
    return "horizontal";
  }
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
        "relative flex w-full items-center overflow-hidden rounded-[5px] text-left text-sm font-normal text-[var(--primary-text)] transition-colors",
        collapsed ? "justify-center px-0 py-[9px]" : "px-[10px] py-[9px]",
        selected ? "bg-transparent" : "bg-transparent hover:bg-[var(--soft-selection-hover)]",
      )}
    >
      {selected ? <motion.span layoutId="workspace-nav-selection" className="absolute inset-0 rounded-[5px] bg-[var(--nav-selected-bg)]" /> : null}
      <Icon className="relative z-10 size-5 shrink-0 text-[var(--primary-text)]" strokeWidth={1.65} />
      {collapsed ? null : <span className="relative z-10 ml-3 min-w-0 truncate">{workspace.navLabel}</span>}
    </motion.button>
  );
}
