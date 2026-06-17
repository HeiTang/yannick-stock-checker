"""One-shot YTM station geocoder.

Resolves each station's `address` to (lat, lng) via OpenStreetMap Nominatim
and writes the result to `app/data/station_coords.json`. Designed to be
re-runnable: existing entries are skipped, only new stations or previously
failed lookups (`null`) are queried.

Usage::

    PYTHONPATH=. python scripts/geocode_stations.py

Nominatim usage policy: max 1 req/s, must set a descriptive User-Agent that
identifies the application. See https://operations.osmfoundation.org/policies/nominatim/

Outputs JSON shape::

    {
      "F7D4C41212D4F8": [25.0353, 121.4999],
      "F7D4C45C1650DB": null,
      ...
    }

`null` means the address was queried but Nominatim returned no match —
they remain `null` so subsequent runs will retry them.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import sys
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


def load_existing(path: Path) -> dict[str, list[float] | None]:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text("utf-8"))
    except (OSError, ValueError) as err:
        logger.warning("Could not read existing %s: %s — starting fresh", path, err)
        return {}


def save(path: Path, coords: dict[str, list[float] | None]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(coords, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    scraper = YannickScraper()
    stations = await scraper.fetch_stations()
    logger.info("Fetched %d stations from upstream", len(stations))

    coords: dict[str, list[float] | None] = load_existing(OUTPUT_PATH)
    if coords:
        already = sum(1 for v in coords.values() if v is not None)
        logger.info("Loaded %d existing entries (%d resolved) from %s", len(coords), already, OUTPUT_PATH)

    headers = {"User-Agent": USER_AGENT}
    async with httpx.AsyncClient(headers=headers) as client:
        for i, station in enumerate(stations, start=1):
            if coords.get(station.tid) is not None:
                logger.info("[%d/%d] %s — cached", i, len(stations), station.name)
                continue
            logger.info("[%d/%d] geocoding %s", i, len(stations), station.name)
            result = await geocode_station(client, station)
            coords[station.tid] = list(result) if result else None
            if result is None:
                logger.warning("  ✗ no match for %s", station.name)
            else:
                logger.info("  ✓ %s -> %.5f, %.5f", station.name, *result)
            # Inter-station spacing on top of any in-strategy sleeps
            await asyncio.sleep(REQUEST_DELAY)

    save(OUTPUT_PATH, coords)
    matched = sum(1 for v in coords.values() if v is not None)
    logger.info(
        "Saved %d entries (%d resolved, %d unresolved) to %s",
        len(coords),
        matched,
        len(coords) - matched,
        OUTPUT_PATH,
    )


if __name__ == "__main__":
    asyncio.run(main())
