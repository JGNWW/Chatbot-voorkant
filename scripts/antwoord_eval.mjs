// Criticus voor het ANTWOORD, niet alleen voor de zoeklaag.
//
// eval.mjs meet of de juiste pagina gevonden wordt. Dat is maar de helft: op "wat kost een
// paspoort?" stond de juiste pagina al op plek 1, en tóch kreeg de voorlichter "Wij hebben geen
// informatie over dit onderwerp" — omdat het antwoord in een TABEL stond en de citaatlogica
// daar geen citaat van kon maken. Zo'n fout is met een zoek-eval onzichtbaar.
//
// Dit harnas loopt per standaardvraag de hele keten na die zonder sleutel te meten is:
//
//   1. ZOEKEN     — staat de pagina met het antwoord in de top 6 van de echte zoeker?
//   2. CITEREN    — wijst iemand de regel met het antwoord aan, levert de citaatlogica dan een
//                   citaat op? (dit is de stap die stilzwijgend "geen informatie" opleverde)
//   3. COMPLEET   — staat het ANTWOORD zelf (het bedrag, de termijn, de zin) er letterlijk in?
//   4. LEESBAAR   — is het citaat letterlijk uit de bron, niet zwak (een los kopje), en eindigt
//                   het niet midden in een zin?
//
// Wat dit NIET meet: welke passage het taalmodel kiest. Daar is een sleutel voor nodig; zie
// scripts/gauntlet.mjs. Wat hier faalt, kan het model met geen mogelijkheid goedmaken — de app
// gooit het antwoord dan weg voordat de voorlichter het ziet.
//
// Gebruik:
//   node scripts/antwoord_eval.mjs              volledig (laadt het embeddingmodel voor stap 1)
//   node scripts/antwoord_eval.mjs --no-sem     alleen de trefwoordlaag (snel, voor CI)
//   node scripts/antwoord_eval.mjs --gate       faalt (exit 1) onder de drempels
//   node scripts/antwoord_eval.mjs --json       machineleesbaar
//   node scripts/antwoord_eval.mjs --set=<bestand>
import fs from "fs";
import { loadCore, loadCorpus, loadSemantic, retrieve } from "./corelib.mjs";

const NO_SEM = process.argv.includes("--no-sem");
const JSON_OUT = process.argv.includes("--json");
const setArg = (process.argv.find(a => a.startsWith("--set=")) || "").slice(6) || "standaardvragen.json";
const dataDir = new URL("../docs/data/", import.meta.url).pathname.replace(/\/$/, "");
const TOPK = 6;

const vragen = JSON.parse(fs.readFileSync(new URL("./" + setArg, import.meta.url), "utf-8"));
const core = loadCore();
loadCorpus(core);
if (!NO_SEM) await loadSemantic(core, dataDir);

// De citaatlogica komt uit docs/index.html, net als in scripts/quote_test.mjs: test en app
// gebruiken zo gegarandeerd dezelfde code, er is geen kopie die kan verlopen.
const html = fs.readFileSync(new URL("../docs/index.html", import.meta.url), "utf-8");
const A = html.indexOf("// ===== <<CITAAT-LOGICA>>"), Bm = html.indexOf("// ===== <</CITAAT-LOGICA>>");
if (A < 0 || Bm < 0) { console.error("CITAAT-LOGICA-blok niet gevonden in docs/index.html"); process.exit(1); }
const fnSrc = (naam) => { const i = html.indexOf("function " + naam + "("); return html.slice(i, html.indexOf("\n}", i) + 2); };
const Q = new Function(fnSrc("escRe") + "\n" + fnSrc("findFrom") + "\n" + html.slice(A, Bm) +
  "\nreturn {buildUnits,buildCitation,locateSpan,isWeakQuote,quoteParagraphs};")();

const kort = u => u.replace("https://www.nederlandwereldwijd.nl", "");
const paginaVan = url => core.CORPUS.find(p => p.url.replace(/\/+$/, "") === url.replace(/\/+$/, ""));
const headsVan = p => new Set((p.headings || []).map(h => (h[1] || "").trim()).filter(Boolean));
const ankersVan = p => new Set((p.links || []).map(l => (Array.isArray(l) ? l[0] : l || "").trim()).filter(Boolean));

// De site schrijft harde spaties (U+00A0) middenin zinnen, en aanhalingstekens en streepjes in
// meerdere vormen. De app trekt dat gelijk voor het VERGELIJKEN (normForMatch); dit harnas moet
// dat ook doen, anders meet het zijn eigen tekenverschillen in plaats van de citaatlogica.
// Elke vervanging is één teken voor één teken, dus de posities blijven kloppen.
const soepel = s => (s || "").replace(/[\u00a0\u2007\u202f]/g, " ").replace(/[“”„]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, "-");
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function vind(text, naald) {
  const t = soepel(text), n = soepel(naald).trim();
  const i = t.indexOf(n);
  if (i >= 0) return { i, len: n.length };
  const m = new RegExp(n.split(/\s+/).map(escRe).join("\\s+")).exec(t);
  return m ? { i: m.index, len: m[0].length } : null;
}
const bevat = (hooi, naald) => soepel(hooi).includes(soepel(naald).trim()) || !!vind(hooi, naald);

// De aanwijzing van het model nagebootst: het wijst de REGEL aan waar het antwoord in staat.
// Precies zoals in de app bepaalt daarna de citaatlogica de definitieve grenzen.
function regelSpan(text, naald) {
  const g = vind(text, naald);
  if (!g) return null;
  const s = text.lastIndexOf("\n", g.i) + 1;
  let e = text.indexOf("\n", g.i + g.len);
  if (e < 0) e = text.length;
  return { start: s, end: e };
}

const uitslag = [];
for (const v of vragen) {
  const p = paginaVan(v.pagina);
  const r = { q: v.q, pagina: kort(v.pagina), zoeken: false, citaat: false, compleet: false, leesbaar: false };
  if (!p) { r.fout = "pagina staat niet in het corpus"; uitslag.push(r); continue; }

  // Zelfcontrole op de testset: een antwoord dat niet letterlijk op de pagina staat, is geen eis
  // maar een fout in de test. Die moet luid falen, anders meet dit harnas zichzelf goed.
  const ontbreekt = (v.antwoord || []).filter(n => !bevat(p.text, n));
  if (!v.antwoord || !v.antwoord.length || ontbreekt.length) {
    r.fout = "TESTSET-FOUT: staat niet letterlijk op de pagina: " + JSON.stringify(ontbreekt);
    uitslag.push(r); continue;
  }

  // 1. ZOEKEN
  const top = (await retrieve(core, v.q, TOPK)).map(i => core.CORPUS[i].url.replace(/\/+$/, ""));
  r.plek = top.indexOf(v.pagina.replace(/\/+$/, "")) + 1;
  r.zoeken = r.plek > 0;
  if (!r.zoeken) r.top3 = top.slice(0, 3).map(kort);

  // 2-4. CITEREN, COMPLEET, LEESBAAR — per antwoordfragment: wijs de regel aan en bouw het citaat.
  const heads = headsVan(p), ankers = ankersVan(p);
  const units = Q.buildUnits(p.text, ankers, heads);
  let citaat = null;
  for (const naald of v.antwoord) {
    const span = regelSpan(p.text, naald);
    const cit = span && Q.buildCitation(p.text, span, heads, ankers, { units });
    if (!cit) { citaat = null; break; }
    if (!citaat) citaat = cit;
    else citaat = cit.text.length > citaat.text.length ? cit : citaat;   // het ruimste citaat telt
  }
  r.citaat = !!citaat;
  if (citaat) {
    r.tekst = citaat.text;
    r.compleet = v.antwoord.every(n => bevat(citaat.text, n));
    const laatste = citaat.text.trim().split("\n").pop().trim();
    const heleZin = /[.!?][)"'”’]?$/.test(laatste);
    const tabelOfLijst = citaat.text.includes("\n");     // meerregelig: tabel of opsomming
    r.leesbaar = p.text.includes(citaat.text) && !Q.isWeakQuote(citaat.text) && (heleZin || tabelOfLijst);
    r.woorden = (citaat.text.match(/\S+/g) || []).length;
  }
  r.goed = r.zoeken && r.citaat && r.compleet && r.leesbaar;
  uitslag.push(r);
}

const n = uitslag.length;
const tel = k => uitslag.filter(x => x[k]).length;
const goed = tel("goed");
const testsetFouten = uitslag.filter(x => (x.fout || "").startsWith("TESTSET-FOUT"));

if (JSON_OUT) {
  console.log(JSON.stringify({ set: setArg, n, sem: !NO_SEM, goed: goed / n, uitslag }, null, 1));
} else {
  console.log(`Set ${setArg} | ${n} standaardvragen | ${NO_SEM ? "alleen trefwoorden" : "met semantiek"}\n`);
  console.log(`1. gevonden in top ${TOPK} : ${tel("zoeken")}/${n}`);
  console.log(`2. citaat gelukt         : ${tel("citaat")}/${n}`);
  console.log(`3. antwoord staat erin   : ${tel("compleet")}/${n}`);
  console.log(`4. leesbaar en letterlijk: ${tel("leesbaar")}/${n}`);
  console.log(`\nVOLLEDIG GOED: ${goed}/${n} = ${(100 * goed / n).toFixed(0)}%`);
  const mis = uitslag.filter(x => !x.goed);
  if (mis.length) {
    console.log(`\nMissers (${mis.length}):`);
    for (const x of mis) {
      const waarom = x.fout ? x.fout
        : !x.zoeken ? `niet in top ${TOPK} (kreeg: ${(x.top3 || []).join(", ")})`
        : !x.citaat ? "geen citaat: de citaatlogica gooit de passage weg"
        : !x.compleet ? "citaat mist het antwoord zelf"
        : "citaat niet leesbaar/letterlijk";
      console.log(` - "${x.q}"\n     ${kort(x.pagina)} -> ${waarom}`);
    }
  }
}

// Twee regressie-gates, want er zitten twee verschillende soorten fouten in.
//
// GATE_CITAAT (standaard 100%) gaat over de stappen 2 tot en met 4: staat de pagina eenmaal
// vast, dan MOET het antwoord eruit te citeren zijn. Faalt dat, dan krijgt de voorlichter "Wij
// hebben geen informatie over dit onderwerp" terwijl het antwoord op de pagina staat. Daar is
// geen acceptabel percentage voor; 100% of het is stuk.
//
// GATE_ANTWOORD gaat over de hele keten, dus inclusief zoeken. In CI draait dit harnas zonder
// het embeddingmodel (--no-sem), precies zoals eval.mjs: dan blijven er twee vragen liggen die
// mét semantiek wél goed gaan. De drempel staat daar met marge onder.
const GATE_CITAAT = Number(process.env.GATE_CITAAT || 1.0);
const GATE = Number(process.env.GATE_ANTWOORD || (NO_SEM ? 0.97 : 1.0));
if (process.argv.includes("--gate")) {
  if (testsetFouten.length) {
    console.error(`\nGATE GEFAALD: ${testsetFouten.length} vragen in de testset verwijzen naar tekst die niet op de pagina staat.`);
    process.exit(1);
  }
  const citeerbaar = uitslag.filter(x => x.citaat && x.compleet && x.leesbaar).length;
  if (citeerbaar / n < GATE_CITAAT) {
    console.error(`\nGATE GEFAALD: ${citeerbaar}/${n} vragen leveren een compleet, leesbaar citaat op (eis ${(GATE_CITAAT * 100).toFixed(0)}%)`);
    process.exit(1);
  }
  if (goed / n < GATE) {
    console.error(`\nGATE GEFAALD: ${goed}/${n} volledig goed (eis ${(GATE * 100).toFixed(0)}%)`);
    process.exit(1);
  }
  console.log(`\nGATE OK (citaat 100%, volledig goed >= ${(GATE * 100).toFixed(0)}%)`);
}
