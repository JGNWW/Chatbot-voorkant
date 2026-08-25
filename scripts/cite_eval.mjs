// Meet de KEUZE en de KWALITEIT van het citaat, niet alleen de keuze van de pagina.
//
// scripts/eval.mjs meet of de juiste PAGINA in de top 6 staat. scripts/quote_test.mjs meet of de
// citaatlogica zich netjes gedraagt op verzonnen voorbeelden. Daartussen zat een gat: als de
// juiste pagina gevonden is, kan de app de passage die de vraag beantwoordt dan ook echt als
// compleet, letterlijk citaat op het scherm zetten? Dat meet dit bestand, op de 126 echte
// testvragen met de ankers uit scripts/eval_ankers.json.
//
// Gebruik:
//   node scripts/gen_ankers.mjs > /dev/null    (eenmalig: ankers voorstellen)
//   node scripts/cite_eval.mjs                 (alle ankers)
//   node scripts/cite_eval.mjs --zeker         (alleen de ankers met score >= 0,50)
//   node scripts/cite_eval.mjs --gate          (exit 1 onder de drempels, voor CI)
//
// WAT DIT NIET MEET: welke passage het TAALMODEL kiest. Dat vergt een sleutel en een echte
// aanroep. Dit meet de bovengrens: kan de machinerie het juiste antwoord überhaupt leveren?
// Zakt dit cijfer, dan helpt een beter model niet meer.
import fs from "fs";

const ALLEEN_ZEKER = process.argv.includes("--zeker");
const html = fs.readFileSync(new URL("../docs/index.html", import.meta.url), "utf-8");

// Dezelfde truc als quote_test.mjs: de echte code uit de app knippen, zodat test en app niet
// uit elkaar kunnen lopen.
const A = html.indexOf("// ===== <<CITAAT-LOGICA>>");
const B = html.indexOf("// ===== <</CITAAT-LOGICA>>");
if (A < 0 || B < 0) { console.error("CITAAT-LOGICA-blok niet gevonden in docs/index.html"); process.exit(1); }
const fn = (naam) => { const i = html.indexOf("function " + naam + "("); return html.slice(i, html.indexOf("\n}", i) + 2); };
const Q = new Function(
  fn("escRe") + "\n" + fn("findFrom") + "\n" + html.slice(A, B) +
  "\nreturn {buildUnits,buildCitation,locateSpan,isWeakQuote,normForMatch};"
)();

const corpus = JSON.parse(fs.readFileSync(new URL("../docs/data/corpus.json", import.meta.url), "utf-8"));
const ankers = JSON.parse(fs.readFileSync(new URL("./eval_ankers.json", import.meta.url), "utf-8"));
const pad = u => (u || "").replace("https://www.nederlandwereldwijd.nl", "").replace(/\/+$/, "");
const perPad = new Map(corpus.map((p, i) => [pad(p.url), i]));

const set = ALLEEN_ZEKER ? ankers.filter(a => a.zeker) : ankers;
const woorden = t => (t || "").split(/\s+/).filter(Boolean).length;

let n = 0, letterlijk = 0, gevonden = 0, bereikbaar = 0, compleet = 0, bevat = 0;
const overschot = [];
const stuk = { geenPagina: [], nietLetterlijk: [], geenSpan: [], geenCitaat: [], nietCompleet: [], teRuim: [] };

for (const a of set) {
  const i = perPad.get(a.url);
  if (i === undefined) { stuk.geenPagina.push(a.q); continue; }
  n++;
  const tekst = corpus[i].text || "";

  // 1. Staat het anker letterlijk op de pagina? Zo niet, deugt de TESTDATA niet — dat is een
  //    bevinding over het anker, niet over de app.
  const losseSpaties = s => s.replace(/\s+/g, " ").trim();
  const platteTekst = losseSpaties(tekst);
  if (!platteTekst.includes(losseSpaties(a.anker))) { stuk.nietLetterlijk.push(a.q); continue; }
  letterlijk++;

  // 2. Vindt de app de passage terug? Dit is precies wat askAI doet als het model een quote geeft.
  const span = Q.locateSpan(tekst, a.anker);
  if (!span) { stuk.geenSpan.push(a.q); continue; }
  gevonden++;

  const heads = new Set((corpus[i].headings || []).map(h => (h[1] || "").trim()).filter(Boolean));
  const anch = new Set((corpus[i].links || []).map(l => (Array.isArray(l) ? l[0] : l || "").trim()).filter(Boolean));
  const cit = Q.buildCitation(tekst, span, heads, anch);
  if (!cit || !cit.text) { stuk.geenCitaat.push(a.q); continue; }
  bereikbaar++;

  // 3. Is wat eruit komt een compleet, letterlijk citaat? Dezelfde harde eis als in de app.
  const heelZin = /[.!?:]$/.test(cit.text.trim()) || cit.text.trim().endsWith("…") === false && /[.!?:)]$/.test(cit.text.trim());
  const isLetterlijk = platteTekst.includes(losseSpaties(cit.text));
  const zwak = Q.isWeakQuote ? Q.isWeakQuote(cit.text) : false;
  if (isLetterlijk && heelZin && !zwak) compleet++; else stuk.nietCompleet.push(a.q);

  // 4. Zit het anker er ook echt in? Anders heeft de app wel een net citaat gemaakt, maar van
  //    de verkeerde passage.
  if (losseSpaties(cit.text).includes(losseSpaties(a.anker))) bevat++;

  // 5. Hoeveel EXTRA tekst komt er mee? Een citaat dat drie keer zo lang is als het antwoord
  //    laat de voorlichter zoeken in wat hij moet voorlezen.
  const ratio = woorden(cit.text) / Math.max(1, woorden(a.anker));
  overschot.push(ratio);
  if (ratio > 3) stuk.teRuim.push(a.q + "  (" + ratio.toFixed(1) + "x)");
}

const pct = (x, t) => t ? (x / t * 100).toFixed(0) + "%" : "—";
const med = arr => { if (!arr.length) return 0; const s = arr.slice().sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

console.log(`Ankers: ${set.length}${ALLEEN_ZEKER ? " (alleen score >= 0,50)" : ""} | pagina gevonden: ${n}`);
console.log(`  anker staat letterlijk op de pagina : ${letterlijk}/${n} = ${pct(letterlijk, n)}`);
console.log(`  app vindt de passage terug          : ${gevonden}/${letterlijk} = ${pct(gevonden, letterlijk)}`);
console.log(`  er komt een citaat uit              : ${bereikbaar}/${gevonden} = ${pct(bereikbaar, gevonden)}`);
console.log(`  citaat is compleet en letterlijk    : ${compleet}/${bereikbaar} = ${pct(compleet, bereikbaar)}`);
console.log(`  citaat bevat het hele anker         : ${bevat}/${bereikbaar} = ${pct(bevat, bereikbaar)}`);
console.log(`  lengte t.o.v. het anker (mediaan)   : ${med(overschot).toFixed(1)}x`);

const toon = (naam, arr) => { if (arr.length) console.log(`\n${naam} (${arr.length}):\n  - ` + arr.slice(0, 8).join("\n  - ") + (arr.length > 8 ? `\n  ... en ${arr.length - 8} meer` : "")); };
toon("Anker staat NIET letterlijk op de pagina (testdata deugt niet)", stuk.nietLetterlijk);
toon("App vindt de passage niet terug", stuk.geenSpan);
toon("Passage gevonden, maar er komt geen citaat uit", stuk.geenCitaat);
toon("Citaat is niet compleet", stuk.nietCompleet);
toon("Citaat is meer dan 3x zo lang als het anker", stuk.teRuim);
if (stuk.geenPagina.length) toon("Verwachte pagina niet in het corpus", stuk.geenPagina);

// Regressie-gate. Drempels met marge onder de gemeten waarden (97% en 100% op 20-08-2026);
// net als bij eval.mjs te overschrijven met omgevingsvariabelen.
const G_BEREIK = Number(process.env.GATE_BEREIK || 0.92), G_COMPLEET = Number(process.env.GATE_COMPLEET || 0.98);
if (process.argv.includes("--gate")) {
  const b = letterlijk ? bereikbaar / letterlijk : 0, c = bereikbaar ? compleet / bereikbaar : 0;

  if (b < G_BEREIK || c < G_COMPLEET) {
    console.error(`\nGATE GEFAALD: terugvinden ${pct(bereikbaar, letterlijk)} (eis ${G_BEREIK * 100}%), compleet ${pct(compleet, bereikbaar)} (eis ${G_COMPLEET * 100}%)`);
    process.exit(1);
  }
  console.log(`\nGATE OK (terugvinden >= ${G_BEREIK * 100}%, compleet >= ${G_COMPLEET * 100}%)`);
}
