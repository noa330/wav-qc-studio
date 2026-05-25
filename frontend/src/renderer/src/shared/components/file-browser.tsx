import { Check, File, FileAudio, Folder, FolderOpen } from "lucide-react";
import { useEffect, useRef, useState, type UIEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { FileTreeNode, FileTreeResult, WorkspaceId } from "@shared/ipc";
import { SCROLL_WINDOW_BUFFER_SCREENS, resolveScrollWindowMetrics, type ScrollWindowMetrics } from "@shared/scroll-window";
import { cn } from "@/lib/utils";
import { ChevronGlyph } from "./controls";
import { checkPopMotion, fadeSlideUpMotion, loadingSpinnerTransition, softPressTap, subtleSpring, tightPressTap } from "@/shared/motion";

const fileBrowserRowExtent = 54;

export type FileBrowserNodeChecks = {
  checkedPaths: string[];
  onToggleNode: (node: FileTreeNode) => void;
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
}) {
  const inputAction = inputActionLabel;
  const inputTitle = inputTree?.rootPath === "wqcs://mixed-input" ? "input" : inputPath || "input";
  const selectionLayoutId = `file-browser-selection-${workspaceId}`;
  const [inputExpanded, setInputExpanded] = useState(true);
  const [outputExpanded, setOutputExpanded] = useState(false);

  useEffect(() => {
    if (preferredSection === "output") {
      setInputExpanded(false);
      setOutputExpanded(true);
      return;
    }

    if (preferredSection === "input") {
      setInputExpanded(true);
      setOutputExpanded(false);
    }
  }, [preferredSection, sectionRequestId]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden">
      <BrowserSection
        title={inputTitle}
        action={inputAction}
        onAction={onSelectInputFolder}
        secondaryAction={inputSecondaryActionLabel}
        onSecondaryAction={onSelectInputSecondary}
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
      />
      <BrowserSection
        title={outputPath || "output"}
        action={outputActionLabel}
        onAction={onSelectOutputFolder}
        secondaryAction={undefined}
        onSecondaryAction={undefined}
        nodes={outputTree?.nodes ?? []}
        windowState={outputTree?.window}
        selectedPath={selectedPath}
        rowChecks={rowChecks}
        nodeChecks={undefined}
        revealRequestId={revealRequestId}
        onSelectNode={onSelectNode}
        onRequestWindow={(direction, metrics, targetPath) => onRequestWindow?.("output", direction, metrics, targetPath)}
        expanded={outputExpanded}
        onToggle={() => setOutputExpanded((current) => !current)}
        fill={outputExpanded}
        selectionLayoutId={selectionLayoutId}
      />
    </div>
  );
}

function BrowserSection({
  title,
  action,
  onAction,
  secondaryAction,
  onSecondaryAction,
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
}: {
  title: string;
  action: string;
  onAction: () => void;
  secondaryAction?: string;
  onSecondaryAction?: () => void;
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

  return (
    <section className={cn("flex min-h-10 flex-col overflow-hidden", fill ? "flex-1" : "flex-none")}>
      <div className="grid h-10 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2">
        <motion.button type="button" onClick={onToggle} whileTap={softPressTap} className="grid min-w-0 grid-cols-[18px_24px_minmax(0,1fr)] items-center px-1 text-left">
          <ChevronGlyph direction={expanded ? "down" : "right"} className="col-start-1" />
          {expanded ? <FolderOpen className="col-start-2 size-[18px] text-[var(--icon-brush)]" strokeWidth={1.55} /> : <Folder className="col-start-2 size-[18px] text-[var(--icon-brush)]" strokeWidth={1.55} />}
          <span className="col-start-3 min-w-0 truncate text-base font-normal text-[var(--primary-text)]">
            {compactPath(title)}
          </span>
        </motion.button>
        <motion.button type="button" onClick={onAction} whileTap={softPressTap} className="whitespace-nowrap text-[13px] font-normal text-[var(--secondary-text)] underline underline-offset-2">
          {action}
        </motion.button>
        {secondaryAction && onSecondaryAction ? (
          <motion.button type="button" onClick={onSecondaryAction} whileTap={softPressTap} className="whitespace-nowrap text-[13px] font-normal text-[var(--secondary-text)] underline underline-offset-2">
            {secondaryAction}
          </motion.button>
        ) : null}
      </div>
      <AnimatePresence initial={false}>
        {expanded ? (
          <motion.div ref={scrollRef} onScroll={handleScroll} {...fadeSlideUpMotion} className="scroll-window-viewport mt-0 min-h-0 flex-1 overflow-auto pb-3 pr-1">
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
}) {
  const hasChildren = Boolean(node.children?.length);
  const [expanded, setExpanded] = useState(true);
  const FolderIcon = expanded ? FolderOpen : Folder;
  const Icon = node.kind === "directory" ? FolderIcon : isAudioFile(node.path) ? FileAudio : File;
  const conversionStatus = node.kind === "file" ? readConversionStatus(node.meta) : undefined;
  const selected = normalizePath(selectedPath) === normalizePath(node.path);
  const unchecked = Boolean(node.exportRowId && rowChecks?.[node.exportRowId] === false);
  const checkable = Boolean(nodeChecks && isNodeCheckable(node, nodeChecks));
  const checked = checkable && Boolean(checkedPathSet?.has(normalizePath(node.path)));
  const rowRef = useRef<HTMLDivElement | null>(null);
  const chevronColumnClass = nodeChecks ? "col-start-2" : "col-start-1";
  const iconColumnClass = nodeChecks ? "col-start-3" : "col-start-2";
  const textColumnClass = nodeChecks ? "col-start-4" : "col-start-3";
  const gridClass = nodeChecks ? "grid-cols-[24px_18px_24px_minmax(0,1fr)]" : "grid-cols-[18px_24px_minmax(0,1fr)]";

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

  return (
    <div>
      <div
        ref={rowRef}
        role="button"
        tabIndex={0}
        onClick={() => {
          if (node.kind === "file") {
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
        className={cn("relative my-0.5 block w-full overflow-hidden rounded-[5px] px-1 py-2 text-left text-sm font-normal hover:bg-[var(--soft-selection-hover)]", selected && "hover:bg-transparent")}
      >
        {selected ? <motion.span layoutId={selectionLayoutId} transition={subtleSpring} className="absolute inset-0 rounded-[5px] bg-[var(--nav-selected-bg)]" /> : null}
        <div className={cn("relative z-10 grid min-w-0 items-center", gridClass)} style={{ marginLeft: `${level * 14}px` }}>
          {nodeChecks ? (
            <span className="col-start-1 flex size-[18px] items-center justify-center">
              {checkable ? (
                <NodeCheckButton
                  checked={checked}
                  ariaLabel={`${node.name} 선택`}
                  onToggle={() => nodeChecks?.onToggleNode(node)}
                />
              ) : null}
            </span>
          ) : null}
          {hasChildren ? <ChevronGlyph direction={expanded ? "down" : "right"} className={chevronColumnClass} /> : <span className={chevronColumnClass} />}
          {conversionStatus ? <ConversionStatusIcon status={conversionStatus} className={iconColumnClass} /> : <Icon className={cn(iconColumnClass, "size-[18px] text-[var(--icon-brush)]")} strokeWidth={1.55} />}
          <div className={cn(textColumnClass, "min-w-0")}>
            <p className={cn("truncate text-sm font-normal text-[var(--primary-text)]", unchecked && "line-through decoration-[var(--primary-text)]")}>{node.name}</p>
            {node.meta ? <p className={cn("mt-0.5 truncate text-[13px] text-[var(--secondary-text)]", unchecked && "line-through decoration-[var(--secondary-text)]")}>{node.meta}</p> : null}
          </div>
        </div>
      </div>
      <AnimatePresence initial={false}>
        {expanded ? node.children?.map((child) => (
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
          />
        )) : null}
      </AnimatePresence>
    </div>
  );
}

function NodeCheckButton({ checked, disabled = false, ariaLabel, onToggle }: { checked: boolean; disabled?: boolean; ariaLabel: string; onToggle: () => void }) {
  return (
    <motion.button
      type="button"
      aria-label={ariaLabel}
      aria-pressed={checked}
      disabled={disabled}
      whileTap={disabled ? undefined : tightPressTap}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      className={cn(
        "flex size-[18px] shrink-0 items-center justify-center rounded-[3px] border border-[var(--secondary-text)]",
        checked && "border-[var(--accent-blue)] bg-[var(--accent-blue)]",
        disabled && "opacity-45",
      )}
    >
      <AnimatePresence initial={false}>
        {checked ? (
          <motion.span {...checkPopMotion}>
            <Check className="size-3 text-[var(--primary-text)]" strokeWidth={1.9} />
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

function normalizePath(path: string | undefined): string {
  return (path ?? "").replace(/\\/gu, "/").toLowerCase();
}

function isAudioFile(path: string | undefined): boolean {
  return /\.(wav|wave|flac|mp3|m4a|aac|ogg|oga|opus|aiff|aif|aifc|wma|webm|mp4|caf|amr)$/iu.test(path ?? "");
}
