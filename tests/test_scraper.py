"""Tests for the scraper module."""

from __future__ import annotations

import json

import httpx
import pytest
import respx

from app.config import settings
from app.core.models import Station
from app.core.scraper import ScraperError, YannickScraper

# ── Fixtures / sample data ──────────────────────────────────


SAMPLE_MACHINES = [
    {
        "TID": "AAA111",
        "TName": "板南線-龍山寺站",
        "TAddr": "臺北市萬華區西園路1段153號",
        "RID": "001",
        "RName": "台北捷運據點",
        "PHOTO_URL": "https://example.com/photo1.jpg",
        "Sort": 1,
    },
    {
        "TID": "BBB222",
        "TName": "紅線-巨蛋站",
        "TAddr": "高雄市左營區博愛路",
        "RID": "002",
        "RName": "高雄捷運據點",
        "PHOTO_URL": "https://example.com/photo2.jpg",
        "Sort": 2,
    },
]

SERVICE_PAGE_HTML = f"""
<html>
<script>
let Machines = {json.dumps(SAMPLE_MACHINES)};
let BranchList = [];
</script>
</html>
"""

SAMPLE_STOCK_RESPONSE = {
    "Result": {
        "StockList": [
            {
                "SaleID": "31Z064078",
                "ProductName": "(YTM)巴斯克生起司",
                "commodityName": "巴斯克生起司",
                "commodityCode": "31Z064078",
                "commodityID": 2009844,
                "Price": 420,
                "quantity": 2,
                "ColorID": "F",
                "SizeID": "F",
            }
        ]
    },
    "Status": {"code": "00", "info": ""},
    "Alert": None,
}


# ── Tests ────────────────────────────────────────────────────


@pytest.mark.asyncio
@respx.mock
async def test_fetch_stations_parses_html():
    respx.get(settings.service_page_url).mock(
        return_value=httpx.Response(200, text=SERVICE_PAGE_HTML)
    )

    scraper = YannickScraper(max_concurrent=2, delay=0)
    stations = await scraper.fetch_stations()

    assert len(stations) == 2
    assert stations[0].tid == "AAA111"
    assert stations[0].name == "板南線-龍山寺站"
    assert stations[0].branch_code == "001"
    assert stations[1].tid == "BBB222"


@pytest.mark.asyncio
@respx.mock
async def test_fetch_stations_raises_when_no_json():
    respx.get(settings.service_page_url).mock(
        return_value=httpx.Response(200, text="<html>no data</html>")
    )

    scraper = YannickScraper(max_concurrent=2, delay=0)
    with pytest.raises(ScraperError):
        await scraper.fetch_stations()


@pytest.mark.asyncio
@respx.mock
async def test_fetch_stock_returns_items():
    respx.post(settings.stock_api_url).mock(
        return_value=httpx.Response(200, json=SAMPLE_STOCK_RESPONSE)
    )

    scraper = YannickScraper(max_concurrent=2, delay=0)
    async with httpx.AsyncClient() as client:
        items = await scraper.fetch_stock("AAA111", client)

    assert len(items) == 1
    assert items[0].commodity_code == "31Z064078"
    assert items[0].price == 420
    assert items[0].quantity == 2


@pytest.mark.asyncio
@respx.mock
async def test_fetch_stock_empty_on_non_ok_status():
    respx.post(settings.stock_api_url).mock(
        return_value=httpx.Response(
            200,
            json={
                "Result": {},
                "Status": {"code": "99", "info": "error"},
                "Alert": None,
            },
        )
    )

    scraper = YannickScraper(max_concurrent=2, delay=0)
    async with httpx.AsyncClient() as client:
        items = await scraper.fetch_stock("AAA111", client)

    assert items == []


@pytest.mark.asyncio
@respx.mock
async def test_fetch_all_stocks():
    stations = [
        Station(
            tid="AAA111",
            name="龍山寺站",
            address="",
            branch_code="001",
            branch_name="台北捷運據點",
        ),
        Station(
            tid="BBB222",
            name="巨蛋站",
            address="",
            branch_code="002",
            branch_name="高雄捷運據點",
        ),
    ]

    respx.post(settings.stock_api_url).mock(
        return_value=httpx.Response(200, json=SAMPLE_STOCK_RESPONSE)
    )

    scraper = YannickScraper(max_concurrent=2, delay=0)
    result = await scraper.fetch_all_stocks(stations)

    assert len(result) == 2
    assert "AAA111" in result
    assert "BBB222" in result
    assert len(result["AAA111"]) == 1
