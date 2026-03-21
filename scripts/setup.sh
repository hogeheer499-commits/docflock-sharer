#!/bin/bash
# DocFlock Lecture Sharer — Eenmalige setup op Beelink
# Run als: sudo bash setup.sh
set -euo pipefail

echo "=== DocFlock Setup ==="

ACTUAL_USER="${SUDO_USER:-$USER}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/../backend" && pwd)"
VIDEOS_DIR="/home/$ACTUAL_USER/docflock-videos"

# --- System packages ---
echo "[1/6] Systeempakketten installeren..."
apt-get update -qq
apt-get install -y -qq ffmpeg v4l2loopback-dkms pulseaudio python3-pip python3-venv

# --- yt-dlp ---
echo "[2/6] yt-dlp installeren..."
sudo -u "$ACTUAL_USER" pip3 install --user --break-system-packages yt-dlp 2>/dev/null || \
  pip3 install --break-system-packages yt-dlp

# --- v4l2loopback ---
echo "[3/6] v4l2loopback configureren..."
modprobe v4l2loopback video_nr=99 card_label="DocFlock Virtual Cam" exclusive_caps=1

cat > /etc/modules-load.d/v4l2loopback.conf << 'EOF'
v4l2loopback
EOF

cat > /etc/modprobe.d/v4l2loopback.conf << 'EOF'
options v4l2loopback video_nr=99 card_label="DocFlock Virtual Cam" exclusive_caps=1
EOF

echo "  -> /dev/video99 aangemaakt"

# --- PulseAudio virtual sink ---
echo "[4/6] PulseAudio virtual sink configureren..."
sudo -u "$ACTUAL_USER" bash -c '
  pactl load-module module-null-sink sink_name=virtual_speaker sink_properties=device.description="DocFlock_Virtual_Speaker" 2>/dev/null || true
  pactl load-module module-virtual-source source_name=virtual_mic master=virtual_speaker.monitor source_properties=device.description="DocFlock_Virtual_Mic" 2>/dev/null || true
'

PULSE_CONFIG_DIR="/home/$ACTUAL_USER/.config/pulse"
mkdir -p "$PULSE_CONFIG_DIR"
if ! grep -q "DocFlock" "$PULSE_CONFIG_DIR/default.pa" 2>/dev/null; then
  cat >> "$PULSE_CONFIG_DIR/default.pa" << 'EOF'

# DocFlock virtual audio devices
load-module module-null-sink sink_name=virtual_speaker sink_properties=device.description="DocFlock_Virtual_Speaker"
load-module module-virtual-source source_name=virtual_mic master=virtual_speaker.monitor source_properties=device.description="DocFlock_Virtual_Mic"
EOF
fi
chown -R "$ACTUAL_USER:$ACTUAL_USER" "$PULSE_CONFIG_DIR"
echo "  -> Virtual speaker + virtual mic aangemaakt"

# --- Python venv ---
echo "[5/6] Python venv opzetten..."
sudo -u "$ACTUAL_USER" python3 -m venv "$BACKEND_DIR/.venv"
sudo -u "$ACTUAL_USER" "$BACKEND_DIR/.venv/bin/pip" install -q -r "$BACKEND_DIR/requirements.txt"
echo "  -> venv geinstalleerd"

# --- Systemd services ---
echo "[6/6] Systemd services installeren..."

# Videos directory
sudo -u "$ACTUAL_USER" mkdir -p "$VIDEOS_DIR"

# Backend service
cat > /etc/systemd/system/docflock-backend.service << EOF
[Unit]
Description=DocFlock Backend
After=network.target pulseaudio.service

[Service]
Type=simple
User=$ACTUAL_USER
WorkingDirectory=$BACKEND_DIR
ExecStart=$BACKEND_DIR/.venv/bin/python main.py
Restart=on-failure
RestartSec=5
Environment=PULSE_SINK=virtual_speaker
Environment=DOCFLOCK_HOST=127.0.0.1
Environment=DOCFLOCK_PORT=8910
Environment=DOCFLOCK_VIDEOS_DIR=$VIDEOS_DIR

[Install]
WantedBy=multi-user.target
EOF

# Tunnel service
cp "$SCRIPT_DIR/docvlog-tunnel.service" /etc/systemd/system/docflock-tunnel.service
sed -i "s|__USER__|$ACTUAL_USER|g" /etc/systemd/system/docflock-tunnel.service
sed -i "s|DocVlog|DocFlock|g" /etc/systemd/system/docflock-tunnel.service
sed -i "s|docvlog|docflock|g" /etc/systemd/system/docflock-tunnel.service

systemctl daemon-reload
systemctl enable docflock-backend.service
systemctl enable docflock-tunnel.service

echo ""
echo "=== Setup compleet ==="
echo ""
echo "Video's plaatsen in: $VIDEOS_DIR"
echo "  Per video een map met video.mp4 + subs/ map:"
echo "    $VIDEOS_DIR/lecture-1/video.mp4"
echo "    $VIDEOS_DIR/lecture-1/subs/en.ass"
echo ""
echo "Subtitles downloaden:"
echo "  bash $SCRIPT_DIR/download-subs.sh 'YOUTUBE_URL' '$VIDEOS_DIR/lecture-1/' en"
echo ""
echo "Services starten:"
echo "  sudo systemctl start docflock-backend"
echo "  sudo systemctl start docflock-tunnel"
echo ""
echo "Volgende stappen:"
echo "  1. Cloudflared tunnel configureren"
echo "  2. Zoom 'Hoge Heer' configureren:"
echo "     - Video: 'DocFlock Virtual Cam'"
echo "     - Audio input: 'DocFlock Virtual Mic'"
echo "  3. Cloudflare Pages secrets instellen"
