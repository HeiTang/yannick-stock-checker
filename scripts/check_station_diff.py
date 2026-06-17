"""Detect station-list drift between upstream and the committed coords file.

Output (stdout, JSON):

    {
      "has_changes": true,
      "summary": "1 new, 1 address-changed, 0 removed",
      "new": [
        {"tid": "...", "name": "...", "address": "..."}
      ],
      "address_changed": [
        {"tid": "...", "name": "...", "old_address": "...", "new_address": "..."}
      ],
      "removed": [
        {"tid": "...", "name": "...", "last_known_address": "..."}
      ],
      "previously_failed": [
        {"tid": "...", "name": "...", "address": "..."}
      ]
    }

If everything matches and there are no previously-failed entries to retry,
``has_changes`` is ``false`` and the CI workflow can short-circuit.

Used by ``.github/workflows/auto-geocode.yml``.

Usage::

    PYTHONPATH=. python scripts/check_station_diff.py            # to stdout
    PYTHONPATH=. python scripts/check_station_diff.py -o file    # to file
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

# Make `app.*` importable when running this file directly.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.scraper import YannickScraper

COORDS_PATH = Path("app/data/station_coords.json")


def load_coords() -> dict[str, dict]:
    if not COORDS_PATH.exists():
        return {}
    return json.loads(COORDS_PATH.read_text("utf-8"))


async def detect() -> dict:
    scraper = YannickScraper()
    stations = await scraper.fetch_stations()
    upstream = {s.tid: s for s in stations}
    coords = load_coords()

    new_list: list[dict] = []
    addr_changed: list[dict] = []
    removed: list[dict] = []
    previously_failed: list[dict] = []

    # New stations (upstream has tid, coords file doesn't)
    for tid, s in upstream.items():
        if tid not in coords:
            new_list.append({"tid": tid, "name": s.name, "address": s.address})

    # Address changed (both have tid, but address differs)
    for tid, s in upstream.items():
        entry = coords.get(tid)
        if entry is None:
            continue
        old_addr = entry.get("address") or ""
        if old_addr and s.address and old_addr != s.address:
            addr_changed.append(
                {
                    "tid": tid,
                    "name": s.name,
                    "old_address": old_addr,
                    "new_address": s.address,
                }
            )

    # Removed (coords file has tid, upstream doesn't)
    for tid, entry in coords.items():
        if tid not in upstream:
            removed.append(
                {
                    "tid": tid,
                    "name": entry.get("name") or "—",
                    "last_known_address": entry.get("address") or "—",
                }
            )

    # Previously failed (in JSON but lat == null) — retry candidates
    for tid, entry in coords.items():
        if tid not in upstream:
            continue
        if entry.get("lat") is None or entry.get("lng") is None:
            s = upstream[tid]
            previously_failed.append(
                {"tid": tid, "name": s.name, "address": s.address}
            )

    has_changes = bool(new_list or addr_changed or removed or previously_failed)
    summary = (
        f"{len(new_list)} new, "
        f"{len(addr_changed)} address-changed, "
        f"{len(removed)} removed, "
        f"{len(previously_failed)} retry"
    )

    return {
        "has_changes": has_changes,
        "summary": summary,
        "new": new_list,
        "address_changed": addr_changed,
        "removed": removed,
        "previously_failed": previously_failed,
    }


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("-o", "--output", help="Write JSON to this path instead of stdout")
    args = parser.parse_args()

    manifest = await detect()
    payload = json.dumps(manifest, ensure_ascii=False, indent=2)
    if args.output:
        Path(args.output).write_text(payload + "\n", encoding="utf-8")
    else:
        print(payload)
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
