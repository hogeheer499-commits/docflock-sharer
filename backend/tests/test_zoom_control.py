import asyncio

import pytest
from fastapi.testclient import TestClient

import main
from zoom_control import AutoZoomController


@pytest.fixture(autouse=True)
def reset_zoom(monkeypatch):
    monkeypatch.setenv("ZOOM_CONTROL_MODE", "auto")
    monkeypatch.setenv("ZOOM_XDOTOOL_FALLBACK", "false")
    monkeypatch.delenv("ZOOM_BRIDGE_TOKEN", raising=False)
    main.zoom_controller = AutoZoomController()
    yield


@pytest.fixture
def client():
    return TestClient(main.app)


def test_zoom_state_shape(client):
    data = client.get("/api/zoom/state").json()
    assert data["ok"] is True
    assert data["mode"] == "auto"
    assert data["bridge_connected"] is False
    assert data["can_read_state"] is False
    assert data["audio_on"] is None
    assert data["video_on"] is None
    assert data["desired_audio_on"] is True
    assert data["desired_video_on"] is True
    assert data["source"] == "unknown"
    assert data["screen_name"] == "Hoge Heer"


def test_recover_without_bridge_and_fallback_disabled(client):
    data = client.post("/api/zoom/recover").json()
    assert data["ok"] is False
    assert data["error"] == "zoom_bridge_not_connected"
    assert data["state"]["bridge_connected"] is False


def test_bridge_register(client):
    data = client.post("/api/zoom/bridge/register", json={
        "client_id": "client-1",
        "screen_name": "Hoge Heer",
        "role": "host",
        "participant_uuid": "p-1",
        "client_version": "test",
        "unsupported_apis": [],
    }).json()
    assert data["ok"] is True
    assert data["client_id"] == "client-1"
    assert data["state"]["bridge_connected"] is True
    assert data["state"]["role"] == "host"


def test_bridge_state_update(client):
    client.post("/api/zoom/bridge/register", json={"client_id": "client-1", "role": "host"})
    data = client.post("/api/zoom/bridge/state", json={
        "client_id": "client-1",
        "audio_on": True,
        "video_on": False,
        "role": "cohost",
        "screen_name": "Hoge Heer",
        "timestamp": "2026-05-01T10:00:00+00:00",
        "last_error": None,
    }).json()
    assert data["state"]["can_read_state"] is True
    assert data["state"]["audio_on"] is True
    assert data["state"]["video_on"] is False
    assert data["state"]["source"] == "bridge"


def test_command_queue_creates_command_id(client):
    client.post("/api/zoom/bridge/register", json={"client_id": "client-1", "role": "host"})
    data = client.post("/api/zoom/audio/on").json()
    assert data["ok"] is True
    assert data["pending"] is True
    assert data["command_id"]
    polled = client.get("/api/zoom/bridge/poll?client_id=client-1").json()
    assert polled["command"]["id"] == data["command_id"]
    assert polled["command"]["type"] == "set_audio"
    assert polled["command"]["value"] is True


def test_leave_command_queues_for_bridge(client, monkeypatch):
    monkeypatch.setenv("ZOOM_CONTROL_MODE", "bridge")
    client.post("/api/zoom/bridge/register", json={"client_id": "client-1", "role": "host"})
    data = client.post("/api/zoom/leave").json()
    assert data["ok"] is True
    assert data["pending"] is True
    assert data["command_id"]
    polled = client.get("/api/zoom/bridge/poll?client_id=client-1").json()
    assert polled["command"]["id"] == data["command_id"]
    assert polled["command"]["type"] == "leave"
    assert polled["command"]["value"] is None


def test_bridge_result_marks_command_done(client):
    client.post("/api/zoom/bridge/register", json={"client_id": "client-1", "role": "host"})
    created = client.post("/api/zoom/recover").json()
    command_id = created["command_id"]
    result = client.post("/api/zoom/bridge/result", json={
        "client_id": "client-1",
        "id": command_id,
        "status": "done",
        "result": {
            "state": {
                "audio_on": True,
                "video_on": True,
                "role": "host",
                "screen_name": "Hoge Heer",
                "timestamp": "2026-05-01T10:00:00+00:00",
            }
        },
    }).json()
    assert result["status"] == "done"
    status = client.get(f"/api/zoom/commands/{command_id}").json()
    assert status["ok"] is True
    assert status["status"] == "done"
    assert status["state"]["audio_on"] is True
    assert status["state"]["video_on"] is True


def test_legacy_endpoints_exist(client):
    mute = client.post("/api/zoom/mute").json()
    video = client.post("/api/zoom/video").json()
    assert mute["deprecated"] is True
    assert video["deprecated"] is True
    assert mute["replacement"] == "/api/zoom/audio/on|off"
    assert video["replacement"] == "/api/zoom/video/on|off"


def test_xdotool_fallback_never_reports_real_state(monkeypatch):
    monkeypatch.setenv("ZOOM_CONTROL_MODE", "xdotool")
    monkeypatch.setenv("ZOOM_XDOTOOL_FALLBACK", "true")
    controller = AutoZoomController()

    async def fake_send_key(key):
        return None

    controller.xdotool.send_key = fake_send_key
    result = asyncio.run(controller.recover())
    state = result["state"]
    assert result["ok"] is True
    assert state["can_read_state"] is False
    assert state["source"] in {"unknown", "xdotool_cached"}
    assert state["warning"] == "Used xdotool fallback; real Zoom state is unknown."


def test_leave_uses_local_zoom_shortcut(monkeypatch):
    controller = AutoZoomController()
    sent = []

    async def fake_send_key_sequence(keys, delay_sec=0.0):
        sent.append((keys, delay_sec))

    controller.xdotool.send_key_sequence = fake_send_key_sequence
    result = asyncio.run(controller.leave())
    assert result["ok"] is True
    assert sent == [(["alt+q", "Return"], 0.5)]
    assert result["state"]["bridge_connected"] is False
