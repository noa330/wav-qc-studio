import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Plus } from "lucide-react";
import { motion } from "motion/react";
import { useAppPersistence } from "@/app/app-persistence";
import { cn } from "@/lib/utils";
import { DialogTextField, AppDialog } from "@/shared/components/dialog";
import { DropdownMenuHeader, DropdownMenuOption, DropdownMenuSeparator, DropdownMenuSurface } from "@/shared/components/dropdown-menu";
import { softPressTap } from "@/shared/motion";

export function ProjectSelector({ disabled = false, compact = false }: { disabled?: boolean; compact?: boolean }) {
  const persistence = useAppPersistence();
  const [open, setOpen] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [menuGeometry, setMenuGeometry] = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuDisabled = disabled || persistence.projectSwitching;

  const updateMenuGeometry = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }

    const width = Math.max(230, Math.min(320, window.innerWidth - 16));
    const left = clampNumber(rect.right - width, 8, Math.max(8, window.innerWidth - width - 8));
    const estimatedHeight = Math.min(360, 58 + persistence.projects.length * 36);
    const belowTop = rect.bottom + 6;
    const belowSpace = window.innerHeight - belowTop - 8;
    const aboveSpace = rect.top - 14;
    const opensAbove = belowSpace < 150 && aboveSpace > belowSpace;
    const maxHeight = opensAbove ? Math.max(132, aboveSpace) : Math.max(132, belowSpace);
    const top = opensAbove ? Math.max(8, rect.top - Math.min(estimatedHeight, maxHeight) - 6) : belowTop;

    setMenuGeometry({ left, top, width, maxHeight });
  }, [persistence.projects.length]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    updateMenuGeometry();
    window.addEventListener("resize", updateMenuGeometry);
    window.addEventListener("scroll", updateMenuGeometry, true);
    return () => {
      window.removeEventListener("resize", updateMenuGeometry);
      window.removeEventListener("scroll", updateMenuGeometry, true);
    };
  }, [open, updateMenuGeometry]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const close = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target || triggerRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }

      setOpen(false);
    };

    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  useEffect(() => {
    if (menuDisabled) {
      setOpen(false);
    }
  }, [menuDisabled]);

  const handleCreateProject = () => {
    setOpen(false);
    setCreateDialogOpen(true);
  };

  const handleSwitchProject = (projectId: string) => {
    setOpen(false);
    void persistence.switchProject(projectId);
  };

  return (
    <>
      <div className={cn("flex min-w-0 items-center", compact && "max-w-[210px]")} data-status-widget-interactive="true" onPointerDown={(event) => event.stopPropagation()}>
        <span className="mr-2 text-sm font-normal text-[var(--secondary-text)]">프로젝트</span>
        <motion.button
          ref={triggerRef}
          type="button"
          disabled={menuDisabled}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="프로젝트 선택"
          title={menuDisabled ? "실행 중에는 프로젝트를 바꿀 수 없습니다." : persistence.activeProject.name}
          onClick={() => setOpen((current) => !current)}
          whileTap={menuDisabled ? undefined : softPressTap}
          className={cn("flex h-8 min-w-0 items-center gap-1.5 bg-transparent px-0 text-sm font-normal text-[var(--primary-text)] outline-none transition-colors hover:text-[var(--accent-blue)] disabled:pointer-events-none disabled:opacity-45", compact ? "max-w-36" : "max-w-48")}
        >
          <span className="min-w-0 truncate">{persistence.activeProject.name}</span>
          <ChevronDown className={cn("size-3.5 shrink-0 text-[var(--control-arrow)] transition-transform", open && "rotate-180")} strokeWidth={1.9} />
        </motion.button>
        {open && menuGeometry
          ? createPortal(
              <DropdownMenuSurface
                ref={menuRef}
                role="menu"
                className="z-[1160]"
                style={{ left: menuGeometry.left, top: menuGeometry.top, width: menuGeometry.width, maxHeight: menuGeometry.maxHeight }}
              >
                <DropdownMenuHeader>{"\ud504\ub85c\uc81d\ud2b8 \uc120\ud0dd"}</DropdownMenuHeader>
                <DropdownMenuOption
                  role="menuitem"
                  checkable={false}
                  icon={<Plus className="size-4" strokeWidth={1.9} />}
                  label={"\uc0c8 \ud504\ub85c\uc81d\ud2b8 \ucd94\uac00"}
                  onClick={handleCreateProject}
                />
                <DropdownMenuSeparator className="opacity-80" />
                {persistence.projects.map((project) => {
                  const selected = project.id === persistence.activeProjectId;
                  return (
                    <DropdownMenuOption
                      key={project.id}
                      role="menuitemradio"
                      aria-checked={selected}
                      disabled={selected}
                      checked={selected}
                      label={project.name}
                      onClick={() => handleSwitchProject(project.id)}
                    />
                  );
                })}
              </DropdownMenuSurface>,
              document.body,
            )
          : null}
      </div>
      {createDialogOpen ? <ProjectCreateDialog onClose={() => setCreateDialogOpen(false)} /> : null}
    </>
  );
}

function ProjectCreateDialog({ onClose }: { onClose: () => void }) {
  const persistence = useAppPersistence();
  const [name, setName] = useState(() => nextProjectName(persistence.projects.map((project) => project.name)));
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (creating) {
      return;
    }

    const projectName = normalizeProjectDraftName(name);
    if (!projectName) {
      setError("프로젝트 이름을 입력하세요.");
      return;
    }
    if (persistence.projects.some((project) => normalizeProjectDraftName(project.name).toLocaleLowerCase() === projectName.toLocaleLowerCase())) {
      setError("같은 이름의 프로젝트가 이미 있습니다.");
      return;
    }

    setCreating(true);
    setError("");
    void persistence.createProject(projectName)
      .then((result) => {
        if (result.ok) {
          onClose();
          return;
        }

        setError(result.error ?? "프로젝트를 만들 수 없습니다.");
        setCreating(false);
      })
      .catch((createError: unknown) => {
        setError(createError instanceof Error ? createError.message : String(createError));
        setCreating(false);
      });
  };

  return (
    <AppDialog
      title="새 프로젝트"
      onClose={creating ? () => undefined : onClose}
      footer={
        <>
          <button type="button" className="wpf-button px-4 text-sm" onClick={onClose} disabled={creating}>취소</button>
          <button type="submit" form="project-create-form" className="wpf-primary-button px-4 text-sm disabled:opacity-60" disabled={creating}>
            {creating ? "생성 중..." : "생성"}
          </button>
        </>
      }
    >
      <form id="project-create-form" onSubmit={submit}>
        <DialogTextField
          id="project-name"
          label="프로젝트 이름"
          value={name}
          placeholder="프로젝트 이름"
          autoFocus
          disabled={creating}
          error={error}
          onChange={(value) => {
            setName(value);
            if (error) {
              setError("");
            }
          }}
        />
      </form>
    </AppDialog>
  );
}

function nextProjectName(names: string[]): string {
  const normalizedNames = new Set(names.map((name) => normalizeProjectDraftName(name).toLocaleLowerCase()).filter(Boolean));
  for (let index = 1; index < 1000; index += 1) {
    const candidate = `프로젝트${index}`;
    if (!normalizedNames.has(candidate.toLocaleLowerCase())) {
      return candidate;
    }
  }

  return `프로젝트${Date.now().toString(36)}`;
}

function normalizeProjectDraftName(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
