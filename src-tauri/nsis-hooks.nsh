; SPDX-License-Identifier: Apache-2.0

; Tauri's template removes files through $INSTDIR. Set it from the actual
; uninstaller location before Tauri's own cleanup, so a direct silent launch
; remains correct after a user selected a custom install directory.
!macro NSIS_HOOK_PREUNINSTALL
  StrCpy $INSTDIR "$EXEDIR"
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
