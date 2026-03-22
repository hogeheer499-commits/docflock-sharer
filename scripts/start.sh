#!/bin/bash
cd ~/docflock-sharer/backend
DOCFLOCK_VIDEOS_DIR=~/docflock-videos \
PULSE_SINK=virtual_speaker \
DOCFLOCK_V4L2_DEVICE=/dev/video2 \
.venv/bin/python main.py
