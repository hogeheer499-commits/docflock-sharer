import os
from pathlib import Path

V4L2_DEVICE = os.getenv("DOCFLOCK_V4L2_DEVICE", "/dev/video99")
PULSE_SINK = os.getenv("DOCFLOCK_PULSE_SINK", "virtual_speaker")
VIDEOS_DIR = Path(os.getenv("DOCFLOCK_VIDEOS_DIR", str(Path.home() / "docflock-videos")))
HOST = os.getenv("DOCFLOCK_HOST", "127.0.0.1")
PORT = int(os.getenv("DOCFLOCK_PORT", "8910"))
