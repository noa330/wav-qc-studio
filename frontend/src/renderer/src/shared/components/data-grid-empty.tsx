export function EmptyDataGrid({ emptyText }: { emptyText: string }) {
  return (
    <div className="flex h-full min-h-[150px] items-center justify-center rounded-[5px] border border-[var(--panel-stroke)] bg-transparent text-sm text-[var(--secondary-text)]">
      {emptyText}
    </div>
  );
}
