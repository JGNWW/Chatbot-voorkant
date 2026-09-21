// Voegt de deelbestanden uit scripts/adversarial/ samen tot één vijandige testset, controleert
// ze tegen het corpus en splitst in een DEV-helft (waar aan gewerkt wordt) en een BLINDE helft
// (die achtergehouden wordt, zodat winst niet uit meekijken kan komen).
//
//   node scripts/build_gauntlet_set.mjs
//
// Een vraag valt af als een `expect`-fragment op geen enkele pagina past, of op zoveel pagina's
// dat de vraag niets meer meet.
import fs from "fs";
import path from "path";

const dir = new URL("./adversarial/", import.meta.url).pathname;
const corpus = JSON.parse(fs.readFileSync(new URL("../docs/data/corpus.json", import.meta.url), "utf-8"));
const paths = corpus.map(p => p.url.replace("https://www.nederlandwereldwijd.nl", ""));
const MAX_PASSEND = 40; // een fragment dat op meer pagina's past, meet niets meer

const items = [], afgevallen = [];
for (const f of fs.readdirSync(dir).filter(f => f.endsWith(".json")).sort()) {
  const bron = path.basename(f, ".json");
  for (const it of JSON.parse(fs.readFileSync(dir + f, "utf-8"))) {
    const q = (it.q || "").trim();
    if (!q || !Array.isArray(it.expect) || !it.expect.length) { afgevallen.push([bron, q, "geen vraag of geen expect"]); continue; }
    const tellingen = it.expect.map(e => paths.filter(p => p.includes(e)).length);
    if (tellingen.some(n => n === 0)) { afgevallen.push([bron, q, "expect past op geen enkele pagina: " + it.expect.filter((e, i) => !tellingen[i]).join(", ")]); continue; }
    if (Math.min(...tellingen) > MAX_PASSEND) { afgevallen.push([bron, q, `expect past op ${Math.min(...tellingen)} pagina's — te breed`]); continue; }
    items.push({ q, expect: it.expect, kind: it.kind || "onbekend", bron, why: it.why || "" });
  }
}

// Dubbele vragen eruit (dezelfde tekst, hoofdletters en leestekens genegeerd).
const gezien = new Map();
const uniek = [];
for (const it of items) {
  const sleutel = it.q.toLowerCase().replace(/[^a-z0-9à-ÿ ]/g, "").replace(/\s+/g, " ").trim();
  if (gezien.has(sleutel)) { afgevallen.push([it.bron, it.q, "dubbel met " + gezien.get(sleutel)]); continue; }
  gezien.set(sleutel, it.bron);
  uniek.push(it);
}

// Stabiele splitsing op een hash van de vraag: dezelfde vraag komt altijd in dezelfde helft,
// ook als er later deelbestanden bijkomen. Geen willekeur die per run verschuift.
const hash = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const dev = [], blind = [];
for (const it of uniek) (hash(it.q) % 2 ? blind : dev).push(it);

const schrijf = (naam, lijst) => {
  fs.writeFileSync(new URL("./" + naam, import.meta.url).pathname, JSON.stringify(lijst, null, 1) + "\n");
  return `${naam}: ${lijst.length} vragen`;
};

console.log(`${uniek.length} vragen uit ${new Set(uniek.map(i => i.bron)).size} deelbestanden`);
console.log(schrijf("eval_set_gauntlet_dev.json", dev));
console.log(schrijf("eval_set_gauntlet_blind.json", blind));
const perSoort = new Map();
for (const it of uniek) perSoort.set(it.kind, (perSoort.get(it.kind) || 0) + 1);
console.log("soorten: " + [...perSoort].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(", "));
if (afgevallen.length) {
  console.log(`\nAfgevallen (${afgevallen.length}):`);
  for (const [b, q, r] of afgevallen) console.log(` - [${b}] "${q}" — ${r}`);
}
