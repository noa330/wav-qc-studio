import type { TrainingCheckpointSummary, TrainingModelListResult, VoiceInferenceSettings, VoiceTrainingSettings } from "@shared/ipc";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { studioBackend } from "@/services/studio-backend";
import { ComboboxField, SelectField, ToggleSwitch } from "@/shared/components/controls";
import type { GptVersion } from "../../../model/voice-training-pretrained";
import type { WorkspaceRuntime } from "../../../state/use-workspace-runtime";
import { NumberSetting, SelectSetting, SettingGroup, TextSetting } from "../../shared/workspace-panel-primitives";
import {
  defaultGptLanguageForVersion,
  gptLanguageOptionsForVersion,
  gptModeOptions,
  gptVersionOptions,
  inferenceSettingFieldHelp,
  inferenceSettingHelp,
  supportedGptLanguage,
  textSplitOptions,
} from "./inference-settings-config";

const emptyCheckpoints: TrainingCheckpointSummary[] = [];

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
              <CheckpointSelect label="SoVITS 체크포인트" help={inferenceSettingFieldHelp.gptCheckpointSovitsPath} loading={modelListLoading} checkpoints={sovitsCheckpoints} selectedPath={selectedGptSovitsPath} onRefresh={refreshTrainingModels} onChange={(checkpoint) => update("gptCheckpointSovitsPath", checkpoint.path)} />
              <CheckpointSelect label="GPT 체크포인트" help={inferenceSettingFieldHelp.gptCheckpointGptPath} loading={modelListLoading} checkpoints={gptCheckpoints} selectedPath={selectedGptGptPath} onRefresh={refreshTrainingModels} onChange={(checkpoint) => update("gptCheckpointGptPath", checkpoint.path)} />
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
            <CheckpointSelect label="체크포인트" help={inferenceSettingFieldHelp.omniCheckpointPath} loading={modelListLoading} checkpoints={omniCheckpoints} selectedPath={selectedOmniCheckpointPath} onRefresh={refreshTrainingModels} onChange={(checkpoint) => update("omniCheckpointPath", checkpoint.path)} />
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
