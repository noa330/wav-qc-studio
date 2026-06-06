import { File, FileAudio, Folder, FolderOpen, Music } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type UIEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { FileTreeNode, FileTreeResult, WorkspaceId } from "@shared/ipc";
import { SCROLL_WINDOW_BUFFER_SCREENS, resolveScrollWindowMetrics, type ScrollWindowMetrics } from "@shared/scroll-window";
import { cn } from "@/lib/utils";
import { ChevronGlyph, SelectionCheck } from "./controls";
import { ColumnSearchField } from "./column-search-field";
import { fadeSlideUpMotion, loadingSpinnerTransition, softPressTap, subtleSpring, tightPressTap } from "@/shared/motion";

// 40px height for 32px slim rows + 8px gap
const fileBrowserRowExtent = 40;
const fileBrowserTreeIndentPx = 18;
const fileBrowserTreeControlColumnPx = 22;
const fileBrowserTreeIconColumnPx = 20;
const fileBrowserTreeColumns = `${fileBrowserTreeControlColumnPx}px ${fileBrowserTreeIconColumnPx}px minmax(0,1fr)`;
const fileBrowserTreeControlledFolderColumns = `${fileBrowserTreeControlColumnPx}px ${fileBrowserTreeControlColumnPx}px ${fileBrowserTreeIconColumnPx}px minmax(0,1fr)`;
const fileBrowserTreeLeafFileColumns = `${fileBrowserTreeIconColumnPx}px minmax(0,1fr) auto`;
const fileBrowserTreeControlledFileColumns = `${fileBrowserTreeColumns} auto`;

export type FileBrowserNodeChecks = {
  checkedPaths: string[];
  onToggleNode: (node: FileTreeNode) => void;
  onToggleNodes?: (nodes: FileTreeNode[], checked: boolean) => void;
  isCheckable?: (node: FileTreeNode) => boolean;
  revealMode?: "always" | "hover-when-empty";
};

export function FileBrowser({
  workspaceId,
  inputPath,
  outputPath,
  inputTree,
  outputTree,
  selectedPath,
  rowChecks,
  inputNodeChecks,
  preferredSection,
  sectionRequestId,
  revealRequestId,
  onSelectInputFolder,
  onSelectOutputFolder,
  inputActionLabel = "입력 폴더",
  outputActionLabel = "출력 폴더",
  onRequestWindow,
  onSelectNode,
  inputSecondaryActionLabel,
  onSelectInputSecondary,
  audioDurations,
  reviewedFilePaths = [],
  variant = "premium",
}: {
  workspaceId: WorkspaceId;
  inputPath: string;
  outputPath?: string;
  inputTree?: FileTreeResult;
  outputTree?: FileTreeResult;
  selectedPath?: string;
  rowChecks?: Record<string, boolean>;
  inputNodeChecks?: FileBrowserNodeChecks;
  preferredSection?: "input" | "output";
  sectionRequestId?: number;
  revealRequestId?: number;
  onSelectInputFolder: () => void;
  onSelectOutputFolder: () => void;
  inputActionLabel?: string;
  outputActionLabel?: string;
  inputSecondaryActionLabel?: string;
  onSelectInputSecondary?: () => void;
  onRequestWindow?: (purpose: "input" | "output", direction: "reveal" | "sync" | "up" | "down", metrics: ScrollWindowMetrics, targetPath?: string) => Promise<void> | void;
  onSelectNode: (node: FileTreeNode) => void;
  audioDurations?: Record<string, string>;
  reviewedFilePaths?: string[];
  variant?: "classic" | "premium";
}) {
  const inputTitle = inputTree?.rootPath === "wqcs://mixed-input" ? "오디오" : inputPath || "오디오";
  const selectionLayoutId = `file-browser-selection-${workspaceId}`;
  const [inputExpanded, setInputExpanded] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFolderPaths, setSearchFolderPaths] = useState<string[]>([]);
  const isPremium = variant === "premium";
  const searchFolderOptions = useMemo(
    () => collectSearchFolderOptions(inputTree),
    [inputTree],
  );
  const filteredInputNodes = useMemo(
    () => filterBrowserNodes(inputTree?.nodes ?? [], searchQuery, searchFolderPaths),
    [inputTree?.nodes, searchFolderPaths, searchQuery],
  );

  useEffect(() => {
    const availablePaths = new Set(searchFolderOptions.map((option) => normalizePath(option.key)));
    setSearchFolderPaths((current) => {
      const nextPaths = current.filter((path) => availablePaths.has(normalizePath(path)));
      return nextPaths.length === current.length ? current : nextPaths;
    });
  }, [searchFolderOptions]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-0 overflow-hidden">
      <div className={cn(isPremium ? "pl-0 pr-[14px] pb-3" : "px-1")}>
        <ColumnSearchField
          value={searchQuery}
          onChange={setSearchQuery}
          options={searchFolderOptions}
          selectedKeys={searchFolderPaths}
          onSelectedKeysChange={setSearchFolderPaths}
          ariaLabel="파일 검색"
          headerLabel="검색 폴더 선택"
          allOptionLabel="전체 폴더"
        />
      </div>

      <BrowserSection
        title={inputTitle}
        action={inputActionLabel}
        onAction={onSelectInputFolder}
        secondaryAction={inputSecondaryActionLabel}
        onSecondaryAction={onSelectInputSecondary}
        onSelectOutputFolder={onSelectOutputFolder}
        outputActionLabel={outputActionLabel}
        nodes={filteredInputNodes}
        windowState={inputTree?.window}
        selectedPath={selectedPath}
        rowChecks={rowChecks}
        nodeChecks={inputNodeChecks}
        revealRequestId={revealRequestId}
        onSelectNode={onSelectNode}
        onRequestWindow={(direction, metrics, targetPath) => onRequestWindow?.("input", direction, metrics, targetPath)}
        expanded={inputExpanded}
        onToggle={() => setInputExpanded((current) => !current)}
        fill={inputExpanded}
        selectionLayoutId={selectionLayoutId}
        audioDurations={audioDurations}
        reviewedFilePaths={reviewedFilePaths}
        variant={variant}
      />
    </div>
  );
}

function BrowserSection({
  title,
  nodes,
  windowState,
  selectedPath,
  rowChecks,
  nodeChecks,
  revealRequestId,
  onSelectNode,
  onRequestWindow,
  expanded,
  onToggle,
  fill,
  selectionLayoutId,
  audioDurations,
  reviewedFilePaths,
  variant = "premium",
}: {
  title: string;
  action: string;
  onAction: () => void;
  secondaryAction?: string;
  onSecondaryAction?: () => void;
  onSelectOutputFolder?: () => void;
  outputActionLabel?: string;
  nodes: FileTreeNode[];
  windowState?: FileTreeResult["window"];
  selectedPath?: string;
  rowChecks?: Record<string, boolean>;
  nodeChecks?: FileBrowserNodeChecks;
  revealRequestId?: number;
  onSelectNode: (node: FileTreeNode) => void;
  onRequestWindow?: (direction: "reveal" | "sync" | "up" | "down", metrics: ScrollWindowMetrics, targetPath?: string) => Promise<void> | void;
  expanded: boolean;
  onToggle: () => void;
  fill: boolean;
  selectionLayoutId: string;
  audioDurations?: Record<string, string>;
  reviewedFilePaths: string[];
  variant?: "classic" | "premium";
}) {
  const scrollRef = useRef<HTMLElement | null>(null);
  const loadingWindowRef = useRef(false);
  const handledRevealRequestRef = useRef<number | undefined>(undefined);
  const checkedPathSet = nodeChecks ? new Set(nodeChecks.checkedPaths.map(normalizePath)) : undefined;
  const anyNodeChecked = Boolean(checkedPathSet?.size);
  const reviewedPathSet = new Set(reviewedFilePaths.map(normalizePath));
  const headerCheckableNodes = nodeChecks ? collectSectionCheckableNodes(nodes, nodeChecks) : [];
  const headerCheckVisible = Boolean(nodeChecks?.onToggleNodes && anyNodeChecked && headerCheckableNodes.length > 0);
  const headerCheckedCount = headerCheckVisible
    ? headerCheckableNodes.filter((item) => checkedPathSet?.has(normalizePath(item.path))).length
    : 0;
  const headerAllChecked = headerCheckVisible && headerCheckedCount === headerCheckableNodes.length;
  const headerSomeChecked = headerCheckVisible && headerCheckedCount > 0;

  const resolveWindowMetrics = (element: HTMLElement | null) =>
    resolveScrollWindowMetrics({
      viewportExtent: element?.clientHeight ?? fileBrowserRowExtent,
      itemExtent: fileBrowserRowExtent,
      itemCount: windowState?.total ?? nodes.length,
      bufferScreens: SCROLL_WINDOW_BUFFER_SCREENS,
    });

  const requestWindow = async (direction: "reveal" | "sync" | "up" | "down", targetPath?: string) => {
    if (!onRequestWindow || loadingWindowRef.current) {
      return;
    }

    loadingWindowRef.current = true;
    const scrollElement = scrollRef.current;
    const metrics = resolveWindowMetrics(scrollElement);
    try {
      await onRequestWindow(direction, metrics, targetPath);
    } finally {
      window.requestAnimationFrame(() => {
        if (scrollElement && direction !== "sync") {
          scrollElement.scrollTop = Math.max(0, (scrollElement.scrollHeight - scrollElement.clientHeight) / 2);
        }
        loadingWindowRef.current = false;
      });
    }
  };

  useEffect(() => {
    if (!expanded || !windowState || !onRequestWindow) {
      return;
    }

    const element = scrollRef.current;
    if (!element) {
      return;
    }

    const syncWindow = () => {
      const metrics = resolveWindowMetrics(element);
      if (windowState.total > 0 && metrics.chunkSize !== windowState.limit) {
        void requestWindow("sync");
      }
    };

    syncWindow();
    const observer = new ResizeObserver(syncWindow);
    observer.observe(element);
    return () => observer.disconnect();
  }, [expanded, nodes.length, onRequestWindow, windowState?.limit, windowState?.total]);

  useEffect(() => {
    if (!expanded || !selectedPath || revealRequestId === undefined || revealRequestId === handledRevealRequestRef.current || treeContainsPath(nodes, selectedPath)) {
      return;
    }

    void requestWindow("reveal", selectedPath);
  }, [expanded, nodes, revealRequestId, selectedPath]);

  const handleScroll = (event: UIEvent<HTMLElement>) => {
    const element = event.currentTarget;
    const nearTop = element.scrollTop <= fileBrowserRowExtent;
    const nearBottom = element.scrollTop + element.clientHeight >= element.scrollHeight - fileBrowserRowExtent;
    if (nearBottom && windowState?.hasMore) {
      void requestWindow("down");
      return;
    }
    if (nearTop && windowState?.hasPrevious) {
      void requestWindow("up");
    }
  };

  const isPremium = variant === "premium";

  return (
    <section
      ref={scrollRef}
      onScroll={handleScroll}
      data-app-tour-target="file-browser-list"
      className={cn("scroll-window-viewport flex min-h-10 flex-col overflow-auto pb-3 pr-[14px]", fill ? "flex-1" : "flex-none")}
    >
      <div className={cn("grid min-h-[32px] grid-cols-[minmax(0,1fr)_auto] items-center gap-2", isPremium ? "px-0" : "px-1")} data-app-tour-target="file-browser-section-header">
        <motion.button
          type="button"
          onClick={onToggle}
          whileTap={softPressTap}
          className={cn(
            "grid w-full min-w-0 items-center gap-x-1.5 overflow-hidden border border-transparent px-1.5 py-1.5 text-left",
            isPremium ? "rounded-[5px] hover:bg-[var(--soft-selection-hover)]" : "rounded-[5px] hover:bg-[var(--soft-selection-hover)]",
          )}
          style={{ gridTemplateColumns: headerCheckVisible ? fileBrowserTreeControlledFolderColumns : fileBrowserTreeColumns }}
        >
          <ChevronGlyph direction={expanded ? "down" : "right"} />
          {headerCheckVisible ? (
            <span className="flex size-[22px] shrink-0 items-center justify-center">
              <NodeCheckButton
                checked={headerAllChecked}
                ariaLabel={`${title} 오디오 전체 선택`}
                onToggle={() => nodeChecks?.onToggleNodes?.(headerCheckableNodes, !headerAllChecked)}
              />
            </span>
          ) : null}
          {expanded ? (
            <FolderOpen className={cn("size-[18px] shrink-0", isPremium ? "text-[var(--accent-foreground)]" : "text-[var(--icon-brush)]")} strokeWidth={1.55} />
          ) : (
            <Folder className={cn("size-[18px] shrink-0", isPremium ? "text-[var(--accent-foreground)]" : "text-[var(--icon-brush)]")} strokeWidth={1.55} />
          )}
          <span className={cn("min-w-0 truncate", isPremium ? "font-semibold text-sm text-[var(--primary-text)]" : "text-base font-normal text-[var(--primary-text)]")}>
            {compactPath(title)}
          </span>
        </motion.button>
      </div>

      <AnimatePresence initial={false}>
        {expanded ? (
          <motion.div {...fadeSlideUpMotion}>
            {nodes.length === 0 ? (
              <p className="m-[10px] text-sm text-[var(--secondary-text)]">선택한 경로에 표시할 항목이 없습니다.</p>
            ) : (
              nodes.map((node) => (
                <BrowserNodeRow
                  key={node.id}
                  node={node}
                  selectedPath={selectedPath}
                  rowChecks={rowChecks}
                  nodeChecks={nodeChecks}
                  checkedPathSet={checkedPathSet}
                  anyNodeChecked={anyNodeChecked}
                  revealRequestId={revealRequestId !== handledRevealRequestRef.current ? revealRequestId : undefined}
                  onRevealHandled={(requestId) => {
                    handledRevealRequestRef.current = requestId;
                  }}
                  onSelectNode={onSelectNode}
                  selectionLayoutId={selectionLayoutId}
                  level={1}
                  audioDurations={audioDurations}
                  reviewedPathSet={reviewedPathSet}
                  variant={variant}
                />
              ))
            )}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </section>
  );
}

function BrowserNodeRow({
  node,
  selectedPath,
  rowChecks,
  nodeChecks,
  checkedPathSet,
  anyNodeChecked = false,
  revealRequestId,
  onRevealHandled,
  onSelectNode,
  selectionLayoutId,
  level = 0,
  audioDurations,
  reviewedPathSet,
  variant = "premium",
}: {
  node: FileTreeNode;
  selectedPath?: string;
  rowChecks?: Record<string, boolean>;
  nodeChecks?: FileBrowserNodeChecks;
  checkedPathSet?: Set<string>;
  anyNodeChecked?: boolean;
  revealRequestId?: number;
  onRevealHandled?: (requestId: number) => void;
  onSelectNode: (node: FileTreeNode) => void;
  selectionLayoutId: string;
  level?: number;
  audioDurations?: Record<string, string>;
  reviewedPathSet?: Set<string>;
  variant?: "classic" | "premium";
}) {
  const hasChildren = Boolean(node.children?.length);
  const [expanded, setExpanded] = useState(true);
  const [hovered, setHovered] = useState(false);
  const isPremium = variant === "premium";
  const FolderIcon = expanded ? FolderOpen : Folder;
  const Icon = node.kind === "directory" ? FolderIcon : isAudioFile(node.path) ? FileAudio : File;
  const conversionStatus = node.kind === "file" ? readConversionStatus(node.meta) : undefined;
  const selected = normalizePath(selectedPath) === normalizePath(node.path);
  const unchecked = Boolean(node.exportRowId && rowChecks?.[node.exportRowId] === false);
  const checkable = Boolean(nodeChecks && isNodeCheckable(node, nodeChecks));
  const checked = checkable && Boolean(checkedPathSet?.has(normalizePath(node.path)));
  const checkableDescendantNodes = node.kind === "directory" && nodeChecks ? collectCheckableDescendantNodes(node, nodeChecks) : [];
  const folderCheckable = checkableDescendantNodes.length > 0 && Boolean(nodeChecks?.onToggleNodes);
  const folderCheckedCount = folderCheckable
    ? checkableDescendantNodes.filter((item) => checkedPathSet?.has(normalizePath(item.path))).length
    : 0;
  const folderAllChecked = folderCheckable && folderCheckedCount === checkableDescendantNodes.length;
  const folderSomeChecked = folderCheckable && folderCheckedCount > 0;
  const rowRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!selected || revealRequestId === undefined) {
      return;
    }

    const element = rowRef.current;
    const scrollRoot = element?.closest(".scroll-window-viewport");
    if (!element || !(scrollRoot instanceof HTMLElement)) {
      return;
    }

    const elementRect = element.getBoundingClientRect();
    const rootRect = scrollRoot.getBoundingClientRect();
    const outsideView = elementRect.top < rootRect.top || elementRect.bottom > rootRect.bottom;
    if (outsideView) {
      element.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
    }
    onRevealHandled?.(revealRequestId);
  }, [onRevealHandled, revealRequestId, selected, selectedPath]);

  const isFile = node.kind === "file";
  const isAudio = isAudioFile(node.path) && isFile;

  // Calculate actual duration
  let durationStr = "";
  if (isFile) {
    if (node.exportRowId && audioDurations?.[node.exportRowId]) {
      durationStr = audioDurations[node.exportRowId];
    } else if (node.path && audioDurations?.[node.path.replace(/\\/g, "/").toLowerCase()]) {
      durationStr = audioDurations[node.path.replace(/\\/g, "/").toLowerCase()];
    } else if (node.meta && !isNaN(parseFloat(node.meta))) {
      durationStr = parseFloat(node.meta).toFixed(2) + "s";
    } else {
      // Mock fallback duration for file nodes
      durationStr = isAudio ? "5.00s" : "";
    }
  }

  const wrapperClass = cn(
    isPremium
      ? "relative mt-2 mb-0 block min-h-[32px] overflow-hidden rounded-[5px] px-1.5 py-1.5 text-left hover:bg-[var(--soft-selection-hover)]"
      : "relative mt-2 mb-0 block w-full min-h-[32px] overflow-hidden rounded-[5px] px-1 py-1.5 text-left text-sm font-normal hover:bg-[var(--soft-selection-hover)]",
    selected && "hover:bg-transparent"
  );
  const fileHasControlSlot = Boolean(nodeChecks && checkable);
  const hoverRevealChecks = nodeChecks?.revealMode === "hover-when-empty";
  const fileCheckVisible = checkable && (!hoverRevealChecks || anyNodeChecked || checked || hovered || selected);
  const folderCheckVisible = folderCheckable && (!hoverRevealChecks || anyNodeChecked || folderSomeChecked);
  const rowOffset = level * fileBrowserTreeIndentPx + (isFile && !fileHasControlSlot ? fileBrowserTreeControlColumnPx : 0);

  return (
    <div>
      <div
        ref={rowRef}
        role="button"
        tabIndex={0}
        onClick={() => {
          if (isFile) {
            onSelectNode(node);
          }
          if (hasChildren) {
            setExpanded((current) => !current);
          }
        }}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") {
            return;
          }
          event.preventDefault();
          event.currentTarget.click();
        }}
        className={wrapperClass}
        style={{ marginLeft: `${rowOffset}px`, width: `calc(100% - ${rowOffset}px)` }}
      >
        {selected ? (
          <motion.span
            layoutId={selectionLayoutId}
            transition={subtleSpring}
            className={cn(
              "absolute inset-0 pointer-events-none", // Crucial: prevent overriding click events
              isPremium
                ? "rounded-[5px] bg-[var(--soft-selection-hover)] border border-[var(--panel-stroke)]/30"
                : "rounded-[5px] bg-[var(--nav-selected-bg)]"
            )}
          />
        ) : null}

        {isFile ? (
          <div
            className="relative z-10 grid min-w-0 items-center gap-x-1.5"
            style={{ gridTemplateColumns: fileHasControlSlot ? fileBrowserTreeControlledFileColumns : fileBrowserTreeLeafFileColumns }}
          >
            {fileHasControlSlot ? (
              <span className={cn("flex size-[22px] shrink-0 items-center justify-center", !fileCheckVisible && "pointer-events-none opacity-0")}>
                <NodeCheckButton
                  checked={checked}
                  ariaLabel={`${node.name} 선택`}
                  onToggle={() => nodeChecks?.onToggleNode(node)}
                />
              </span>
            ) : null}

            {conversionStatus === "pending" || conversionStatus === "running" ? (
              <span className="flex size-[18px] shrink-0 items-center justify-center">
                <ConversionStatusIcon status={conversionStatus} className="shrink-0" />
              </span>
            ) : (
              <div className={cn(
                "flex shrink-0 items-center justify-center bg-[var(--music-icon-box-bg)] text-[var(--accent-foreground)] shadow-[0_1px_2px_rgba(0,0,0,0.03)]",
                isPremium ? "size-[18px] rounded-[4px]" : "size-[18px] rounded-[4px] shadow-xs"
              )}>
                {isAudio ? (
                  <Music className={isPremium ? "size-3" : "size-3.5"} strokeWidth={isPremium ? 2.5 : 2.2} />
                ) : (
                  <FileAudio className={isPremium ? "size-3" : "size-3.5"} strokeWidth={isPremium ? 2.5 : 2.2} />
                )}
              </div>
            )}

            <span
              className={cn(
                "min-w-0 truncate text-[var(--primary-text)]",
                isPremium ? "text-[13px] font-normal leading-[18px]" : "text-sm font-normal",
                selected && "font-semibold text-[var(--accent-foreground)]",
                unchecked && "line-through decoration-[var(--primary-text)]"
              )}
            >
              {node.name}
            </span>

            <div className="flex shrink-0 items-center gap-2">
              {durationStr && (
                <span className={cn("font-normal text-[var(--secondary-text)]", isPremium ? "text-xs" : "text-[13px]")}>
                  {durationStr}
                </span>
              )}
              <span
                className={cn(
                  "rounded-full shrink-0",
                  isPremium ? "size-[6px]" : "size-2",
                  fileStatusDotClass(node.meta, reviewedPathSet?.has(normalizePath(node.path)) ?? false)
                )}
              />
            </div>
          </div>
        ) : (
          <div
            className="relative z-10 grid min-w-0 items-center gap-x-1.5"
            style={{ gridTemplateColumns: folderCheckVisible ? fileBrowserTreeControlledFolderColumns : fileBrowserTreeColumns }}
          >
            {hasChildren ? (
              <ChevronGlyph direction={expanded ? "down" : "right"} className="shrink-0" />
            ) : (
              <span />
            )}

            {folderCheckVisible ? (
              <span className="flex size-[22px] shrink-0 items-center justify-center">
                <NodeCheckButton
                  checked={folderAllChecked}
                  ariaLabel={`${node.name} 폴더 오디오 전체 선택`}
                  onToggle={() => nodeChecks?.onToggleNodes?.(checkableDescendantNodes, !folderAllChecked)}
                />
              </span>
            ) : null}

            <Icon className={cn("size-[18px] shrink-0", isPremium ? "text-[var(--accent-foreground)]" : "text-[var(--icon-brush)]")} strokeWidth={1.55} />

            {/* Folder name and meta: One line for premium, Two lines for classic */}
            <div className="min-w-0 flex items-baseline gap-1.5">
              <p className="truncate text-sm text-[var(--primary-text)] font-semibold">
                {node.name}
              </p>
              {isPremium && node.meta && (
                <span className="text-xs text-[var(--secondary-text)] font-normal shrink-0">
                  ({node.meta})
                </span>
              )}
              {!isPremium && node.meta && (
                <span
                  className={cn(
                    "truncate text-[13px] text-[var(--secondary-text)]",
                    unchecked && "line-through decoration-[var(--primary-text)]"
                  )}
                >
                  {node.meta}
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Children rendering */}
      {expanded
        ? node.children?.map((child) => (
            <BrowserNodeRow
              key={child.id}
              node={child}
              selectedPath={selectedPath}
              rowChecks={rowChecks}
              nodeChecks={nodeChecks}
              checkedPathSet={checkedPathSet}
              anyNodeChecked={anyNodeChecked}
              revealRequestId={revealRequestId}
              onRevealHandled={onRevealHandled}
              onSelectNode={onSelectNode}
              selectionLayoutId={selectionLayoutId}
              level={level + 1}
              audioDurations={audioDurations}
              reviewedPathSet={reviewedPathSet}
              variant={variant}
            />
          ))
        : null}
    </div>
  );
}

function NodeCheckButton({ checked, mixed = false, disabled = false, ariaLabel, onToggle }: { checked: boolean; mixed?: boolean; disabled?: boolean; ariaLabel: string; onToggle: () => void }) {
  return (
    <motion.button
      type="button"
      aria-label={ariaLabel}
      role="checkbox"
      aria-checked={mixed ? "mixed" : checked}
      disabled={disabled}
      whileTap={disabled ? undefined : tightPressTap}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      className={cn(
        "group flex size-[22px] shrink-0 items-center justify-center",
        disabled && "opacity-45",
      )}
    >
      <SelectionCheck checked={checked} mixed={mixed} disabled={disabled} />
    </motion.button>
  );
}

type ConversionStatus = "pending" | "running" | "completed" | "failed";

function ConversionStatusIcon({ status, className }: { status: "pending" | "running"; className?: string }) {
  return (
    <motion.span
      aria-hidden="true"
      className={cn(
        className,
        "block size-[18px] rounded-full border-2 border-current",
        status === "pending" ? "text-[var(--secondary-text)]" : "text-amber-500",
        status === "running" && "border-t-transparent",
      )}
      animate={status === "running" ? { rotate: 360 } : { rotate: 0 }}
      transition={status === "running" ? loadingSpinnerTransition : undefined}
    />
  );
}

function readConversionStatus(meta: string | undefined): ConversionStatus | undefined {
  if (!meta) {
    return undefined;
  }

  if (meta.includes("\ubcc0\ud658 \uc911")) {
    return "running";
  }

  if (meta.includes("\ubcc0\ud658 \ub300\uae30")) {
    return "pending";
  }

  if (meta.includes("\ubcc0\ud658 \uc2e4\ud328")) {
    return "failed";
  }

  if (meta.includes("\ubcc0\ud658 \uc644\ub8cc") || meta.includes("\ubcc0\ud658 \uc900\ube44\ub428")) {
    return "completed";
  }

  return undefined;
}

function fileStatusDotClass(meta: string | undefined, reviewed: boolean): string {
  const conversionStatus = readConversionStatus(meta);
  if (conversionStatus === "pending") {
    return "bg-slate-400";
  }
  if (conversionStatus === "running") {
    return "bg-amber-500";
  }
  if (conversionStatus === "failed" || meta?.split("|").some((part) => part.trim().toLowerCase() === "ng")) {
    return "bg-red-500";
  }
  if (conversionStatus === "completed") {
    return "bg-emerald-500";
  }
  return reviewed ? "bg-[var(--accent-foreground)]" : "bg-emerald-500";
}

// Helper functions (same as classic)
function compactPath(value: string): string {
  if (value.length <= 34) {
    return value;
  }

  const parts = value.split(/[\\/]/u).filter(Boolean);
  if (parts.length <= 2) {
    return value;
  }

  return `${parts[0]}\\...\\${parts[parts.length - 1]}`;
}

function treeContainsPath(nodes: FileTreeNode[], targetPath: string): boolean {
  const normalizedTarget = normalizePath(targetPath);
  return nodes.some((node) => {
    if (normalizePath(node.path) === normalizedTarget) {
      return true;
    }
    return node.children ? treeContainsPath(node.children, targetPath) : false;
  });
}

function isNodeCheckable(node: FileTreeNode, nodeChecks: FileBrowserNodeChecks): boolean {
  return node.kind === "file" && (nodeChecks.isCheckable?.(node) ?? isAudioFile(node.path));
}

function collectCheckableDescendantNodes(node: FileTreeNode, nodeChecks: FileBrowserNodeChecks): FileTreeNode[] {
  const children = node.children ?? [];
  return children.flatMap((child) => {
    if (isNodeCheckable(child, nodeChecks)) {
      return [child];
    }
    return child.children ? collectCheckableDescendantNodes(child, nodeChecks) : [];
  });
}

function collectSectionCheckableNodes(nodes: FileTreeNode[], nodeChecks: FileBrowserNodeChecks): FileTreeNode[] {
  return nodes.flatMap((node) => {
    if (isNodeCheckable(node, nodeChecks)) {
      return [node];
    }
    return node.children ? collectCheckableDescendantNodes(node, nodeChecks) : [];
  });
}

function normalizePath(path: string | undefined): string {
  return (path ?? "").replace(/\\/gu, "/").replace(/\/+$/u, "").toLowerCase();
}

function filterBrowserNodes(nodes: FileTreeNode[], query: string, selectedFolderPaths: string[]): FileTreeNode[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const normalizedFolderPaths = selectedFolderPaths.map(normalizePath);
  return nodes.flatMap((node) => {
    const filteredNode = filterBrowserNode(node, normalizedQuery, normalizedFolderPaths);
    return filteredNode ? [filteredNode] : [];
  });
}

function filterBrowserNode(node: FileTreeNode, normalizedQuery: string, selectedFolderPaths: string[]): FileTreeNode | undefined {
  const normalizedNodePath = normalizePath(node.path);
  const insideSelectedFolder = selectedFolderPaths.length === 0 || selectedFolderPaths.some((folderPath) => isSameOrDescendantPath(normalizedNodePath, folderPath));
  const containsSelectedFolder = selectedFolderPaths.some((folderPath) => isSameOrDescendantPath(folderPath, normalizedNodePath));
  if (insideSelectedFolder && (!normalizedQuery || `${node.name} ${node.path}`.toLocaleLowerCase().includes(normalizedQuery))) {
    return node;
  }

  const children = node.children?.flatMap((child) => {
    const filteredChild = filterBrowserNode(child, normalizedQuery, selectedFolderPaths);
    return filteredChild ? [filteredChild] : [];
  });
  if (!insideSelectedFolder && !containsSelectedFolder && !children?.length) {
    return undefined;
  }
  return children?.length ? { ...node, children } : undefined;
}

function collectSearchFolderOptions(tree: FileTreeResult | undefined): Array<{ key: string; label: string }> {
  if (!tree) {
    return [];
  }

  const directories: FileTreeNode[] = [];
  const visit = (nodes: FileTreeNode[]) => {
    for (const node of nodes) {
      if (node.kind !== "directory") {
        continue;
      }
      directories.push(node);
      visit(node.children ?? []);
    }
  };
  visit(tree.nodes);

  if (directories.length === 0 && tree.rootPath && !tree.rootPath.startsWith("wqcs://")) {
    return [{ key: tree.rootPath, label: tree.rootPath }];
  }

  const seen = new Set<string>();
  return directories.flatMap((node) => {
    const normalizedPath = normalizePath(node.path);
    if (!normalizedPath || seen.has(normalizedPath)) {
      return [];
    }
    seen.add(normalizedPath);
    return [{ key: node.path, label: node.path.startsWith("wqcs://") ? node.name : node.path }];
  });
}

function isSameOrDescendantPath(path: string, parentPath: string): boolean {
  return path === parentPath || path.startsWith(`${parentPath}/`);
}

function isAudioFile(path: string | undefined): boolean {
  return /\.(wav|wave|flac|mp3|m4a|aac|ogg|oga|opus|aiff|aif|aifc|wma|webm|mp4|caf|amr)$/iu.test(path ?? "");
}
