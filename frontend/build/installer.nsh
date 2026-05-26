!define MUI_INSTFILESPAGE_SHOWDETAILS
!define MUI_WELCOMEPAGE_TITLE "WAV QC Studio 설치"
!define MUI_WELCOMEPAGE_TEXT "WAV QC Studio 설치 마법사입니다.$\r$\n$\r$\n이 설치기는 앱 본체와 Development 원본 백업을 설치합니다."
!define MUI_LICENSEPAGE_TEXT_TOP "WAV QC Studio 라이선스와 서드파티 자산 고지를 확인하세요. 동의하면 다음 단계로 진행할 수 있습니다."
!define MUI_LICENSEPAGE_TEXT_BOTTOM "설치를 계속하려면 라이선스 조건에 동의해야 합니다."
!define MUI_LICENSEPAGE_BUTTON "동의함"
!define MUI_DIRECTORYPAGE_TEXT_TOP "WAV QC Studio를 설치할 폴더를 선택하세요. 기본 경로를 사용하거나 찾아보기를 눌러 원하는 위치를 지정할 수 있습니다."
!define MUI_INSTFILESPAGE_FINISHHEADER_TEXT "설치 작업 완료"
!define MUI_INSTFILESPAGE_FINISHHEADER_SUBTEXT "앱 본체 설치가 완료되었습니다."
!define MUI_FINISHPAGE_TITLE "WAV QC Studio 설치 완료"
!define MUI_FINISHPAGE_TEXT "WAV QC Studio가 설치되었습니다.$\r$\n$\r$\n필요한 런타임은 앱 안의 설치 위젯에서 설치할 수 있습니다."

Function LicensePageShow
  FindWindow $0 "#32770" "" $HWNDPARENT
  GetDlgItem $1 $0 1000

  System::Store "S"
  System::Call 'USER32::GetWindowRect(psr1,@r2)'
  System::Call 'USER32::MapWindowPoints(p0,psr0,pr2,i2)'
  System::Call '*$2(i.r3,i.r4,i.r5,i.r6)'
  IntOp $5 $5 - $3
  IntOp $6 $6 - $4
  IntOp $4 $4 + 10
  IntOp $6 $6 - 10
  System::Call 'USER32::SetWindowPos(psr1,p0,ir3,ir4,ir5,ir6,i0x14)'
  System::Store "L"
FunctionEnd
