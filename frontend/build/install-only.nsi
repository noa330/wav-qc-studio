!include "common.nsh"
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "nsDialogs.nsh"
!include "allowOnlyOneInstallerInstance.nsh"
!include "extractAppPackage.nsh"

RequestExecutionLevel user
InstallDir "$LOCALAPPDATA\Programs\${APP_FILENAME}"

Var appExe
Var launchLink
Var licenseDialog
Var licenseTextBox
Var licenseAgreeCheckbox
Var licenseAccepted

Function .onInit
  !insertmacro check64BitAndSetRegView
  SetShellVarContext current
  SetOutPath $INSTDIR
  ${LogSet} on

  !ifmacrodef customInit
    !insertmacro customInit
!endif
FunctionEnd

Function LicensePageAppendText
  !include "license-ko-append.nsh"
FunctionEnd

Function LicensePageUpdateNext
  SendMessage $licenseAgreeCheckbox ${BM_GETCHECK} 0 0 $0
  GetDlgItem $1 $HWNDPARENT 1

  ${If} $0 = ${BST_CHECKED}
    StrCpy $licenseAccepted "1"
    EnableWindow $1 1
  ${Else}
    StrCpy $licenseAccepted "0"
    EnableWindow $1 0
  ${EndIf}
FunctionEnd

Function LicensePageCreate
  !insertmacro MUI_HEADER_TEXT_PAGE "사용권 계약" "WAV QC Studio(을)를 설치하시기 전에 사용권 계약 내용을 살펴보시기 바랍니다."

  nsDialogs::Create 1018
  Pop $licenseDialog

  ${If} $licenseDialog == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0u 0u 300u 18u "WAV QC Studio 라이선스와 서드파티 자산 고지를 확인하세요."
  Pop $0

  ${NSD_CreateRichEdit} 0u 22u 300u 88u ""
  Pop $licenseTextBox
  Call LicensePageAppendText
  SendMessage $licenseTextBox ${EM_SETREADONLY} 1 0

  ${NSD_CreateCheckBox} 0u 118u 300u 12u "설치를 계속하려면 라이선스 조건에 동의해야 합니다."
  Pop $licenseAgreeCheckbox
  ${NSD_OnClick} $licenseAgreeCheckbox LicensePageUpdateNext

  ${If} $licenseAccepted == "1"
    SendMessage $licenseAgreeCheckbox ${BM_SETCHECK} ${BST_CHECKED} 0
  ${EndIf}

  GetDlgItem $0 $HWNDPARENT 1
  SendMessage $0 ${WM_SETTEXT} 0 "STR:동의함"
  Call LicensePageUpdateNext

  nsDialogs::Show
FunctionEnd

Function LicensePageLeave
  ${If} $licenseAccepted != "1"
    MessageBox MB_ICONEXCLAMATION "설치를 계속하려면 라이선스 조건에 동의해야 합니다."
    Abort
  ${EndIf}
FunctionEnd

!insertmacro MUI_PAGE_WELCOME
Page custom LicensePageCreate LicensePageLeave
!insertmacro MUI_PAGE_DIRECTORY

!ifmacrodef customPageAfterChangeDir
  !insertmacro customPageAfterChangeDir
!endif

!insertmacro MUI_PAGE_INSTFILES

Function StartApp
  !insertmacro StartApp
FunctionEnd

!ifndef HIDE_RUN_AFTER_FINISH
  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_FUNCTION "StartApp"
!endif
!insertmacro MUI_PAGE_FINISH

!insertmacro addLangs

Section "install" INSTALL_SECTION_ID
  SetShellVarContext current
  SetOutPath $INSTDIR
  StrCpy $appExe "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  StrCpy $launchLink "$appExe"

  !insertmacro CHECK_APP_RUNNING
  !insertmacro extractEmbeddedAppPackage

  !ifndef DO_NOT_CREATE_DESKTOP_SHORTCUT
    ${ifNot} ${isNoDesktopShortcut}
      CreateShortCut "$DESKTOP\${SHORTCUT_NAME}.lnk" "$appExe" "" "$INSTDIR\resources\icon.ico" 0 "" "" "${APP_DESCRIPTION}"
    ${endIf}
  !endif

  !ifmacrodef customInstall
    !insertmacro customInstall
  !endif

  ${If} ${isForceRun}
  ${AndIf} ${Silent}
    HideWindow
    Call StartApp
  ${EndIf}
SectionEnd
