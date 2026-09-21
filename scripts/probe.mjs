// Draait de echte zoeker op losse vragen en toont wat de voorlichter zou zien.
// Gebruik:
//   node scripts/probe.mjs "waar blijft mijn paspoort"
//   node scripts/probe.mjs --no-sem "paspoort kwijt in spanje"
//   node scripts/probe.mjs --file=vragen.txt        (één vraag per regel)
//   node scripts/probe.mjs --json "vraag"           (machineleesbaar)
import fs from "fs";
import { loadCore, loadCorpus, loadSemantic, retrieve } from "./corelib.mjs";

const NO_SEM = process.argv.includes("--no-sem");
const JSON_OUT = process.argv.includes("--json");
const fileArg = (process.argv.find(a => a.startsWith("--file=")) || "").slice(7);
const LIMIT = Number((process.argv.find(a => a.startsWith("--limit=")) || "").slice(8) || 6);
const qs = fileArg
  ? fs.readFileSync(fileArg, "utf-8").split("\n").map(s => s.trim()).filter(Boolean)
  : process.argv.slice(2).filter(a => !a.startsWith("--"));

if (!qs.length) { console.error('Geef een vraag: node scripts/probe.mjs "…"'); process.exit(1); }

const core = loadCore();
loadCorpus(core);
if (!NO_SEM) await loadSemantic(core);

const short = u => u.replace("https://www.nederlandwereldwijd.nl", "");
const out = [];
for (const q of qs) {
  const res = await retrieve(core, q, LIMIT);
  const hits = res.map(i => ({ url: short(core.CORPUS[i].url), title: core.CORPUS[i].title }));
  out.push({ q, hits });
  if (!JSON_OUT) {
    console.log(`\n"${q}"`);
    hits.forEach((h, k) => console.log(`  ${k + 1}. ${h.url}  — ${h.title}`));
    if (!hits.length) console.log("  (geen treffers)");
  }
}
if (JSON_OUT) console.log(JSON.stringify(out, null, 1));
