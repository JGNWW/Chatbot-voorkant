// Evaluatie-harnas voor de zoeklaag (retrieval). Draait de ECHTE zoekkern uit
// docs/search-core.js — dezelfde code die de browser laadt — en meet recall@k en MRR.
// Gebruik:
//   node eval.mjs [embeddings-map]            volledige eval (laadt het embeddingmodel)
//   node eval.mjs [embeddings-map] --no-sem   alleen trefwoordlaag (BM25+spelling+land), geen model
//   node eval.mjs [embeddings-map] --gate     faalt (exit 1) onder de drempels (voor CI)
//   node eval.mjs --set=<bestand>             een andere vragenlijst uit scripts/
//   node eval.mjs --json                      uitkomst als JSON (voor de voortgangspagina)
// Meet de RETRIEVAL, niet de AI-stappen (expansie/rerank) — die vergen een sleutel.
import fs from "fs";
import { loadCore, loadCorpus, loadSemantic, retrieve } from "./corelib.mjs";

const NO_SEM = process.argv.includes("--no-sem");
const JSON_OUT = process.argv.includes("--json");
const dataDir = new URL("../docs/data/", import.meta.url).pathname.replace(/\/$/, "");
const embArg = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : dataDir;
const setArg = (process.argv.find(a => a.startsWith("--set=")) || "").slice(6) || "eval_set.json";
const evalSet = JSON.parse(fs.readFileSync(new URL("./" + setArg, import.meta.url), "utf-8"));
const TOPK = 6;

const core = loadCore();
loadCorpus(core);
const meta = NO_SEM ? null : await loadSemantic(core, embArg);

const url = i => core.CORPUS[i].url.replace("https://www.nederlandwereldwijd.nl", "");
// Een treffer is een URL die onder de verwachte pagina valt. Een SUBONDERWERP telt mee
// (/paspoort-id-kaart/aanvragen beantwoordt "hoe vraag ik een paspoort aan"), maar een
// LANDVARIANT alleen als de vraag dat land ook noemt.
//
// Waarom die uitzondering: van bijna elk onderwerp bestaat een versie per land, en die lijken
// zo op elkaar dat ze de top 6 vullen. Met een kale substringtoets telde /verklaring/woonplaats
// /ivoorkust als treffer voor "verklaring van woonplaats nodig" — terwijl de voorlichter dan een
// regel uit Ivoorkust voorleest op een vraag die over geen enkel land ging. Dat is precies de
// fout die we willen zien, en de meting maakte hem onzichtbaar: 97% gerapporteerd tegen 92%
// eerlijk geteld, en de zes vragen die het verschil maken zijn stuk voor stuk van dit type.
const hit = (u, exp, vraag) => exp.some(e => {
  if (!u.includes(e)) return false;
  const staart = u.slice(e.replace(/\/+$/, "").length).replace(/^\//, "");
  if (!staart) return true;                                    // exact de verwachte pagina
  const landen = core.detectCountries(staart.replace(/-/g, " "));
  if (!landen.size) return true;                               // gewoon een subonderwerp
  const gevraagd = core.detectCountries(vraag);
  for (const l of landen) if (gevraagd.has(l)) return true;    // het land dat de vraag noemt
  return false;
});
let recall = 0, mrrSum = 0, top1 = 0;
const misses = [];
for (const { q, expect } of evalSet) {
  const urls = (await retrieve(core, q, TOPK)).map(url);
  const firstHit = urls.findIndex(u => hit(u, expect, q));
  if (firstHit >= 0) { recall++; mrrSum += 1 / (firstHit + 1); if (firstHit === 0) top1++; }
  else misses.push({ q, expect, got: urls.slice(0, 4) });
}
const n = evalSet.length;
const r = recall / n, m = mrrSum / n;

if (JSON_OUT) {
  console.log(JSON.stringify({ set: setArg, n, sem: !NO_SEM, recall: r, mrr: m, top1: top1 / n, misses }, null, 1));
} else {
  console.log(`Model: ${meta ? meta.model : "geen (alleen trefwoorden)"} | set ${setArg} | ${n} vragen`);
  console.log(`recall@${TOPK}: ${recall}/${n} = ${(r * 100).toFixed(0)}%`);
  console.log(`MRR@${TOPK}: ${m.toFixed(3)}`);
  console.log(`top-1: ${(top1 / n * 100).toFixed(0)}%`);
  if (misses.length) {
    console.log(`\nMissers (${misses.length}):`);
    for (const x of misses) { console.log(` - "${x.q}" verwacht ${JSON.stringify(x.expect)}`); console.log(`     kreeg: ${x.got.join(", ")}`); }
  }
}
// Regressie-gate: `node eval.mjs [embeddings-map] --gate` faalt (exit 1) als de score onder
// de drempels zakt. Gebruik dit vóór het pushen van wijzigingen aan de zoeklaag.
// Drempels met marge onder de gemeten waarden; per set in te stellen via omgevingsvariabelen.
const GATE_RECALL = Number(process.env.GATE_RECALL || 0.82), GATE_MRR = Number(process.env.GATE_MRR || 0.70);
if (process.argv.includes("--gate")) {
  if (r < GATE_RECALL || m < GATE_MRR) {
    console.error(`\nGATE GEFAALD: recall ${(r * 100).toFixed(0)}% (eis ${GATE_RECALL * 100}%), MRR ${m.toFixed(3)} (eis ${GATE_MRR})`);
    process.exit(1);
  }
  console.log(`\nGATE OK (recall >= ${GATE_RECALL * 100}%, MRR >= ${GATE_MRR})`);
}
