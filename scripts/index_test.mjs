// Bewijst dat de voorgebouwde index (docs/data/bm25.bin) precies hetzelfde rangschikt als de
// index die de app nu bij elke paginalading opbouwt. Zonder dit bewijs is de turbomodus een gok.
//
// Gebruik: node scripts/index_test.mjs        (faalt met exit 1 bij het eerste verschil)
//
// Wat er gecontroleerd wordt:
//   1. vocabulaire, documentlengtes en document-frequenties zijn identiek;
//   2. de rangschikking van 126 echte vragen is TEKEN VOOR TEKEN gelijk (top 25);
//   3. hoeveel sneller of langzamer de nieuwe zoekweg is.
// Loopt tokensOf() in docs/index.html uit de pas met build_index.mjs, dan valt punt 1 om.
import fs from "fs";

const corpus = JSON.parse(fs.readFileSync(new URL("../docs/data/corpus.json", import.meta.url), "utf-8"));
const bin = fs.readFileSync(new URL("../docs/data/bm25.bin", import.meta.url));
const vragen = JSON.parse(fs.readFileSync(new URL("./eval_set.json", import.meta.url), "utf-8")).map(x => x.q);

const STOP = new Set("de het een en van in op te voor met aan is ik je u hoe wat waar wanneer kan moet mijn uw ben wil naar om dat die er ook als of bij dan zijn heb heeft wordt worden the a to of".split(" "));
const stem = w => { if (w.length < 5) return w; for (const s of ["ingen", "ing", "heden", "heid", "en", "s"]) if (w.length - s.length >= 4 && w.endsWith(s)) return w.slice(0, -s.length); return w; };
const tokenize = t => (t || "").toLowerCase().split(/[^a-z0-9à-ÿ]+/).filter(w => w.length > 2 && !STOP.has(w)).map(stem);

let fout = 0;
const eis = (ok, wat) => { if (!ok) { console.log("  ✗ " + wat); fout++; } else console.log("  ✓ " + wat); };

// ---- oude weg: index opbouwen zoals de app dat nu doet ----
const t0 = Date.now();
const PT = corpus.map(p => {
  const m = new Map();
  const add = (t, w) => { for (const x of tokenize(t || "")) m.set(x, (m.get(x) || 0) + w); };
  add(p.title, 4); add(p.summary || p.desc, 1); add(p.url, 3); add(p.text, 1);
  return m;
});
const N = PT.length, DF = new Map(), DLEN = new Array(N);
let tot = 0;
for (let i = 0; i < N; i++) { let len = 0; for (const [t, c] of PT[i]) { DF.set(t, (DF.get(t) || 0) + 1); len += c; } DLEN[i] = len; tot += len; }
const AVGDL = tot / N;
const bouwMs = Date.now() - t0;
const idfOud = t => { const df = DF.get(t) || 0; return df ? Math.log(1 + (N - df + 0.5) / (df + 0.5)) : 0; };
function rankOud(q, limit) {
  const qt = [...new Set(tokenize(q))]; if (!qt.length) return [];
  const k1 = 1.5, b = 0.75, s = [];
  for (let i = 0; i < N; i++) {
    const m = PT[i]; let sc = 0;
    for (const t of qt) { const tf = m.get(t); if (!tf) continue; sc += idfOud(t) * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * DLEN[i] / AVGDL)); }
    if (sc > 0) s.push([sc, i]);
  }
  s.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  return s.slice(0, limit).map(x => x[1]);
}

// ---- nieuwe weg: het binaire bestand inlezen ----
const t1 = Date.now();
const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
if (bin.toString("ascii", 0, 4) !== "LEOB") { console.log("  ✗ bestand begint niet met LEOB"); process.exit(1); }
const versie = dv.getUint16(4, true), pages = dv.getUint32(6, true), terms = dv.getUint32(10, true), pos = dv.getUint32(14, true);
let o = 18;
const lees = (Type, n) => { const a = new Type(bin.buffer.slice(bin.byteOffset + o, bin.byteOffset + o + n * Type.BYTES_PER_ELEMENT)); o += n * Type.BYTES_PER_ELEMENT; return a; };
const vocabOff = lees(Uint32Array, terms + 1);
// De offsets zijn BYTE-posities. Termen met een accent (à-ÿ) zijn in UTF-8 twee bytes, dus
// snijden op tekenposities schuift alles achter het eerste accent op. Daarom op de buffer
// snijden en pas daarna decoderen.
const blobBuf = bin.subarray(o, o + vocabOff[terms]); o += vocabOff[terms];
const dlen = lees(Uint32Array, pages);
const ptr = lees(Uint32Array, terms + 1);
const postDoc = lees(Uint32Array, pos);
const postTf = lees(Uint16Array, pos);
const id = new Map();
for (let i = 0; i < terms; i++) id.set(blobBuf.toString("utf-8", vocabOff[i], vocabOff[i + 1]), i);
let som = 0; for (let i = 0; i < pages; i++) som += dlen[i];
const avgdl = som / pages;
const leesMs = Date.now() - t1;
const idfNieuw = t => { const df = ptr[t + 1] - ptr[t]; return df ? Math.log(1 + (pages - df + 0.5) / (df + 0.5)) : 0; };
const score = new Float64Array(pages);
function rankNieuw(q, limit) {
  const qt = [...new Set(tokenize(q))].map(t => id.get(t)).filter(x => x !== undefined);
  if (!qt.length) return [];
  score.fill(0);
  const k1 = 1.5, b = 0.75;
  for (const t of qt) {
    const w = idfNieuw(t);
    for (let k = ptr[t]; k < ptr[t + 1]; k++) {
      const d = postDoc[k], tf = postTf[k];
      score[d] += w * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * dlen[d] / avgdl));
    }
  }
  const s = [];
  for (let i = 0; i < pages; i++) if (score[i] > 0) s.push([score[i], i]);
  s.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  return s.slice(0, limit).map(x => x[1]);
}

console.log(`Index: versie ${versie} | ${pages} pagina's | ${terms} termen | ${pos} postings\n`);
console.log("Klopt de index?");
eis(pages === N, `pagina's gelijk (${pages})`);
eis(terms === DF.size, `vocabulaire gelijk (${terms} tegen ${DF.size})`);
let dlenFout = 0; for (let i = 0; i < N; i++) if (dlen[i] !== DLEN[i]) dlenFout++;
eis(dlenFout === 0, `documentlengtes gelijk (${dlenFout} afwijkingen)`);
let dfFout = 0; for (const [t, d] of DF) { const i = id.get(t); if (i === undefined || ptr[i + 1] - ptr[i] !== d) dfFout++; }
eis(dfFout === 0, `document-frequenties gelijk (${dfFout} afwijkingen)`);
eis(Math.abs(avgdl - AVGDL) < 1e-9, `gemiddelde documentlengte gelijk (${avgdl.toFixed(4)})`);

console.log("\nRangschikt hij hetzelfde?");
let verschil = 0; const voorbeelden = [];
for (const q of vragen) {
  const a = rankOud(q, 25).join(","), b2 = rankNieuw(q, 25).join(",");
  if (a !== b2) { verschil++; if (voorbeelden.length < 3) voorbeelden.push(q); }
}
eis(verschil === 0, `top-25 identiek voor alle ${vragen.length} testvragen (${verschil} verschillen)`);
if (voorbeelden.length) console.log("      eerste verschillen: " + voorbeelden.join(" | "));

// ---- snelheid ----
const meet = (fn) => { const t = process.hrtime.bigint(); for (const q of vragen) fn(q, 25); return Number(process.hrtime.bigint() - t) / 1e6 / vragen.length; };
meet(rankOud); meet(rankNieuw);                       // opwarmen
const msOud = meet(rankOud), msNieuw = meet(rankNieuw);
console.log("\nSnelheid");
console.log(`  index opbouwen (nu)     : ${bouwMs} ms per paginalading`);
console.log(`  index inlezen (turbo)   : ${leesMs} ms per paginalading`);
console.log(`  zoeken (nu)             : ${msOud.toFixed(2)} ms per vraag`);
console.log(`  zoeken (turbo)          : ${msNieuw.toFixed(2)} ms per vraag`);

if (fout) { console.error(`\n${fout} controle(s) gefaald — de turbo-index wijkt af van de app.`); process.exit(1); }
console.log("\nAlles gelijk. De voorgebouwde index geeft exact dezelfde rangschikking.");
