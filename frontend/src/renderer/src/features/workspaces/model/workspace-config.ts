import {
  Activity,
  AudioLines,
  BarChart3,
  Boxes,
  ChartNoAxesColumnIncreasing,
  ChartSpline,
  ClipboardCheck,
  FileText,
  FolderTree,
  GraduationCap,
  Scissors,
  Settings2,
  Speech,
  Tags,
  UsersRound,
  WandSparkles,
  Waves,
  type LucideIcon,
} from "lucide-react";
import type { WorkspaceId } from "@shared/ipc";

export type WorkspacePanelKind =
  | "browser"
  | "filter"
  | "table"
  | "detail"
  | "settings"
  | "waveform"
  | "slice-actions"
  | "queue"
  | "playback"
  | "audio-comparison"
  | "progress"
  | "model";

export type WorkspacePanel = {
  id: string;
  title: string;
  icon: LucideIcon;
  kind: WorkspacePanelKind;
};

export type WorkspaceDefinition = {
  id: WorkspaceId;
  navLabel: string;
  title: string;
  subtitle: string;
  icon: LucideIcon;
  metricLabels: string[];
  left: WorkspacePanel;
  center: WorkspacePanel[];
  right: WorkspacePanel[];
};

export const workspaces: WorkspaceDefinition[] = [
  {
    id: "slice",
    navLabel: "Slice",
    title: "슬라이스",
    subtitle: "입력 WAV 폴더를 기준으로 슬라이스 구간을 탐색하고 결과를 확인합니다.",
    icon: Scissors,
    metricLabels: ["전체 파일", "처리 완료", "실패 파일", "결과 행", "기준"],
    left: { id: "slice-browser", title: "파일 브라우저", icon: FolderTree, kind: "browser" },
    center: [
      { id: "slice-editor", title: "슬라이스 에디터", icon: Waves, kind: "waveform" },
      { id: "slice-actions", title: "슬라이스 액션", icon: Scissors, kind: "slice-actions" },
      { id: "slice-results", title: "결과 테이블", icon: ClipboardCheck, kind: "table" },
    ],
    right: [{ id: "slice-settings", title: "슬라이스 설정", icon: Settings2, kind: "settings" }],
  },
  {
    id: "tagging",
    navLabel: "Tagging",
    title: "태깅",
    subtitle: "WAV 폴더를 PretrainedSED 프레임 태깅 백엔드로 처리합니다.",
    icon: Tags,
    metricLabels: ["전체 파일", "완료", "실패", "결과 행"],
    left: { id: "tagging-browser", title: "파일 브라우저", icon: FolderTree, kind: "browser" },
    center: [
      { id: "tagging-audio", title: "오디오 재생", icon: AudioLines, kind: "playback" },
      { id: "tagging-queue", title: "스키마", icon: Activity, kind: "queue" },
      { id: "tagging-results", title: "결과 테이블", icon: ClipboardCheck, kind: "table" },
    ],
    right: [{ id: "tagging-settings", title: "태깅 설정", icon: Settings2, kind: "settings" }],
  },
  {
    id: "speaker",
    navLabel: "De-noise",
    title: "디노이즈",
    subtitle: "노이즈 제거와 오디오 개선 결과를 백엔드 추론 결과 기준으로 비교합니다.",
    icon: WandSparkles,
    metricLabels: ["전체 파일", "작업 중", "완료", "선택 모델"],
    left: { id: "speaker-browser", title: "파일 브라우저", icon: FolderTree, kind: "browser" },
    center: [
      { id: "speaker-progress", title: "디노이즈 진행", icon: ChartNoAxesColumnIncreasing, kind: "progress" },
      { id: "speaker-audio-comparison", title: "원본/결과 오디오", icon: AudioLines, kind: "audio-comparison" },
    ],
    right: [
      { id: "speaker-model", title: "모델 선택", icon: Boxes, kind: "model" },
      { id: "speaker-settings", title: "모델 설정", icon: Settings2, kind: "settings" },
    ],
  },
  {
    id: "overview",
    navLabel: "Score",
    title: "스코어",
    subtitle: "프로젝트 QC 점수 결과를 생성하고 필터링합니다.",
    icon: ChartSpline,
    metricLabels: ["현재 프로젝트", "전체 파일", "표시 행", "분석 모듈"],
    left: { id: "overview-browser", title: "파일 브라우저", icon: FolderTree, kind: "browser" },
    center: [
      { id: "overview-results", title: "스코어 테이블", icon: BarChart3, kind: "table" },
      { id: "overview-audio", title: "오디오 재생", icon: AudioLines, kind: "playback" },
    ],
    right: [
      { id: "overview-modules", title: "분석 모듈", icon: Boxes, kind: "filter" },
      { id: "overview-detail", title: "모델 설정", icon: Settings2, kind: "settings" },
    ],
  },
  {
    id: "batch",
    navLabel: "Script",
    title: "스크립트",
    subtitle: "입력 WAV를 자동 전사하고 WordAlign 단어 타임라인을 만든 뒤 스크립트 데이터셋으로 내보냅니다.",
    icon: FileText,
    metricLabels: ["소스 행", "표시 행", "화자 그룹", "활성 화자"],
    left: { id: "batch-browser", title: "파일 브라우저", icon: FolderTree, kind: "browser" },
    center: [
      { id: "batch-audio", title: "오디오 재생", icon: AudioLines, kind: "playback" },
      { id: "batch-table", title: "스크립트 편집", icon: ClipboardCheck, kind: "table" },
      { id: "batch-timeline", title: "타임라인", icon: Activity, kind: "queue" },
    ],
    right: [
      { id: "batch-speakers", title: "화자 선택", icon: UsersRound, kind: "filter" },
      { id: "batch-detail", title: "스크립트 설정", icon: Settings2, kind: "settings" },
    ],
  },
  {
    id: "training",
    navLabel: "Training",
    title: "음성 학습",
    subtitle: "선택한 매니페스트 파일에서 GPT-SoVITS list 데이터셋 또는 OmniVoice JSON 데이터셋을 학습합니다.",
    icon: GraduationCap,
    metricLabels: ["모델", "행", "체크포인트", "상태"],
    left: { id: "training-browser", title: "데이터셋 브라우저", icon: FolderTree, kind: "browser" },
    center: [
      { id: "training-plan", title: "모델 훈련", icon: Settings2, kind: "settings" },
      { id: "training-results", title: "학습 결과", icon: ClipboardCheck, kind: "table" },
    ],
    right: [
      { id: "training-model", title: "모델 선택", icon: Boxes, kind: "model" },
      { id: "training-settings", title: "학습 설정", icon: Settings2, kind: "settings" },
    ],
  },
  {
    id: "inference",
    navLabel: "Inference",
    title: "음성 추론",
    subtitle: "레퍼런스 오디오, 제로샷 프롬프트, 저장된 체크포인트로 GPT-SoVITS 또는 OmniVoice 추론을 실행합니다.",
    icon: Speech,
    metricLabels: ["모델", "모드", "출력", "상태"],
    left: { id: "inference-browser", title: "레퍼런스 브라우저", icon: FolderTree, kind: "browser" },
    center: [
      { id: "inference-results", title: "추론 결과", icon: ClipboardCheck, kind: "table" },
      { id: "inference-audio-comparison", title: "레퍼런스/출력 오디오", icon: AudioLines, kind: "audio-comparison" },
    ],
    right: [
      { id: "inference-model", title: "모델 선택", icon: Boxes, kind: "model" },
      { id: "inference-settings", title: "추론 설정", icon: Settings2, kind: "settings" },
    ],
  },
];

export const defaultWorkspaceId: WorkspaceId = "overview";
