# Sunny Escapes

[![Tests](https://github.com/sammielumpkin/data-tracker/actions/workflows/tests.yml/badge.svg)](https://github.com/sammielumpkin/data-tracker/actions/workflows/tests.yml)

A daily weather tracker for 12 dream beach and city getaways. Every day a GitHub Action fetches the day's weather, keeps the raw response, rebuilds `data/history.csv` from the raw files, and opens a GitHub Issue listing the biggest temperature movers. A static three-page site (Today, Browse, Trends) reads the CSV in the browser. It is an installable, offline-capable app (web manifest + service worker).

**Live site:** https://sammielumpkin.github.io/data-tracker/

## Files

### Site (static, no build step)

| File | What it does |
|---|---|
| `index.html` | Today page: the latest day's weather and top movers. |
| `browse.html` | Browse page: filter, sort and star destinations. |
| `trends.html` | Trends page: charts and findings across the recorded days (loads Chart.js). |
| `app.js` | Shared code for all three pages: loads `data/history.csv` and `data/status.json`, parses them, applies the move rule, renders the pages, registers the service worker. |
| `style.css` | All styling, plus the `@font-face` rules. |
| `manifest.json` | Web app manifest (name, beach colors, icons) that makes the site installable. |
| `sw.js` | Service worker. Data files are fetched network-first and cached; the HTML, CSS, JS, fonts, images, Chart.js and icons are cached so pages open offline and show the last data loaded. |
| `icons/icon-192.png`, `icons/icon-512.png` | App icons used by the manifest. |
| `fonts/` | Self-hosted fonts: `Pacifico-Regular.ttf`, `Poppins-{Regular,Medium,SemiBold,Bold}.ttf`, with licenses `OFL-Pacifico.txt` and `OFL-Poppins.txt`. |
| `images/` | `favicon.svg`, `sun.svg`, `palm.svg`, `starfish.svg` and the wave graphics `wave-aqua.svg`, `wave-blue.svg`, `wave-foam.svg`, `wave-sand.svg`, `wave-divider.svg`. |
| `vendor/chart.umd.min.js`, `vendor/chart.js-LICENSE.md` | Vendored Chart.js and its license. |

### Data

| File | What it does |
|---|---|
| `config/destinations.json` | The 12 destinations: `item_id`, `name`, `country`, `region`, `vibe`, `lat`, `lon`. |
| `data/raw/<UTC date>/open-meteo.json.gz` | The untouched Open-Meteo response for that day, gzipped. The source of truth. |
| `data/history.csv` | One row per destination per day, derived entirely from the raw files. See [columns](#historycsv-columns). |
| `data/status.json` | Result of the latest run: `run_time`, `first_run_date`, `days_with_success`, `items`, `new_today`, `gone_today`, and per-source `ok`/`count`. |

### Pipeline (`tracker/`, Python standard library only)

| File | What it does |
|---|---|
| `__main__.py` | Command line: `run`, `rebuild`, `issue`. |
| `pipeline.py` | One full run: fetch, validate, save raw, rebuild history, write status. A failing source is recorded in `status.json` and doesn't stop the run. |
| `sources.py` | Fetches raw data (`fetch_open_meteo`). New sources are registered in `SOURCES`. |
| `raw.py` | Saves, reads and lists the gzipped raw files. |
| `build.py` | Parses raw files into rows and writes `data/history.csv`. |
| `config.py` | Loads `config/destinations.json` and rejects duplicate ids. |
| `history.py` | Reads `history.csv` back into rows (numbers as floats, empty as `None`). |
| `moves.py` | The move rule (below). |
| `status.py` | Computes and writes `data/status.json`. |
| `issue.py` | Opens or updates the daily GitHub Issue and closes earlier daily Issues. |
| `paths.py` | Shared file locations. |

### Tests and automation

| File | What it does |
|---|---|
| `tests/test_parse.py`, `tests/test_history.py`, `tests/test_moves.py`, `tests/test_issue.py` | Unit tests for parsing, history building, the move rule and the Issue logic. |
| `tests/conftest.py` | Shared test fixtures. |
| `pytest.ini`, `requirements-dev.txt` | pytest configuration and the dev dependency (`pytest`). |
| `.github/workflows/daily.yml` | Runs daily at 12:00 UTC (and on demand): `python -m tracker run`, then `python -m tracker issue`, then commits `data/raw`, `data/history.csv`, `data/status.json`. |
| `.github/workflows/tests.yml` | Runs the tests on every push; this is the badge at the top. |
| `.gitattributes`, `.gitignore` | LF line endings (gzip files binary); ignores Python caches. |

## Source: Open-Meteo

Data comes from the [Open-Meteo](https://open-meteo.com/) forecast API (`https://api.open-meteo.com/v1/forecast`), requested once per run for all destinations in one call, in **JSON** format. The request asks for one day (`forecast_days=1`), `timezone=UTC`, and imperial units (°F, inches, mph).

The response is a JSON list with one object per requested location. The whole response is saved as-is in `data/raw/`. From each location only the first value of these daily variables is kept for `history.csv`:

| Open-Meteo variable | Kept as |
|---|---|
| `time` | `date` |
| `temperature_2m_max` | `temp_high_f` |
| `temperature_2m_min` | `temp_low_f` |
| `precipitation_sum` | `precip_in` |
| `uv_index_max` | `uv_index` |
| `wind_speed_10m_max` | `wind_max_mph` |
| `sunshine_duration` (seconds) | `sunshine_hours` (seconds / 3600, rounded to 2 places) |

Everything else in the response (elevation, generation time, units block, and so on) stays only in the raw file. Open-Meteo snaps coordinates to its model grid, so each returned location is matched to the nearest configured destination (within 0.5 degrees). Locations that match no destination are skipped.

## history.csv columns

One row per (`date`, `item_id`, `source`), sorted by date then `item_id`. An empty cell means the value was missing.

| Column | Meaning | Unit / format |
|---|---|---|
| `date` | Day the weather is for (UTC) | `YYYY-MM-DD` |
| `item_id` | Stable destination id, e.g. `amalfi` | text |
| `item` | Destination display name, e.g. `Amalfi Coast` | text |
| `source` | Where the row came from | text (`open-meteo`) |
| `country` | Country of the destination | text |
| `region` | Europe, Asia, Caribbean, Middle East, North America or Oceania | text |
| `vibe` | `beach` or `city` | text |
| `temp_high_f` | Daily maximum air temperature at 2 m | °F |
| `temp_low_f` | Daily minimum air temperature at 2 m | °F |
| `precip_in` | Total precipitation for the day | inches |
| `uv_index` | Daily maximum UV index | unitless index |
| `wind_max_mph` | Daily maximum wind speed at 10 m | mph |
| `sunshine_hours` | Sunshine duration for the day | hours |

## The move rule

A "move" is the change in a destination's daily high (`temp_high_f`) from its previous recorded value to its latest. For the latest date:

1. Each destination's *previous* value is its most recent earlier date that has a high recorded, so a missed day doesn't break the comparison.
2. `change = new high - previous high`, rounded to 2 decimals.
3. Destinations with no value today, no earlier value, or a change of 0 are left out.
4. The rest are ranked by the absolute size of the change (rises and drops count equally), ties broken by `item_id`, and the top 5 are shown.

The Python implementation is `tracker/moves.py` (used for the daily Issue); `app.js` applies the same rule on the site.

## Rebuild the history from the raw files

`data/history.csv` is derived data. To regenerate it from `data/raw/` and `config/destinations.json` without touching the network:

```
python -m tracker rebuild
```

It prints `history.csv rebuilt: N rows`. If the same date, destination and source appears in more than one raw file, the later file wins. A raw file that can't be parsed is skipped with a message on stderr.

Other commands: `python -m tracker run` fetches today's data, rebuilds the history and writes `status.json`; `python -m tracker issue` opens or updates the daily Issue (needs `GITHUB_TOKEN`; add `--dry-run` to preview).

## Run the tests

```
pip install -r requirements-dev.txt
python -m pytest
```

Run both from the repository root. The same command runs on every push in GitHub Actions (badge at the top).

## View the site locally

Serve the folder (opening the HTML files straight from disk won't load the data):

```
python -m http.server
```

Then open `http://localhost:8000/`.
