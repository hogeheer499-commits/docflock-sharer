import asyncio
import logging
import os
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any


logger = logging.getLogger("docremote.zoom")

FALLBACK_WARNING = "Used xdotool fallback; real Zoom state is unknown."
PARTICIPANT_WARNING = (
    "Hoge Heer is participant; unmute/start-video can be blocked by host settings. "
    "Make Hoge Heer host/co-host/alternative host for reliable recovery."
)
UNSUPPORTED_WARNING = "Zoom SDK capability unsupported; fallback may be required."


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


@dataclass
class ZoomState:
    mode: str = field(default_factory=lambda: os.getenv("ZOOM_CONTROL_MODE", "auto"))
    bridge_connected: bool = False
    can_read_state: bool = False
    audio_on: bool | None = None
    video_on: bool | None = None
    desired_audio_on: bool = True
    desired_video_on: bool = True
    source: str = "unknown"
    role: str | None = "unknown"
    screen_name: str | None = field(default_factory=lambda: os.getenv("ZOOM_BRIDGE_CLIENT_NAME", "Hoge Heer"))
    last_update: str | None = None
    last_error: str | None = None
    warning: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "ok": True,
            "mode": self.mode,
            "bridge_connected": self.bridge_connected,
            "can_read_state": self.can_read_state,
            "audio_on": self.audio_on,
            "video_on": self.video_on,
            "desired_audio_on": self.desired_audio_on,
            "desired_video_on": self.desired_video_on,
            "source": self.source,
            "role": self.role,
            "screen_name": self.screen_name,
            "last_update": self.last_update,
            "last_error": self.last_error,
            "warning": self.warning,
        }


@dataclass
class ZoomCommand:
    id: str
    type: str
    value: bool | None
    status: str = "pending"
    result: dict[str, Any] | None = None
    created_at: str = field(default_factory=utc_now)
    updated_at: str = field(default_factory=utc_now)
    error: str | None = None

    def bridge_payload(self) -> dict[str, Any]:
        return {"id": self.id, "type": self.type, "value": self.value}

    def as_dict(self) -> dict[str, Any]:
        return {
            "command_id": self.id,
            "status": self.status,
            "result": self.result,
            "error": self.error,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }


class ZoomCommandStore:
    def __init__(self, timeout_sec: float | None = None):
        self.timeout_sec = timeout_sec or float(os.getenv("ZOOM_BRIDGE_COMMAND_TIMEOUT_SEC", "10"))
        self._commands: dict[str, ZoomCommand] = {}
        self._pending_by_client: dict[str, list[str]] = {}
        self._lock = asyncio.Lock()

    async def create(self, command_type: str, value: bool | None, client_id: str | None) -> ZoomCommand:
        command = ZoomCommand(id=str(uuid.uuid4()), type=command_type, value=value)
        async with self._lock:
            self._commands[command.id] = command
            if client_id:
                self._pending_by_client.setdefault(client_id, []).append(command.id)
        return command

    async def poll(self, client_id: str) -> dict[str, Any]:
        async with self._lock:
            queue = self._pending_by_client.setdefault(client_id, [])
            while queue:
                command_id = queue.pop(0)
                command = self._commands.get(command_id)
                if command and command.status == "pending":
                    return {"ok": True, "command": command.bridge_payload()}
        return {"ok": True, "command": None}

    async def mark_result(self, command_id: str, status: str, result: dict[str, Any] | None, error: str | None = None) -> ZoomCommand | None:
        async with self._lock:
            command = self._commands.get(command_id)
            if not command:
                return None
            command.status = status
            command.result = result
            command.error = error
            command.updated_at = utc_now()
            return command

    async def get(self, command_id: str) -> ZoomCommand | None:
        async with self._lock:
            command = self._commands.get(command_id)
            if not command:
                return None
            if command.status == "pending" and self._is_timed_out(command):
                command.status = "timeout"
                command.error = "zoom_bridge_command_timeout"
                command.updated_at = utc_now()
            return command

    def _is_timed_out(self, command: ZoomCommand) -> bool:
        try:
            created = datetime.fromisoformat(command.created_at)
        except ValueError:
            return False
        return (datetime.now(timezone.utc) - created).total_seconds() > self.timeout_sec


class BridgeZoomController:
    def __init__(self, state: ZoomState, commands: ZoomCommandStore):
        self.state = state
        self.commands = commands
        self.clients: dict[str, dict[str, Any]] = {}
        self.active_client_id: str | None = None

    def connected(self) -> bool:
        if not self.active_client_id or self.active_client_id not in self.clients:
            return False
        last_seen = self.clients[self.active_client_id].get("last_seen")
        try:
            seen_at = datetime.fromisoformat(last_seen)
        except (TypeError, ValueError):
            return False
        return (datetime.now(timezone.utc) - seen_at).total_seconds() <= max(30, self.commands.timeout_sec * 3)

    async def register(self, payload: dict[str, Any]) -> dict[str, Any]:
        client_id = str(payload.get("client_id") or uuid.uuid4())
        self.clients[client_id] = {**payload, "client_id": client_id, "last_seen": utc_now()}
        self.active_client_id = client_id
        self.state.bridge_connected = True
        self.state.screen_name = payload.get("screen_name") or self.state.screen_name
        self.state.role = normalize_role(payload.get("role"))
        self.state.last_update = utc_now()
        unsupported = payload.get("unsupported_apis") or []
        self.state.warning = warning_for(self.state.role, bool(unsupported), None)
        return {"ok": True, "client_id": client_id, "state": self.state.as_dict()}

    async def poll(self, client_id: str) -> dict[str, Any]:
        if client_id in self.clients:
            self.clients[client_id]["last_seen"] = utc_now()
            self.active_client_id = client_id
            self.state.bridge_connected = True
        return await self.commands.poll(client_id)

    async def update_state(self, payload: dict[str, Any]) -> dict[str, Any]:
        client_id = str(payload.get("client_id") or "")
        if client_id:
            self.clients.setdefault(client_id, {"client_id": client_id})
            self.clients[client_id]["last_seen"] = utc_now()
            self.active_client_id = client_id
        self.state.bridge_connected = bool(client_id)
        self.state.can_read_state = True
        self.state.audio_on = normalize_bool(payload.get("audio_on"))
        self.state.video_on = normalize_bool(payload.get("video_on"))
        self.state.role = normalize_role(payload.get("role")) or self.state.role
        self.state.screen_name = payload.get("screen_name") or self.state.screen_name
        self.state.last_update = payload.get("timestamp") or utc_now()
        self.state.last_error = payload.get("last_error")
        self.state.source = "bridge"
        self.state.warning = warning_for(self.state.role, False, self.state.last_error)
        return {"ok": True, "state": self.state.as_dict()}

    async def submit_result(self, payload: dict[str, Any]) -> dict[str, Any]:
        command_id = str(payload.get("id") or payload.get("command_id") or "")
        status = str(payload.get("status") or "done")
        result = payload.get("result") if isinstance(payload.get("result"), dict) else {}
        error = payload.get("error") or result.get("error")
        mapped_status = "done" if status in {"done", "ok", "blocked_or_mismatch"} else "failed"
        if status == "timeout":
            mapped_status = "timeout"
        command = await self.commands.mark_result(command_id, mapped_status, result, error)
        if not command:
            return {"ok": False, "error": "command_not_found", "state": self.state.as_dict()}
        state_payload = result.get("state") if isinstance(result.get("state"), dict) else result
        if isinstance(state_payload, dict):
            await self.update_state({
                "client_id": payload.get("client_id") or self.active_client_id,
                "audio_on": state_payload.get("audio_on"),
                "video_on": state_payload.get("video_on"),
                "role": state_payload.get("role"),
                "screen_name": state_payload.get("screen_name"),
                "timestamp": state_payload.get("timestamp"),
                "last_error": error,
            })
        if status == "blocked_or_mismatch":
            self.state.warning = "Zoom command blocked or state mismatch after SDK call."
        log_command(command.id, "bridge", command.type, command.value, command.status, self.state.as_dict(), error, self.state.warning)
        return {"ok": True, "command_id": command.id, "status": command.status, "state": self.state.as_dict()}

    async def enqueue(self, command_type: str, value: bool | None) -> dict[str, Any]:
        command = await self.commands.create(command_type, value, self.active_client_id)
        log_command(command.id, "bridge", command_type, value, "pending", self.state.as_dict(), None, self.state.warning)
        return {"ok": True, "command_id": command.id, "pending": True, "state": self.state.as_dict()}


class XdotoolZoomController:
    def __init__(self, state: ZoomState):
        self.state = state
        self.display = os.getenv("ZOOM_DISPLAY", ":1")
        self.mode = os.getenv("ZOOM_XDOTOOL_MODE", "target_window")

    async def set_audio(self, on: bool, force: bool = False) -> dict[str, Any]:
        return await self._set_media("audio", on, "alt+a", force)

    async def set_video(self, on: bool, force: bool = False) -> dict[str, Any]:
        return await self._set_media("video", on, "alt+v", force)

    async def toggle_audio(self) -> dict[str, Any]:
        cached = self.state.audio_on
        desired = False if cached is True else True
        return await self._set_media("audio", desired, "alt+a", True)

    async def toggle_video(self) -> dict[str, Any]:
        cached = self.state.video_on
        desired = False if cached is True else True
        return await self._set_media("video", desired, "alt+v", True)

    async def recover(self) -> dict[str, Any]:
        audio = await self.set_audio(True, force=True)
        video = await self.set_video(True, force=True)
        ok = bool(audio.get("ok") and video.get("ok"))
        return {"ok": ok, "state": self.state.as_dict(), "warning": FALLBACK_WARNING}

    async def leave(self) -> dict[str, Any]:
        await self.send_key_sequence(["alt+q", "Return"], delay_sec=0.5)
        self.state.bridge_connected = False
        self.state.audio_on = None
        self.state.video_on = None
        self.state.can_read_state = False
        self.state.source = "unknown"
        self.state.last_update = utc_now()
        self.state.warning = FALLBACK_WARNING
        return {"ok": True, "state": self.state.as_dict(), "warning": FALLBACK_WARNING}

    async def _set_media(self, media: str, on: bool, key: str, force: bool) -> dict[str, Any]:
        cached_attr = "audio_on" if media == "audio" else "video_on"
        cached = getattr(self.state, cached_attr)
        should_toggle = force or cached is not None and cached != on
        if should_toggle:
            await self.send_key(key)
            setattr(self.state, cached_attr, on)
            self.state.source = "xdotool_cached"
        else:
            setattr(self.state, cached_attr, cached if cached is not None else None)
            self.state.source = "unknown" if cached is None else "xdotool_cached"
        self.state.can_read_state = False
        self.state.bridge_connected = False
        self.state.last_update = utc_now()
        self.state.warning = FALLBACK_WARNING
        return {"ok": True, "state": self.state.as_dict(), "warning": FALLBACK_WARNING}

    async def send_key(self, key: str) -> None:
        await self.send_key_sequence([key])

    async def send_key_sequence(self, keys: list[str], delay_sec: float = 0.0) -> None:
        env = os.environ.copy()
        env["DISPLAY"] = self.display
        if self.mode == "global":
            for key in keys:
                proc = await asyncio.create_subprocess_exec(
                    "xdotool", "key", "--clearmodifiers", key,
                    env=env,
                    stdout=asyncio.subprocess.DEVNULL,
                    stderr=asyncio.subprocess.PIPE,
                )
                _, stderr = await proc.communicate()
                if proc.returncode != 0:
                    raise RuntimeError(stderr.decode().strip() or "xdotool global key failed")
                if delay_sec:
                    await asyncio.sleep(delay_sec)
            return

        window_ids: list[str] = []
        for name in ["Zoom Meeting", "Meeting", "Zoom Workplace"]:
            find = await asyncio.create_subprocess_exec(
                "xdotool", "search", "--onlyvisible", "--name", name,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=env,
            )
            stdout, _ = await find.communicate()
            window_ids = [w for w in stdout.decode().strip().split("\n") if w]
            if window_ids:
                break
        if not window_ids:
            find = await asyncio.create_subprocess_exec(
                "xdotool", "search", "--onlyvisible", "--class", "zoom",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=env,
            )
            stdout, _ = await find.communicate()
            window_ids = [w for w in stdout.decode().strip().split("\n") if w]
        if not window_ids:
            raise RuntimeError("Zoom window not found")
        command = ["xdotool", "windowactivate", "--sync", window_ids[0]]
        for index, key in enumerate(keys):
            command.extend(["key", "--clearmodifiers", key])
            if delay_sec and index < len(keys) - 1:
                command.extend(["sleep", str(delay_sec)])
        proc = await asyncio.create_subprocess_exec(
            *command,
            env=env,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await proc.communicate()
        if proc.returncode != 0:
            raise RuntimeError(stderr.decode().strip() or "xdotool target_window key failed")


class AutoZoomController:
    def __init__(self):
        self.state = ZoomState()
        self.commands = ZoomCommandStore()
        self.bridge = BridgeZoomController(self.state, self.commands)
        self.xdotool = XdotoolZoomController(self.state)
        self.fallback_enabled = env_bool("ZOOM_XDOTOOL_FALLBACK", False)
        if not os.getenv("ZOOM_BRIDGE_TOKEN"):
            logger.warning("ZOOM_BRIDGE_TOKEN is not configured; bridge requests are unauthenticated in development mode")

    def get_state(self) -> dict[str, Any]:
        self.state.mode = os.getenv("ZOOM_CONTROL_MODE", self.state.mode)
        self.state.bridge_connected = self.bridge.connected()
        return self.state.as_dict()

    async def set_audio(self, on: bool) -> dict[str, Any]:
        self.state.desired_audio_on = on
        return await self._command("set_audio", on)

    async def set_video(self, on: bool) -> dict[str, Any]:
        self.state.desired_video_on = on
        return await self._command("set_video", on)

    async def recover(self) -> dict[str, Any]:
        self.state.desired_audio_on = True
        self.state.desired_video_on = True
        return await self._command("recover", None)

    async def leave(self) -> dict[str, Any]:
        mode = os.getenv("ZOOM_CONTROL_MODE", "auto")
        self.state.mode = mode
        if mode == "disabled":
            self.state.warning = "Zoom control disabled."
            return {"ok": False, "error": "zoom_control_disabled", "state": self.state.as_dict()}
        if mode in {"auto", "xdotool"}:
            try:
                return await self.xdotool.leave()
            except Exception as exc:
                self.state.last_error = str(exc)
                self.state.warning = FALLBACK_WARNING
                if mode == "xdotool":
                    return {"ok": False, "error": "xdotool_fallback_failed", "state": self.state.as_dict()}
        if mode in {"auto", "bridge"} and self.bridge.connected():
            return await self.bridge.enqueue("leave", None)
        if mode == "bridge":
            return {"ok": False, "error": "zoom_bridge_not_connected", "state": self.state.as_dict()}
        return {"ok": False, "error": "zoom_window_not_found", "state": self.state.as_dict()}


    async def legacy_toggle_audio(self) -> dict[str, Any]:
        if os.getenv("ZOOM_CONTROL_MODE", "auto") == "xdotool" and self.fallback_enabled:
            result = await self.xdotool.toggle_audio()
            result["deprecated"] = True
            result["replacement"] = "/api/zoom/audio/on|off"
            return result
        desired = not bool(self.state.desired_audio_on)
        result = await self.set_audio(desired)
        result["deprecated"] = True
        result["replacement"] = "/api/zoom/audio/on|off"
        return result

    async def legacy_toggle_video(self) -> dict[str, Any]:
        if os.getenv("ZOOM_CONTROL_MODE", "auto") == "xdotool" and self.fallback_enabled:
            result = await self.xdotool.toggle_video()
            result["deprecated"] = True
            result["replacement"] = "/api/zoom/video/on|off"
            return result
        desired = not bool(self.state.desired_video_on)
        result = await self.set_video(desired)
        result["deprecated"] = True
        result["replacement"] = "/api/zoom/video/on|off"
        return result

    async def _command(self, command_type: str, value: bool | None) -> dict[str, Any]:
        mode = os.getenv("ZOOM_CONTROL_MODE", "auto")
        self.state.mode = mode
        if mode == "disabled":
            self.state.warning = "Zoom control disabled."
            return {"ok": False, "error": "zoom_control_disabled", "state": self.state.as_dict()}
        if mode in {"auto", "bridge"} and self.bridge.connected():
            return await self.bridge.enqueue(command_type, value)
        if mode == "bridge":
            return {"ok": False, "error": "zoom_bridge_not_connected", "state": self.state.as_dict()}
        if mode in {"auto", "xdotool"} and self.fallback_enabled:
            try:
                if command_type == "set_audio":
                    return await self.xdotool.set_audio(bool(value))
                if command_type == "set_video":
                    return await self.xdotool.set_video(bool(value))
                if command_type == "recover":
                    return await self.xdotool.recover()
                if command_type == "leave":
                    return await self.xdotool.leave()
            except Exception as exc:
                self.state.last_error = str(exc)
                self.state.warning = FALLBACK_WARNING
                return {"ok": False, "error": "xdotool_fallback_failed", "state": self.state.as_dict()}
        return {"ok": False, "error": "zoom_bridge_not_connected", "state": self.state.as_dict()}

    async def command_status(self, command_id: str) -> dict[str, Any]:
        command = await self.commands.get(command_id)
        if not command:
            return {"ok": False, "error": "command_not_found", "state": self.get_state()}
        return {"ok": True, **command.as_dict(), "state": self.get_state()}


def normalize_bool(value: Any) -> bool | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in {"true", "on", "unmuted", "started", "yes", "1"}:
            return True
        if lowered in {"false", "off", "muted", "stopped", "no", "0"}:
            return False
    return None


def normalize_role(value: Any) -> str | None:
    if value is None:
        return None
    role = str(value).strip().lower()
    if role in {"host", "cohost", "participant", "unknown"}:
        return role
    if role in {"co-host", "co_host"}:
        return "cohost"
    return "unknown"


def warning_for(role: str | None, unsupported: bool, last_error: str | None) -> str | None:
    if unsupported:
        return UNSUPPORTED_WARNING
    if role == "participant":
        return PARTICIPANT_WARNING
    if last_error:
        return last_error
    return None


def log_command(
    command_id: str,
    source: str,
    action: str,
    desired: bool | None,
    result: str,
    state: dict[str, Any],
    error: str | None,
    warning: str | None,
) -> None:
    logger.info(
        "zoom command id=%s source=%s action=%s desired=%s result=%s state=%s error=%s warning=%s",
        command_id,
        source,
        action,
        desired,
        result,
        {k: state.get(k) for k in ("audio_on", "video_on", "source", "role", "bridge_connected")},
        error,
        warning,
    )
