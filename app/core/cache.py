"""TTL-based in-memory cache for aggregated stock data."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from app.config import settings
from app.core.aggregator import StockAggregator
from app.core.models import ProductAvailability, Station, SyncStatus
from app.core.scraper import YannickScraper

logger = logging.getLogger(__name__)

TW = timezone(timedelta(hours=8))


class TTLCache:
    """In-memory cache with TTL for aggregated stock data."""

    def __init__(self, ttl_seconds: int = settings.cache_ttl_seconds) -> None:
        self._ttl = timedelta(seconds=ttl_seconds)
        self._product_index: dict[str, ProductAvailability] = {}
        self._stations: list[Station] = []
        self._status = SyncStatus()
        self._lock = asyncio.Lock()
        self._scraper = YannickScraper()
        self._aggregator = StockAggregator()

    # ── Properties ───────────────────────────────────────────

    @property
    def is_expired(self) -> bool:
        if self._status.last_updated is None:
            return True
        return datetime.now(TW) - self._status.last_updated > self._ttl

    @property
    def status(self) -> SyncStatus:
        return self._status

    @property
    def stations(self) -> list[Station]:
        return self._stations

    # ── Public API ───────────────────────────────────────────

    async def get_or_refresh(self) -> dict[str, ProductAvailability]:
        """Return cached data, refreshing if expired."""
        if self.is_expired:
            await self.force_refresh()
        return self._product_index

    async def get_product_index(self) -> dict[str, ProductAvailability]:
        """Same as get_or_refresh – semantic alias."""
        return await self.get_or_refresh()

    async def force_refresh(self) -> dict[str, ProductAvailability]:
        """Force a full data refresh from upstream API."""
        async with self._lock:
            # Double check after acquiring lock
            if not self.is_expired and self._product_index:
                return self._product_index

            self._status.is_syncing = True
            try:
                logger.info("Starting data refresh …")

                # 1. Fetch station list
                stations = await self._scraper.fetch_stations()
                self._stations = stations

                # 2. Fetch all stock data
                stock_map = await self._scraper.fetch_all_stocks(stations)

                # 3. Build reverse index
                self._product_index = self._aggregator.build_product_index(
                    stations, stock_map
                )

                # 4. Update status
                total_items = sum(
                    a.total_quantity for a in self._product_index.values()
                )
                self._status = SyncStatus(
                    last_updated=datetime.now(TW),
                    station_count=len(stations),
                    product_count=len(self._product_index),
                    total_stock_items=total_items,
                    is_syncing=False,
                )

                logger.info(
                    "Refresh complete: %d products, %d stations, %d items",
                    self._status.product_count,
                    self._status.station_count,
                    self._status.total_stock_items,
                )
                return self._product_index

            except Exception:
                self._status.is_syncing = False
                logger.exception("Data refresh failed")
                raise
