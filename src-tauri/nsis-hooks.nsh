; SPDX-License-Identifier: Apache-2.0

; A directly launched NSIS uninstaller copies itself into a temporary
; directory. In that process $EXEDIR is not the application's directory.
; Tauri persists the current-user install location under this key, so restore
; $INSTDIR before Tauri's own cleanup while preserving its value if absent.
!macro NSIS_HOOK_PREUNINSTALL
  Push $0
  ReadRegStr $0 HKCU "Software\ImgConvert contributors\ImgConvert" ""
  StrCmp $0 "" imgconvert_keep_uninstall_directory
  StrCpy $INSTDIR $0
imgconvert_keep_uninstall_directory:
  Pop $0
!macroend

; Tauri deletes the main executable before this post-uninstall hook. A short,
; bounded retry covers a transient Windows file handle that can remain just
; after ImgConvert exits. It never deletes another path or a different file.
!macro NSIS_HOOK_POSTUNINSTALL
  Push $0
  StrCpy $0 0
imgconvert_retry_main_executable_delete:
  IfFileExists "$INSTDIR\imgconvert.exe" 0 imgconvert_retry_main_executable_delete_done
  Sleep 250
  Delete "$INSTDIR\imgconvert.exe"
  IntOp $0 $0 + 1
  IntCmp $0 8 imgconvert_retry_main_executable_delete_done imgconvert_retry_main_executable_delete imgconvert_retry_main_executable_delete_done
imgconvert_retry_main_executable_delete_done:
  Pop $0
!macroend
