import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type UIEvent,
} from "react";
import { cn } from "@/lib/utils";
import { SCROLL_WINDOW_BUFFER_SCREENS, resolveScrollWindowMetrics } from "@shared/scroll-window";

export type ScrollWindowAlign = "start" | "center" | "end";

export type ScrollWindowHandle = {
  scrollToIndex: (index: number, align?: ScrollWindowAlign) => void;
};

export type ScrollWindowRenderItem = {
  index: number;
  item: unknown;
};

export type ScrollWindowRange = {
  start: number;
  end: number;
  renderedCount: number;
};

export const ScrollWindowViewport = forwardRef<ScrollWindowHandle, {
  itemCount: number;
  itemSize: number;
  itemGap?: number;
  bufferScreens?: number;
  cacheKey?: string;
  className?: string;
  contentClassName?: string;
  onRangeChange?: (range: ScrollWindowRange) => void;
  getItemKey?: (index: number) => string;
  resolveItem?: (index: number) => unknown;
  renderItem: (item: ScrollWindowRenderItem) => ReactNode;
}>(
  function ScrollWindowViewport(
    {
      itemCount,
      itemSize,
      itemGap = 0,
      bufferScreens = SCROLL_WINDOW_BUFFER_SCREENS,
      cacheKey = "",
      className,
      contentClassName,
      onRangeChange,
      getItemKey,
      resolveItem,
      renderItem,
    },
    ref,
  ) {
    const viewportRef = useRef<HTMLDivElement | null>(null);
    const cacheScopeRef = useRef(cacheKey);
    const itemCacheRef = useRef(new Map<number, { key: string; item: unknown }>());
    const [viewport, setViewport] = useState({ height: 0, scrollTop: 0 });
    const [windowStart, setWindowStart] = useState(0);
    const stride = itemSize + itemGap;

    const updateViewport = useCallback(() => {
      const node = viewportRef.current;
      if (!node) {
        return;
      }

      setViewport((current) => {
        const nextHeight = node.clientHeight;
        const nextScrollTop = node.scrollTop;
        return current.height === nextHeight && current.scrollTop === nextScrollTop
          ? current
          : { height: nextHeight, scrollTop: nextScrollTop };
      });
    }, []);

    useLayoutEffect(() => {
      const node = viewportRef.current;
      if (!node) {
        return;
      }

      updateViewport();
      const observer = new ResizeObserver(updateViewport);
      observer.observe(node);
      return () => observer.disconnect();
    }, [updateViewport]);

    const { chunkSize, stepSize } = resolveScrollWindowMetrics({
      viewportExtent: viewport.height,
      itemExtent: stride,
      itemCount,
      bufferScreens,
    });
    const maxWindowStart = Math.max(0, itemCount - chunkSize);
    const visibleRange = useMemo(
      () => ({
        start: Math.min(windowStart, maxWindowStart),
        end: Math.min(itemCount, Math.min(windowStart, maxWindowStart) + chunkSize),
      }),
      [chunkSize, itemCount, maxWindowStart, windowStart],
    );
    const chunkHeight = Math.max(0, (visibleRange.end - visibleRange.start) * stride - itemGap);

    useLayoutEffect(() => {
      setWindowStart((current) => Math.min(current, maxWindowStart));
    }, [maxWindowStart]);

    useImperativeHandle(
      ref,
      () => ({
        scrollToIndex(index, align = "start") {
          const node = viewportRef.current;
          if (!node || itemCount <= 0) {
            return;
          }

          const safeIndex = Math.max(0, Math.min(itemCount - 1, index));
          const nextWindowStart = Math.max(0, Math.min(maxWindowStart, safeIndex - Math.floor((chunkSize - 1) / 2)));
          const localTop = (safeIndex - nextWindowStart) * stride;
          const viewportHeight = node.clientHeight;
          const targetTop =
            align === "center"
              ? localTop - (viewportHeight - itemSize) / 2
              : align === "end"
                ? localTop - viewportHeight + itemSize
                : localTop;

          setWindowStart(nextWindowStart);
          window.requestAnimationFrame(() => {
            node.scrollTop = Math.max(0, targetTop);
            updateViewport();
          });
        },
      }),
      [chunkSize, itemCount, itemSize, maxWindowStart, stride, updateViewport],
    );

    if (cacheScopeRef.current !== cacheKey) {
      cacheScopeRef.current = cacheKey;
      itemCacheRef.current.clear();
    }

    for (const index of itemCacheRef.current.keys()) {
      if (index < visibleRange.start || index >= visibleRange.end) {
        itemCacheRef.current.delete(index);
      }
    }

    const renderedRange = useMemo(
      () => ({ ...visibleRange, renderedCount: Math.max(0, visibleRange.end - visibleRange.start) }),
      [visibleRange],
    );

    useLayoutEffect(() => {
      onRangeChange?.(renderedRange);
    }, [onRangeChange, renderedRange]);

    const handleScroll = (event: UIEvent<HTMLDivElement>) => {
      const node = event.currentTarget;
      const nextScrollTop = node.scrollTop;
      setViewport((current) => (current.scrollTop === nextScrollTop ? current : { ...current, scrollTop: nextScrollTop }));

      const nearTop = nextScrollTop <= stride;
      const nearBottom = nextScrollTop + node.clientHeight >= node.scrollHeight - stride;
      if (nearBottom && visibleRange.end < itemCount) {
        const shift = Math.min(stepSize, itemCount - visibleRange.end);
        setWindowStart((current) => Math.min(maxWindowStart, current + shift));
        window.requestAnimationFrame(() => {
          node.scrollTop = Math.max(0, node.scrollTop - shift * stride);
          updateViewport();
        });
        return;
      }

      if (nearTop && visibleRange.start > 0) {
        const shift = Math.min(stepSize, visibleRange.start);
        setWindowStart((current) => Math.max(0, current - shift));
        window.requestAnimationFrame(() => {
          node.scrollTop = Math.max(0, node.scrollTop + shift * stride);
          updateViewport();
        });
      }
    };

    const visibleItems = [];
    for (let index = visibleRange.start; index < visibleRange.end; index += 1) {
      const itemKey = `${cacheKey}:${getItemKey?.(index) ?? index}`;
      const cached = itemCacheRef.current.get(index);
      const item = cached?.key === itemKey ? cached.item : (resolveItem?.(index) ?? index);
      if (cached?.key !== itemKey) {
        itemCacheRef.current.set(index, { key: itemKey, item });
      }

      visibleItems.push(
        <div key={itemKey} className="scroll-window-item" style={{ height: itemSize, transform: `translateY(${(index - visibleRange.start) * stride}px)` }}>
          {renderItem({ index, item })}
        </div>,
      );
    }

    return (
      <div ref={viewportRef} onScroll={handleScroll} className={cn("scroll-window-viewport h-full min-h-0 overflow-auto", className)}>
        <div className={cn("scroll-window-spacer relative min-h-full", contentClassName)} style={{ height: Math.max(chunkHeight, viewport.height) }}>
          {visibleItems}
        </div>
      </div>
    );
  },
);
