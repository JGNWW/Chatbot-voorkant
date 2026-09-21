// Zet twee momentopnames blind naast elkaar voor de criticus: per vraag twee lijsten, A en B
// in willekeurige volgorde, zonder te verklappen welke van vóór en welke van ná de wijziging is.
// De sleutel gaat naar een apart bestand dat de criticus NIET leest.
//
//   node scripts/duel.mjs /tmp/voor.json /tmp/na.json --uit=/tmp/duel.json --sleutel=/tmp/sleutel.json
//
// Alleen vragen waar de twee lijsten verschillen komen in het duel; de rest zegt niets.
import fs from "fs";
import crypto from "crypto";

const arg = n => { const a = process.argv.find(x => x.startsWith("--" + n + "=")); return a ? a.slice(n.length + 3) : ""; };
const [voorPad, naPad] = process.argv.slice(2).filter(a => !a.startsWith("--"));
if (!voorPad || !naPad) { console.error("Gebruik: node scripts/duel.mjs <voor.json> <na.json> --uit=… --sleutel=…"); process.exit(1); }
const voor = JSON.parse(fs.readFileSync(voorPad, "utf-8"));
const na = JSON.parse(fs.readFileSync(naPad, "utf-8"));
const uit = arg("uit") || "/tmp/duel.json", sleutelPad = arg("sleutel") || "/tmp/sleutel.json";
const TOON = Number(arg("toon") || 3);

const naOp = new Map(na.rijen.map(r => [r.q, r]));
const duel = [], sleutel = [];
// Munt per vraag, maar bepaald door de vraag zelf: dezelfde vraag ligt elke run op dezelfde
// plek, dus een criticus kan geen patroon in de volgorde leren.
const munt = q => crypto.createHash("sha1").update(q).digest()[0] % 2 === 1;

for (const v of voor.rijen) {
  const n = naOp.get(v.q);
  if (!n) continue;
  const lijstVoor = v.hits.slice(0, TOON), lijstNa = n.hits.slice(0, TOON);
  if (JSON.stringify(lijstVoor) === JSON.stringify(lijstNa)) continue;
  const om = munt(v.q);
  duel.push({
    id: duel.length + 1, vraag: v.q,
    A: (om ? lijstNa : lijstVoor).map(h => `${h.url} — ${h.title}`),
    B: (om ? lijstVoor : lijstNa).map(h => `${h.url} — ${h.title}`),
  });
  sleutel.push({ id: duel.length, q: v.q, A: om ? "na" : "voor", B: om ? "voor" : "na", expect: v.expect, plekVoor: v.plek, plekNa: n.plek });
}

fs.writeFileSync(uit, JSON.stringify(duel, null, 1));
fs.writeFileSync(sleutelPad, JSON.stringify(sleutel, null, 1));
const zelfde = voor.rijen.length - duel.length;
console.log(`${duel.length} vragen verschillen (${zelfde} identiek) → ${uit}`);
console.log(`sleutel → ${sleutelPad} (niet aan de criticus geven)`);
