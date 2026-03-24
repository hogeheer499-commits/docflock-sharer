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


def _load_library() -> dict:
    """Load library.json for lecture metadata."""
    lib_file = VIDEOS_DIR / "library.json"
    if not lib_file.exists():
        return {}
    import json
    data = json.loads(lib_file.read_text())
    # Build lookup: "YYYY-NN" -> {title, series, year, month, num}
    lookup = {}
    for series in data.get("series", []):
        for lec in series.get("lectures", []):
            key = f"{series['year']}-{lec['num']:02d}"
            lookup[key] = {
                "title": lec["title"],
                "series": f"{series['year']}: {series['name']}",
                "year": series["year"],
                "month": lec.get("month", ""),
                "num": lec["num"],
                "parts": lec.get("parts", 3),
            }
    return lookup


def scan_videos() -> list[dict]:
    """Scan VIDEOS_DIR for available videos, grouped by lecture."""
    if not VIDEOS_DIR.is_dir():
        return []

    library = _load_library()
    videos = []

    for entry in sorted(VIDEOS_DIR.iterdir()):
        if not entry.is_dir():
            continue

        # Find video file
        video_file = None
        for ext in ("*.mp4", "*.mkv", "*.webm", "*.avi"):
            found = list(entry.glob(ext))
            if found:
                video_file = found[0]
                break
        if not video_file:
            continue

        # Find subtitle languages
        subs_dir = entry / "subs"
        languages = sorted(p.stem for p in subs_dir.glob("*.ass")) if subs_dir.is_dir() else []

        # Look up metadata from library.json (folder format: YYYY-NN-P)
        folder_id = entry.name
        parts = folder_id.rsplit("-", 1)
        if len(parts) == 2:
            lecture_key = parts[0]  # "2002-01"
            part_num = parts[1]     # "1"
        else:
            lecture_key = ""
            part_num = ""

        meta = library.get(lecture_key)
        if meta:
            title = f"{meta['title']} (Part {part_num})"
            sort_key = f"{meta['year']}-{meta['num']:02d}-{part_num}"
        else:
            title = entry.name.replace("-", " ").replace("_", " ").title()
            sort_key = folder_id

        videos.append({
            "id": folder_id,
            "title": title,
            "series": meta["series"] if meta else "",
            "file": str(video_file),
            "languages": languages,
            "sort_key": sort_key,
        })

    videos.sort(key=lambda v: v["sort_key"])
    return videos


def scan_music() -> list[dict]:
    """Scan music directory for available music videos."""
    music_dir = VIDEOS_DIR / "music"
    music_json = VIDEOS_DIR / "music.json"
    if not music_dir.is_dir() or not music_json.exists():
        return []

    import json as _json
    tracks = _json.loads(music_json.read_text())
    result = []
    for track in tracks:
        filepath = music_dir / track["file"]
        if not filepath.exists():
            continue
        vid_id = "music/" + filepath.stem
        result.append({
            "id": vid_id,
            "title": track["title"],
            "series": "Music",
            "file": str(filepath),
            "languages": [],
            "sort_key": vid_id,
            "category": "music",
        })
    return result


def scan_clips() -> list[dict]:
    """Scan clips directory for short doc clips."""
    clips_dir = VIDEOS_DIR / "clips"
    clips_json = VIDEOS_DIR / "clips.json"
    if not clips_dir.is_dir() or not clips_json.exists():
        return []

    import json as _json
    tracks = _json.loads(clips_json.read_text())
    result = []
    for i, track in enumerate(tracks):
        filepath = clips_dir / track["file"]
        if not filepath.exists():
            continue
        vid_id = "clips/" + filepath.stem
        result.append({
            "id": vid_id,
            "title": track["title"],
            "series": "Short Doc Clips",
            "file": str(filepath),
            "languages": [],
            "sort_key": f"clips/{i:03d}",
            "category": "clips",
        })
    return result


def scan_youtube_cache() -> list[dict]:
    """Scan cached YouTube downloads."""
    if not CACHE_DIR.is_dir():
        return []
    result = []
    for folder in sorted(CACHE_DIR.iterdir()):
        if not folder.is_dir() or not (folder / "video.mp4").exists():
            continue
        info_file = folder / "title.txt"
        title = info_file.read_text().strip() if info_file.exists() else folder.name
        subs_dir = folder / "subs"
        languages = sorted(p.stem for p in subs_dir.glob("*.ass")) if subs_dir.is_dir() else []
        result.append({
            "id": f"yt/{folder.name}",
            "title": title,
            "series": "YouTube",
            "file": str(folder / "video.mp4"),
            "languages": languages,
            "sort_key": f"yt/{folder.name}",
            "category": "youtube",
        })
    return result


def _all_videos() -> list[dict]:
    """All videos (lectures + music + youtube cache) combined."""
    lectures = scan_videos()
    for v in lectures:
        v["category"] = "lecture"
    return lectures + scan_clips() + scan_music() + scan_youtube_cache()


def get_video(video_id: str) -> dict | None:
    """Get a specific video by ID."""
    for v in _all_videos():
        if v["id"] == video_id:
            return v
    return None


def get_next_video(video_id: str) -> dict | None:
    """Get the next video in the same category."""
    all_vids = _all_videos()
    for i, v in enumerate(all_vids):
        if v["id"] == video_id:
            for j in range(i + 1, len(all_vids)):
                if all_vids[j]["category"] == v["category"]:
                    return all_vids[j]
            if v["category"] == "music":
                for w in all_vids:
                    if w["category"] == "music":
                        return w
            break
    return None


def get_prev_video(video_id: str) -> dict | None:
    """Get the previous video in the same category."""
    all_vids = _all_videos()
    for i, v in enumerate(all_vids):
        if v["id"] == video_id:
            for j in range(i - 1, -1, -1):
                if all_vids[j]["category"] == v["category"]:
                    return all_vids[j]
            break
    return None


CACHE_DIR = VIDEOS_DIR / "youtube-cache"


async def download_youtube(url: str) -> dict | None:
    """Download a YouTube video to cache. Returns video dict or None."""
    CACHE_DIR.mkdir(exist_ok=True)

    # Extract video ID
    import urllib.parse
    parsed = urllib.parse.urlparse(url)
    if "youtu.be" in parsed.hostname:
        vid_id = parsed.path.strip("/")
    else:
        vid_id = urllib.parse.parse_qs(parsed.query).get("v", [""])[0]

    if not vid_id:
        return None

    folder = CACHE_DIR / vid_id
    video_file = folder / "video.mp4"

    # Already cached?
    if video_file.exists():
        info_file = folder / "title.txt"
        title = info_file.read_text().strip() if info_file.exists() else vid_id
        subs_dir = folder / "subs"
        languages = sorted(p.stem for p in subs_dir.glob("*.ass")) if subs_dir.is_dir() else []
        return {
            "id": f"yt/{vid_id}",
            "title": title,
            "series": "YouTube",
            "file": str(video_file),
            "languages": languages,
            "sort_key": f"yt/{vid_id}",
            "category": "youtube",
            "cached": True,
        }

    folder.mkdir(exist_ok=True)
    (folder / "subs").mkdir(exist_ok=True)

    # Download video
    deno_path = Path.home() / ".deno" / "bin"
    env = {**os.environ, "PATH": f"{deno_path}:{os.environ.get('PATH', '')}"}

    # Download video and get title in one call
    # Download video + print title in one call
    proc = await asyncio.create_subprocess_exec(
        "yt-dlp", "--remote-components", "ejs:github",
        "-f", "bestvideo[height<=720]+bestaudio/best[height<=720]",
        "--merge-output-format", "mp4",
        "--no-playlist",
        "-o", str(video_file),
        "--print-to-file", "%(title)s", str(folder / "title.txt"),
        url,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.DEVNULL,
        env=env,
    )
    await proc.communicate()

    title_file = folder / "title.txt"
    title = title_file.read_text().strip() if title_file.exists() else vid_id

    if not video_file.exists():
        return None
    (folder / "title.txt").write_text(title)

    # Download subtitles in background (don't block playback)
    async def _download_subs():
        try:
            sub_proc = await asyncio.create_subprocess_exec(
                "yt-dlp", "--remote-components", "ejs:github",
                "--write-auto-sub", "--sub-lang", "en",
                "--sub-format", "json3", "--skip-download",
                "-o", str(folder / "sub"),
                url,
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
                env=env,
            )
            await sub_proc.communicate()
            json3_file = folder / "sub.en.json3"
            if json3_file.exists():
                converter = Path(__file__).parent.parent / "scripts" / "json3_to_ass.py"
                conv_proc = await asyncio.create_subprocess_exec(
                    "python3", str(converter), "--style", "plain",
                    str(json3_file), str(folder / "subs" / "en.ass"),
                    stdout=asyncio.subprocess.DEVNULL,
                    stderr=asyncio.subprocess.DEVNULL,
                )
                await conv_proc.communicate()
        except Exception:
            pass

    asyncio.ensure_future(_download_subs())

    languages = sorted(p.stem for p in (folder / "subs").glob("*.ass"))
    return {
        "id": f"yt/{vid_id}",
        "title": title,
        "series": "YouTube",
        "file": str(video_file),
        "languages": languages,
        "sort_key": f"yt/{vid_id}",
        "category": "youtube",
    }


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
        self._target_position: float | None = None
        self.audio_delay_ms: int = 0  # Extra audio delay on top of buffer
        self.autoplay: bool = True

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
            self._progress_file = Path("/tmp/docflock-progress.txt")
            self._progress_file.write_text("")
            cmd = ["ffmpeg", "-y", "-progress", str(self._progress_file)]

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

            # Title bar overlay at top (before padding, so it's on the video content)
            safe_title = (video["title"]
                .replace("\\", "\\\\")
                .replace(":", "\\:")
                .replace("'", "\u2019")
                .replace(";", "\\;")
            )
            vf_parts.append(
                f"drawbox=x=0:y=0:w=iw:h=30:color=black@0.7:t=fill,"
                f"drawtext=text='{safe_title}':fontsize=16:fontcolor=white:"
                f"x=(w-text_w)/2:y=8:fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf,"
                f"drawtext=text='%{{eif\\:floor(t+{int(start_at)})/3600\\:d}}\\:%{{eif\\:mod(floor((t+{int(start_at)})/60)\\,60)\\:d\\:2}}\\:%{{eif\\:mod(floor(t+{int(start_at)})\\,60)\\:d\\:2}}':fontsize=14:fontcolor=white@0.8:"
                f"x=w-text_w-10:y=9:fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
            )

            vf_parts.append("pad=1280:720:(ow-iw)/2:(oh-ih)/2")
            vf_parts.append("format=yuv420p")
            cmd.extend(["-vf", ",".join(vf_parts)])

            # Video output → v4l2loopback
            cmd.extend(["-f", "v4l2", "-video_size", "1280x720", V4L2_DEVICE])

            # Audio sync: positive = delay audio, negative = advance audio (via PTS shift)
            if self.audio_delay_ms != 0:
                shift_s = self.audio_delay_ms / 1000
                cmd.extend(["-af", f"asetpts=PTS+{shift_s}/TB"])

            # Audio output → PulseAudio virtual sink (minimal buffer for sync)
            cmd.extend(["-acodec", "pcm_s16le", "-ar", "48000", "-ac", "2",
                        "-f", "pulse", PULSE_SINK])


            self._ffmpeg_proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.DEVNULL,
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
        """Poll FFmpeg progress file to track playback position."""
        try:
            while self._ffmpeg_proc and self._ffmpeg_proc.returncode is None:
                await asyncio.sleep(2)
                try:
                    text = self._progress_file.read_text()
                    # Find last out_time_us in the file
                    for line in reversed(text.splitlines()):
                        if line.startswith("out_time_us="):
                            us = int(line.split("=", 1)[1])
                            self.status.current_time = self._seek_offset + us / 1_000_000
                            self._target_position = None  # FFmpeg is running, use real position
                            break
                    if "progress=end" in text:
                        if self.status.duration:
                            self.status.current_time = self.status.duration
                        break
                except (OSError, ValueError):
                    pass

            # FFmpeg exited — autoplay or stop
            if self.status.state in (State.PLAYING, State.LOADING):
                if self.autoplay and self.status.video_id:
                    next_vid = get_next_video(self.status.video_id)
                    if next_vid:
                        # Schedule autoplay outside this task to avoid self-cancellation
                        asyncio.get_event_loop().create_task(
                            self._autoplay_next(next_vid["id"], self.status.languages)
                        )
                        return
                self.status.state = State.STOPPED

        except asyncio.CancelledError:
            pass

    async def _autoplay_next(self, video_id: str, languages: list[str]):
        """Start next video (called from a separate task to avoid self-cancellation)."""
        await self.play(video_id, languages)

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
        self._target_position = position
        await self.play(video_id, languages, start_at=position)

    async def skip(self, offset: float):
        """Skip forward/backward by offset seconds."""
        # Use target position if FFmpeg is restarting, otherwise use current_time
        current = self._target_position if self._target_position is not None else (self.status.current_time or 0)
        self._target_position = max(0, current + offset)
        await self.seek(self._target_position)

    async def set_audio_delay(self, ms: int):
        """Set audio delay and restart at current position. Positive = delay audio, negative = delay video."""
        self.audio_delay_ms = max(-500, min(ms, 500))
        if self.status.state in (State.PLAYING, State.PAUSED):
            await self.seek(self.status.current_time or 0)

    def get_status(self) -> dict:
        d = self.status.to_dict()
        d["autoplay"] = self.autoplay
        return d


# Singleton
player = Player()
