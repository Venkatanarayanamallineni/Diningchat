// Dining Now: everything that understands a question and builds the answer.
// No DOM here, so tests/run.js can load this file in Node.
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let META = null;
const MENUS = {};
const DAYS = 7;

// pay: center = dining center (meal swipe entry), getgo = GET & Go (swipe on some plans, or Dining Dollars),
// retail = Dining Dollars or Flex Meal. No pay or no lat/lng = not confirmed yet, so we don't guess.
const VENUE_INFO = {
  30: {pay: 'center', lat: 42.02417, lng: -93.65023},   // Friley Windows
  23: {pay: 'center', lat: 42.02381, lng: -93.63825},   // Richardson Court Marketplace (Seasons)
  39: {pay: 'center', lat: 42.02496, lng: -93.65136},   // Union Drive Marketplace, UDCC
  1: {pay: 'getgo', lat: 42.02511, lng: -93.64033},     // Conversations, Oak-Elm
  58: {pay: 'getgo', lat: 42.02394, lng: -93.63825},    // East Side Market, MWL Commons
  56: {pay: 'getgo', lat: 42.02496, lng: -93.65136},    // West Side Market, UDCC
  54: {pay: 'getgo', lat: 42.02515, lng: -93.65378},    // Whirlybird's, State Gym
  38: {pay: 'retail', lat: 42.02496, lng: -93.65136},   // Clyde's, UDCC
  8: {pay: 'retail', lat: 42.03383, lng: -93.64283},    // Hawthorn, Frederiksen Court
  11: {pay: 'retail', lat: 42.02319, lng: -93.64560},   // Memorial Union Food Court
  19: {pay: 'retail', lat: 42.02351, lng: -93.64564},   // Lance and Ellie's, MU
  21: {pay: 'retail', lat: 42.02717, lng: -93.64844},   // The Roasterie
  22: {pay: 'retail', lat: 42.02717, lng: -93.64844},   // Heaping Plato
  48: {pay: 'retail', lat: 42.02813, lng: -93.64881},   // Bookends, Parks Library
  49: {pay: 'retail', lat: 42.02509, lng: -93.64469},   // Business Cafe, Gerdin
  50: {pay: 'retail', lat: 42.02991, lng: -93.64561},   // Courtyard Cafe, Lagomarcino
  51: {pay: 'retail', lat: 42.02844, lng: -93.65317},   // Design Cafe
  52: {pay: 'retail'},                                  // Gentle Doctor Cafe, Vet Med (location not set)
  10: {pay: 'retail'},                                  // Charging Station (location not set)
  60: {lat: 42.01392, lng: -93.65078},                  // South Side Eats (payment not confirmed)
};
const PAY_LABEL = {center: 'Dining center · meal swipe', getgo: 'GET & Go · swipe or Dining Dollars', retail: 'Dining Dollars or Flex Meal'};
const payTag = vid => VENUE_INFO[vid]?.pay ? `<div class="pay">${PAY_LABEL[VENUE_INFO[vid].pay]}</div>` : '';

let POS = null;  // {lat, lng} once the user shares location
function setPosition(p) { POS = p; }
function walkMin(vid) {
  const v = VENUE_INFO[vid];
  if (!POS || !v || v.lat == null) return null;
  const r = 6371000, rad = x => x * Math.PI / 180;
  const dLat = rad(v.lat - POS.lat), dLng = rad(v.lng - POS.lng);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(POS.lat)) * Math.cos(rad(v.lat)) * Math.sin(dLng / 2) ** 2;
  const meters = 2 * r * Math.asin(Math.sqrt(a));
  return Math.max(1, Math.round(meters * 1.25 / 80));  // paths aren't straight; ~80 m per minute
}
const CAMPUS = {lat: 42.0267, lng: -93.6465};
function farFromCampus(p) {
  const dLat = (p.lat - CAMPUS.lat) * 111000, dLng = (p.lng - CAMPUS.lng) * 82000;
  return Math.hypot(dLat, dLng) > 5000;
}
const walkTag = vid => { const m = walkMin(vid); return m == null ? '' : ` <span class="walk">${m} min walk</span>`; };

// Saved preferences: {diet: 'vegetarian'|'vegan'|'', avoid: ['Dairy', ...], protein: 40, kcal: 700}
let PREFS = {};
function setPrefs(p) { PREFS = p || {}; }
function prefsText(p = PREFS) {
  return [p.diet, ...(p.avoid || []).map(a => `no ${a.toLowerCase()}`), p.protein ? `${p.protein}g+ protein` : '', p.kcal ? `under ${p.kcal} kcal` : '']
    .filter(Boolean).join(', ');
}
function setMeta(m) { META = m; buildAliases(); buildVocab(); }

// ---------- time (Ames) ----------
function ames() {
  if (globalThis.FAKE_NOW) return globalThis.FAKE_NOW;  // tests pin the clock
  const p = new Intl.DateTimeFormat('en-CA', {timeZone: 'America/Chicago', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).formatToParts(new Date());
  const g = t => p.find(x => x.type === t).value;
  return {date: `${g('year')}-${g('month')}-${g('day')}`, mins: (+g('hour')) * 60 + (+g('minute'))};
}
const addDays = (s, n) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const toMin = hm => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };
const fmt = hm => { let [h, m] = hm.split(':').map(Number); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return m ? `${h}:${String(m).padStart(2, '0')} ${ap}` : `${h} ${ap}`; };
const weekday = d => new Date(d + 'T12:00:00Z').getUTCDay();
function dayLabel(d) {
  const t = ames().date;
  if (d === t) return 'today';
  if (d === addDays(t, 1)) return 'tomorrow';
  return new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', {weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC'});
}
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const vname = id => META.venues[id] || id;
const VIDS = () => Object.keys(META.venues);
const windows = (date, vid) => (META.hours[date] || {})[vid] || [];
const hoursText = (date, vid) => {
  const w = windows(date, vid);
  if (!w.length) return 'Closed';
  return w.map(x => x.all_day ? 'Open all day' : `${fmt(x.s)}–${fmt(x.e)}${x.note ? ` (${x.note})` : ''}`).join(', ');
};
async function menu(date) {
  if (!(date in MENUS)) {
    try { const r = await fetch(`data/menu-${date}.json`); MENUS[date] = r.ok ? (await r.json()).items : []; }
    catch { MENUS[date] = []; }
  }
  return MENUS[date];
}

function statusNow(vid) {
  const {date, mins} = ames();
  for (const w of windows(date, vid)) {
    if (w.all_day) return {state: 'open', allDay: true};
    const s = toMin(w.s), e = toMin(w.e);
    if (s <= mins && mins <= e) return {state: 'open', end: w.e, left: e - mins};
    if (s > mins) return {state: 'later', start: w.s};
  }
  for (let i = 1; i <= DAYS; i++) {
    const d = addDays(date, i), w = windows(d, vid)[0];
    if (w) return {state: 'closed', nextDay: d, start: w.all_day ? null : w.s};
  }
  return {state: 'closed'};
}
function statusBadge(st) {
  if (st.state === 'open') return st.allDay ? '<span class="badge b-ok">open all day</span>'
    : st.left <= 45 ? `<span class="badge b-warn">closes in ${st.left} min</span>` : `<span class="badge b-ok">open till ${fmt(st.end)}</span>`;
  if (st.state === 'later') return `<span class="badge b-off">opens ${fmt(st.start)}</span>`;
  return st.nextDay ? `<span class="badge b-off">${dayLabel(st.nextDay)}${st.start ? ' ' + fmt(st.start) : ''}</span>` : '<span class="badge b-off">closed</span>';
}

// ---------- understanding the question ----------
const norm = s => s.toLowerCase().replace(/[’'`]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9<>]+/g, ' ').trim();
const ALIASES = {
  'udm': 39, 'union drive': 39, 'union dr': 39, 'mu': 11, 'memorial union': 11, 'food court': 11, 'mufc': 11,
  'plato': 22, 'roasterie': 21, 'roast': 21, 'bookends': 48, 'business cafe': 49, 'design cafe': 51,
  'gentle doctor': 52, 'gentle doc': 52, 'convos': 1, 'conversations': 1, 'friley': 30, 'rcm': 23, 'richardson': 23,
  'south side': 60, 'sse': 60, 'clydes': 38, 'clyde': 38, 'hawthorn': 8, 'l and e': 19, 'lance and ellies': 19,
  'east side express': 59, 'west side express': 57, 'whirlybirds': 54, 'whirlys': 54, 'charging station': 10, 'courtyard': 50,
};
let ALIAS_LIST = [];
function buildAliases() {
  const all = {...ALIASES};
  for (const [id, name] of Object.entries(META.venues)) all[norm(name)] = +id;
  ALIAS_LIST = Object.entries(all).sort((a, b) => b[0].length - a[0].length);
}
const ALLERGEN_WORDS = {Dairy: ['dairy', 'milk', 'lactose', 'cheese'], Gluten: ['gluten', 'wheat'], Egg: ['egg', 'eggs'], Soy: ['soy'],
  Peanut: ['peanut', 'peanuts', 'nut', 'nuts'], 'Tree nuts': ['nut', 'nuts', 'tree nut', 'tree nuts', 'almond', 'almonds'],
  Fish: ['fish'], Shellfish: ['shellfish', 'shrimp'], Sesame: ['sesame']};
const ALLERGEN_TERMS = {Dairy: ['milk', 'whey', 'casein', 'butter', 'cream', 'cheese', 'yogurt', 'lactose', 'ghee'],
  Gluten: ['wheat', 'barley', 'rye', 'semolina', 'durum', 'spelt', 'farro', 'couscous'], Egg: ['egg'], Soy: ['soy'], Peanut: ['peanut'],
  'Tree nuts': ['tree nut', 'almond', 'cashew', 'pecan', 'walnut', 'hazelnut', 'pistachio'],
  Fish: ['fish'], Shellfish: ['shellfish', 'shrimp', 'crab', 'lobster'], Sesame: ['sesame']};
const MEAT = ['chicken', 'beef', 'pork', 'bacon', 'sausage', 'turkey', 'ham', 'pepperoni', 'steak', 'fish', 'tuna', 'salmon',
  'shrimp', 'meat', 'brisket', 'gyro', 'chorizo', 'salami', 'anchov', 'gelatin', 'meatball', 'cod', 'tilapia'];
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MEALS = {breakfast: [420, 630], brunch: [600, 780], lunch: [660, 840], dinner: [990, 1200]};
const STOP = new Set(('a an the i im me my we you your to of in on at for and or is are was be it its there that this what whats ' +
  'where wheres when which who how can could should would will do does did get got have has any some something anything ' +
  'want wanna need like find show give tell please today tonight tomorrow now right open close closes closing closed hours ' +
  'time late latest early earliest soon food eat eating serve serves serving served menu place places spot spots near campus ' +
  'about with without no free avoid allergic allergy under below over less more than least max min most high low calorie calories ' +
  'cal cals kcal protein grams gram meal meals build make plan bowl combo healthy healthiest light lightest good best options option ' +
  'available still also else going lets let up dining hall halls vegetarian vegan veggie meatless day week this next same but ' +
  'hungry craving crave place much many lot near nearest nearby closest around use pay swipe swipes dollars flex plan looking look gonna going trying try thinking think recommend suggest ' +
  'suggestion ideas idea maybe kinda really just good great nice whats\'s anywhere somewhere eat ate grab grabbing go there\'s')
  .split(' '));

// Cuisines and styles. ISU has no cuisine label, so match dish names.
const CUISINES = {
  indian: {label: 'Indian', words: ['indian', 'desi'], re: /curry|tikka|masala|naan|paneer|biryani|\bdal\b|daal|samosa|chana|korma|vindaloo|tandoori|pakora|chutney|saag|aloo|butter chicken/},
  chinese: {label: 'Chinese', words: ['chinese'], re: /lo mein|chow mein|fried rice|orange chicken|kung pao|general tso|egg roll|spring roll|potsticker|dumpling|sweet (and|&) sour|szechuan|sichuan|wonton|mongolian|(beef|chicken) (and|&) broccoli|stir fry|bao\b|chinese/},
  japanese: {label: 'Japanese', words: ['japanese'], re: /sushi|teriyaki|ramen|tempura|katsu|udon|miso|edamame|pok[eé]\b|gyoza|yakisoba|onigiri|bento|japanese/},
  thai: {label: 'Thai', words: ['thai'], re: /pad thai|thai|satay|panang|massaman|tom yum|drunken noodle/},
  korean: {label: 'Korean', words: ['korean'], re: /bulgogi|kimchi|bibimbap|gochujang|korean|japchae/},
  vietnamese: {label: 'Vietnamese', words: ['vietnamese'], re: /\bpho\b|banh mi|vietnamese|vermicelli/},
  mexican: {label: 'Mexican', words: ['mexican', 'tex mex', 'latin', 'latino'], re: /taco|burrito|quesadilla|enchilada|nacho|guac|fajita|tamale|carnitas|chorizo|elote|churro|pico de gallo|queso|al pastor|barbacoa|carne asada|mexican|refried|chimichanga|tortilla chip/},
  italian: {label: 'Italian', words: ['italian'], re: /pasta|pizza|alfredo|marinara|lasagna|ravioli|penne|spaghetti|meatball|parmesan|parmigiana|calzone|risotto|bruschetta|tortellini|rigatoni|fettuccine|pesto|gnocchi|ziti|stromboli|garlic bread|italian/},
  mediterranean: {label: 'Mediterranean', words: ['mediterranean', 'greek', 'middle eastern', 'arabic', 'arab'], re: /gyro|falafel|hummus|tzatziki|pita|feta|shawarma|kabob|kebab|tabbouleh|greek|mediterranean|couscous|kofta|halloumi|turmeric rice/},
  american: {label: 'American comfort', words: ['american', 'comfort', 'comfort food'], re: /burger|fries|hot dog|mac (and|&) cheese|bbq|barbecue|wings|tenders|meatloaf|pot roast|grilled cheese|sloppy joe|fried chicken|mashed potato|cornbread|pulled pork|corn dog/},
  cheesy: {label: 'Cheesy', words: ['cheesy', 'cheesey'], nameOnly: true, re: /chees|queso|quesadilla|alfredo|pizza|parm|mozzarella|cheddar|nacho/,
    // plain cheese slices are toppings, not dishes
    not: /^(white |yellow |sharp |shredded |sliced |vegan )?(american|cheddar|colby jack|gouda|swiss|pepper jack|provolone|mozzarella|feta|parmesan|blue|cotija|queso fresco|cheese)( cheese)?( slices?)?$/},
  spicy: {label: 'Spicy', words: ['spicy', 'spice', 'hot and spicy'], nameOnly: true, re: /spicy|buffalo|jalape|sriracha|chipotle|cajun|szechuan|sichuan|habanero|nashville|ghost pepper|gochujang|vindaloo|diablo|firecracker|kung pao|harissa|peri peri|hot chicken/},
};
CUISINES.asian = {label: 'Asian', words: ['asian'], re: new RegExp(['chinese', 'japanese', 'thai', 'korean', 'vietnamese'].map(k => CUISINES[k].re.source).join('|'))};
const CUISINE_SKIP = /condiment|topping|spread|dressing|sauce|toss in|cheese options|beverage|upgrade/i;
const cuisineHit = (C, it) => !CUISINE_SKIP.test(it.c) && !/\b(sauce|dressing|glaze)$/i.test(it.n)
  && C.re.test((C.nameOnly ? it.n : `${it.n} ${it.c}`).toLowerCase()) && !(C.not && C.not.test(it.n.toLowerCase()));
function detectCuisine(t) {
  for (const [key, c] of Object.entries(CUISINES)) if (c.words.some(w => t.includes(` ${w} `))) return key;
  return null;
}

let VOCAB = new Set(), KEYWORDS = [];
function buildVocab() {
  VOCAB = new Set(META.words || []);
  KEYWORDS = ['tomorrow', 'today', 'tonight', 'breakfast', 'lunch', 'dinner', 'brunch', ...WEEKDAYS, 'protein', 'calories',
    'calorie', 'vegetarian', 'vegan', 'open', 'closed', 'hours', 'dairy', 'gluten', 'healthy', 'build', 'bowl',
    ...new Set(ALIAS_LIST.flatMap(([a]) => a.split(' ')).filter(w => w.length > 3)),
    ...Object.values(GROUPS).flatMap(g => [...g.words, ...g.subs.flatMap(sb => sb[2])]).filter(w => !w.includes(' ')),
    ...Object.values(CUISINES).flatMap(c => c.words).filter(w => !w.includes(' '))];
}
function lev(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 9;
  let prev = [...Array(b.length + 1).keys()];
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
function fixWord(w) {
  if (w.length < 4 || /\d/.test(w) || STOP.has(w) || VOCAB.has(w) || KEYWORDS.includes(w)) return w;
  const x = w.replace(/(.)\1{2,}/g, '$1$1');  // tommorrrow -> tommorrow
  const near = (list, max) => { let best = null, d = max + 1; for (const k of list) { const e = lev(x, k); if (e < d) { d = e; best = k; } } return best; };
  return near(KEYWORDS, x.length >= 6 ? 2 : 1) || (x.length >= 5 ? near(VOCAB, x.length >= 8 ? 2 : 1) : null) || x;
}

function parse(text) {
  const fixed = norm(text).split(' ').map(fixWord).join(' ');
  const t = ' ' + fixed + ' ';
  const q = {raw: text, t, corrected: fixed !== norm(text) ? fixed : null};
  for (const [alias, id] of ALIAS_LIST) if (t.includes(` ${alias} `)) { q.venue = String(id); q.venueWords = alias.split(' '); break; }

  const today = ames().date;
  if (/ tomorrow /.test(t)) q.day = addDays(today, 1);
  else if (/ (today|tonight|now) /.test(t)) q.day = today;
  else WEEKDAYS.forEach((w, i) => { if (!q.day && t.includes(` ${w} `)) q.day = addDays(today, (i - weekday(today) + 7) % 7); });
  q.dayExplicit = !!q.day;
  q.day = q.day || today;
  for (const m of Object.keys(MEALS)) if (t.includes(` ${m} `)) q.meal = m;

  let m;
  if ((m = t.match(/(\d{1,3})\s*(?:g|gm|gms|grams?)?\s*(?:of\s+)?protein/)) || (m = t.match(/protein\s*(?:of|over|above|at least|min|>)?\s*(\d{1,3})/))) q.minP = +m[1];
  if ((m = t.match(/(?:under|below|less than|max|maximum|upto|up to|<|within|around|about)\s*(\d{3,4})/))) q.maxK = +m[1];
  else if ((m = t.match(/(\d{3,4})\s*(?:[a-z]{1,3}\s*)?(?:k?cals?|kcals?|calories|calorie)\b/))) q.maxK = +m[1];
  else { // a bare 200-2500 number next to a protein goal is almost always calories
    const n = (t.match(/\b\d{3,4}\b/g) || []).map(Number).find(x => x >= 200 && x <= 2500 && x !== q.minP);
    if (n) q.maxK = n;
  }

  q.avoid = [];
  for (const [label, words] of Object.entries(ALLERGEN_WORDS)) {
    if (words.some(w => new RegExp(`(no|without|avoid|allergic to|not|zero|cant have|hold the)\\s+(any\\s+)?${w}\\b|\\b${w}\\s*free\\b`).test(t)))
      q.avoid.push(label);
  }
  if (/ (vegan|vegetarian|veggie|meatless|no meat) /.test(t)) q.noMeat = true;
  if (/ vegan /.test(t)) { q.vegan = true; if (!META.diet_labels) for (const a of ['Dairy', 'Egg']) if (!q.avoid.includes(a)) q.avoid.push(a); }

  if (/ (low cal|low calorie|light|lightest|fewest calories|least calories) /.test(t)) q.opt = 'low';
  else if (/ (healthy|healthiest|balanced) /.test(t)) q.opt = 'bal';
  else q.opt = 'protein';

  q.wantPlan = !!(q.maxK || q.minP || / (build|make me|plan|meal|bowl|combo|macros?|healthy|healthiest|protein|low cal|light|lightest) /.test(t));
  q.wantHours = / (open|close|closes|closing|closed|hours|when) /.test(t);
  q.late = / (late|latest|night) /.test(t);
  q.near = / (near|nearest|nearby|closest|close by|around me|near me) /.test(t);
  q.pay = / (swipe|swipes|meal swipe|meal swipes|dining dollars|flex meal|flex meals|meal plan) /.test(t) ? (/ (dining dollars|flex) /.test(t) ? 'dollars' : 'swipe') : null;

  const skip = new Set(q.venueWords || []);
  const allergenWords = Object.values(ALLERGEN_WORDS).flat();
  q.food = t.trim().split(' ').filter(w => w.length > 2 && !STOP.has(w) && !skip.has(w) && !/^\d/.test(w) &&
    !WEEKDAYS.includes(w) && !(w in MEALS) && !allergenWords.includes(w));
  q.unknown = q.food.filter(w => VOCAB.size && !VOCAB.has(w) && !VOCAB.has(w.replace(/e?s$/, '')));
  if (VOCAB.size) q.food = q.food.filter(w => !q.unknown.includes(w));
  return q;
}

// ---------- answering ----------
function allergenStatus(it, avoid) {
  if (!avoid.length) return 'ok';
  if (slim(it)) return it.u ? 'unknown' : avoid.some(a => (it.t || []).includes(TAG[a])) ? 'contains' : 'ok';
  const text = `${it.a || ''} ${it.ing || ''}`.toLowerCase();
  if (!text.trim()) return 'unknown';
  return avoid.some(a => ALLERGEN_TERMS[a].some(term => text.includes(term))) ? 'contains' : 'ok';
}
const TAG = {Dairy: 'dairy', Gluten: 'gluten', Egg: 'egg', Soy: 'soy', Peanut: 'peanut', 'Tree nuts': 'treenut',
  Fish: 'fish', Shellfish: 'shellfish', Sesame: 'sesame'};
const slim = it => !('ing' in it);  // new data format: tags precomputed, no ingredient text
const hasMeat = it => slim(it) ? !!it.mt : MEAT.some(w => `${it.n} ${it.ing || ''}`.toLowerCase().includes(w));
function dietOk(it, o) {
  if (o.vegan && META.diet_labels) return !!(it.d && it.d.includes('vegan'));
  if (o.noMeat) return META.diet_labels && it.d ? it.d.some(x => x === 'vegan' || x === 'vegetarian') : !hasMeat(it);
  return true;
}
const SIDE_CATS = /dessert|cookie|ice cream|condiment|beverage|drink|candy|snack|chips|soda|coffee|tea|shake/i;

const MEAL_RE = {breakfast: /breakfast|brunch/i, brunch: /brunch|breakfast|lunch/i, lunch: /lunch|brunch/i, dinner: /dinner|supper/i};
const BREAKFASTY = /breakfast|pancake|waffle|omelet|french toast|hash brown|oatmeal|cereal|bagel|muffin|scrambl|egg bite/i;
const MEAL_NOTE = {breakfast: /breakfast|brunch/i, brunch: /brunch|breakfast|lunch/i, lunch: /lunch|brunch|continuous/i, dinner: /dinner|supper|continuous/i};
// Hour windows for one meal at a venue: by the window's label first, else by clock time.
function mealWindows(day, v, meal) {
  const ws = windows(day, v);
  const named = ws.filter(w => w.note && MEAL_NOTE[meal].test(w.note));
  if (named.length) return named;
  const [a, b] = MEALS[meal];  // needs 30+ min inside the meal's usual time
  return ws.filter(w => w.all_day || Math.min(toMin(w.e), b) - Math.max(toMin(w.s), a) > 30);
}
const labeledMeals = items => items.some(i => (i.m || []).some(x => /breakfast|brunch|lunch|dinner|supper/i.test(x)));
// Items for one meal. If the venue doesn't label meals, guess from the dish name.
function forMeal(items, meal) {
  if (labeledMeals(items)) return items.filter(i => servedAt(i, meal));
  return items.filter(i => meal === 'breakfast' ? BREAKFASTY.test(`${i.n} ${i.c}`) : servedAt(i, meal));
}
const shortDay = d => cap(dayLabel(d)).split(',')[0];
function mealChips(day, v, skip) {
  const sfx = day === ames().date ? '' : ` ${shortDay(day).toLowerCase()}`;
  return ['breakfast', 'lunch', 'dinner'].filter(m => m !== skip && mealWindows(day, v, m).length)
    .map(m => `${cap(m)} at ${vname(v)}${sfx}`);
}
function servedAt(it, meal) {
  const named = (it.m || []).filter(x => /breakfast|brunch|lunch|dinner|supper/i.test(x));
  if (named.length) return named.some(x => MEAL_RE[meal].test(x));
  if (meal === 'lunch' || meal === 'dinner') return !BREAKFASTY.test(`${it.n} ${it.c}`);
  return true;
}
function mealNow() {
  const m = ames().mins;
  return m < 630 ? 'breakfast' : m < 900 ? 'lunch' : 'dinner';
}

function plan(items, o) {
  let pool = [], exC = 0, exU = 0, exM = 0;
  for (const it of items) {
    if (it.k == null || it.k <= 0) continue;
    if (o.skipSides && SIDE_CATS.test(it.c)) continue;
    if (o.meal && !servedAt(it, o.meal)) continue;
    if (!dietOk(it, o)) { exM++; continue; }
    const s = allergenStatus(it, o.avoid);
    if (s === 'unknown') exU++; else if (s === 'contains') exC++; else pool.push(it);
  }
  const K = c => c.reduce((s, i) => s + (i.k || 0), 0), P = c => c.reduce((s, i) => s + (i.p || 0), 0);
  // protein goal with no calorie limit: reach it with the fewest calories
  const opt = o.minP && !o.maxK && o.opt === 'protein' ? 'low' : o.opt;
  const score = c => opt === 'low' ? -K(c) + 0.5 * P(c) : opt === 'bal' ? P(c) - 0.03 * K(c) : P(c) - 0.001 * K(c);
  const groups = {};
  pool.forEach(i => (groups[i.c] = groups[i.c] || []).push(i));
  const capK = o.maxK || 900, maxItems = o.maxItems || 3;
  let beam = [[]];
  for (const g of Object.values(groups)) {
    const top = g.sort((a, b) => score([b]) - score([a])).slice(0, 6), next = [...beam];
    for (const c of beam) if (c.length < maxItems) for (const it of top) { const n = [...c, it]; if (K(n) <= capK) next.push(n); }
    beam = next.sort((a, b) => score(b) - score(a)).slice(0, 250);
  }
  const minItems = o.maxK || o.minP ? 1 : 2;
  const ok = c => c.length >= minItems && (o.minP == null || P(c) >= o.minP);
  const feas = beam.filter(ok), rest = beam.filter(c => c.length);
  // no combo meets the goal: show the most protein we can get instead
  const best = (feas.length ? feas.sort((a, b) => score(b) - score(a)) : rest.sort((a, b) => P(b) - P(a) || K(a) - K(b)))[0] || [];
  return {best, met: feas.length > 0, k: K(best), p: P(best), s: best.length ? score(best) : -Infinity,
    f: best.some(i => i.f != null) ? best.reduce((s, i) => s + (i.f || 0), 0) : null, exC, exU, exM};
}

function itemRow(it) {
  const nums = [it.k != null ? `${Math.round(it.k)} kcal` : null, it.p != null ? `${it.p}g protein` : null].filter(Boolean).join(' · ');
  return `<div class="item"><div>${esc(it.n)}</div><div class="nums">${nums || 'no nutrition info'}</div>${it.a ? `<div class="allg">Contains: ${esc(it.a)}</div>` : ''}</div>`;
}
const vlink = vid => `<button type="button" class="link" data-venue="${vid}">${esc(vname(vid))}</button>${walkTag(vid)}`;
const rowCard = rows => `<div class="card list">${rows.join('')}</div>`;
const catCard = cats => `<div class="card">${Object.entries(cats).map(([c, list]) =>
  `<details><summary><span>${esc(c)}</span><span class="dim">${list.length}</span></summary>${list.map(itemRow).join('')}</details>`).join('')}</div>`;

function answerOpenNow(q) {
  const ids = VIDS().map(v => ({v, st: statusNow(v)}));
  const open = ids.filter(x => x.st.state === 'open');
  if (!open.length) {
    const later = ids.filter(x => x.st.state === 'later').sort((a, b) => toMin(a.st.start) - toMin(b.st.start));
    if (later.length) return {say: `Nothing open right now. <b>${esc(vname(later[0].v))}</b> opens first at <b>${fmt(later[0].st.start)}</b>.`,
      html: rowCard(later.slice(0, 8).map(x => `<div class="row">${vlink(x.v)}${statusBadge(x.st)}</div>`)), chips: ['Breakfast tomorrow?']};
    const nxt = ids.filter(x => x.st.nextDay).sort((a, b) => (a.st.nextDay + (a.st.start || '')).localeCompare(b.st.nextDay + (b.st.start || '')));
    return {say: 'Everything is closed for today. Opening next:', html: rowCard(nxt.slice(0, 8).map(x => `<div class="row">${vlink(x.v)}${statusBadge(x.st)}</div>`)),
      chips: ['Breakfast tomorrow?']};
  }
  const left = x => x.st.allDay ? 9999 : x.st.left;
  if (q.near && POS) open.sort((a, b) => (walkMin(a.v) ?? 99) - (walkMin(b.v) ?? 99));
  else open.sort((a, b) => q.late ? left(b) - left(a) : left(a) - left(b));
  const closing = open.filter(x => left(x) <= 45);
  let say = `<b>${open.length} places</b> open right now.`;
  if (q.near && POS) say = `Closest open: <b>${esc(vname(open[0].v))}</b>${walkMin(open[0].v) != null ? `, about ${walkMin(open[0].v)} min walk` : ''}.`;
  else if (q.late) say = `Open latest tonight: <b>${esc(vname(open[0].v))}</b>${open[0].st.end ? ` till <b>${fmt(open[0].st.end)}</b>` : ''}.`;
  else if (closing.length) say += ` ${closing.length} close within 45 min.`;
  return {say, html: rowCard(open.map(x => `<div class="row"><span>${vlink(x.v)}</span>${statusBadge(x.st)}</div>`)),
    chips: ['High protein meal under 700 cal', 'What’s open late?']};
}

function answerVenueHours(q) {
  const v = q.venue, n = esc(vname(v)), today = ames().date;
  if (q.dayExplicit && q.day !== today) {
    const h = hoursText(q.day, v);
    return {say: h === 'Closed' ? `<b>${n}</b> is closed ${dayLabel(q.day)}.` : `<b>${n}</b> ${dayLabel(q.day)}: <b>${esc(h)}</b>`,
      chips: [`Menu at ${vname(v)} ${dayLabel(q.day)}`]};
  }
  const st = statusNow(v);
  let say;
  if (st.state === 'open') say = st.allDay ? `<b>${n}</b> is open all day.` : `Yes, <b>${n}</b> is open till <b>${fmt(st.end)}</b>${st.left <= 45 ? ` (${st.left} min left, hurry)` : ''}.`;
  else if (st.state === 'later') say = `<b>${n}</b> isn’t open yet. Opens at <b>${fmt(st.start)}</b> today.`;
  else say = st.nextDay ? `<b>${n}</b> is closed now. Next open <b>${dayLabel(st.nextDay)}${st.start ? ' at ' + fmt(st.start) : ''}</b>.` : `<b>${n}</b> has no hours listed this week.`;
  const full = hoursText(today, v);
  return {say, html: (full !== 'Closed' ? `<div class="card dim">Today: ${esc(full)}${payTag(v)}</div>` : payTag(v)),
    chips: [`What’s at ${vname(v)}?`, `Build a meal at ${vname(v)}`]};
}

async function answerVenueMenu(q) {
  const v = q.venue, n = esc(vname(v));
  let day = q.day;
  const st = statusNow(v);
  if (!q.dayExplicit && st.state === 'closed' && st.nextDay) day = st.nextDay;
  let hrs = hoursText(day, v);
  if (hrs === 'Closed') return {say: `<b>${n}</b> is closed ${dayLabel(day)}.`, chips: [`When is ${vname(v)} open?`]};
  let items = (await menu(day)).filter(i => String(i.v) === v);
  if (!items.length) return {say: `<b>${n}</b> is open ${dayLabel(day)} (${esc(hrs)}) but the menu isn’t posted yet.`};

  // "dinner at udm": only that meal. No meal named: the whole menu, like before.
  let when = dayLabel(day), note = '';
  if (q.meal) {
    const mw = mealWindows(day, v, q.meal);
    when = `${q.meal} ${dayLabel(day)}`.replace('dinner today', 'dinner tonight');
    if (!mw.length) return {say: `<b>${n}</b> doesn’t serve ${q.meal} ${dayLabel(day)}. Hours: ${esc(hrs)}.`,
      chips: [...mealChips(day, v, q.meal), 'What’s open now?']};
    hrs = mw.map(w => w.all_day ? 'all day' : `${fmt(w.s)}–${fmt(w.e)}`).join(', ');
    const only = forMeal(items, q.meal);
    if (!only.length) note = `<div class="note">No items marked for ${q.meal} here, so this is the full menu.</div>`;
    else {
      if (!labeledMeals(items)) note = '<div class="note">Same menu all day here. Best guess for this meal.</div>';
      items = only;
    }
  }
  const chips = [...mealChips(day, v, q.meal).slice(0, 2), `Build a meal at ${vname(v)}`, `Is ${vname(v)} open now?`];
  const cats = {};
  items.forEach(i => (cats[i.c] = cats[i.c] || []).push(i));
  const stem = f => f.replace(/e?s$/, '');
  const wanted = q.food.length ? Object.keys(cats).filter(c => q.food.some(f => norm(c).includes(stem(f)))) : [];
  const byItem = q.food.length ? items.filter(i => q.food.every(f => norm(i.n).includes(stem(f)))) : [];
  if (wanted.length || byItem.length) {
    const list = wanted.length ? wanted.flatMap(c => cats[c]) : byItem;
    return {say: `At <b>${n}</b> ${when} (${esc(hrs)}):`, html: `<div class="card">${list.slice(0, 30).map(itemRow).join('')}</div>` + note, chips};
  }
  if (q.food.length) return {say: `Didn’t see “${esc(q.food.join(' '))}” at <b>${n}</b> ${when}. Here’s what they have:`,
    html: catCard(cats) + note, chips: [`Where can I get ${q.food.join(' ')}?`, ...chips]};
  return {say: `<b>${n}</b> ${when}, ${esc(hrs)}. Tap a section:`, html: catCard(cats) + note, chips};
}

async function answerCuisine(q, key) {
  const C = CUISINES[key], today = ames().date;
  const dates = q.dayExplicit ? [q.day] : [...Array(DAYS).keys()].map(i => addDays(today, i));
  const all = await Promise.all(dates.map(menu));
  const extra = q.food.filter(f => !C.words.includes(f) && !C.re.test(f));  // "indian chicken" also needs "chicken"
  const stem = f => f.replace(/e?s$/, '');
  const collect = useExtra => dates.map((d, i) => {
    const byV = {};
    for (const it of all[i]) {
      if (q.venue && String(it.v) !== q.venue) continue;
      if (!cuisineHit(C, it)) continue;
      if (useExtra && !extra.every(f => norm(it.n).includes(stem(f)))) continue;
      if (q.meal && !servedAt(it, q.meal)) continue;
      if (!dietOk(it, q) || (q.avoid.length && allergenStatus(it, q.avoid) !== 'ok')) continue;
      const list = byV[it.v] = byV[it.v] || [];
      if (!list.some(x => x.n === it.n)) list.push(it);
    }
    return {d, byV};
  }).filter(x => Object.keys(x.byV).length);
  let found = extra.length ? collect(true) : [];
  if (!found.length) found = collect(false);

  const what = `${C.label}${C.nameOnly ? '' : '-style'}`, where = q.venue ? ` at <b>${esc(vname(q.venue))}</b>` : '';
  const meal = q.meal ? ` ${q.meal}` : '';
  if (!found.length) return {say: `No ${what.toLowerCase()} dishes${where}${meal} ${q.dayExplicit ? dayLabel(q.day) : 'on menus this week'}.`,
    html: '<div class="note">I match dish names, so some may be missed. Try a dish name like “curry” or “tacos”.</div>',
    chips: ['What’s open now?', 'Italian', 'Mexican', 'Asian'].filter(c => c.toLowerCase() !== key)};

  const first = found[0], isToday = first.d === today;
  const isOpen = v => isToday && statusNow(v).state === 'open';
  const vs = Object.keys(first.byV).sort((a, b) => isOpen(b) - isOpen(a) || first.byV[b].length - first.byV[a].length);
  const say = isToday ? `${what} dishes${where}${meal} today at <b>${vs.length} place${vs.length > 1 ? 's' : ''}</b>:`
    : `No ${what.toLowerCase()} dishes${where}${meal} ${q.dayExplicit ? dayLabel(q.day) : 'today'}. Next: <b>${dayLabel(first.d) === 'tomorrow' ? 'tomorrow' : shortDay(first.d)}</b>`;
  const cards = vs.slice(0, 4).map(v => `<div class="card"><div class="row">${vlink(v)}${isToday ? statusBadge(statusNow(v)) : ''}</div>
    <div class="dim">${esc(hoursText(first.d, v))}</div>${first.byV[v].slice(0, 5).map(itemRow).join('')}${first.byV[v].length > 5 ? `<div class="note">+${first.byV[v].length - 5} more</div>` : ''}</div>`).join('');
  const later = found.slice(1, 4).map(x => `<b>${shortDay(x.d)}</b>: ${esc(Object.keys(x.byV).map(vname).slice(0, 3).join(', '))}`);
  const html = cards + (later.length ? `<div class="note">Also coming up · ${later.join(' · ')}</div>` : '')
    + '<div class="note">Matched by dish names, not an official ISU label.</div>';
  return {say, html, chips: [...found.slice(1, 3).map(x => `${C.label} ${shortDay(x.d).toLowerCase()}`), `Is ${vname(vs[0])} open now?`, 'What’s open now?']};
}

async function answerFind(q) {
  const today = ames().date;
  const dates = q.dayExplicit ? [q.day] : [...Array(DAYS).keys()].map(i => addDays(today, i));
  const all = await Promise.all(dates.map(menu));
  const stem = f => f.replace(/e?s$/, '');
  const hit = (it, strict) => strict ? q.food.every(f => norm(`${it.n} ${it.c}`).includes(stem(f))) : q.food.some(f => norm(it.n).includes(stem(f)));
  let byVenue = {};
  for (const strict of [true, false]) {
    dates.forEach((d, i) => {
      for (const it of all[i]) {
        if (!hit(it, strict)) continue;
        if (q.meal && !servedAt(it, q.meal)) continue;
        if (!dietOk(it, q)) continue;
        if (q.avoid.length && allergenStatus(it, q.avoid) !== 'ok') continue;
        const b = byVenue[it.v] = byVenue[it.v] || {date: d, items: []};
        if (b.date === d && !b.items.some(x => x.n === it.n)) b.items.push(it);
      }
    });
    if (Object.keys(byVenue).length) break;
  }
  const isOpen = v => statusNow(v).state === 'open';
  const res = Object.entries(byVenue).sort((a, b) => a[1].date.localeCompare(b[1].date) || isOpen(b[0]) - isOpen(a[0]) || b[1].items.length - a[1].items.length);
  const what = esc(q.food.join(' '));
  if (!res.length) return {say: `Couldn’t find “${what}” on any menu ${q.dayExplicit ? dayLabel(q.day) : 'in the next 7 days'}.`, chips: ['What’s open now?']};
  const [fv, fb] = res[0];
  const lead = fb.date === today ? `<b>${esc(vname(fv))}</b> has ${what} today.` : `Not on today’s menus. Next: <b>${esc(vname(fv))}</b> on <b>${dayLabel(fb.date)}</b>.`;
  if (res.length > 3) {
    return {say: `${cap(what)} is at <b>${res.length} places</b>. Tap one:`,
      html: `<div class="card">${res.slice(0, 12).map(([v, b], i) => `<details${i === 0 ? ' open' : ''}><summary><span>${esc(vname(v))}</span>
        <span class="dim">${b.date === today ? (statusNow(v).state === 'open' ? 'open now' : 'today') : cap(dayLabel(b.date)).split(',')[0]} · ${b.items.length}</span></summary>
        <div class="dim">${esc(hoursText(b.date, v))}</div>${b.items.slice(0, 8).map(itemRow).join('')}</details>`).join('')}</div>`,
      chips: [`High protein ${q.food.join(' ')}`, 'What’s open now?']};
  }
  return {say: lead, html: res.slice(0, 5).map(([v, b]) => `<div class="card"><div class="row">${vlink(v)}<span class="badge ${b.date === today ? 'b-ok' : 'b-off'}">${cap(dayLabel(b.date))}</span></div>
      <div class="dim">${esc(hoursText(b.date, v))}</div>${b.items.slice(0, 4).map(itemRow).join('')}</div>`).join(''),
    chips: [`Is ${vname(fv)} open now?`, `What’s at ${vname(fv)}?`]};
}

async function answerPlan(q) {
  const today = ames().date;
  let day = q.dayExplicit ? q.day : today;
  if (q.venue && !q.dayExplicit && statusNow(q.venue).state === 'closed' && statusNow(q.venue).nextDay) day = statusNow(q.venue).nextDay;
  const meal = q.meal || (day === today ? mealNow() : null);
  const cu = CUISINES[detectCuisine(q.t)];
  const items = (await menu(day)).filter(i => !cu || cuisineHit(cu, i));
  let venues = q.venue ? [q.venue] : VIDS().filter(v => windows(day, v).length && (day !== today || statusNow(v).state !== 'closed'));
  if (meal && !q.venue) {
    const [a, b] = MEALS[meal];
    venues = venues.filter(v => windows(day, v).some(w => w.all_day || (toMin(w.s) < b && toMin(w.e) > a)));
  }
  const when = `${meal ? meal + ' ' : ''}${dayLabel(day)}`.replace('dinner today', 'dinner tonight');
  if (!venues.length) return {say: `Nothing is open for ${when}.`, chips: ['What’s open now?']};

  const opts = {maxK: q.maxK, minP: q.minP, avoid: q.avoid, noMeat: q.noMeat, vegan: q.vegan, opt: q.opt, meal,
    maxItems: / bowl /.test(q.t) ? 5 : 3, skipSides: !q.food.some(f => SIDE_CATS.test(f))};
  const results = venues.map(v => ({v, r: plan(items.filter(i => String(i.v) === v), opts)})).filter(x => x.r.best.length);
  if (!results.length) return cu ? {say: `No ${cu.label.toLowerCase()} dishes for ${when}.`, chips: [`${cu.label} this week`, 'What’s open now?']}
    : {say: `No menus posted for ${when} yet.`};
  results.sort((a, b) => (b.r.met - a.r.met) || (q.near && POS ? (walkMin(a.v) ?? 99) - (walkMin(b.v) ?? 99) : 0) || (b.r.s - a.r.s));
  const hits = results.filter(x => x.r.met);

  const goals = [q.minP ? `${q.minP}g+ protein` : '', q.maxK ? `under ${q.maxK} kcal` : '', q.avoid.length ? `no ${q.avoid.join(', ').toLowerCase()}` : '', q.vegan ? 'vegan' : q.noMeat ? 'vegetarian' : ''].filter(Boolean).join(', ');
  const names = venues.map(v => vname(v));
  const openList = names.length <= 4 ? names.join(', ') : `${names.slice(0, 4).join(', ')} +${names.length - 4} more`;
  let say = q.venue ? '' : `Open for ${when}: <b>${esc(openList)}</b>.<br>`;
  if (hits.length) say += q.venue ? `Here’s a meal at <b>${esc(vname(q.venue))}</b>${goals ? ` (${goals})` : ''}:`
    : goals ? `${hits.length === 1 ? 'Only 1 place hits' : `${Math.min(hits.length, 3)} best options for`} ${goals}:` : `Top ${q.opt === 'low' ? 'light' : q.opt === 'bal' ? 'balanced' : 'high protein'} picks:`;
  else say += `Nothing hits ${goals || 'that'} exactly. Closest (most protein):`;

  const card = ({v, r}) => {
    const badge = day === today ? statusBadge(statusNow(v)) : `<span class="badge b-off">${cap(dayLabel(day))}</span>`;
    const notes = [];
    if (r.exC) notes.push(`removed ${r.exC} with your allergens`);
    if (r.exU) notes.push(`skipped ${r.exU} with no allergen info`);
    return `<div class="card"><div class="row"><span>${vlink(v)}</span>${badge}</div>${payTag(v)}
      ${r.best.map(it => `<div class="item"><div class="row"><span>${esc(it.n)}</span><span class="nums">${Math.round(it.k)} kcal · ${it.p ?? '?'}g</span></div>${it.a ? `<div class="allg">Contains: ${esc(it.a)}</div>` : ''}</div>`).join('')}
      <div class="total row"><span>Total</span><span>${Math.round(r.k)} kcal · ${Math.round(r.p)}g protein</span></div>
      ${notes.length ? `<div class="note">${cap(notes.join('; '))}.</div>` : ''}</div>`;
  };
  const shown = (hits.length ? hits : results).slice(0, q.venue ? 1 : 3);
  let html = shown.map(card).join('');
  if (q.vegan) html += META.diet_labels ? '<div class="note">Using ISU’s vegan labels. Double check with staff.</div>'
    : '<div class="note">Vegan isn’t labeled in ISU data. These are dairy, egg and meat free by ingredients. Double check with staff.</div>';
  const other = shown[0].v;
  return {say, html, chips: [
    q.maxK ? `Same but under ${Math.max(300, q.maxK - 150)} cal` : 'Same but under 600 cal',
    q.avoid.includes('Dairy') ? 'Same but no gluten' : 'Same but no dairy',
    `What’s at ${vname(other)}?`]};
}

function answerMealTime(q) {
  const [a, b] = MEALS[q.meal], day = q.day;
  const fits = w => w.all_day || (toMin(w.s) < b && toMin(w.e) > a);
  const ids = VIDS().filter(v => windows(day, v).some(fits))
    .sort((x, y) => toMin(windows(day, x).find(fits).s || '00:00') - toMin(windows(day, y).find(fits).s || '00:00'));
  if (!ids.length) return {say: `No ${q.meal} spots found ${dayLabel(day)}.`};
  const span = v => windows(day, v).filter(fits).map(w => w.all_day ? 'all day' : `${fmt(w.s)}–${fmt(w.e)}`).join(', ');
  return {say: `${cap(q.meal)} ${dayLabel(day)}: <b>${ids.length} places</b>. Earliest is <b>${esc(vname(ids[0]))}</b>.`,
    html: rowCard(ids.map(v => `<div class="row">${vlink(v)}<span class="dim">${span(v)}</span></div>`)),
    chips: [`High protein ${q.meal} ${q.dayExplicit ? dayLabel(day) : ''}`.trim(), 'What’s open now?']};
}


// Broad words get a grouped answer: [label, match regex, words that ask for just this type]
const GROUPS = {
  drinks: {label: 'drinks', words: ['drink', 'drinks', 'beverage', 'beverages', 'thirsty', 'refreshment'], subs: [
    ['Smoothies', /smoothie/, ['smoothie', 'smoothies']],
    ['Shakes', /shake|\bmalt\b/, ['shake', 'shakes', 'milkshake', 'milkshakes']],
    ['Coffee', /coffee(?! cake)|latte|espresso|mocha|cappuccino|americano|cold brew|frapp|macchiato/, []],
    ['Tea & chai', /\btea\b|chai|matcha/, ['tea', 'chai', 'matcha']],
    ['Energy drinks', /energy|red bull|celsius|monster|rockstar|\bbang\b|ghost/, ['energy', 'energy drink', 'energy drinks', 'red bull', 'celsius', 'monster']],
    ['Juice & lemonade', /juice|lemonade|refresher|agua fresca/, ['juice', 'lemonade', 'refresher']],
    ['Soda & fountain', /fountain|soda|\bpop\b|coke|pepsi|sprite|dr pepper|mountain dew|root beer/, ['soda', 'pop', 'fountain', 'coke', 'pepsi', 'sprite']],
    ['Hot chocolate & milk', /hot chocolate|cocoa|chocolate milk|\b(white|2%|skim|whole) milk\b/, ['hot chocolate', 'cocoa', 'chocolate milk']],
    ['Water', /\bwater\b|sparkling|bubly|la ?croix/, ['water', 'sparkling water']]]},
  coffee: {label: 'coffee', words: ['coffee', 'coffees', 'caffeine'], subs: [
    ['Lattes', /latte/, ['latte', 'lattes']],
    ['Mochas', /mocha/, ['mocha', 'mochas']],
    ['Cold brew & iced', /cold brew|iced (coffee|latte|mocha)|nitro/, ['cold brew', 'iced coffee']],
    ['Espresso drinks', /espresso|americano|cappuccino|macchiato|cortado/, ['espresso', 'americano', 'cappuccino']],
    ['Frappes', /frapp/, ['frappe', 'frappuccino']],
    ['Brewed coffee', /coffee(?! cake)/, []]]},
  dessert: {label: 'desserts', nameOnly: true, words: ['dessert', 'desserts', 'sweet', 'sweets', 'treat', 'treats', 'sweet tooth'], subs: [
    ['Cookies', /cookie/, ['cookie', 'cookies']],
    ['Brownies & bars', /brownie|blondie|bars?$/, ['brownie', 'brownies']],
    ['Cake & cupcakes', /\bcake|cupcake|cheesecake/, ['cake', 'cupcake', 'cupcakes'], /crab|fish|rice cake|potato/],
    ['Ice cream', /ice cream|sundae|\bcone\b|gelato|frozen yogurt/, ['ice cream', 'sundae', 'gelato']],
    ['Pie', /\bpie\b|cobbler|crisp\b/, ['pie'], /pot pie|shepherd|pizza/],
    ['Pastries & donuts', /pastr|danish|croissant|donut|doughnut|scone|cinnamon roll/, ['pastry', 'pastries', 'donut', 'donuts']],
    ['Pudding & parfait', /pudding|parfait|mousse/, ['pudding', 'parfait']]]},
  snacks: {label: 'snacks', nameOnly: true, words: ['snack', 'snacks', 'munchies'], subs: [
    ['Chips & pretzels', /chips|crisps|pretzel|popcorn|cheez|doritos|lays/, ['chips', 'pretzels', 'popcorn']],
    ['Fruit', /^(fresh |whole |sliced )?(fruit|apple|banana|orange|grapes|berries|melon)|fruit cup|fruit salad/, ['fruit']],
    ['Bars', /protein bar|granola|clif|kind bar/, ['protein bar', 'granola bar']],
    ['Candy & chocolate', /candy|chocolate bar|gummy|skittles|m&m|reese|snickers/, ['candy']],
    ['Yogurt', /yogurt|yoghurt/, ['yogurt']],
    ['Nuts & trail mix', /\bnuts\b|trail mix|almonds|cashews|peanuts/, ['trail mix']]]},
};
function detectGroup(t) {
  // specific types first ("energy drinks"), then broad words ("drinks")
  for (const [key, g] of Object.entries(GROUPS))
    for (const sub of g.subs) if (sub[2].some(w => t.includes(` ${w} `))) return {key, sub: sub[0]};
  for (const [key, g] of Object.entries(GROUPS)) if (g.words.some(w => t.includes(` ${w} `))) return {key};
  return null;
}

async function answerGroup(q, key, only) {
  const G = GROUPS[key], today = ames().date;
  const day = q.dayExplicit ? q.day : today;
  const venues = q.venue ? [q.venue] : VIDS().filter(v => windows(day, v).length && (day !== today || statusNow(v).state !== 'closed'));
  const items = (await menu(day)).filter(i => venues.includes(String(i.v)));
  const subs = G.subs.filter(sb => !only || sb[0] === only).map(([label, re, words, not]) => ({label, re, words, not, byV: {}, n: 0}));
  for (const it of items) {
    const text = (G.nameOnly ? it.n : `${it.n} ${it.c}`).toLowerCase();
    const sub = subs.find(sb => sb.re.test(text) && !(sb.not && sb.not.test(text)));
    if (!sub || (q.avoid.length && allergenStatus(it, q.avoid) !== 'ok') || !dietOk(it, q)) continue;
    const list = sub.byV[it.v] = sub.byV[it.v] || [];
    if (!list.some(x => x.n === it.n)) { list.push(it); sub.n++; }
  }
  const isOpen = v => day === today && statusNow(v).state === 'open';
  const found = subs.filter(sb => sb.n).sort((a, b) => Object.keys(b.byV).length - Object.keys(a.byV).length);
  const what = only ? only.toLowerCase() : G.label;
  const where = q.venue ? ` at <b>${esc(vname(q.venue))}</b>` : '';
  const when = day === today ? 'today' : dayLabel(day);
  if (!found.length) return {say: `No ${what}${where} ${when}.`, chips: q.dayExplicit ? ['What’s open now?'] : [`${cap(what)} tomorrow`, 'What’s open now?']};

  const block = sb => {
    const vs = Object.keys(sb.byV).sort((a, b) => isOpen(b) - isOpen(a) || (walkMin(a) ?? 99) - (walkMin(b) ?? 99));
    const body = q.venue ? sb.byV[q.venue].map(itemRow).join('')
      : vs.slice(0, 8).map(v => `<div class="item"><div class="row">${vlink(v)}${day === today ? statusBadge(statusNow(v)) : ''}</div>
          <div class="nums">${esc(sb.byV[v].slice(0, 3).map(i => i.n).join(', '))}${sb.byV[v].length > 3 ? ` +${sb.byV[v].length - 3} more` : ''}</div></div>`).join('')
        + (vs.length > 8 ? `<div class="note">+${vs.length - 8} more places</div>` : '');
    const count = q.venue ? `${sb.n} item${sb.n > 1 ? 's' : ''}` : `${vs.length} place${vs.length > 1 ? 's' : ''}${vs.some(isOpen) ? ` · ${vs.filter(isOpen).length} open` : ''}`;
    return `<details${only ? ' open' : ''}><summary><span>${esc(sb.label)}</span><span class="dim">${count}</span></summary>${body}</details>`;
  };
  const say = only ? `${cap(what)}${where} ${when}:` : `${cap(what)}${where} ${when}: <b>${found.length} kinds</b>. Tap one to see ${q.venue ? 'items' : 'where'}.`;
  const chips = only ? ['What’s open now?', `All ${G.label}`] : found.filter(sb => sb.words.length).slice(0, 4).map(sb => cap(sb.words[sb.words.length > 1 && sb.words[1].includes(' ') ? 1 : 0]));
  return {say, html: `<div class="card">${found.map(block).join('')}</div>`, chips};
}

const HELP = {say: 'Ask me like you’d text a friend. I check every ISU dining spot at once.',
  chips: ['What’s open now?', 'Closest open place', 'High protein lunch under 700 cal', 'Drinks', 'Where can I use a meal swipe?', 'Build a bowl at Plato, no dairy', 'Is UDM open?']};

const FILLER = new Set(['what', 'about', 'how', 'and', 'then', 'for', 'on', 'the', 'whats', 'ok', 'so', 'or']);
const DAY_WORDS = new Set(['today', 'tonight', 'tomorrow', 'now', ...WEEKDAYS]);
function prefCommand(q) {
  const t = q.t;
  if (/ (forget|reset|clear) (my )?(prefs|preferences|settings|diet) /.test(t)) return {say: 'Done, cleared your saved preferences.', prefs: {}};
  if (/ my (prefs|preferences|settings|diet) /.test(t) && !/ (set|change|update) /.test(t))
    return {say: prefsText() ? `Saved: <b>${esc(prefsText())}</b>. Say “forget my preferences” to clear.` : 'Nothing saved yet. Try “I’m vegetarian and allergic to peanuts” or tap ⚙.'};
  const me = / (im|i am|i m|remember|save|always|set my|i dont eat|i cant eat|i don t eat) /.test(t);
  if (!me) return null;
  const p = {...PREFS, avoid: [...(PREFS.avoid || [])]};
  if (/ vegan /.test(t)) p.diet = 'vegan'; else if (/ (vegetarian|veggie|dont eat meat|don t eat meat|no meat) /.test(t)) p.diet = 'vegetarian';
  for (const a of q.avoid) if (!p.avoid.includes(a)) p.avoid.push(a);
  if (/ allergic /.test(t)) for (const [label, words] of Object.entries(ALLERGEN_WORDS))
    if (words.some(w => new RegExp(`allergic to (?:\\w+ )*?${w}\\b`).test(t)) && !p.avoid.includes(label)) p.avoid.push(label);
  if (q.minP && / (goal|always|remember|save|aim|target|need) /.test(t)) p.protein = q.minP;
  if (q.maxK && / (goal|always|remember|save|aim|target|limit) /.test(t)) p.kcal = q.maxK;
  if (JSON.stringify(p) === JSON.stringify({...PREFS, avoid: PREFS.avoid || []})) return null;
  return {say: `Got it, saved: <b>${esc(prefsText(p))}</b>. I’ll use this in every answer. Change anytime with ⚙.`, prefs: p,
    chips: ['High protein dinner', 'What’s open now?', 'My preferences']};
}

function applyPrefs(q) {
  if (/ (ignore|without|skip) my (prefs|preferences) | anything /.test(q.t)) return q;
  const used = [];
  if (PREFS.diet === 'vegan' && !q.vegan) { q.vegan = q.noMeat = true; used.push('vegan'); if (!META.diet_labels) for (const a of ['Dairy', 'Egg']) if (!q.avoid.includes(a)) q.avoid.push(a); }
  if (PREFS.diet === 'vegetarian' && !q.noMeat) { q.noMeat = true; used.push('vegetarian'); }
  for (const a of PREFS.avoid || []) if (!q.avoid.includes(a)) { q.avoid.push(a); used.push(`no ${a.toLowerCase()}`); }
  if (q.wantPlan && !q.minP && PREFS.protein) { q.minP = PREFS.protein; used.push(`${PREFS.protein}g+ protein`); }
  if (q.wantPlan && !q.maxK && PREFS.kcal) { q.maxK = PREFS.kcal; used.push(`under ${PREFS.kcal} kcal`); }
  q.usedPrefs = used;
  return q;
}

function answerPay(q) {
  const list = type => VIDS().filter(v => VENUE_INFO[v]?.pay === type)
    .sort((a, b) => (statusNow(b).state === 'open') - (statusNow(a).state === 'open') || (walkMin(a) ?? 99) - (walkMin(b) ?? 99));
  const rows = ids => rowCard(ids.map(v => `<div class="row"><span>${vlink(v)}</span>${statusBadge(statusNow(v))}</div>`));
  if (q.pay === 'dollars') return {say: 'Dining Dollars and Flex Meals work at cafés, markets and GET & Go spots. Open ones first:',
    html: rows([...list('getgo'), ...list('retail')]) + '<div class="note">Panda Express and Sushi Do in the MU take Dining Dollars only. Check your balance in the GET Mobile app.</div>',
    chips: ['Where can I use a meal swipe?', 'What’s open now?']};
  return {say: 'Meal swipes get you into the <b>dining centers</b> (all you care to eat):',
    html: rows(list('center')) + `<div class="dim" style="margin:10px 0 4px">GET & Go spots (swipe works on some plans):</div>` + rows(list('getgo'))
      + '<div class="note">Plans differ. Check yours in the GET Mobile app.</div>',
    chips: ['Where can I use Dining Dollars?', 'Dinner at a dining center']};
}

let last = null;
function resetChat() { last = null; }
async function respond(text) {
  let q = parse(text);
  const cmd = prefCommand(q);
  if (cmd) return {...cmd, route: 'prefs'};
  if (q.near && !POS) return {needLocation: true, route: 'near'};
  if (/^ (hi+|hey|hello|yo|help|sup|what can you do) /.test(q.t)) return HELP;
  if (last && / same but /.test(q.t)) {
    const extra = q;
    q = {...last, t: last.t + extra.t, wantPlan: true};
    if (extra.maxK) q.maxK = extra.maxK;
    if (extra.avoid.length) q.avoid = [...new Set([...last.avoid, ...extra.avoid])];
  } else if (last) {
    // "what about tomorrow" repeats the last question for a new day; "is it open" reuses the last venue
    const words = q.t.trim().split(' ');
    const onlyDay = q.dayExplicit && words.every(w => FILLER.has(w) || DAY_WORDS.has(w));
    const onlyMeal = q.meal && (last.venue || last.food.length || detectCuisine(last.t)) && words.every(w => FILLER.has(w) || DAY_WORDS.has(w) || w in MEALS);
    if (onlyMeal) q = {...last, meal: q.meal, t: last.t.replace(/ (breakfast|brunch|lunch|dinner) /g, ' ') + `${q.meal} `,
      ...(q.dayExplicit ? {day: q.day, dayExplicit: true} : {})};
    else if (onlyDay) q = {...last, day: q.day, dayExplicit: true};
    else if (!q.venue && last.venue && / (it|there|that place|they|them) /.test(q.t)) q.venue = last.venue;
  }
  last = q;
  applyPrefs(q);
  const a = await route(q);
  if (q.corrected) a.say = `<span class="dim">Showing results for “${esc(q.corrected)}”</span><br>` + (a.say || '');
  a.route = q.pay ? 'pay' : (q.near && !q.wantPlan) ? 'near' : (q.wantPlan || (q.noMeat && !q.food.length)) ? 'plan' : q.wantHours ? 'hours' : detectCuisine(q.t) ? 'cuisine' : detectGroup(q.t) ? 'group'
    : q.venue ? 'venue' : q.food.length ? 'find' : q.meal ? 'meal' : 'other';
  if (q.usedPrefs?.length && ['plan', 'group', 'find'].includes(a.route) && !a.needLocation)
    a.say = (a.say || '') + `<div class="note">Using your saved prefs: ${esc(q.usedPrefs.join(', '))}.</div>`;
  return a;
}

async function route(q) {
  if (q.pay) return answerPay(q);
  if (q.near && !q.wantPlan && !q.food.length && !detectGroup(q.t)) return answerOpenNow(q);
  if (q.wantPlan && !(q.wantHours && !q.maxK && !q.minP)) return answerPlan(q);
  if (q.wantHours && q.venue) return answerVenueHours(q);
  if (q.wantHours) {
    if (q.dayExplicit && q.day !== ames().date) {
      const ids = VIDS().filter(v => windows(q.day, v).length);
      return {say: `Open ${dayLabel(q.day)}: <b>${ids.length} places</b>.`, html: rowCard(ids.map(v => `<div class="row">${vlink(v)}<span class="dim">${esc(hoursText(q.day, v))}</span></div>`))};
    }
    return answerOpenNow(q);
  }
  const cu = detectCuisine(q.t);
  if (cu) return answerCuisine(q, cu);
  if (q.noMeat && !q.food.length) return answerPlan({...q, wantPlan: true});
  const grp = detectGroup(q.t.replace(/ all /, ' '));
  if (grp) return answerGroup(q, grp.key, grp.sub);
  if (q.venue) return answerVenueMenu(q);
  if (q.food.length) return answerFind(q);
  if (q.meal) return answerMealTime(q);
  if (q.unknown.length) return {say: `Couldn’t find “${esc(q.unknown.join(' '))}” on any menu this week.`, chips: HELP.chips};
  return {say: 'Not sure what you mean. Try one of these:', chips: HELP.chips};
}
