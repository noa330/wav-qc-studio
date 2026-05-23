import type { DataTableRow, TrainingCheckpointSummary, TrainingModelListResult, VoiceInferenceSettings, VoiceTrainingSettings } from "@shared/ipc";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { studioBackend } from "@/services/studio-backend";
import { ComboboxField, SelectField, ToggleSwitch } from "@/shared/components/controls";
import { softPressTap } from "@/shared/motion";
import type { GptVersion } from "../../../model/voice-training-pretrained";
import type { WorkspaceRuntime } from "../../../state/use-workspace-runtime";
import { WorkspaceAudioPlaybackPanel } from "../../shared/WorkspaceAudioPlaybackPanel";
import { NumberSetting, SelectSetting, SettingGroup, TextSetting } from "../../shared/workspace-panel-primitives";

const modelOptions = [
  { value: "gpt-sovits", title: "GPT-SoVITS", subtitle: "공식 GPT-SoVITS TTS 파이프라인으로 제로샷 레퍼런스 오디오와 체크포인트 가중치를 사용합니다." },
  { value: "omnivoice", title: "OmniVoice", subtitle: "공식 OmniVoice CLI 추론으로 제로샷 음성 복제, 보이스 디자인, 파인튜닝 체크포인트를 사용합니다." },
] as const;

const gptVersionOptions = [
  { value: "v1", label: "v1" },
  { value: "v2", label: "v2" },
  { value: "v3", label: "v3" },
  { value: "v4", label: "v4" },
  { value: "v2Pro", label: "v2Pro" },
  { value: "v2ProPlus", label: "v2ProPlus" },
] as const;

const gptModeOptions = [
  { value: "zero-shot", label: "제로샷" },
  { value: "checkpoint", label: "학습 체크포인트" },
] as const;

const textSplitOptions = [
  { value: "cut0", label: "cut0" },
  { value: "cut1", label: "cut1" },
  { value: "cut2", label: "cut2" },
  { value: "cut3", label: "cut3" },
  { value: "cut4", label: "cut4" },
  { value: "cut5", label: "cut5" },
] as const;

const gptLanguageOptionsV1 = [
  { value: "all_zh", label: "중국어" },
  { value: "en", label: "영어" },
  { value: "all_ja", label: "일본어" },
  { value: "zh", label: "중국어+영어 혼합" },
  { value: "ja", label: "일본어+영어 혼합" },
  { value: "auto", label: "다국어 혼합" },
] as const;

const gptLanguageOptionsV2 = [
  { value: "all_zh", label: "중국어" },
  { value: "en", label: "영어" },
  { value: "all_ja", label: "일본어" },
  { value: "all_yue", label: "광둥어" },
  { value: "all_ko", label: "한국어" },
  { value: "zh", label: "중국어+영어 혼합" },
  { value: "ja", label: "일본어+영어 혼합" },
  { value: "yue", label: "광둥어+영어 혼합" },
  { value: "ko", label: "한국어+영어 혼합" },
  { value: "auto", label: "다국어 혼합" },
  { value: "auto_yue", label: "다국어 혼합(광둥어)" },
] as const;

const emptyCheckpoints: TrainingCheckpointSummary[] = [];

const inferenceSettingHelp = {
  common: "추론 실행에 공통으로 전달되는 모델 루트, 모델명, GPU, 유휴 타임아웃 설정입니다. 학습 페이지의 모델 목록과 같은 기준으로 체크포인트를 찾습니다.",
  gptSovits: "GPT-SoVITS 추론 모드, 체크포인트, 언어, 샘플링 및 배치 옵션입니다. checkpoint 모드에서는 학습 결과의 SoVITS/GPT 체크포인트를 선택합니다.",
  omniVoice: "OmniVoice 추론 모드, 체크포인트, 언어, 지시문, 샘플링 및 후처리 옵션입니다. checkpoint 모드에서는 학습 결과의 OmniVoice 체크포인트를 사용합니다.",
} as const;

const inferenceSettingFieldHelp = {
  toolRoot: "추론 도구가 설치된 루트 경로입니다. 비워두면 앱의 기본 추론 레포 경로를 사용합니다.",
  modelName: "추론에 사용할 학습 모델 이름입니다. 선택한 모델 타입의 체크포인트 목록과 연결됩니다.",
  gpu: "추론 프로세스에 전달할 GPU 지정 값입니다.",
  idleTimeoutSec: "추론 백엔드가 작업 없이 대기하다가 자동 종료되는 시간입니다.",
  gptVersion: "사용할 GPT-SoVITS 버전입니다. 버전에 따라 언어 옵션과 기본 경로가 달라집니다.",
  gptMode: "제로샷으로 실행할지, 학습된 체크포인트를 사용해 실행할지 선택합니다.",
  gptCheckpointSovitsPath: "checkpoint 모드에서 사용할 SoVITS 체크포인트입니다.",
  gptCheckpointGptPath: "checkpoint 모드에서 사용할 GPT 체크포인트입니다.",
  gptTextLanguage: "합성할 입력 문장의 언어 설정입니다.",
  gptPromptLanguage: "레퍼런스 오디오 대사의 언어 설정입니다.",
  gptTextSplitMethod: "긴 텍스트를 추론 단위로 나누는 방식입니다.",
  gptTopK: "샘플링 후보를 상위 K개 토큰으로 제한합니다.",
  gptTopP: "누적 확률 기준으로 샘플링 후보 범위를 제한합니다.",
  gptTemperature: "샘플링 분포의 무작위성을 조절합니다.",
  gptBatchSize: "한 번에 처리할 추론 배치 크기입니다.",
  gptBatchThreshold: "배치 묶음 기준으로 사용할 임계값입니다.",
  gptSplitBucket: "길이가 비슷한 항목끼리 묶어 배치 처리할지 결정합니다.",
  gptSpeedFactor: "합성 음성의 재생 속도 계수입니다.",
  gptFragmentInterval: "분할된 음성 조각 사이에 둘 간격입니다.",
  gptSeed: "샘플링 재현성을 위한 시드 값입니다.",
  gptParallelInfer: "가능한 경우 GPT-SoVITS 추론을 병렬로 처리합니다.",
  gptRepetitionPenalty: "반복되는 출력을 줄이기 위한 패널티입니다.",
  gptSampleSteps: "확산 샘플링 단계 수입니다.",
  gptSuperSampling: "출력 품질 보정을 위한 슈퍼 샘플링 사용 여부입니다.",
  gptOverlapLength: "분할 조각을 이어 붙일 때 사용할 겹침 길이입니다.",
  gptMinChunkLength: "너무 짧은 조각 생성을 막기 위한 최소 청크 길이입니다.",
  omniMode: "제로샷으로 실행할지, 학습된 OmniVoice 체크포인트를 사용할지 선택합니다.",
  omniCheckpointPath: "checkpoint 모드에서 사용할 OmniVoice 체크포인트입니다.",
  omniLanguage: "OmniVoice 합성 언어 값입니다.",
  omniInstruct: "OmniVoice 모델에 전달할 스타일 또는 발화 지시문입니다.",
  omniNumStep: "OmniVoice 샘플링 단계 수입니다.",
  omniGuidanceScale: "조건 지시를 얼마나 강하게 반영할지 조절합니다.",
  omniSpeed: "합성 음성의 재생 속도입니다.",
  omniDuration: "목표 출력 길이 조정 값입니다.",
  omniTShift: "시간축 이동 보정 값입니다.",
  omniDenoise: "출력 후 노이즈 제거를 적용할지 결정합니다.",
  omniPostprocessOutput: "OmniVoice 출력 후처리를 적용할지 결정합니다.",
  omniLayerPenaltyFactor: "레이어별 반복 또는 불안정 출력을 줄이는 패널티 계수입니다.",
  omniPositionTemperature: "위치 예측 샘플링 온도입니다.",
  omniClassTemperature: "클래스 예측 샘플링 온도입니다.",
} as const;

function gptLanguageOptionsForVersion(version: GptVersion) {
  return version === "v1" ? gptLanguageOptionsV1 : gptLanguageOptionsV2;
}

function defaultGptLanguageForVersion(version: GptVersion): string {
  return version === "v1" ? "all_zh" : "all_ko";
}

function supportedGptLanguage(value: string, options: ReadonlyArray<{ value: string }>): string | undefined {
  return options.some((option) => option.value === value) ? value : undefined;
}

export function InferenceModelBody({ runtime }: { runtime: WorkspaceRuntime }) {
  const settings = runtime.settings.inference;
  const selectModel = (selectedModel: VoiceInferenceSettings["selectedModel"]) => {
    runtime.setSettings((current) => ({
      ...current,
      inference: { ...current.inference, selectedModel },
      training: { ...current.training, selectedModel },
    }));
  };

  return (
    <div className="app-scrollbar h-full min-h-0 min-w-0 space-y-3 overflow-auto pr-1">
      {modelOptions.map((option) => (
        <motion.button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={settings.selectedModel === option.value}
          onClick={() => selectModel(option.value)}
          whileTap={softPressTap}
          className={cn(
            "grid w-full min-w-0 grid-cols-[18px_minmax(0,1fr)] items-center gap-2 rounded-[5px] bg-transparent px-2 py-2.5 text-left transition-[background-color,border-color] focus-visible:outline-none",
            settings.selectedModel === option.value
              ? "border-2 border-[var(--nav-selected-bg)]"
              : "border border-[var(--panel-stroke)] hover:bg-[var(--soft-selection-hover)] focus-visible:border-2 focus-visible:border-[var(--nav-selected-bg)] focus-visible:bg-[var(--soft-selection-hover)]",
          )}
        >
          <span className={cn("relative size-[18px] rounded-full border border-[var(--panel-stroke)]", settings.selectedModel === option.value && "border-[var(--accent-blue)]")}>
            {settings.selectedModel === option.value ? <span className="absolute left-1/2 top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--accent-blue)]" /> : null}
          </span>
          <div className="min-w-0">
            <span className="text-sm font-normal text-[var(--primary-text)]">{option.title}</span>
            <p className="mt-1 text-[13px] leading-[18px] text-[var(--secondary-text)]">{option.subtitle}</p>
          </div>
        </motion.button>
      ))}
    </div>
  );
}

export function InferenceReferenceBody({ runtime }: { runtime: WorkspaceRuntime }) {
  const state = runtime.getState("inference");
  const settings = runtime.settings.inference;
  const audioPath = state.selectedAudioPath || settings.referenceAudioPath;
  useEffect(() => {
    if (!audioPath || audioPath === settings.referenceAudioPath) {
      return;
    }
    runtime.setSettings((current) => ({ ...current, inference: { ...current.inference, referenceAudioPath: audioPath } }));
  }, [audioPath, runtime, settings.referenceAudioPath]);

  return (
    <AudioTranscriptCard
      row={findAudioRow(audioPath)}
      audioPath={audioPath}
      emptyText="왼쪽 브라우저에서 레퍼런스 오디오를 선택하세요."
      label="레퍼런스 대사"
      value={settings.referenceText}
      onChange={(value) => runtime.setSettings((current) => ({ ...current, inference: { ...current.inference, referenceText: value } }))}
    />
  );
}

export function InferenceOutputBody({ runtime }: { runtime: WorkspaceRuntime }) {
  const settings = runtime.settings.inference;
  const state = runtime.getState("inference");
  const outputAudioPath = state.selectedResultAudioPath || settings.outputAudioPath;

  return (
    <AudioTranscriptCard
      row={findAudioRow(outputAudioPath)}
      audioPath={outputAudioPath}
      emptyText="추론을 실행하면 출력 오디오가 생성됩니다."
      label="출력 대본"
      value={settings.outputText}
      onChange={(value) => runtime.setSettings((current) => ({ ...current, inference: { ...current.inference, outputText: value } }))}
    />
  );
}

function AudioTranscriptCard({
  row,
  audioPath,
  emptyText,
  label,
  value,
  onChange,
}: {
  row?: DataTableRow;
  audioPath?: string;
  emptyText: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="grid h-full min-h-0 min-w-0 grid-rows-[calc(50%+12.5px)_auto_minmax(0,calc(50%-37.5px))]">
      <div className="min-h-0 min-w-0 overflow-hidden">
        <WorkspaceAudioPlaybackPanel row={row} audioPath={audioPath} emptyText={emptyText} syncKey={`inference:${label}`} />
      </div>
      <div className="my-3 h-px shrink-0 bg-[var(--panel-stroke)]" />
      <InferenceTranscriptField label={label} value={value} onChange={onChange} />
    </div>
  );
}

function InferenceTranscriptField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="grid min-h-0 min-w-0 grid-cols-[minmax(0,clamp(58px,34%,112px))_minmax(0,1fr)] items-stretch gap-2">
      <label className="min-w-0 pt-[9px] text-[13px] font-normal leading-[18px] text-[var(--secondary-text)]">{label}</label>
      <textarea
        className="wpf-field app-scrollbar h-full min-h-0 min-w-0 resize-none overflow-auto px-3 py-2 text-sm leading-5 text-[var(--primary-text)] outline-none"
        value={value}
        aria-label={label}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function useInferenceTrainingModels(runtime: WorkspaceRuntime, settings: VoiceInferenceSettings) {
  const [trainingModels, setTrainingModels] = useState<TrainingModelListResult | null>(null);
  const [modelListLoading, setModelListLoading] = useState(false);
  const mountedRef = useRef(true);
  const requestIdRef = useRef(0);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
    };
  }, []);

  const buildTrainingSettings = useCallback(
    () => trainingSettingsFromInference(runtime.settings.training, settings),
    [runtime.settings.training, settings],
  );

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
      const result = await studioBackend.listTrainingModels({ settings: buildTrainingSettings() });
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
  }, [buildTrainingSettings, runtime.guideMode, settings.selectedModel]);

  useEffect(() => {
    void refreshTrainingModels();
  }, [refreshTrainingModels]);

  return { trainingModels, modelListLoading, refreshTrainingModels };
}

function trainingSettingsFromInference(training: VoiceTrainingSettings, inference: VoiceInferenceSettings): VoiceTrainingSettings {
  return {
    ...training,
    selectedModel: inference.selectedModel,
    toolRoot: inference.toolRoot,
    modelName: inference.modelName,
    gptVersion: inference.gptVersion,
  };
}

export function InferenceSettingsBody({ runtime }: { runtime: WorkspaceRuntime }) {
  const settings = runtime.settings.inference;
  const { trainingModels, modelListLoading, refreshTrainingModels } = useInferenceTrainingModels(runtime, settings);
  const update = <K extends keyof VoiceInferenceSettings>(key: K, value: VoiceInferenceSettings[K]) => {
    runtime.setSettings((current) => ({ ...current, inference: { ...current.inference, [key]: value } }));
  };

  const modelSelectState = useMemo(() => {
    const models = trainingModels?.selectedModel === settings.selectedModel ? trainingModels.models : [];
    const selectedModel = models.find((model) => model.name.toLowerCase() === settings.modelName.trim().toLowerCase());
    return {
      options: models.map((model) => ({ value: model.name, label: `${model.name}${model.checkpoints.length ? ` (${model.checkpoints.length})` : ""}` })),
      selectedModel,
    };
  }, [settings.modelName, settings.selectedModel, trainingModels]);

  const checkpoints = modelSelectState.selectedModel?.checkpoints ?? emptyCheckpoints;
  const sovitsCheckpoints = useMemo(() => filterInferenceCheckpoints(checkpoints, "sovits"), [checkpoints]);
  const gptCheckpoints = useMemo(() => filterInferenceCheckpoints(checkpoints, "gpt"), [checkpoints]);
  const omniCheckpoints = useMemo(() => filterCheckpoints(checkpoints, "omnivoice"), [checkpoints]);
  const selectedGptSovitsPath = selectedCheckpointPath(settings.gptCheckpointSovitsPath, sovitsCheckpoints);
  const selectedGptGptPath = selectedCheckpointPath(settings.gptCheckpointGptPath, gptCheckpoints);
  const selectedOmniCheckpointPath = selectedCheckpointPath(settings.omniCheckpointPath, omniCheckpoints);
  const gptLanguageOptions = useMemo(() => gptLanguageOptionsForVersion(settings.gptVersion), [settings.gptVersion]);

  useEffect(() => {
    if (settings.selectedModel !== "gpt-sovits" || settings.gptMode !== "checkpoint" || trainingModels?.selectedModel !== settings.selectedModel) {
      return;
    }

    runtime.setSettings((current) => {
      if (current.inference.selectedModel !== "gpt-sovits" || current.inference.gptMode !== "checkpoint") {
        return current;
      }

      const nextSovitsPath = selectedCheckpointPath(current.inference.gptCheckpointSovitsPath, sovitsCheckpoints);
      const nextGptPath = selectedCheckpointPath(current.inference.gptCheckpointGptPath, gptCheckpoints);
      const hasSovitsChange = nextSovitsPath !== current.inference.gptCheckpointSovitsPath;
      const hasGptChange = nextGptPath !== current.inference.gptCheckpointGptPath;
      if (!hasSovitsChange && !hasGptChange) {
        return current;
      }

      return {
        ...current,
        inference: {
          ...current.inference,
          gptCheckpointSovitsPath: nextSovitsPath,
          gptCheckpointGptPath: nextGptPath,
        },
      };
    });
  }, [gptCheckpoints, modelSelectState.selectedModel, runtime, settings.gptCheckpointGptPath, settings.gptCheckpointSovitsPath, settings.gptMode, settings.selectedModel, sovitsCheckpoints, trainingModels]);

  useEffect(() => {
    if (settings.selectedModel !== "omnivoice" || settings.omniMode !== "checkpoint" || trainingModels?.selectedModel !== settings.selectedModel) {
      return;
    }

    runtime.setSettings((current) => {
      if (current.inference.selectedModel !== "omnivoice" || current.inference.omniMode !== "checkpoint") {
        return current;
      }

      const nextCheckpointPath = selectedCheckpointPath(current.inference.omniCheckpointPath, omniCheckpoints);
      if (nextCheckpointPath === current.inference.omniCheckpointPath) {
        return current;
      }

      return {
        ...current,
        inference: {
          ...current.inference,
          omniCheckpointPath: nextCheckpointPath,
        },
      };
    });
  }, [modelSelectState.selectedModel, omniCheckpoints, runtime, settings.omniCheckpointPath, settings.omniMode, settings.selectedModel, trainingModels]);

  useEffect(() => {
    if (settings.selectedModel !== "gpt-sovits") {
      return;
    }

    runtime.setSettings((current) => {
      if (current.inference.selectedModel !== "gpt-sovits" || current.inference.gptVersion !== settings.gptVersion) {
        return current;
      }

      const nextTextLanguage = supportedGptLanguage(current.inference.gptTextLanguage, gptLanguageOptions) ?? defaultGptLanguageForVersion(settings.gptVersion);
      const nextPromptLanguage = supportedGptLanguage(current.inference.gptPromptLanguage, gptLanguageOptions) ?? nextTextLanguage;
      if (nextTextLanguage === current.inference.gptTextLanguage && nextPromptLanguage === current.inference.gptPromptLanguage) {
        return current;
      }

      return {
        ...current,
        inference: {
          ...current.inference,
          gptTextLanguage: nextTextLanguage,
          gptPromptLanguage: nextPromptLanguage,
        },
      };
    });
  }, [gptLanguageOptions, runtime, settings.gptPromptLanguage, settings.gptTextLanguage, settings.gptVersion, settings.selectedModel]);

  const updateGptVersion = (gptVersion: GptVersion) => {
    runtime.setSettings((current) => ({
      ...current,
      inference: {
        ...current.inference,
        gptVersion,
      },
    }));
  };

  return (
    <div className="app-scrollbar h-full min-w-0 overflow-auto pr-1">
      <SettingGroup title="공통" help={inferenceSettingHelp.common}>
        <TextSetting label="툴 루트" value={settings.toolRoot} onChange={(value) => update("toolRoot", value)} help={inferenceSettingFieldHelp.toolRoot} />
        <SelectSetting label="모델명" help={inferenceSettingFieldHelp.modelName}>
          <ComboboxField value={settings.modelName} options={modelSelectState.options} onChange={(value) => update("modelName", value)} ariaLabel="모델명" />
        </SelectSetting>
        <TextSetting label="GPU" value={settings.gpu} onChange={(value) => update("gpu", value)} help={inferenceSettingFieldHelp.gpu} />
        <NumberSetting label="유휴 타임아웃" value={settings.idleTimeoutSec} min={60} max={7200} onChange={(value) => update("idleTimeoutSec", value)} help={inferenceSettingFieldHelp.idleTimeoutSec} />
      </SettingGroup>

      {settings.selectedModel === "gpt-sovits" ? (
        <SettingGroup title="GPT-SoVITS" help={inferenceSettingHelp.gptSovits}>
          <SelectSetting label="버전" help={inferenceSettingFieldHelp.gptVersion}>
            <SelectField value={settings.gptVersion} options={[...gptVersionOptions]} onChange={(value) => updateGptVersion(value)} ariaLabel="GPT-SoVITS 버전" />
          </SelectSetting>
          <SelectSetting label="모드" help={inferenceSettingFieldHelp.gptMode}>
            <SelectField value={settings.gptMode} options={[...gptModeOptions]} onChange={(value) => update("gptMode", value)} ariaLabel="GPT-SoVITS 추론 모드" />
          </SelectSetting>
          {settings.gptMode === "checkpoint" ? (
            <>
              <CheckpointSelect
                label="SoVITS 체크포인트"
                help={inferenceSettingFieldHelp.gptCheckpointSovitsPath}
                loading={modelListLoading}
                checkpoints={sovitsCheckpoints}
                selectedPath={selectedGptSovitsPath}
                onRefresh={refreshTrainingModels}
                onChange={(checkpoint) => update("gptCheckpointSovitsPath", checkpoint.path)}
              />
              <CheckpointSelect
                label="GPT 체크포인트"
                help={inferenceSettingFieldHelp.gptCheckpointGptPath}
                loading={modelListLoading}
                checkpoints={gptCheckpoints}
                selectedPath={selectedGptGptPath}
                onRefresh={refreshTrainingModels}
                onChange={(checkpoint) => update("gptCheckpointGptPath", checkpoint.path)}
              />
            </>
          ) : null}
          <SelectSetting label="합성 문장 언어" help={inferenceSettingFieldHelp.gptTextLanguage}>
            <SelectField value={settings.gptTextLanguage} options={[...gptLanguageOptions]} onChange={(value) => update("gptTextLanguage", value)} ariaLabel="합성 문장 언어" />
          </SelectSetting>
          <SelectSetting label="레퍼런스 대사 언어" help={inferenceSettingFieldHelp.gptPromptLanguage}>
            <SelectField value={settings.gptPromptLanguage} options={[...gptLanguageOptions]} onChange={(value) => update("gptPromptLanguage", value)} ariaLabel="레퍼런스 대사 언어" />
          </SelectSetting>
          <SelectSetting label="텍스트 분할" help={inferenceSettingFieldHelp.gptTextSplitMethod}>
            <SelectField value={settings.gptTextSplitMethod} options={[...textSplitOptions]} onChange={(value) => update("gptTextSplitMethod", value)} ariaLabel="GPT-SoVITS 텍스트 분할 방식" />
          </SelectSetting>
          <NumberSetting label="상위 K" value={settings.gptTopK} min={1} onChange={(value) => update("gptTopK", value)} help={inferenceSettingFieldHelp.gptTopK} />
          <NumberSetting label="누적 확률" value={settings.gptTopP} min={0} max={1} step={0.01} onChange={(value) => update("gptTopP", value)} help={inferenceSettingFieldHelp.gptTopP} />
          <NumberSetting label="온도" value={settings.gptTemperature} min={0} step={0.01} onChange={(value) => update("gptTemperature", value)} help={inferenceSettingFieldHelp.gptTemperature} />
          <NumberSetting label="배치 크기" value={settings.gptBatchSize} min={1} onChange={(value) => update("gptBatchSize", value)} help={inferenceSettingFieldHelp.gptBatchSize} />
          <NumberSetting label="배치 임계값" value={settings.gptBatchThreshold} min={0} step={0.01} onChange={(value) => update("gptBatchThreshold", value)} help={inferenceSettingFieldHelp.gptBatchThreshold} />
          <SelectSetting label="버킷 분할" help={inferenceSettingFieldHelp.gptSplitBucket}><ToggleSwitch checked={settings.gptSplitBucket} onChange={(value) => update("gptSplitBucket", value)} /></SelectSetting>
          <NumberSetting label="속도 계수" value={settings.gptSpeedFactor} min={0.1} step={0.01} onChange={(value) => update("gptSpeedFactor", value)} help={inferenceSettingFieldHelp.gptSpeedFactor} />
          <NumberSetting label="조각 간격" value={settings.gptFragmentInterval} min={0} step={0.01} onChange={(value) => update("gptFragmentInterval", value)} help={inferenceSettingFieldHelp.gptFragmentInterval} />
          <NumberSetting label="시드" value={settings.gptSeed} onChange={(value) => update("gptSeed", value)} help={inferenceSettingFieldHelp.gptSeed} />
          <SelectSetting label="병렬 추론" help={inferenceSettingFieldHelp.gptParallelInfer}><ToggleSwitch checked={settings.gptParallelInfer} onChange={(value) => update("gptParallelInfer", value)} /></SelectSetting>
          <NumberSetting label="반복 패널티" value={settings.gptRepetitionPenalty} min={0} step={0.01} onChange={(value) => update("gptRepetitionPenalty", value)} help={inferenceSettingFieldHelp.gptRepetitionPenalty} />
          <NumberSetting label="샘플 단계" value={settings.gptSampleSteps} min={1} onChange={(value) => update("gptSampleSteps", value)} help={inferenceSettingFieldHelp.gptSampleSteps} />
          <SelectSetting label="슈퍼 샘플링" help={inferenceSettingFieldHelp.gptSuperSampling}><ToggleSwitch checked={settings.gptSuperSampling} onChange={(value) => update("gptSuperSampling", value)} /></SelectSetting>
          <NumberSetting label="겹침 길이" value={settings.gptOverlapLength} min={0} onChange={(value) => update("gptOverlapLength", value)} help={inferenceSettingFieldHelp.gptOverlapLength} />
          <NumberSetting label="최소 청크 길이" value={settings.gptMinChunkLength} min={0} onChange={(value) => update("gptMinChunkLength", value)} help={inferenceSettingFieldHelp.gptMinChunkLength} />
        </SettingGroup>
      ) : (
        <SettingGroup title="OmniVoice" help={inferenceSettingHelp.omniVoice}>
          <SelectSetting label="모드" help={inferenceSettingFieldHelp.omniMode}>
            <SelectField value={settings.omniMode} options={[...gptModeOptions]} onChange={(value) => update("omniMode", value)} ariaLabel="OmniVoice 추론 모드" />
          </SelectSetting>
          {settings.omniMode === "checkpoint" ? (
            <CheckpointSelect
              label="체크포인트"
              help={inferenceSettingFieldHelp.omniCheckpointPath}
              loading={modelListLoading}
              checkpoints={omniCheckpoints}
              selectedPath={selectedOmniCheckpointPath}
              onRefresh={refreshTrainingModels}
              onChange={(checkpoint) => update("omniCheckpointPath", checkpoint.path)}
            />
          ) : null}
          <TextSetting label="언어" value={settings.omniLanguage} onChange={(value) => update("omniLanguage", value)} help={inferenceSettingFieldHelp.omniLanguage} />
          <TextSetting label="지시문" value={settings.omniInstruct} onChange={(value) => update("omniInstruct", value)} help={inferenceSettingFieldHelp.omniInstruct} />
          <NumberSetting label="단계 수" value={settings.omniNumStep} min={1} onChange={(value) => update("omniNumStep", value)} help={inferenceSettingFieldHelp.omniNumStep} />
          <NumberSetting label="유도 강도" value={settings.omniGuidanceScale} min={0} step={0.1} onChange={(value) => update("omniGuidanceScale", value)} help={inferenceSettingFieldHelp.omniGuidanceScale} />
          <NumberSetting label="속도" value={settings.omniSpeed} min={0.1} step={0.01} onChange={(value) => update("omniSpeed", value)} help={inferenceSettingFieldHelp.omniSpeed} />
          <NumberSetting label="길이" value={settings.omniDuration} min={0} step={0.1} onChange={(value) => update("omniDuration", value)} help={inferenceSettingFieldHelp.omniDuration} />
          <NumberSetting label="시간 이동" value={settings.omniTShift} step={0.01} onChange={(value) => update("omniTShift", value)} help={inferenceSettingFieldHelp.omniTShift} />
          <SelectSetting label="노이즈 제거" help={inferenceSettingFieldHelp.omniDenoise}><ToggleSwitch checked={settings.omniDenoise} onChange={(value) => update("omniDenoise", value)} /></SelectSetting>
          <SelectSetting label="후처리" help={inferenceSettingFieldHelp.omniPostprocessOutput}><ToggleSwitch checked={settings.omniPostprocessOutput} onChange={(value) => update("omniPostprocessOutput", value)} /></SelectSetting>
          <NumberSetting label="레이어 패널티" value={settings.omniLayerPenaltyFactor} step={0.1} onChange={(value) => update("omniLayerPenaltyFactor", value)} help={inferenceSettingFieldHelp.omniLayerPenaltyFactor} />
          <NumberSetting label="위치 온도" value={settings.omniPositionTemperature} step={0.1} onChange={(value) => update("omniPositionTemperature", value)} help={inferenceSettingFieldHelp.omniPositionTemperature} />
          <NumberSetting label="클래스 온도" value={settings.omniClassTemperature} step={0.1} onChange={(value) => update("omniClassTemperature", value)} help={inferenceSettingFieldHelp.omniClassTemperature} />
        </SettingGroup>
      )}
    </div>
  );
}

function CheckpointSelect({
  label,
  help,
  loading,
  checkpoints,
  selectedPath,
  onRefresh,
  onChange,
}: {
  label: string;
  help?: string;
  loading: boolean;
  checkpoints: TrainingCheckpointSummary[];
  selectedPath: string;
  onRefresh: () => Promise<TrainingModelListResult>;
  onChange: (checkpoint: TrainingCheckpointSummary) => void;
}) {
  const options = checkpoints.map((checkpoint) => ({ value: checkpoint.path, label: checkpoint.label }));
  const selectCheckpoint = (path: string) => {
    const checkpoint = checkpoints.find((candidate) => candidate.path === path);
    if (checkpoint) {
      onChange(checkpoint);
    }
  };

  return (
    <SelectSetting label={label} help={help}>
      <SelectField
        value={selectedPath}
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

function filterCheckpoints(checkpoints: TrainingCheckpointSummary[], kind: TrainingCheckpointSummary["kind"]): TrainingCheckpointSummary[] {
  return checkpoints.filter((checkpoint) => checkpoint.kind === kind);
}

function filterInferenceCheckpoints(checkpoints: TrainingCheckpointSummary[], kind: "gpt" | "sovits"): TrainingCheckpointSummary[] {
  return checkpoints.filter((checkpoint) => checkpoint.kind === kind && checkpoint.role === "inference" && checkpoint.component !== "discriminator");
}

function selectedCheckpointPath(path: string, checkpoints: TrainingCheckpointSummary[]): string {
  return checkpoints.some((checkpoint) => checkpoint.path === path) ? path : checkpoints[0]?.path ?? "";
}
function findAudioRow(audioPath?: string): DataTableRow | undefined {
  if (!audioPath) {
    return undefined;
  }
  const name = audioPath.split(/[\\/]/u).pop() ?? audioPath;
  return {
    id: audioPath,
    sourcePath: audioPath,
    raw: { fileName: name, originalPath: audioPath },
    cells: { index: "1", fileName: name },
  };
}
