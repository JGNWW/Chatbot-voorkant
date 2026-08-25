// Stelt per testvraag een ANKER voor: de passage op de verwachte pagina die de vraag beantwoordt.
// Gebruik: node scripts/gen_ankers.mjs > /dev/null   (schrijft scripts/eval_ankers.json)
//
// WAAROM APART VAN eval_set.json: deze ankers zijn door een machine VOORGESTELD, niet door een
// mens gecontroleerd. Ze staan daarom in een eigen bestand, met per anker een score, zodat je
// kunt zien welke betrouwbaar zijn en welke nog nagelopen moeten worden. Het is een startpunt
// voor handwerk, geen waarheid.
//
// HOE: de zin (of het zinnenpaar) op de verwachte pagina met de hoogste overlap met de vraag,
// gewogen op zeldzaamheid van de woorden — een zin die "paspoort" deelt zegt minder dan een zin
// die "doorlooptijd" deelt. Zinnen die eruitzien als navigatie vallen af.
import fs from "fs";

const root = new URL("../docs/data/corpus.json", import.meta.url);
const corpus = JSON.parse(fs.readFileSync(root, "utf-8"));
const evalSet = JSON.parse(fs.readFileSync(new URL("./eval_set.json", import.meta.url), "utf-8"));
const OUT = new URL("./eval_ankers.json", import.meta.url);

const STOP = new Set("de het een en van in op te voor met aan is ik je u hoe wat waar wanneer kan moet mijn uw ben wil naar om dat die er ook als of bij dan zijn heb heeft wordt worden".split(" "));
const stem = w => { if (w.length < 5) return w; for (const s of ["ingen", "ing", "heden", "heid", "en", "s"]) if (w.length - s.length >= 4 && w.endsWith(s)) return w.slice(0, -s.length); return w; };
const tok = t => (t || "").toLowerCase().split(/[^a-z0-9à-ÿ]+/).filter(w => w.length > 2 && !STOP.has(w)).map(stem);

// Zeldzaamheid van een woord over het hele corpus: hoe zeldzamer, hoe meer een gedeeld woord zegt.
const DF = new Map();
for (const p of corpus) for (const t of new Set(tok([p.title, p.desc, p.text].join(" ")))) DF.set(t, (DF.get(t) || 0) + 1);
const gewicht = t => Math.log(1 + corpus.length / (1 + (DF.get(t) || 0)));

const pad = u => (u || "").replace("https://www.nederlandwereldwijd.nl", "").replace(/\/+$/, "");
const perPad = new Map();
for (let i = 0; i < corpus.length; i++) perPad.set(pad(corpus[i].url), i);

// Zinnen knippen. De crawler zet elke link op een eigen regel, dus regels die eruitzien als
// navigatie (kort, geen eindleesteken) horen niet in een anker.
// We houden de POSITIE in de brontekst bij. Twee zinnen mogen alleen samengevoegd worden als ze
// in de bron ook echt naast elkaar staan; anders levert het paar een anker op dat nergens
// letterlijk voorkomt, en dan meet je je eigen generator in plaats van de app.
function zinnen(text) {
  const uit = [];
  const bron = text || "";
  let pos = 0;
  for (const regel of bron.split("\n")) {
    const begin = bron.indexOf(regel, pos);
    pos = begin + regel.length;
    const r = regel.trim();
    if (!r) continue;
    if (r.length < 40 && !/[.?!:]$/.test(r)) continue;         // navigatie of los kopje
    let zPos = begin + regel.indexOf(r);
    for (const z of r.split(/(?<=[.!?])\s+(?=[A-ZÀ-Þ])/)) {
      const start = bron.indexOf(z, zPos);
      if (start < 0) continue;
      zPos = start + z.length;
      const t = z.trim();
      if (t.length >= 30) uit.push({ tekst: t, start, eind: start + z.length });
    }
  }
  return uit;
}

function beste(vraag, idx) {
  const qt = [...new Set(tok(vraag))];
  if (!qt.length) return null;
  // Linkteksten zijn geen antwoord. De app weigert ze te citeren (buildCitation kijkt naar
  // dezelfde lijst), dus een anker dat een linktekst is, meet niets — het levert alleen een
  // "geen citaat"-melding op die over de testdata gaat en niet over de app.
  const links = new Set((corpus[idx].links || []).map(l => (Array.isArray(l) ? l[0] : l || "").trim()).filter(Boolean));
  const zs = zinnen(corpus[idx].text).filter(z => !links.has(z.tekst));
  if (!zs.length) return null;
  const maxScore = qt.reduce((a, t) => a + gewicht(t), 0);
  const bron = corpus[idx].text || "";
  let best = null;
  for (let i = 0; i < zs.length; i++) {
    const kandidaten = [zs[i].tekst];
    // Het paar met de opvolger — maar alleen als er in de bron niets tussen staat behalve
    // witruimte. Een antwoord loopt vaak door in de volgende zin.
    if (i + 1 < zs.length && !bron.slice(zs[i].eind, zs[i + 1].start).trim())
      kandidaten.push(bron.slice(zs[i].start, zs[i + 1].eind).trim());
    for (const tekst of kandidaten) {
      const woorden = new Set(tok(tekst));
      const score = qt.filter(t => woorden.has(t)).reduce((a, t) => a + gewicht(t), 0) / maxScore;
      if (!best || score > best.score) best = { tekst, score };
    }
  }
  return best;
}

const uit = [];
let zonder = 0;
for (const { q, expect } of evalSet) {
  // De verwachte pagina: de eerste uit `expect` die we in het corpus terugvinden.
  let idx;
  for (const e of expect) { for (const [p, i] of perPad) if (p.includes(e)) { idx = i; break; } if (idx !== undefined) break; }
  if (idx === undefined) { zonder++; continue; }
  const b = beste(q, idx);
  if (!b) { zonder++; continue; }
  uit.push({
    q, url: pad(corpus[idx].url),
    anker: b.tekst.replace(/\s+/g, " ").trim(),
    score: +b.score.toFixed(3),
    // Boven de 0,5 deelt de zin het grootste deel van het zeldzame vocabulaire van de vraag;
    // dat is doorgaans raak. Daaronder moet een mens ernaar kijken.
    zeker: b.score >= 0.5,
  });
}

uit.sort((a, b) => b.score - a.score);
fs.writeFileSync(OUT, JSON.stringify(uit, null, 1));
const zeker = uit.filter(x => x.zeker).length;
console.error(`geschreven: ${uit.length} ankers -> ${OUT.pathname}`);
console.error(`  ${zeker} met score >= 0,50 (waarschijnlijk raak), ${uit.length - zeker} moeten nagelopen worden`);
if (zonder) console.error(`  ${zonder} vragen zonder anker (pagina niet gevonden of geen bruikbare zin)`);
