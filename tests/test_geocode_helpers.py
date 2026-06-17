"""Tests for the small reusable helpers in `scripts/geocode_stations.py`."""

from __future__ import annotations

import json
from pathlib import Path

from scripts.geocode_stations import _normalize_entry, is_resolved, load_coords_file


# ── is_resolved ─────────────────────────────────────────────


def test_is_resolved_true_when_both_coords_present():
    assert is_resolved({"lat": 25.0, "lng": 121.0}) is True


def test_is_resolved_false_for_none_entry():
    assert is_resolved(None) is False


def test_is_resolved_false_for_empty_dict():
    assert is_resolved({}) is False


def test_is_resolved_false_when_only_lat_present():
    assert is_resolved({"lat": 25.0, "lng": None}) is False


def test_is_resolved_false_when_only_lng_present():
    assert is_resolved({"lat": None, "lng": 121.0}) is False


# ── _normalize_entry ────────────────────────────────────────


def test_normalize_entry_dict_passes_through_valid_pair():
    out = _normalize_entry(
        {
            "lat": 25.0,
            "lng": 121.0,
            "name": "板南線-龍山寺站",
            "address": "addr",
            "resolved_at": "2026-06-17",
        }
    )
    assert out["lat"] == 25.0
    assert out["lng"] == 121.0
    assert out["name"] == "板南線-龍山寺站"


def test_normalize_entry_half_resolved_dict_gets_both_nulled():
    """Defensive: a dict missing `lng` should not look 'resolved' to downstream."""
    out = _normalize_entry({"lat": 25.0, "lng": None, "name": "S"})
    assert out["lat"] is None
    assert out["lng"] is None
    # Other fields are preserved
    assert out["name"] == "S"


def test_normalize_entry_dict_with_string_coords_treats_as_unresolved():
    out = _normalize_entry({"lat": "25.0", "lng": "121.0"})
    assert out["lat"] is None
    assert out["lng"] is None


def test_normalize_entry_fills_missing_keys():
    out = _normalize_entry({"lat": 25.0, "lng": 121.0})
    for key in ("lat", "lng", "name", "address", "resolved_at"):
        assert key in out


def test_normalize_entry_drops_unknown_keys():
    out = _normalize_entry({"lat": 25.0, "lng": 121.0, "junk": "x"})
    assert "junk" not in out


def test_normalize_entry_legacy_list_form():
    out = _normalize_entry([25.0, 121.0])
    assert out["lat"] == 25.0
    assert out["lng"] == 121.0
    assert out["name"] is None  # legacy form has no metadata


def test_normalize_entry_garbage_returns_blank():
    out = _normalize_entry("garbage")
    assert out["lat"] is None
    assert out["lng"] is None


def test_normalize_entry_rejects_bool_coords_in_dict():
    """Python booleans are int subclass — must not slip in as `1.0` / `0.0`."""
    out = _normalize_entry({"lat": True, "lng": False})
    assert out["lat"] is None
    assert out["lng"] is None


def test_normalize_entry_rejects_bool_coords_in_legacy_list():
    out = _normalize_entry([True, False])
    assert out["lat"] is None
    assert out["lng"] is None


def test_normalize_entry_does_not_mutate_input():
    src = {"lat": 25.0, "lng": 121.0}
    _normalize_entry(src)
    assert "name" not in src


# ── load_coords_file ────────────────────────────────────────


def test_load_coords_file_returns_empty_when_missing(tmp_path: Path):
    assert load_coords_file(tmp_path / "nope.json") == {}


def test_load_coords_file_returns_empty_on_invalid_json(tmp_path: Path):
    p = tmp_path / "bad.json"
    p.write_text("{not json", encoding="utf-8")
    assert load_coords_file(p) == {}


def test_load_coords_file_returns_empty_when_top_level_isnt_dict(tmp_path: Path):
    p = tmp_path / "list.json"
    p.write_text(json.dumps([1, 2, 3]), encoding="utf-8")
    assert load_coords_file(p) == {}


def test_load_coords_file_normalizes_mixed_legacy_and_rich(tmp_path: Path):
    """Any mixture of rich-dict, legacy-list, and garbage rows should produce
    a clean rich-schema map without raising."""
    p = tmp_path / "mixed.json"
    p.write_text(
        json.dumps(
            {
                "RICH": {
                    "lat": 25.0,
                    "lng": 121.0,
                    "name": "rich",
                    "address": "a",
                    "resolved_at": "2026-06-17",
                },
                "LEGACY": [22.5, 120.3],
                "GARBAGE": "lol",
                "NULL_PAIR": None,
            }
        ),
        encoding="utf-8",
    )

    out = load_coords_file(p)
    assert out["RICH"]["lat"] == 25.0
    assert out["LEGACY"]["lat"] == 22.5
    assert out["LEGACY"]["name"] is None  # legacy has no metadata
    assert out["GARBAGE"]["lat"] is None
    assert out["NULL_PAIR"]["lat"] is None
    # All values are dicts (caller can safely use the rich schema)
    assert all(isinstance(v, dict) for v in out.values())
