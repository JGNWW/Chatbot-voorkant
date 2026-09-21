// Stelt de fusie af: hoe zwaar wegen de semantische en de trefwoordlijst, hoe vlak is de
// RRF-curve (k), en hoe diep kijken we in elke lijst (K)?
//
// De truc die dit betaalbaar maakt: per vraag worden beide ranglijsten ÉÉN keer berekend (tot
// diepte 50) en daarna hergebruikt voor elke variant. Zonder dat zou elke variant het
// embeddingmodel opnieuw over alle vragen moeten halen.
//
//   node scripts/tune_fusion.mjs                      afstellen op de vijandige dev-set
//   node scripts/tune_fusion.mjs --cache=/tmp/f.json  ranglijsten bewaren/hergebruiken
//
// WAT AL GEMETEN IS EN NIET WERKTE — zodat niemand dit nog eens hoeft te doen. Alles hieronder
// is doorgerekend op de 126 handgemaakte, de 1000 gegenereerde en de 114 vijandige vragen:
//
//   Het land uit de trefwoordvraag halen en vervangen door een bonus op landpagina's.
//     Klinkt goed (een landnaam is een facet, geen onderwerp) maar de 1000-set zakte van 97%
//     naar 62%. Bij veel vragen IS de landpagina het antwoord, en dan moet het land gewoon
//     meewegen als zoekwoord.
//   Een prior op het aantal inkomende links (PageRank-licht) en op de URL-diepte.
//     Ruis (/cookies, /privacy) bleek nauwelijks een probleem: 2 à 3 gevallen op 114 vragen.
//     De prior gaf +1,6 punt op de 126 en -0,9 op de vijandige set: ruis, geen signaal.
//   Samenstellingen splitsen ("paspoortaanvraag" -> paspoort + aanvraag).
//     Vuurt op 11 van de 1348 vragen, waarvan de helft onzin ("vrijgekocht" -> vrij + gekocht).
//     Het corpusvocabulaire is groot genoeg dat echte samenstellingen er al in staan.
//   De spellingcorrectie strenger maken of de correctie naast het origineel zetten.
//     De correctie verandert soms een gewoon woord in een ander gewoon woord ("negen" ->
//     "nemen", "gekort" -> "gekost"). Dat ziet er eng uit, maar kost meetbaar niets; hem
//     uitzetten kost wel 4 punten. Laten staan.
//   De paginascore anders opbouwen uit de tekstblokken (gemiddelde van de beste twee of drie
//     in plaats van het maximum). Alles binnen de ruis.
//   De veldgewichten en de titeldekking samen opnieuw afstellen (144 combinaties, over alle
//     drie de sets). De beste combinatie (titel 6, url 5, dekking 1) wint 1 vraag op de
//     vijandige dev-set en verliest er 1 op de blinde, bij +0,003 MRR op de 1000. Een wasgang;
//     niet doorgevoerd, want het zou de binaire index vernieuwen zonder iets op te leveren.
//   De algemene pagina laten voorgaan op haar landversies als de vraag geen land noemt.
//     Ziet er goed uit op één voorbeeld ("papiertje dat bewijst dat ik nog leef" gaf de
//     attestatie de vita in Pakistan) maar kost 5 punten op de 1000-set én 5 op de blinde
//     vijandige set: bij heel wat vragen is de landversie wel degelijk wat de beller zoekt,
//     ook als het land niet in de vraag staat.
//   Een volwaardige Nederlandse Snowball-stemmer in plaats van de simpele uitgangenlijst.
//     Verliest: op de vijandige set 38,6% -> 36,8% op plek 1. Het verdubbelen van klinkers
//     terugdraaien ("maan" -> "man") maakt botsingen die deze vakterm-rijke site niet aankan.
import fs from "fs";
import { loadCore, loadCorpus, loadSemantic } from "./corelib.mjs";

const arg = n => { const a = process.argv.find(x => x.startsWith("--" + n + "=")); return a ? a.slice(n.length + 3) : ""; };
const cachePad = arg("cache") || "/tmp/fusion_cache.json";
const DIEPTE = 50;

const SETS = ["eval_set_gauntlet_dev.json", "eval_set.json", "eval_set_auto.json"];
const core = loadCore();
loadCorpus(core);
const kort = u => u.replace("https://www.nederlandwereldwijd.nl", "");

let cache = fs.existsSync(cachePad) ? JSON.parse(fs.readFileSync(cachePad, "utf-8")) : {};
const teDoen = [];
for (const s of SETS) for (const { q } of JSON.parse(fs.readFileSync(new URL("./" + s, import.meta.url), "utf-8"))) if (!cache[q]) teDoen.push(q);

if (teDoen.length) {
  console.log(`ranglijsten berekenen voor ${teDoen.length} vragen…`);
  await loadSemantic(core);
  let n = 0;
  for (const q of teDoen) {
    cache[q] = { sem: await core.semanticRank(q, DIEPTE), kw: core.rank(q, DIEPTE) };
    if (++n % 200 === 0) console.log("  " + n + "/" + teDoen.length);
  }
  fs.writeFileSync(cachePad, JSON.stringify(cache));
}

const sets = Object.fromEntries(SETS.map(s => [s, JSON.parse(fs.readFileSync(new URL("./" + s, import.meta.url), "utf-8"))]));

function meet(set, { k, wSem, wKw, K }) {
  let raak = 0, mrr = 0, top1 = 0;
  for (const { q, expect } of set) {
    const c = cache[q];
    const score = new Map();
    c.sem.slice(0, K).forEach((i, r) => score.set(i, (score.get(i) || 0) + wSem / (k + r)));
    c.kw.slice(0, K).forEach((i, r) => score.set(i, (score.get(i) || 0) + wKw / (k + r)));
    const top = [...score.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(e => kort(core.CORPUS[e[0]].url));
    const p = top.findIndex(u => expect.some(e => u.includes(e)));
    if (p >= 0) { raak++; mrr += 1 / (p + 1); if (!p) top1++; }
  }
  const n = set.length;
  return { recall: raak / n, mrr: mrr / n, top1: top1 / n };
}

const NU = { k: 14, wSem: 1.0, wKw: 0.75, K: 12 };
const basis = Object.fromEntries(SETS.map(s => [s, meet(sets[s], NU)]));
console.log("\nhuidige instelling (k 14, sem 1,00, kw 0,75, diepte 12)");
for (const s of SETS) console.log("  " + s.padEnd(30) + `recall ${(basis[s].recall * 100).toFixed(1)}%  MRR ${basis[s].mrr.toFixed(3)}  top1 ${(basis[s].top1 * 100).toFixed(1)}%`);

const varianten = [];
for (const k of [1, 3, 5, 8, 14, 25])
  for (const wSem of [0.75, 1, 1.5, 2, 3])
    for (const K of [12, 20, 30, 50])
      varianten.push({ k, wSem, wKw: 0.75, K });

// Eén getal om op te sorteren: de vijandige set is de opdracht, maar de nette sets mogen niet
// zakken. Vandaar een harde eis in plaats van een gemiddelde waarin verlies kan wegvallen.
const score = r => r["eval_set_gauntlet_dev.json"].top1 * 0.6 + r["eval_set_gauntlet_dev.json"].recall * 0.4;
const mag = r =>
  r["eval_set.json"].recall >= basis["eval_set.json"].recall - 0.008 &&
  r["eval_set.json"].mrr >= basis["eval_set.json"].mrr - 0.01 &&
  r["eval_set_auto.json"].recall >= basis["eval_set_auto.json"].recall - 0.008 &&
  r["eval_set_auto.json"].mrr >= basis["eval_set_auto.json"].mrr - 0.01;

const uit = [];
for (const v of varianten) {
  const r = Object.fromEntries(SETS.map(s => [s, meet(sets[s], v)]));
  uit.push({ v, r, ok: mag(r), s: score(r) });
}
uit.sort((a, b) => b.s - a.s);

console.log("\nbeste varianten die de nette sets NIET laten zakken:");
let getoond = 0;
for (const u of uit) {
  if (!u.ok || getoond++ >= 10) continue;
  const g = u.r["eval_set_gauntlet_dev.json"], e = u.r["eval_set.json"], a = u.r["eval_set_auto.json"];
  console.log(`  k ${String(u.v.k).padStart(2)} sem ${u.v.wSem.toFixed(2)} diepte ${String(u.v.K).padStart(2)}` +
    ` | vijandig recall ${(g.recall * 100).toFixed(1)}% top1 ${(g.top1 * 100).toFixed(1)}%` +
    ` | 126 ${(e.recall * 100).toFixed(1)}%/${e.mrr.toFixed(3)} | 1000 ${(a.recall * 100).toFixed(1)}%/${a.mrr.toFixed(3)}`);
}
if (!getoond) console.log("  (geen enkele variant haalt het zonder de nette sets te laten zakken)");
