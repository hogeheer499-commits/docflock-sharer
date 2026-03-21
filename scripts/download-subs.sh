#!/bin/bash
# Download YouTube auto-generated subtitles and convert to ASS karaoke.
#
# Usage:
#   ./download-subs.sh <youtube-url> <video-dir> [lang1,lang2,...]
#
# Examples:
#   # Download only English (do this FIRST to avoid rate limiting):
#   ./download-subs.sh "https://youtube.com/watch?v=abc" ~/docflock-videos/lecture-1/ en
#
#   # Download specific translations (do AFTER English):
#   ./download-subs.sh "https://youtube.com/watch?v=abc" ~/docflock-videos/lecture-1/ nl,pl,es
#
#   # Download all available languages (careful: may hit rate limits!):
#   ./download-subs.sh "https://youtube.com/watch?v=abc" ~/docflock-videos/lecture-1/
#
# Tip: Download English for all videos first, then do translations in batches
# with pauses between them to avoid YouTube rate limiting (HTTP 429).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONVERTER="$SCRIPT_DIR/json3_to_ass.py"

if [ $# -lt 2 ]; then
    echo "Usage: $0 <youtube-url> <video-dir> [lang1,lang2,...]"
    echo ""
    echo "Recommended workflow (to avoid rate limiting):"
    echo "  1. First download English for all videos:"
    echo "     $0 URL dir en"
    echo "  2. Then download translations per video:"
    echo "     $0 URL dir nl,pl,es"
    exit 1
fi

URL="$1"
VIDEO_DIR="$2"
LANGS="${3:-}"

SUBS_DIR="$VIDEO_DIR/subs"
TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR"' EXIT

mkdir -p "$SUBS_DIR"

echo "=== DocFlock Subtitle Downloader ==="
echo "URL: $URL"
echo "Output: $SUBS_DIR"

if [ -n "$LANGS" ]; then
    LANG_ARG="$LANGS"
    echo "Languages: $LANGS"
else
    LANG_ARG="all"
    echo "Languages: all available (rate limit warning!)"
fi

# Download json3 subtitles
echo ""
echo "[1/2] Downloading json3 subtitles..."
if ! yt-dlp \
    --remote-components ejs:github \
    --write-auto-sub \
    --sub-lang "$LANG_ARG" \
    --sub-format json3 \
    --skip-download \
    -o "$TEMP_DIR/sub" \
    "$URL" 2>&1; then
    echo "WARNING: yt-dlp had errors. Some languages may not have downloaded."
    echo "If you got HTTP 429, wait a few minutes and try again."
fi

# Convert each json3 to ASS
echo ""
echo "[2/2] Converting to ASS with karaoke tags..."

COUNT=0
for json3_file in "$TEMP_DIR"/sub.*.json3; do
    [ -f "$json3_file" ] || continue

    filename=$(basename "$json3_file")
    lang="${filename#sub.}"
    lang="${lang%.json3}"

    output="$SUBS_DIR/$lang.ass"
    python3 "$CONVERTER" "$json3_file" "$output"
    COUNT=$((COUNT + 1))
done

echo ""
if [ "$COUNT" -eq 0 ]; then
    echo "=== No subtitles downloaded. Check URL or try again later. ==="
    exit 1
fi

echo "=== Done: $COUNT language(s) converted ==="
ls -1 "$SUBS_DIR"/*.ass 2>/dev/null | while read -r f; do
    echo "  $(basename "$f")"
done
