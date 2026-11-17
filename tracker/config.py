"""Load the destination list."""
import json

from .paths import CONFIG_FILE


def load_destinations(path=CONFIG_FILE):
    with open(path, encoding="utf-8") as f:
        items = json.load(f)
    ids = [d["item_id"] for d in items]
    if len(ids) != len(set(ids)):
        raise ValueError("duplicate item_id in destinations config")
    return items
