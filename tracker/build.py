"""Rebuild data/history.csv purely from the raw files (+ the destinations config)."""
import csv
import json
import os
import sys

from .config import load_destinations
from . import paths
from .raw import list_raw, read_raw

COLUMNS = [
    "date", "item_id", "item", "source", "country", "region", "vibe",
    "temp_high_f", "temp_low_f", "precip_in", "uv_index", "wind_max_mph",
    "sunshine_hours",
]


def _first(daily, key):
    vals = daily.get(key) or []
    return vals[0] if vals else None


# Open-Meteo snaps requested coordinates to its model grid (offsets seen: ~0.1 deg),
# so a response location is matched to the nearest configured destination.
MAX_MATCH_DEG = 0.5


def _match_destination(loc, destinations):
    lat, lon = loc.get("latitude"), loc.get("longitude")
    if lat is None or lon is None:
        return None
    best, best_d = None, None
    for d in destinations:
        dlon = abs(lon - d["lon"])
        dlon = min(dlon, 360 - dlon)  # wrap around the antimeridian
        dist = ((lat - d["lat"]) ** 2 + dlon ** 2) ** 0.5
        if best_d is None or dist < best_d:
            best, best_d = d, dist
    return best if best_d <= MAX_MATCH_DEG else None


def parse_open_meteo(body, destinations, source):
    """Open-Meteo returns a list (one object per requested location).

    Locations are matched to destinations by lat/lon, not position, so raw files
    stay readable after destinations are added. Locations that match no current
    destination (e.g. one removed from the config) are skipped.
    """
    data = json.loads(body)
    locations = data if isinstance(data, list) else [data]
    rows = []
    for loc in locations:
        dest = _match_destination(loc, destinations)
        if dest is None:
            continue
        daily = loc.get("daily") or {}
        date = _first(daily, "time")
        if not date:
            continue
        sun = _first(daily, "sunshine_duration")
        rows.append({
            "date": date, "item_id": dest["item_id"], "item": dest["name"],
            "source": source, "country": dest["country"], "region": dest["region"],
            "vibe": dest["vibe"],
            "temp_high_f": _first(daily, "temperature_2m_max"),
            "temp_low_f": _first(daily, "temperature_2m_min"),
            "precip_in": _first(daily, "precipitation_sum"),
            "uv_index": _first(daily, "uv_index_max"),
            "wind_max_mph": _first(daily, "wind_speed_10m_max"),
            "sunshine_hours": None if sun is None else round(sun / 3600, 2),
        })
    return rows


PARSERS = {"open-meteo": parse_open_meteo}


def build_rows(destinations):
    by_key = {}
    for _day, source, path in list_raw():
        parser = PARSERS.get(source)
        if parser is None:
            print(f"build: no parser for source '{source}', skipping {path}", file=sys.stderr)
            continue
        try:
            rows = parser(read_raw(path), destinations, source)
        except Exception as e:  # a bad raw file must not block the rest
            print(f"build: skipping {path}: {e}", file=sys.stderr)
            continue
        for r in rows:  # later raw files win for the same (date, item, source)
            by_key[(r["date"], r["item_id"], r["source"])] = r
    return sorted(by_key.values(), key=lambda r: (r["date"], r["item_id"], r["source"]))


def build_history(destinations=None):
    destinations = destinations or load_destinations()
    rows = build_rows(destinations)
    path = paths.HISTORY_CSV
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    with open(tmp, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS, lineterminator="\n")
        w.writeheader()
        for r in rows:
            w.writerow({k: "" if r[k] is None else r[k] for k in COLUMNS})
    os.replace(tmp, path)
    return rows
