import type { ReactNode } from "react";
import { AppPersistenceProvider, useAppPersistence } from "@/app/app-persistence";
import { WorkspaceRuntimeProvider } from "@/features/workspaces/state/use-workspace-runtime";

export function AppCompositionRoot({ children }: { children: ReactNode }) {
  return (
    <AppPersistenceProvider>
      <ProjectRuntimeRoot>{children}</ProjectRuntimeRoot>
    </AppPersistenceProvider>
  );
}

function ProjectRuntimeRoot({ children }: { children: ReactNode }) {
  const persistence = useAppPersistence();
  return <WorkspaceRuntimeProvider key={persistence.activeProjectId}>{children}</WorkspaceRuntimeProvider>;
}
