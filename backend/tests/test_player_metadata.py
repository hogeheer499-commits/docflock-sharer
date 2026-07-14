import json

import player


def _add_video_folder(root, video_id):
    folder = root / video_id
    folder.mkdir()
    (folder / "video.mp4").touch()


def test_named_collection_resolution_uses_catalog_categories():
    assert player._named_collection_for_lecture(
        "Vol I: Power vs. Force - Muscle Testing", "Volume Series"
    ) == "Volume Series"
    assert player._named_collection_for_lecture(
        "What is Meant by Spiritual", "On The Road Talks"
    ) == "Discussion Series with Dr. Hawkins & Wife Susan"
    assert player._named_collection_for_lecture(
        "Q&A Session (Jul 2011)", "Supporting Programs"
    ) == "Satsang Questions & Answers"
    assert player._named_collection_for_lecture(
        "Causality: The Ego's Foundation", "The Way to God"
    ) is None


def test_scan_videos_omits_only_synthetic_collection_years(tmp_path, monkeypatch):
    library = {
        "series": [
            {
                "year": 2002,
                "name": "The Way to God",
                "lectures": [
                    {"num": 1, "title": "Causality: The Ego's Foundation", "month": "Jan", "parts": 1},
                ],
            },
            {
                "year": 2012,
                "name": "Supporting Programs",
                "lectures": [
                    {"num": 2, "title": "Q&A Session (Jul 2011)", "month": "Jul", "parts": 1},
                ],
            },
            {
                "year": 2013,
                "name": "Volume Series",
                "lectures": [
                    {"num": 1, "title": "Vol I: Power vs. Force - Muscle Testing", "month": "", "parts": 2},
                ],
            },
            {
                "year": 2014,
                "name": "Archival Office Visit Series",
                "lectures": [
                    {"num": 13, "title": "Stress", "month": "", "parts": 1},
                ],
            },
            {
                "year": 2015,
                "name": "On The Road Talks",
                "lectures": [
                    {"num": 8, "title": "What is Meant by Spiritual", "month": "", "parts": 1},
                ],
            },
        ]
    }
    (tmp_path / "library.json").write_text(json.dumps(library))
    for video_id in ("2002-01-1", "2012-02-1", "2013-01-1", "2013-01-2", "2014-13-1", "2015-08-1"):
        _add_video_folder(tmp_path, video_id)

    monkeypatch.setattr(player, "VIDEOS_DIR", tmp_path)
    videos = {video["id"]: video for video in player.scan_videos()}

    # A genuine annual lecture keeps its real date.
    assert videos["2002-01-1"]["title"] == "Causality: The Ego's Foundation (Jan 2002)"
    assert videos["2002-01-1"]["series"] == "2002: The Way to God"

    # Named collections retain meaningful source-title dates, but receive no
    # synthetic bucket date from 2012–2015.
    assert videos["2012-02-1"]["title"] == "Q&A Session (Jul 2011)"
    assert videos["2012-02-1"]["series"] == "Satsang Questions & Answers"
    assert videos["2013-01-1"]["title"] == "Vol I: Power vs. Force - Muscle Testing - 1 of 2"
    assert videos["2013-01-2"]["title"] == "Vol I: Power vs. Force - Muscle Testing - 2 of 2"
    assert videos["2013-01-1"]["series"] == "Volume Series"
    assert videos["2014-13-1"]["title"] == "Stress"
    assert videos["2014-13-1"]["series"] == "Archival Office Visit Series"
    assert videos["2015-08-1"]["title"] == "What is Meant by Spiritual"
    assert videos["2015-08-1"]["series"] == "Discussion Series with Dr. Hawkins & Wife Susan"


def test_playback_title_uses_the_same_clean_api_title():
    meta = {
        "title": "What is Meant by Spiritual",
        "year": 2015,
        "month": "",
        "parts": 1,
        "named_collection": "Discussion Series with Dr. Hawkins & Wife Susan",
    }

    # This exact value feeds both PlayerStatus.title and FFmpeg's drawtext overlay.
    assert player._lecture_display_title(meta, "1") == "What is Meant by Spiritual"
