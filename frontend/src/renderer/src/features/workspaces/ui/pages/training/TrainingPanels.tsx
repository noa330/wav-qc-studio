import type { VoiceTrainingModel, VoiceTrainingSettings } from "@shared/ipc";
import { type ReactNode } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { SelectField } from "@/shared/components/controls";
import { softPressTap } from "@/shared/motion";
import { gptPretrainedDefaults, usesGptSovitsLora } from "../../../model/voice-training-pretrained";
import type { WorkspaceRuntime } from "../../../state/use-workspace-runtime";
import { WorkspaceSplitPane, WorkspaceSplitSectionLayout } from "../../shared/WorkspaceSplitSectionLayout";
import { ModelSelectionPanel, ModelOptionItem, NumberSetting, SelectSetting, ToggleSetting } from "../../shared/workspace-panel-primitives";
import { defaultTrainingModelNames } from "./training-panel-config";

export { TrainingSettingsBody } from "./TrainingSettingsBody";

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
    <div className="h-full min-h-0 min-w-0">
      {settings.selectedModel === "gpt-sovits" ? (
        <WorkspaceSplitSectionLayout
          left={(
            <TrainingStageSection
              title="SoVITS 모델 훈련"
              footerText="소스, 화자 변환 및 음성 합성 품질 개선에 최적화됩니다."
            >
              <TrainingSettingGrid columns={2}>
                <NumberSetting
                  label="배치 크기"
                  value={settings.gptSovitsBatchSize}
                  min={1}
                  onChange={(value) => update("gptSovitsBatchSize", value)}
                  help="한 번의 학습 스텝에 사용될 데이터 배치 크기입니다. GPU 메모리가 허용하는 한 높게 설정하면 학습이 안정화됩니다."
                  layout="vertical"
                />
                <NumberSetting
                  label="총 에포크"
                  value={settings.gptSovitsEpochs}
                  min={1}
                  onChange={(value) => update("gptSovitsEpochs", value)}
                  help="전체 데이터셋을 반복하여 학습할 총 횟수입니다."
                  layout="vertical"
                />
                <NumberSetting
                  label="저장 주기"
                  value={settings.gptSovitsSaveEveryEpoch}
                  min={1}
                  onChange={(value) => update("gptSovitsSaveEveryEpoch", value)}
                  help="지정된 에포크 주기마다 체크포인트를 저장합니다."
                  layout="vertical"
                />
                {gptSovitsUsesLora ? (
                  <SelectSetting
                    label="LoRA rank"
                    help="LoRA 가중치의 계수(Rank)입니다. 높을수록 더 정밀하게 피팅되지만 파라미터가 늘어납니다."
                    layout="vertical"
                  >
                    <SelectField
                      value={String(settings.gptLoraRank) as (typeof loraRankOptions)[number]["value"]}
                      options={[...loraRankOptions]}
                      onChange={(value) => update("gptLoraRank", Number(value))}
                      ariaLabel="LoRA rank"
                    />
                  </SelectSetting>
                ) : (
                  <NumberSetting
                    label="텍스트 LR 비율"
                    value={settings.gptTextLowLrRate}
                    min={0.2}
                    max={0.6}
                    step={0.05}
                    onChange={(value) => update("gptTextLowLrRate", value)}
                    help="텍스트 인코더의 학습률 비율입니다. 낮을수록 기존 가중치를 보존합니다."
                    layout="vertical"
                  />
                )}
                <ToggleSetting
                  label="최신 저장"
                  checked={settings.gptSovitsSaveLatest}
                  onChange={(value) => update("gptSovitsSaveLatest", value)}
                  help="항상 최신 에포크의 체크포인트 하나만 보존하여 디스크 공간을 절약합니다."
                />
                <ToggleSetting
                  label="가중치 저장"
                  checked={settings.gptSovitsSaveEveryWeights}
                  onChange={(value) => update("gptSovitsSaveEveryWeights", value)}
                  help="지정된 주기마다 추론 전용 가중치 파일(.pth)을 추출하여 저장합니다."
                />
                {gptSovitsUsesLora ? (
                  <ToggleSetting
                    label="그래디언트 체크포인트"
                    checked={settings.gptGradCheckpoint}
                    onChange={(value) => update("gptGradCheckpoint", value)}
                    help="메모리 절약을 위해 역전파 시 그래디언트를 다시 계산합니다."
                  />
                ) : null}
              </TrainingSettingGrid>
            </TrainingStageSection>
          )}
          right={(
            <TrainingStageSection
              title="GPT 모델 훈련"
              footerText="텍스트 생성 품질 및 자연스러움을 향상시킵니다."
            >
              <TrainingSettingGrid columns={2}>
                <NumberSetting
                  label="배치 크기"
                  value={settings.gptBatchSize}
                  min={1}
                  onChange={(value) => update("gptBatchSize", value)}
                  help="GPT 모델 학습의 배치 크기입니다. GPU 메모리가 허용하는 한 높게 설정하면 학습이 안정화됩니다."
                  layout="vertical"
                />
                <NumberSetting
                  label="총 에포크"
                  value={settings.gptEpochs}
                  min={1}
                  onChange={(value) => update("gptEpochs", value)}
                  help="GPT 모델 학습의 총 에포크 횟수입니다."
                  layout="vertical"
                />
                <NumberSetting
                  label="저장 주기"
                  value={settings.gptSaveEveryEpoch}
                  min={1}
                  onChange={(value) => update("gptSaveEveryEpoch", value)}
                  help="지정된 에포크 주기마다 GPT 체크포인트를 저장합니다."
                  layout="vertical"
                />
                <div className="self-end pb-[2px]">
                  <ToggleSetting
                    label="최신 저장"
                    checked={settings.gptSaveLatest}
                    onChange={(value) => update("gptSaveLatest", value)}
                    help="항상 최신 에포크의 GPT 체크포인트만 보존합니다."
                  />
                </div>
                <ToggleSetting
                  label="가중치 저장"
                  checked={settings.gptSaveEveryWeights}
                  onChange={(value) => update("gptSaveEveryWeights", value)}
                  help="지정된 주기마다 GPT 추론 전용 가중치를 저장합니다."
                />
                <ToggleSetting
                  label="DPO"
                  checked={settings.gptDpo}
                  onChange={(value) => update("gptDpo", value)}
                  help="직접 선호도 최적화(Direct Preference Optimization) 기법을 사용하여 텍스트 생성의 일관성과 품질을 대폭 향상시킵니다."
                />
              </TrainingSettingGrid>
            </TrainingStageSection>
          )}
        />
      ) : (
        <WorkspaceSplitPane>
          <TrainingStageSection
            title="OmniVoice 모델 훈련"
            footerText="대화형 음성 합성 및 대규모 언어 모델 학습에 최적화됩니다."
          >
            <TrainingSettingGrid columns={4}>
              <NumberSetting
                label="총 스텝"
                value={settings.omniSteps}
                min={1}
                onChange={(value) => update("omniSteps", value)}
                help="학습을 진행할 총 스텝(Step) 수입니다."
                layout="vertical"
              />
              <NumberSetting
                label="저장 주기"
                value={settings.omniSaveSteps}
                min={1}
                onChange={(value) => update("omniSaveSteps", value)}
                help="몇 스텝마다 체크포인트를 저장할지 지정합니다."
                layout="vertical"
              />
              <NumberSetting
                label="로그 주기"
                value={settings.omniLoggingSteps}
                min={1}
                onChange={(value) => update("omniLoggingSteps", value)}
                help="학습 상태(Loss 등)를 몇 스텝마다 기록할지 지정합니다."
                layout="vertical"
              />
              <NumberSetting
                label="학습률"
                value={settings.omniLearningRate}
                min={0}
                step={0.000001}
                onChange={(value) => update("omniLearningRate", value)}
                help="학습 속도 및 수렴 수준을 결정하는 기본 학습률입니다."
                layout="vertical"
              />
              <NumberSetting
                label="배치 토큰"
                value={settings.omniBatchTokens}
                min={1}
                onChange={(value) => update("omniBatchTokens", value)}
                help="한 배치에 포함될 총 토큰 수의 한계입니다."
                layout="vertical"
              />
              <NumberSetting
                label="그래디언트 누적"
                value={settings.omniGradientAccumulationSteps}
                min={1}
                onChange={(value) => update("omniGradientAccumulationSteps", value)}
                help="가상으로 배치를 늘리기 위해 그래디언트를 누적할 스텝 수입니다."
                layout="vertical"
              />
              <SelectSetting
                label="정밀도"
                help="학습 시 사용할 부동소수점 정밀도(FP16, BF16 등) 방식입니다."
                layout="vertical"
              >
                <SelectField
                  value={settings.omniMixedPrecision}
                  options={[...mixedPrecisionOptions]}
                  onChange={(value) => update("omniMixedPrecision", value)}
                  ariaLabel="OmniVoice 정밀도"
                />
              </SelectSetting>
              <NumberSetting
                label="최대 배치"
                value={settings.omniMaxBatchSize}
                min={1}
                onChange={(value) => update("omniMaxBatchSize", value)}
                help="배치 구성 시 허용할 최대 배치 크기입니다."
                layout="vertical"
              />
              <NumberSetting
                label="최대 샘플 토큰"
                value={settings.omniMaxSampleTokens}
                min={1}
                onChange={(value) => update("omniMaxSampleTokens", value)}
                help="학습 데이터 한 샘플당 허용할 최대 토큰 수입니다."
                layout="vertical"
              />
              <NumberSetting
                label="최소 샘플 토큰"
                value={settings.omniMinSampleTokens}
                min={1}
                onChange={(value) => update("omniMinSampleTokens", value)}
                help="학습 데이터 한 샘플당 허용할 최소 토큰 수입니다."
                layout="vertical"
              />
            </TrainingSettingGrid>
          </TrainingStageSection>
        </WorkspaceSplitPane>
      )}
    </div>
  );
}

interface TrainingStageSectionProps {
  title: string;
  footerText: string;
  children: ReactNode;
}

function TrainingStageSection({ title, footerText, children }: TrainingStageSectionProps) {
  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <div className="mb-4 flex min-h-8 w-full shrink-0 items-center overflow-hidden">
        <h3 className="min-w-0 truncate whitespace-nowrap text-base font-semibold leading-5 text-[var(--primary-text)]">
          {title}
        </h3>
      </div>

      <div className="flex flex-1 flex-col gap-4 overflow-auto bg-transparent">
        {children}
      </div>

      <div className="mt-5 shrink-0">
        <div
          className="flex min-h-[38px] items-center rounded-[5px] border border-[var(--panel-stroke)] bg-[var(--table-header-bg)] px-3 py-2.5 text-xs font-normal leading-5 text-[var(--secondary-text)]"
        >
          <span className="truncate" title={footerText}>{footerText}</span>
        </div>
      </div>
    </section>
  );
}

const trainingSettingGridClass = {
  2: "grid-cols-2",
  4: "grid-cols-4",
} as const;

function TrainingSettingGrid({ columns, children }: { columns: keyof typeof trainingSettingGridClass; children: ReactNode }) {
  return <div className={cn("grid min-w-0 gap-x-4 gap-y-4", trainingSettingGridClass[columns])}>{children}</div>;
}
