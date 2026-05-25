import type { OverviewSettings } from "@shared/ipc";
import { ToggleSwitch } from "@/shared/components/controls";
import type { WorkspaceRuntime } from "../../../state/use-workspace-runtime";
import { NumberSetting, SelectSetting, SettingGroup } from "../../shared/workspace-panel-primitives";

const overviewSettingHelp = {
  modules: "RUN 시 활성화할 스코어 분석 작업입니다. 최소 1개 이상 켜져 있어야 백엔드 분석이 시작됩니다.",
  noise: "torchmetrics DNSMOS 노이즈 점수 계산에 전달되는 공식 인자와 기존 백엔드 기본값입니다.",
  analyzeNoise: "--noise 작업을 켭니다. 켜면 DNSMOS BAK/SIG/OVRL/P808 점수를 생성합니다.",
  noiseSampleRate: "DNSMOS 입력 리샘플링 주파수입니다. torchmetrics DNSMOS 기본 사용값인 16000을 기본으로 둡니다.",
  noisePersonalized: "DNSMOS personalized 인자입니다. 개인화 모델 점수 계산 모드를 사용할지 정합니다.",
  noiseNumThreads: "DNSMOS ONNX Runtime num_threads 인자입니다. 0은 백엔드에서 자동값처럼 전달됩니다.",
  noiseRequireCudaProvider: "기존 백엔드 GPU 프로바이더 점검을 실행할지 정합니다.",
  noiseBakBadThreshold: "BAK 점수 판정 기준으로 쓰기 위해 보관하던 백엔드 기본값입니다. 현재 결과 컬럼에는 원점수를 표시합니다.",
} as const;

export function OverviewModulesBody({ runtime }: { runtime: WorkspaceRuntime }) {
  const overview = runtime.settings.overview;
  const update = <K extends keyof OverviewSettings>(key: K, value: OverviewSettings[K]) => {
    runtime.setSettings((current) => ({ ...current, overview: { ...current.overview, [key]: value } }));
  };

  return (
    <div className="space-y-3">
      <ModuleToggleRow label="노이즈" checked={overview.analyzeNoise} onChange={(checked) => update("analyzeNoise", checked)} />
    </div>
  );
}

function ModuleToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <div className="grid min-h-[30px] grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
      <p className="truncate text-sm font-normal text-[var(--primary-text)]">{label}</p>
      <ToggleSwitch checked={checked} onChange={onChange} />
    </div>
  );
}

export function OverviewModelSettingsBody({ runtime }: { runtime: WorkspaceRuntime }) {
  const overview = runtime.settings.overview;
  const update = <K extends keyof OverviewSettings>(key: K, value: OverviewSettings[K]) => {
    runtime.setSettings((current) => ({ ...current, overview: { ...current.overview, [key]: value } }));
  };

  return (
    <div className="app-scrollbar h-full min-w-0 overflow-auto pr-1">
      <SettingGroup title="노이즈 점수 모델" help={overviewSettingHelp.noise}>
        <NumberSetting label="sample rate" help={overviewSettingHelp.noiseSampleRate} value={overview.noiseSampleRate} onChange={(value) => update("noiseSampleRate", value)} />
        <SelectSetting label="personalized" help={overviewSettingHelp.noisePersonalized}>
          <ToggleSwitch checked={overview.noisePersonalized} onChange={(checked) => update("noisePersonalized", checked)} />
        </SelectSetting>
        <NumberSetting label="threads" help={overviewSettingHelp.noiseNumThreads} value={overview.noiseNumThreads} onChange={(value) => update("noiseNumThreads", value)} />
        <SelectSetting label="CUDA 필수" help={overviewSettingHelp.noiseRequireCudaProvider}>
          <ToggleSwitch checked={overview.noiseRequireCudaProvider} onChange={(checked) => update("noiseRequireCudaProvider", checked)} />
        </SelectSetting>
        <NumberSetting label="BAK 기준" help={overviewSettingHelp.noiseBakBadThreshold} value={overview.noiseBakBadThreshold} step={0.1} onChange={(value) => update("noiseBakBadThreshold", value)} />
      </SettingGroup>
    </div>
  );
}
