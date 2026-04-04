"""Tests for the aggregator module."""

from __future__ import annotations

import pytest

from app.core.aggregator import StockAggregator
from app.core.models import Station, StockItem


# ── Fixtures ─────────────────────────────────────────────────


def make_stations() -> list[Station]:
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


# ── Tests ────────────────────────────────────────────────────


def test_build_product_index_basic():
    agg = StockAggregator()
    stations = make_stations()

    stock_map = {
        "S1": [make_stock_item("CODE1", quantity=2)],
        "S2": [make_stock_item("CODE1", quantity=1)],
        "S3": [],
    }

    index = agg.build_product_index(stations, stock_map)

    assert "CODE1" in index
    avail = index["CODE1"]
    assert avail.product.commodity_code == "CODE1"
    assert avail.product.price == 420
    assert avail.total_quantity == 3
    assert avail.available_station_count == 2


def test_build_product_index_multiple_products():
    agg = StockAggregator()
    stations = make_stations()

    stock_map = {
        "S1": [
            make_stock_item("CODE1", quantity=2),
            make_stock_item("CODE2", commodity_name="生乳捲", product_name="(YTM)生乳捲", price=320, quantity=1),
        ],
        "S2": [make_stock_item("CODE2", commodity_name="生乳捲", product_name="(YTM)生乳捲", price=320, quantity=3)],
        "S3": [],
    }

    index = agg.build_product_index(stations, stock_map)

    assert len(index) == 2
    assert index["CODE1"].total_quantity == 2
    assert index["CODE1"].available_station_count == 1
    assert index["CODE2"].total_quantity == 4
    assert index["CODE2"].available_station_count == 2


def test_build_product_index_empty():
    agg = StockAggregator()
    stations = make_stations()
    stock_map = {"S1": [], "S2": [], "S3": []}

    index = agg.build_product_index(stations, stock_map)
    assert len(index) == 0


def test_build_product_index_missing_station():
    """Station in stock_map but not in stations list should be skipped."""
    agg = StockAggregator()
    stations = make_stations()

    stock_map = {
        "S1": [make_stock_item("CODE1", quantity=1)],
        "UNKNOWN": [make_stock_item("CODE1", quantity=5)],
    }

    index = agg.build_product_index(stations, stock_map)
    assert index["CODE1"].total_quantity == 1  # UNKNOWN station skipped


def test_stations_sorted_by_branch_then_name():
    agg = StockAggregator()
    stations = make_stations()

    stock_map = {
        "S1": [make_stock_item("CODE1", quantity=1)],
        "S2": [make_stock_item("CODE1", quantity=1)],
        "S3": [make_stock_item("CODE1", quantity=1)],
    }

    index = agg.build_product_index(stations, stock_map)
    names = [ss.station.name for ss in index["CODE1"].stations]

    # Sorted by branch_name then station name (Chinese lexicographic)
    assert names[0] == "龍山寺站"  # 台北捷運據點
    assert names[1] == "內湖旗艦店"  # 門市據點
    assert names[2] == "巨蛋站"  # 高雄捷運據點
