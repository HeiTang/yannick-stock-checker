"""Compose a Markdown PR body from a station-diff manifest.

Used by ``.github/workflows/auto-geocode.yml`` between the detect step and
the ``gh pr create`` step.

The manifest passed in is the JSON written by ``check_station_diff.py``,
plus the *post-run* coords map (so we can show the resolved lat/lng for
each new station instead of only its address).

Usage::

    python scripts/compose_pr_body.py manifest.json app/data/station_coords.json > body.md
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

# Make `app.*` / `scripts.*` importable when running directly.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.geocode_stations import is_resolved, load_coords_file  # noqa: E402


def maps_link(lat: float, lng: float) -> str:
    return f"https://www.google.com/maps/search/?api=1&query={lat},{lng}"


def fmt_coords(entry: dict | None) -> str:
    if not is_resolved(entry):
        return "⚠️ **failed — needs manual lookup**"
    return f"{entry['lat']:.5f}, {entry['lng']:.5f} · [Maps]({maps_link(entry['lat'], entry['lng'])})"


def main() -> None:
    if len(sys.argv) != 3:
        print(
            "usage: compose_pr_body.py <manifest.json> <coords.json>", file=sys.stderr
        )
        sys.exit(2)
    manifest = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    coords = load_coords_file(Path(sys.argv[2]))

    new_list = manifest.get("new", [])
    addr_changed = manifest.get("address_changed", [])
    removed = manifest.get("removed", [])
    retried = manifest.get("previously_failed", [])

    # Compute unresolved count to drive the PR title hint
    unresolved = [
        item
        for item in (*new_list, *addr_changed, *retried)
        if not is_resolved(coords.get(item["tid"]))
    ]

    lines: list[str] = []
    lines.append("## 站點資料變動偵測")
    lines.append("")
    lines.append(f"_{manifest.get('summary', '')}_")
    lines.append("")

    if unresolved:
        lines.append(
            f"> ⚠️ **{len(unresolved)} station(s) could not be auto-geocoded — manual review required.**"
        )
        lines.append("")

    if new_list:
        lines.append(f"### 🆕 新增站點（{len(new_list)}）")
        lines.append("")
        lines.append("| 站點 | 地址 | 座標 |")
        lines.append("|---|---|---|")
        for item in new_list:
            entry = coords.get(item["tid"])
            lines.append(
                f"| {item['name']} | {item['address']} | {fmt_coords(entry)} |"
            )
        lines.append("")

    if addr_changed:
        lines.append(f"### ✏️ 地址變更（{len(addr_changed)}）")
        lines.append("")
        lines.append("| 站點 | 舊地址 | 新地址 | 新座標 |")
        lines.append("|---|---|---|---|")
        for item in addr_changed:
            entry = coords.get(item["tid"])
            lines.append(
                f"| {item['name']} | {item['old_address']} | {item['new_address']} | {fmt_coords(entry)} |"
            )
        lines.append("")

    if retried:
        lines.append(f"### 🔄 重試 previously-failed（{len(retried)}）")
        lines.append("")
        lines.append("| 站點 | 地址 | 結果 |")
        lines.append("|---|---|---|")
        for item in retried:
            entry = coords.get(item["tid"])
            lines.append(
                f"| {item['name']} | {item['address']} | {fmt_coords(entry)} |"
            )
        lines.append("")

    if removed:
        lines.append(f"### ❌ 上游已下架（{len(removed)}）— **JSON 保留不刪**")
        lines.append("")
        lines.append("| TID | 最後已知名稱 | 最後已知地址 |")
        lines.append("|---|---|---|")
        for item in removed:
            lines.append(
                f"| `{item['tid']}` | {item['name']} | {item['last_known_address']} |"
            )
        lines.append("")
        lines.append(
            "> 這些站點已從上游消失。座標保留供歷史紀錄；確認下架後可手動 PR 移除。"
        )
        lines.append("")

    lines.append("---")
    lines.append("")
    lines.append(
        "_由 `.github/workflows/auto-geocode.yml` 自動產生。下次掃描時間：每週一 04:00 UTC（週一 12:00 TPE）。_"
    )

    print("\n".join(lines))


if __name__ == "__main__":
    main()
