# WAV QC Studio

WAV QC Studio는 음성 데이터 검수, 세그먼트 편집, 노이즈 처리, 발화 품질 분석, 음성 학습 보조 작업을 하나의 Electron 기반 데스크톱 환경에서 다루기 위한 Windows용 도구입니다.

## 주요 기능

- WAV 파일 기반 음성 데이터 검수 및 메타데이터 관리
- 발화 구간 편집, 크롭, 오디오 재생/비교 워크플로
- 노이즈 제거 및 음성 복원 파이프라인 실행
- 발음, 화자, 음질 관련 분석 작업
- Pretrained SED 기반 태깅 및 슬라이싱 보조
- GPT-SoVITS/OmniVoice 계열 학습, 추론, 체크포인트 관리 보조
- Windows 설치기 빌드 및 설치 후 Python 런타임 구성

## 저장소 구성

```text
.
├── backend/                    # Python 백엔드 파이프라인과 CLI 진입점
├── config/                     # 모델/런타임 기본 설정
├── deepspeed/                  # Windows 실행을 위한 경량 호환 모듈
├── frontend/                   # Electron + React 프론트엔드
│   ├── build/                  # NSIS 설치기와 개발 소스 준비 스크립트
│   └── src/                    # Electron main/preload/renderer 소스
├── training/                   # 음성 학습 런타임 설치/연동 스크립트
├── requirements*.txt           # Python 환경별 의존성 목록
├── setup_and_run.bat           # Python 환경 준비
├── build_and_run_frontend.bat  # Electron 빌드 후 실행
└── build_installer.bat         # Windows 설치기 빌드
```

## 요구 사항

- Windows 10/11
- PowerShell 5 이상
- Python 3.10, 3.11 또는 3.12
- Node.js 20 이상 및 npm
- NVIDIA GPU 사용 시 CUDA 호환 드라이버

Python이 없으면 `setup_and_run.bat`이 Python 3.11 설치 파일을 내려받아 사용자 영역에 설치합니다. Node.js는 Electron 프론트엔드 빌드에 필요하므로 미리 설치해 두는 것을 권장합니다.

## 빠른 시작

```bat
setup_and_run.bat
build_and_run_frontend.bat
```

`setup_and_run.bat`은 `.venv`, `.venv_noise`, `.ven_slice`를 만들고 각 파이프라인에 필요한 Python 패키지를 설치합니다.

`build_and_run_frontend.bat`은 `frontend` 의존성을 설치한 뒤 Electron 앱을 빌드하고 실행합니다.

이미 빌드된 Electron 앱만 다시 실행하려면 다음 명령을 사용합니다.

```bat
run_built_frontend.bat
```

## 설치기 빌드

```bat
build_installer.bat
```

설치기 빌드는 `frontend/package.json`의 `build:installer` 스크립트를 실행합니다. 이 과정에서 `frontend/build/prepare-development-source.ps1`이 설치기에 포함할 Development 원본 소스 묶음을 생성합니다.

완료된 설치기는 다음 위치에 생성됩니다.

```text
frontend/release/
```

## 런타임 점검

ONNX Runtime GPU 구성을 확인하려면 다음 명령을 사용할 수 있습니다.

```bat
python verify_onnx_gpu.py
```

ONNX Runtime 패키지 충돌을 정리해야 할 때는 다음 유틸리티를 사용합니다.

```bat
python cleanup_onnxruntime_conflicts.py
```

## 저장소에 포함하지 않는 항목

다음 항목은 실행 중 생성되거나 용량이 큰 로컬 산출물이므로 Git에서 제외합니다.

- `.venv`, `.venv_noise`, `.ven_slice`
- `.tmp`, `.tools`, `.model_cache`
- `frontend/node_modules`, `frontend/out`, `frontend/release`
- `training/cache`, `training/runtime`, `training/vendor`, `training/work`
- zip/7z/exe/모델 체크포인트/오디오 파일. 단, 설치기 구성에 필요한 `training/training.7z`는 예외로 포함합니다.
- `복사본`, `백업`, `버림`이 포함된 수동 작업 폴더

## 참고

모델 파일과 대형 학습 런타임은 저장소에 직접 포함하지 않습니다. 필요한 모델과 런타임은 각 실행 스크립트가 캐시 디렉터리로 내려받거나 준비합니다.
