import zoom_accessibility as accessibility


def test_exit_prefers_host_end_and_never_falls_back_to_leave(monkeypatch):
    host_control = object()
    calls = []

    monkeypatch.setattr(accessibility, "zoom_application", lambda: object())
    monkeypatch.setattr(
        accessibility,
        "wait_for_control",
        lambda labels, timeout, require_showing: host_control
        if labels == accessibility.HOST_END_LABELS
        else None,
    )
    monkeypatch.setattr(
        accessibility,
        "end_meeting_for_all",
        lambda control=None: calls.append(("end", control)) or 1,
    )
    monkeypatch.setattr(
        accessibility,
        "leave_meeting",
        lambda control=None: calls.append(("leave", control)) or 0,
    )

    assert accessibility.exit_meeting() == 1
    assert calls == [("end", host_control)]


def test_exit_leaves_when_host_end_is_absent(monkeypatch):
    leave_control = object()
    calls = []

    monkeypatch.setattr(accessibility, "zoom_application", lambda: object())
    monkeypatch.setattr(
        accessibility,
        "wait_for_control",
        lambda labels, timeout, require_showing: leave_control
        if labels == accessibility.PARTICIPANT_LEAVE_LABELS
        else None,
    )
    monkeypatch.setattr(
        accessibility,
        "leave_meeting",
        lambda control=None: calls.append(("leave", control)) or 0,
    )

    assert accessibility.exit_meeting() == 0
    assert calls == [("leave", leave_control)]
