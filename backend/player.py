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


# Alignment values for subtitle positioning (ASS standard)
_POSITION_MAP = {
    0: 2,  # First language: bottom center
    1: 8,  # Second language: top center
    2: 5,  # Third language: middle center
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


def _build_subtitle_filter(video: dict, languages: list[str]) -> str:
    """Build FFmpeg subtitle filter string for selected languages."""
    subs_dir = Path(video["file"]).parent / "subs"
    filters = []

    for i, lang in enumerate(languages[:3]):  # Max 3 languages
        ass_file = subs_dir / f"{lang}.ass"
        if not ass_file.exists():
            continue

        alignment = _POSITION_MAP.get(i, 2)
        # Escape path for FFmpeg filter (colons and backslashes)
        escaped_path = str(ass_file).replace("\\", "\\\\").replace(":", "\\:")
        filters.append(
            f"subtitles={escaped_path}:force_style='Alignment={alignment}'"
        )

    return ",".join(filters)


class Player:
    def __init__(self):
        self.status = PlayerStatus()
        self._ffmpeg_proc: asyncio.subprocess.Process | None = None
        self._progress_task: asyncio.Task | None = None

    async def play(self, video_id: str, languages: list[str] | None = None):
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

        try:
            cmd = [
                "ffmpeg",
                "-re",  # Realtime playback
                "-i", video["file"],
            ]

            # Build video filter with subtitles
            vf_parts = []
            if languages:
                sub_filter = _build_subtitle_filter(video, languages)
                if sub_filter:
                    vf_parts.append(sub_filter)
            vf_parts.append("scale=1280:720:force_original_aspect_ratio=decrease")
            vf_parts.append("pad=1280:720:(ow-iw)/2:(oh-ih)/2")
            vf_parts.append("format=yuv420p")
            cmd.extend(["-vf", ",".join(vf_parts)])

            # Video output → v4l2loopback
            cmd.extend(["-f", "v4l2", "-video_size", "1280x720", V4L2_DEVICE])

            # Audio output → PulseAudio virtual sink
            cmd.extend(["-f", "pulse", PULSE_SINK])

            # Overwrite without asking
            cmd.append("-y")

            self._ffmpeg_proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.PIPE,
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
        """Parse FFmpeg stderr to track playback position and duration."""
        # Regex for FFmpeg progress output: time=HH:MM:SS.cc
        time_pattern = re.compile(r"time=(\d+):(\d+):(\d+)\.(\d+)")
        # Regex for duration from stream info: Duration: HH:MM:SS.cc
        dur_pattern = re.compile(r"Duration:\s*(\d+):(\d+):(\d+)\.(\d+)")

        try:
            assert self._ffmpeg_proc and self._ffmpeg_proc.stderr
            while True:
                line = await self._ffmpeg_proc.stderr.readline()
                if not line:
                    break
                text = line.decode("utf-8", errors="replace")

                # Parse duration (appears once at start)
                dur_match = dur_pattern.search(text)
                if dur_match:
                    h, m, s, cs = (int(x) for x in dur_match.groups())
                    self.status.duration = h * 3600 + m * 60 + s + cs / 100

                # Parse current time (appears in progress lines)
                time_match = time_pattern.search(text)
                if time_match:
                    h, m, s, cs = (int(x) for x in time_match.groups())
                    self.status.current_time = h * 3600 + m * 60 + s + cs / 100

            # FFmpeg exited — check if it was a normal end or error
            if self._ffmpeg_proc.returncode == 0:
                self.status.state = State.STOPPED
                self.status.current_time = self.status.duration
            elif self.status.state == State.PLAYING:
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

    async def change_languages(self, languages: list[str]):
        """Change subtitle languages (restarts playback at current position)."""
        if self.status.state not in (State.PLAYING, State.PAUSED):
            return

        video_id = self.status.video_id
        current_time = self.status.current_time
        if not video_id:
            return

        # TODO: restart FFmpeg with -ss offset to resume at current position
        # For now, restart from beginning with new languages
        await self.play(video_id, languages)

    def get_status(self) -> dict:
        return self.status.to_dict()


# Singleton
player = Player()
