import asyncio
from contextlib import asynccontextmanager
from typing import Any
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from config import HOST, PORT
from player import player, scan_videos, scan_clips, scan_music, scan_youtube_cache, get_video, get_next_video, get_prev_video, download_youtube

PUBLIC_DIR = Path(__file__).parent.parent / "public"


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
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


@app.post("/api/play")
async def api_play(req: PlayRequest):
    if not req.video_id:
        raise HTTPException(400, "video_id is vereist")
    await player.play(req.video_id, req.languages)
    if player.status.error:
        raise HTTPException(500, player.status.error)
    return {"status": player.status.state.value, "title": player.status.title}


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
    return {"autoplay": player.autoplay}


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
    return {"status": "stopped"}


@app.get("/api/status")
async def api_status():
    return player.get_status()


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
