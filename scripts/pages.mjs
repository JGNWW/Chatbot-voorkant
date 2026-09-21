// Bladeren door het corpus: pagina's zoeken op URL of titel en hun tekst inzien.
// Gebruik:
//   node scripts/pages.mjs --url=/paspoort-id-kaart/tijdsduur    URL bevat deze tekst
//   node scripts/pages.mjs --title=apostille                     titel bevat deze tekst
//   node scripts/pages.mjs --seg=trouwen --limit=40              eerste URL-segment
//   node scripts/pages.mjs --show=/paspoort-id-kaart/kosten      volledige tekst van één pagina
//   node scripts/pages.mjs --random=20 --seg=visum-nederland     willekeurige greep
import fs from "fs";

const corpus = JSON.parse(fs.readFileSync(new URL("../docs/data/corpus.json", import.meta.url), "utf-8"));
const arg = n => { const a = process.argv.find(x => x.startsWith("--" + n + "=")); return a ? a.slice(n.length + 3) : ""; };
const short = u => u.replace("https://www.nederlandwereldwijd.nl", "") || "/";
const LIMIT = Number(arg("limit") || 30);

const show = arg("show");
if (show) {
  const p = corpus.find(x => short(x.url) === show) || corpus.find(x => short(x.url).includes(show));
  if (!p) { console.error("geen pagina met " + show); process.exit(1); }
  console.log(short(p.url) + "\n" + p.title + "\n" + (p.desc || "") + "\n" + "-".repeat(60));
  console.log((p.text || "").slice(0, Number(arg("chars") || 2500)));
  process.exit(0);
}

let sel = corpus;
if (arg("url")) sel = sel.filter(p => short(p.url).includes(arg("url")));
if (arg("title")) sel = sel.filter(p => (p.title || "").toLowerCase().includes(arg("title").toLowerCase()));
if (arg("seg")) sel = sel.filter(p => short(p.url).split("/")[1] === arg("seg"));
if (arg("text")) sel = sel.filter(p => (p.text || "").toLowerCase().includes(arg("text").toLowerCase()));

const n = Number(arg("random") || 0);
if (n) { for (let i = sel.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [sel[i], sel[j]] = [sel[j], sel[i]]; } sel = sel.slice(0, n); }

console.log(`${sel.length} pagina's` + (sel.length > LIMIT ? ` (eerste ${LIMIT})` : ""));
for (const p of sel.slice(0, LIMIT)) {
  console.log(`\n${short(p.url)}\n  ${p.title}\n  ${(p.desc || (p.text || "").slice(0, 160)).replace(/\s+/g, " ").slice(0, 160)}`);
}
