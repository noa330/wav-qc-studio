import type { StartupSplashStep } from "./ipc";

export const startupSplashFullRevealAnimationMs = 2000;

export const startupSplashStepIds = ["state-file", "app-state", "render"] as const;

export type StartupSplashStepId = typeof startupSplashStepIds[number];

const startupSplashStepLabels: Record<StartupSplashStepId, string> = {
  "state-file": "저장 상태 파일 읽기",
  "app-state": "공통 앱 상태 복원",
  render: "초기 화면 렌더 준비",
};

export function createStartupSplashSteps(activeStepId?: StartupSplashStepId): StartupSplashStep[] {
  const activeIndex = activeStepId ? startupSplashStepIds.indexOf(activeStepId) : startupSplashStepIds.length;
  return startupSplashStepIds.map((id, index) => ({
    id,
    label: startupSplashStepLabels[id],
    state: resolveStartupStepState(index, activeIndex, activeStepId),
  }));
}

export function progressForStartupStep(stepId: StartupSplashStepId, stepProgressPercent: number): number {
  const stepIndex = Math.max(0, startupSplashStepIds.indexOf(stepId));
  const stepSize = 100 / startupSplashStepIds.length;
  return clampProgress(stepIndex * stepSize + stepSize * (clampProgress(stepProgressPercent) / 100));
}

function resolveStartupStepState(index: number, activeIndex: number, activeStepId?: StartupSplashStepId): StartupSplashStep["state"] {
  if (!activeStepId || index < activeIndex) {
    return "done";
  }

  return index === activeIndex ? "active" : "pending";
}

function clampProgress(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(100, value));
}
