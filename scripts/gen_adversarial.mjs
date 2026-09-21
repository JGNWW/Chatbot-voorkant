// Genereert het TYPEFOUT-deel van de vijandige testset. Niet uit paginatitels — die zijn hele
// vragen, en daar losse woorden uit plakken levert geen Nederlands op. Wel uit de bestaande,
// met de hand geschreven vragen: dezelfde vraag, één woord verhaspeld zoals iemand die snel
// typt of het woord niet kent. Het goud verandert niet, dus het meet precies één ding: houdt de
// zoeker stand als de spelling niet klopt. Google doet dat moeiteloos.
//
//   node scripts/gen_adversarial.mjs > scripts/adversarial/typefouten.json
import fs from "fs";

const evalSet = JSON.parse(fs.readFileSync(new URL("./eval_set.json", import.meta.url), "utf-8"));
const corpus = JSON.parse(fs.readFileSync(new URL("../docs/data/corpus.json", import.meta.url), "utf-8"));

// Woorden die de site zelf gebruikt; alleen die verhaspelen we, want juist daar hangt de
// treffer op. Een tikfout in "hoelang" doet er weinig toe.
const bekend = new Set();
for (const p of corpus) for (const w of (p.title + " " + (p.desc || "")).toLowerCase().split(/[^a-zà-ÿ]+/)) if (w.length >= 6) bekend.add(w);

// Hoe Nederlanders zich echt vertypen: een letter uit een dubbel paar weg, een middelste letter
// weg, twee middelste letters omgewisseld, en de klassieke klankverwarringen.
function verhaspel(w) {
  const uit = [];
  const dubbel = w.search(/(.)\1/);
  if (dubbel > 0) uit.push(w.slice(0, dubbel) + w.slice(dubbel + 1));
  const m = Math.floor(w.length / 2);
  if (w[m] !== w[m - 1] && w[m] !== w[m + 1]) uit.push(w.slice(0, m) + w.slice(m + 1));
  if (m + 1 < w.length - 1 && w[m] !== w[m + 1]) uit.push(w.slice(0, m) + w[m + 1] + w[m] + w.slice(m + 2));
  if (/ij/.test(w)) uit.push(w.replace("ij", "ei"));
  else if (/ei/.test(w)) uit.push(w.replace("ei", "ij"));
  else if (/c(?![hk])/.test(w)) uit.push(w.replace(/c(?![hk])/, "k"));
  return [...new Set(uit)].filter(t => t !== w && !bekend.has(t));
}

const items = [];
let n = 0;
for (const { q, expect } of evalSet) {
  // Het langste woord dat de site zelf kent draagt de vraag; dat is het woord dat telt.
  const woorden = q.toLowerCase().match(/[a-zà-ÿ]+/g) || [];
  const doel = woorden.filter(w => w.length >= 7 && bekend.has(w)).sort((a, b) => b.length - a.length)[0];
  if (!doel) continue;
  const varianten = verhaspel(doel);
  if (!varianten.length) continue;
  // Om en om een andere soort fout, zodat het niet 40x dezelfde ingreep is.
  const fout = varianten[n++ % varianten.length];
  items.push({
    q: q.toLowerCase().replace(doel, fout),
    expect, kind: "typefout", bron: "typefouten",
    why: `"${doel}" verhaspeld tot "${fout}"; verder dezelfde vraag als in eval_set.json`,
  });
}

// Niet alle 119: dan zou één soort de hele testset overstemmen en zegt het eindcijfer vooral
// iets over spelling. Een gelijkmatige greep over de hele lijst houdt de spreiding intact.
const MAX = 45;
const stap = items.length / MAX;
const greep = items.length <= MAX ? items : Array.from({ length: MAX }, (_, i) => items[Math.floor(i * stap)]);

console.log(JSON.stringify(greep, null, 1));
process.stderr.write(`${greep.length} typefoutvragen (uit ${items.length} mogelijke, ${evalSet.length} bronvragen)\n`);
