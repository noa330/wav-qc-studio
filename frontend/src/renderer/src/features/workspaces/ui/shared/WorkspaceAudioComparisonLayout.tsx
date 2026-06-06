import type { ReactNode } from "react";
import { ArrowLeftRight } from "lucide-react";
import { WorkspaceSplitSectionLayout } from "./WorkspaceSplitSectionLayout";

export function WorkspaceAudioComparisonLayout({
  left,
  right,
  rootTourTarget,
  leftTourTarget,
  rightTourTarget,
}: {
  left: ReactNode;
  right: ReactNode;
  rootTourTarget?: string;
  leftTourTarget?: string;
  rightTourTarget?: string;
}) {
  return (
    <WorkspaceSplitSectionLayout
      left={left}
      right={right}
      centerAdornment={<ArrowLeftRight className="size-4" />}
      rootTourTarget={rootTourTarget}
      leftTourTarget={leftTourTarget}
      rightTourTarget={rightTourTarget}
    />
  );
}
