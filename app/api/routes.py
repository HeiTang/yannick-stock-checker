"""API route definitions for Yannick Stock Checker."""

from __future__ import annotations

from datetime import datetime, timezone, timedelta
from typing import Any

from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel, Field

from app.core.cache import TTLCache
from app.core.models import ProductAvailability

router = APIRouter(prefix="/api")

TW = timezone(timedelta(hours=8))

# ── Helper ───────────────────────────────────────────────────

async def get_index_with_bg_refresh(cache: TTLCache, bg_tasks: BackgroundTasks) -> dict[str, ProductAvailability]:
    """Helper to return stale data while triggering a background refresh."""
    if cache.is_expired:
        if cache.status.last_updated is None:
            # Cold start: must wait for the data
            return await cache.force_refresh()
        else:
            # Stale data: return immediately, refresh in background
            if not cache.status.is_syncing:
                bg_tasks.add_task(cache.force_refresh)
            return cache._product_index
    return cache._product_index

# ── Pydantic response models ────────────────────────────────


class ProductSummary(BaseModel):
    commodity_code: str
    product_name: str
    commodity_name: str
    price: int
    available_stations: int
    total_quantity: int
    lines: list[str] = Field(default_factory=list)


class ProductListResponse(BaseModel):
    products: list[ProductSummary]
    last_updated: str | None
    total_products: int


class StationInfo(BaseModel):
    station_id: str
    station_name: str
    station_addr: str
    branch_name: str
    quantity: int
    photo_url: str = ""


class ProductInfo(BaseModel):
    commodity_code: str
    product_name: str
    commodity_name: str
    price: int


class ProductDetailResponse(BaseModel):
    product: ProductInfo
    stations: list[StationInfo]
    total_quantity: int
    last_updated: str | None


class StationSummary(BaseModel):
    station_id: str
    station_name: str
    station_addr: str
    branch_code: str
    branch_name: str
    photo_url: str = ""


class BranchGroup(BaseModel):
    branch_code: str
    branch_name: str
    stations: list[StationSummary]


class StationListResponse(BaseModel):
    branches: list[BranchGroup]
    total_stations: int


class StationStockInfo(BaseModel):
    commodity_code: str
    product_name: str
    commodity_name: str
    price: int
    quantity: int


class StationDetailResponse(BaseModel):
    station: StationSummary
    stock: list[StationStockInfo]
    total_items: int
    last_updated: str | None


class RefreshResponse(BaseModel):
    success: bool
    message: str
    last_updated: str | None


class StatusResponse(BaseModel):
    last_updated: str | None
    station_count: int
    product_count: int
    total_stock_items: int
    is_syncing: bool
    cache_ttl_seconds: int


# ── Dependency ───────────────────────────────────────────────

_cache: TTLCache | None = None


def get_cache() -> TTLCache:
    global _cache
    if _cache is None:
        _cache = TTLCache()
    return _cache


def set_cache(cache: TTLCache) -> None:
    """Allow external injection (for testing / app startup)."""
    global _cache
    _cache = cache


# ── Helper ───────────────────────────────────────────────────


def _fmt_dt(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    return dt.isoformat()


# ── Routes ───────────────────────────────────────────────────


@router.get("/products", response_model=ProductListResponse)
async def list_products(background_tasks: BackgroundTasks) -> Any:
    cache = get_cache()
    index = await get_index_with_bg_refresh(cache, background_tasks)
    status = cache.status

    products = [
        ProductSummary(
            commodity_code=a.product.commodity_code,
            product_name=a.product.product_name,
            commodity_name=a.product.commodity_name,
            price=a.product.price,
            available_stations=a.available_station_count,
            total_quantity=a.total_quantity,
            lines=sorted({ss.station.branch_name or "其他" for ss in a.stations}),
        )
        for a in sorted(
            index.values(),
            key=lambda a: a.total_quantity,
            reverse=True,
        )
    ]

    return ProductListResponse(
        products=products,
        last_updated=_fmt_dt(status.last_updated),
        total_products=len(products),
    )


@router.get("/products/{code}", response_model=ProductDetailResponse)
async def get_product(code: str, background_tasks: BackgroundTasks) -> Any:
    cache = get_cache()
    index = await get_index_with_bg_refresh(cache, background_tasks)
    status = cache.status

    avail = index.get(code)
    if avail is None:
        raise HTTPException(status_code=404, detail=f"Product {code} not found")

    stations = [
        StationInfo(
            station_id=ss.station.tid,
            station_name=ss.station.name,
            station_addr=ss.station.address,
            branch_name=ss.station.branch_name,
            quantity=ss.quantity,
            photo_url=ss.station.photo_url,
        )
        for ss in avail.stations
    ]

    return ProductDetailResponse(
        product=ProductInfo(
            commodity_code=avail.product.commodity_code,
            product_name=avail.product.product_name,
            commodity_name=avail.product.commodity_name,
            price=avail.product.price,
        ),
        stations=stations,
        total_quantity=avail.total_quantity,
        last_updated=_fmt_dt(status.last_updated),
    )


@router.get("/stations", response_model=StationListResponse)
async def list_stations(background_tasks: BackgroundTasks) -> Any:
    cache = get_cache()
    # Ensure data is loaded
    await get_index_with_bg_refresh(cache, background_tasks)
    stations = cache.stations

    # Group by branch
    branch_map: dict[str, list[StationSummary]] = {}
    branch_names: dict[str, str] = {}

    for s in stations:
        summary = StationSummary(
            station_id=s.tid,
            station_name=s.name,
            station_addr=s.address,
            branch_code=s.branch_code,
            branch_name=s.branch_name,
            photo_url=s.photo_url,
        )
        branch_map.setdefault(s.branch_code, []).append(summary)
        branch_names[s.branch_code] = s.branch_name

    branches = [
        BranchGroup(
            branch_code=code,
            branch_name=branch_names[code],
            stations=branch_map[code],
        )
        for code in sorted(branch_map.keys())
    ]

    return StationListResponse(
        branches=branches,
        total_stations=len(stations),
    )


@router.get("/stations/{tid}", response_model=StationDetailResponse)
async def get_station(tid: str, background_tasks: BackgroundTasks) -> Any:
    cache = get_cache()
    index = await get_index_with_bg_refresh(cache, background_tasks)
    status = cache.status
    stations = cache.stations

    station = next((s for s in stations if s.tid == tid), None)
    if station is None:
        raise HTTPException(status_code=404, detail=f"Station {tid} not found")

    # Collect all products at this station
    stock: list[StationStockInfo] = []
    for avail in index.values():
        for ss in avail.stations:
            if ss.station.tid == tid:
                stock.append(
                    StationStockInfo(
                        commodity_code=avail.product.commodity_code,
                        product_name=avail.product.product_name,
                        commodity_name=avail.product.commodity_name,
                        price=avail.product.price,
                        quantity=ss.quantity,
                    )
                )

    return StationDetailResponse(
        station=StationSummary(
            station_id=station.tid,
            station_name=station.name,
            station_addr=station.address,
            branch_code=station.branch_code,
            branch_name=station.branch_name,
            photo_url=station.photo_url,
        ),
        stock=stock,
        total_items=sum(s.quantity for s in stock),
        last_updated=_fmt_dt(status.last_updated),
    )


@router.post("/refresh", response_model=RefreshResponse)
async def refresh_cache() -> Any:
    cache = get_cache()
    try:
        await cache.force_refresh()
        return RefreshResponse(
            success=True,
            message="Cache refreshed successfully",
            last_updated=_fmt_dt(cache.status.last_updated),
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Refresh failed: {e}")


@router.get("/status", response_model=StatusResponse)
async def get_status() -> Any:
    cache = get_cache()
    s = cache.status
    return StatusResponse(
        last_updated=_fmt_dt(s.last_updated),
        station_count=s.station_count,
        product_count=s.product_count,
        total_stock_items=s.total_stock_items,
        is_syncing=s.is_syncing,
        cache_ttl_seconds=int(cache._ttl.total_seconds()),
    )
