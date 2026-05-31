import type { ReactNode } from "react";
import { AppPersistenceProvider, useAppPersistence } from "@/app/app-persistence";
import { ThemeProvider } from "@/app/theme-provider";
import { WorkspaceRuntimeProvider } from "@/features/workspaces/state/use-workspace-runtime";

export function AppCompositionRoot({ children }: { children: ReactNode }) {
  return (
    <AppPersistenceProvider>
      <ThemeProviderWithProjectKey>
        <ProjectRuntimeRoot>{children}</ProjectRuntimeRoot>
      </ThemeProviderWithProjectKey>
    </AppPersistenceProvider>
  );
}

function ThemeProviderWithProjectKey({ children }: { children: ReactNode }) {
  const persistence = useAppPersistence();
  return <ThemeProvider key={persistence.activeProjectId}>{children}</ThemeProvider>;
}

function ProjectRuntimeRoot({ children }: { children: ReactNode }) {
  const persistence = useAppPersistence();
  return <WorkspaceRuntimeProvider key={persistence.activeProjectId}>{children}</WorkspaceRuntimeProvider>;
}
