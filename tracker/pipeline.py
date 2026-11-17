"""One full run: fetch -> save raw -> rebuild history -> write status."""
import json
from datetime import datetime, timezone

from .build import PARSERS, build_history
from .config import load_destinations
from .raw import save_raw
from .sources import SOURCES
from .status import build_status, write_status


def run(now=None):
    now = now or datetime.now(timezone.utc)
    today = now.strftime("%Y-%m-%d")
    destinations = load_destinations()

    results = []
    for name, fetch in SOURCES.items():
        try:
            body = fetch(destinations)
            json.loads(body)  # must at least be valid JSON before we keep it
            count = len(PARSERS[name](body, destinations, name))
            save_raw(today, name, body)  # only replaces the day's file on success
            results.append({"name": name, "ok": True, "count": count})
            print(f"{name}: ok ({count} items)")
        except Exception as e:
            results.append({"name": name, "ok": False, "count": 0})
            print(f"{name}: FAILED - {e}")

    rows = build_history(destinations)
    status = build_status(now.strftime("%Y-%m-%dT%H:%M:%SZ"), today, results, rows)
    write_status(status)
    return status
