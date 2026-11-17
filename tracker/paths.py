"""Filesystem locations shared by all modules."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONFIG_FILE = ROOT / "config" / "destinations.json"
DATA_DIR = ROOT / "data"
RAW_DIR = DATA_DIR / "raw"
HISTORY_CSV = DATA_DIR / "history.csv"
STATUS_JSON = DATA_DIR / "status.json"
