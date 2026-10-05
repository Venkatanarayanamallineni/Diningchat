"""Small client for the public ISU Dining API (hours and menus)."""

from datetime import date, datetime
from zoneinfo import ZoneInfo

import requests

BASE_URL = "https://dining.iastate.edu/api"
TIMEOUT = 30
AMES_TZ = ZoneInfo("America/Chicago")

VENUES = {
    30: "Friley Windows",
    23: "Richardson Court Marketplace",
    60: "South Side Eats",
    39: "Union Drive Marketplace",
    38: "Clyde's",
    8: "Hawthorn",
    22: "Heaping Plato",
    19: "Lance and Ellie's",
    11: "Memorial Union Food Court",
    1: "Conversations",
    59: "East Side Market Express",
    20: "Lance and Ellie's Express",
    57: "West Side Market Express",
    55: "Whirlybird's Express",
    48: "Bookends Cafe",
    49: "Business Cafe",
    10: "Charging Station",
    50: "Courtyard Cafe",
    51: "Design Cafe",
    52: "Gentle Doctor Cafe",
    21: "The Roasterie",
    54: "Whirlybird's",
    58: "East Side Market",
    56: "West Side Market",
}

session = requests.Session()
session.headers["User-Agent"] = "Mozilla/5.0"


def now_ames() -> datetime:
    return datetime.now(AMES_TZ).replace(tzinfo=None)


def _hhmm(value):
    if value is None:
        return None
    h, m = divmod(int(value), 100)
    return f"{h:02d}:{m:02d}" if 0 <= h <= 23 and 0 <= m <= 59 else None


def get_hours(day: date) -> dict:
    """{venue_id: [{"s": "HH:MM", "e": "HH:MM", "all_day": bool, "note": str}]} for open venues."""
    res = session.get(f"{BASE_URL}/dining/hours", timeout=TIMEOUT, params={
        "locs": ",".join(map(str, VENUES)), "date": day.isoformat(), "days": "1"})
    res.raise_for_status()
    out = {}
    for vid_s, loc in (res.json().get("locs") or {}).items():
        windows = []
        for e in (loc.get("days") or {}).get(day.isoformat(), []):
            if e.get("all_day"):
                windows.append({"s": None, "e": None, "all_day": True, "note": e.get("comment")})
                continue
            s, en = _hhmm(e.get("starthours")), _hhmm(e.get("endhours"))
            if s and en:
                windows.append({"s": s, "e": en, "all_day": False, "note": e.get("comment")})
        if windows:
            out[int(vid_s)] = windows
    return out


def _nutrients(item: dict) -> dict:
    out = {}
    for n in (item.get("nutrients") or {}).values():
        try:
            val = float(str((n or {}).get("quantity")).replace(",", ""))
        except ValueError:
            continue
        for key in ((n or {}).get("short_name"), (n or {}).get("name")):
            if key:
                out[key.strip().lower()] = val
    return out


def _pick(nut: dict, names, partial=None):
    for k in names:
        if k in nut:
            return round(nut[k], 1)
    if partial:
        for k, v in nut.items():
            if partial in k:
                return round(v, 1)
    return None


def _allergens(ingredients):
    if not ingredients:
        return None
    i = ingredients.lower().find("contains")
    if i < 0:
        return None
    rest = ingredients[i + len("contains"):].strip()
    return rest.split(".")[0].strip() or None


def get_menu(venue_id: int, day: date) -> list:
    """Flat list of menu items for one venue and day, section headers removed."""
    res = session.get(f"{BASE_URL}/venue/{venue_id}/menu/{day.isoformat()}", timeout=TIMEOUT)
    res.raise_for_status()
    items, seen = [], {}
    for meal_key, meal in (res.json().get("meals") or {}).items():
        meal_name = str(meal.get("name") or meal_key).strip()
        for display in (meal.get("menu_displays") or {}).values():
            for group_name, group in (display.get("categories") or {}).items():
                for item in ((group or {}).get("items") or {}).values():
                    name = (item.get("name") or "").strip()
                    if not name or name.startswith("--"):
                        continue
                    category = (item.get("category_display_name") or group_name or "Other").strip()
                    if (name, category) in seen:
                        meals = seen[(name, category)]["m"]
                        if meal_name not in meals:
                            meals.append(meal_name)
                        continue
                    nut = _nutrients(item)
                    ingredients = item.get("ingredients")
                    entry = {
                        "v": venue_id, "n": name, "c": category, "m": [meal_name],
                        "k": _pick(nut, ("kcal", "calories"), "calor"),
                        "p": _pick(nut, ("protein",)),
                        "f": _pick(nut, ("fat", "total fat")),
                        "cb": _pick(nut, ("carbs", "carbohydrate", "total carbohydrate"), "carb"),
                        "a": _allergens(ingredients),
                        "ing": ingredients,
                    }
                    seen[(name, category)] = entry
                    items.append(entry)
    return items
