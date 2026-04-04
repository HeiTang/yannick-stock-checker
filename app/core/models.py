"""Data models shared across modules."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime


# ── Raw data from Yannick ────────────────────────────────────


@dataclass(frozen=True)
class Station:
    """A YTM vending machine station."""

    tid: str  # unique station ID (e.g. "F7D4C41212D4F8")
    name: str  # e.g. "板南線-龍山寺站"
    address: str
    branch_code: str  # "001" / "002" / "003"
    branch_name: str  # "台北捷運據點" / "高雄捷運據點" / "門市據點"
    photo_url: str = ""
    sort: int = 0


@dataclass(frozen=True)
class StockItem:
    """A single product slot in a station's inventory."""

    sale_id: str
    product_name: str  # full name with (YTM) prefix
    commodity_name: str  # short name
    commodity_code: str
    commodity_id: int
    price: int
    quantity: int
    color_id: str = "F"
    size_id: str = "F"


# ── Aggregated / indexed data ────────────────────────────────


@dataclass(frozen=True)
class Product:
    """Deduplicated product info (key = commodity_code)."""

    commodity_code: str
    product_name: str
    commodity_name: str
    price: int


@dataclass
class StationStock:
    """A station that carries a particular product."""

    station: Station
    quantity: int


@dataclass
class ProductAvailability:
    """Reverse-index result: product → list of stations with stock."""

    product: Product
    stations: list[StationStock] = field(default_factory=list)

    @property
    def total_quantity(self) -> int:
        return sum(s.quantity for s in self.stations)

    @property
    def available_station_count(self) -> int:
        return len(self.stations)


@dataclass
class SyncStatus:
    """Metadata about the last data synchronisation."""

    last_updated: datetime | None = None
    station_count: int = 0
    product_count: int = 0
    total_stock_items: int = 0
    is_syncing: bool = False
