"""Tests for the auto-geocode diff detector."""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch

import pytest

from app.core.models import Station
from scripts import check_station_diff as diff


def _make_station(tid: str, name: str = "站", address: str = "地址") -> Station:
    return Station(
        tid=tid,
        name=name,
        address=address,
        branch_code="001",
        branch_name="台北捷運據點",
    )


@pytest.fixture
def coords_file(tmp_path: Path, monkeypatch):
    """Redirect the diff script's coords file to an isolated tmp path."""
    p = tmp_path / "coords.json"
    monkeypatch.setattr(diff, "COORDS_PATH", p)
    return p


@pytest.mark.asyncio
async def test_no_changes_when_state_matches(coords_file: Path):
    coords_file.write_text(
        json.dumps(
            {
                "T1": {
                    "lat": 25.0,
                    "lng": 121.0,
                    "name": "板南線-龍山寺站",
                    "address": "addr-1",
                    "resolved_at": "2026-06-17",
                }
            }
        )
    )
    upstream = [_make_station("T1", "板南線-龍山寺站", "addr-1")]

    with patch.object(diff.YannickScraper, "fetch_stations", return_value=upstream):
        manifest = await diff.detect()

    assert manifest["has_changes"] is False
    assert manifest["new"] == []
    assert manifest["address_changed"] == []
    assert manifest["removed"] == []
    assert manifest["previously_failed"] == []


@pytest.mark.asyncio
async def test_detects_new_station(coords_file: Path):
    coords_file.write_text(
        json.dumps(
            {
                "T1": {
                    "lat": 25.0,
                    "lng": 121.0,
                    "name": "板南線-龍山寺站",
                    "address": "addr-1",
                    "resolved_at": "2026-06-17",
                }
            }
        )
    )
    upstream = [
        _make_station("T1", "板南線-龍山寺站", "addr-1"),
        _make_station("T2", "新站", "addr-new"),  # new
    ]

    with patch.object(diff.YannickScraper, "fetch_stations", return_value=upstream):
        manifest = await diff.detect()

    assert manifest["has_changes"] is True
    assert len(manifest["new"]) == 1
    assert manifest["new"][0]["tid"] == "T2"
    assert manifest["new"][0]["address"] == "addr-new"


@pytest.mark.asyncio
async def test_detects_address_change(coords_file: Path):
    coords_file.write_text(
        json.dumps(
            {
                "T1": {
                    "lat": 25.0,
                    "lng": 121.0,
                    "name": "S",
                    "address": "OLD",
                    "resolved_at": "2026-06-17",
                }
            }
        )
    )
    upstream = [_make_station("T1", "S", "NEW")]

    with patch.object(diff.YannickScraper, "fetch_stations", return_value=upstream):
        manifest = await diff.detect()

    assert manifest["has_changes"] is True
    assert len(manifest["address_changed"]) == 1
    item = manifest["address_changed"][0]
    assert item["tid"] == "T1"
    assert item["old_address"] == "OLD"
    assert item["new_address"] == "NEW"


@pytest.mark.asyncio
async def test_detects_removed_station(coords_file: Path):
    coords_file.write_text(
        json.dumps(
            {
                "T1": {
                    "lat": 25.0,
                    "lng": 121.0,
                    "name": "Removed",
                    "address": "addr",
                    "resolved_at": "2026-06-17",
                }
            }
        )
    )
    upstream: list[Station] = []  # upstream forgot about T1

    with patch.object(diff.YannickScraper, "fetch_stations", return_value=upstream):
        manifest = await diff.detect()

    assert manifest["has_changes"] is True
    assert len(manifest["removed"]) == 1
    assert manifest["removed"][0]["tid"] == "T1"
    assert manifest["removed"][0]["name"] == "Removed"


@pytest.mark.asyncio
async def test_detects_previously_failed_for_retry(coords_file: Path):
    coords_file.write_text(
        json.dumps(
            {
                "T1": {
                    "lat": None,
                    "lng": None,
                    "name": "Failed",
                    "address": "addr",
                    "resolved_at": None,
                }
            }
        )
    )
    upstream = [_make_station("T1", "Failed", "addr")]

    with patch.object(diff.YannickScraper, "fetch_stations", return_value=upstream):
        manifest = await diff.detect()

    assert manifest["has_changes"] is True
    assert len(manifest["previously_failed"]) == 1
    assert manifest["previously_failed"][0]["tid"] == "T1"
    # And it should NOT also be in `new`
    assert manifest["new"] == []
