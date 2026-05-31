import type { VoiceTrainingModel, VoiceTrainingSettings } from "@shared/ipc";
import { type ReactNode } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { NumericField, SelectField, ToggleSwitch } from "@/shared/components/controls";
import { softPressTap } from "@/shared/motion";
import { gptPretrainedDefaults, shouldReplaceGptPretrainedPath, type GptVersion } from "../../../model/voice-training-pretrained";
import type { WorkspaceRuntime } from "../../../state/use-workspace-runtime";
import { SettingControlSlot, ModelSelectionPanel, ModelOptionItem } from "../../shared/workspace-panel-primitives";
import { defaultTrainingModelNames } from "./training-panel-config";

export { TrainingSettingsBody } from "./TrainingSettingsBody";

const gptVersionOptions = [
  { value: "v1", label: "v1" },
  { value: "v2", label: "v2" },
  { value: "v3", label: "v3" },
  { value: "v4", label: "v4" },
  { value: "v2Pro", label: "v2Pro" },
  { value: "v2ProPlus", label: "v2ProPlus" },
] as const;

const mixedPrecisionOptions = [
  { value: "bf16", label: "bf16" },
  { value: "fp16", label: "fp16" },
  { value: "no", label: "no" },
] as const;

const loraRankOptions = [
  { value: "16", label: "16" },
  { value: "32", label: "32" },
  { value: "64", label: "64" },
  { value: "128", label: "128" },
] as const;


const gptStageDefaults = { epochs: 15, saveEveryEpoch: 5 };
const gptSovitsDefaultsByVersion: Record<GptVersion, { epochs: number; saveEveryEpoch: number }> = {
  v1: { epochs: 8, saveEveryEpoch: 4 },
  v2: { epochs: 8, saveEveryEpoch: 4 },
  v3: { epochs: 2, saveEveryEpoch: 1 },
  v4: { epochs: 2, saveEveryEpoch: 1 },
  v2Pro: { epochs: 8, saveEveryEpoch: 4 },
  v2ProPlus: { epochs: 8, saveEveryEpoch: 4 },
};

function usesGptSovitsLora(version: GptVersion): boolean {
  return version === "v3" || version === "v4";
}

function trainingSettingsWithGptVersion(current: VoiceTrainingSettings, gptVersion: GptVersion): VoiceTrainingSettings {
  const previousDefaults = gptPretrainedDefaults[current.gptVersion];
  const nextDefaults = gptPretrainedDefaults[gptVersion];
  const previousTrainDefaults = gptSovitsDefaultsByVersion[current.gptVersion];
  const nextTrainDefaults = gptSovitsDefaultsByVersion[gptVersion];
  return {
    ...current,
    gptVersion,
    gptSovitsEpochs: current.gptSovitsEpochs === previousTrainDefaults.epochs ? nextTrainDefaults.epochs : current.gptSovitsEpochs,
    gptSovitsSaveEveryEpoch: current.gptSovitsSaveEveryEpoch === previousTrainDefaults.saveEveryEpoch ? nextTrainDefaults.saveEveryEpoch : current.gptSovitsSaveEveryEpoch,
    gptEpochs: current.gptEpochs || gptStageDefaults.epochs,
    gptSaveEveryEpoch: current.gptSaveEveryEpoch || gptStageDefaults.saveEveryEpoch,
    gptPretrainedS2G: shouldReplaceGptPretrainedPath(current.gptPretrainedS2G, previousDefaults.s2g, "s2g") ? nextDefaults.s2g : current.gptPretrainedS2G,
    gptPretrainedS2D: shouldReplaceGptPretrainedPath(current.gptPretrainedS2D, previousDefaults.s2d, "s2d") ? nextDefaults.s2d : current.gptPretrainedS2D,
    gptPretrainedS1: shouldReplaceGptPretrainedPath(current.gptPretrainedS1, previousDefaults.s1, "s1") ? nextDefaults.s1 : current.gptPretrainedS1,
  };
}

export function TrainingModelBody({ runtime }: { runtime: WorkspaceRuntime }) {
  const settings = runtime.settings.training;
  const selectModel = (selectedModel: VoiceTrainingModel) => {
    if (selectedModel === settings.selectedModel) {
      return;
    }

    const nextTraining = trainingSettingsWithSelectedModel(settings, selectedModel);
    runtime.setSettings((current) => ({
      ...current,
      training: trainingSettingsWithSelectedModel(current.training, selectedModel),
    }));
    runtime.syncTrainingModelCheckpoints(undefined, nextTraining);
  };

  const options: ModelOptionItem<VoiceTrainingModel>[] = [
    {
      value: "gpt-sovits",
      title: "GPT-SoVITS",
      description: ".list 데이터셋, 텍스트/SSL/시맨틱 전처리, SoVITS와 GPT 체크포인트",
      badgeText: "훈련 지원",
      badgeType: "purple",
      tags: ["음성 합성", "파인튜닝"],
    },
    {
      value: "omnivoice",
      title: "OmniVoice",
      description: ".jsonl/.json 데이터셋, 오디오 토큰 추출, 스텝 기준 체크포인트",
      badgeText: "훈련 지원",
      badgeType: "blue",
      tags: ["오디오 코덱", "대형 모델"],
    },
  ];

  return (
    <ModelSelectionPanel
      title="학습 모델"
      subtitle="학습에 사용할 모델을 선택하세요."
      options={options}
      selectedValue={settings.selectedModel}
      onSelect={selectModel}
      helpText="모델에 대한 자세한 정보는 도움말을 참고하세요."
      helpHref="https://github.com"
    />
  );
}

function trainingSettingsWithSelectedModel(current: VoiceTrainingSettings, selectedModel: VoiceTrainingModel): VoiceTrainingSettings {
  if (current.selectedModel === selectedModel) {
    return current;
  }
  const defaults = gptPretrainedDefaults[current.gptVersion];
  return {
    ...current,
    selectedModel,
    modelName: defaultTrainingModelNames[selectedModel],
    gptResumeSovitsPath: "",
    gptResumeGptPath: "",
    gptPretrainedS2G: defaults.s2g,
    gptPretrainedS2D: defaults.s2d,
    gptPretrainedS1: defaults.s1,
    omniResumeFromCheckpoint: "",
  };
}

export function TrainingPlanBody({ runtime }: { runtime: WorkspaceRuntime }) {
  const settings = runtime.settings.training;
  const gptSovitsUsesLora = usesGptSovitsLora(settings.gptVersion);
  const update = <K extends keyof VoiceTrainingSettings>(key: K, value: VoiceTrainingSettings[K]) => {
    runtime.setSettings((current) => ({ ...current, training: { ...current.training, [key]: value } }));
  };

  return (
    <div className="app-scrollbar h-full min-h-0 min-w-0 overflow-auto pr-1">
      {settings.selectedModel === "gpt-sovits" ? (
        <div className="grid h-full min-h-0 min-w-0 grid-cols-2 gap-4 overflow-auto [&>section+section]:border-l [&>section+section]:border-[var(--panel-stroke)] [&>section+section]:pl-4">
          <TrainingStagePanel title="SoVITS 모델 훈련" columns={2}>
            <TrainingNumberSetting label="배치 크기" value={settings.gptSovitsBatchSize} min={1} onChange={(value) => update("gptSovitsBatchSize", value)} />
            <TrainingNumberSetting label="총 에포크" value={settings.gptSovitsEpochs} min={1} onChange={(value) => update("gptSovitsEpochs", value)} />
            <TrainingNumberSetting label="저장 주기" value={settings.gptSovitsSaveEveryEpoch} min={1} onChange={(value) => update("gptSovitsSaveEveryEpoch", value)} />
            {gptSovitsUsesLora ? (
              <TrainingSelectSetting label="LoRA rank">
                <SelectField
                  value={String(settings.gptLoraRank) as (typeof loraRankOptions)[number]["value"]}
                  options={[...loraRankOptions]}
                  onChange={(value) => update("gptLoraRank", Number(value))}
                  ariaLabel="LoRA rank"
                />
              </TrainingSelectSetting>
            ) : (
              <TrainingNumberSetting label="텍스트 LR 비율" value={settings.gptTextLowLrRate} min={0.2} max={0.6} step={0.05} onChange={(value) => update("gptTextLowLrRate", value)} />
            )}
            <TrainingToggleSetting label="최신 저장">
              <ToggleSwitch checked={settings.gptSovitsSaveLatest} onChange={(value) => update("gptSovitsSaveLatest", value)} />
            </TrainingToggleSetting>
            <TrainingToggleSetting label="가중치 저장">
              <ToggleSwitch checked={settings.gptSovitsSaveEveryWeights} onChange={(value) => update("gptSovitsSaveEveryWeights", value)} />
            </TrainingToggleSetting>
            {gptSovitsUsesLora ? (
              <TrainingToggleSetting label="그래디언트 체크포인트">
                <ToggleSwitch checked={settings.gptGradCheckpoint} onChange={(value) => update("gptGradCheckpoint", value)} />
              </TrainingToggleSetting>
            ) : null}
          </TrainingStagePanel>
          <TrainingStagePanel title="GPT 모델 훈련" columns={2}>
            <TrainingNumberSetting label="배치 크기" value={settings.gptBatchSize} min={1} onChange={(value) => update("gptBatchSize", value)} />
            <TrainingNumberSetting label="총 에포크" value={settings.gptEpochs} min={1} onChange={(value) => update("gptEpochs", value)} />
            <TrainingNumberSetting label="저장 주기" value={settings.gptSaveEveryEpoch} min={1} onChange={(value) => update("gptSaveEveryEpoch", value)} />
            <TrainingToggleSetting label="최신 저장">
              <ToggleSwitch checked={settings.gptSaveLatest} onChange={(value) => update("gptSaveLatest", value)} />
            </TrainingToggleSetting>
            <TrainingToggleSetting label="가중치 저장">
              <ToggleSwitch checked={settings.gptSaveEveryWeights} onChange={(value) => update("gptSaveEveryWeights", value)} />
            </TrainingToggleSetting>
            <TrainingToggleSetting label="DPO">
              <ToggleSwitch checked={settings.gptDpo} onChange={(value) => update("gptDpo", value)} />
            </TrainingToggleSetting>
          </TrainingStagePanel>
        </div>
      ) : (
        <div className="h-full min-h-0 min-w-0">
          <TrainingStagePanel title="OmniVoice 모델 훈련" columns={4}>
            <TrainingNumberSetting label="총 스텝" value={settings.omniSteps} min={1} onChange={(value) => update("omniSteps", value)} />
            <TrainingNumberSetting label="저장 주기" value={settings.omniSaveSteps} min={1} onChange={(value) => update("omniSaveSteps", value)} />
            <TrainingNumberSetting label="로그 주기" value={settings.omniLoggingSteps} min={1} onChange={(value) => update("omniLoggingSteps", value)} />
            <TrainingNumberSetting label="학습률" value={settings.omniLearningRate} min={0} step={0.000001} onChange={(value) => update("omniLearningRate", value)} />
            <TrainingNumberSetting label="배치 토큰" value={settings.omniBatchTokens} min={1} onChange={(value) => update("omniBatchTokens", value)} />
            <TrainingNumberSetting label="그래디언트 누적" value={settings.omniGradientAccumulationSteps} min={1} onChange={(value) => update("omniGradientAccumulationSteps", value)} />
            <TrainingSelectSetting label="정밀도">
              <SelectField value={settings.omniMixedPrecision} options={[...mixedPrecisionOptions]} onChange={(value) => update("omniMixedPrecision", value)} ariaLabel="OmniVoice 정밀도" />
            </TrainingSelectSetting>
            <TrainingNumberSetting label="최대 배치" value={settings.omniMaxBatchSize} min={1} onChange={(value) => update("omniMaxBatchSize", value)} />
            <TrainingNumberSetting label="최대 샘플 토큰" value={settings.omniMaxSampleTokens} min={1} onChange={(value) => update("omniMaxSampleTokens", value)} />
            <TrainingNumberSetting label="최소 샘플 토큰" value={settings.omniMinSampleTokens} min={1} onChange={(value) => update("omniMinSampleTokens", value)} />
          </TrainingStagePanel>
        </div>
      )}
    </div>
  );
}

export function TrainingPlanHeaderControl({ runtime }: { runtime: WorkspaceRuntime }) {
  const settings = runtime.settings.training;
  if (settings.selectedModel !== "gpt-sovits") {
    return null;
  }

  const updateGptVersion = (gptVersion: GptVersion) => {
    runtime.setSettings((current) => ({ ...current, training: trainingSettingsWithGptVersion(current.training, gptVersion) }));
  };

  return (
    <div className="h-[38px] w-[144px] min-w-0 font-normal [&_button]:font-normal [&_button]:leading-5 [&_span]:font-normal" data-app-tour-target="training-version-control">
      <SelectField value={settings.gptVersion} options={[...gptVersionOptions]} onChange={(value) => updateGptVersion(value)} ariaLabel="GPT-SoVITS 버전" />
    </div>
  );
}

const trainingStageGridClass = {
  2: "grid-cols-2",
  4: "grid-cols-4",
} as const;

function TrainingStagePanel({ title, columns, children }: { title: string; columns: keyof typeof trainingStageGridClass; children: ReactNode }) {
  return (
    <section className="min-h-0 min-w-0 overflow-visible">
      <div className="mb-3 flex min-h-5 min-w-0 items-center gap-1.5">
        <p className="min-w-0 truncate text-sm font-normal text-[var(--primary-text)]">{title}</p>
      </div>
      <div className={cn("grid min-w-0 gap-x-4 gap-y-3", trainingStageGridClass[columns])}>{children}</div>
    </section>
  );
}

function TrainingSettingRow({ label, children, align = "start" }: { label: string; children: ReactNode; align?: "start" | "center" | "end" }) {
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,0.42fr)_minmax(0,1fr)] items-start gap-3">
      <p className="min-w-0 whitespace-normal break-words pt-[9px] text-[13px] leading-[18px] text-[var(--secondary-text)]" title={label}>
        {label}
      </p>
      <SettingControlSlot align={align}>{children}</SettingControlSlot>
    </div>
  );
}

function TrainingNumberSetting({
  label,
  value,
  onChange,
  step,
  min,
  max,
  wheelStep,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  step?: number;
  min?: number;
  max?: number;
  wheelStep?: number;
}) {
  return (
    <TrainingSettingRow label={label}>
      <NumericField value={value} step={step} min={min} max={max} wheelStep={wheelStep} onChange={onChange} ariaLabel={label} />
    </TrainingSettingRow>
  );
}

function TrainingSelectSetting({ label, children }: { label: string; children: ReactNode }) {
  return <TrainingSettingRow label={label}>{children}</TrainingSettingRow>;
}

function TrainingToggleSetting({ label, children }: { label: string; children: ReactNode }) {
  return (
    <TrainingSettingRow label={label} align="end">
      {children}
    </TrainingSettingRow>
  );
}

