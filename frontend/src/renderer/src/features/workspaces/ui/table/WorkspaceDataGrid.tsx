import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { AnimatePresence } from "motion/react";
import { ChartNoAxesColumnIncreasing, Filter, ListChecks } from "lucide-react";
import type { DataTableRow, WorkspaceId } from "@shared/ipc";
import { useAppPersistence, type PersistedBatchReplaceState } from "@/app/app-persistence";
import { ColumnSearchField } from "@/shared/components/column-search-field";
import { DataGrid, type DataGridViewState } from "@/shared/components/data-grid";
import { DropdownMenuHeader, DropdownMenuOption, DropdownMenuSeparator } from "@/shared/components/dropdown-menu";
import { overviewMetricColumns, type OverviewMetricColumn, type OxFilterState } from "../../model/overview-filter";
import type { WorkspaceRuntime } from "../../state/use-workspace-runtime";
import { BatchTranscriptReplaceDialog } from "../pages/batch/BatchTranscriptReplaceDialog";
import { FilterChipEditorDialog } from "../pages/overview/widgets/overview-filter/FilterChipEditorDialog";
import { TaggingScoreCutDialog } from "../pages/tagging/TaggingPanels";
import { VoiceTensorBoardDialog } from "../pages/training/VoiceTensorBoardPanel";
import { useWorkspaceAudioSync } from "../shared/workspace-audio-sync";
import { BatchEditableCell, TaggingResultCell } from "./WorkspaceTableCells";


export function WorkspaceDataGrid({ workspaceId, runtime, table, suspendWidthTracking = false }: { workspaceId: WorkspaceId; runtime: WorkspaceRuntime; table: ReturnType<WorkspaceRuntime["getTable"]>; suspendWidthTracking?: boolean }) {
  const persistence = useAppPersistence();
  const initialWorkspaceUiRef = useRef(persistence.getWorkspaceUiSnapshot(workspaceId));
  const [overviewEditorOpen, setOverviewEditorOpen] = useState(() => workspaceId === "overview" && initialWorkspaceUiRef.current.dialogs.overviewEditorOpen);
  const [batchReplaceOpen, setBatchReplaceOpen] = useState(() => workspaceId === "batch" && initialWorkspaceUiRef.current.dialogs.batchReplaceOpen);
  const [taggingScoreCutOpen, setTaggingScoreCutOpen] = useState(() => workspaceId === "tagging" && initialWorkspaceUiRef.current.dialogs.taggingScoreCutOpen);
  const [trainingTensorBoardOpen, setTrainingTensorBoardOpen] = useState(() => workspaceId === "training" && initialWorkspaceUiRef.current.dialogs.trainingTensorBoardOpen);
  const [visibleGridRows, setVisibleGridRows] = useState<DataTableRow[]>([]);
  const state = runtime.getState(workspaceId);
  const guideStepId = runtime.guideMode?.activeStepId;
  const forceOverviewEditorOpen = guideStepId === "overview-filter-dialog";
  const forceBatchReplaceOpen = guideStepId === "batch-replace-dialog";
  const forceTaggingScoreCutOpen = guideStepId === "tagging-score-dialog";
  const forceTrainingTensorBoardOpen = guideStepId === "training-tensorboard-dialog";
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
            <TableFilterButton ariaLabel="커스텀 필터" tourTarget="table-toolbar-overview" onClick={() => setOverviewEditorOpen(true)} />
          ) : workspaceId === "batch" ? (
            <TableFilterButton ariaLabel="내용 검색 및 바꾸기" tourTarget="table-toolbar-batch" onClick={() => setBatchReplaceOpen(true)} />
          ) : workspaceId === "tagging" ? (
            <TableFilterButton ariaLabel="태그 디코딩 설정" tourTarget="table-toolbar-tagging" onClick={() => setTaggingScoreCutOpen(true)}>
              <ListChecks className="size-4" strokeWidth={2} />
            </TableFilterButton>
          ) : workspaceId === "training" ? (
            <TableFilterButton ariaLabel="TensorBoard 그래프" tourTarget="table-toolbar-training" onClick={() => setTrainingTensorBoardOpen(true)}>
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
        {taggingScoreCutOpen || forceTaggingScoreCutOpen ? <TaggingScoreCutDialog key="tagging-score-cut-dialog" runtime={runtime} onClose={() => {
          if (!forceTaggingScoreCutOpen) {
            setTaggingScoreCutOpen(false);
          }
        }} /> : null}
      </AnimatePresence>
      <AnimatePresence initial={false}>
        {overviewEditorOpen || forceOverviewEditorOpen ? <FilterChipEditorDialog key="overview-filter-editor" filter={runtime.overviewFilter} onApply={runtime.setOverviewFilter} onClose={() => {
          if (!forceOverviewEditorOpen) {
            setOverviewEditorOpen(false);
          }
        }} /> : null}
      </AnimatePresence>
      <AnimatePresence initial={false}>
        {batchReplaceOpen || forceBatchReplaceOpen ? (
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
            onClose={() => {
              if (!forceBatchReplaceOpen) {
                setBatchReplaceOpen(false);
              }
            }}
            initialState={initialWorkspaceUiRef.current.batchReplace}
            onStateChange={recordBatchReplaceState}
          />
        ) : null}
      </AnimatePresence>
      <AnimatePresence initial={false}>
        {trainingTensorBoardOpen || forceTrainingTensorBoardOpen ? (
          <VoiceTensorBoardDialog
            key="training-tensorboard-dialog"
            settings={runtime.settings.training}
            autoStart={!runtime.guideMode}
            onClose={() => {
              if (!forceTrainingTensorBoardOpen) {
                setTrainingTensorBoardOpen(false);
              }
            }}
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

export function TableHeaderSearch({ workspaceId, runtime }: { workspaceId: WorkspaceId; runtime: WorkspaceRuntime }) {
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

function TableFilterButton({ ariaLabel, tourTarget, onClick, children }: { ariaLabel: string; tourTarget: string; onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void; children?: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex size-8 items-center justify-center rounded-[5px] border border-[var(--neutral-button-stroke)] bg-[var(--table-header-bg)] text-[var(--primary-text)] hover:bg-[var(--soft-selection-hover)]"
      aria-label={ariaLabel}
      data-app-tour-target={tourTarget}
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
