import type { SlicerSettings } from "@shared/ipc";
import { SelectField } from "@/shared/components/controls";
import type { WorkspaceRuntime } from "../../../state/use-workspace-runtime";
import { NumberSetting, SelectSetting, SettingGroup } from "../../shared/workspace-panel-primitives";

const deviceOptions = [
  { value: "auto", label: "auto" },
  { value: "cuda", label: "cuda" },
  { value: "cpu", label: "cpu" },
] as const;

const sliceSettingHelp = {
  speechDetection: "FireRedVAD로 음성 이벤트를 찾는 RUN 입력값입니다. 프론트 ms 값은 backend workspace-runner에서 FireRed 프레임 단위로 변환됩니다.",
  markerPostprocess: "검출된 음성 마커의 분리, 패딩, 경계 보정, 가까운 구간 병합 기준을 제어합니다.",
  normalization: "슬라이스 내보내기 직전 무음 바닥값과 피크 정규화 반영 방식을 제어합니다.",
  devicePreference: "--device 값입니다. RUN 시 slicer_main.py slice 인자로 전달되며 auto는 CUDA 사용 가능 여부를 확인한 뒤 GPU 또는 CPU로 실행합니다.",
  speechThreshold: "--speech-threshold 값입니다. FireRedVAD 음성 판정 기준이며 높을수록 엄격하게, 낮을수록 민감하게 마커를 잡습니다.",
  smoothWindowMs: "프론트에서는 ms로 입력하고 workspace-runner에서 FireRed 프레임으로 변환해 --smooth-window-size에 전달합니다. FireRed 기준 1프레임은 10ms입니다.",
  minEventMs: "프론트에서는 ms로 입력하고 workspace-runner에서 FireRed 프레임으로 변환해 --min-event-frame에 전달합니다. 이 길이보다 짧은 음성 이벤트는 제한됩니다.",
  maxEventMs: "프론트에서는 ms로 입력하고 workspace-runner에서 FireRed 프레임으로 변환해 --max-event-frame에 전달합니다. 이 길이보다 긴 음성 이벤트는 제한됩니다.",
  minSilenceMs: "프론트에서는 ms로 입력하고 workspace-runner에서 FireRed 프레임으로 변환해 --min-silence-frame에 전달합니다. 무음으로 인정할 최소 길이입니다.",
  mergeSilenceMs: "프론트에서는 ms로 입력하고 workspace-runner에서 FireRed 프레임으로 변환해 --merge-silence-frame에 전달합니다. 가까운 음성 이벤트 사이 무음이 이 기준 안이면 병합합니다.",
  extendSpeechMs: "프론트에서는 ms로 입력하고 workspace-runner에서 FireRed 프레임으로 변환해 --extend-speech-frame에 전달합니다. 검출된 음성 이벤트 앞뒤를 확장합니다.",
  chunkMaxMs: "프론트에서는 ms로 입력하고 workspace-runner에서 FireRed 프레임으로 변환해 --chunk-max-frame에 전달합니다. 하나의 검출 청크 최대 길이입니다.",
  splitGapMs: "프론트에서는 ms로 입력하고 workspace-runner에서 초 단위로 변환해 --split-gap-sec에 전달합니다. keep range 사이 공백이 이 값보다 크면 분리합니다.",
  speechPadMs: "--speech-pad-ms 값입니다. 검출된 음성 마커의 앞뒤를 ms 단위로 넓힌 뒤 경계를 보정합니다.",
  zeroCrossSearchMs: "--zero-cross-search-ms 값입니다. 클릭음을 줄이기 위해 경계 주변의 0 교차 지점을 찾습니다.",
  quietBoundarySearchMs: "--quiet-boundary-search-ms 값입니다. 경계 주변에서 더 조용한 위치를 찾은 뒤 제로크로싱 보정을 적용합니다.",
  monitorMergeGapMs: "--monitor-merge-gap-ms 값입니다. 가까운 마커 사이 공백이 이 기준 안이면 후처리에서 병합 후보로 봅니다.",
  monitorMergeMaxMs: "--monitor-merge-max-ms 값입니다. 병합 결과가 이 시간을 넘으면 가까운 구간이어도 자동 병합하지 않습니다.",
  spliceMs: "--splice-ms 값입니다. 미리보기/무음 처리 오디오를 만들 때 경계 페이드 길이로 사용됩니다.",
  floorGainDb: "--floor-gain-db 값입니다. 무음 처리 구간을 완전 0 대신 지정 dB 바닥값으로 낮출 때 사용됩니다.",
  normalizeMax: "--normalize-max 값입니다. 슬라이스 내보내기에서 wav를 쓰기 직전 적용되는 목표 피크이며 0~1 범위로 보정됩니다.",
  normalizeAlpha: "--normalize-alpha 값입니다. 0은 원본 레벨 유지, 1은 목표 피크 정규화를 전부 반영합니다.",
} as const;

export function SliceSettingsBody({ runtime }: { runtime: WorkspaceRuntime }) {
  const settings = runtime.settings.slicer;
  const update = <K extends keyof SlicerSettings>(key: K, value: SlicerSettings[K]) => {
    runtime.setSettings((current) => ({ ...current, slicer: { ...current.slicer, [key]: value } }));
  };

  return (
    <div className="app-scrollbar h-full min-w-0 overflow-auto pr-1">
      <SettingGroup title="음성 검출" help={sliceSettingHelp.speechDetection}>
        <SelectSetting label="실행 장치" help={sliceSettingHelp.devicePreference}>
          <SelectField value={settings.devicePreference} options={[...deviceOptions]} onChange={(value) => update("devicePreference", value)} ariaLabel="실행 장치" />
        </SelectSetting>
        <NumberSetting label="음성 판정 임계값" help={sliceSettingHelp.speechThreshold} value={settings.speechThreshold} step={0.01} onChange={(value) => update("speechThreshold", value)} />
        <NumberSetting label="스무딩 창 ms" help={sliceSettingHelp.smoothWindowMs} value={settings.smoothWindowMs} onChange={(value) => update("smoothWindowMs", value)} />
        <NumberSetting label="최소 음성 길이 ms" help={sliceSettingHelp.minEventMs} value={settings.minEventMs} onChange={(value) => update("minEventMs", value)} />
        <NumberSetting label="최대 음성 길이 ms" help={sliceSettingHelp.maxEventMs} value={settings.maxEventMs} onChange={(value) => update("maxEventMs", value)} />
        <NumberSetting label="최소 무음 길이 ms" help={sliceSettingHelp.minSilenceMs} value={settings.minSilenceMs} onChange={(value) => update("minSilenceMs", value)} />
        <NumberSetting label="무음 병합 기준 ms" help={sliceSettingHelp.mergeSilenceMs} value={settings.mergeSilenceMs} onChange={(value) => update("mergeSilenceMs", value)} />
        <NumberSetting label="음성 확장 길이 ms" help={sliceSettingHelp.extendSpeechMs} value={settings.extendSpeechMs} onChange={(value) => update("extendSpeechMs", value)} />
        <NumberSetting label="최대 청크 길이 ms" help={sliceSettingHelp.chunkMaxMs} value={settings.chunkMaxMs} onChange={(value) => update("chunkMaxMs", value)} />
      </SettingGroup>
      <SettingGroup title="오디오 마커 후처리" help={sliceSettingHelp.markerPostprocess}>
        <NumberSetting label="구간 공백 기준 ms" help={sliceSettingHelp.splitGapMs} value={settings.splitGapMs} onChange={(value) => update("splitGapMs", value)} />
        <NumberSetting label="음성 패딩 ms" help={sliceSettingHelp.speechPadMs} value={settings.speechPadMs} onChange={(value) => update("speechPadMs", value)} />
        <NumberSetting label="제로크로싱 탐색 ms" help={sliceSettingHelp.zeroCrossSearchMs} value={settings.zeroCrossSearchMs} onChange={(value) => update("zeroCrossSearchMs", value)} />
        <NumberSetting label="조용한 경계 탐색 ms" help={sliceSettingHelp.quietBoundarySearchMs} value={settings.quietBoundarySearchMs} onChange={(value) => update("quietBoundarySearchMs", value)} />
        <NumberSetting label="근접 구간 병합 ms" help={sliceSettingHelp.monitorMergeGapMs} value={settings.monitorMergeGapMs} onChange={(value) => update("monitorMergeGapMs", value)} />
        <NumberSetting label="최대 병합 시간 ms" help={sliceSettingHelp.monitorMergeMaxMs} value={settings.monitorMergeMaxMs} onChange={(value) => update("monitorMergeMaxMs", value)} />
        <NumberSetting label="스플라이스 ms" help={sliceSettingHelp.spliceMs} value={settings.spliceMs} onChange={(value) => update("spliceMs", value)} />
      </SettingGroup>
      <SettingGroup title="오디오 정규화" help={sliceSettingHelp.normalization}>
        <NumberSetting label="무음 바닥 dB" help={sliceSettingHelp.floorGainDb} value={settings.floorGainDb} onChange={(value) => update("floorGainDb", value)} />
        <NumberSetting label="정규화 목표 피크" help={sliceSettingHelp.normalizeMax} value={settings.normalizeMax} step={0.01} onChange={(value) => update("normalizeMax", value)} />
        <NumberSetting label="정규화 반영 비율" help={sliceSettingHelp.normalizeAlpha} value={settings.normalizeAlpha} step={0.01} onChange={(value) => update("normalizeAlpha", value)} />
      </SettingGroup>
    </div>
  );
}
