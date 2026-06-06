export function WorkspaceSelectedAudioInfo({
  audioPath,
}: {
  audioPath: string;
}) {
  const filename = audioPath.split(/[\\/]/).filter(Boolean).pop() ?? "";

  return (
    <div className="flex min-w-0 shrink items-center text-left">
      <h3 className="min-w-0 truncate whitespace-nowrap text-base font-semibold leading-5 text-[var(--primary-text)]" title={filename}>
        {filename}
      </h3>
    </div>
  );
}
