import { Check, File, FileAudio, Folder, FolderOpen, Minus, Music, Search, Filter } from "lucide-react";
import { useEffect, useRef, useState, type UIEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { FileTreeNode, FileTreeResult, WorkspaceId } from "@shared/ipc";
import { SCROLL_WINDOW_BUFFER_SCREENS, resolveScrollWindowMetrics, type ScrollWindowMetrics } from "@shared/scroll-window";
import { cn } from "@/lib/utils";
import { ChevronGlyph } from "./controls";
import { checkPopMotion, fadeSlideUpMotion, loadingSpinnerTransition, softPressTap, subtleSpring, tightPressTap } from "@/shared/motion";

// 42px height for slim single-line rows with increased row-to-row spacing
const fileBrowserRowExtent = 42;

export type FileBrowserNodeChecks = {
  checkedPaths: string[];
  onToggleNode: (node: FileTreeNode) => void;
  onToggleNodes?: (nodes: FileTreeNode[], checked: boolean) => void;
  isCheckable?: (node: FileTreeNode) => boolean;
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
  variant?: "classic" | "premium";
}) {
  const inputTitle = inputTree?.rootPath === "wqcs://mixed-input" ? "오디오" : inputPath || "오디오";
  const selectionLayoutId = `file-browser-selection-${workspaceId}`;
  const [inputExpanded, setInputExpanded] = useState(true);
  const isPremium = variant === "premium";

  return (
    <div className="flex h-full min-h-0 flex-col gap-0 overflow-hidden">
      {/* Mock premium search box rendered at the very top of the browser panel */}
      <div className={cn("relative flex items-center", isPremium ? "px-0 pb-3" : "px-1")}>
        <Search className={cn("absolute size-4 text-[var(--secondary-text)]", isPremium ? "left-3" : "left-3.5")} />
        <input
          type="text"
          disabled
          placeholder="Filter files..."
          className={cn(
            "w-full bg-[var(--field-bg)] text-sm text-[var(--secondary-text)] outline-none opacity-80 border border-[var(--panel-stroke)] transition-all",
            isPremium
              ? "h-10 rounded-xl pl-9 pr-10"
              : "h-9 rounded-[5px] pl-9 pr-3"
          )}
        />
        {isPremium && (
          <Filter className="absolute right-3 size-4 text-[var(--secondary-text)] opacity-70 cursor-not-allowed" />
        )}
      </div>

      <BrowserSection
        title={inputTitle}
        action={inputActionLabel}
        onAction={onSelectInputFolder}
        secondaryAction={inputSecondaryActionLabel}
        onSecondaryAction={onSelectInputSecondary}
        onSelectOutputFolder={onSelectOutputFolder}
        outputActionLabel={outputActionLabel}
        nodes={inputTree?.nodes ?? []}
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
  variant?: "classic" | "premium";
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const loadingWindowRef = useRef(false);
  const handledRevealRequestRef = useRef<number | undefined>(undefined);
  const checkedPathSet = nodeChecks ? new Set(nodeChecks.checkedPaths.map(normalizePath)) : undefined;

  const resolveWindowMetrics = (element: HTMLDivElement | null) =>
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

  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
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
    <section className={cn("flex min-h-10 flex-col overflow-hidden", fill ? "flex-1" : "flex-none")}>
      <div className={cn("grid h-10 grid-cols-[minmax(0,1fr)_auto] items-center gap-2", isPremium ? "px-0 pb-1" : "px-1")} data-app-tour-target="file-browser-section-header">
        <motion.button type="button" onClick={onToggle} whileTap={softPressTap} className="grid min-w-0 grid-cols-[18px_24px_minmax(0,1fr)] items-center text-left">
          <ChevronGlyph direction={expanded ? "down" : "right"} className="col-start-1" />
          {expanded ? (
            <FolderOpen className={cn("col-start-2 size-[18px] shrink-0", isPremium ? "text-[var(--accent-foreground)]" : "text-[var(--icon-brush)]")} strokeWidth={1.55} />
          ) : (
            <Folder className={cn("col-start-2 size-[18px] shrink-0", isPremium ? "text-[var(--accent-foreground)]" : "text-[var(--icon-brush)]")} strokeWidth={1.55} />
          )}
          <span className={cn("col-start-3 min-w-0 truncate", isPremium ? "font-semibold text-sm text-[var(--primary-text)]" : "text-base font-normal text-[var(--primary-text)]")}>
            {compactPath(title)}
          </span>
        </motion.button>
      </div>

      <AnimatePresence initial={false}>
        {expanded ? (
          <motion.div ref={scrollRef} onScroll={handleScroll} {...fadeSlideUpMotion} data-app-tour-target="file-browser-list" className="scroll-window-viewport mt-0 min-h-0 flex-1 overflow-auto pb-3 pr-1">
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
                  revealRequestId={revealRequestId !== handledRevealRequestRef.current ? revealRequestId : undefined}
                  onRevealHandled={(requestId) => {
                    handledRevealRequestRef.current = requestId;
                  }}
                  onSelectNode={onSelectNode}
                  selectionLayoutId={selectionLayoutId}
                  level={1}
                  audioDurations={audioDurations}
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
  revealRequestId,
  onRevealHandled,
  onSelectNode,
  selectionLayoutId,
  level = 0,
  audioDurations,
  variant = "premium",
}: {
  node: FileTreeNode;
  selectedPath?: string;
  rowChecks?: Record<string, boolean>;
  nodeChecks?: FileBrowserNodeChecks;
  checkedPathSet?: Set<string>;
  revealRequestId?: number;
  onRevealHandled?: (requestId: number) => void;
  onSelectNode: (node: FileTreeNode) => void;
  selectionLayoutId: string;
  level?: number;
  audioDurations?: Record<string, string>;
  variant?: "classic" | "premium";
}) {
  const hasChildren = Boolean(node.children?.length);
  const [expanded, setExpanded] = useState(true);
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

  // Common wrapper styles: separate vertical padding and font size for file vs folder to maximize visual hierarchy
  const wrapperClass = cn(
    isPremium
      ? (isFile
          ? "relative mt-2 mb-0 block overflow-hidden rounded-lg px-1.5 py-2.5 text-left text-xs font-normal hover:bg-[var(--soft-selection-hover)]"
          : "relative mt-2 mb-0 block overflow-hidden rounded-lg px-1.5 py-2.5 text-left text-sm font-semibold hover:bg-[var(--soft-selection-hover)]")
      : "relative mt-2 mb-0 block w-full overflow-hidden rounded-[5px] px-1 py-1.5 text-left text-sm font-normal hover:bg-[var(--soft-selection-hover)]",
    selected && "hover:bg-transparent"
  );

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
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") {
            return;
          }
          event.preventDefault();
          event.currentTarget.click();
        }}
        className={wrapperClass}
        style={
          isPremium
            ? isFile
              ? nodeChecks
                ? { marginLeft: `${level * 18}px`, width: `calc(100% - ${level * 18}px)` }
                : { marginLeft: `${level * 18 + 24}px`, width: `calc(100% - ${level * 18 + 24}px)` }
              : { marginLeft: `${level * 18}px`, width: `calc(100% - ${level * 18}px)` }
            : undefined
        }
      >
        {selected ? (
          <motion.span
            layoutId={selectionLayoutId}
            transition={subtleSpring}
            className={cn(
              "absolute inset-0 pointer-events-none", // Crucial: prevent overriding click events
              isPremium
                ? "rounded-lg bg-[var(--soft-selection-hover)] border border-[var(--panel-stroke)]/30"
                : "rounded-[5px] bg-[var(--nav-selected-bg)]"
            )}
          />
        ) : null}

        {isFile ? (
          // Slim downscaled single-row layout for file nodes.
          // Uses the same grid-cols structure as the folder section header for consistent hierarchy indentation.
          // level spacers (18px each) push the content right to match the folder chevron+icon grid.
          <div
            className="relative z-10 grid min-w-0 items-center gap-x-1.5"
            style={
              isPremium
                ? {
                    gridTemplateColumns: nodeChecks
                      ? "18px 20px minmax(0,1fr) auto"
                      : "20px minmax(0,1fr) auto",
                  }
                : {
                    gridTemplateColumns: `${level * 18}px 18px 20px minmax(0,1fr) auto`,
                  }
            }
          >
            {/* level indent spacer for classic */}
            {!isPremium && <span />}

            {/* Check button or empty spacer for classic */}
            {!isPremium && (
              nodeChecks && checkable ? (
                <span className="flex size-[18px] shrink-0 items-center justify-center">
                  <NodeCheckButton
                    checked={checked}
                    ariaLabel={`${node.name} 선택`}
                    onToggle={() => nodeChecks?.onToggleNode(node)}
                  />
                </span>
              ) : (
                <span />
              )
            )}

            {/* Check button for premium (only when nodeChecks is active) */}
            {isPremium && nodeChecks && (
              <span className="flex size-[18px] shrink-0 items-center justify-center">
                <NodeCheckButton
                  checked={checked}
                  ariaLabel={`${node.name} 선택`}
                  onToggle={() => nodeChecks?.onToggleNode(node)}
                />
              </span>
            )}

            {/* Wrapped Icon Box: size-5 compact for premium files (box smaller, icon same), size-7 for classic */}
            <div className={cn(
              "flex shrink-0 items-center justify-center bg-[var(--music-icon-box-bg)] text-[var(--accent-foreground)] shadow-[0_1px_2px_rgba(0,0,0,0.03)]",
              isPremium ? "size-5 rounded-[4px]" : "size-7 rounded-[6px] shadow-xs"
            )}>
              {isAudio ? (
                <Music className={isPremium ? "size-3" : "size-3.5"} strokeWidth={isPremium ? 2.5 : 2.2} />
              ) : (
                <FileAudio className={isPremium ? "size-3" : "size-3.5"} strokeWidth={isPremium ? 2.5 : 2.2} />
              )}
            </div>

            {/* File label: text-xs and font-normal for premium variant */}
            <span
              className={cn(
                "min-w-0 truncate text-[var(--primary-text)]",
                isPremium ? "text-xs font-normal" : "text-sm font-normal",
                selected && "font-semibold text-[var(--accent-foreground)]",
                unchecked && "line-through decoration-[var(--primary-text)]"
              )}
            >
              {node.name}
            </span>

            {/* Right side duration and status dot */}
            <div className="flex shrink-0 items-center gap-2">
              {durationStr && (
                <span className={cn("font-normal text-[var(--secondary-text)]", isPremium ? "text-[11px]" : "text-[13px]")}>
                  {durationStr}
                </span>
              )}
              {/* Dynamic status dot: size-[6px] compact for premium */}
              <span
                className={cn(
                  "rounded-full shrink-0",
                  isPremium ? "size-[6px]" : "size-2",
                  selected
                    ? (isPremium ? "bg-[var(--accent-foreground)]" : "bg-emerald-500")
                    : (isPremium
                        ? (node.name.charCodeAt(Math.max(0, node.name.length - 5)) % 2 === 0
                            ? "bg-emerald-500"
                            : "bg-amber-500")
                        : "bg-emerald-500")
                )}
              />
            </div>
          </div>
        ) : (
          // Rich premium hierarchical directory (folder) layout.
          // Uses the same grid-cols structure as the section header for consistent hierarchy.
          // level spacers (18px each) push folder content to align with its depth.
          <div
            className="relative z-10 grid min-w-0 items-center gap-x-1.5"
            style={{ gridTemplateColumns: isPremium ? "18px 18px minmax(0,1fr)" : `${level * 18}px 18px 18px minmax(0,1fr)` }}
          >
            {/* level indent spacer */}
            {!isPremium && <span />}
            {/* Check button (node) or empty spacer */}
            {nodeChecks && checkable ? (
              <span className="flex size-[18px] shrink-0 items-center justify-center">
                <NodeCheckButton
                  checked={checked}
                  ariaLabel={`${node.name} 선택`}
                  onToggle={() => nodeChecks?.onToggleNode(node)}
                />
              </span>
            ) : folderCheckable ? (
              <span className="flex size-[18px] shrink-0 items-center justify-center">
                <NodeCheckButton
                  checked={folderAllChecked}
                  mixed={folderSomeChecked && !folderAllChecked}
                  ariaLabel={`${node.name} 폴더 오디오 전체 선택`}
                  onToggle={() => nodeChecks?.onToggleNodes?.(checkableDescendantNodes, !folderAllChecked)}
                />
              </span>
            ) : hasChildren ? (
              <ChevronGlyph direction={expanded ? "down" : "right"} className="shrink-0" />
            ) : (
              <span />
            )}

            {/* Folder icon (or conversion status spinner) */}
            {conversionStatus ? (
              <ConversionStatusIcon status={conversionStatus} className="shrink-0" />
            ) : (
              <Icon className={cn("size-[18px] shrink-0", isPremium ? "text-[var(--accent-foreground)]" : "text-[var(--icon-brush)]")} strokeWidth={1.55} />
            )}

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
              revealRequestId={revealRequestId}
              onRevealHandled={onRevealHandled}
              onSelectNode={onSelectNode}
              selectionLayoutId={selectionLayoutId}
              level={level + 1}
              audioDurations={audioDurations}
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
      aria-pressed={mixed ? "mixed" : checked}
      disabled={disabled}
      whileTap={disabled ? undefined : tightPressTap}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      className={cn(
        "flex size-[18px] shrink-0 items-center justify-center rounded-[3px] border border-[var(--secondary-text)]",
        (checked || mixed) && "border-[var(--accent-blue)] bg-[var(--accent-blue)]",
        disabled && "opacity-45",
      )}
    >
      <AnimatePresence initial={false}>
        {checked ? (
          <motion.span {...checkPopMotion}>
            <Check className="size-3 text-white" strokeWidth={1.9} />
          </motion.span>
        ) : mixed ? (
          <motion.span {...checkPopMotion}>
            <Minus className="size-3 text-white" strokeWidth={2.1} />
          </motion.span>
        ) : null}
      </AnimatePresence>
    </motion.button>
  );
}

function ConversionStatusIcon({ status, className }: { status: "pending" | "running"; className?: string }) {
  return (
    <motion.span
      aria-hidden="true"
      className={cn(
        className,
        "block size-[18px] rounded-full border-2 border-current text-[var(--icon-brush)]",
        status === "running" && "border-t-transparent",
      )}
      animate={status === "running" ? { rotate: 360 } : { rotate: 0 }}
      transition={status === "running" ? loadingSpinnerTransition : undefined}
    />
  );
}

function readConversionStatus(meta: string | undefined): "pending" | "running" | undefined {
  if (!meta) {
    return undefined;
  }

  if (meta.includes("변환 중")) {
    return "running";
  }

  if (meta.includes("변환 대기")) {
    return "pending";
  }

  return undefined;
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

function normalizePath(path: string | undefined): string {
  return (path ?? "").replace(/\\/gu, "/").toLowerCase();
}

function isAudioFile(path: string | undefined): boolean {
  return /\.(wav|wave|flac|mp3|m4a|aac|ogg|oga|opus|aiff|aif|aifc|wma|webm|mp4|caf|amr)$/iu.test(path ?? "");
}
