"""Data sources. Each source is a function (destinations) -> raw response bytes.

To add a source: write a fetch function, register it in SOURCES, and add a
parser for it in build.py (PARSERS).
"""
import urllib.parse
import urllib.request

OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"
DAILY_VARS = [
    "temperature_2m_max", "temperature_2m_min", "precipitation_sum",
    "uv_index_max", "wind_speed_10m_max", "sunshine_duration",
]


def fetch_open_meteo(destinations):
    params = {
        "latitude": ",".join(str(d["lat"]) for d in destinations),
        "longitude": ",".join(str(d["lon"]) for d in destinations),
        "daily": ",".join(DAILY_VARS),
        "temperature_unit": "fahrenheit",
        "precipitation_unit": "inch",
        "wind_speed_unit": "mph",
        "timezone": "UTC",
        "forecast_days": 1,
    }
    url = OPEN_METEO_URL + "?" + urllib.parse.urlencode(params, safe=",")
    req = urllib.request.Request(url, headers={"User-Agent": "data-tracker-class-project"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read()


SOURCES = {"open-meteo": fetch_open_meteo}
