import type { GptVersion } from "../../../model/voice-training-pretrained";

export const gptVersionOptions = [
  { value: "v1", label: "v1" },
  { value: "v2", label: "v2" },
  { value: "v3", label: "v3" },
  { value: "v4", label: "v4" },
  { value: "v2Pro", label: "v2Pro" },
  { value: "v2ProPlus", label: "v2ProPlus" },
] as const;

export const gptModeOptions = [
  { value: "zero-shot", label: "제로샷" },
  { value: "checkpoint", label: "학습 체크포인트" },
] as const;

export const textSplitOptions = [
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

export const inferenceSettingHelp = {
  common: "추론 실행에 공통으로 전달되는 모델 루트, 모델명, GPU, 유휴 타임아웃 설정입니다. 학습 페이지의 모델 목록과 같은 기준으로 체크포인트를 찾습니다.",
  gptSovits: "GPT-SoVITS 추론 모드, 체크포인트, 언어, 샘플링 및 배치 옵션입니다. checkpoint 모드에서는 학습 결과의 SoVITS/GPT 체크포인트를 선택합니다.",
  omniVoice: "OmniVoice 추론 모드, 체크포인트, 언어, 지시문, 샘플링 및 후처리 옵션입니다. checkpoint 모드에서는 학습 결과의 OmniVoice 체크포인트를 사용합니다.",
} as const;

export const inferenceSettingFieldHelp = {
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

export function gptLanguageOptionsForVersion(version: GptVersion) {
  return version === "v1" ? gptLanguageOptionsV1 : gptLanguageOptionsV2;
}

export function defaultGptLanguageForVersion(version: GptVersion): string {
  return version === "v1" ? "all_zh" : "all_ko";
}

export function supportedGptLanguage(value: string, options: ReadonlyArray<{ value: string }>): string | undefined {
  return options.some((option) => option.value === value) ? value : undefined;
}
