"""One-shot YTM station geocoder.

Resolves each station's `address` to (lat, lng) via OpenStreetMap Nominatim
and writes the result to `app/data/station_coords.json`. Designed to be
re-runnable:

* Already-resolved entries are skipped, unless their stored ``address``
  differs from the upstream value (which means re-geocoding is needed).
* Previously failed entries (``lat`` or ``lng`` is null) are retried.

Usage::

    PYTHONPATH=. python scripts/geocode_stations.py

Nominatim usage policy: max 1 req/s, must set a descriptive User-Agent that
identifies the application. See https://operations.osmfoundation.org/policies/nominatim/

Output JSON shape (rich)::

    {
      "F7D4C41212D4F8": {
        "lat": 25.0353,
        "lng": 121.4999,
        "name": "板南線-龍山寺站",
        "address": "臺北市萬華區西園路1段153號",
        "resolved_at": "2026-06-17"
      },
      "F638C3E205B6E8": {
        "lat": null,
        "lng": null,
        "name": "屏東仁愛店",
        "address": "屏東縣屏東市仁愛路14之16號",
        "resolved_at": null
      }
    }

Coordinates are also checked against a conservative Taiwan bounding box
after resolving; out-of-range results are logged as warnings so the
geocoder doesn't silently introduce nonsense.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import sys
from datetime import date
from pathlib import Path

# Make `app.*` importable when running this file directly.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx

from app.core.models import Station
from app.core.scraper import YannickScraper

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
USER_AGENT = "yannick-stock-checker geocoder/1.0 (+https://yannick.purr.tw)"
REQUEST_DELAY = 1.1  # Nominatim allows max 1 req/s; add slack
OUTPUT_PATH = Path("app/data/station_coords.json")

# Branch codes (see app/core/models.py docstring).
BRANCH_TPE_MRT = "001"
BRANCH_KHH_MRT = "002"
BRANCH_STORE = "003"

# Conservative Taiwan bounding box (covers main island + Penghu / outlying).
# Anything outside this is almost certainly a geocoding mistake.
TW_LAT_MIN, TW_LAT_MAX = 21.5, 26.5
TW_LNG_MIN, TW_LNG_MAX = 118.5, 122.5


def is_in_taiwan(lat: float, lng: float) -> bool:
    return TW_LAT_MIN <= lat <= TW_LAT_MAX and TW_LNG_MIN <= lng <= TW_LNG_MAX


logger = logging.getLogger(__name__)


def queries_for(station: Station) -> list[str]:
    """Return ordered list of Nominatim query strings to try for one station.

    Nominatim's Taiwan OSM data has poor house-number coverage but good
    landmark coverage. So:

    * MRT stations: query "捷運{stem}站" — matches OSM's station landmarks.
      Names look like "板南線-龍山寺站"; we strip the line prefix.
    * 門市: try the store name (it often appears in OSM POIs), then the
      address with floor/exit parentheticals stripped.
    """
    queries: list[str] = []

    if station.branch_code in (BRANCH_TPE_MRT, BRANCH_KHH_MRT):
        # "板南線-龍山寺站" -> "龍山寺"
        stem = station.name.split("-", 1)[-1]
        if stem.endswith("站"):
            stem = stem[:-1]
        if stem:
            queries.append(f"捷運{stem}站")
            queries.append(f"{stem}站")  # fallback if MRT prefix unavailable
    else:
        # Store: full name first ("亞尼克內湖旗艦店" sometimes indexed)
        queries.append(station.name)

    if station.address:
        # Drop floor/exit notes: "...18號 1F" or "(出口5置物櫃旁)"
        addr = re.split(r"[(（]", station.address)[0].strip()
        # Drop trailing floor markers like " B1", " 1F"
        addr = re.sub(r"\s*[Bb1-9]\d*[FfLl]?$", "", addr).strip()
        if addr and addr not in queries:
            queries.append(addr)

    return queries


async def geocode_query(
    client: httpx.AsyncClient, query: str
) -> tuple[float, float] | None:
    """Query Nominatim once and return (lat, lng) or None if no match."""
    params = {
        "q": query,
        "format": "json",
        "limit": 1,
        "countrycodes": "tw",
    }
    try:
        resp = await client.get(NOMINATIM_URL, params=params, timeout=30.0)
        resp.raise_for_status()
        data = resp.json()
    except (httpx.HTTPError, ValueError) as err:
        logger.warning("Nominatim error for %r: %s", query, err)
        return None
    if not data:
        return None
    return float(data[0]["lat"]), float(data[0]["lon"])


async def geocode_station(
    client: httpx.AsyncClient, station: Station
) -> tuple[float, float] | None:
    """Try every query strategy until one returns a hit. Respects rate limit."""
    for i, query in enumerate(queries_for(station)):
        if i > 0:
            await asyncio.sleep(REQUEST_DELAY)
        result = await geocode_query(client, query)
        if result is not None:
            return result
        logger.debug("  · %r — no match", query)
    return None


def load_coords_file(path: Path) -> dict[str, dict]:
    """Single source of truth: load + normalize a coords JSON file.

    Safe against missing files, malformed JSON, and any pre-rich-schema shape.
    Always returns a `{tid -> normalized rich-dict entry}` map; callers can
    assume the rich schema (`is_resolved()`, dict indexing, etc.) without
    further validation.

    Used by every script in this directory as well as the GitHub Action.
    """
    if not path.exists():
        return {}
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as err:
        logger.warning("Could not read %s: %s — treating as empty", path, err)
        return {}
    if not isinstance(raw, dict):
        return {}
    return {tid: _normalize_entry(entry) for tid, entry in raw.items()}


# Backwards-compat alias for the geocoder's own bootstrap path. The geocoder
# also logs about the file, so it keeps its own thin wrapper.
def load_existing(path: Path) -> dict[str, dict]:
    return load_coords_file(path)


_BLANK_ENTRY = {
    "lat": None,
    "lng": None,
    "name": None,
    "address": None,
    "resolved_at": None,
}


def is_resolved(entry: dict | None) -> bool:
    """True when an entry has *both* numeric lat and lng (after normalization)."""
    if not entry:
        return False
    return entry.get("lat") is not None and entry.get("lng") is not None


def _as_float(value: object) -> float | None:
    """Coerce a JSON value to a float, but reject booleans.

    Necessary because Python's `bool` is a subclass of `int`, so
    `isinstance(True, (int, float))` is True and `float(True) == 1.0` —
    that would silently turn a malformed `{"lat": true}` into a perfectly
    valid-looking coordinate.
    """
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    return None


def _normalize_entry(entry: object) -> dict:
    """Coerce any on-disk entry shape into the rich-dict schema.

    Designed to tolerate broken / partial data so a single bad row doesn't
    abort the whole geocode run:

    * Unknown / extra keys are dropped, missing keys are filled with None.
    * `lat` / `lng` are only kept if **both** parse as real numbers
      (booleans excluded); otherwise both are set to None (a half-resolved
      entry is treated as unresolved).
    """
    if isinstance(entry, dict):
        merged = {**_BLANK_ENTRY, **{k: entry.get(k) for k in _BLANK_ENTRY}}
        lat = _as_float(merged["lat"])
        lng = _as_float(merged["lng"])
        if lat is not None and lng is not None:
            merged["lat"], merged["lng"] = lat, lng
        else:
            merged["lat"] = None
            merged["lng"] = None
        return merged
    if isinstance(entry, list) and len(entry) == 2:
        lat = _as_float(entry[0])
        lng = _as_float(entry[1])
        if lat is not None and lng is not None:
            return {**_BLANK_ENTRY, "lat": lat, "lng": lng}
        return dict(_BLANK_ENTRY)
    return dict(_BLANK_ENTRY)


def save(path: Path, coords: dict[str, dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(coords, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def needs_geocode(entry: dict | None, station: Station) -> bool:
    """Decide whether (tid, station) needs to be (re-)geocoded.

    True if any of:
    * entry missing entirely (new station)
    * entry has no coords yet (previous failure → retry)
    * upstream address has changed since last resolve (re-geocode)
    """
    if not is_resolved(entry):
        return True
    if (
        station.address
        and entry.get("address")
        and station.address != entry.get("address")
    ):
        return True
    return False


async def main() -> None:
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s"
    )

    scraper = YannickScraper()
    stations = await scraper.fetch_stations()
    logger.info("Fetched %d stations from upstream", len(stations))

    coords = load_existing(OUTPUT_PATH)
    if coords:
        already = sum(1 for v in coords.values() if is_resolved(v))
        logger.info(
            "Loaded %d existing entries (%d resolved) from %s",
            len(coords),
            already,
            OUTPUT_PATH,
        )

    headers = {"User-Agent": USER_AGENT}
    today = date.today().isoformat()
    out_of_bbox: list[str] = []

    async with httpx.AsyncClient(headers=headers) as client:
        for i, station in enumerate(stations, start=1):
            entry = coords.get(station.tid)
            if not needs_geocode(entry, station):
                logger.info("[%d/%d] %s — cached", i, len(stations), station.name)
                # Refresh name/address in case upstream tweaked formatting
                entry["name"] = station.name
                entry["address"] = station.address
                continue

            logger.info("[%d/%d] geocoding %s", i, len(stations), station.name)
            result = await geocode_station(client, station)
            if result is None:
                logger.warning("  ✗ no match for %s", station.name)
                coords[station.tid] = {
                    "lat": None,
                    "lng": None,
                    "name": station.name,
                    "address": station.address,
                    "resolved_at": None,
                }
            else:
                lat, lng = result
                if not is_in_taiwan(lat, lng):
                    logger.warning(
                        "  ⚠️ %s resolved to OUT-OF-TAIWAN coords (%.5f, %.5f) — kept but flagged",
                        station.name,
                        lat,
                        lng,
                    )
                    out_of_bbox.append(station.tid)
                else:
                    logger.info("  ✓ %s -> %.5f, %.5f", station.name, lat, lng)
                coords[station.tid] = {
                    "lat": lat,
                    "lng": lng,
                    "name": station.name,
                    "address": station.address,
                    "resolved_at": today,
                }
            await asyncio.sleep(REQUEST_DELAY)

    save(OUTPUT_PATH, coords)
    matched = sum(1 for v in coords.values() if is_resolved(v))
    logger.info(
        "Saved %d entries (%d resolved, %d unresolved) to %s",
        len(coords),
        matched,
        len(coords) - matched,
        OUTPUT_PATH,
    )
    if out_of_bbox:
        logger.warning(
            "%d station(s) outside Taiwan bbox — please review: %s",
            len(out_of_bbox),
            ", ".join(out_of_bbox),
        )


if __name__ == "__main__":
    asyncio.run(main())
