#!/usr/bin/env python3
"""Convert YouTube json3 subtitles to ASS.

Supports two styles:
  --style karaoke  : 2-line blocks, full text visible, current word highlighted (default)
  --style buildup  : Words appear one by one, building up the sentence (YouTube-style)
"""

import json
import sys
from pathlib import Path

# Highlight color for current word (yellow)
HIGHLIGHT = "&H0000CCFF"

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


def parse_lines(events: list[dict]) -> list[dict]:
    """Parse json3 events into a list of text lines with word timing."""
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
    return lines


# --- Karaoke style (original) ---

def build_karaoke_for_block(lines: list[dict], block_start_ms: int, block_end_ms: int) -> str:
    all_parts = []
    for line_idx, line in enumerate(lines):
        words = line["words"]
        line_parts = []
        for i, word in enumerate(words):
            if i + 1 < len(words):
                next_start = words[i + 1]["abs_start_ms"]
            elif line_idx + 1 < len(lines):
                next_start = lines[line_idx + 1]["words"][0]["abs_start_ms"]
            else:
                next_start = block_end_ms
            dur_ms = next_start - word["abs_start_ms"]
            k_cs = max(1, round(dur_ms / 10))
            if line_idx == 0 and i == 0:
                delay_ms = word["abs_start_ms"] - block_start_ms
                if delay_ms > 50:
                    line_parts.append(f"{{\\kf{max(1, round(delay_ms / 10))}}}")
            line_parts.append(f"{{\\kf{k_cs}}}{word['text']}")
        all_parts.append(" ".join(line_parts))
    return "\\N".join(all_parts)


def convert_karaoke(lines: list[dict]) -> list[str]:
    dialogues = []
    i = 0
    while i < len(lines):
        block = [lines[i]]
        if i + 1 < len(lines):
            block.append(lines[i + 1])
        block_start = block[0]["start_ms"]
        next_block_start = i + len(block)
        if next_block_start < len(lines):
            block_end = lines[next_block_start]["start_ms"]
        else:
            block_end = block[-1]["end_ms"]
        if block_end - block_start < 100:
            i += len(block)
            continue
        karaoke = build_karaoke_for_block(block, block_start, block_end)
        dialogues.append(
            f"Dialogue: 0,{ms_to_ass_time(block_start)},{ms_to_ass_time(block_end)},Default,,0,0,0,,{karaoke}"
        )
        i += len(block)
    return dialogues


# --- Buildup style (YouTube word-by-word) ---

def convert_buildup(lines: list[dict]) -> list[str]:
    """Words appear one by one. Current word highlighted, previous words white.

    Uses 2-line rolling display:
    - Line 1 builds up word by word
    - When line 2 starts: line 1 stays on top (complete), line 2 builds up below
    - When a new pair starts: everything clears
    """
    dialogues = []
    i = 0

    while i < len(lines):
        # Process pairs of lines
        line1 = lines[i]
        line2 = lines[i + 1] if i + 1 < len(lines) else None

        # Determine when this pair ends
        pair_end_idx = i + (2 if line2 else 1)
        if pair_end_idx < len(lines):
            pair_end_ms = lines[pair_end_idx]["start_ms"]
        else:
            pair_end_ms = (line2 or line1)["end_ms"]

        # Build up line 1 word by word
        words1 = line1["words"]
        for w_idx, word in enumerate(words1):
            start = word["abs_start_ms"]
            if w_idx + 1 < len(words1):
                end = words1[w_idx + 1]["abs_start_ms"]
            elif line2:
                end = line2["words"][0]["abs_start_ms"]
            else:
                end = pair_end_ms

            if end - start < 30:
                continue

            # All words in white
            parts = []
            for j in range(w_idx + 1):
                parts.append(words1[j]["text"])
            text = " ".join(parts)

            dialogues.append(
                f"Dialogue: 0,{ms_to_ass_time(start)},{ms_to_ass_time(end)},Default,,0,0,0,,{text}"
            )

        if not line2:
            i += 1
            continue

        # Build up line 2 word by word, with line 1 complete on top
        line1_complete = " ".join(w["text"] for w in words1)
        words2 = line2["words"]

        for w_idx, word in enumerate(words2):
            start = word["abs_start_ms"]
            if w_idx + 1 < len(words2):
                end = words2[w_idx + 1]["abs_start_ms"]
            else:
                end = pair_end_ms

            if end - start < 30:
                continue

            # All words in white
            parts = []
            for j in range(w_idx + 1):
                parts.append(words2[j]["text"])
            line2_text = " ".join(parts)

            text = f"{line1_complete}\\N{line2_text}"

            dialogues.append(
                f"Dialogue: 0,{ms_to_ass_time(start)},{ms_to_ass_time(end)},Default,,0,0,0,,{text}"
            )

        i += 2

    return dialogues


# --- Main ---

def convert_plain(lines: list[dict]) -> list[str]:
    """Simple 2-line blocks. Full text appears at once, no animation."""
    dialogues = []
    i = 0
    while i < len(lines):
        block = [lines[i]]
        if i + 1 < len(lines):
            block.append(lines[i + 1])
        block_start = block[0]["start_ms"]
        next_block_start = i + len(block)
        if next_block_start < len(lines):
            block_end = lines[next_block_start]["start_ms"]
        else:
            block_end = block[-1]["end_ms"]
        if block_end - block_start < 100:
            i += len(block)
            continue

        text_parts = []
        for line in block:
            text_parts.append(" ".join(w["text"] for w in line["words"]))
        text = "\\N".join(text_parts)

        dialogues.append(
            f"Dialogue: 0,{ms_to_ass_time(block_start)},{ms_to_ass_time(block_end)},Default,,0,0,0,,{text}"
        )
        i += len(block)
    return dialogues


def convert(json3_path: str, output_path: str, style: str = "plain") -> None:
    with open(json3_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    lines = parse_lines(data.get("events", []))
    if not lines:
        print(f"No subtitle lines found in {json3_path}")
        return

    if style == "karaoke":
        dialogues = convert_karaoke(lines)
    elif style == "buildup":
        dialogues = convert_buildup(lines)
    else:
        dialogues = convert_plain(lines)

    with open(output_path, "w", encoding="utf-8") as f:
        f.write(ASS_HEADER)
        for d in dialogues:
            f.write(d + "\n")

    print(f"Converted {len(dialogues)} subtitle events ({style}) → {output_path}")


def main():
    if len(sys.argv) < 2:
        print("Usage: json3_to_ass.py [--style karaoke|buildup] <input.json3> [output.ass]")
        sys.exit(1)

    args = list(sys.argv[1:])
    style = "buildup"

    if "--style" in args:
        idx = args.index("--style")
        style = args[idx + 1]
        args = args[:idx] + args[idx + 2:]

    input_path = args[0]
    if len(args) >= 2:
        output_path = args[1]
    else:
        output_path = str(Path(input_path).with_suffix(".ass"))

    convert(input_path, output_path, style)


if __name__ == "__main__":
    main()
