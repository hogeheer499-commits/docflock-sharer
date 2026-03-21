#!/usr/bin/env python3
"""Convert YouTube json3 subtitles to ASS with karaoke word-by-word highlighting.

Groups lines into pairs (2 lines per block). Each block appears together and
disappears together, like traditional subtitles but with karaoke word-by-word.
"""

import json
import sys
from pathlib import Path

ASS_HEADER = """\
[Script Info]
Title: DocFlock Subtitles
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,52,&H00FFFFFF,&H0000CCFF,&H00000000,&H96000000,-1,0,0,0,100,100,0,0,3,0,4,2,30,30,50,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""


def ms_to_ass_time(ms: int) -> str:
    if ms < 0:
        ms = 0
    cs = ms // 10
    h = cs // 360000
    cs %= 360000
    m = cs // 6000
    cs %= 6000
    s = cs // 100
    cs %= 100
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def parse_event_words(event: dict) -> list[dict]:
    segs = event.get("segs", [])
    start_ms = event.get("tStartMs", 0)
    words = []
    for seg in segs:
        text = seg.get("utf8", "")
        if not text or text == "\n":
            continue
        text = text.strip().replace("\n", "\\N")
        if not text:
            continue
        offset_ms = seg.get("tOffsetMs", 0)
        words.append({
            "text": text,
            "abs_start_ms": start_ms + offset_ms,
        })
    return words


def build_karaoke_for_block(lines: list[dict], block_start_ms: int, block_end_ms: int) -> str:
    """Build karaoke text for a block of 1-2 lines.

    All timing is relative to block_start_ms so the karaoke animation
    flows naturally across both lines.
    """
    all_parts = []

    for line_idx, line in enumerate(lines):
        words = line["words"]
        line_parts = []

        for i, word in enumerate(words):
            # Duration until next word
            if i + 1 < len(words):
                next_start = words[i + 1]["abs_start_ms"]
            elif line_idx + 1 < len(lines):
                # Last word of line 1: duration until first word of line 2
                next_start = lines[line_idx + 1]["words"][0]["abs_start_ms"]
            else:
                # Last word of last line: duration until block end
                next_start = block_end_ms

            dur_ms = next_start - word["abs_start_ms"]
            k_cs = max(1, round(dur_ms / 10))

            # Initial delay before first word of the block
            if line_idx == 0 and i == 0:
                delay_ms = word["abs_start_ms"] - block_start_ms
                if delay_ms > 50:
                    line_parts.append(f"{{\\kf{max(1, round(delay_ms / 10))}}}")

            line_parts.append(f"{{\\kf{k_cs}}}{word['text']}")

        all_parts.append(" ".join(line_parts))

    return "\\N".join(all_parts)


def convert(json3_path: str, output_path: str) -> None:
    with open(json3_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    events = data.get("events", [])

    # Collect text lines
    lines = []
    for event in events:
        if "id" in event:
            continue
        if event.get("aAppend"):
            continue
        segs = event.get("segs", [])
        if not segs:
            continue
        texts = [s.get("utf8", "") for s in segs]
        if all(t.strip() == "" or t == "\n" for t in texts):
            continue
        words = parse_event_words(event)
        if not words:
            continue
        lines.append({
            "start_ms": event.get("tStartMs", 0),
            "end_ms": event.get("tStartMs", 0) + event.get("dDurationMs", 0),
            "words": words,
        })

    if not lines:
        print(f"No subtitle lines found in {json3_path}")
        return

    # Group lines into pairs (blocks of 2)
    dialogues = []
    i = 0
    while i < len(lines):
        block = [lines[i]]
        if i + 1 < len(lines):
            block.append(lines[i + 1])

        block_start = block[0]["start_ms"]

        # Block ends when the next block starts, or at last line's end
        next_block_start = i + len(block)
        if next_block_start < len(lines):
            block_end = lines[next_block_start]["start_ms"]
        else:
            block_end = block[-1]["end_ms"]

        if block_end - block_start < 100:
            i += len(block)
            continue

        karaoke = build_karaoke_for_block(block, block_start, block_end)
        start_t = ms_to_ass_time(block_start)
        end_t = ms_to_ass_time(block_end)

        dialogues.append(
            f"Dialogue: 0,{start_t},{end_t},Default,,0,0,0,,{karaoke}"
        )

        i += len(block)

    with open(output_path, "w", encoding="utf-8") as f:
        f.write(ASS_HEADER)
        for d in dialogues:
            f.write(d + "\n")

    print(f"Converted {len(dialogues)} subtitle blocks → {output_path}")


def main():
    if len(sys.argv) < 2:
        print("Usage: json3_to_ass.py <input.json3> [output.ass]")
        print("  If output is omitted, replaces .json3 with .ass")
        sys.exit(1)

    input_path = sys.argv[1]
    if len(sys.argv) >= 3:
        output_path = sys.argv[2]
    else:
        output_path = str(Path(input_path).with_suffix(".ass"))

    convert(input_path, output_path)


if __name__ == "__main__":
    main()
