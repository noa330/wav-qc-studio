export function ColumnResizeHandle({ onDragStart, onDoubleClick }: { onDragStart: (clientX: number) => void; onDoubleClick: () => void }) {
  return (
    <button
      type="button"
      aria-label="열 너비 조절"
      data-column-resize-handle
      className="absolute bottom-0 right-0 top-0 z-20 w-2 cursor-col-resize bg-transparent"
      onMouseDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (event.detail > 1) {
          return;
        }
        onDragStart(event.clientX);
      }}
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onDoubleClick();
      }}
    />
  );
}

export function RowResizeHandle({ onDragStart, onDoubleClick }: { onDragStart: (clientY: number) => void; onDoubleClick: () => void }) {
  return (
    <button
      type="button"
      aria-label="행 높이 조절"
      data-row-resize-handle
      className="absolute bottom-[-4px] left-0 right-0 z-30 h-2 cursor-row-resize bg-transparent"
      onMouseDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (event.detail > 1) {
          return;
        }
        onDragStart(event.clientY);
      }}
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onDoubleClick();
      }}
    />
  );
}
