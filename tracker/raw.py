"""Read/write gzipped raw responses at data/raw/<UTC date>/<source>.json.gz."""
import gzip
import os

from .paths import RAW_DIR


def raw_path(date, source):
    return RAW_DIR / date / f"{source}.json.gz"


def save_raw(date, source, body: bytes):
    """Gzip the untouched response bytes; replaces any existing file for that day."""
    path = raw_path(date, source)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    # mtime=0 keeps the gzip bytes deterministic for identical content.
    tmp.write_bytes(gzip.compress(body, mtime=0))
    os.replace(tmp, path)


def read_raw(path) -> bytes:
    with gzip.open(path, "rb") as f:
        return f.read()


def list_raw():
    """Yield (date, source, path) for every raw file, sorted."""
    if not RAW_DIR.exists():
        return
    for day in sorted(p for p in RAW_DIR.iterdir() if p.is_dir()):
        for f in sorted(day.glob("*.json.gz")):
            yield day.name, f.name[: -len(".json.gz")], f
