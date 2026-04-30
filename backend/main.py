import asyncio
from contextlib import asynccontextmanager
from typing import Any
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from config import HOST, PORT, ZOOM_MEETING_ID, ZOOM_PASSCODE
from player import player, scan_videos, scan_clips, scan_music, scan_youtube_cache, get_video, get_next_video, get_prev_video, download_youtube, get_playlist_info

PUBLIC_DIR = Path(__file__).parent.parent / "public"


@asynccontextmanager
async def lifespan(app: FastAPI):
    await player.start_idle_screen()
    yield
    await player._stop_idle()
    await player.stop()


app = FastAPI(title="DocFlock Sharer", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class PlayRequest(BaseModel):
    video_id: str
    languages: list[str] = []


class PlayUrlRequest(BaseModel):
    url: str
    languages: list[str] = ["en"]


class LanguageRequest(BaseModel):
    languages: list[str]


class SeekRequest(BaseModel):
    position: float


class SkipRequest(BaseModel):
    offset: float


class DelayRequest(BaseModel):
    ms: int


@app.get("/api/videos")
async def api_videos():
    return scan_videos()


@app.get("/api/videos/multilang")
async def api_videos_multilang():
    return [v for v in scan_videos() if len(v.get("languages", [])) > 1]


@app.get("/api/clips")
async def api_clips():
    return scan_clips()


@app.get("/api/music")
async def api_music():
    return scan_music()


@app.get("/api/youtube")
async def api_youtube():
    return scan_youtube_cache()


@app.get("/api/videos/{video_id}/languages")
async def api_video_languages(video_id: str):
    video = get_video(video_id)
    if not video:
        raise HTTPException(404, "Video niet gevonden")
    return {"id": video_id, "languages": video["languages"]}


_yt_download_task = None
_yt_download_status = {"state": "idle"}


@app.post("/api/play-url")
async def api_play_url(req: PlayUrlRequest):
    global _yt_download_task, _yt_download_status

    async def _download_and_play():
        global _yt_download_status
        try:
            _yt_download_status = {"state": "downloading", "url": req.url, "title": "Fetching info..."}
            video = await download_youtube(req.url)
            if not video:
                _yt_download_status = {"state": "error", "error": "Download failed"}
                return
            if video.get("cached"):
                _yt_download_status = {"state": "already", "title": video["title"], "video_id": video["id"]}
            else:
                _yt_download_status = {"state": "done", "title": video["title"], "video_id": video["id"]}
        except Exception as e:
            _yt_download_status = {"state": "error", "error": str(e)}

    _yt_download_status = {"state": "downloading", "url": req.url}
    _yt_download_task = asyncio.ensure_future(_download_and_play())
    return {"status": "downloading"}


@app.get("/api/play-url/status")
async def api_play_url_status():
    return _yt_download_status


# --- Playlist download ---

_playlist_status = {"state": "idle"}
_playlist_task = None


@app.post("/api/playlist-url")
async def api_playlist_url(req: PlayUrlRequest):
    global _playlist_task, _playlist_status

    async def _download_playlist():
        global _playlist_status
        try:
            _playlist_status = {"state": "fetching", "message": "Fetching playlist info..."}
            items = await get_playlist_info(req.url)
            if not items:
                _playlist_status = {"state": "error", "error": "No videos found in playlist"}
                return

            _playlist_status = {
                "state": "downloading",
                "total": len(items),
                "done": 0,
                "current": "",
                "results": [],
            }

            for i, item in enumerate(items):
                _playlist_status["current"] = item["title"]
                _playlist_status["done"] = i

                video_url = f"https://www.youtube.com/watch?v={item['id']}"
                try:
                    video = await download_youtube(video_url)
                    status = "cached" if video and video.get("cached") else ("ok" if video else "failed")
                    _playlist_status["results"].append({
                        "title": item["title"],
                        "status": status,
                    })
                except Exception:
                    _playlist_status["results"].append({
                        "title": item["title"],
                        "status": "failed",
                    })

            _playlist_status["state"] = "done"
            _playlist_status["done"] = len(items)
            _playlist_status["current"] = ""

        except Exception as e:
            _playlist_status = {"state": "error", "error": str(e)}

    _playlist_status = {"state": "fetching", "message": "Starting..."}
    _playlist_task = asyncio.ensure_future(_download_playlist())
    return {"status": "started"}


@app.get("/api/playlist-url/status")
async def api_playlist_url_status():
    return _playlist_status


@app.post("/api/play")
async def api_play(req: PlayRequest):
    if not req.video_id:
        raise HTTPException(400, "video_id is vereist")
    await player.play(req.video_id, req.languages)
    if player.status.error:
        raise HTTPException(500, player.status.error)
    return {"status": player.status.state.value, "title": player.status.title}


@app.post("/api/languages")
async def api_languages(req: LanguageRequest):
    """Change subtitle languages while playing, resuming at current position."""
    if not player.status.video_id:
        raise HTTPException(400, "Nothing playing")
    pos = player.status.current_time or 0
    vid_id = player.status.video_id
    await player.play(vid_id, req.languages, start_at=pos)
    return {"status": player.status.state.value, "languages": req.languages}


@app.post("/api/pause")
async def api_pause():
    await player.pause()
    return {"status": player.status.state.value}


@app.post("/api/seek")
async def api_seek(req: SeekRequest):
    await player.seek(req.position)
    return {"status": player.status.state.value}


@app.post("/api/skip")
async def api_skip(req: SkipRequest):
    await player.skip(req.offset)
    return {"status": player.status.state.value}


@app.post("/api/delay")
async def api_delay(req: DelayRequest):
    await player.set_audio_delay(req.ms)
    return {"audio_delay_ms": player.audio_delay_ms}


@app.get("/api/delay")
async def api_get_delay():
    return {"audio_delay_ms": player.audio_delay_ms}


@app.post("/api/autoplay")
async def api_autoplay():
    player.autoplay = not player.autoplay
    if player.autoplay:
        player.loop = False
    return {"autoplay": player.autoplay}


@app.post("/api/loop")
async def api_loop():
    player.loop = not player.loop
    if player.loop:
        player.autoplay = False
    return {"loop": player.loop}


@app.post("/api/next")
async def api_next():
    if not player.status.video_id:
        raise HTTPException(400, "Nothing playing")
    nxt = get_next_video(player.status.video_id)
    if not nxt:
        raise HTTPException(404, "No next video")
    await player.play(nxt["id"], player.status.languages)
    return {"status": player.status.state.value, "title": player.status.title}


@app.post("/api/prev")
async def api_prev():
    if not player.status.video_id:
        raise HTTPException(400, "Nothing playing")
    prv = get_prev_video(player.status.video_id)
    if not prv:
        raise HTTPException(404, "No previous video")
    await player.play(prv["id"], player.status.languages)
    return {"status": player.status.state.value, "title": player.status.title}


@app.post("/api/stop")
async def api_stop():
    await player.stop()
    await player.start_idle_screen()
    return {"status": "stopped"}


# --- Queue ---

class QueueAddRequest(BaseModel):
    video_id: str
    languages: list[str] = []


@app.get("/api/queue")
async def api_queue():
    return player.queue


@app.post("/api/queue/add")
async def api_queue_add(req: QueueAddRequest):
    video = get_video(req.video_id)
    if not video:
        raise HTTPException(404, "Video niet gevonden")
    player.queue.append({
        "video_id": req.video_id,
        "languages": req.languages,
        "title": video["title"],
    })
    return {"queue": player.queue, "length": len(player.queue)}


@app.post("/api/queue/remove")
async def api_queue_remove(req: QueueAddRequest):
    player.queue = [q for q in player.queue if q["video_id"] != req.video_id]
    return {"queue": player.queue, "length": len(player.queue)}


@app.post("/api/queue/clear")
async def api_queue_clear():
    player.queue.clear()
    return {"queue": [], "length": 0}


@app.get("/api/status")
async def api_status():
    return player.get_status()


# --- Zoom controls ---

_zoom_mic_muted = False
_zoom_cam_off = False

async def _xdotool_zoom_key(key: str):
    """Send a key to the Zoom Meeting window via xdotool."""
    import os
    env = os.environ.copy()
    env["DISPLAY"] = ":1"
    # Find a Zoom window that accepts keyboard shortcuts
    for name in ["Zoom Meeting", "Zoom Workplace"]:
        find = await asyncio.create_subprocess_exec(
            "xdotool", "search", "--name", name,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
        )
        stdout, _ = await find.communicate()
        window_ids = [w for w in stdout.decode().strip().split("\n") if w]
        if window_ids:
            break
    if not window_ids:
        raise HTTPException(503, "Zoom window not found")
    wid = window_ids[0]
    proc = await asyncio.create_subprocess_exec(
        "xdotool", "key", "--window", wid, key,
        env=env,
    )
    await proc.wait()


async def _dismiss_zoom_transcription_notice():
    """Dismiss Zoom's transcription notice after joining, if it appears."""
    import os
    env = os.environ.copy()
    env["DISPLAY"] = ":1"

    await asyncio.sleep(8)
    for name in ["Zoom Meeting", "Zoom Workplace"]:
        find = await asyncio.create_subprocess_exec(
            "xdotool", "search", "--name", name,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
        )
        stdout, _ = await find.communicate()
        window_ids = [w for w in stdout.decode().strip().split("\n") if w]
        if window_ids:
            break
    else:
        return

    wid = window_ids[0]
    activate = await asyncio.create_subprocess_exec(
        "xdotool", "windowactivate", "--sync", wid,
        env=env,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.DEVNULL,
    )
    await activate.wait()

    proc = await asyncio.create_subprocess_exec(
        "xdotool", "key", "Return",
        env=env,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.DEVNULL,
    )
    await proc.wait()


@app.post("/api/zoom/mute")
async def api_zoom_mute():
    global _zoom_mic_muted
    await _xdotool_zoom_key("alt+a")
    _zoom_mic_muted = not _zoom_mic_muted
    return {"mic_muted": _zoom_mic_muted}


@app.post("/api/zoom/video")
async def api_zoom_video():
    global _zoom_cam_off
    await _xdotool_zoom_key("alt+v")
    _zoom_cam_off = not _zoom_cam_off
    return {"cam_off": _zoom_cam_off}


@app.post("/api/zoom/join")
async def api_zoom_join():
    import os
    env = os.environ.copy()
    env["DISPLAY"] = ":1"
    url = f"zoommtg://us02web.zoom.us/join?action=join&confno={ZOOM_MEETING_ID}&pwd={ZOOM_PASSCODE}"
    proc = await asyncio.create_subprocess_exec(
        "xdg-open", url,
        env=env,
    )
    await proc.wait()
    asyncio.create_task(_dismiss_zoom_transcription_notice())
    return {"joined": True, "meeting_id": ZOOM_MEETING_ID}


@app.get("/api/zoom/status")
async def api_zoom_status():
    return {"mic_muted": _zoom_mic_muted, "cam_off": _zoom_cam_off}

@app.get("/api/preview")
async def api_preview():
    """Capture a frame from the source video at current position."""
    status = player.get_status()
    if status["state"] == "stopped" or not status["video_id"]:
        raise HTTPException(404, "Nothing playing")

    video = get_video(status["video_id"])
    if not video:
        raise HTTPException(404, "Video not found")

    pos = status["current_time"] or 0
    proc = await asyncio.create_subprocess_exec(
        "ffmpeg", "-ss", str(pos), "-i", video["file"],
        "-frames:v", "1", "-q:v", "5", "-f", "image2", "-vcodec", "mjpeg",
        "pipe:1", "-y",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
    )
    stdout, _ = await proc.communicate()
    if not stdout:
        raise HTTPException(500, "Failed to capture frame")
    return Response(content=stdout, media_type="image/jpeg")


# Serve frontend (local dev + direct access without Cloudflare)
if PUBLIC_DIR.is_dir():
    app.mount("/", StaticFiles(directory=str(PUBLIC_DIR), html=True), name="public")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=HOST, port=PORT)
