import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { NumericField } from "@/shared/components/controls";
import { tightPressTap, uiSpring } from "@/shared/motion";

export function GridFooter({
  instanceId = "grid-footer",
  totalRows,
  pageSize,
  pageIndex,
  pageCount,
  onPageSizeChange,
  onPageChange,
}: {
  instanceId?: string;
  totalRows: number;
  pageSize: number;
  pageIndex: number;
  pageCount: number;
  onPageSizeChange: (value: number) => void;
  onPageChange: (index: number) => void;
}) {
  const footerRef = useRef<HTMLDivElement | null>(null);
  const [compact, setCompact] = useState(false);
  const pageNumbers = buildPageNumbers(pageIndex, pageCount);

  useEffect(() => {
    const footer = footerRef.current;
    if (!footer) {
      return;
    }

    const updateCompact = () => {
      setCompact(footer.getBoundingClientRect().width < 430);
    };
    updateCompact();
    const observer = new ResizeObserver(updateCompact);
    observer.observe(footer);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={footerRef}
      className={cn(
        "mt-2 grid shrink-0 items-center gap-x-3 px-4 text-[13px] text-[var(--secondary-text)]",
        compact ? "h-[76px] grid-cols-[auto_minmax(0,1fr)_auto] grid-rows-[38px_38px]" : "h-[38px] grid-cols-[auto_minmax(0,1fr)_auto]",
      )}
    >
      <div className={cn("grid grid-cols-[auto_82px] items-center gap-2", compact && "col-start-1 row-start-1")}>
        <span>페이지당</span>
        <NumericField value={pageSize} min={1} step={1} wheelStep={1} ariaLabel="페이지당 행 수" onChange={onPageSizeChange} />
      </div>
      <div className={cn("flex min-w-0 items-center justify-center gap-2 overflow-hidden", compact && "col-span-3 col-start-1 row-start-2")}>
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
                "relative flex h-7 min-w-7 items-center justify-center overflow-hidden rounded-[3px] px-2 text-[13px] font-medium text-[var(--primary-text)]",
                page === pageIndex ? "bg-[var(--accent-blue)]" : "bg-transparent hover:text-[var(--primary-text)]",
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
      </div>
      <div className={cn("justify-self-end whitespace-nowrap", compact && "col-start-3 row-start-1")}>전체 {totalRows}개 행</div>
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
