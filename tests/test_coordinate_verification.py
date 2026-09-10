"""Regression checks for wrong-city matches and coordinate verification."""

from dataclasses import replace
from unittest.mock import AsyncMock

import httpx
import pytest

from app.core.models import Station
from scripts import check_station_diff, coords_report, geocode_stations as geo
from scripts.compose_pr_body import fmt_coords

STORE = Station("store", "台中旗艦店", "台中市西區五權西四街120號", "003", "門市據點")
MATCH = {
    "lat": "24.1356044",
    "lon": "120.6624468",
    "osm_type": "node",
    "osm_id": 123,
    "name": "亞尼克台中旗艦店",
    "address": {
        "city": "臺中市",
        "suburb": "西區",
        "road": "五權西四街",
        "house_number": "120",
    },
}


@pytest.mark.parametrize(
    "change",
    [
        {"address": {**MATCH["address"], "city": "臺北市"}},
        {"address": {**MATCH["address"], "suburb": "北區"}},
        {"address": {**MATCH["address"], "house_number": "20"}},
        {"address": {**MATCH["address"], "road": "五權西路"}},
        {"address": {"city": "臺中市", "suburb": "西區", "road": "五權西四街"}},
        {"address": None},
        {"lat": "NaN"},
        {"lon": "inf"},
        {"lat": True},
        {"lat": "garbage"},
        {"lat": 95},
        {"lon": None},
        {"osm_type": "bad"},
    ],
)
def test_rejects_wrong_identity_or_invalid_coordinate(change):
    assert geo.matched_candidate({**MATCH, **change}, STORE) is None


def test_queries_are_address_first_and_brand_city_qualified():
    assert geo.queries_for(STORE) == [STORE.address, "臺中市 亞尼克 台中旗艦店"]
    assert geo.municipality("403台中市西區五權西四街120號") == "臺中市"
    result = geo.matched_candidate(MATCH, STORE)
    assert result["lat"] == 24.1356044
    assert result["precision"] == "address"
    assert result["verified_at"] is None
    assert "尚未獨立核對" in fmt_coords(result)


def test_address_normalization_and_missing_municipality():
    station = replace(STORE, address="台中市北區崇德路一段482號 1F")
    candidate = {
        **MATCH,
        "address": {
            "city": "臺中市",
            "suburb": "北區",
            "road": "崇德路1段",
            "house_number": "482",
        },
    }
    assert geo.matched_candidate(candidate, station) is not None
    assert (
        geo.matched_candidate(MATCH, replace(STORE, address="五權西四街120號")) is None
    )


def test_subway_requires_name_municipality_and_subway_identity():
    station = Station(
        "mrt", "板南線-海山站", "236023新北市土城區海山路39號B2", "001", "台北捷運據點"
    )
    candidate = {
        **MATCH,
        "lat": "24.9853885",
        "lon": "121.4486097",
        "name": "海山",
        "class": "railway",
        "extratags": {"station": "subway", "ref": "BL03"},
        "address": {"city": "新北市"},
    }
    assert geo.matched_candidate(candidate, station)["precision"] == "station"
    assert geo.matched_candidate({**candidate, "name": "海山站公車站"}, station) is None
    assert geo.matched_candidate({**candidate, "extratags": {}}, station) is None
    assert (
        geo.matched_candidate(
            {**candidate, "extratags": {"station": "subway", "ref": "Y16"}}, station
        )
        is None
    )
    assert (
        geo.matched_candidate({**candidate, "address": {"city": "臺北市"}}, station)
        is None
    )


def test_same_station_name_on_different_lines_is_not_interchangeable():
    station = Station(
        "mrt", "環狀線-板橋站", "新北市板橋區新站路66號", "001", "台北捷運據點"
    )
    candidate = {
        **MATCH,
        "lat": "25.0151774",
        "lon": "121.4645961",
        "name": "板橋",
        "class": "railway",
        "extratags": {"station": "subway", "ref": "BL07"},
        "address": {"city": "新北市"},
    }
    assert geo.matched_candidate(candidate, station) is None
    candidate["extratags"]["ref"] = "Y16"
    assert geo.matched_candidate(candidate, station) is not None


@pytest.mark.asyncio
async def test_skips_bad_first_hit_and_preserves_provenance():
    wrong = {**MATCH, "address": {**MATCH["address"], "city": "臺北市"}}

    def response(request):
        assert request.url.params["addressdetails"] == "1"
        assert request.url.params["extratags"] == "1"
        return httpx.Response(200, json=[wrong, None, MATCH])

    async with httpx.AsyncClient(transport=httpx.MockTransport(response)) as client:
        result = await geo.geocode_query(client, "query", STORE)
    assert result["source_url"] == "https://www.openstreetmap.org/node/123"
    assert result["verified_at"] is None


@pytest.mark.asyncio
@pytest.mark.parametrize("payload", [{"error": "bad"}, [], [None, {"lat": "bad"}]])
async def test_bad_or_empty_search_is_unresolved(payload):
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _: httpx.Response(200, json=payload))
    ) as client:
        assert await geo.geocode_query(client, "query", STORE) is None


@pytest.mark.asyncio
async def test_changed_address_discards_old_verification(tmp_path, monkeypatch):
    path = tmp_path / "coords.json"
    old = {
        **geo.matched_candidate(MATCH, STORE),
        "name": STORE.name,
        "address": "台中市西區舊路1號",
        "verified_at": "2026-09-01",
    }
    geo.save(path, {STORE.tid: old})
    monkeypatch.setattr(geo, "OUTPUT_PATH", path)
    monkeypatch.setattr(geo, "REQUEST_DELAY", 0)
    monkeypatch.setattr(
        geo.YannickScraper, "fetch_stations", AsyncMock(return_value=[STORE])
    )
    monkeypatch.setattr(geo, "geocode_station", AsyncMock(return_value=None))
    await geo.main()
    after = geo.load_coords_file(path)[STORE.tid]
    assert after["lat"] is None and after["lng"] is None
    assert after["verified_at"] is None and after["source_url"] is None


@pytest.mark.asyncio
async def test_changed_name_triggers_retry_in_detector(tmp_path, monkeypatch):
    path = tmp_path / "coords.json"
    geo.save(
        path,
        {
            STORE.tid: {
                "lat": 24.1356,
                "lng": 120.6624,
                "name": "舊店名",
                "address": STORE.address,
            }
        },
    )
    monkeypatch.setattr(check_station_diff, "COORDS_PATH", path)
    monkeypatch.setattr(
        check_station_diff.YannickScraper,
        "fetch_stations",
        AsyncMock(return_value=[STORE]),
    )
    result = await check_station_diff.detect()
    assert [r["tid"] for r in result["previously_failed"]] == [STORE.tid]


def test_report_does_not_call_bbox_only_coordinates_verified(tmp_path, monkeypatch):
    path, report = tmp_path / "coords.json", tmp_path / "report.md"
    candidate = geo.matched_candidate(MATCH, STORE)
    geo.save(
        path, {"candidate": candidate, "invalid": {"lat": float("inf"), "lng": 121}}
    )
    monkeypatch.setattr(coords_report, "COORDS_PATH", path)
    monkeypatch.setattr(coords_report, "REPORT_PATH", report)
    coords_report.main()
    text = report.read_text()
    assert "Candidates — not independently verified (1)" in text
    assert "Verified reference points: 0" in text
    assert "Unresolved / invalid (1)" in text
