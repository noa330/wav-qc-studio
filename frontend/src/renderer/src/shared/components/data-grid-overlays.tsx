import { useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { ClipboardPaste, Copy, MousePointer2, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { DropdownMenuSurface } from "@/shared/components/dropdown-menu";
import { dialogPanelMotion, menuMotion, softPressTap } from "@/shared/motion";
import type { ColumnMenuState, GridMenuState } from "./data-grid-types";

export function ColumnFilterMenu({ refEl, menu, children }: { refEl: RefObject<HTMLDivElement | null>; menu: ColumnMenuState; children: ReactNode }) {
  return createPortal(
    <DropdownMenuSurface
      ref={refEl}
      className="z-[1300]"
      style={{ left: menu.left, top: menu.top, width: menu.width, maxHeight: 320 }}
      onMouseDown={(event) => event.preventDefault()}
    >
      {children}
    </DropdownMenuSurface>,
    document.body,
  );
}

export function GridContextMenu({
  refEl,
  menu,
  canCopy,
  canPaste,
  canDeleteSheet,
  onNewSheet,
  onDeleteSheet,
  onCopy,
  onPaste,
  onSelectAll,
}: {
  refEl: RefObject<HTMLDivElement | null>;
  menu: GridMenuState;
  canCopy: boolean;
  canPaste: boolean;
  canDeleteSheet: boolean;
  onNewSheet?: () => void;
  onDeleteSheet?: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onSelectAll: () => void;
}) {
  return createPortal(
    <motion.div
      ref={refEl}
      {...menuMotion}
      className="fixed z-[1100] min-w-[180px] rounded-[4px] border border-[var(--panel-stroke)] bg-[var(--popover)] py-1 text-sm shadow-[var(--app-menu-shadow)]"
      style={{ left: menu.x, top: menu.y }}
    >
      {onNewSheet ? <MenuItem icon={<Plus className="size-4" />} label="새 시트" onClick={onNewSheet} /> : null}
      {onDeleteSheet ? <MenuItem icon={<Trash2 className="size-4" />} label="시트 삭제" disabled={!canDeleteSheet} onClick={onDeleteSheet} /> : null}
      <MenuItem icon={<Copy className="size-4" />} label="복사" disabled={!canCopy} onClick={onCopy} />
      <MenuItem icon={<ClipboardPaste className="size-4" />} label="붙여넣기" disabled={!canPaste} onClick={onPaste} />
      <div className="my-1 h-px bg-[var(--panel-stroke)]" />
      <MenuItem icon={<MousePointer2 className="size-4" />} label="전체 선택" onClick={onSelectAll} />
    </motion.div>,
    document.body,
  );
}

export function DuplicatePasteDialog({ count, onOverwrite, onSkip, onClose }: { count: number; onOverwrite: () => void; onSkip: () => void; onClose: () => void }) {
  const [applyAll, setApplyAll] = useState(true);
  return createPortal(
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={menuMotion.transition} className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/45 px-4">
      <motion.div {...dialogPanelMotion} className="w-[430px] rounded-[5px] border border-[var(--panel-stroke)] bg-[var(--shell-chrome-card-bg)] p-4 shadow-[var(--app-dialog-shadow)]">
        <h4 className="text-base font-normal text-[var(--primary-text)]">같은 오디오가 있습니다</h4>
        <p className="mt-3 text-sm leading-5 text-[var(--secondary-text)]">같은 경로의 오디오 {count}개가 현재 시트에 이미 있습니다. 붙여넣을 행으로 덮어쓰거나 기존 행을 유지하고 건너뛸 수 있습니다.</p>
        <label className="mt-4 flex items-center gap-2 text-sm text-[var(--primary-text)]">
          <input type="checkbox" checked={applyAll} onChange={(event) => setApplyAll(event.target.checked)} />
          같은 충돌에 이 선택 계속 적용
        </label>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="wpf-button px-4 text-sm" onClick={onClose}>
            취소
          </button>
          <button type="button" className="wpf-button px-4 text-sm" onClick={() => (applyAll ? onSkip() : onSkip())}>
            건너뛰기
          </button>
          <button type="button" className="wpf-primary-button px-4 text-sm" onClick={() => (applyAll ? onOverwrite() : onOverwrite())}>
            덮어쓰기
          </button>
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}

function MenuItem({ icon, label, disabled, onClick }: { icon: ReactNode; label: string; disabled?: boolean; onClick: () => void }) {
  return (
    <motion.button
      type="button"
      disabled={disabled}
      onClick={onClick}
      whileTap={disabled ? undefined : softPressTap}
      className={cn(
        "grid h-9 w-full grid-cols-[22px_minmax(0,1fr)] items-center gap-2 px-3 text-left text-[var(--primary-text)] hover:bg-[var(--soft-selection-hover)]",
        disabled && "text-[var(--secondary-text)] opacity-55 hover:bg-transparent",
      )}
    >
      {icon}
      <span>{label}</span>
    </motion.button>
  );
}
