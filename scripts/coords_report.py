"""Report coordinate provenance and precision; a bbox pass is not verification.

Usage: PYTHONPATH=. python scripts/coords_report.py
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.geocode_stations import is_resolved, load_coords_file  # noqa: E402

COORDS_PATH = Path("app/data/station_coords.json")
REPORT_PATH = Path("app/data/COORDS_REPORT.md")


def maps_link(lat: float, lng: float) -> str:
    return f"https://www.google.com/maps/search/?api=1&query={lat},{lng}"


def osm_link(lat: float, lng: float) -> str:
    return f"https://www.openstreetmap.org/?mlat={lat}&mlon={lng}&zoom=17"


def main() -> None:
    raw = load_coords_file(COORDS_PATH)
    groups: dict[str, list[tuple[str, dict]]] = {
        "❌ Unresolved / invalid": [],
        "🔍 Candidates — not independently verified": [],
        "✅ Verified reference points": [],
    }
    for tid, entry in raw.items():
        if not is_resolved(entry):
            group = "❌ Unresolved / invalid"
        elif all(
            entry.get(k)
            for k in ("verified_at", "source_url", "source_name", "precision")
        ):
            group = "✅ Verified reference points"
        else:
            group = "🔍 Candidates — not independently verified"
        groups[group].append((tid, entry))

    lines = [
        "# Station coords report",
        "",
        f"Total: **{len(raw)}** · "
        + " · ".join(f"{k}: {len(v)}" for k, v in groups.items()),
        "",
        "核對的是參考地點身分，不代表室內販賣機精確位置。台灣 bbox 僅為數值防線，不是正確性證明。",
        "精度：`entrance`＝車站出入口；`station`＝站體／站中心；`store`＝門市 POI；`address`＝門牌。",
        "未指定出口時使用代表出口；南港 2A 僅有出口 2 參考，高捷使用站中心。距離是直線近似。",
        "",
    ]
    for title, entries in groups.items():
        if not entries:
            continue
        lines += [
            "",
            f"## {title} ({len(entries)})",
            "",
            "| TID／站點 | 地址 | 座標／地圖 | 來源參考 | 精度 | 核對日期 |",
            "|---|---|---|---|---|---|",
        ]
        for tid, e in sorted(entries, key=lambda pair: pair[1].get("name") or pair[0]):
            coords = "—"
            if is_resolved(e):
                lat, lng = e["lat"], e["lng"]
                coords = f"[{lat:.7f}, {lng:.7f}]({maps_link(lat, lng)})"
            source = "—"
            if e.get("source_url"):
                source = f"[{e.get('source_name') or 'source'}]({e['source_url']})"
            lines.append(
                f"| `{tid}` {e.get('name') or '—'} | {e.get('address') or '—'} | "
                f"{coords} | {source} | {e.get('precision') or '—'} | {e.get('verified_at') or '未核對'} |"
            )
    REPORT_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(
        f"Wrote {REPORT_PATH}: "
        + ", ".join(f"{k}: {len(v)}" for k, v in groups.items())
    )


if __name__ == "__main__":
    main()
