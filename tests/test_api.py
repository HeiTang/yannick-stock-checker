"""Tests for the API routes."""

from __future__ import annotations

from datetime import datetime, timezone, timedelta
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from app.core.cache import TTLCache
from app.core.models import (
    Product,
    ProductAvailability,
    Station,
    StationStock,
    SyncStatus,
)
from app.api.routes import set_cache, router as api_router

# Build a test-only FastAPI app WITHOUT lifespan (avoids warm-up hitting real API)
from fastapi import FastAPI

_test_app = FastAPI()
_test_app.include_router(api_router)

TW = timezone(timedelta(hours=8))

# ── Fixtures ─────────────────────────────────────────────────


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
        last_updated=datetime.now(TW),  # Use current time so TTL never expires
        station_count=2,
        product_count=1,
        total_stock_items=3,
        is_syncing=False,
    )

    return cache


@pytest.fixture(autouse=True)
def setup_test_cache():
    """Inject test cache before each test."""
    cache = make_test_cache()
    set_cache(cache)
    yield
    set_cache(None)  # type: ignore


@pytest.fixture
def client():
    return TestClient(_test_app, raise_server_exceptions=False)


# ── Tests ────────────────────────────────────────────────────


def test_get_products(client):
    resp = client.get("/api/products")
    assert resp.status_code == 200

    data = resp.json()
    assert data["total_products"] == 1
    assert data["products"][0]["commodity_code"] == "CODE1"
    assert data["products"][0]["total_quantity"] == 3
    assert data["products"][0]["available_stations"] == 2
    assert data["last_updated"] is not None


def test_get_product_detail(client):
    resp = client.get("/api/products/CODE1")
    assert resp.status_code == 200

    data = resp.json()
    assert data["product"]["commodity_code"] == "CODE1"
    assert data["total_quantity"] == 3
    assert len(data["stations"]) == 2
    assert data["stations"][0]["station_name"] == "龍山寺站"


def test_get_product_not_found(client):
    resp = client.get("/api/products/NONEXIST")
    assert resp.status_code == 404


def test_get_stations(client):
    resp = client.get("/api/stations")
    assert resp.status_code == 200

    data = resp.json()
    assert data["total_stations"] == 2
    assert len(data["branches"]) == 2

    branch_codes = [b["branch_code"] for b in data["branches"]]
    assert "001" in branch_codes
    assert "002" in branch_codes


def test_get_station_detail(client):
    resp = client.get("/api/stations/S1")
    assert resp.status_code == 200

    data = resp.json()
    assert data["station"]["station_name"] == "龍山寺站"
    assert len(data["stock"]) == 1
    assert data["stock"][0]["commodity_code"] == "CODE1"
    assert data["total_items"] == 2


def test_get_station_not_found(client):
    resp = client.get("/api/stations/NOPE")
    assert resp.status_code == 404


def test_get_status(client):
    resp = client.get("/api/status")
    assert resp.status_code == 200

    data = resp.json()
    assert data["station_count"] == 2
    assert data["product_count"] == 1
    assert data["total_stock_items"] == 3
    assert data["is_syncing"] is False


def test_post_refresh(client):
    # Patch force_refresh to avoid real network calls
    cache = make_test_cache()
    cache.force_refresh = AsyncMock(return_value=cache._product_index)
    set_cache(cache)

    resp = client.post("/api/refresh")
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
