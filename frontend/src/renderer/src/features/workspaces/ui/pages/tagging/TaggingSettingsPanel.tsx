import type { SlicerSettings } from "@shared/ipc";
import { SelectField } from "@/shared/components/controls";
import { pretrainedSedModelOptions } from "../../../model/workspace-option-catalogs";
import type { WorkspaceRuntime } from "../../../state/use-workspace-runtime";
import { NumberSetting, SelectSetting, SettingGroup, TextSetting } from "../../shared/workspace-panel-primitives";

const taggingSettingHelp = {
  pretrainedSedTagging: "태깅 RUN에서 PretrainedSED strong 체크포인트로 파일을 프레임 단위 분석합니다.",
  pretrainedSedModelKey: "--pretrained-sed-model-key 값입니다. BEATs, ATST-F, fPaSST strong 체크포인트 중 하나를 사용합니다.",
  pretrainedSedThresholds: "--pretrained-sed-thresholds 값입니다. 이벤트 디코딩 임계값을 쉼표로 구분해 전달합니다.",
  pretrainedSedMedianWindow: "--pretrained-sed-median-window 값입니다. 프레임 점수에 적용할 median filter 창 크기입니다. 0이면 끕니다.",
  pretrainedSedFrameInterval: "--pretrained-sed-frame-interval 값입니다. 스키마 카드에 묶어 표시할 프레임 태그 시간 간격(초)입니다.",
  pretrainedSedTopK: "--pretrained-sed-top-k 값입니다. 프레임 행마다 표시할 상위 태그 수입니다.",
  pretrainedSedMinScore: "--pretrained-sed-min-score 값입니다. 프레임 태그 표시 최소 점수입니다.",
} as const;

export function TaggingSettingsBody({ runtime }: { runtime: WorkspaceRuntime }) {
  const settings = runtime.settings.slicer;
  const update = <K extends keyof SlicerSettings>(key: K, value: SlicerSettings[K]) => {
    runtime.setSettings((current) => ({ ...current, slicer: { ...current.slicer, [key]: value } }));
  };

  return (
    <div className="app-scrollbar h-full min-w-0 overflow-auto pr-1">
      <SettingGroup title="PretrainedSED 프레임 태깅" help={taggingSettingHelp.pretrainedSedTagging}>
        <SelectSetting label="체크포인트" help={taggingSettingHelp.pretrainedSedModelKey}>
          <SelectField value={settings.pretrainedSedModelKey} options={[...pretrainedSedModelOptions]} onChange={(value) => update("pretrainedSedModelKey", value)} ariaLabel="PretrainedSED checkpoint" />
        </SelectSetting>
        <TextSetting label="이벤트 임계값" help={taggingSettingHelp.pretrainedSedThresholds} value={settings.pretrainedSedThresholds} onChange={(value) => update("pretrainedSedThresholds", value)} />
        <NumberSetting label="Median 창" help={taggingSettingHelp.pretrainedSedMedianWindow} value={settings.pretrainedSedMedianWindow} onChange={(value) => update("pretrainedSedMedianWindow", value)} />
        <NumberSetting label="프레임 표시 간격(초)" help={taggingSettingHelp.pretrainedSedFrameInterval} value={settings.pretrainedSedFrameInterval} onChange={(value) => update("pretrainedSedFrameInterval", value)} />
        <NumberSetting label="프레임 Top K" help={taggingSettingHelp.pretrainedSedTopK} value={settings.pretrainedSedTopK} step={1} onChange={(value) => update("pretrainedSedTopK", value)} />
        <NumberSetting label="프레임 최소 점수" help={taggingSettingHelp.pretrainedSedMinScore} value={settings.pretrainedSedMinScore} onChange={(value) => update("pretrainedSedMinScore", value)} />
      </SettingGroup>
    </div>
  );
}
