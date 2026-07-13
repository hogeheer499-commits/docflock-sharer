#!/usr/bin/python3
"""Safely end a hosted Zoom meeting or leave it as a participant."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from collections.abc import Iterable

import gi

gi.require_version("Atspi", "2.0")
from gi.repository import Atspi  # noqa: E402


HOST_END_LABELS = {"end"}
END_FOR_ALL_LABELS = {"end meeting for all"}
PARTICIPANT_LEAVE_LABELS = {"leave"}
LEAVE_MEETING_LABELS = {"leave meeting"}
MAX_ACCESSIBLES = 10_000


def normalized_name(accessible) -> str:
    try:
        return " ".join((accessible.get_name() or "").casefold().split())
    except Exception:
        return ""


def state_contains(accessible, state: Atspi.StateType) -> bool:
    try:
        return bool(accessible.get_state_set().contains(state))
    except Exception:
        return False


def is_actionable(accessible) -> bool:
    return state_contains(accessible, Atspi.StateType.ENABLED) and state_contains(
        accessible, Atspi.StateType.SENSITIVE
    )


def is_showing(accessible) -> bool:
    return state_contains(accessible, Atspi.StateType.SHOWING) and state_contains(
        accessible, Atspi.StateType.VISIBLE
    )


def walk_accessibles(root) -> Iterable:
    stack = [(root, 0)]
    visited = 0
    while stack and visited < MAX_ACCESSIBLES:
        node, depth = stack.pop()
        visited += 1
        yield node
        if depth >= 20:
            continue
        try:
            children = [
                node.get_child_at_index(index)
                for index in range(min(node.get_child_count(), 500))
            ]
        except Exception:
            continue
        stack.extend((child, depth + 1) for child in reversed(children) if child is not None)


def zoom_application():
    desktop = Atspi.get_desktop(0)
    for index in range(desktop.get_child_count()):
        app = desktop.get_child_at_index(index)
        if normalized_name(app) == "zoom":
            return app
    return None


def find_control(labels: set[str], *, require_showing: bool) -> object | None:
    app = zoom_application()
    if app is None:
        return None
    candidates = []
    for accessible in walk_accessibles(app):
        if normalized_name(accessible) not in labels or not is_actionable(accessible):
            continue
        showing = is_showing(accessible)
        if require_showing and not showing:
            continue
        candidates.append((showing, accessible))
    if not candidates:
        return None
    candidates.sort(key=lambda item: item[0], reverse=True)
    return candidates[0][1]


def wait_for_control(labels: set[str], timeout: float, *, require_showing: bool):
    deadline = time.monotonic() + timeout
    while True:
        control = find_control(labels, require_showing=require_showing)
        if control is not None:
            return control
        if time.monotonic() >= deadline:
            return None
        time.sleep(0.15)


def press(accessible) -> bool:
    try:
        action = accessible.get_action_iface()
        if action is None:
            return False
        fallback_index = None
        for index in range(action.get_n_actions()):
            if fallback_index is None:
                fallback_index = index
            if (action.get_action_name(index) or "").casefold() == "press":
                return bool(action.do_action(index))
        return fallback_index is not None and bool(action.do_action(fallback_index))
    except Exception:
        return False


def dismiss_open_zoom_menu() -> None:
    try:
        subprocess.run(
            ["xdotool", "key", "--clearmodifiers", "Escape"],
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            env=os.environ.copy(),
            timeout=2,
        )
    except Exception:
        pass


def result(ok: bool, **payload) -> int:
    print(json.dumps({"ok": ok, **payload}, separators=(",", ":")))
    return 0 if ok else 1


def wait_until_control_disappears(labels: set[str], timeout: float) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if find_control(labels, require_showing=False) is None:
            return True
        time.sleep(0.25)
    return False


def end_meeting_for_all(host_end=None) -> int:
    if zoom_application() is None:
        return result(False, error="zoom_accessibility_unavailable")

    host_end = host_end or wait_for_control(HOST_END_LABELS, 1.5, require_showing=False)
    if host_end is None:
        return result(False, error="host_end_control_not_found")
    if not press(host_end):
        return result(False, error="host_end_control_failed")

    end_for_all = wait_for_control(END_FOR_ALL_LABELS, 4.0, require_showing=True)
    if end_for_all is None:
        dismiss_open_zoom_menu()
        return result(False, error="end_meeting_for_all_control_not_found")
    if not press(end_for_all):
        dismiss_open_zoom_menu()
        return result(False, error="end_meeting_for_all_control_failed")

    confirmed = wait_until_control_disappears(HOST_END_LABELS, 8.0)
    return result(True, action="end_meeting_for_all", confirmed=confirmed)


def leave_meeting(participant_leave=None) -> int:
    if zoom_application() is None:
        return result(False, error="zoom_accessibility_unavailable")

    participant_leave = participant_leave or wait_for_control(
        PARTICIPANT_LEAVE_LABELS, 1.5, require_showing=False
    )
    if participant_leave is None:
        return result(False, error="participant_leave_control_not_found")
    if not press(participant_leave):
        return result(False, error="participant_leave_control_failed")

    leave_confirmation = wait_for_control(LEAVE_MEETING_LABELS, 4.0, require_showing=True)
    if leave_confirmation is None:
        dismiss_open_zoom_menu()
        return result(False, error="leave_meeting_confirmation_not_found")
    if not press(leave_confirmation):
        dismiss_open_zoom_menu()
        return result(False, error="leave_meeting_confirmation_failed")

    confirmed = wait_until_control_disappears(PARTICIPANT_LEAVE_LABELS, 8.0)
    return result(True, action="leave_meeting", confirmed=confirmed)


def exit_meeting() -> int:
    if zoom_application() is None:
        return result(False, error="zoom_accessibility_unavailable")

    host_end = wait_for_control(HOST_END_LABELS, 1.5, require_showing=False)
    if host_end is not None:
        return end_meeting_for_all(host_end)

    participant_leave = wait_for_control(
        PARTICIPANT_LEAVE_LABELS, 1.5, require_showing=False
    )
    if participant_leave is not None:
        return leave_meeting(participant_leave)
    return result(False, error="zoom_meeting_exit_control_not_found")


def main() -> int:
    if sys.argv[1:] == ["end-meeting-for-all"]:
        return end_meeting_for_all()
    if sys.argv[1:] == ["leave-meeting"]:
        return leave_meeting()
    if sys.argv[1:] == ["exit-meeting"]:
        return exit_meeting()
    return result(False, error="unsupported_action")


if __name__ == "__main__":
    raise SystemExit(main())
