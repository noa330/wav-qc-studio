# WAV QC Studio

WAV QC Studio는 음성 데이터셋 제작과 검수를 위한 Windows 데스크톱 도구입니다. WAV 파일을 모아 품질을 확인하고, 구간을 자르고, 노이즈와 발화 품질을 분석하고, 학습용 데이터셋과 체크포인트 흐름까지 한 화면에서 다룰 수 있도록 구성되어 있습니다.

Electron + React 프론트엔드와 Python 기반 오디오 파이프라인을 함께 제공합니다. 단순 파일 뷰어가 아니라 실제 작업 폴더를 불러와 분석, 편집, 표 검수, 내보내기, 학습 보조를 이어서 수행하는 워크스테이션 형태의 애플리케이션입니다.

## 핵심 가치

- 음성 데이터 검수에 필요한 탐색, 재생, 파형 확인, 표 편집, 결과 내보내기를 한 UI에서 처리합니다.
- 슬라이싱, SED 태깅, 화자/품질 분석, 배치 QC, 학습/추론 보조를 워크스페이스 단위로 분리해 반복 작업을 정리합니다.
- Windows에서 바로 실행할 수 있도록 Python 가상환경 준비, Electron 빌드, NSIS 설치기 생성을 스크립트로 제공합니다.
- 대형 모델과 런타임은 실행 스크립트가 필요한 위치에 준비하도록 설계되어 저장소를 받은 뒤 같은 절차로 환경을 재구성할 수 있습니다.

## 주요 기능

| 영역 | 기능 |
| --- | --- |
| 파일 탐색 | 입력/출력 폴더 스캔, 대량 WAV 목록 관리, 선택 파일 동기화 |
| 오디오 검수 | 파형 표시, 재생 위치 동기화, 행 단위 미리듣기, 구간 확인 |
| 편집 | WAV 크롭, 무음 처리, 구간 재생, 편집 결과 캐시 관리 |
| 품질 분석 | 발화/노이즈/화자 관련 분석 결과를 표로 정리 |
| SED 태깅 | Pretrained SED 모델 기반 프레임 태그와 임계값 기반 판정 |
| 배치 QC | 자동 전사, 단어 정렬, 화자 그룹, 검색/필터/일괄 수정 |
| 학습 보조 | GPT-SoVITS/OmniVoice 계열 학습 설정, 체크포인트 목록, TensorBoard 실행 |
| 추론 보조 | 레퍼런스 오디오와 텍스트 기반 음성 생성 실행, 결과 파일 확인 |
| 배포 | Electron 빌드와 Windows 설치기 생성 |

## 워크스페이스

### Slice

긴 WAV 파일을 발화 단위로 나누기 위한 작업 공간입니다. 입력 폴더를 스캔하고, 감지된 구간을 표와 파형에서 확인한 뒤 필요한 구간만 저장할 수 있습니다. 구간 경계, 패딩, 무음 처리 결과를 반복해서 확인하는 데이터셋 전처리 단계에 적합합니다.

### Tagging

Pretrained SED 기반으로 오디오 이벤트를 태깅합니다. speech, breath, noise 같은 프레임 태그를 확인하고, 태그 점수와 임계값을 기준으로 검수 대상 파일을 분류할 수 있습니다. 태그 결과는 표와 스키마 패널에서 함께 다룹니다.

### Speaker

화자 관련 처리를 위한 워크스페이스입니다. 입력 음성과 처리 결과를 나란히 비교하고, 화자 분석 또는 복원 파이프라인 결과를 확인하는 흐름을 제공합니다.

### Overview

여러 WAV 파일의 품질 지표를 한 번에 보는 요약 검수 화면입니다. 노이즈 계열 점수, 발화 상태, 오류 메시지, 파일 경로를 표로 모아 보고 필터 칩과 검색을 통해 재검토 대상을 좁힐 수 있습니다.

### Batch

대량 음성 데이터를 학습용 행 단위로 정리하는 공간입니다. 자동 전사, 단어 정렬, 화자 컬럼 편집, 타임라인 확인, 일괄 치환, 선택 행 내보내기 등 반복 검수에 필요한 기능을 묶었습니다.

### Training

음성 모델 학습을 준비하고 추적하는 작업 공간입니다. GPT-SoVITS와 OmniVoice 계열 설정을 다루며, 체크포인트 폴더 스캔, 모델 선택, TensorBoard 실행, 학습 로그 확인을 지원합니다.

### Inference

학습된 체크포인트로 추론을 실행하고 결과 음성을 확인하는 공간입니다. 레퍼런스 오디오, 프롬프트 텍스트, 출력 오디오를 같은 흐름에서 관리합니다.

## 시스템 구성

```text
.
├── backend/                    # Python 오디오 분석, 슬라이싱, 노이즈, 학습 연동 로직
├── config/                     # 모델과 런타임 기본 설정
├── deepspeed/                  # Windows 실행을 위한 경량 호환 모듈
├── frontend/                   # Electron + React + TypeScript 데스크톱 앱
│   ├── build/                  # 설치기 리소스와 개발 소스 패키징 스크립트
│   └── src/                    # Electron main/preload/renderer 소스
├── training/                   # 학습 런타임 설치 및 연동 스크립트
├── requirements.txt            # 기본 Python 파이프라인 의존성
├── requirements_noise.txt      # 노이즈/품질 분석용 의존성
├── requirements_slicer.txt     # 슬라이싱/SED 태깅용 의존성
├── setup_and_run.bat           # Python 런타임 준비
├── build_and_run_frontend.bat  # 프론트엔드 빌드 후 실행
├── run_built_frontend.bat      # 빌드된 Electron 앱 실행
└── build_installer.bat         # Windows 설치기 생성
```

## 요구 사항

- Windows 10/11
- PowerShell 5 이상
- Python 3.10, 3.11 또는 3.12
- Node.js 20 이상 및 npm
- GPU 가속 사용 시 NVIDIA 드라이버와 CUDA 호환 환경

Python이 없으면 `setup_and_run.bat`이 Python 3.11 설치 파일을 받아 사용자 영역에 설치합니다. Node.js는 Electron 프론트엔드 빌드에 필요하므로 먼저 설치해 두는 것을 권장합니다.

## 빠른 시작

저장소를 받은 뒤 루트 폴더에서 다음 순서로 실행합니다.

```bat
setup_and_run.bat
build_and_run_frontend.bat
```

`setup_and_run.bat`은 목적별 Python 가상환경을 만들고 필요한 패키지를 설치합니다.

- `.venv`: 기본 분석/실행 환경
- `.venv_noise`: 노이즈와 품질 분석 환경
- `.ven_slice`: 슬라이싱과 SED 태깅 환경

`build_and_run_frontend.bat`은 `frontend` 의존성을 설치하고 Electron 앱을 빌드한 뒤 실행합니다. 이미 빌드된 앱만 다시 실행하려면 다음 명령을 사용합니다.

```bat
run_built_frontend.bat
```

## 개발 명령

프론트엔드만 직접 다룰 때는 `frontend` 폴더에서 npm 스크립트를 사용할 수 있습니다.

```bat
cd frontend
npm install
npm run build
npm run dev
```

`npm run build`는 Electron main/preload와 renderer TypeScript 설정을 각각 검사한 뒤 `electron-vite build`를 실행합니다.

## 설치기 빌드

Windows 설치기는 루트 폴더에서 다음 명령으로 생성합니다.

```bat
build_installer.bat
```

내부적으로 `frontend/package.json`의 `build:installer` 스크립트를 실행합니다. 빌드 과정에서는 Electron 산출물과 Python 백엔드, 설정 파일, 학습 연동 스크립트, 개발 소스 묶음을 설치기 리소스로 준비합니다.

완료된 설치기는 다음 위치에 생성됩니다.

```text
frontend/release/
```

## 런타임 점검

ONNX Runtime GPU 구성을 확인하려면 다음 명령을 사용합니다.

```bat
python verify_onnx_gpu.py
```

ONNX Runtime 패키지 충돌을 정리해야 할 때는 다음 유틸리티를 실행합니다.

```bat
python cleanup_onnxruntime_conflicts.py
```

## 작업 흐름 예시

1. `setup_and_run.bat`으로 Python 런타임을 준비합니다.
2. `build_and_run_frontend.bat`으로 데스크톱 앱을 실행합니다.
3. Slice에서 원본 WAV를 발화 단위로 나눕니다.
4. Tagging 또는 Overview에서 노이즈, 이벤트, 품질 지표를 확인합니다.
5. Batch에서 전사와 화자 정보를 정리하고 학습용 목록을 내보냅니다.
6. Training에서 모델 학습과 체크포인트를 관리합니다.
7. Inference에서 체크포인트와 레퍼런스 오디오로 결과 음성을 생성합니다.

## 데이터와 모델

대형 모델, 캐시, 가상환경, 빌드 결과물은 실행 과정에서 로컬에 생성됩니다. 저장소에는 재현 가능한 설치와 빌드에 필요한 소스, 설정, 스크립트를 중심으로 둡니다.

학습 런타임은 `training/install_gpt_sovits_runtime.ps1`과 관련 리소스를 통해 준비됩니다. 모델 파일이나 체크포인트가 필요한 기능은 각 워크스페이스 설정에서 경로를 지정해 사용합니다.

## 문제 해결

- `npm was not found`: Node.js 20 이상을 설치한 뒤 다시 실행합니다.
- `Python was not found`: `setup_and_run.bat`을 실행하면 지원되는 Python을 찾거나 Python 3.11을 사용자 영역에 설치합니다.
- GPU 관련 오류: NVIDIA 드라이버, CUDA 호환 PyTorch, ONNX Runtime GPU 구성을 확인합니다.
- Electron이 바로 종료됨: `frontend/out/main/index.js`가 생성됐는지 확인하고 `frontend`에서 `npm run build`를 다시 실행합니다.
- 한글 경로 문제: PowerShell과 Python UTF-8 설정을 사용하지만, 문제가 반복되면 영문 경로에서 다시 시도하는 것을 권장합니다.

## 라이선스

라이선스 파일을 추가하기 전까지는 별도의 사용 권한이 부여되지 않습니다. 공개 배포 또는 재사용 정책을 정하려면 저장소에 `LICENSE` 파일을 추가하세요.
