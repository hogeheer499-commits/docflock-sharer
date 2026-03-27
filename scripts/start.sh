#!/bin/bash
export PATH="$HOME/.deno/bin:$HOME/.local/bin:$PATH"

# Mute Zoom's incoming audio on Beelink (prevents double audio for other participants)
# Runs in background, retries until Zoom's VoiceEngine appears
# IMPORTANT: only mute the ZOOM sink-input, never FFmpeg (Lavf)
(
  for i in $(seq 1 30); do
    ZOOM_INPUT=$(pactl list sink-inputs 2>/dev/null | grep -B20 "ZOOM VoiceEngine" | grep "Sink Input #" | grep -o '[0-9]*')
    if [ -n "$ZOOM_INPUT" ]; then
      pactl set-sink-input-mute "$ZOOM_INPUT" 1 2>/dev/null
      echo "Muted Zoom audio (sink-input $ZOOM_INPUT)"
      break
    fi
    sleep 2
  done
) &

cd ~/docflock-sharer/backend
DOCFLOCK_VIDEOS_DIR=~/docflock-videos \
PULSE_SINK=virtual_speaker \
DOCFLOCK_V4L2_DEVICE=/dev/video2 \
.venv/bin/python main.py
