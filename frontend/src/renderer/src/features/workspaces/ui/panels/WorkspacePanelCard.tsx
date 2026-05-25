import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { EllipsisVertical } from "lucide-react";
import type { WorkspaceId } from "@shared/ipc";
import { useAppPersistence } from "@/app/app-persistence";
import { cn } from "@/lib/utils";
import { FileBrowser, type FileBrowserNodeChecks } from "@/shared/components/file-browser";
import { WpfCard } from "@/shared/components/wpf-card";
import { workspaceCardSpring } from "@/shared/motion";
import { getPanelBodyLayoutMode, getPanelBodyMinSize, resolveMeasuredPanelCollapseMode, useElementBoxSize, useElementResizeCollapseMode } from "../layout/workspace-card-overflow";
import { type PanelAutoCollapseSuppression, type PanelCollapseMode, type WorkspaceResizeAxis } from "../layout/workspace-layout-types";
import { useWorkspaceLayoutResizeState } from "../layout/workspace-splitters";
import type { WorkspacePanel } from "../../model/workspace-config";
import { toggleInferenceReferencePath } from "../../model/inference-reference-selection";
import { resolveBrowserTree } from "../../model/workspace-browser-tree";
import type { WorkspaceRuntime } from "../../state/use-workspace-runtime";
import { BatchAudioHeaderControls, BatchAudioPlaybackPanel, BatchModelSettingsBody, BatchSpeakerSelectionBody, BatchTimelineBody } from "../pages/batch/BatchPanels";
import { OverviewModelSettingsBody, OverviewModulesBody } from "../pages/overview/OverviewPanels";
import { SliceEditorBody, SliceEditorHeaderControls, focusSliceViewOnRow, setSliceViewRange, type SliceEditorViewActions, type SliceEditorViewContext, type SliceEditorViewState, zoomSliceView } from "../pages/slice/SliceEditorPanel";
import { SliceSettingsBody } from "../pages/slice/SliceSettingsPanel";
import { SpeakerAudioComparisonPanel } from "../pages/speaker/SpeakerAudioComparisonPanel";
import { SpeakerModelBody, SpeakerSettingsBody } from "../pages/speaker/SpeakerPanels";
import { TaggingSchemaBody } from "../pages/tagging/TaggingPanels";
import { TaggingSettingsBody } from "../pages/tagging/TaggingSettingsPanel";
import { TrainingModelBody, TrainingPlanBody, TrainingPlanHeaderControl, TrainingSettingsBody } from "../pages/training/TrainingPanels";
import { InferenceBrowserHeaderControls, InferenceModelBody, InferenceOutputBody, InferenceReferenceBody, InferenceReferenceHeaderControl, InferenceSettingsBody } from "../pages/inference/InferencePanels";
import { WorkspaceAudioPlaybackPanel } from "../shared/WorkspaceAudioPlaybackPanel";
import { BackendStatusBody, DetailFieldList } from "../shared/workspace-panel-primitives";
import { findSelectedRow } from "../shared/workspace-ui-utils";
import { WorkspaceDataGrid, TableHeaderSearch } from "../table/WorkspaceDataGrid";


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

export function PanelCard({
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
  const isInferenceBrowserPanel = workspaceId === "inference" && panel.id === "inference-browser";
  const isInferenceReferencePanel = workspaceId === "inference" && panel.id === "inference-reference";
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
            {expanded && isInferenceReferencePanel ? <InferenceReferenceHeaderControl runtime={runtime} /> : null}
            <span
              className="flex size-6 shrink-0 items-center justify-center"
              data-app-tour-panel-tools="true"
            >
              <EllipsisVertical className="size-4 text-[var(--control-arrow)]" strokeWidth={1.9} />
            </span>
          </div>
        </div>
        {expanded && isInferenceBrowserPanel ? <InferenceBrowserHeaderControls runtime={runtime} /> : null}
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
    const inferenceInputNodeChecks: FileBrowserNodeChecks | undefined = workspaceId === "inference" && runtime.settings.inference.inferenceRunMode === "batch"
      ? {
          checkedPaths: runtime.settings.inference.batchReferenceAudioPaths,
          onToggleNode: (node) => {
            if (!state.inferenceMultiReferenceOpen) {
              runtime.selectFileNode("inference", node);
            }
            runtime.setSettings((current) => ({
              ...current,
              inference: {
                ...current.inference,
                batchReferenceAudioPaths: toggleInferenceReferencePath(current.inference.batchReferenceAudioPaths, node.path),
              },
            }));
          },
        }
      : undefined;

    return (
      <FileBrowser
        workspaceId={workspaceId}
        inputPath={state.inputPath}
        outputPath={state.outputPath}
        inputTree={inputTree}
        outputTree={outputTree}
        selectedPath={state.selectedFilePath}
        rowChecks={state.rowExportChecks}
        inputNodeChecks={inferenceInputNodeChecks}
        preferredSection={state.browserPreferredSection}
        sectionRequestId={state.browserSectionRequestId}
        revealRequestId={state.browserRevealRequestId}
        onSelectInputFolder={() => runtime.selectInputFolder(workspaceId)}
        onSelectOutputFolder={() => runtime.selectOutputFolder(workspaceId)}
        inputActionLabel={workspaceId === "training" ? "데이터셋 파일" : workspaceId === "inference" ? "입력 폴더" : undefined}
        inputSecondaryActionLabel={workspaceId === "inference" ? "데이터셋 파일" : undefined}
        onSelectInputSecondary={workspaceId === "inference" ? runtime.selectInferenceDatasetFile : undefined}
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
