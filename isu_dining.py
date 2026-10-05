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


# Allergen tags are worked out here once, so the site never downloads
# the long ingredient text. Broad on purpose: a false "contains" is safer
# than a missed allergen.
ALLERGEN_TERMS = {
    "dairy": ["milk", "whey", "casein", "butter", "cream", "cheese", "yogurt"],
    "gluten": ["wheat", "barley", "rye", "gluten"],
    "egg": ["egg"],
    "soy": ["soy"],
    "peanut": ["peanut"],
    "treenut": ["tree nut", "almond", "cashew", "pecan", "walnut", "hazelnut", "pistachio", "macadamia"],
    "fish": ["fish", "salmon", "tuna", "cod", "tilapia", "pollock", "anchov"],
    "shellfish": ["shellfish", "shrimp", "crab", "lobster", "clam", "scallop", "oyster"],
    "sesame": ["sesame", "tahini"],
}
MEAT = ["chicken", "beef", "pork", "bacon", "sausage", "turkey", "ham", "pepperoni", "steak", "fish", "tuna",
        "salmon", "shrimp", "meat", "brisket", "gyro", "chorizo", "salami", "anchov", "gelatin", "meatball",
        "cod", "tilapia", "pollock", "crab", "lobster"]


def _allergen_tags(allergens, ingredients):
    text = f"{allergens or ''} {ingredients or ''}".lower().replace("gluten free", "").replace("gluten-free", "")
    return [tag for tag, terms in ALLERGEN_TERMS.items() if any(t in text for t in terms)]


def _diet_tags(item):
    """ISU marks some items with diet icons. The field name isn't documented,
    so look through the item's extra fields for the labels themselves."""
    found = set()

    def walk(x):
        if isinstance(x, dict):
            for k, v in x.items():
                if k not in ("nutrients", "ingredients", "name"):
                    walk(k)
                    walk(v)
        elif isinstance(x, list):
            for v in x:
                walk(v)
        elif isinstance(x, str):
            s = x.lower()
            if "vegan" in s:
                found.add("vegan")
            if "vegetarian" in s:
                found.add("vegetarian")
            if "halal" in s:
                found.add("halal")

    walk(item)
    return sorted(found)


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
                    allergens = _allergens(ingredients)
                    entry = {
                        "v": venue_id, "n": name, "c": category, "m": [meal_name],
                        "k": _pick(nut, ("kcal", "calories"), "calor"),
                        "p": _pick(nut, ("protein",)),
                        "f": _pick(nut, ("fat", "total fat")),
                        "cb": _pick(nut, ("carbs", "carbohydrate", "total carbohydrate"), "carb"),
                        "a": allergens,
                    }
                    tags = _allergen_tags(allergens, ingredients)
                    if tags:
                        entry["t"] = tags
                    if not allergens and not ingredients:
                        entry["u"] = 1  # no allergen info at all
                    if any(w in f"{name} {ingredients or ''}".lower() for w in MEAT):
                        entry["mt"] = 1
                    diet = _diet_tags(item)
                    if diet:
                        entry["d"] = diet
                    entry = {k: v for k, v in entry.items() if v is not None}  # smaller files
                    seen[(name, category)] = entry
                    items.append(entry)
    return items
