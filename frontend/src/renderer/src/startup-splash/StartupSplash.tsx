import { Check } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { StartupSplashProgress, StartupSplashStep } from "@shared/ipc";
import { createStartupSplashSteps } from "@shared/startup-splash";
import logoUrl from "../assets/brand/wav-qc-studio-circle.png";
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
  const theme = useMemo(() => new URLSearchParams(window.location.search).get("theme") ?? "dark", []);
  const presentation = useStartupSplashPresentation(progress, defaultSteps);
  const progressPercent = presentation.progressPercent;
  const steps = presentation.steps;

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "light") {
      root.classList.add("light");
      root.classList.remove("dark");
    } else {
      root.classList.add("dark");
      root.classList.remove("light");
    }
  }, [theme]);

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
        <div className="startup-splash__content">
          <header className="startup-splash__brand">
            <img className="startup-splash__logo" src={logoUrl} alt="" aria-hidden="true" draggable={false} />
            <div className="startup-splash__title-block">
              <h1>WAV QC Studio</h1>
              <p>Audio Slice &amp; QC Suite</p>
            </div>
          </header>

          <div className="startup-splash__status-row">
            <div className="startup-splash__status">
              <strong>{progress.statusText}</strong>
              {progress.detailText ? <span>{progress.detailText}</span> : null}
            </div>
            <span className="startup-splash__progress-value">{progressPercent}%</span>
          </div>

          <div className="startup-splash__progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPercent}>
            <div className="startup-splash__progress-fill" style={{ width: `${progressPercent}%` }} />
          </div>

          <div className="startup-splash__steps">
            {steps.map((step) => (
              <div key={step.id} className="startup-splash__step" data-state={step.state}>
                <span className="startup-splash__step-label">{step.label}</span>
                <StepCheckbox state={step.state} />
              </div>
            ))}
          </div>

        </div>


        <footer className="startup-splash__footer">
          <span className="startup-splash__footer-group">
            <span>WAV QC Studio</span>
            <span>v{appVersion}</span>
          </span>
          <span>© 2024 WAV QC Studio. All rights reserved.</span>
        </footer>
      </section>
    </main>
  );
}

function StepCheckbox({ state }: { state: StartupSplashStep["state"] }) {
  if (state === "done") {
    return (
      <span className="startup-splash__step-checkbox startup-splash__step-checkbox--done" aria-label="완료">
        <Check size={13} strokeWidth={3} />
      </span>
    );
  }

  return <span className={`startup-splash__step-checkbox startup-splash__step-checkbox--${state}`} aria-label={state === "active" ? "진행 중" : "대기"} />;
}

function clampProgress(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(100, value));
}
