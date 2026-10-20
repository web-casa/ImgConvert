-- SPDX-License-Identifier: Apache-2.0
-- Copyright (C) 2026 ImgConvert contributors

-- Collect actual VoiceOver output on the dedicated macOS acceptance account.
-- Start a simultaneous full-screen recording and enable the caption panel first.
-- Usage: osascript scripts/record-gpui-macos-voiceover.applescript PID STEPS first|continue|current [EXACT_CURSOR]
-- This navigates the VO cursor; it does not invoke controls or enable VoiceOver.
-- Repeated phrases can mean the end of the current container, not extra coverage.
on run argv
    if (count of argv) < 3 or (count of argv) > 4 then error "Expected PID, steps, first|continue|current, and optional exact cursor"
    set targetPid to (item 1 of argv) as integer
    set stepCount to (item 2 of argv) as integer
    set startMode to item 3 of argv
    if targetPid < 1 then error "Expected a positive candidate PID"
    if stepCount < 1 or stepCount > 100 then error "Expected steps in 1..100"
    if startMode is not "first" and startMode is not "continue" and startMode is not "current" then error "Expected first|continue|current"
    set expectedCursor to missing value
    if (count of argv) is 4 then
        if startMode is not "current" or stepCount is not 1 then error "Exact cursor requires one current observation"
        set expectedCursor to item 4 of argv
        if expectedCursor is "" then error "Expected a nonempty exact cursor"
    end if
    my checkCandidate(targetPid)
    tell application "System Events"
        if not (exists process "VoiceOver") then error "Enable VoiceOver before collecting output"
    end tell
    my checkCursor(targetPid)
    tell application "VoiceOver"
        if not (enabled of caption window) then error "Enable the VoiceOver caption panel before recording"
        if startMode is "first" then tell vo cursor to move to first item
    end tell
    set report to "pid=" & targetPid & linefeed & "Actual VoiceOver output; inspect the simultaneous video. This is not an acceptance verdict." & linefeed
    repeat with stepIndex from 1 to stepCount
        my checkCandidate(targetPid)
        tell application "VoiceOver"
            if stepIndex > 1 or startMode is "continue" then tell vo cursor to move right
            delay 0.5
        end tell
        set observation to my stableObservation(targetPid)
        set cursorText to item 1 of observation
        set spokenText to item 2 of observation
        set cursorBounds to item 3 of observation
        if expectedCursor is not missing value then
            considering case, diacriticals
                if cursorText is not expectedCursor then error "Unexpected VoiceOver cursor: " & cursorText
            end considering
        end if
        set report to report & stepIndex & " | bounds: " & (item 1 of cursorBounds) & "," & (item 2 of cursorBounds) & "," & (item 3 of cursorBounds) & "," & (item 4 of cursorBounds) & " | cursor: " & cursorText & linefeed & "phrase: " & spokenText & linefeed
    end repeat
    my checkCandidate(targetPid)
    return report
end run

on checkCandidate(targetPid)
    tell application "System Events"
        set targetProcess to first process whose unix id is targetPid
        if (unix id of targetProcess) is not targetPid then error "Process reference resolved to a different PID"
        if not (frontmost of targetProcess) then error "Candidate must remain frontmost during collection"
        if not (exists window "ImgConvert" of targetProcess) then error "Expected the candidate's ImgConvert window"
        set focusedWindow to value of attribute "AXFocusedWindow" of targetProcess
        if focusedWindow is missing value then error "Candidate has no focused native window"
        if (name of focusedWindow) is not "ImgConvert" then error "Candidate main window must have native focus"
        -- NSOpenPanel can be a separate window rather than a sheet.
        -- Reject both forms, as well as IME/popover windows taking VO context.
        if (count of windows of targetProcess) is not 1 then error "Close native pickers and extra candidate windows before collecting"
        if (count of sheets of window "ImgConvert" of targetProcess) > 0 then error "Close the native picker before collecting output"
    end tell
end checkCandidate

-- VO tracking can be independent of keyboard focus. Refuse a cursor on the
-- menu bar, Dock or another surface even while the candidate stays frontmost.
-- VoiceOver's rectangle is {left, top, right, bottom}; System Events returns
-- window position plus size in the same screen point coordinate space.
on checkCursor(targetPid)
    my checkCandidate(targetPid)
    tell application "System Events"
        set targetProcess to first process whose unix id is targetPid
        set windowPosition to position of window "ImgConvert" of targetProcess
        set windowSize to size of window "ImgConvert" of targetProcess
    end tell
    tell application "VoiceOver" to set cursorBounds to bounds of vo cursor
    if (count of cursorBounds) is not 4 then error "Missing VoiceOver cursor rectangle"
    set cursorLeft to item 1 of cursorBounds
    set cursorTop to item 2 of cursorBounds
    set cursorRight to item 3 of cursorBounds
    set cursorBottom to item 4 of cursorBounds
    if cursorRight <= cursorLeft or cursorBottom <= cursorTop then error "Empty VoiceOver cursor rectangle"
    if cursorLeft < (item 1 of windowPosition) or cursorTop < (item 2 of windowPosition) then error "VoiceOver cursor is outside the candidate window"
    if cursorRight > ((item 1 of windowPosition) + (item 1 of windowSize)) or cursorBottom > ((item 2 of windowPosition) + (item 2 of windowSize)) then error "VoiceOver cursor is outside the candidate window"
    return cursorBounds
end checkCursor

-- last phrase is speech history, not the selected control's identity. Wait for
-- a nonempty, stable cursor/rectangle; retain speech as separate evidence.
-- Stability does not establish that the last phrase is new or belongs to it.
on stableObservation(targetPid)
    set previousObservation to missing value
    repeat 20 times
        my checkCandidate(targetPid)
        tell application "VoiceOver"
            set cursorText to text under cursor of vo cursor
            set spokenText to content of last phrase
        end tell
        set cursorBounds to my checkCursor(targetPid)
        if cursorText is not missing value and cursorText is not "" and spokenText is not missing value and spokenText is not "" then
            set currentObservation to {cursorText, cursorBounds}
            if previousObservation is not missing value then
                considering case, diacriticals
                    if currentObservation is previousObservation then return {cursorText, spokenText, cursorBounds}
                end considering
            end if
            set previousObservation to currentObservation
        else
            set previousObservation to missing value
        end if
        delay 0.25
    end repeat
    error "VoiceOver cursor did not stabilize"
end stableObservation
