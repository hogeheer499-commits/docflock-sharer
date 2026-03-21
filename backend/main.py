from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from config import HOST, PORT
from player import player, scan_videos, get_video

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


class LanguageRequest(BaseModel):
    languages: list[str]


@app.get("/api/videos")
async def api_videos():
    return scan_videos()


@app.get("/api/videos/{video_id}/languages")
async def api_video_languages(video_id: str):
    video = get_video(video_id)
    if not video:
        raise HTTPException(404, "Video niet gevonden")
    return {"id": video_id, "languages": video["languages"]}


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


@app.post("/api/stop")
async def api_stop():
    await player.stop()
    return {"status": "stopped"}


@app.get("/api/status")
async def api_status():
    return player.get_status()


# Serve frontend (local dev + direct access without Cloudflare)
if PUBLIC_DIR.is_dir():
    app.mount("/", StaticFiles(directory=str(PUBLIC_DIR), html=True), name="public")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=HOST, port=PORT)
