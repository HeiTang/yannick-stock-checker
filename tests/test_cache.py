"""Tests for the TTLCache module."""

import asyncio

import pytest
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock

from app.core.cache import TTLCache
from app.core.models import (
    Product,
    ProductAvailability,
    Station,
    StationStock,
    StockItem,
    SyncStatus,
)

TW = timezone(timedelta(hours=8))


def _make_product_index() -> dict[str, ProductAvailability]:
    """Create a minimal but type-correct product index for testing."""
    product = Product(
        commodity_code="TEST1",
        product_name="(YTM)測試蛋糕",
        commodity_name="測試蛋糕",
        price=100,
    )
    station = Station(
        tid="S1", name="測試站", address="測試地址",
        branch_code="001", branch_name="測試據點",
    )
    avail = ProductAvailability(
        product=product,
        stations=[StationStock(station=station, quantity=3)],
    )
    return {"TEST1": avail}


@pytest.fixture
def cache():
    return TTLCache(ttl_seconds=600)


def test_is_expired_cold_start(cache):
    assert cache.status.last_updated is None
    assert cache.is_expired is True


def test_is_expired_within_ttl(cache):
    cache._status = SyncStatus(last_updated=datetime.now(TW))
    assert cache.is_expired is False


@pytest.mark.asyncio
async def test_get_or_refresh_expired(cache):
    cache._status.last_updated = None
    cache.force_refresh = AsyncMock()
    await cache.get_or_refresh()
    cache.force_refresh.assert_called_once()


@pytest.mark.asyncio
async def test_get_product_index_alias(cache):
    cache._status.last_updated = datetime.now(TW)
    index = _make_product_index()
    cache._product_index = index
    res = await cache.get_product_index()
    assert res == index
    assert res["TEST1"].product.commodity_code == "TEST1"


@pytest.mark.asyncio
async def test_force_refresh_fast_path(cache):
    cache._status.last_updated = datetime.now(TW)
    index = _make_product_index()
    cache._product_index = index
    res = await cache.force_refresh()
    assert res == index


@pytest.mark.asyncio
async def test_force_refresh_logic():
    cache = TTLCache()
    cache._scraper.fetch_stations = AsyncMock(
        return_value=[
            Station(tid="1", name="S", address="A", branch_code="1", branch_name="B", photo_url="")
        ]
    )
    cache._scraper.fetch_all_stocks = AsyncMock(return_value={"1": []})

    res = await cache.force_refresh()
    assert cache.status.station_count == 1
    assert cache.status.is_syncing is False
    assert res == {}


@pytest.mark.asyncio
async def test_force_refresh_exception():
    cache = TTLCache()
    cache._scraper.fetch_stations = AsyncMock(side_effect=Exception("Fetch Error"))
    with pytest.raises(Exception, match="Fetch Error"):
        await cache.force_refresh()
    assert cache.status.is_syncing is False


@pytest.mark.asyncio
async def test_concurrent_force_refresh_only_runs_once():
    """Two coroutines hitting force_refresh concurrently — only one should
    actually call the scraper (the other should hit the double-check fast path)."""
    cache = TTLCache()
    call_count = 0

    async def slow_fetch_stations():
        nonlocal call_count
        call_count += 1
        await asyncio.sleep(0.05)  # simulate network delay
        return [
            Station(tid="1", name="S", address="A", branch_code="1", branch_name="B")
        ]

    cache._scraper.fetch_stations = slow_fetch_stations
    cache._scraper.fetch_all_stocks = AsyncMock(return_value={
        "1": [
            StockItem(
                sale_id="SALE1",
                product_name="(YTM)測試蛋糕",
                commodity_name="測試蛋糕",
                commodity_code="P1",
                commodity_id=1,
                price=100,
                quantity=3,
            )
        ]
    })

    # Fire two refreshes concurrently
    await asyncio.gather(cache.force_refresh(), cache.force_refresh())

    assert call_count == 1, "Scraper should only be called once due to lock + double-check"
