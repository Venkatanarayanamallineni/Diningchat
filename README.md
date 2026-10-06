# Dining Now

Unofficial ISU dining guide. Free, no login, works on any phone.

**Live:** https://venkatanarayanamallineni.github.io/Diningchat/

## Features

- What's open right now, and what closes soon
- Hours and full menus for every dining location, 7 days ahead
- Search a food and see where and which day it's served
- Ask by cuisine or style: Indian, Chinese, Mexican, Italian, cheesy, spicy and more
- Ask for one meal at a place: "dinner at udm" shows only dinner
- Build a meal: set calories, protein, and allergens to avoid. Totals come from ISU's nutrition data

## Use it

- **Phone:** open the link, then Share > Add to Home Screen (iPhone) or menu > Install app (Android). Works offline with the last saved data.
- **Laptop:** open the link, or click the install icon in the address bar.
- **Browser extension:** load the `extension/` folder (see below).
- **Share an answer:** links like `?q=high protein dinner` open straight to that answer.

## How it works

```
ISU Dining API ──> snapshot.py (GitHub Action, every 2 hrs) ──> docs/data/*.json ──> GitHub Pages ──> your phone
```

ISU Dining's API can't be called from a browser, so a GitHub Action runs `snapshot.py` every 2 hours and saves hours and menus as JSON in `docs/data/`. The site is plain HTML and JavaScript and only reads those files. No server, no API keys, no cost. ISU gets the same small load no matter how many people use it.

If ISU changes how its API looks, `snapshot.py` keeps the last good data and the Action fails, so GitHub emails you.

## Why no AI

- Free forever. An AI model costs money per question.
- Answers come straight from ISU's data, so it can't make up a dish or an allergen.
- Fast and works offline.

The chat is plain rules: it picks out the place, day, meal, calories, protein, allergens and food words from your question.

## Known limits

- Odd phrasing can get "not sure". The suggestion chips help.
- Cuisine search matches dish names. ISU doesn't label cuisines, so some dishes get missed.
- No halal or kosher filter. ISU's labels for those look wrong in the data, so the app says so instead of guessing.
- Allergen tags are worked out from ingredient text. Always confirm with staff.
- Data can be up to 2 hours old.

## Run locally

```
pip install -r requirements.txt
python snapshot.py
cd docs
python -m http.server 8000
```

On Windows use `py` instead of `python`.

Open http://localhost:8000

## Browser extension

`extension/` is a small popup that shows the site. Change the link in `popup.html` to your Pages URL.
- Try it: `chrome://extensions` > Developer mode > Load unpacked > pick `extension/`
- Publish: Edge Add-ons and Firefox Add-ons are free. Chrome Web Store has a one-time $5 fee.

## Tests

`node tests/run.js` asks 48 real questions against fixed sample data (`tests/fixture.json`) and checks the answers. GitHub runs it before every deploy, so a change that breaks answers never goes live. When you find a wrong answer, add it to `CASES` in `tests/run.js`.

Python is checked with `ruff check .` (settings in `ruff.toml`).

## Settings to fill in (top of the script in `docs/index.html`)

- `FEEDBACK_FORM`: Google Form link (see below)
- `GOATCOUNTER`: your GoatCounter count URL, e.g. `https://yourname.goatcounter.com/count`. Only counts question types, never the text

Venue payment types and map locations are in `VENUE_INFO` at the top of `docs/app.js`. Fix anything wrong there.

## Feedback button

Make a Google Form with one paragraph question. Best: get a prefilled link with the word `QUESTION` in that field (Form menu ⋮ > Get pre-filled link) and paste it into `FEEDBACK_FORM` in `docs/index.html`, so the question fills in by itself. A short `forms.gle` link also works: the app copies the question and the user pastes it.

## Disclaimer

Not affiliated with Iowa State University or ISU Dining. Data comes from ISU Dining and may be up to 2 hours old. Always confirm allergens with dining staff.
