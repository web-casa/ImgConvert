-- SPDX-License-Identifier: Apache-2.0
-- Copyright (C) 2026 ImgConvert contributors

-- Read-only native regression check. Run on the dedicated macOS test account
-- while the candidate's main window shows batch progress (running or finished).
-- Usage: osascript scripts/check-gpui-macos-progress.applescript PID "Batch conversion progress"
on run argv
    if (count of argv) is not 2 then error "Expected candidate PID and localized batch progress name"
    set targetPid to (item 1 of argv) as integer
    set expectedName to item 2 of argv
    if expectedName is "" then error "Expected a nonempty batch progress name"
    tell application "System Events"
        set targetProcess to first process whose unix id is targetPid
        if (unix id of targetProcess) is not targetPid then error "Process reference resolved to a different PID"
        -- Never traverse NSOpenPanel: its filesystem tree is unrelated and can
        -- be enormous. An IME popup may also be window 1.
        set nodes to entire contents of window "ImgConvert" of targetProcess
        set indicatorCount to 0
        set batchCount to 0
        set report to "pid=" & targetPid & linefeed
        repeat with nodeRef in nodes
            if (role of nodeRef) is "AXProgressIndicator" then
                set indicatorName to name of nodeRef
                if indicatorName is missing value or indicatorName is "" then error "Unnamed native progress indicator"
                set indicatorValue to value of nodeRef
                if class of indicatorValue is not integer and class of indicatorValue is not real then error "Progress value is not numeric"
                if indicatorValue < 0 or indicatorValue > 100 then error "Progress value outside 0..100"
                set indicatorCount to indicatorCount + 1
                if indicatorName is expectedName then set batchCount to batchCount + 1
                set report to report & indicatorName & " | " & indicatorValue & linefeed
            end if
        end repeat
        if batchCount is not 1 then error "Expected exactly one localized batch progress indicator; found " & batchCount
        return report & "PASS: " & indicatorCount & " named numeric progress indicator(s)"
    end tell
end run
