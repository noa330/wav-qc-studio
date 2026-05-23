import { SpotlightTour } from "@/shared/components/spotlight-tour";
import { appTourSteps, type AppGuideTourStep } from "./app-tour-steps";

export function AppTour({
  open,
  onClose,
  onStepChange,
}: {
  open: boolean;
  onClose: () => void;
  onStepChange?: (stepIndex: number, step: AppGuideTourStep) => void;
}) {
  return (
    <SpotlightTour
      open={open}
      steps={appTourSteps}
      ariaLabel="기능 가이드"
      onClose={onClose}
      onStepChange={onStepChange ? (stepIndex, step) => onStepChange(stepIndex, step as AppGuideTourStep) : undefined}
    />
  );
}
