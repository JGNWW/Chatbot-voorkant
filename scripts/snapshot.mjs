// Legt vast wat de zoeker op dit moment teruggeeft voor een hele vragenset. Twee van deze
// momentopnames — voor en na een wijziging — gaan daarna blind naast elkaar in scripts/duel.mjs.
//
//   node scripts/snapshot.mjs --set=eval_set_gauntlet_dev.json --out=/tmp/voor.json
//   node scripts/snapshot.mjs --set=... --out=/tmp/na.json --no-sem
import fs from "fs";
import { loadCore, loadCorpus, loadSemantic, retrieve } from "./corelib.mjs";

const arg = n => { const a = process.argv.find(x => x.startsWith("--" + n + "=")); return a ? a.slice(n.length + 3) : ""; };
const NO_SEM = process.argv.includes("--no-sem");
const setNaam = arg("set") || "eval_set.json";
const out = arg("out") || "/tmp/snapshot.json";
const evalSet = JSON.parse(fs.readFileSync(new URL("./" + setNaam, import.meta.url), "utf-8"));

const core = loadCore();
loadCorpus(core);
if (!NO_SEM) await loadSemantic(core);

const short = u => u.replace("https://www.nederlandwereldwijd.nl", "");
const rijen = [];
for (const { q, expect } of evalSet) {
  const hits = (await retrieve(core, q, 6)).map(i => ({ url: short(core.CORPUS[i].url), title: core.CORPUS[i].title.replace(/ \| NederlandWereldwijd$/, "") }));
  const plek = hits.findIndex(h => expect.some(e => h.url.includes(e)));
  rijen.push({ q, expect, hits, plek });
}
const raak = rijen.filter(r => r.plek >= 0).length, top1 = rijen.filter(r => r.plek === 0).length;
fs.writeFileSync(out, JSON.stringify({ set: setNaam, sem: !NO_SEM, n: rijen.length, recall: raak / rijen.length, top1: top1 / rijen.length, rijen }, null, 1));
console.log(`${out}: ${rijen.length} vragen, recall@6 ${(raak / rijen.length * 100).toFixed(0)}%, top-1 ${(top1 / rijen.length * 100).toFixed(0)}%`);
