"""Usage:
  python -m tracker run       fetch today's data, rebuild history, write status
  python -m tracker rebuild   rebuild data/history.csv from the raw files only
  python -m tracker issue     open/update today's GitHub Issue (needs GITHUB_TOKEN)
"""
import sys

from .build import build_history
from .pipeline import run


def main(argv):
    cmd = argv[1] if len(argv) > 1 else "run"
    if cmd == "run":
        run()
    elif cmd == "rebuild":
        rows = build_history()
        print(f"history.csv rebuilt: {len(rows)} rows")
    elif cmd == "issue":
        from .issue import main as issue_main
        return issue_main(argv[2:])
    else:
        print(__doc__)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
