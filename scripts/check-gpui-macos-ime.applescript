-- SPDX-License-Identifier: Apache-2.0
-- Copyright (C) 2026 ImgConvert contributors

-- Read-only checks on a dedicated macOS test candidate. This does not type or
-- switch input sources. Keep a simultaneous recording for visual positioning.
-- Usage: osascript scripts/check-gpui-macos-ime.applescript PID FIELD TEXT present|absent
on run argv
    if (count of argv) is not 4 then error "Expected candidate PID, field name, exact text, and present|absent"
    set targetPid to (item 1 of argv) as integer
    set fieldName to item 2 of argv
    set expectedText to item 3 of argv
    set candidateMode to item 4 of argv
    if fieldName is "" then error "Expected a nonempty field name"
    if candidateMode is not "present" and candidateMode is not "absent" then error "Expected present|absent"
    repeat with attempt from 1 to 3
        try
            return my inspectInput(targetPid, fieldName, expectedText, candidateMode)
        on error errorMessage number errorNumber
            if errorNumber is not -1728 or attempt is 3 then error errorMessage number errorNumber
            delay 0.1
        end try
    end repeat
end run

on inspectInput(targetPid, fieldName, expectedText, candidateMode)
    tell application "System Events"
        set targetProcess to first process whose unix id is targetPid
        if (unix id of targetProcess) is not targetPid then error "Process reference resolved to a different PID"
        set fieldRef to text field fieldName of group 1 of window "ImgConvert" of targetProcess
        set actualText to value of fieldRef
        considering case, diacriticals
            if actualText is not expectedText then error "Unexpected field text: " & actualText
        end considering
        set fieldPosition to position of fieldRef
        set fieldSize to size of fieldRef
        set report to "pid=" & targetPid & linefeed & "text=" & actualText & linefeed
        set report to report & "field=" & item 1 of fieldPosition & "," & item 2 of fieldPosition & "," & item 1 of fieldSize & "," & item 2 of fieldSize & linefeed
        set candidateCount to 0
        repeat with windowRef in windows of targetProcess
            set windowName to name of windowRef
            -- An input-method popup is unnamed. Never descend into a file
            -- picker, whose filesystem list is unrelated and potentially huge.
            if windowName is missing value or windowName is "" then
                repeat with listRef in lists of windowRef
                    if (value of attribute "AXIdentifier" of listRef) is "InputMethodCandidateList" then
                        set candidateCount to candidateCount + 1
                        set candidatePosition to position of windowRef
                        set candidateSize to size of windowRef
                        set report to report & "candidate=" & item 1 of candidatePosition & "," & item 2 of candidatePosition & "," & item 1 of candidateSize & "," & item 2 of candidateSize & linefeed
                        set report to report & "choices:"
                        repeat with buttonRef in buttons of listRef
                            set report to report & " " & (name of buttonRef)
                        end repeat
                        set report to report & linefeed
                    end if
                end repeat
            end if
        end repeat
        if candidateMode is "present" and candidateCount is not 1 then error "Expected exactly one native input-method candidate list; found " & candidateCount
        if candidateMode is "absent" and candidateCount is not 0 then error "Unexpected native input-method candidate list"
        return report & "PASS: candidate lists=" & candidateCount
    end tell
end inspectInput
