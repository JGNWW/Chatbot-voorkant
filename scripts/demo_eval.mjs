// Meet het DEMO-antwoord: wat krijgt iemand zonder API-sleutel te zien?
//
// Zonder sleutel kiest geen taalmodel de passage, maar kiesDemoPassage() in docs/index.html:
// een score op de vraagwoorden, met een bonus voor een bedrag of termijn als daarnaar gevraagd
// wordt. Dit harnas loopt per standaardvraag de keten na zoals de demo hem doorloopt:
//
//   1. ZOEKEN   — de top 6 van de echte zoeker (dezelfde als in de app zonder AI);
//   2. KIEZEN   — welk blok kiest de demo, en op welke pagina?
//   3. CITEREN  — wat maakt de citaatlogica daarvan (hele zinnen, tabel compleet)?
//   4. ANTWOORD — staat het antwoord (het bedrag, de termijn, de zin) letterlijk in dat citaat?
//
// Ter vergelijking telt het ook de oude demo mee: de eerste twee alinea's van de beste pagina.
//
// Wat dit NIET meet: verdeelt de pagina het antwoord over keuzes ("ambassade / VFS Global /
// grensgemeente"), dan toont de app eerst die keuze en komt de passage achter de knop
// (bouwAntwoord, knipTotKeuze). Dat gebeurt precies zo met een AI-antwoord.
//
// Gebruik:
//   node scripts/demo_eval.mjs              met het semantische model (zoals in de browser)
//   node scripts/demo_eval.mjs --no-sem     alleen trefwoorden (snel, voor CI)
//   node scripts/demo_eval.mjs --gate       faalt (exit 1) onder de drempel
//   node scripts/demo_eval.mjs --mis        toon per gemiste vraag wat de demo koos
//   node scripts/demo_eval.mjs --mis --regressie   alleen de vragen die de oude demo wél goed had
import fs from "fs";
import { loadCore, loadCorpus, loadSemantic, retrieve } from "./corelib.mjs";

const NO_SEM = process.argv.includes("--no-sem");
const TOON_MIS = process.argv.includes("--mis");
const setArg = (process.argv.find(a => a.startsWith("--set=")) || "").slice(6) || "standaardvragen.json";
const dataDir = new URL("../docs/data/", import.meta.url).pathname.replace(/\/$/, "");

const vragen = JSON.parse(fs.readFileSync(new URL("./" + setArg, import.meta.url), "utf-8"));
const core = loadCore();
loadCorpus(core);
if (!NO_SEM) await loadSemantic(core, dataDir);

// De demo-logica komt uit docs/index.html zelf, net als in antwoord_eval.mjs: geen kopie die
// uit de pas kan lopen.
const html = fs.readFileSync(new URL("../docs/index.html", import.meta.url), "utf-8");
const blok = (van, tot) => {
  const a = html.indexOf(van), b = html.indexOf(tot, a);
  if (a < 0 || b < 0) { console.error("Blok niet gevonden in docs/index.html: " + van); process.exit(1); }
  return html.slice(a, b);
};
const fnSrc = (naam) => { const i = html.indexOf("function " + naam + "("); return html.slice(i, html.indexOf("\n}", i) + 2); };
const bron = [
  "const _HEADS=[],_ANCH=[],PROSE=[];",
  fnSrc("escRe"), fnSrc("findFrom"), fnSrc("headingSet"), fnSrc("anchorSet"),
  fnSrc("sectieVan"), fnSrc("proseLines"),
  blok("// ===== <<CITAAT-LOGICA>>", "// ===== <</CITAAT-LOGICA>>"),
  blok("// ---- Demo-modus: zelf een passage kiezen", "const DEMO_NOOT="),
  "return {kiesDemoPassage,citationFor,proseLines,DEMO_DUURVRAAG};",
].join("\n");
const D = new Function("CORPUS", "tokenize", "bm25idf", "PRIJSVRAAG", "TOPK", "DF", bron)(
  core.CORPUS, core.tokenize, core.bm25idf, core.PRIJSVRAAG, core.weights.TOPK, true);

const kort = u => u.replace("https://www.nederlandwereldwijd.nl", "");
const soepel = s => (s || "").replace(/[   ]/g, " ").replace(/[“”„]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, "-");
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const bevat = (hooi, naald) => {
  const h = soepel(hooi), n = soepel(naald).trim();
  return h.includes(n) || new RegExp(n.split(/\s+/).map(escRe).join("\\s+")).test(h);
};

let nieuw = 0, oud = 0, gekozen = 0;
// Vragen naar een bedrag of termijn apart: daar zat de oude demo er het vaakst naast, want het
// bedrag staat zelden in de openingsalinea.
const isWaardeVraag = q => core.PRIJSVRAAG.test(q) || D.DEMO_DUURVRAAG.test(q);
const waarde = { n: 0, oud: 0, nieuw: 0 };
const mis = [];
for (const v of vragen) {
  const cands = await retrieve(core, v.q, core.weights.TOPK);
  if (!cands.length) { mis.push({ v, waarom: "geen kandidaten" }); continue; }
  const oudTekst = D.proseLines(cands[0]).slice(0, 2).join("\n");
  const oudGoed = v.antwoord.every(n => bevat(oudTekst, n));
  if (oudGoed) oud++;
  const wv = isWaardeVraag(v.q);
  if (wv) { waarde.n++; if (oudGoed) waarde.oud++; }
  const keus = D.kiesDemoPassage(v.q, cands);
  const delen = keus ? keus.delen.map(d => D.citationFor(keus.idx, d)).filter(Boolean) : [];
  const cit = delen.length ? { text: delen.map(c => c.text).join("\n") } : null;
  if (cit) gekozen++;
  if (cit && v.antwoord.every(n => bevat(cit.text, n))) { nieuw++; if (wv) waarde.nieuw++; }
  else mis.push({ v, oudGoed, antw: v.antwoord, waarom: cit ? `koos ${kort(core.CORPUS[keus.idx].url)} (plek ${keus.rang + 1})` : "geen citaat", tekst: cit && cit.text });
}

const n = vragen.length, pct = x => (100 * x / n).toFixed(0) + "%";
console.log(`Set ${setArg} | ${n} standaardvragen | ${NO_SEM ? "alleen trefwoorden" : "met semantiek"}\n`);
console.log(`Oude demo (begin van de beste pagina): antwoord staat erin bij ${oud}/${n} = ${pct(oud)}`);
console.log(`Nieuwe demo (gekozen passage)        : antwoord staat erin bij ${nieuw}/${n} = ${pct(nieuw)}`);
console.log(`                                       een citaat bij ${gekozen}/${n}`);
console.log(`\nVragen naar een bedrag of termijn (${waarde.n}): oud ${waarde.oud}, nieuw ${waarde.nieuw}`);
if (TOON_MIS) for (const m of mis.filter(m => !process.argv.includes("--regressie") || m.oudGoed)) {
  console.log(`\n - "${m.v.q}"  (hoort: ${kort(m.v.pagina)}; antwoord: ${JSON.stringify(m.antw)})\n   ${m.waarom}`);
  if (m.tekst) console.log("   » " + m.tekst.replace(/\n/g, " / ").slice(0, 160));
}

// De drempel staat met marge onder de gemeten waarde: 70/103 (68%) met alleen trefwoorden, waar
// de oude demo 64/103 haalde. Zakt de nieuwe keuze onder de oude, dan is hij geen verbetering meer.
const GATE = Number(process.env.GATE_DEMO || 0.63);
if (process.argv.includes("--gate")) {
  if (nieuw / n < GATE) { console.error(`\nGATE GEFAALD: ${nieuw}/${n} (eis ${(GATE * 100).toFixed(0)}%)`); process.exit(1); }
  console.log(`\nGATE OK (>= ${(GATE * 100).toFixed(0)}%)`);
}
