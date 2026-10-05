# Dining Now

Unofficial ISU dining guide. Free, no login, works on any phone.

**Live:**  https://venkatanarayanamallineni.github.io/Diningchat/

## Features

- What's open right now, and what closes soon
- Hours and full menus for every dining location, 7 days ahead
- Search a food and see where and which day it's served
- Build a meal: set calories, protein, and allergens to avoid. Totals come from ISU's nutrition data

## How it works

ISU Dining's API can't be called from a browser, so a GitHub Action runs `snapshot.py` every 2 hours and saves hours and menus as JSON in `docs/data/`. The site is plain HTML and JavaScript on GitHub Pages and only reads those files. No server, no API keys, no cost.

## Run locally

```
pip install -r requirements.txt
python snapshot.py
cd docs
python -m http.server 8000
```

Open http://localhost:8000

## Disclaimer

Not affiliated with Iowa State University or ISU Dining. Data comes from ISU Dining and may be up to 2 hours old. Always confirm allergens with dining staff.
