import type { TrainingCheckpointSummary, TrainingModelListResult, VoiceTrainingSettings } from "@shared/ipc";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { studioBackend } from "@/services/studio-backend";
import { ComboboxField, SelectField, ToggleSwitch } from "@/shared/components/controls";
import { filterTrainingCheckpoints, selectedCheckpointPath, settingsWithGptSovitsAutoCheckpoints } from "../../../model/voice-training-checkpoints";
import { gptPretrainedDefaults, gptVersionOptions, omniPretrainedDefaults, trainingSettingsWithGptVersion, type GptVersion } from "../../../model/voice-training-pretrained";
import type { WorkspaceRuntime } from "../../../state/use-workspace-runtime";
import { NumberSetting, SelectSetting, SettingGroup, TextSetting } from "../../shared/workspace-panel-primitives";
import { defaultTrainingModelNames, shouldAutoReplaceTrainingModelName } from "./training-panel-config";

const emptyCheckpoints: TrainingCheckpointSummary[] = [];

const trainingSettingHelp = {
  common: "학습 실행에 공통으로 전달되는 모델 루트, 모델명, GPU, 유휴 타임아웃 설정입니다. GPT-SoVITS 선택 시 버전도 이 기준에 맞춰 관리합니다.",
  gptSovits: "GPT-SoVITS SoVITS 단계의 재개 체크포인트와 pretrained_s2G/s2D 경로를 지정합니다. 선택한 버전의 공식 로그 및 체크포인트 구조를 사용합니다.",
  gptModel: "GPT-SoVITS GPT 단계의 재개 체크포인트와 pretrained_s1 경로를 지정합니다. GPT_weights 및 logs_s1 체크포인트 목록과 연결됩니다.",
  omniVoice: "OmniVoice 학습 재개, 초기 체크포인트, LLM 경로, 모델 저장 방식을 지정합니다. work/omnivoice 모델 실험 폴더의 체크포인트 구조를 사용합니다.",
} as const;

const trainingSettingFieldHelp = {
  toolRoot: "학습 도구가 설치된 루트 경로입니다. 비워두면 앱의 기본 학습 레포 경로를 사용합니다.",
  modelName: "학습 결과와 체크포인트를 묶는 모델 이름입니다. 선택한 학습 모델 목록에서 기존 항목을 고를 수 있습니다.",
  gptVersion: "GPT와 SoVITS pretrained 경로, 로그/체크포인트 루트, 버전별 훈련 기본값을 함께 맞추는 GPT-SoVITS 모델 패밀리입니다.",
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
  const updateGptVersion = (gptVersion: GptVersion) => {
    runtime.setSettings((current) => ({ ...current, training: trainingSettingsWithGptVersion(current.training, gptVersion) }));
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
        {settings.selectedModel === "gpt-sovits" ? (
          <SelectSetting label="GPT-SoVITS 버전" help={trainingSettingFieldHelp.gptVersion}>
            <SelectField value={settings.gptVersion} options={[...gptVersionOptions]} onChange={(value) => updateGptVersion(value)} ariaLabel="GPT-SoVITS 버전" />
          </SelectSetting>
        ) : null}
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
