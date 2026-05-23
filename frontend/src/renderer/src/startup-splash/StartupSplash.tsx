import { Check, LoaderCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { StartupSplashProgress, StartupSplashStep } from "@shared/ipc";
import { createStartupSplashSteps } from "@shared/startup-splash";
import { useStartupSplashPresentation } from "./startup-splash-presentation";

const progressEventName = "wavqc-startup-progress";
const closeEventName = "wavqc-startup-close";

const defaultSteps: StartupSplashStep[] = createStartupSplashSteps("state-file");

const defaultProgress: StartupSplashProgress = {
  progressPercent: 0,
  statusText: "WAV QC Studio 시작 중...",
  detailText: "저장 상태 파일을 확인하고 있습니다.",
  steps: defaultSteps,
};

export function StartupSplash() {
  const [progress, setProgress] = useState<StartupSplashProgress>(defaultProgress);
  const [closing, setClosing] = useState(false);
  const appVersion = useMemo(() => new URLSearchParams(window.location.search).get("appVersion") ?? "0.1.0", []);
  const presentation = useStartupSplashPresentation(progress, defaultSteps);
  const progressPercent = presentation.progressPercent;
  const steps = presentation.steps;

  useEffect(() => {
    const handleProgress = (event: Event) => {
      const next = (event as CustomEvent<StartupSplashProgress>).detail;
      if (!next) {
        return;
      }

      setProgress((current) => ({
        ...current,
        ...next,
        progressPercent: clampProgress(Math.max(current.progressPercent, next.progressPercent)),
        steps: next.steps ?? current.steps,
      }));
    };

    const handleClose = () => setClosing(true);

    window.addEventListener(progressEventName, handleProgress);
    window.addEventListener(closeEventName, handleClose);
    return () => {
      window.removeEventListener(progressEventName, handleProgress);
      window.removeEventListener(closeEventName, handleClose);
    };
  }, []);

  return (
    <main className={`startup-splash${closing ? " startup-splash--closing" : ""}`} aria-live="polite">
      <section className="startup-splash__card" aria-label="WAV QC Studio loading">
        <div className="startup-splash__glow" aria-hidden="true" />
        <div className="startup-splash__mark" aria-hidden="true">
          <div className="startup-splash__bars">
            <span className="startup-splash__dot" />
            {Array.from({ length: 5 }, (_, index) => (
              <span key={index} className="startup-splash__bar" />
            ))}
            <span className="startup-splash__dot" />
          </div>
        </div>

        <div className="startup-splash__title-block">
          <h1>WAV QC Studio</h1>
          <p>Professional Audio QC &amp; Slicing</p>
        </div>

        <div className="startup-splash__status">
          <strong>{progress.statusText}</strong>
          {progress.detailText ? <span>{progress.detailText}</span> : null}
        </div>

        <div className="startup-splash__progress-row">
          <div className="startup-splash__progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPercent}>
            <div className="startup-splash__progress-fill" style={{ width: `${progressPercent}%` }} />
          </div>
          <span className="startup-splash__progress-value">{progressPercent}%</span>
        </div>

        <div className="startup-splash__steps">
          {steps.map((step) => (
            <div key={step.id} className="startup-splash__step" data-state={step.state}>
              <StepGlyph state={step.state} />
              <span className="startup-splash__step-label">{step.label}</span>
              <span className="startup-splash__step-state">{resolveStepStateLabel(step.state)}</span>
            </div>
          ))}
        </div>

        <footer className="startup-splash__footer">
          <span>Version {appVersion}</span>
          <span>WAV QC Studio</span>
        </footer>
      </section>
    </main>
  );
}

function StepGlyph({ state }: { state: StartupSplashStep["state"] }) {
  if (state === "done") {
    return (
      <span className="startup-splash__step-icon startup-splash__step-icon--done">
        <Check size={13} strokeWidth={3} />
      </span>
    );
  }

  if (state === "active") {
    return (
      <span className="startup-splash__step-icon startup-splash__step-icon--active">
        <LoaderCircle size={17} strokeWidth={2.7} />
      </span>
    );
  }

  return <span className="startup-splash__step-icon startup-splash__step-icon--pending" />;
}

function resolveStepStateLabel(state: StartupSplashStep["state"]): string {
  if (state === "done") {
    return "Done";
  }

  return state === "active" ? "In progress" : "Pending";
}

function clampProgress(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(100, value));
}
