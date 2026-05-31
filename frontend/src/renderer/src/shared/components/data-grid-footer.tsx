import { type ReactNode } from "react";
import { motion } from "motion/react";
import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { tightPressTap, uiSpring } from "@/shared/motion";

export function GridFooter({
  instanceId = "grid-footer",
  totalRows,
  pageSize,
  pageIndex,
  pageCount,
  onPageChange,
  widgetSlot,
}: {
  instanceId?: string;
  totalRows: number;
  pageSize: number;
  pageIndex: number;
  pageCount: number;
  onPageChange: (index: number) => void;
  widgetSlot?: ReactNode;
}) {
  const pageNumbers = buildPageNumbers(pageIndex, pageCount);
  const start = totalRows === 0 ? 0 : pageIndex * pageSize + 1;
  const end = Math.min(pageIndex * pageSize + pageSize, totalRows);

  return (
    <div className="my-2 flex h-[32px] shrink-0 items-center justify-between px-4 text-[13px] text-[var(--secondary-text)]">
      {/* 왼쪽: Showing 1-8 of 12,842 */}
      <span className="shrink-0 whitespace-nowrap font-medium text-[var(--secondary-text)]">
        {totalRows === 0 ? "Showing 0-0 of 0" : `Showing ${start.toLocaleString()}-${end.toLocaleString()} of ${totalRows.toLocaleString()}`}
      </span>

      {/* 오른쪽: 원래의 페이지 네비게이션 디자인 복구 + 우측 이동 */}
      <div className="flex items-center gap-1">
        <FooterButton disabled={pageIndex === 0} onClick={() => onPageChange(0)} label="처음">
          <ChevronFirst className="size-[18px]" strokeWidth={1.9} />
        </FooterButton>
        <FooterButton disabled={pageIndex === 0} onClick={() => onPageChange(pageIndex - 1)} label="이전">
          <ChevronLeft className="size-[18px]" strokeWidth={1.9} />
        </FooterButton>
        {pageNumbers.map((page, index) =>
          page === "ellipsis" ? (
            <span key={`ellipsis-${index}`} className="flex h-7 min-w-7 items-center justify-center text-[13px] text-[var(--secondary-text)]">
              ...
            </span>
          ) : (
            <motion.button
              key={page}
              type="button"
              onClick={() => onPageChange(page)}
              whileTap={tightPressTap}
              className={cn(
                "relative flex h-7 min-w-7 items-center justify-center overflow-hidden rounded-[3px] px-2 text-[13px] font-medium transition-colors",
                page === pageIndex ? "bg-[var(--accent-blue)] text-white" : "bg-transparent text-[var(--primary-text)] hover:text-[var(--primary-text)]",
              )}
            >
              {page === pageIndex ? <motion.span layoutId={`grid-active-page-${instanceId}`} transition={uiSpring} className="absolute inset-0 rounded-[3px] bg-[var(--accent-blue)]" /> : null}
              <span className="relative z-10">{page + 1}</span>
            </motion.button>
          ),
        )}
        <FooterButton disabled={pageIndex >= pageCount - 1} onClick={() => onPageChange(pageIndex + 1)} label="다음">
          <ChevronRight className="size-[18px]" strokeWidth={1.9} />
        </FooterButton>
        <FooterButton disabled={pageIndex >= pageCount - 1} onClick={() => onPageChange(pageCount - 1)} label="끝">
          <ChevronLast className="size-[18px]" strokeWidth={1.9} />
        </FooterButton>

        {/* 하위 호환용 위젯 슬롯 */}
        {widgetSlot ? <div className="ml-3 flex shrink-0 items-center gap-2">{widgetSlot}</div> : null}
      </div>
    </div>
  );
}

function FooterButton({ disabled, onClick, label, children }: { disabled: boolean; onClick: () => void; label: string; children: ReactNode }) {
  return (
    <motion.button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      whileTap={disabled ? undefined : { scale: 0.9 }}
      className="flex size-7 items-center justify-center rounded-[3px] bg-transparent text-[13px] text-[var(--primary-text)] hover:text-[var(--primary-text)] disabled:text-[var(--secondary-text)] disabled:opacity-45"
    >
      {children}
    </motion.button>
  );
}

function buildPageNumbers(pageIndex: number, pageCount: number): Array<number | "ellipsis"> {
  if (pageCount <= 7) {
    return Array.from({ length: pageCount }, (_, index) => index);
  }

  if (pageIndex < 5) {
    return [0, 1, 2, 3, 4, "ellipsis", pageCount - 1];
  }

  if (pageIndex > pageCount - 6) {
    return [0, "ellipsis", pageCount - 5, pageCount - 4, pageCount - 3, pageCount - 2, pageCount - 1];
  }

  return [0, "ellipsis", pageIndex - 1, pageIndex, pageIndex + 1, "ellipsis", pageCount - 1];
}
