// Meet hoe LETTERLIJK het volledig generatieve antwoord is: hoeveel van wat er op het scherm komt
// staat woord voor woord in de aangehaalde passage, en hoeveel heeft het model zelf herschreven?
//
// WAAROM: de prompt vraagt sinds build 110 om een zin letterlijk over te nemen als dat kan, in
// plaats van er een generatief laagje overheen te gooien. Of een model daar ook naar luistert, is
// geen kwestie van mening — dat is te tellen. Dit bestand telt het, vóór en na.
//
// Gebruik (een echte sleutel is nodig; er wordt echt een model aangeroepen):
//   GEMINI_KEY=...  node scripts/letterlijk_eval.mjs --n=25
//   GEMINI_KEY=...  node scripts/letterlijk_eval.mjs --n=25 --zonder   (zonder de nieuwe regel)
//   MISTRAL_KEY=... node scripts/letterlijk_eval.mjs --provider=mistral --model=mistral-small-latest
//   node scripts/letterlijk_eval.mjs --zelftest    (alleen de meetlat controleren, geen sleutel)
//
// De systeemprompt wordt uit docs/index.html geknipt, niet overgetypt: test en app kunnen dus
// niet uit elkaar lopen. --zonder haalt precies dat ene regelblok eruit, zodat het verschil dat
// je meet ook echt door die regel komt en niet door een half nagetypte prompt.
import fs from "fs";

const arg = (naam, standaard) => {
  const m = process.argv.find(a => a.startsWith("--" + naam + "="));
  return m ? m.slice(naam.length + 3) : standaard;
};
const ZONDER = process.argv.includes("--zonder");
const ZELFTEST = process.argv.includes("--zelftest");
const N = Number(arg("n", 25));
const PROVIDER = arg("provider", "gemini");
const MODEL = arg("model", PROVIDER === "gemini" ? "gemini-2.5-flash" : "mistral-small-latest");
const PAUZE = Number(arg("pauze", 1200));   // ms tussen twee aanroepen; gratis sleutels zijn krap

// ---- de meetlat -----------------------------------------------------------------------------
// Letterlijk = een aaneengesloten reeks woorden die precies zo in de passage staat. Losse woorden
// tellen niet: "u" en "de" komen overal voor en zeggen niets over overnemen. Vanaf MIN_RUN woorden
// op rij is het geen toeval meer maar een overgenomen stuk zin.
const MIN_RUN = 5;
const woordenVan = t => (t || "").toLowerCase()
  .replace(/[“”„‟]/g, '"').replace(/[‘’‚‛]/g, "'").replace(/ /g, " ")
  .split(/[^a-z0-9à-ÿ€%]+/).filter(Boolean);

// Hoeveel woorden van de alinea zitten in een reeks van MIN_RUN of meer die letterlijk in de bron
// staat? Van links naar rechts, steeds de langste reeks pakken die vanaf hier past.
function letterlijkeDekking(alinea, bron) {
  const a = woordenVan(alinea), b = woordenVan(bron);
  if (!a.length) return { dekking: 0, woorden: 0, langste: 0 };
  // Waar begint elk woord in de bron? Scheelt het doorlopen van de hele bron per positie.
  const plek = new Map();
  b.forEach((w, i) => { const l = plek.get(w); if (l) l.push(i); else plek.set(w, [i]); });
  let gedekt = 0, langste = 0, i = 0;
  while (i < a.length) {
    let best = 0;
    for (const j of plek.get(a[i]) || []) {
      let k = 0;
      while (i + k < a.length && j + k < b.length && a[i + k] === b[j + k]) k++;
      if (k > best) best = k;
    }
    if (best >= MIN_RUN) { gedekt += best; if (best > langste) langste = best; i += best; }
    else i++;
  }
  return { dekking: gedekt / a.length, woorden: a.length, langste };
}
// Staat de hele alinea zo in de bron? Dan is er niets herschreven.
function heelLetterlijk(alinea, bron) {
  const a = woordenVan(alinea).join(" "), b = woordenVan(bron).join(" ");
  return a.length > 0 && b.includes(a);
}

if (ZELFTEST) {
  const bron = "U vraagt uw paspoort aan bij de ambassade of het consulaat. Maak daarvoor eerst een afspraak.";
  const eis = (ok, wat) => console.log((ok ? "  ✓ " : "  ✗ ") + wat);
  console.log("\nMEETLAT\n");
  eis(heelLetterlijk("Maak daarvoor eerst een afspraak.", bron), "letterlijke zin telt als heel letterlijk");
  eis(!heelLetterlijk("Maak eerst een afspraak.", bron), "ingekorte zin telt niet als heel letterlijk");
  eis(letterlijkeDekking("U vraagt uw paspoort aan bij de ambassade of het consulaat.", bron).dekking === 1,
    "letterlijke zin heeft dekking 1,00");
  eis(letterlijkeDekking("Voor een paspoort moet u langs een balie.", bron).dekking === 0,
    "eigen formulering heeft dekking 0,00");
  const half = letterlijkeDekking("Let op: u vraagt uw paspoort aan bij de ambassade of het consulaat, en dat kost tijd.", bron);
  eis(half.dekking > 0.5 && half.dekking < 1, `deels overgenomen zin zit ertussenin (${half.dekking.toFixed(2)})`);
  console.log("\nDe meetlat werkt. Voor een echte meting is een sleutel nodig:");
  console.log("  GEMINI_KEY=... node scripts/letterlijk_eval.mjs --n=25\n");
  process.exit(0);
}

// ---- de prompt uit de app halen -------------------------------------------------------------
const html = fs.readFileSync(new URL("../docs/index.html", import.meta.url), "utf-8");
const knip = (start, eind) => {
  const a = html.indexOf(start); if (a < 0) { console.error("niet gevonden: " + start); process.exit(1); }
  const b = html.indexOf(eind, a + start.length); return html.slice(a + start.length, b);
};
let SYSTEM = knip("const GENERATIEF_SYSTEM=`", "`;");
const REGEL_START = "- Staat het antwoord al goed in een passage?";
const REGEL_EIND = "\n- Elke alinea MOET verwijzen";
if (SYSTEM.indexOf(REGEL_START) < 0) { console.error("de letterlijk-regel staat niet in GENERATIEF_SYSTEM"); process.exit(1); }
if (ZONDER) {
  SYSTEM = SYSTEM.slice(0, SYSTEM.indexOf(REGEL_START)) + SYSTEM.slice(SYSTEM.indexOf(REGEL_EIND) + 1);
  // Die ene bijzin hoort bij dezelfde wijziging; laat je hem staan, dan meet je het verschil niet zuiver.
  SYSTEM = SYSTEM.replace(" Dat mag ook de letterlijke openingszin van de passage zijn.", "");
}

// ---- de passages: precies de citaten die de app zou tonen ------------------------------------
const A = html.indexOf("// ===== <<CITAAT-LOGICA>>"), B = html.indexOf("// ===== <</CITAAT-LOGICA>>");
const fn = (naam) => { const i = html.indexOf("function " + naam + "("); return html.slice(i, html.indexOf("\n}", i) + 2); };
const Q = new Function(fn("escRe") + "\n" + fn("findFrom") + "\n" + html.slice(A, B) +
  "\nreturn {buildUnits,buildCitation,locateSpan,normForMatch};")();

const corpus = JSON.parse(fs.readFileSync(new URL("../docs/data/corpus.json", import.meta.url), "utf-8"));
const ankers = JSON.parse(fs.readFileSync(new URL("./eval_ankers.json", import.meta.url), "utf-8"));
const pad = u => (u || "").replace("https://www.nederlandwereldwijd.nl", "").replace(/\/+$/, "");
const perPad = new Map(corpus.map((p, i) => [pad(p.url), i]));

const gevallen = [];
for (const a of ankers) {
  if (gevallen.length >= N) break;
  const i = perPad.get(a.url); if (i === undefined) continue;
  const tekst = corpus[i].text || "";
  const span = Q.locateSpan(tekst, a.anker); if (!span) continue;
  const heads = new Set((corpus[i].headings || []).map(h => (h[1] || "").trim()).filter(Boolean));
  const anch = new Set((corpus[i].links || []).map(l => (Array.isArray(l) ? l[0] : l || "").trim()).filter(Boolean));
  const cit = Q.buildCitation(tekst, span, heads, anch);
  if (cit && cit.text) gevallen.push({ q: a.q, passage: cit.text });
}
if (!gevallen.length) { console.error("geen bruikbare ankers"); process.exit(1); }

// ---- het model aanroepen --------------------------------------------------------------------
const KEY = PROVIDER === "gemini" ? process.env.GEMINI_KEY : process.env.MISTRAL_KEY;
if (!KEY) {
  console.error(`Geen sleutel. Zet ${PROVIDER === "gemini" ? "GEMINI_KEY" : "MISTRAL_KEY"} in de omgeving,`);
  console.error("of draai eerst 'node scripts/letterlijk_eval.mjs --zelftest' om de meetlat te controleren.");
  process.exit(1);
}
async function vraagModel(system, user) {
  if (PROVIDER === "gemini") {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(KEY)}`;
    const body = { systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 8000, responseMimeType: "application/json",
        ...(MODEL.includes("2.5") ? { thinkingConfig: { thinkingBudget: 0 } } : {}) } };
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(r.status + " " + (await r.text()).slice(0, 200));
    const j = await r.json();
    return (j.candidates?.[0]?.content?.parts || []).map(p => p.text || "").join("");
  }
  const r = await fetch("https://api.mistral.ai/v1/chat/completions", {
    method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + KEY },
    body: JSON.stringify({ model: MODEL, temperature: 0, response_format: { type: "json_object" },
      messages: [{ role: "system", content: system }, { role: "user", content: user }] }) });
  if (!r.ok) throw new Error(r.status + " " + (await r.text()).slice(0, 200));
  return (await r.json()).choices[0].message.content;
}

// ---- meten ----------------------------------------------------------------------------------
console.log(`\nLETTERLIJKHEID VAN HET GENERATIEVE ANTWOORD`);
console.log(`${PROVIDER} / ${MODEL} | ${gevallen.length} vragen | prompt ${ZONDER ? "ZONDER" : "MET"} de letterlijk-regel\n`);

let nAlineas = 0, nHeel = 0, somDekking = 0, nMislukt = 0, somWoorden = 0;
const voorbeelden = [];
for (const g of gevallen) {
  let tekst;
  try { tekst = await vraagModel(SYSTEM, "Vraag:\n" + g.q + "\n\nPassages:\n[1] " + g.passage); }
  catch (e) { nMislukt++; console.log("  ! " + g.q.slice(0, 50) + " — " + e.message.slice(0, 80)); continue; }
  let alineas;
  try { alineas = JSON.parse(tekst.replace(/^```(?:json)?|```$/g, "").trim()).alineas || []; }
  catch (e) { nMislukt++; continue; }
  for (const a of alineas) {
    const t = ((a && a.tekst) || "").trim(); if (!t) continue;
    const d = letterlijkeDekking(t, g.passage);
    nAlineas++; somDekking += d.dekking; somWoorden += d.woorden;
    if (heelLetterlijk(t, g.passage)) nHeel++;
    else if (voorbeelden.length < 5 && d.dekking < 0.5) voorbeelden.push({ q: g.q, t, p: g.passage, d: d.dekking });
  }
  process.stderr.write(".");
  if (PAUZE) await new Promise(r => setTimeout(r, PAUZE));
}
process.stderr.write("\n\n");
if (!nAlineas) { console.error("geen enkele alinea gemeten"); process.exit(1); }
console.log(`  alinea's gemeten          : ${nAlineas} (${somWoorden} woorden, ${nMislukt} vragen mislukt)`);
console.log(`  volledig letterlijk       : ${(nHeel / nAlineas * 100).toFixed(1)}%  (${nHeel} van ${nAlineas})`);
console.log(`  gemiddelde dekking        : ${(somDekking / nAlineas * 100).toFixed(1)}%  van de woorden staat woord voor woord in de passage`);
if (voorbeelden.length) {
  console.log(`\nHerschreven terwijl het letterlijk had gekund (of niet — kijk zelf):`);
  for (const v of voorbeelden) {
    console.log(`\n  vraag  : ${v.q}`);
    console.log(`  bron   : ${v.p.replace(/\s+/g, " ").slice(0, 160)}`);
    console.log(`  model  : ${v.t.slice(0, 160)}   [dekking ${(v.d * 100).toFixed(0)}%]`);
  }
}
console.log("");
