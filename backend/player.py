import asyncio
import os
import re
import signal
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path

from config import V4L2_DEVICE, PULSE_SINK, VIDEOS_DIR


class State(str, Enum):
    STOPPED = "stopped"
    PLAYING = "playing"
    PAUSED = "paused"
    LOADING = "loading"


@dataclass
class PlayerStatus:
    state: State = State.STOPPED
    title: str | None = None
    video_id: str | None = None
    duration: float | None = None
    current_time: float | None = None
    languages: list[str] = field(default_factory=list)
    error: str | None = None

    def to_dict(self) -> dict:
        return {
            "state": self.state.value,
            "title": self.title,
            "video_id": self.video_id,
            "duration": self.duration,
            "current_time": self.current_time,
            "languages": self.languages,
            "error": self.error,
        }


# Subtitle style per position: (Alignment, MarginV, PrimaryColour)
# All bottom-aligned, stacked with different margins and colors
_STYLE_MAP = {
    0: {"Alignment": 2, "MarginV": 50},   # Primary: white, bottom
    1: {"Alignment": 2, "MarginV": 180, "PrimaryColour": "&H00FFCC66"},  # Secondary: light blue, above
    2: {"Alignment": 2, "MarginV": 310, "PrimaryColour": "&H0066FFCC"},  # Tertiary: light green, above
}


def scan_videos() -> list[dict]:
    """Scan VIDEOS_DIR for available videos with their subtitle languages."""
    videos = []
    if not VIDEOS_DIR.is_dir():
        return videos

    for entry in sorted(VIDEOS_DIR.iterdir()):
        if not entry.is_dir():
            continue

        # Find video file (mp4, mkv, webm, avi)
        video_file = None
        for ext in ("*.mp4", "*.mkv", "*.webm", "*.avi"):
            found = list(entry.glob(ext))
            if found:
                video_file = found[0]
                break

        if not video_file:
            continue

        # Find available subtitle languages
        subs_dir = entry / "subs"
        languages = []
        if subs_dir.is_dir():
            languages = sorted(
                p.stem for p in subs_dir.glob("*.ass")
            )

        videos.append({
            "id": entry.name,
            "title": entry.name.replace("-", " ").replace("_", " ").title(),
            "file": str(video_file),
            "languages": languages,
        })

    return videos


def get_video(video_id: str) -> dict | None:
    """Get a specific video by ID."""
    for v in scan_videos():
        if v["id"] == video_id:
            return v
    return None


async def _get_duration(filepath: str) -> float | None:
    """Get video duration using ffprobe."""
    proc = await asyncio.create_subprocess_exec(
        "ffprobe", "-v", "quiet", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", filepath,
        stdout=asyncio.subprocess.PIPE,
    )
    stdout, _ = await proc.communicate()
    try:
        return float(stdout.decode().strip())
    except ValueError:
        return None


def _build_subtitle_filter(video: dict, languages: list[str]) -> str:
    """Build FFmpeg subtitle filter string for selected languages."""
    subs_dir = Path(video["file"]).parent / "subs"
    filters = []

    for i, lang in enumerate(languages[:3]):  # Max 3 languages
        ass_file = subs_dir / f"{lang}.ass"
        if not ass_file.exists():
            continue

        style = _STYLE_MAP.get(i, _STYLE_MAP[0])
        style_parts = [f"{k}={v}" for k, v in style.items()]
        force_style = ",".join(style_parts)

        # Escape path for FFmpeg filter (colons and backslashes)
        escaped_path = str(ass_file).replace("\\", "\\\\").replace(":", "\\:")
        filters.append(
            f"subtitles={escaped_path}:force_style='{force_style}'"
        )

    return ",".join(filters)


class Player:
    def __init__(self):
        self.status = PlayerStatus()
        self._ffmpeg_proc: asyncio.subprocess.Process | None = None
        self._progress_task: asyncio.Task | None = None
        self._seek_offset: float = 0

    async def play(self, video_id: str, languages: list[str] | None = None, start_at: float = 0):
        """Start playback of a local video with optional subtitles."""
        await self.stop()

        video = get_video(video_id)
        if not video:
            self.status = PlayerStatus(
                state=State.STOPPED,
                error=f"Video niet gevonden: {video_id}",
            )
            return

        self.status = PlayerStatus(
            state=State.LOADING,
            video_id=video_id,
            title=video["title"],
            languages=languages or [],
        )
        self._seek_offset = start_at
        self.status.duration = await _get_duration(video["file"])

        try:
            cmd = ["ffmpeg"]

            # Seek to position (before input for fast seeking)
            if start_at > 0:
                cmd.extend(["-ss", str(start_at)])

            cmd.extend([
                "-re",  # Realtime playback
                "-i", video["file"],
            ])

            # Build video filter with subtitles
            vf_parts = []

            # When seeking: shift PTS to absolute so subtitle filter renders correctly
            if start_at > 0:
                vf_parts.append(f"setpts=PTS+{start_at}/TB")

            if languages:
                sub_filter = _build_subtitle_filter(video, languages)
                if sub_filter:
                    vf_parts.append(sub_filter)

            # Shift PTS back to 0-based so -re flag works correctly
            if start_at > 0:
                vf_parts.append(f"setpts=PTS-{start_at}/TB")

            vf_parts.append("scale=1280:720:force_original_aspect_ratio=decrease")
            vf_parts.append("pad=1280:720:(ow-iw)/2:(oh-ih)/2")
            vf_parts.append("format=yuv420p")
            cmd.extend(["-vf", ",".join(vf_parts)])

            # Video output → v4l2loopback
            cmd.extend(["-f", "v4l2", "-video_size", "1280x720", V4L2_DEVICE])

            # Audio output → PulseAudio virtual sink (delay to match video processing)
            cmd.extend(["-af", "adelay=300|300", "-f", "pulse", PULSE_SINK])

            # Progress output + overwrite
            cmd.extend(["-progress", "pipe:1", "-y"])

            self._ffmpeg_proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL,
            )

            self.status.state = State.PLAYING

            # Start progress tracking from FFmpeg stderr
            self._progress_task = asyncio.create_task(
                self._track_progress()
            )

        except Exception as e:
            self.status.state = State.STOPPED
            self.status.error = str(e)

    async def _track_progress(self):
        """Parse FFmpeg -progress pipe:1 output to track playback position."""
        try:
            assert self._ffmpeg_proc and self._ffmpeg_proc.stdout
            while True:
                line = await self._ffmpeg_proc.stdout.readline()
                if not line:
                    break
                text = line.decode("utf-8", errors="replace").strip()

                # -progress format: key=value lines
                if text.startswith("out_time_us="):
                    try:
                        us = int(text.split("=", 1)[1])
                        self.status.current_time = self._seek_offset + us / 1_000_000
                    except ValueError:
                        pass
                elif text == "progress=end":
                    self.status.state = State.STOPPED
                    if self.status.duration:
                        self.status.current_time = self.status.duration

            # FFmpeg exited
            if self.status.state == State.PLAYING:
                self.status.state = State.STOPPED

        except asyncio.CancelledError:
            pass

    async def pause(self):
        """Toggle pause/resume using SIGSTOP/SIGCONT."""
        if not self._ffmpeg_proc or self._ffmpeg_proc.returncode is not None:
            return

        if self.status.state == State.PLAYING:
            os.kill(self._ffmpeg_proc.pid, signal.SIGSTOP)
            self.status.state = State.PAUSED
        elif self.status.state == State.PAUSED:
            os.kill(self._ffmpeg_proc.pid, signal.SIGCONT)
            self.status.state = State.PLAYING

    async def stop(self):
        """Stop playback."""
        if self._progress_task:
            self._progress_task.cancel()
            self._progress_task = None

        if self._ffmpeg_proc and self._ffmpeg_proc.returncode is None:
            # Resume first if paused (SIGTERM won't work on stopped process)
            if self.status.state == State.PAUSED:
                try:
                    os.kill(self._ffmpeg_proc.pid, signal.SIGCONT)
                except ProcessLookupError:
                    pass

            try:
                self._ffmpeg_proc.terminate()
                try:
                    await asyncio.wait_for(self._ffmpeg_proc.wait(), timeout=5)
                except asyncio.TimeoutError:
                    self._ffmpeg_proc.kill()
            except ProcessLookupError:
                pass

        self._ffmpeg_proc = None
        self.status = PlayerStatus()

    async def seek(self, position: float):
        """Seek to absolute position (seconds). Restarts FFmpeg with -ss."""
        if self.status.state not in (State.PLAYING, State.PAUSED):
            return
        video_id = self.status.video_id
        languages = self.status.languages
        if not video_id:
            return
        position = max(0, position)
        if self.status.duration:
            position = min(position, self.status.duration)
        await self.play(video_id, languages, start_at=position)

    async def skip(self, offset: float):
        """Skip forward/backward by offset seconds."""
        current = self.status.current_time or 0
        await self.seek(current + offset)

    def get_status(self) -> dict:
        return self.status.to_dict()


# Singleton
player = Player()
