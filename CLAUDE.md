# DocFlock Lecture Sharer

## Wat het doet
Lokale video's met karaoke subtitles delen via Zoom. Host selecteert video + talen in web UI
→ FFmpeg speelt video af met ingebrande subtitles → beeld naar virtual cam, audio naar virtual mic
→ Zoom "Hoge Heer" deelt het naar ~30 deelnemers. Geen browser, geen screen recording.

## Architectuur
```
Web UI (telefoon/pc)
  → Cloudflare Pages + Workers (auth + proxy)
    → Cloudflare Tunnel
      → Beelink (FastAPI + FFmpeg)
        → v4l2loopback (virtual cam) + PulseAudio (virtual mic)
          → Zoom "Hoge Heer"
```

## Projectstructuur
```
functions/                    # Cloudflare Pages Workers (deploy via wrangler)
  _middleware.js              # Token validatie op /api/* (behalve /api/auth)
  api/auth.js                 # PIN → HMAC-signed token (24h expiry)
  api/[[path]].js             # Catch-all proxy → Beelink via TUNNEL_URL

public/                       # Frontend (Cloudflare Pages static)
  index.html                  # Login + video selector + taal selector + player UI
  style.css                   # Mobile-first styling
  app.js                      # Auth flow, video/taal selectie, play/pause/stop

backend/                      # Draait op Beelink
  main.py                     # FastAPI: /api/videos, /api/play, /api/pause, /api/stop, /api/status
  player.py                   # FFmpeg direct: video + ASS subtitles → v4l2 + PulseAudio
  config.py                   # Env vars: V4L2_DEVICE, PULSE_SINK, VIDEOS_DIR, etc.

scripts/
  setup.sh                    # Eenmalige Beelink setup (v4l2loopback, PulseAudio, venv, systemd)
  download-subs.sh            # Download YouTube subtitles en converteer naar ASS
  json3_to_ass.py             # YouTube json3 → ASS met karaoke word-by-word tags

~/docflock-videos/            # Video bibliotheek (buiten repo)
  lecture-1/
    video.mp4
    subs/
      en.ass                  # Engels (karaoke word-by-word)
      nl.ass                  # Nederlands
      pl.ass                  # Pools
```

## Video pipeline
```
Lokaal videobestand + ASS karaoke subtitles
  → FFmpeg (decode + burn subtitles + realtime output)
    → v4l2loopback /dev/video99 (virtual cam)
    → PulseAudio virtual_speaker (virtual mic)
      → Zoom
```

Geen browser, geen Xvfb, geen screen recording. FFmpeg decodeert 1x en stuurt raw frames/audio
naar de virtuele devices.

## Setup op Beelink

### 1. Clone en setup
```bash
git clone https://github.com/brvale97/DocFlock-lecture-share.git
cd DocFlock-lecture-share
sudo bash scripts/setup.sh
```

### 2. Video's + subtitles voorbereiden
```bash
# Video kopiëren naar de juiste map
mkdir -p ~/docflock-videos/lecture-1
cp /pad/naar/video.mp4 ~/docflock-videos/lecture-1/

# Subtitles downloaden (eerst Engels, dan vertalingen)
bash scripts/download-subs.sh "YOUTUBE_URL" ~/docflock-videos/lecture-1/ en
bash scripts/download-subs.sh "YOUTUBE_URL" ~/docflock-videos/lecture-1/ nl,pl,es
```

### 3. Cloudflared tunnel
```bash
cloudflared tunnel create docflock
cloudflared tunnel route dns docflock docflock-backend.jouwdomein.com
```

### 4. Services starten
```bash
sudo systemctl start docflock-backend
sudo systemctl start docflock-tunnel
```

### 5. Cloudflare Pages secrets
```bash
wrangler pages secret put PIN_HASH
wrangler pages secret put SESSION_SECRET
wrangler pages secret put TUNNEL_URL
```

### 6. Zoom "Hoge Heer" configureren
- Video: **DocFlock Virtual Cam** selecteren
- Audio input (mic): **DocFlock Virtual Mic** selecteren

## Verificatie
```bash
# Virtual cam test
ffplay /dev/video99

# Backend status
curl http://127.0.0.1:8910/api/videos
curl http://127.0.0.1:8910/api/status

# Logs
journalctl -u docflock-backend -f
```

## Tech stack
- **Backend**: Python 3, FastAPI, FFmpeg
- **Frontend**: Vanilla HTML/CSS/JS, Cloudflare Pages + Workers
- **Subtitles**: YouTube json3 → ASS karaoke (word-by-word highlighting)
- **Auth**: PIN → HMAC-SHA256 signed token
- **Infra**: v4l2loopback, PulseAudio, cloudflared, systemd
