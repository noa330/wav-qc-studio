!include "common.nsh"
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "extractAppPackage.nsh"

RequestExecutionLevel user
InstallDir "$LOCALAPPDATA\Programs\${APP_FILENAME}"

Var appExe
Var launchLink

Function .onInit
  !insertmacro check64BitAndSetRegView
  SetShellVarContext current
  SetOutPath $INSTDIR
  ${LogSet} on

  !ifmacrodef customInit
    !insertmacro customInit
!endif
FunctionEnd

!insertmacro MUI_PAGE_WELCOME
!define MUI_PAGE_CUSTOMFUNCTION_LEAVE EnvValidateInstallPath
!insertmacro MUI_PAGE_DIRECTORY

!ifmacrodef customPageAfterChangeDir
  !insertmacro customPageAfterChangeDir
!endif

!insertmacro MUI_PAGE_INSTFILES

Function StartApp
  ExecShell "open" "$launchLink"
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

  !insertmacro extractEmbeddedAppPackage

  !ifndef DO_NOT_CREATE_DESKTOP_SHORTCUT
    ${ifNot} ${isNoDesktopShortcut}
      CreateShortCut "$DESKTOP\${SHORTCUT_NAME}.lnk" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
    ${endIf}
  !endif

  !ifmacrodef customInstall
    !insertmacro customInstall
  !endif
SectionEnd
