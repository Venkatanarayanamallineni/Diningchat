"""
Saves ISU Dining hours and menus as JSON in docs/data/.
GitHub Actions runs this every 2 hours, so the site never calls ISU directly.

    python snapshot.py
"""

import json
import os
import re
import sys
import time
from datetime import timedelta

import requests

import isu_dining
from isu_dining import VENUES, ApiChanged, get_hours, get_menu, now_ames

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "docs", "data")
MENU_DAYS = 7
FMT = 3  # bump when the menu item format changes, so old files get rebuilt


def read_json(path, default):
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def write_json(path, data):
    with open(path, "w") as f:
        json.dump(data, f, separators=(",", ":"))


def main():
    os.makedirs(OUT, exist_ok=True)
    today = now_ames().date()
    old_meta = read_json(os.path.join(OUT, "meta.json"), {})

    problems = []  # ISU changed its response shape. Old data is kept, then the run fails so GitHub emails you.
    hours = {}
    for i in range(MENU_DAYS + 1):
        day = today + timedelta(days=i)
        key = day.isoformat()
        try:
            hours[key] = {str(v): w for v, w in get_hours(day).items()}
        except (requests.RequestException, ApiChanged) as e:
            print(f"hours {key}: failed ({e}), keeping last copy")
            if isinstance(e, ApiChanged):
                problems.append(str(e))
            if key in old_meta.get("hours", {}):
                hours[key] = old_meta["hours"][key]

    # Today and tomorrow refresh every run. Later days only when missing, empty, or old format.
    for i in range(MENU_DAYS):
        day = today + timedelta(days=i)
        key = day.isoformat()
        path = os.path.join(OUT, f"menu-{key}.json")
        old = read_json(path, {})
        old_items = old.get("items", [])
        if i >= 2 and old_items and old.get("fmt") == FMT:
            continue
        items = []
        for vid in map(int, hours.get(key, {})):
            try:
                items += get_menu(vid, day)
            except (requests.RequestException, ApiChanged) as e:
                # future days are often just not posted yet, so only today counts as a real problem
                if isinstance(e, ApiChanged) and i == 0:
                    problems.append(str(e))
                items += [x for x in old_items if x["v"] == vid]
        if items or not old_items:
            write_json(path, {"date": key, "fmt": FMT, "items": items})
            print(f"menu {key}: {len(items)} items")
        if i == 0 and len(hours.get(key, {})) >= 5 and not items:
            problems.append(f"menu {key}: {len(hours[key])} venues open but 0 items")
        if i == 0 and items and not any(x.get("k") for x in items):
            problems.append(f"menu {key}: no item has calories, nutrient names may have changed")

    for name in os.listdir(OUT):
        if name.startswith("menu-") and name[5:15] < today.isoformat():
            os.remove(os.path.join(OUT, name))

    print("meal fields seen:", sorted(isu_dining.MEAL_FIELDS))

    # Every word that shows up on a menu this week. The site uses it to tell
    # food words apart from normal words and to fix typos.
    words, tagged, total = set(), 0, 0
    for i in range(MENU_DAYS):
        key = (today + timedelta(days=i)).isoformat()
        for it in read_json(os.path.join(OUT, f"menu-{key}.json"), {}).get("items", []):
            text = re.sub(r"[^a-z0-9 ]", " ", f"{it['n']} {it['c']}".lower().replace("'", ""))
            words.update(w for w in text.split() if len(w) > 2 and not w.isdigit())
            total += 1
            tagged += "vegan" in it.get("d", [])

    # If nearly everything says vegan, the label is page noise, not real data.
    diet_labels = 0 < tagged < 0.6 * max(total, 1)

    write_json(
        os.path.join(OUT, "meta.json"),
        {
            "generated_at": now_ames().strftime("%a %b %d, %I:%M %p"),
            "venues": {str(k): v for k, v in VENUES.items()},
            "hours": hours,
            "words": sorted(words),
            "ts": int(time.time()),
            "diet_labels": diet_labels,
        },
    )

    if problems:
        print("\nISU Dining API looks different. Last good data was kept.")
        print("\n".join(f"  - {p}" for p in problems))
        sys.exit(1)


if __name__ == "__main__":
    main()
