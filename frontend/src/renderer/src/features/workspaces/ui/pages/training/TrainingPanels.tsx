import type { TrainingCheckpointSummary, TrainingModelListResult, VoiceTrainingModel, VoiceTrainingSettings } from "@shared/ipc";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { studioBackend } from "@/services/studio-backend";
import { ComboboxField, NumericField, SelectField, ToggleSwitch } from "@/shared/components/controls";
import { softPressTap } from "@/shared/motion";
import { filterTrainingCheckpoints, selectedCheckpointPath, settingsWithGptSovitsAutoCheckpoints } from "../../../model/voice-training-checkpoints";
import { gptPretrainedDefaults, omniPretrainedDefaults, shouldReplaceGptPretrainedPath, type GptVersion } from "../../../model/voice-training-pretrained";
import type { WorkspaceRuntime } from "../../../state/use-workspace-runtime";
import { NumberSetting, SelectSetting, SettingControlSlot, SettingGroup, TextSetting } from "../../shared/workspace-panel-primitives";

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

const emptyCheckpoints: TrainingCheckpointSummary[] = [];
const defaultTrainingModelNames: Record<VoiceTrainingModel, string> = {
  "gpt-sovits": "gpt_sovits_train",
  omnivoice: "omnivoice_train",
};
const generatedTrainingModelNames = new Set([...Object.values(defaultTrainingModelNames), "speaker_unknown_train"].map((name) => name.toLowerCase()));

const trainingSettingHelp = {
  common: "학습 실행에 공통으로 전달되는 모델 루트, 모델명, GPU, 유휴 타임아웃 설정입니다. 학습 모델 목록과 체크포인트 탐색의 기준이 됩니다.",
  gptSovits: "GPT-SoVITS SoVITS 단계의 재개 체크포인트와 pretrained_s2G/s2D 경로를 지정합니다. 선택한 버전의 공식 로그 및 체크포인트 구조를 사용합니다.",
  gptModel: "GPT-SoVITS GPT 단계의 재개 체크포인트와 pretrained_s1 경로를 지정합니다. GPT_weights 및 logs_s1 체크포인트 목록과 연결됩니다.",
  omniVoice: "OmniVoice 학습 재개, 초기 체크포인트, LLM 경로, 모델 저장 방식을 지정합니다. work/omnivoice 모델 실험 폴더의 체크포인트 구조를 사용합니다.",
} as const;

const trainingSettingFieldHelp = {
  toolRoot: "학습 도구가 설치된 루트 경로입니다. 비워두면 앱의 기본 학습 레포 경로를 사용합니다.",
  modelName: "학습 결과와 체크포인트를 묶는 모델 이름입니다. 선택한 학습 모델 목록에서 기존 항목을 고를 수 있습니다.",
  gpu: "학습 프로세스에 전달할 GPU 지정 값입니다. 여러 장을 쓸 때는 실행 스크립트가 받는 형식에 맞춰 입력합니다.",
  idleTimeoutSec: "학습 백엔드가 작업 없이 대기하다가 자동 종료되는 시간입니다.",
  gptPretrainedS2G: "GPT-SoVITS SoVITS generator 초기 가중치 경로입니다.",
  gptPretrainedS2D: "GPT-SoVITS SoVITS discriminator 초기 가중치 경로입니다.",
  gptPretrainedS1: "GPT-SoVITS GPT 단계 초기 가중치 경로입니다.",
  omniLlmNameOrPath: "OmniVoice 학습에 사용할 LLM 이름 또는 로컬 경로입니다.",
  omniInitFromCheckpoint: "OmniVoice 학습을 처음 시작할 때 기반으로 삼을 초기 체크포인트입니다.",
  omniResumeFromCheckpoint: "OmniVoice 학습을 이어서 실행할 때 사용할 기존 체크포인트입니다.",
  omniModelOnlyCheckpoint: "체크포인트 저장 시 모델 가중치 중심으로 저장할지 결정합니다.",
} as const;

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

  return (
    <div className="app-scrollbar h-full min-h-0 min-w-0 space-y-3 overflow-auto pr-1">
      <TrainingModelOption
        title="GPT-SoVITS"
        subtitle=".list 데이터셋, 텍스트/SSL/시맨틱 전처리, SoVITS와 GPT 체크포인트"
        checked={settings.selectedModel === "gpt-sovits"}
        onSelect={() => selectModel("gpt-sovits")}
      />
      <TrainingModelOption
        title="OmniVoice"
        subtitle=".jsonl/.json 데이터셋, 오디오 토큰 추출, 스텝 기준 체크포인트"
        checked={settings.selectedModel === "omnivoice"}
        onSelect={() => selectModel("omnivoice")}
      />
    </div>
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

function shouldAutoReplaceTrainingModelName(modelName: string): boolean {
  const normalized = modelName.trim().toLowerCase();
  return !normalized || generatedTrainingModelNames.has(normalized);
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
    <div className="h-[38px] w-[144px] min-w-0 font-normal [&_button]:font-normal [&_button]:leading-5 [&_span]:font-normal">
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

function TrainingModelOption({ title, subtitle, checked, onSelect }: { title: string; subtitle: string; checked: boolean; onSelect: () => void }) {
  return (
    <motion.button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onSelect}
      whileTap={softPressTap}
      className={cn(
        "grid w-full min-w-0 grid-cols-[18px_minmax(0,1fr)] items-center gap-2 rounded-[5px] bg-transparent px-2 py-2.5 text-left transition-[background-color,border-color] focus-visible:outline-none",
        checked
          ? "border-2 border-[var(--nav-selected-bg)]"
          : "border border-[var(--panel-stroke)] hover:bg-[var(--soft-selection-hover)] focus-visible:border-2 focus-visible:border-[var(--nav-selected-bg)] focus-visible:bg-[var(--soft-selection-hover)]",
      )}
    >
      <span className={cn("relative size-[18px] rounded-full border border-[var(--panel-stroke)]", checked && "border-[var(--accent-blue)]")}>
        {checked ? <span className="absolute left-1/2 top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--accent-blue)]" /> : null}
      </span>
      <div className="min-w-0">
        <span className="text-sm font-normal text-[var(--primary-text)]">{title}</span>
        <p className="mt-1 text-[13px] leading-[18px] text-[var(--secondary-text)]">{subtitle}</p>
      </div>
    </motion.button>
  );
}

function TrainingCheckpointSelect({
  label,
  help,
  loading,
  checkpoints,
  selectedCheckpointPath,
  onRefresh,
  onSelectCheckpoint,
}: {
  label: string;
  help?: string;
  loading: boolean;
  checkpoints: TrainingCheckpointSummary[];
  selectedCheckpointPath: string;
  onRefresh: () => Promise<TrainingModelListResult>;
  onSelectCheckpoint: (checkpoint: TrainingCheckpointSummary) => void;
}) {
  const options = checkpoints.map((checkpoint) => ({ value: checkpoint.path, label: checkpoint.label }));
  const selectCheckpoint = (path: string) => {
    const checkpoint = checkpoints.find((candidate) => candidate.path === path);
    if (checkpoint) {
      onSelectCheckpoint(checkpoint);
    }
  };

  return (
    <SelectSetting label={label} help={help}>
      <SelectField
        value={selectedCheckpointPath}
        options={options}
        onChange={selectCheckpoint}
        onOpen={onRefresh}
        ariaLabel={label}
        placeholder={loading ? "체크포인트 확인 중..." : "체크포인트 없음"}
        emptyText={loading ? "체크포인트를 확인하는 중입니다." : "체크포인트가 없습니다."}
      />
    </SelectSetting>
  );
}

export function TrainingSettingsBody({ runtime }: { runtime: WorkspaceRuntime }) {
  const settings = runtime.settings.training;
  const [trainingModels, setTrainingModels] = useState<TrainingModelListResult | null>(null);
  const [modelListLoading, setModelListLoading] = useState(false);
  const mountedRef = useRef(true);
  const requestIdRef = useRef(0);
  const update = <K extends keyof VoiceTrainingSettings>(key: K, value: VoiceTrainingSettings[K]) => {
    runtime.setSettings((current) => ({ ...current, training: { ...current.training, [key]: value } }));
  };

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (settings.selectedModel !== "gpt-sovits") {
      return;
    }

    const defaults = gptPretrainedDefaults[settings.gptVersion];
    if (settings.gptPretrainedS2G.trim() && settings.gptPretrainedS2D.trim() && settings.gptPretrainedS1.trim()) {
      return;
    }

    runtime.setSettings((current) => {
      if (current.training.selectedModel !== "gpt-sovits" || current.training.gptVersion !== settings.gptVersion) {
        return current;
      }

      return {
        ...current,
        training: {
          ...current.training,
          gptPretrainedS2G: current.training.gptPretrainedS2G.trim() ? current.training.gptPretrainedS2G : defaults.s2g,
          gptPretrainedS2D: current.training.gptPretrainedS2D.trim() ? current.training.gptPretrainedS2D : defaults.s2d,
          gptPretrainedS1: current.training.gptPretrainedS1.trim() ? current.training.gptPretrainedS1 : defaults.s1,
        },
      };
    });
  }, [runtime, settings.gptPretrainedS1, settings.gptPretrainedS2D, settings.gptPretrainedS2G, settings.gptVersion, settings.selectedModel]);

  const refreshTrainingModels = useCallback(async () => {
    if (runtime.guideMode) {
      const result: TrainingModelListResult = {
        selectedModel: settings.selectedModel,
        models: [],
      };
      setTrainingModels(result);
      setModelListLoading(false);
      return result;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setModelListLoading(true);

    try {
      const result = await studioBackend.listTrainingModels({ settings });
      if (mountedRef.current && requestIdRef.current === requestId) {
        setTrainingModels(result);
      }
      return result;
    } catch (error) {
      const result: TrainingModelListResult = {
        selectedModel: settings.selectedModel,
        models: [],
        error: error instanceof Error ? error.message : String(error),
      };
      if (mountedRef.current && requestIdRef.current === requestId) {
        setTrainingModels(result);
      }
      return result;
    } finally {
      if (mountedRef.current && requestIdRef.current === requestId) {
        setModelListLoading(false);
      }
    }
  }, [runtime.guideMode, settings.gptVersion, settings.selectedModel, settings.toolRoot]);

  useEffect(() => {
    void refreshTrainingModels();
  }, [refreshTrainingModels]);

  const modelSelectState = useMemo(() => {
    const currentName = settings.modelName.trim();
    const models = trainingModels?.selectedModel === settings.selectedModel ? trainingModels.models : [];
    const selectedModel = models.find((model) => model.name.toLowerCase() === currentName.toLowerCase());
    return {
      options: models.map((model) => ({
        value: model.name,
        label: `${model.name}${model.checkpoints.length ? ` (${model.checkpoints.length})` : ""}`,
      })),
      selectedModel,
    };
  }, [settings.modelName, settings.selectedModel, trainingModels]);

  useEffect(() => {
    if (!trainingModels || trainingModels.selectedModel !== settings.selectedModel) {
      return;
    }

    const currentName = settings.modelName.trim();
    const hasCurrentModel = trainingModels.models.some((model) => model.name.toLowerCase() === currentName.toLowerCase());
    if (hasCurrentModel || !shouldAutoReplaceTrainingModelName(currentName)) {
      return;
    }

    const nextModelName = trainingModels.models[0]?.name ?? defaultTrainingModelNames[settings.selectedModel];
    if (nextModelName === currentName) {
      return;
    }

    runtime.setSettings((current) => ({
      ...current,
      training: {
        ...current.training,
        modelName: nextModelName,
      },
    }));
  }, [runtime, settings.modelName, settings.selectedModel, trainingModels]);

  useEffect(() => {
    runtime.syncTrainingModelCheckpoints(modelSelectState.selectedModel);
  }, [modelSelectState.selectedModel, runtime]);

  const selectedCheckpoints = modelSelectState.selectedModel?.checkpoints ?? emptyCheckpoints;
  const omniCheckpoints = useMemo(() => filterTrainingCheckpoints(selectedCheckpoints, "omnivoice"), [selectedCheckpoints]);
  const selectedOmniCheckpointPath = selectedCheckpointPath(settings.omniResumeFromCheckpoint, omniCheckpoints);

  useEffect(() => {
    if (settings.selectedModel !== "gpt-sovits" || trainingModels?.selectedModel !== settings.selectedModel) {
      return;
    }

    runtime.setSettings((current) => {
      if (current.training.selectedModel !== "gpt-sovits") {
        return current;
      }

      const nextTraining = settingsWithGptSovitsAutoCheckpoints(current.training, selectedCheckpoints);
      if (nextTraining === current.training) {
        return current;
      }

      return {
        ...current,
        training: nextTraining,
      };
    });
  }, [
    modelSelectState.selectedModel,
    runtime,
    selectedCheckpoints,
    settings.selectedModel,
    trainingModels,
  ]);

  useEffect(() => {
    if (settings.selectedModel !== "omnivoice") {
      return;
    }

    runtime.setSettings((current) => {
      if (current.training.selectedModel !== "omnivoice") {
        return current;
      }
      const nextLlm = current.training.omniLlmNameOrPath.trim() || omniPretrainedDefaults.llmNameOrPath;
      const nextInit = current.training.omniInitFromCheckpoint.trim() || omniPretrainedDefaults.initFromCheckpoint;
      if (nextLlm === current.training.omniLlmNameOrPath && nextInit === current.training.omniInitFromCheckpoint) {
        return current;
      }
      return {
        ...current,
        training: {
          ...current.training,
          omniLlmNameOrPath: nextLlm,
          omniInitFromCheckpoint: nextInit,
        },
      };
    });
  }, [runtime, settings.selectedModel]);

  useEffect(() => {
    if (settings.selectedModel !== "omnivoice" || !modelSelectState.selectedModel || omniCheckpoints.length === 0) {
      return;
    }
    const nextCheckpointPath = selectedCheckpointPath(settings.omniResumeFromCheckpoint, omniCheckpoints);
    if (nextCheckpointPath === "" || nextCheckpointPath === settings.omniResumeFromCheckpoint) {
      return;
    }
    update("omniResumeFromCheckpoint", nextCheckpointPath);
  }, [modelSelectState.selectedModel, omniCheckpoints, settings.omniResumeFromCheckpoint, settings.selectedModel]);

  const selectOmniCheckpoint = (checkpoint: TrainingCheckpointSummary) => {
    update("omniResumeFromCheckpoint", checkpoint.path);
  };

  return (
    <div className="app-scrollbar h-full min-w-0 overflow-auto pr-1">
      <SettingGroup title="공통" help={trainingSettingHelp.common}>
        <TextSetting label="툴 루트" value={settings.toolRoot} onChange={(value) => update("toolRoot", value)} help={trainingSettingFieldHelp.toolRoot} />
        <SelectSetting label="모델명" help={trainingSettingFieldHelp.modelName}>
          <ComboboxField value={settings.modelName} options={modelSelectState.options} onChange={(value) => update("modelName", value)} ariaLabel="모델명" />
        </SelectSetting>
        <TextSetting label="GPU" value={settings.gpu} onChange={(value) => update("gpu", value)} help={trainingSettingFieldHelp.gpu} />
        <NumberSetting label="유휴 타임아웃" value={settings.idleTimeoutSec} min={60} max={7200} onChange={(value) => update("idleTimeoutSec", value)} help={trainingSettingFieldHelp.idleTimeoutSec} />
      </SettingGroup>

      {settings.selectedModel === "gpt-sovits" ? (
        <>
          <SettingGroup title="GPT-SoVITS" help={trainingSettingHelp.gptSovits}>
            <TextSetting label="pretrained_s2G" value={settings.gptPretrainedS2G} onChange={(value) => update("gptPretrainedS2G", value)} help={trainingSettingFieldHelp.gptPretrainedS2G} />
            <TextSetting label="pretrained_s2D" value={settings.gptPretrainedS2D} onChange={(value) => update("gptPretrainedS2D", value)} help={trainingSettingFieldHelp.gptPretrainedS2D} />
          </SettingGroup>
          <SettingGroup title="GPT 모델" help={trainingSettingHelp.gptModel}>
            <TextSetting label="pretrained_s1" value={settings.gptPretrainedS1} onChange={(value) => update("gptPretrainedS1", value)} help={trainingSettingFieldHelp.gptPretrainedS1} />
          </SettingGroup>
        </>
      ) : (
        <SettingGroup title="OmniVoice 모델" help={trainingSettingHelp.omniVoice}>
          <TextSetting label="LLM" value={settings.omniLlmNameOrPath} onChange={(value) => update("omniLlmNameOrPath", value)} help={trainingSettingFieldHelp.omniLlmNameOrPath} />
          <TextSetting label="초기 체크포인트" value={settings.omniInitFromCheckpoint} onChange={(value) => update("omniInitFromCheckpoint", value)} help={trainingSettingFieldHelp.omniInitFromCheckpoint} />
          <TrainingCheckpointSelect
            label="이어하기 체크포인트"
            help={trainingSettingFieldHelp.omniResumeFromCheckpoint}
            loading={modelListLoading}
            checkpoints={omniCheckpoints}
            selectedCheckpointPath={selectedOmniCheckpointPath}
            onRefresh={refreshTrainingModels}
            onSelectCheckpoint={selectOmniCheckpoint}
          />
          <SelectSetting label="모델만 저장" help={trainingSettingFieldHelp.omniModelOnlyCheckpoint}>
            <ToggleSwitch checked={settings.omniModelOnlyCheckpoint !== false} onChange={(value) => update("omniModelOnlyCheckpoint", value)} />
          </SelectSetting>
        </SettingGroup>
      )}
    </div>
  );
}
