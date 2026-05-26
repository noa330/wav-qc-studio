!include "LogicLib.nsh"
!include "nsDialogs.nsh"
!include "FileFunc.nsh"
!insertmacro GetParameters
!insertmacro GetOptions

!define MUI_INSTFILESPAGE_SHOWDETAILS
!define MUI_WELCOMEPAGE_TITLE "WAV QC Studio 설치"
!define MUI_WELCOMEPAGE_TEXT "WAV QC Studio 설치 마법사입니다.$\r$\n$\r$\n이 설치기는 앱 본체와 Development 원본 백업을 설치하고, 필요한 경우 Python 가상환경을 구성합니다.$\r$\n$\r$\n설치 경로와 가상환경 구성은 다음 단계에서 선택할 수 있습니다."
!define MUI_LICENSEPAGE_TEXT_TOP "WAV QC Studio 라이선스와 서드파티 자산 고지를 확인하세요. 동의하면 다음 단계로 진행할 수 있습니다.$\r$\n$\r$\n"
!define MUI_LICENSEPAGE_TEXT_BOTTOM "설치를 계속하려면 라이선스 조건에 동의해야 합니다."
!define MUI_LICENSEPAGE_BUTTON "동의함"
!define MUI_DIRECTORYPAGE_TEXT_TOP "WAV QC Studio를 설치할 폴더를 선택하세요. 기본 경로를 사용하거나 찾아보기를 눌러 원하는 위치를 지정할 수 있습니다."
!define MUI_INSTFILESPAGE_FINISHHEADER_TEXT "설치 작업 완료"
!define MUI_INSTFILESPAGE_FINISHHEADER_SUBTEXT "선택한 구성 요소 설치가 완료되었습니다."
!define MUI_FINISHPAGE_TITLE "WAV QC Studio 설치 완료"
!define MUI_FINISHPAGE_TEXT "WAV QC Studio가 설치되었습니다.$\r$\n$\r$\n선택한 Python 가상환경은 설치 로그에 표시된 순서대로 구성되었습니다."

LangString EnvPageTitle 1042 "가상환경 구성 선택"
LangString EnvPageLead 1042 "필요한 Python 가상환경만 선택하세요. 앱 본체는 항상 설치됩니다."
LangString EnvMainTitle 1042 "기본 분석/학습 (.venv)"
LangString EnvMainDesc 1042 "개요, 시각화, 학습, 추론 기능"
LangString EnvNoiseTitle 1042 "화자/노이즈 분석 (.venv_noise)"
LangString EnvNoiseDesc 1042 "화자 구분, 노이즈 분석, 보정 기능"
LangString EnvSliceTitle 1042 "슬라이스 처리 (.ven_slice)"
LangString EnvSliceDesc 1042 "오디오 슬라이싱, 음성 구간 검출"
LangString EnvFooter 1042 "모두 해제하면 앱만 설치합니다."
LangString EnvSummaryTitle 1042 "설치 전 확인"
LangString EnvSummaryLead 1042 "아래 구성으로 설치를 시작합니다."
LangString EnvInstallPath 1042 "설치 위치"
LangString EnvDevelopmentPath 1042 "개발용 원본 백업"
LangString EnvSelectedItems 1042 "선택한 가상환경"
LangString EnvNoneSelected 1042 "선택 없음 - 앱만 설치"
LangString EnvInstallPathAsciiRequired 1042 "설치 경로에는 한글 또는 유니코드 문자를 사용할 수 없습니다.$\r$\n$\r$\n영문/숫자 기반의 영어 경로만 선택해 주세요.$\r$\n예: C:\WavQcStudio"
LangString EnvLogIntro 1042 "선택한 Python 가상환경을 구성합니다. 아래 상세 로그에서 진행 상황을 확인할 수 있습니다."
LangString EnvLogSkipped 1042 "선택한 Python 가상환경이 없어 환경 설치를 건너뜁니다."
LangString EnvLogDone 1042 "Python 가상환경 구성 완료"
LangString EnvLogFailed 1042 "Python 가상환경 구성에 실패했습니다. 종료 코드:"

Var EnvDialog
Var SummaryDialog
Var MainEnvCheckbox
Var NoiseEnvCheckbox
Var SliceEnvCheckbox
Var InstallMainEnv
Var InstallNoiseEnv
Var InstallSliceEnv
Var PowerShellExe
Var CommandLineParams

!macro customPageAfterChangeDir
  Page custom EnvSelectionPageCreate EnvSelectionPageLeave
  Page custom EnvSummaryPageCreate
!macroend

!macro customInit
  StrCpy $InstallMainEnv "true"
  StrCpy $InstallNoiseEnv "true"
  StrCpy $InstallSliceEnv "true"
  Call EnvApplyCommandLineOptions
!macroend

Function EnvApplyCommandLineOptions
  ${GetParameters} $CommandLineParams

  ClearErrors
  ${GetOptions} $CommandLineParams "/D=" $0
  ${IfNot} ${Errors}
    StrCpy $INSTDIR $0
  ${EndIf}

  ClearErrors
  ${GetOptions} $CommandLineParams "/InstallMain=" $0
  ${IfNot} ${Errors}
    StrCpy $InstallMainEnv $0
  ${EndIf}

  ClearErrors
  ${GetOptions} $CommandLineParams "/InstallNoise=" $0
  ${IfNot} ${Errors}
    StrCpy $InstallNoiseEnv $0
  ${EndIf}

  ClearErrors
  ${GetOptions} $CommandLineParams "/InstallSlice=" $0
  ${IfNot} ${Errors}
    StrCpy $InstallSliceEnv $0
  ${EndIf}
FunctionEnd

Function EnvNormalizeSelection
  ${If} $InstallMainEnv != "true"
    StrCpy $InstallMainEnv "false"
  ${EndIf}
  ${If} $InstallNoiseEnv != "true"
    StrCpy $InstallNoiseEnv "false"
  ${EndIf}
  ${If} $InstallSliceEnv != "true"
    StrCpy $InstallSliceEnv "false"
  ${EndIf}
FunctionEnd

Function EnvResolvePowerShellExe
  StrCpy $PowerShellExe "$WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe"
  IfFileExists "$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe" 0 +2
    StrCpy $PowerShellExe "$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
FunctionEnd

Function EnvValidateInstallPath
  System::Call 'kernel32::WideCharToMultiByte(i 20127, i 0x400, w "$INSTDIR", i -1, t .r0, i ${NSIS_MAX_STRLEN}, p 0, *i .r1) i .r2'

  ${If} $2 == 0
  ${OrIf} $1 != 0
    MessageBox MB_ICONEXCLAMATION|MB_OK "$(EnvInstallPathAsciiRequired)"
    Abort
  ${EndIf}
FunctionEnd

Function EnvSelectionPageCreate
  Call EnvApplyCommandLineOptions

  nsDialogs::Create 1018
  Pop $EnvDialog
  ${If} $EnvDialog == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 12u "$(EnvPageTitle)"
  Pop $0
  CreateFont $1 "$(^Font)" 11 700
  SendMessage $0 ${WM_SETFONT} $1 1

  ${NSD_CreateLabel} 0 16u 100% 16u "$(EnvPageLead)"
  Pop $0

  ${NSD_CreateCheckbox} 0 38u 100% 12u "$(EnvMainTitle)"
  Pop $MainEnvCheckbox
  ${If} $InstallMainEnv != "false"
    ${NSD_SetState} $MainEnvCheckbox ${BST_CHECKED}
  ${EndIf}
  ${NSD_CreateLabel} 16u 52u 88% 10u "$(EnvMainDesc)"
  Pop $0

  ${NSD_CreateCheckbox} 0 68u 100% 12u "$(EnvNoiseTitle)"
  Pop $NoiseEnvCheckbox
  ${If} $InstallNoiseEnv != "false"
    ${NSD_SetState} $NoiseEnvCheckbox ${BST_CHECKED}
  ${EndIf}
  ${NSD_CreateLabel} 16u 82u 88% 10u "$(EnvNoiseDesc)"
  Pop $0

  ${NSD_CreateCheckbox} 0 98u 100% 12u "$(EnvSliceTitle)"
  Pop $SliceEnvCheckbox
  ${If} $InstallSliceEnv != "false"
    ${NSD_SetState} $SliceEnvCheckbox ${BST_CHECKED}
  ${EndIf}
  ${NSD_CreateLabel} 16u 112u 88% 10u "$(EnvSliceDesc)"
  Pop $0

  ${NSD_CreateLabel} 0 130u 100% 12u "$(EnvFooter)"
  Pop $0

  nsDialogs::Show
FunctionEnd

Function EnvSelectionPageLeave
  ${NSD_GetState} $MainEnvCheckbox $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $InstallMainEnv "true"
  ${Else}
    StrCpy $InstallMainEnv "false"
  ${EndIf}

  ${NSD_GetState} $NoiseEnvCheckbox $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $InstallNoiseEnv "true"
  ${Else}
    StrCpy $InstallNoiseEnv "false"
  ${EndIf}

  ${NSD_GetState} $SliceEnvCheckbox $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $InstallSliceEnv "true"
  ${Else}
    StrCpy $InstallSliceEnv "false"
  ${EndIf}
FunctionEnd

Function EnvBuildSelectionLines
  StrCpy $0 ""
  ${If} $InstallMainEnv == "true"
    StrCpy $0 "  - $(EnvMainTitle)"
  ${EndIf}
  ${If} $InstallNoiseEnv == "true"
    ${If} $0 == ""
      StrCpy $0 "  - $(EnvNoiseTitle)"
    ${Else}
      StrCpy $0 "$0$\r$\n  - $(EnvNoiseTitle)"
    ${EndIf}
  ${EndIf}
  ${If} $InstallSliceEnv == "true"
    ${If} $0 == ""
      StrCpy $0 "  - $(EnvSliceTitle)"
    ${Else}
      StrCpy $0 "$0$\r$\n  - $(EnvSliceTitle)"
    ${EndIf}
  ${EndIf}
  ${If} $0 == ""
    StrCpy $0 "  $(EnvNoneSelected)"
  ${EndIf}
FunctionEnd

Function EnvSummaryPageCreate
  Call EnvNormalizeSelection

  nsDialogs::Create 1018
  Pop $SummaryDialog
  ${If} $SummaryDialog == error
    Abort
  ${EndIf}

  Call EnvBuildSelectionLines

  ${NSD_CreateLabel} 0 0 100% 12u "$(EnvSummaryTitle)"
  Pop $1
  CreateFont $2 "$(^Font)" 11 700
  SendMessage $1 ${WM_SETFONT} $2 1

  ${NSD_CreateLabel} 0 16u 100% 16u "$(EnvSummaryLead)"
  Pop $1

  StrCpy $3 "$\r$\n$(EnvInstallPath)$\r$\n  $INSTDIR$\r$\n$\r$\n$(EnvSelectedItems)$\r$\n$0$\r$\n$\r$\n$(EnvDevelopmentPath)$\r$\n  $INSTDIR\Development$\r$\n"
  nsDialogs::CreateControl EDIT ${DEFAULT_STYLES}|${WS_VSCROLL}|${ES_MULTILINE}|${ES_AUTOVSCROLL}|${ES_READONLY} ${WS_EX_CLIENTEDGE} 0 38u 100% 94u "$3"
  Pop $1
  SendMessage $1 ${EM_SETMARGINS} 3 524296
  SendMessage $1 ${EM_SETREADONLY} 1 0
  SendMessage $1 ${EM_SETSEL} 0 0

  nsDialogs::Show
FunctionEnd

!macro customInstall
  Call EnvApplyCommandLineOptions
  Call EnvValidateInstallPath
  Call EnvNormalizeSelection

  SetDetailsView show
  DetailPrint "------------------------------------------------------------"
  DetailPrint "WAV QC Studio 설치 경로: $INSTDIR"
  DetailPrint "Development 원본 백업: $INSTDIR\Development"

  ${If} $InstallMainEnv == "false"
  ${AndIf} $InstallNoiseEnv == "false"
  ${AndIf} $InstallSliceEnv == "false"
    DetailPrint "$(EnvLogSkipped)"
  ${Else}
    DetailPrint "$(EnvLogIntro)"
    DetailPrint "  .venv       = $InstallMainEnv"
    DetailPrint "  .venv_noise = $InstallNoiseEnv"
    DetailPrint "  .ven_slice  = $InstallSliceEnv"
    DetailPrint "------------------------------------------------------------"
    Call EnvResolvePowerShellExe
    DetailPrint "PowerShell: $PowerShellExe"
    nsExec::ExecToLog '"$PowerShellExe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\setup_and_run.ps1" -InstallMain:$InstallMainEnv -InstallNoise:$InstallNoiseEnv -InstallSlice:$InstallSliceEnv'
    Pop $0
    ${If} $0 != 0
      MessageBox MB_ICONSTOP "$(EnvLogFailed) $0.$\r$\n$\r$\n상세 로그를 확인한 뒤 설치기를 다시 실행하세요."
      Abort
    ${EndIf}
    DetailPrint "$(EnvLogDone)"
  ${EndIf}
!macroend
