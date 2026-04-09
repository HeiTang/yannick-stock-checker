"""Shared fixtures and helpers for all tests."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.core.models import (
    Product,
    ProductAvailability,
    Station,
    StationStock,
    StockItem,
    SyncStatus,
)
from app.core.cache import TTLCache

# ── Shared constants ─────────────────────────────────────────

TW = timezone(timedelta(hours=8))


# ── Shared factory helpers ───────────────────────────────────


def make_stations() -> list[Station]:
    """Standard 3-station set for testing."""
    return [
        Station(
            tid="S1",
            name="龍山寺站",
            address="台北市萬華區",
            branch_code="001",
            branch_name="台北捷運據點",
        ),
        Station(
            tid="S2",
            name="巨蛋站",
            address="高雄市左營區",
            branch_code="002",
            branch_name="高雄捷運據點",
        ),
        Station(
            tid="S3",
            name="內湖旗艦店",
            address="台北市內湖區",
            branch_code="003",
            branch_name="門市據點",
        ),
    ]


def make_stock_item(
    commodity_code: str = "CODE1",
    commodity_name: str = "巴斯克生起司",
    product_name: str = "(YTM)巴斯克生起司",
    price: int = 420,
    quantity: int = 1,
) -> StockItem:
    return StockItem(
        sale_id=f"SALE-{commodity_code}",
        product_name=product_name,
        commodity_name=commodity_name,
        commodity_code=commodity_code,
        commodity_id=9999,
        price=price,
        quantity=quantity,
    )


def make_test_cache() -> TTLCache:
    """Create a pre-populated cache for testing (bypasses actual scraping)."""
    cache = TTLCache(ttl_seconds=999_999)

    station_a = Station(
        tid="S1",
        name="龍山寺站",
        address="台北市萬華區",
        branch_code="001",
        branch_name="台北捷運據點",
        photo_url="https://example.com/s1.jpg",
    )
    station_b = Station(
        tid="S2",
        name="巨蛋站",
        address="高雄市左營區",
        branch_code="002",
        branch_name="高雄捷運據點",
    )

    product = Product(
        commodity_code="CODE1",
        product_name="(YTM)巴斯克生起司",
        commodity_name="巴斯克生起司",
        price=420,
    )

    avail = ProductAvailability(
        product=product,
        stations=[
            StationStock(station=station_a, quantity=2),
            StationStock(station=station_b, quantity=1),
        ],
    )

    cache._product_index = {"CODE1": avail}
    cache._stations = [station_a, station_b]
    cache._status = SyncStatus(
        last_updated=datetime.now(TW),
        station_count=2,
        product_count=1,
        total_stock_items=3,
        is_syncing=False,
    )

    return cache
