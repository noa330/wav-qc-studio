import type { BatchQcSettings } from "@shared/ipc";
import { SelectField, ToggleSwitch } from "@/shared/components/controls";
import { diarizenEmbeddingModelOptions, diarizenModelOptions, whisperAsrModelOptions, whisperLanguageOptions, wordAlignmentDeviceOptions, wordAlignmentLanguageOptions } from "../../../model/workspace-option-catalogs";
import type { WorkspaceRuntime } from "../../../state/use-workspace-runtime";
import { NumberSetting, SelectSetting, SettingGroup, TextSetting } from "../../shared/workspace-panel-primitives";

const batchSettingHelp = {
  export: "배치 QC 내보내기와 자동 전사 언어의 기본 설정입니다.",
  whisper: "faster-whisper 자동 전사에 전달되는 설정입니다.",
  alignment: "자동 전사 뒤 PyTorch torchaudio MMS_FA WordAlign으로 단어 타임라인과 Align외 구간 후보를 계산합니다.",
  speaker: "Batch QC 화자 검증/분리에서 DiariZen 전역 세션에 쓰는 설정입니다.",
  exportFormat: "내보내기에서 backend/batch_qc/exporter.py로 전달되는 exportFormat 값입니다.",
  transcriptionLanguage: "Batch QC RUN 시 --language로 전달됩니다. auto면 Whisper가 언어를 자동 판정합니다.",
  whisperAsrModel: "faster-whisper 모델 이름, Hugging Face repo ID, 또는 로컬 경로입니다. large-v3 같은 별칭은 백엔드가 Systran 모델로 해석합니다.",
  whisperBeamSize: "faster-whisper transcribe의 beam_size 값입니다.",
  whisperVadFilter: "faster-whisper transcribe의 vad_filter 값입니다.",
  whisperComputeTypeCpu: "CPU 실행 시 faster-whisper compute_type 값입니다.",
  whisperComputeTypeCuda: "CUDA 실행 시 faster-whisper compute_type 값입니다.",
  whisperSuppressNumerals: "Whisper 디코딩에서 아라비아 숫자 토큰을 억제합니다. 프롬프트가 아니라 토큰 단위로 숫자 표기를 줄입니다.",
  whisperInitialPrompt: "사용자가 직접 전달할 faster-whisper initial_prompt입니다. 비워두면 추가 프롬프트 없이 실행합니다.",
  wordAlignmentLanguageCode: "MMS_FA 정렬 전 uroman 로마자화에 전달할 언어입니다. 한국어 기본값은 ko입니다.",
  wordAlignmentDevicePreference: "PyTorch torchaudio MMS_FA WordAlign 실행 장치입니다.",
  wordAlignmentLowScoreThreshold: "이 값보다 낮은 단어 정렬 점수를 확인필요로 표시합니다.",
  wordAlignmentMissingScoreThreshold: "이 값보다 낮은 단어 정렬 점수는 누락으로 표시합니다. 낮출수록 누락 판정이 덜 엄격해집니다.",
  showAllAlignmentOutsideSegments: "활성화하면 자동전사 칸에 Align외 구간 ... 칩을 전부 표시합니다. 꺼두면 재생 중 해당 구간에서 직전 단어 칩만 ...로 바뀝니다.",
  diarizenModelId: "DiariZen diarization 모델 Hugging Face repo ID 또는 로컬 경로입니다.",
  diarizenEmbeddingModelId: "DiariZen pipeline에 전달할 pyannote/wespeaker 임베딩 모델 repo ID입니다.",
  batchSpeakerTargetSampleRate: "DiariZen에 넘길 단일 WAV를 만들 때 사용하는 리샘플링 주파수입니다.",
  batchSpeakerMinOverlapSec: "이 시간 이상 겹치는 다른 화자 구간이 있으면 오버랩으로 판정합니다.",
} as const;

export function BatchModelSettingsBody({ runtime }: { runtime: WorkspaceRuntime }) {
  const batch = runtime.settings.batch;
  const update = <K extends keyof BatchQcSettings>(key: K, value: BatchQcSettings[K]) => {
    runtime.setSettings((current) => ({ ...current, batch: { ...current.batch, [key]: value } }));
  };

  return (
    <div className="app-scrollbar h-full min-w-0 overflow-auto pr-1">
      <SettingGroup title="내보내기" help={batchSettingHelp.export}>
        <SelectSetting label="형식" help={batchSettingHelp.exportFormat}>
          <SelectField
            value={batch.exportFormat}
            options={[
              { value: "gsv", label: "GPT-SoVITS" },
              { value: "omni", label: "OmniVoice" },
            ]}
            onChange={(value) => update("exportFormat", value)}
            ariaLabel="내보내기 형식"
          />
        </SelectSetting>
      </SettingGroup>
      <SettingGroup title="자동 전사 Whisper" help={batchSettingHelp.whisper}>
        <SelectSetting label="언어" help={batchSettingHelp.transcriptionLanguage}>
          <SelectField value={batch.transcriptionLanguage} options={[...whisperLanguageOptions]} onChange={(value) => update("transcriptionLanguage", value)} ariaLabel="자동 전사 언어" />
        </SelectSetting>
        <SelectSetting label="ASR 모델" help={batchSettingHelp.whisperAsrModel}>
          <SelectField value={batch.whisperAsrModel} options={[...whisperAsrModelOptions]} onChange={(value) => update("whisperAsrModel", value)} ariaLabel="ASR 모델" />
        </SelectSetting>
        <NumberSetting label="beam size" help={batchSettingHelp.whisperBeamSize} value={batch.whisperBeamSize} onChange={(value) => update("whisperBeamSize", value)} />
        <SelectSetting label="VAD filter" help={batchSettingHelp.whisperVadFilter}>
          <ToggleSwitch checked={batch.whisperVadFilter} onChange={(checked) => update("whisperVadFilter", checked)} />
        </SelectSetting>
        <TextSetting label="CPU compute" help={batchSettingHelp.whisperComputeTypeCpu} value={batch.whisperComputeTypeCpu} onChange={(value) => update("whisperComputeTypeCpu", value)} />
        <TextSetting label="CUDA compute" help={batchSettingHelp.whisperComputeTypeCuda} value={batch.whisperComputeTypeCuda} onChange={(value) => update("whisperComputeTypeCuda", value)} />
        <SelectSetting label="(실험적) 숫자 억제" help={batchSettingHelp.whisperSuppressNumerals}>
          <ToggleSwitch checked={batch.whisperSuppressNumerals} onChange={(checked) => update("whisperSuppressNumerals", checked)} />
        </SelectSetting>
        <TextSetting label="(실험적) 초기 프롬프트" help={batchSettingHelp.whisperInitialPrompt} value={batch.whisperInitialPrompt} onChange={(value) => update("whisperInitialPrompt", value)} />
      </SettingGroup>
      <SettingGroup title="WordAlign" help={batchSettingHelp.alignment}>
        <SelectSetting label="언어" help={batchSettingHelp.wordAlignmentLanguageCode}>
          <SelectField value={batch.wordAlignmentLanguageCode} options={[...wordAlignmentLanguageOptions]} onChange={(value) => update("wordAlignmentLanguageCode", value)} ariaLabel="WordAlign 언어" />
        </SelectSetting>
        <SelectSetting label="장치" help={batchSettingHelp.wordAlignmentDevicePreference}>
          <SelectField value={batch.wordAlignmentDevicePreference} options={[...wordAlignmentDeviceOptions]} onChange={(value) => update("wordAlignmentDevicePreference", value)} ariaLabel="WordAlign 장치" />
        </SelectSetting>
        <NumberSetting label="낮은 점수" help={batchSettingHelp.wordAlignmentLowScoreThreshold} value={batch.wordAlignmentLowScoreThreshold} min={0.1} max={0.95} step={0.01} onChange={(value) => update("wordAlignmentLowScoreThreshold", value)} />
        <NumberSetting label="누락 점수" help={batchSettingHelp.wordAlignmentMissingScoreThreshold} value={batch.wordAlignmentMissingScoreThreshold} min={0.02} max={0.8} step={0.01} onChange={(value) => update("wordAlignmentMissingScoreThreshold", value)} />
        <SelectSetting label="Align외 구간 전부 표시" help={batchSettingHelp.showAllAlignmentOutsideSegments}>
          <ToggleSwitch checked={batch.showAllAlignmentOutsideSegments} onChange={(checked) => update("showAllAlignmentOutsideSegments", checked)} />
        </SelectSetting>
      </SettingGroup>
      <SettingGroup title="화자 검증" help={batchSettingHelp.speaker}>
        <SelectSetting label="DiariZen 모델" help={batchSettingHelp.diarizenModelId}>
          <SelectField value={batch.diarizenModelId} options={[...diarizenModelOptions]} onChange={(value) => update("diarizenModelId", value)} ariaLabel="DiariZen 모델" />
        </SelectSetting>
        <SelectSetting label="DiariZen 임베딩" help={batchSettingHelp.diarizenEmbeddingModelId}>
          <SelectField value={batch.diarizenEmbeddingModelId} options={[...diarizenEmbeddingModelOptions]} onChange={(value) => update("diarizenEmbeddingModelId", value)} ariaLabel="DiariZen 임베딩" />
        </SelectSetting>
        <NumberSetting label="sample rate" help={batchSettingHelp.batchSpeakerTargetSampleRate} value={batch.batchSpeakerTargetSampleRate} onChange={(value) => update("batchSpeakerTargetSampleRate", value)} />
        <NumberSetting label="오버랩 초" help={batchSettingHelp.batchSpeakerMinOverlapSec} value={batch.batchSpeakerMinOverlapSec} step={0.01} onChange={(value) => update("batchSpeakerMinOverlapSec", value)} />
      </SettingGroup>
    </div>
  );
}
