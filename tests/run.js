// Runs real questions through docs/app.js and checks the answers.
// Uses tests/fixture.json and a fixed clock: Monday Oct 5 2026, 6:00 PM.
//   node tests/run.js
const fs = require('fs'), path = require('path'), vm = require('vm');

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixture.json'), 'utf8'));
const code = fs.readFileSync(path.join(__dirname, '..', 'docs', 'app.js'), 'utf8');
const ctx = {console};
ctx.globalThis = ctx;
ctx.FAKE_NOW = {date: '2026-10-05', mins: 18 * 60};
ctx.fetch = async url => {
  const m = String(url).match(/menu-(\d{4}-\d\d-\d\d)/);
  const items = m && fixture.menus[m[1]];
  return {ok: !!items, json: async () => ({items})};
};
vm.createContext(ctx);
vm.runInContext(code + '\n;globalThis.T = {respond, setMeta, setPrefs, setPosition, resetChat};', ctx);
ctx.T.setMeta(fixture.meta);

const text = a => `${a.say || ''} ${a.html || ''}`.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ');

const CASES = [
  {ask: ['what’s open now'], has: ['open right now', 'Union Drive Marketplace'], not: ['The Roasterie']},
  {ask: ['is udm open'], has: ['Union Drive Marketplace is open till 8 PM']},
  {ask: ['is udm open', 'what about tomorrow'], has: ['Union Drive Marketplace tomorrow']},
  {ask: ['is udm open', 'is it open now'], has: ['Union Drive Marketplace is open']},
  {ask: ['is the roasterie open'], has: ['closed now', 'Next open tomorrow']},
  {ask: ['is hawthorne open'], has: ['Hawthorn is open']},
  {ask: ['what’s open late'], has: ['Open latest tonight', 'East Side Market']},
  {ask: ['where can i get a smoothie'], has: ['Memorial Union Food Court', 'Whirlybird']},
  {ask: ['smoothie at mu'], has: ['Berry Smoothie'], not: ['Protein Smoothie']},
  {ask: ['ramen'], has: ['Not on today’s menus', 'Union Drive Marketplace']},
  {ask: ['chicken'], has: ['Chicken is at', 'places']},
  {ask: ['asdf qwerty'], has: ['Couldn’t find']},
  {ask: ['im looking for tomorrow breakfast'], has: ['Breakfast tomorrow'], not: ['looking']},
  {ask: ['tommorrrow breakfast'], has: ['Showing results for', 'Breakfast tomorrow']},
  {ask: ['i need to hit 40g protein and 600gm cals for dinner'], has: ['Open for dinner tonight', '40g+ protein, under 600 kcal', 'Roast Turkey'], not: ['Breakfast Burrito']},
  {ask: ['high protein lunch under 700 cal'], has: ['Total'], not: ['Breakfast Burrito', 'Scrambled Eggs']},
  {ask: ['40g protein no dairy'], has: ['no dairy'], not: ['Shake', 'Mashed Potatoes']},
  {ask: ['build a bowl at plato, no dairy'], has: ['Heaping Plato', 'no dairy'], not: ['Feta', 'Tzatziki']},
  {ask: ['build a bowl at plato, no dairy', 'same but under 300 cal'], has: ['under 300 kcal'], not: ['Feta', 'Tzatziki']},
  {ask: ['vegan dinner'], has: ['vegan'], not: ['Roast Turkey', 'Salmon', 'Shake', 'Pasta Marinara']},
  {ask: ['vegetarian dinner tonight'], not: ['Roast Turkey', 'Chicken', 'Salmon']},
  {ask: ['drinks'], has: ['Drinks today', 'Energy drinks', 'Smoothies', 'Shakes']},
  {ask: ['energy drinks'], has: ['Red Bull', 'Celsius'], not: ['Fountain']},
  {ask: ['dessert'], has: ['Cookies'], not: ['Pot Pie']},
  {ask: ['shakes at clydes'], has: ['Strawberry Shake']},
  {ask: ['where can i use a meal swipe'], has: ['dining centers', 'Friley Windows', 'Union Drive Marketplace', 'GET & Go']},
  {ask: ['where can i use dining dollars'], has: ['Dining Dollars and Flex Meals']},
  {ask: ['hi'], has: ['Ask me like']},
  {ask: ['closest open place'], expect: a => a.needLocation === true, why: 'should ask for location'},
  {ask: ['closest open place'], pos: {lat: 42.0249, lng: -93.6513}, has: ['Closest open', 'min walk']},
  {ask: ['im vegetarian and allergic to peanuts'], has: ['saved', 'vegetarian', 'no peanut'], expect: a => a.prefs && a.prefs.diet === 'vegetarian'},
  {ask: ['forget my preferences'], expect: a => a.prefs && Object.keys(a.prefs).length === 0, why: 'should clear prefs'},
  {ask: ['high protein dinner'], prefs: {diet: 'vegetarian'}, has: ['Using your saved prefs: vegetarian'], not: ['Roast Turkey', 'Salmon']},
  {ask: ['drinks'], prefs: {avoid: ['Dairy']}, not: ['Shake', 'Protein Smoothie']},
  {ask: ['high protein dinner'], prefs: {protein: 40}, has: ['40g+ protein']},
];

(async () => {
  let fail = 0;
  for (const c of CASES) {
    ctx.T.resetChat();
    ctx.T.setPrefs(c.prefs || {});
    ctx.T.setPosition(c.pos || null);
    let a;
    for (const q of c.ask) a = await ctx.T.respond(q);
    const t = text(a);
    const problems = [
      ...(c.has || []).filter(s => !t.includes(s)).map(s => `missing "${s}"`),
      ...(c.not || []).filter(s => t.includes(s)).map(s => `should not have "${s}"`),
      ...(c.expect && !c.expect(a) ? [c.why || 'custom check failed'] : []),
    ];
    if (problems.length) { fail++; console.log(`FAIL  ${c.ask.join(' → ')}\n      ${problems.join('; ')}\n      got: ${t.slice(0, 300)}`); }
    else console.log(`ok    ${c.ask.join(' → ')}`);
  }
  console.log(`\n${CASES.length - fail}/${CASES.length} passed`);
  process.exit(fail ? 1 : 0);
})();
