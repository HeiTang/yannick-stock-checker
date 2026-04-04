"""Aggregator: build product → stations reverse index from raw stock data."""

from __future__ import annotations

import logging

from app.core.models import (
    Product,
    ProductAvailability,
    Station,
    StationStock,
    StockItem,
)

logger = logging.getLogger(__name__)


class StockAggregator:
    """Builds a reverse index: product → list of stations with stock."""

    def build_product_index(
        self,
        stations: list[Station],
        stock_map: dict[str, list[StockItem]],
    ) -> dict[str, ProductAvailability]:
        """
        Build reverse index.

        Args:
            stations: All station objects.
            stock_map: station_id → list of StockItem.

        Returns:
            commodity_code → ProductAvailability mapping.
        """
        station_lookup: dict[str, Station] = {s.tid: s for s in stations}
        index: dict[str, ProductAvailability] = {}

        for station_id, items in stock_map.items():
            station = station_lookup.get(station_id)
            if station is None:
                logger.warning("Station %s not found in lookup, skipping", station_id)
                continue

            for item in items:
                code = item.commodity_code

                if code not in index:
                    index[code] = ProductAvailability(
                        product=Product(
                            commodity_code=code,
                            product_name=item.product_name,
                            commodity_name=item.commodity_name,
                            price=item.price,
                        ),
                    )

                index[code].stations.append(
                    StationStock(
                        station=station,
                        quantity=item.quantity,
                    )
                )

        # Sort stations within each product by branch_name then station name
        for avail in index.values():
            avail.stations.sort(
                key=lambda ss: (ss.station.branch_name, ss.station.name)
            )

        logger.info(
            "Built product index: %d products across %d stations",
            len(index),
            len(station_lookup),
        )
        return index
