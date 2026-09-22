// Meet wat het TAALMODEL kiest en schrijft — het enige stuk van de keten dat nog nergens wordt
// gemeten.
//
// scripts/eval.mjs meet welke PAGINA de zoeklaag vindt. scripts/cite_eval.mjs meet of de
// citaatmachinerie uit een gegeven gouden anker een compleet citaat KAN bouwen (97-100%).
// Daartussen zit de beurt van het antwoordmodel: welke passage kiest het, en sluit de intro en
// de brug die het erbij schrijft wel aan op dat citaat? Dat is wat dit bestand meet.
//
// Er is in deze omgeving GEEN sleutel en er komt er ook geen. De modelbeurt gebeurt daarom
// buiten dit script: `payloads` legt precies neer wat de app zou versturen, iemand anders laat
// het model draaien en zet de JSON terug, en `render` past daar de ECHTE nabewerking van de app
// op toe. Dit script belt dus nooit een provider.
//
// Gebruik:
//   node scripts/gauntlet.mjs payloads                 (fase 1: rerank-payloads)
//   node scripts/gauntlet.mjs payloads --rerank=<map>  (fase 2: antwoordpayloads, met die keuze)
//   node scripts/gauntlet.mjs payloads --turbo         (oude eenstapsweg: rankFor, geen herrangschikking)
//   node scripts/gauntlet.mjs payloads --no-sem        (alleen trefwoordlaag, scheelt het model laden)
//   node scripts/gauntlet.mjs payloads --set=standaardvragen.json --nrs=1,35,90   (steekproef)
//   node scripts/gauntlet.mjs payloads --uit=<map>
//   node scripts/gauntlet.mjs render <antwoordmap>     (leest vraag-01.json … en rendert)
//   node scripts/gauntlet.mjs render <antwoordmap> --payloads=<map> --uit=<map>
import fs from "fs";
import path from "path";

const HTML = fs.readFileSync(new URL("../docs/index.html", import.meta.url), "utf-8");
const WORTEL = new URL("../", import.meta.url).pathname.replace(/\/$/, "");
const arg = n => { const a = process.argv.find(x => x.startsWith("--" + n + "=")); return a ? a.slice(n.length + 3) : ""; };
const absPad = p => (path.isAbsolute(p) ? p : path.join(WORTEL, p));

// ---- gedeeld ---------------------------------------------------------------------------------

// De systeemprompt uit de app lezen in plaats van kopiëren: een losse kopie is binnen een week
// verouderd en dan meet dit harnas iets anders dan de app doet. Zelfde truc als dump_prompts.mjs:
// teken voor teken tot de afsluitende backtick, met \ als ontsnapping.
function promptLiteral(naam) {
  const kop = "const " + naam + "=`";
  const i = HTML.indexOf(kop);
  if (i < 0) return null;
  let j = i + kop.length;
  const start = j;
  while (j < HTML.length) {
    if (HTML[j] === "\\") { j += 2; continue; }
    if (HTML[j] === "`") break;
    j++;
  }
  return HTML.slice(start, j);
}

const kort = u => (u || "").replace("https://www.nederlandwereldwijd.nl", "");
const plat = t => (t || "").replace(/\s+/g, " ").trim();
const nr = n => String(n).padStart(2, "0");

function maakMap(p) { fs.mkdirSync(p, { recursive: true }); return p; }

// ---- 1. payloads -----------------------------------------------------------------------------
//
// WAAROM NIET corelib.retrieve() / rankFor(): dat is het pad ZONDER AI-stappen — de demo- en
// turbomodus. In rankFor is hubCandidates er bewust uit gelaten (zie docs/search-core.js rond
// regel 379), en turbo staat standaard UIT (docs/index.html:1303). Het echte cloudpad
// (docs/index.html:2332-2335) doet: een BREDE lijst van 25 met de bovenliggende hub-pagina's
// erbij, en laat het model daar met RERANK_SYSTEM zes uit kiezen. Juist die hubs zetten de
// algemene pagina in de lijst waar het gouden anker op staat; meet je rankFor, dan lijkt die
// pagina onbereikbaar terwijl de app hem wel degelijk aanbiedt.
//
// Het cloudpad heeft dus TWEE modelbeurten, en er is geen sleutel. Vandaar twee fasen:
//   fase 1  node scripts/gauntlet.mjs payloads                    -> rerank-NN.txt + rerank-index.json
//   fase 2  node scripts/gauntlet.mjs payloads --rerank=<map>     -> vraag-NN.txt + index.json
// Met --turbo krijg je het oude, eenstaps gedrag (rankFor, geen herrangschikking), zodat turbo
// en cloud naast elkaar te meten zijn.
async function payloads() {
  const { loadCore, loadCorpus, loadSemantic, retrieve } = await import("./corelib.mjs");
  const NO_SEM = process.argv.includes("--no-sem");
  const TURBO = process.argv.includes("--turbo");
  const rerankMap = arg("rerank") ? absPad(arg("rerank")) : "";
  const uitMap = maakMap(absPad(arg("uit") || "scratch/gauntlet/payloads"));
  // Welke vragenlijst. aansluiting_set.json is de oorspronkelijke; --set=standaardvragen.json
  // draait hetzelfde harnas op de standaardvragen van de site. Die lijst heeft andere veldnamen
  // (pagina/antwoord in plaats van url/anker), dus die worden hier gelijkgetrokken.
  const setNaam = arg("set") || "aansluiting_set.json";
  const ruw = JSON.parse(fs.readFileSync(new URL("./" + setNaam, import.meta.url), "utf-8"));
  // --nrs=1,7,12 beperkt tot die vragen (1-gebaseerd), zodat een steekproef niet 103 payloads
  // van een halve megabyte oplevert. De nummering blijft die van de volledige lijst.
  const nrs = (arg("nrs") || "").split(",").map(x => Number(x.trim())).filter(Boolean);
  const set = ruw
    .map((v, i) => ({ ...v, nr: i + 1, url: v.url || kort(v.pagina || ""), anker: v.anker || (v.antwoord || [])[0] || "" }))
    .filter(v => !nrs.length || nrs.includes(v.nr));
  const BREED = 25;                                  // zelfde 25 als fuseRetrieval in het cloudpad

  const core = loadCore();
  loadCorpus(core);
  const meta = NO_SEM ? null : await loadSemantic(core);
  const TOPK = core.weights.TOPK;
  const pad = u => (u || "").replace(/\/+$/, "");

  // De brede kandidatenlijst van het cloudpad. fuseRetrieval() zelf staat in docs/index.html en
  // fuseert ook de HyDE- en herformuleringsteksten uit de expansiestap; die vergen een sleutel.
  // core.hybrid() is dezelfde fusie zonder die extra teksten, en hubCandidates() erachter is
  // letterlijk wat de app doet.
  const breedVoor = async q => core.hubCandidates(await core.hybrid(q, [], BREED), q);

  // ---- fase 1: de herrangschikking ------------------------------------------------------------
  if (!TURBO && !rerankMap) {
    const RERANK_SYSTEM = promptLiteral("RERANK_SYSTEM");
    if (!RERANK_SYSTEM) { console.error("RERANK_SYSTEM niet gevonden in docs/index.html — is de naam veranderd?"); process.exit(1); }
    const index = { set: setNaam, model: meta ? meta.model : "geen (alleen trefwoorden)", breed: BREED, topk: TOPK, vragen: [] };
    for (let i = 0; i < set.length; i++) {
      const v = set[i], n = v.nr;
      const breed = await breedVoor(v.q);
      // Exact de lijst uit rerankCandidates: titel op de eerste regel, daaronder desc + tekst tot
      // 300 tekens (de cloudwaarde; 110-140 is de lokale), kandidaten gescheiden door een lege regel.
      const listing = breed.map((idx, k) => {
        const c = core.CORPUS[idx];
        const snip = ((c.desc ? c.desc + " " : "") + (c.text || "")).replace(/\s+/g, " ").slice(0, 300);
        return `[${k}] ${c.title}\n${snip}`;
      }).join("\n\n");
      const user = `Vraag van de burger:\n${v.q}\n\nKandidaat-pagina's:\n${listing}`;

      const bestand = `rerank-${nr(n)}.txt`;
      fs.writeFileSync(path.join(uitMap, bestand),
        `# vraag ${nr(n)}: ${v.q}\n` +
        `# Laat het model hieronder draaien en zet de JSON {"pages":[...]} in <rerankmap>/rerank-${nr(n)}.json\n\n` +
        `===== SYSTEEMPROMPT (RERANK_SYSTEM, uitgelezen uit docs/index.html) =====\n${RERANK_SYSTEM}\n\n` +
        `===== GEBRUIKERSBOODSCHAP =====\n${user}\n`, "utf-8");

      const plek = breed.findIndex(idx => pad(kort(core.CORPUS[idx].url)) === pad(v.url));
      index.vragen.push({
        nr: n, bestand, q: v.q, verwachteUrl: v.url, anker: v.anker, verwachtInBreed: plek,
        breed: breed.map((idx, k) => ({ n: k, url: kort(core.CORPUS[idx].url), titel: core.CORPUS[idx].title, corpusIdx: idx })),
      });
      console.log(`${nr(n)} ${bestand}  ${breed.length} kandidaten  verwachte pagina ${plek >= 0 ? "op nummer [" + plek + "]" : "— NIET in de brede lijst"}`);
    }
    fs.writeFileSync(path.join(uitMap, "rerank-index.json"), JSON.stringify(index, null, 1), "utf-8");
    const raak = index.vragen.filter(v => v.verwachtInBreed >= 0).length;
    console.log(`\n${index.vragen.length} rerank-payloads in ${uitMap} (rerank-index.json erbij)`);
    console.log(`verwachte pagina in de brede lijst: ${raak}/${index.vragen.length}`);
    console.log(`Volgende stap: node scripts/gauntlet.mjs payloads --rerank=<map met rerank-NN.json>`);
    return;
  }

  // ---- fase 2 (of --turbo): de antwoordpayloads ------------------------------------------------
  const SYSTEM = promptLiteral("SYSTEM");
  if (!SYSTEM) { console.error("SYSTEM niet gevonden in docs/index.html — is de naam veranderd?"); process.exit(1); }
  // rerank-index.json hoort in de payloadmap, maar wie fase 2 in een andere --uit-map draait,
  // heeft hem daar niet; dan staat hij meestal naast de rerankantwoorden.
  const rIndexPad = [path.join(uitMap, "rerank-index.json"), path.join(rerankMap || "", "rerank-index.json")].find(p => p && fs.existsSync(p));
  if (rerankMap && !rIndexPad) { console.error("rerank-index.json niet gevonden — draai eerst `node scripts/gauntlet.mjs payloads`"); process.exit(1); }
  const rIndex = rerankMap ? JSON.parse(fs.readFileSync(rIndexPad, "utf-8")) : null;

  const index = { set: setNaam, pad: TURBO ? "turbo (rankFor, geen herrangschikking)" : "cloud (hybrid+hubCandidates+herrangschikking)",
    model: meta ? meta.model : "geen (alleen trefwoorden)", topk: TOPK, vragen: [] };
  for (let i = 0; i < set.length; i++) {
    const v = set[i], n = v.nr;
    let cands, herkomst;
    if (TURBO) {
      cands = await retrieve(core, v.q, TOPK);
      herkomst = "rankFor";
    } else {
      const rij = rIndex.vragen.find(x => x.nr === n);
      const breed = rij.breed.map(k => k.corpusIdx);
      const bestand = path.join(rerankMap, `rerank-${nr(n)}.json`);
      let pages = null;
      if (fs.existsSync(bestand)) { try { pages = leesModelJSON(fs.readFileSync(bestand, "utf-8")).pages; } catch (e) { pages = null; } }
      if (!Array.isArray(pages)) {
        // Zoals de app: mislukt de herrangschikking, dan gaat de brede lijst ongesorteerd door.
        cands = breed.slice(0, TOPK); herkomst = "herrangschikking mislukt -> breed.slice(0,6)";
      } else if (!pages.length) {
        // Ook zoals de app: een lege keuze betekent "geen passende pagina" en er volgt GEEN
        // antwoordbeurt. Dat is een uitkomst, geen fout — hem overslaan zou hem wegpoetsen.
        console.log(`${nr(n)} overgeslagen — het model koos {"pages":[]} (geen passende pagina)`);
        index.vragen.push({ nr: n, q: v.q, verwachteUrl: v.url, anker: v.anker, geenPassendePagina: true, kandidaten: [] });
        continue;
      } else {
        const pick = pages.map(k => breed[k]).filter(x => Number.isInteger(x));
        cands = core.forceProduct(v.q, [...new Set(pick)].slice(0, TOPK));   // genoemde vakterm bovenaan
        herkomst = "herrangschikking";
      }
    }

    // Precies de gebruikersboodschap uit askAI (docs/index.html). In de cloudmodus is perPagina
    // Infinity en bronnen === cands, dus er wordt NIETS afgekapt en er gaat geen kopjespad mee:
    // alleen titel, url en de volledige paginatekst. Wijk hier niet van af — de hele meting hangt
    // erop dat het model exact ziet wat het in de app ook ziet.
    const listing = cands.map((idx, k) =>
      `[${k}] TITEL: ${core.CORPUS[idx].title}\nURL: ${core.CORPUS[idx].url}\nTEKST:\n${core.CORPUS[idx].text}`
    ).join("\n\n---\n\n");
    const user = `Vraag van de voorlichter:\n${v.q}\n\nPagina's:\n${listing}`;

    const bestand = `vraag-${nr(n)}.txt`;
    fs.writeFileSync(path.join(uitMap, bestand),
      `# vraag ${nr(n)}: ${v.q}\n` +
      `# Laat het antwoordmodel hieronder draaien en zet de JSON in <antwoordmap>/vraag-${nr(n)}.json\n\n` +
      `===== SYSTEEMPROMPT (SYSTEM, uitgelezen uit docs/index.html) =====\n${SYSTEM}\n\n` +
      `===== GEBRUIKERSBOODSCHAP =====\n${user}\n`, "utf-8");

    index.vragen.push({
      nr: n, bestand, q: v.q, verwachteUrl: v.url, anker: v.anker, herkomst,
      // De koppeling paginanummer -> corpus-url. render() heeft die nodig om source_index van het
      // model terug te vertalen naar een pagina, zonder de zoeklaag (en dus het model) te laden.
      kandidaten: cands.map((idx, k) => ({ n: k, url: kort(core.CORPUS[idx].url), titel: core.CORPUS[idx].title, corpusIdx: idx })),
      verwachtOpNummer: cands.findIndex(idx => pad(kort(core.CORPUS[idx].url)) === pad(v.url)),
      // De zoeker zet regelmatig alleen LANDSUBPAGINA's in de top 6 (/verklaring/woonplaats/oman
      // in plaats van /verklaring/woonplaats). eval.mjs telt dat als een treffer omdat het op
      // substring matcht; voor het gouden anker is het dat niet, want dat staat op de ouder.
      subpaginaOpNummer: cands.findIndex(idx => kort(core.CORPUS[idx].url).startsWith(pad(v.url) + "/")),
    });
    const rij = index.vragen[index.vragen.length - 1], plek = rij.verwachtOpNummer;
    const waar = plek >= 0 ? "[" + plek + "]"
      : rij.subpaginaOpNummer >= 0 ? "— NIET in de top 6 (wel subpagina's, nummer " + rij.subpaginaOpNummer + ")"
      : "— NIET in de top 6";
    console.log(`${nr(n)} ${bestand}  ${user.length} tekens  verwachte pagina op nummer ${waar}`);
  }
  fs.writeFileSync(path.join(uitMap, "index.json"), JSON.stringify(index, null, 1), "utf-8");
  const mis = index.vragen.filter(v => !v.geenPassendePagina && v.verwachtOpNummer < 0).length;
  console.log(`\n${index.vragen.filter(v => v.bestand).length} payloads in ${uitMap} (index.json erbij) — pad: ${index.pad}`);
  console.log(`verwachte pagina in de kandidaten: ${index.vragen.length - mis}/${index.vragen.length}`);
  if (mis) console.log("Let op: bij die vragen kán het model het goede citaat niet eens kiezen.");
}

// ---- 2. render -------------------------------------------------------------------------------

// De echte citaatlogica uit de app knippen, op dezelfde manier als cite_eval.mjs en
// quote_test.mjs. Kopiëren zou betekenen dat het harnas en de app uit elkaar kunnen lopen, en
// dan meet je niet meer wat de voorlichter ziet.
function citaatLogica() {
  const A = HTML.indexOf("// ===== <<CITAAT-LOGICA>>");
  const B = HTML.indexOf("// ===== <</CITAAT-LOGICA>>");
  if (A < 0 || B < 0) { console.error("CITAAT-LOGICA-blok niet gevonden in docs/index.html"); process.exit(1); }
  const fn = naam => { const i = HTML.indexOf("function " + naam + "("); return HTML.slice(i, HTML.indexOf("\n}", i) + 2); };
  return new Function(
    fn("escRe") + "\n" + fn("findFrom") + "\n" + HTML.slice(A, B) +
    "\nreturn {buildUnits,buildCitation,locateSpan,spanFromAnchors,isWeakQuote,quotesOverlap,bridgeIsSafe,quoteParagraphs,normForMatch};"
  )();
}

// MAX_CITES staat buiten het blok; uitlezen in plaats van overtikken, zodat een wijziging in de
// app hier vanzelf meekomt.
function maxCites() {
  const m = HTML.match(/const MAX_CITES=(\d+);/);
  return m ? Number(m[1]) : 3;
}

// Het antwoord van de subagent hoeft niet kraakhelder JSON te zijn; de app doet met
// parseModelJSON hetzelfde soort opruimwerk (codeblok eromheen, tekst ervoor).
function leesModelJSON(tekst) {
  const t = (tekst || "").replace(/^\uFEFF/, "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try { return JSON.parse(t); } catch (e) { /* val door */ }
  const m = t.match(/\{[\s\S]*\}/);
  if (m) return JSON.parse(m[0]);
  throw new Error("geen JSON gevonden");
}

async function render() {
  const antwMap = process.argv[3] && !process.argv[3].startsWith("--") ? absPad(process.argv[3]) : "";
  if (!antwMap) { console.error("Gebruik: node scripts/gauntlet.mjs render <antwoordmap>"); process.exit(1); }
  const payMap = absPad(arg("payloads") || "scratch/gauntlet/payloads");
  const uitMap = maakMap(absPad(arg("uit") || "scratch/gauntlet"));
  const index = JSON.parse(fs.readFileSync(path.join(payMap, "index.json"), "utf-8"));

  const Q = citaatLogica();
  const MAX_CITES = maxCites();
  const corpus = JSON.parse(fs.readFileSync(new URL("../docs/data/corpus.json", import.meta.url), "utf-8"));
  const headsVan = i => new Set(((corpus[i] || {}).headings || []).map(h => (h[1] || "").trim()).filter(Boolean));
  const anchVan = i => new Set(((corpus[i] || {}).links || []).map(l => (Array.isArray(l) ? l[0] : l || "").trim()).filter(Boolean));

  // Dezelfde nabewerking als bouwAntwoord in docs/index.html, stap voor stap, met per stap
  // vastgelegd WAAROM een citaat sneuvelde. Dat 'waarom' is het eigenlijke meetresultaat.
  function verwerk(v, r) {
    const rij = { nr: v.nr, q: v.q, verwachteUrl: v.verwachteUrl, anker: v.anker, citaten: [], afgevallen: [], intro: "" };
    const ruw = Array.isArray(r.citations) ? r.citations : [];
    for (const c of ruw) {
      const kand = Number.isInteger(c.source_index) ? v.kandidaten[c.source_index] : null;
      if (!kand) { rij.afgevallen.push({ reden: "onbekend paginanummer", source_index: c.source_index, quote: plat(c.quote).slice(0, 90) }); continue; }
      const gi = kand.corpusIdx, ptxt = corpus[gi].text || "";
      const heads = headsVan(gi), anch = anchVan(gi);
      // Precies de volgorde van de app: eerst de letterlijke quote terugzoeken, anders de
      // reservemethode op de begin-/eindwoorden.
      const eigen = Q.locateSpan(ptxt, c.quote);
      const exact = !!eigen;                        // citeerde het model zelf al letterlijk?
      const span = eigen || Q.spanFromAnchors(ptxt, c.start, c.end);
      if (!span) { rij.afgevallen.push({ reden: "passage niet terug te vinden", url: kand.url, quote: plat(c.quote).slice(0, 90) }); continue; }
      const cit = Q.buildCitation(ptxt, span, heads, anch);
      if (!cit || !cit.text) { rij.afgevallen.push({ reden: "geen citaat te bouwen", url: kand.url, quote: plat(c.quote).slice(0, 90) }); continue; }
      const quote = cit.text;
      if (Q.isWeakQuote(quote)) { rij.afgevallen.push({ reden: "te zwak (kopje of label)", url: kand.url, quote: plat(quote).slice(0, 90) }); continue; }
      if (rij.citaten.some(x => Q.quotesOverlap(x.tekst, quote))) { rij.afgevallen.push({ reden: "dubbel/overlappend", url: kand.url, quote: plat(quote).slice(0, 90) }); continue; }
      const brugRuw = (c.bridge || "").toString().trim().replace(/\s+/g, " ").slice(0, 180);
      const brugOk = Q.bridgeIsSafe(brugRuw, quote);
      rij.citaten.push({
        tekst: quote, url: kand.url, titel: kand.titel,
        alineas: Q.quoteParagraphs(quote, anch),      // wat er letterlijk op het scherm komt
        brug: brugOk ? brugRuw : "", brugRuw, brugAfgekeurd: !!brugRuw && !brugOk,
        quoteExact: exact,                            // gaf het model de passage zelf letterlijk?
        letterlijk: plat(ptxt).includes(plat(quote)), // staat wat we TONEN op de pagina?
        juistePagina: kand.url === v.verwachteUrl.replace(/\/+$/, ""),
        anker: ankerDekking(ptxt, cit, v.anker, kand.url === v.verwachteUrl.replace(/\/+$/, "")),
        start: cit.start, end: cit.end,
      });
      if (rij.citaten.length >= MAX_CITES) break;
    }
    // De intro wordt alleen getoond als er een citaat is — zonder onderbouwing geen vrije
    // AI-tekst; dezelfde regel als in de app.
    rij.intro = rij.citaten.length ? (r.intro || "").toString().trim().replace(/\s+/g, " ").slice(0, 200) : "";
    rij.introWeg = !rij.citaten.length && !!(r.intro || "").trim();
    rij.ankerBeste = besteDekking(rij.citaten.map(c => c.anker));
    return rij;
  }

  // Hoe verhoudt het getoonde citaat zich tot het gouden anker? Niet op tekstgelijkenis maar op
  // OFFSETS: het anker wordt op de pagina opgezocht en de spans worden vergeleken. Zo telt een
  // citaat dat het anker net iets ruimer pakt gewoon als "heel".
  function ankerDekking(ptxt, cit, anker, juistePagina) {
    if (!juistePagina) return "andere pagina";
    const a = Q.locateSpan(ptxt, anker);
    if (!a) return "anker niet op de pagina";          // bevinding over de TESTSET, niet over de app
    if (cit.start <= a.start && cit.end >= a.end) return "heel";
    if (cit.start < a.end && a.start < cit.end) return "gedeeltelijk";
    return "raakt niet";
  }
  const RANG = ["heel", "gedeeltelijk", "raakt niet", "anker niet op de pagina", "andere pagina"];
  const besteDekking = lijst => lijst.length ? lijst.slice().sort((x, y) => RANG.indexOf(x) - RANG.indexOf(y))[0] : "geen citaat";

  const rijen = [];
  for (const v of index.vragen) {
    // De herrangschikking koos {"pages":[]}: de app stelt dan geen antwoordvraag en toont
    // "geen informatie". Er is dus geen antwoordbestand te verwachten.
    if (v.geenPassendePagina) { rijen.push({ nr: v.nr, q: v.q, verwachteUrl: v.verwachteUrl, fout: "herrangschikking koos geen passende pagina" }); continue; }
    const bestand = path.join(antwMap, `vraag-${nr(v.nr)}.json`);
    if (!fs.existsSync(bestand)) { rijen.push({ nr: v.nr, q: v.q, verwachteUrl: v.verwachteUrl, fout: "geen antwoordbestand: " + bestand }); continue; }
    let r;
    try { r = leesModelJSON(fs.readFileSync(bestand, "utf-8")); }
    catch (e) { rijen.push({ nr: v.nr, q: v.q, verwachteUrl: v.verwachteUrl, fout: "antwoord niet te lezen: " + e.message }); continue; }
    rijen.push(verwerk(v, r));
  }

  // ---- uitvoer: machineleesbaar + wat de voorlichter op het scherm ziet -----------------------
  fs.writeFileSync(path.join(uitMap, "gerenderd.json"), JSON.stringify({ set: index.set, n: rijen.length, rijen }, null, 1), "utf-8");

  let tekst = "WAT DE VOORLICHTER OP HET SCHERM ZIET\n" + "=".repeat(78) + "\n";
  tekst += `set ${index.set} · antwoorden uit ${antwMap}\n`;
  for (const r of rijen) {
    tekst += "\n" + "─".repeat(78) + `\n${nr(r.nr)}  ${r.q}\n`;
    tekst += `     verwacht: ${r.verwachteUrl}\n`;
    if (r.fout) { tekst += `     !! ${r.fout}\n`; continue; }
    tekst += "\n";
    if (r.intro) tekst += `  ${r.intro}\n`;
    else tekst += r.citaten.length ? "  (geen intro)\n" : "  (geen citaat, dus ook geen intro)\n";
    for (const c of r.citaten) {
      tekst += "\n";
      if (c.brug) tekst += `  ${c.brug}\n`;
      else if (c.brugAfgekeurd) tekst += `  (brug afgekeurd door bridgeIsSafe: "${c.brugRuw}")\n`;
      for (const a of c.alineas) tekst += `  | ${a}\n`;
      tekst += `  bron: ${c.titel}\n        https://www.nederlandwereldwijd.nl${c.url}\n`;
    }
    tekst += "\n  FEITEN: " + [
      `citaten getoond ${r.citaten.length}`,
      `letterlijk in de bron ${r.citaten.length ? (r.citaten.every(c => c.letterlijk) ? "ja" : "NEE") : "—"}`,
      `model citeerde zelf exact ${r.citaten.filter(c => c.quoteExact).length}/${r.citaten.length}`,
      `bruggen afgekeurd ${r.citaten.filter(c => c.brugAfgekeurd).length}`,
      `citaten weggevallen ${r.afgevallen.length}`,
      `anker: ${r.ankerBeste}`,
    ].join(" · ") + "\n";
    for (const a of r.afgevallen) tekst += `          weggevallen — ${a.reden}: "${a.quote}"\n`;
  }
  fs.writeFileSync(path.join(uitMap, "gerenderd.txt"), tekst, "utf-8");

  // ---- samenvatting ---------------------------------------------------------------------------
  const goed = rijen.filter(r => !r.fout);
  const metCitaat = goed.filter(r => r.citaten.length);
  const alleCit = goed.flatMap(r => r.citaten);
  const tel = w => goed.filter(r => r.ankerBeste === w).length;
  const pct = (x, t) => t ? (x / t * 100).toFixed(0) + "%" : "—";
  console.log(`Antwoorden: ${goed.length}/${rijen.length} gelezen | citaten totaal: ${alleCit.length}`);
  console.log(`  vragen met minstens één citaat      : ${metCitaat.length}/${goed.length} = ${pct(metCitaat.length, goed.length)}`);
  console.log(`  getoond citaat staat in de bron     : ${alleCit.filter(c => c.letterlijk).length}/${alleCit.length}`);
  console.log(`  model citeerde zelf al exact        : ${alleCit.filter(c => c.quoteExact).length}/${alleCit.length} (rest via start/end)`);
  console.log(`  citaten weggevallen                 : ${goed.reduce((s, r) => s + r.afgevallen.length, 0)}`);
  console.log(`  bruggen afgekeurd (bridgeIsSafe)    : ${alleCit.filter(c => c.brugAfgekeurd).length}/${alleCit.filter(c => c.brugRuw).length} met brug`);
  console.log(`  intro aanwezig                      : ${metCitaat.filter(r => r.intro).length}/${metCitaat.length}`);
  console.log(`  anker heel / gedeeltelijk / niet    : ${tel("heel")} / ${tel("gedeeltelijk")} / ${tel("raakt niet") + tel("andere pagina") + tel("geen citaat")}`);
  const raar = goed.filter(r => r.ankerBeste === "anker niet op de pagina").length;
  if (raar) console.log(`  (${raar}x staat het anker zelf niet op de pagina — testdata, geen app-probleem)`);
  for (const r of rijen) if (r.fout) console.log(`  !! ${nr(r.nr)} ${r.fout}`);
  console.log(`\ngeschreven: ${path.join(uitMap, "gerenderd.json")} en ${path.join(uitMap, "gerenderd.txt")}`);
}

// Onderaan, niet bovenaan: de hulpfuncties hierboven zijn `const`-declaraties en bestaan pas
// als het hele bestand is doorlopen.
const cmd = process.argv[2];
if (cmd === "payloads") await payloads();
else if (cmd === "render") await render();
else { console.error("Gebruik: node scripts/gauntlet.mjs payloads | render <antwoordmap>"); process.exit(1); }
