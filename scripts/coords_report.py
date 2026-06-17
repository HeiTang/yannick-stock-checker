"""Generate a Markdown report of all station coordinates.

Lets a human spot-check geocoding results visually. Outputs:

    app/data/COORDS_REPORT.md

Each row has the station name, address, resolved coords, a Google Maps link
and an OpenStreetMap link. Rows are sorted so problems float to the top:

* ❌ unresolved (lat is null)
* 🔍 out-of-Taiwan-bbox  (likely a wrong match — please verify)
* ✅ ok                  (sorted by station name)

Usage::

    PYTHONPATH=. python scripts/coords_report.py
"""

from __future__ import annotations

import sys
from pathlib import Path

# Make `app.*` importable when running this file directly.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.geocode_stations import (  # noqa: E402  (sibling script import)
    TW_LAT_MAX,
    TW_LAT_MIN,
    TW_LNG_MAX,
    TW_LNG_MIN,
    is_in_taiwan,
    is_resolved,
    load_coords_file,
)

COORDS_PATH = Path("app/data/station_coords.json")
REPORT_PATH = Path("app/data/COORDS_REPORT.md")


def maps_link(lat: float, lng: float) -> str:
    return f"https://www.google.com/maps/search/?api=1&query={lat},{lng}"


def osm_link(lat: float, lng: float) -> str:
    return f"https://www.openstreetmap.org/?mlat={lat}&mlon={lng}&zoom=17"


def main() -> None:
    raw = load_coords_file(COORDS_PATH)

    unresolved: list[tuple[str, dict]] = []
    out_of_bbox: list[tuple[str, dict]] = []
    ok: list[tuple[str, dict]] = []

    for tid, entry in raw.items():
        if not is_resolved(entry):
            unresolved.append((tid, entry))
        elif not is_in_taiwan(entry["lat"], entry["lng"]):
            out_of_bbox.append((tid, entry))
        else:
            ok.append((tid, entry))

    # OK rows: sort by name for readability
    ok.sort(key=lambda kv: kv[1].get("name") or kv[0])

    lines: list[str] = []
    lines.append("# Station coords report")
    lines.append("")
    lines.append(
        f"Total: **{len(raw)}** · ✅ {len(ok)} · 🔍 {len(out_of_bbox)} out-of-bbox · ❌ {len(unresolved)} unresolved"
    )
    lines.append("")
    lines.append(
        f"Bbox used: lat ∈ [{TW_LAT_MIN}, {TW_LAT_MAX}], "
        f"lng ∈ [{TW_LNG_MIN}, {TW_LNG_MAX}]"
    )
    lines.append("")

    if unresolved:
        lines.append("## ❌ Unresolved")
        lines.append("")
        lines.append("| TID | 站點 | 地址 |")
        lines.append("|---|---|---|")
        for tid, e in unresolved:
            lines.append(
                f"| `{tid}` | {e.get('name') or '—'} | {e.get('address') or '—'} |"
            )
        lines.append("")

    if out_of_bbox:
        lines.append("## 🔍 Out-of-Taiwan-bbox (please verify)")
        lines.append("")
        lines.append("| TID | 站點 | 地址 | 座標 | 地圖 |")
        lines.append("|---|---|---|---|---|")
        for tid, e in out_of_bbox:
            lat, lng = e["lat"], e["lng"]
            lines.append(
                f"| `{tid}` | {e.get('name') or '—'} | {e.get('address') or '—'} "
                f"| {lat:.5f}, {lng:.5f} "
                f"| [Maps]({maps_link(lat, lng)}) · [OSM]({osm_link(lat, lng)}) |"
            )
        lines.append("")

    lines.append(f"## ✅ Resolved ({len(ok)})")
    lines.append("")
    lines.append("| 站點 | 地址 | 座標 | 地圖 |")
    lines.append("|---|---|---|---|")
    for _tid, e in ok:
        lat, lng = e["lat"], e["lng"]
        lines.append(
            f"| {e.get('name') or '—'} | {e.get('address') or '—'} "
            f"| {lat:.5f}, {lng:.5f} "
            f"| [Maps]({maps_link(lat, lng)}) · [OSM]({osm_link(lat, lng)}) |"
        )
    lines.append("")

    REPORT_PATH.write_text("\n".join(lines), encoding="utf-8")
    print(f"Wrote {REPORT_PATH}")
    print(
        f"  ✅ {len(ok)}   🔍 {len(out_of_bbox)} out-of-bbox   ❌ {len(unresolved)} unresolved"
    )


if __name__ == "__main__":
    main()
