"""Scraper: fetch station list and per-station inventory from Yannick."""

from __future__ import annotations

import asyncio
import json
import logging
import random
import re
import time
from pathlib import Path

import httpx

from app.config import settings
from app.core.models import Station, StockItem

logger = logging.getLogger(__name__)

# Regex to extract the `let Machines = [...]` JSON blob from the HTML source.
_MACHINES_RE = re.compile(r"let\s+Machines\s*=\s*(\[.*?\])\s*;", re.DOTALL)

# Errors that are safe to retry (transient network / server issues).
_RETRYABLE = (httpx.TimeoutException, httpx.ConnectError)

# Static lookup of geocoded station coordinates.
# Populated by `scripts/geocode_stations.py`. See app/data/station_coords.json.
_STATION_COORDS_PATH = Path(__file__).resolve().parent.parent / "data" / "station_coords.json"


def _load_station_coords() -> dict[str, tuple[float, float] | None]:
    """Load static (tid -> (lat, lng)) lookup, tolerating missing/broken files.

    Distance-sort features depend on this. Returning an empty mapping when
    the file isn't shipped (e.g. in a slimmed-down container) means stations
    just get `lat = lng = None` and the feature degrades gracefully.

    Supports two on-disk shapes for forward / backward compatibility:

    * Rich (current): ``{ tid: { "lat": x, "lng": y, "name": ..., ... } }``
    * Legacy: ``{ tid: [lat, lng] | null }``
    """
    if not _STATION_COORDS_PATH.exists():
        logger.info("Station coords file not found at %s — distances unavailable", _STATION_COORDS_PATH)
        return {}
    try:
        raw = json.loads(_STATION_COORDS_PATH.read_text("utf-8"))
    except (OSError, ValueError) as err:
        logger.warning("Could not read %s: %s — distances unavailable", _STATION_COORDS_PATH, err)
        return {}
    if not isinstance(raw, dict):
        logger.warning(
            "Coords file %s top-level is not a dict (got %s) — distances unavailable",
            _STATION_COORDS_PATH,
            type(raw).__name__,
        )
        return {}
    out: dict[str, tuple[float, float] | None] = {}
    for tid, entry in raw.items():
        out[tid] = _parse_coord_entry(entry)
    logger.info(
        "Loaded coords for %d stations (%d resolved)",
        len(out),
        sum(1 for v in out.values() if v is not None),
    )
    return out


def _parse_coord_entry(entry: object) -> tuple[float, float] | None:
    """Extract (lat, lng) from either the rich-dict or legacy-list shape."""
    if isinstance(entry, dict):
        lat = entry.get("lat")
        lng = entry.get("lng")
        if isinstance(lat, (int, float)) and isinstance(lng, (int, float)):
            return float(lat), float(lng)
        return None
    if isinstance(entry, list) and len(entry) == 2:
        try:
            return float(entry[0]), float(entry[1])
        except (TypeError, ValueError):
            return None
    return None


_STATION_COORDS: dict[str, tuple[float, float] | None] = _load_station_coords()


class ScraperError(Exception):
    """Raised when scraping fails."""


class YannickScraper:
    """Async scraper for Yannick YTM data."""

    def __init__(
        self,
        max_concurrent: int = settings.max_concurrent_requests,
        delay: float = settings.request_delay_seconds,
        timeout: float = settings.request_timeout_seconds,
        max_retries: int = settings.retry_max_attempts,
        initial_backoff: float = settings.retry_initial_backoff,
        max_backoff: float = settings.retry_max_backoff,
    ) -> None:
        self._semaphore = asyncio.Semaphore(max_concurrent)
        self._delay = delay
        self._timeout = timeout
        self._max_retries = max_retries
        self._initial_backoff = initial_backoff
        self._max_backoff = max_backoff

    # ── Helpers ──────────────────────────────────────────────

    def _backoff(self, attempt: int) -> float:
        """Exponential backoff with full jitter (Google Cloud strategy).

        wait = random(0, min(max_backoff, initial_backoff * 2^attempt))
        """
        exp = min(self._max_backoff, self._initial_backoff * (2**attempt))
        return random.uniform(0, exp)

    # ── Public API ───────────────────────────────────────────

    async def fetch_stations(self) -> list[Station]:
        """Fetch all YTM station metadata from the service page HTML."""
        logger.debug("Fetching service page: %s", settings.service_page_url)
        t0 = time.monotonic()

        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.get(settings.service_page_url)
            resp.raise_for_status()

        elapsed = time.monotonic() - t0
        logger.debug(
            "Service page fetched in %.2fs (%d bytes)", elapsed, len(resp.text)
        )

        match = _MACHINES_RE.search(resp.text)
        if not match:
            raise ScraperError("Cannot locate Machines JSON in page source")

        raw: list[dict] = json.loads(match.group(1))
        stations = []
        for m in raw:
            coords = _STATION_COORDS.get(m["TID"])
            lat, lng = coords if coords else (None, None)
            stations.append(
                Station(
                    tid=m["TID"],
                    name=m["TName"],
                    address=m.get("TAddr", ""),
                    branch_code=m["RID"],
                    branch_name=m["RName"],
                    photo_url=m.get("PHOTO_URL", ""),
                    sort=m.get("Sort", 0),
                    lat=lat,
                    lng=lng,
                )
            )
        logger.info("Fetched %d stations from service page", len(stations))
        for s in stations:
            logger.debug("  Station: [%s] %s (%s)", s.tid, s.name, s.branch_name)
        return stations

    async def fetch_stock(
        self, station_id: str, client: httpx.AsyncClient
    ) -> list[StockItem]:
        """Query inventory for a single station with retry + exponential backoff."""
        last_exc: Exception | None = None

        for attempt in range(self._max_retries + 1):
            t0 = time.monotonic()
            try:
                async with self._semaphore:
                    resp = await client.post(
                        settings.stock_api_url,
                        data={"TID": station_id},
                        headers={"Content-Type": "application/x-www-form-urlencoded"},
                    )
                    if self._delay > 0:
                        await asyncio.sleep(self._delay)

                # Retry on 5xx server errors
                if resp.status_code >= 500:
                    elapsed = time.monotonic() - t0
                    wait = self._backoff(attempt)
                    logger.warning(
                        "  ⟳ Station %s: HTTP %d (%.2fs), retry %d/%d in %.1fs",
                        station_id,
                        resp.status_code,
                        elapsed,
                        attempt + 1,
                        self._max_retries,
                        wait,
                    )
                    last_exc = httpx.HTTPStatusError(
                        f"HTTP {resp.status_code}",
                        request=resp.request,
                        response=resp,
                    )
                    await asyncio.sleep(wait)
                    continue

                resp.raise_for_status()

            except _RETRYABLE as e:
                elapsed = time.monotonic() - t0
                last_exc = e
                if attempt < self._max_retries:
                    wait = self._backoff(attempt)
                    logger.warning(
                        "  ⟳ Station %s: %s (%.2fs), retry %d/%d in %.1fs",
                        station_id,
                        type(e).__name__,
                        elapsed,
                        attempt + 1,
                        self._max_retries,
                        wait,
                    )
                    await asyncio.sleep(wait)
                    continue
                # All retries exhausted — raise to caller
                raise

            # ── Success — parse response ────────────────────
            elapsed = time.monotonic() - t0
            payload = resp.json()
            if payload.get("Status", {}).get("code") != "00":
                logger.warning(
                    "Non-OK status for station %s (%.2fs): %s",
                    station_id,
                    elapsed,
                    payload,
                )
                return []

            stock_list = payload.get("Result", {}).get("StockList") or []
            items = [
                StockItem(
                    sale_id=s["SaleID"],
                    product_name=s["ProductName"],
                    commodity_name=s["commodityName"],
                    commodity_code=s["commodityCode"],
                    commodity_id=s["commodityID"],
                    price=s["Price"],
                    quantity=s["quantity"],
                    color_id=s.get("ColorID", "F"),
                    size_id=s.get("SizeID", "F"),
                )
                for s in stock_list
            ]

            retry_tag = f" (after {attempt} retries)" if attempt > 0 else ""
            logger.debug(
                "  Station %s: %d items in %.2fs%s%s",
                station_id,
                len(items),
                elapsed,
                retry_tag,
                " — " + ", ".join(f"{i.commodity_name}(×{i.quantity})" for i in items)
                if items
                else " (empty)",
            )
            return items

        # Should not reach here, but just in case
        raise last_exc or ScraperError(f"All retries exhausted for {station_id}")

    async def fetch_all_stocks(
        self, stations: list[Station]
    ) -> dict[str, list[StockItem]]:
        """Fetch inventory for *all* stations concurrently (with semaphore)."""
        result: dict[str, list[StockItem]] = {}
        total = len(stations)

        logger.debug(
            "Starting parallel stock fetch for %d stations "
            "(concurrency=%d, delay=%.1fs, retries=%d, backoff=%.1f→%.1fs)",
            total,
            self._semaphore._value,
            self._delay,
            self._max_retries,
            self._initial_backoff,
            self._max_backoff,
        )
        t0 = time.monotonic()

        async with httpx.AsyncClient(timeout=self._timeout) as client:

            async def _fetch_one(station: Station) -> None:
                try:
                    items = await self.fetch_stock(station.tid, client)
                    result[station.tid] = items
                except (httpx.TimeoutException, httpx.ConnectError) as e:
                    # All retries exhausted for this station
                    logger.warning(
                        "  ✗ %s (%s): %s after %d retries",
                        station.name,
                        station.tid,
                        type(e).__name__,
                        self._max_retries,
                    )
                    result[station.tid] = []
                except Exception:
                    # Unexpected error — dump full traceback
                    logger.exception(
                        "  ✗ Unexpected error fetching %s (%s)",
                        station.name,
                        station.tid,
                    )
                    result[station.tid] = []

            await asyncio.gather(*[_fetch_one(s) for s in stations])

        elapsed = time.monotonic() - t0
        ok = sum(1 for v in result.values() if v)
        total_items = sum(len(v) for v in result.values())
        logger.info(
            "Fetched stock for %d / %d stations in %.1fs (%d total items)",
            ok,
            total,
            elapsed,
            total_items,
        )
        return result
