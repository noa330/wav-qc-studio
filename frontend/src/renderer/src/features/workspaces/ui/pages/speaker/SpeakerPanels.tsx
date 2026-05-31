import type { SpeakerInferenceSettings } from "@shared/ipc";
import { SelectField } from "@/shared/components/controls";
import type { WorkspaceRuntime } from "../../../state/use-workspace-runtime";
import { NumberSetting, SelectSetting, SettingGroup, ModelSelectionPanel, ModelOptionItem } from "../../shared/workspace-panel-primitives";

const deviceOptions = [
  { value: "auto", label: "auto" },
  { value: "cuda", label: "cuda" },
  { value: "cpu", label: "cpu" },
] as const;

const voiceFixerModeOptions = [
  { value: "0", label: "0" },
  { value: "1", label: "1" },
  { value: "2", label: "2" },
] as const;

const speakerSettingHelp = {
  sidon: "Sidon 음성 복원 모델 실행에 쓰는 장치, 청크, 입출력 보정 설정입니다.",
  resemble: "Resemble Enhance 음성 향상/노이즈 제거 추론에 쓰는 장치와 샘플링 설정입니다.",
  voiceFixer: "VoiceFixer 보이스 보정 런타임에 쓰는 장치와 restore 모드 설정입니다.",
  sidonDevicePreference: "--sidon-device 값입니다. auto는 사용 가능한 장치를 우선 선택하고, cuda/cpu는 해당 장치 선호값으로 Sidon을 실행합니다.",
  sidonInputPeak: "--sidon-input-peak 값입니다. Sidon 처리 전 입력 레벨의 목표 피크이며 0~1 범위로 보정됩니다.",
  sidonHighPassHz: "--sidon-high-pass-hz 값입니다. 복원 전 저역 잡음을 줄이기 위한 하이패스 기준 주파수입니다.",
  sidonChunkSeconds: "--sidon-chunk-seconds 값입니다. 긴 오디오를 나누어 처리할 청크 길이며 1~600초 범위로 보정됩니다.",
  sidonPrePadding: "--sidon-pre-padding 값입니다. 청크 앞쪽 경계 손실을 줄이기 위해 붙이는 샘플 패딩입니다.",
  sidonTrailingPad: "--sidon-trailing-pad 값입니다. 청크 뒤쪽 경계 손실을 줄이기 위해 붙이는 샘플 패딩입니다.",
  sidonDecoderTrim: "--sidon-decoder-trim 값입니다. 디코더 경계부의 불필요한 샘플을 잘라내는 트림 길이입니다.",
  sidonStereoMixMode: "--sidon-stereo-mix-mode 값입니다. 스테레오 입력을 average, left, right 중 어떤 방식으로 사용할지 정합니다.",
  sidonOutputBitDepth: "--sidon-output-bit-depth 값입니다. Sidon 결과 wav를 pcm16 또는 float32로 저장합니다.",
  resembleDevicePreference: "--resemble-device 값입니다. Resemble Enhance 런타임의 장치 선호값입니다.",
  resembleTask: "--resemble-task 값입니다. denoise_only는 잡음 제거만, enhance는 음성 향상 파이프라인까지 실행합니다.",
  resembleSolver: "--resemble-solver 값입니다. enhance 작업에서 midpoint, rk4, euler 중 샘플링 solver를 선택합니다.",
  resembleNfe: "--resemble-nfe 값입니다. enhance 추론 step 수이며 백엔드에서 1~128 범위로 보정됩니다.",
  resembleTau: "--resemble-tau 값입니다. enhance 호출에 전달되는 tau 파라미터이며 0~1 범위로 보정됩니다.",
  resembleLambda: "--resemble-lambda 값입니다. enhance 호출에 전달되는 lambda 파라미터이며 0~1 범위로 보정됩니다.",
  voiceFixerDevicePreference: "--voicefixer-device 값입니다. VoiceFixer 런타임의 장치 선호값입니다.",
  voiceFixerMode: "--voicefixer-mode 값입니다. 백엔드가 정수 0, 1, 2만 허용하며 해당 restore 모드로 결과 wav를 생성합니다.",
} as const;

export function SpeakerModelBody({ runtime }: { runtime: WorkspaceRuntime }) {
  const settings = runtime.settings.speaker;
  const selectModel = (model: "sidon" | "resemble" | "voicefixer") => {
    runtime.setSettings((current) => ({
      ...current,
      speaker: {
        ...current.speaker,
        useSidon: model === "sidon",
        useResemble: model === "resemble",
        useVoiceFixer: model === "voicefixer",
      },
    }));
  };

  const options: ModelOptionItem<"sidon" | "resemble" | "voicefixer">[] = [
    {
      value: "sidon",
      title: "Sidon",
      description: "고품질 음성 복원에 최적화된 모델입니다.",
      badgeText: "고품질",
      badgeType: "purple",
      tags: ["고품질", "범용"],
    },
    {
      value: "resemble",
      title: "Resemble Enhance",
      description: "음질 향상과 선명도 개선에 특화된 모델입니다.",
      badgeText: "음질 향상",
      badgeType: "green",
      tags: ["선명도 향상", "자연스러움"],
    },
    {
      value: "voicefixer",
      title: "VoiceFixer",
      description: "보이스 보정과 소음 제거에 특화된 모델입니다.",
      badgeText: "노이즈 제거",
      badgeType: "blue",
      tags: ["노이즈 제거", "보이스 보정"],
    },
  ];

  const currentSelectedValue = settings.useSidon ? "sidon" : settings.useResemble ? "resemble" : "voicefixer";

  return (
    <ModelSelectionPanel
      title="디노이즈 모델"
      subtitle="디노이즈에 사용할 모델을 선택하세요."
      options={options}
      selectedValue={currentSelectedValue}
      onSelect={selectModel}
      helpText="모델에 대한 자세한 정보는 도움말을 참고하세요."
      helpHref="https://github.com"
    />
  );
}

export function SpeakerSettingsBody({ runtime }: { runtime: WorkspaceRuntime }) {
  const settings = runtime.settings.speaker;
  const update = <K extends keyof SpeakerInferenceSettings>(key: K, value: SpeakerInferenceSettings[K]) => {
    runtime.setSettings((current) => ({ ...current, speaker: { ...current.speaker, [key]: value } }));
  };

  return (
    <div className="app-scrollbar h-full min-w-0 overflow-auto pr-1">
      {settings.useSidon ? (
        <SettingGroup title="Sidon 설정" help={speakerSettingHelp.sidon}>
          <SelectSetting label="Device" help={speakerSettingHelp.sidonDevicePreference}>
            <SelectField value={settings.sidonDevicePreference} options={[...deviceOptions]} onChange={(value) => update("sidonDevicePreference", value)} ariaLabel="Sidon device" />
          </SelectSetting>
          <NumberSetting label="입력 피크" help={speakerSettingHelp.sidonInputPeak} value={settings.sidonInputPeak} step={0.01} onChange={(value) => update("sidonInputPeak", value)} />
          <NumberSetting label="하이패스 Hz" help={speakerSettingHelp.sidonHighPassHz} value={settings.sidonHighPassHz} onChange={(value) => update("sidonHighPassHz", value)} />
          <NumberSetting label="청크 초" help={speakerSettingHelp.sidonChunkSeconds} value={settings.sidonChunkSeconds} onChange={(value) => update("sidonChunkSeconds", value)} />
          <NumberSetting label="앞 패딩" help={speakerSettingHelp.sidonPrePadding} value={settings.sidonPrePadding} onChange={(value) => update("sidonPrePadding", value)} />
          <NumberSetting label="뒤 패딩" help={speakerSettingHelp.sidonTrailingPad} value={settings.sidonTrailingPad} onChange={(value) => update("sidonTrailingPad", value)} />
          <NumberSetting label="디코더 트림" help={speakerSettingHelp.sidonDecoderTrim} value={settings.sidonDecoderTrim} onChange={(value) => update("sidonDecoderTrim", value)} />
          <SelectSetting label="stereo mix" help={speakerSettingHelp.sidonStereoMixMode}>
            <SelectField
              value={settings.sidonStereoMixMode}
              options={[
                { value: "average", label: "average" },
                { value: "left", label: "left" },
                { value: "right", label: "right" },
              ]}
              onChange={(value) => update("sidonStereoMixMode", value)}
              ariaLabel="stereo mix"
            />
          </SelectSetting>
          <SelectSetting label="bit depth" help={speakerSettingHelp.sidonOutputBitDepth}>
            <SelectField
              value={settings.sidonOutputBitDepth}
              options={[
                { value: "pcm16", label: "pcm16" },
                { value: "float32", label: "float32" },
              ]}
              onChange={(value) => update("sidonOutputBitDepth", value)}
              ariaLabel="bit depth"
            />
          </SelectSetting>
        </SettingGroup>
      ) : null}
      {settings.useResemble ? (
        <SettingGroup title="Resemble Enhance 설정" help={speakerSettingHelp.resemble}>
          <SelectSetting label="Device" help={speakerSettingHelp.resembleDevicePreference}>
            <SelectField value={settings.resembleDevicePreference} options={[...deviceOptions]} onChange={(value) => update("resembleDevicePreference", value)} ariaLabel="Resemble device" />
          </SelectSetting>
          <SelectSetting label="task" help={speakerSettingHelp.resembleTask}>
            <SelectField
              value={settings.resembleTask}
              options={[
                { value: "enhance", label: "enhance" },
                { value: "denoise_only", label: "denoise_only" },
              ]}
              onChange={(value) => update("resembleTask", value)}
              ariaLabel="Resemble task"
            />
          </SelectSetting>
          <SelectSetting label="solver" help={speakerSettingHelp.resembleSolver}>
            <SelectField
              value={settings.resembleSolver}
              options={[
                { value: "midpoint", label: "midpoint" },
                { value: "rk4", label: "rk4" },
                { value: "euler", label: "euler" },
              ]}
              onChange={(value) => update("resembleSolver", value)}
              ariaLabel="Resemble solver"
            />
          </SelectSetting>
          <NumberSetting label="NFE" help={speakerSettingHelp.resembleNfe} value={settings.resembleNfe} onChange={(value) => update("resembleNfe", value)} />
          <NumberSetting label="tau" help={speakerSettingHelp.resembleTau} value={settings.resembleTau} step={0.01} onChange={(value) => update("resembleTau", value)} />
          <NumberSetting label="lambda" help={speakerSettingHelp.resembleLambda} value={settings.resembleLambda} step={0.01} onChange={(value) => update("resembleLambda", value)} />
        </SettingGroup>
      ) : null}
      {settings.useVoiceFixer ? (
        <SettingGroup title="VoiceFixer 설정" help={speakerSettingHelp.voiceFixer}>
          <SelectSetting label="Device" help={speakerSettingHelp.voiceFixerDevicePreference}>
            <SelectField value={settings.voiceFixerDevicePreference} options={[...deviceOptions]} onChange={(value) => update("voiceFixerDevicePreference", value)} ariaLabel="VoiceFixer device" />
          </SelectSetting>
          <SelectSetting label="모드" help={speakerSettingHelp.voiceFixerMode}>
            <SelectField
              value={String(settings.voiceFixerMode) as "0" | "1" | "2"}
              options={[...voiceFixerModeOptions]}
              onChange={(value) => update("voiceFixerMode", Number(value))}
              ariaLabel="VoiceFixer mode"
            />
          </SelectSetting>
        </SettingGroup>
      ) : null}
    </div>
  );
}
