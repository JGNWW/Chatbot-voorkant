// Stelt de zoeklaag af op een grote vragenset ("trainen" van de retrieval-parameters).
// Gebruik: node tune.mjs [--train=eval_set_auto.json] [--holdout=eval_set.json]
//
// Wat er afgesteld wordt: de gewichten waarmee de trefwoord- en de semantische lijst worden
// samengevoegd (RRF), en hoe zwaar titel/samenvatting/URL meetellen in BM25. Het EMBEDDINGMODEL
// zelf wordt niet bijgetraind — dat vraagt een GPU en een eigen gehost model; zie het README-blok
// onderaan dit bestand.
//
// Werkwijze: afstellen op de trainingsset, controleren op de handgemaakte set (holdout). Wijkt de
// winst op de holdout af, dan is de winst overfitting op de gegenereerde vragen.
import fs from "fs";
import { pipeline } from "@huggingface/transformers";

const arg = (n, d) => (process.argv.find(a => a.startsWith("--" + n + "=")) || "").split("=")[1] || d;
const TRAIN = arg("train", "eval_set_auto.json"), HOLD = arg("holdout", "eval_set.json");
const D = new URL("../docs/data/", import.meta.url);
const corpus = JSON.parse(fs.readFileSync(new URL("corpus.json", D), "utf-8"));
const meta = JSON.parse(fs.readFileSync(new URL("embeddings.json", D), "utf-8"));
const buf = fs.readFileSync(new URL("embeddings.bin", D));
const bin = new Int8Array(buf.buffer, buf.byteOffset, buf.length);
const sets = { train: load(TRAIN), hold: load(HOLD) };
function load(n) { return JSON.parse(fs.readFileSync(new URL("./" + n, import.meta.url), "utf-8")); }
const TOPK = 6, DEPTH = 12;

const STOP = new Set("de het een en van in op te voor met aan is ik je u hoe wat waar wanneer kan moet mijn uw ben wil naar om dat die er ook als of bij dan zijn heb heeft wordt worden the a to of".split(" "));
const stem = w => { if (w.length < 5) return w; for (const s of ["ingen", "ing", "heden", "heid", "en", "s"]) if (w.length - s.length >= 4 && w.endsWith(s)) return w.slice(0, -s.length); return w; };
const tokenize = t => (t || "").toLowerCase().split(/[^a-z0-9à-ÿ]+/).filter(w => w.length > 2 && !STOP.has(w)).map(stem);

// ---- BM25 met omgekeerde index (alleen documenten mét een zoekterm worden bezocht) ----
const FIELDS = corpus.map(p => [p.title, p.summary || p.desc, p.url, p.text]);
const TOKS = FIELDS.map(f => f.map(x => tokenize(x || "")));
function buildBM25(w) {                                  // w = [titel, samenvatting, url, tekst]
  const N = corpus.length, post = new Map(), DLEN = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const tf = new Map();
    for (let f = 0; f < 4; f++) for (const t of TOKS[i][f]) tf.set(t, (tf.get(t) || 0) + w[f]);
    for (const [t, c] of tf) { let a = post.get(t); if (!a) { a = []; post.set(t, a); } a.push(i, c); DLEN[i] += c; }
  }
  let tot = 0; for (let i = 0; i < N; i++) tot += DLEN[i];
  const AVGDL = tot / N, IDF = new Map();
  for (const [t, a] of post) { const df = a.length / 2; IDF.set(t, Math.log(1 + (N - df + 0.5) / (df + 0.5))); }
  return { post, DLEN, AVGDL, IDF, N };
}
function bm25(ix, qt, limit, k1, b) {
  const sc = new Map();
  for (const t of qt) {
    const a = ix.post.get(t); if (!a) continue;
    const idf = ix.IDF.get(t);
    for (let j = 0; j < a.length; j += 2) {
      const i = a[j], tf = a[j + 1];
      sc.set(i, (sc.get(i) || 0) + idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * ix.DLEN[i] / ix.AVGDL)));
    }
  }
  return [...sc.entries()].sort((x, y) => y[1] - x[1]).slice(0, limit).map(e => e[0]);
}

// ---- spellingscorrectie (zoals in de app): onbekend woord -> dichtstbijzijnde corpusterm ----
// Hangt alleen af van WELKE termen bestaan, niet van hun gewicht, dus één keer berekenen.
const DFALL = new Map();
for (let i = 0; i < corpus.length; i++) { const seen = new Set(); for (let f = 0; f < 4; f++) for (const t of TOKS[i][f]) seen.add(t); for (const t of seen) DFALL.set(t, (DFALL.get(t) || 0) + 1); }
const VOCAB = new Map();
for (const [t, df] of DFALL) { if (df < 3 || t.length < 5) continue; let a = VOCAB.get(t.length); if (!a) { a = []; VOCAB.set(t.length, a); } a.push(t); }
function editLE(a, b, max) {
  const la = a.length, lb = b.length; if (Math.abs(la - lb) > max) return false;
  let prev = new Array(lb + 1), cur = new Array(lb + 1); for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    cur[0] = i; let rowMin = cur[0];
    for (let j = 1; j <= lb; j++) { cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); if (cur[j] < rowMin) rowMin = cur[j]; }
    if (rowMin > max) return false;[prev, cur] = [cur, prev];
  }
  return prev[lb] <= max;
}
function fuzzyFix(t) {
  if (t.length < 5 || (DFALL.get(t) || 0) > 0) return t;
  const max = t.length >= 8 ? 2 : 1; let best = null, bestDf = 0;
  for (let L = t.length - max; L <= t.length + max; L++) { const arr = VOCAB.get(L); if (!arr) continue; for (const c of arr) { if (c[0] !== t[0] && max < 2) continue; if (editLE(t, c, max)) { const df = DFALL.get(c); if (df > bestDf) { best = c; bestDf = df; } } } }
  return best || t;
}

// ---- landherkenning + productregel (identiek aan de app) ----
const fold = s => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const parents = new Map();
for (const p of corpus) { const parts = (p.url || "").replace(/\/+$/, "").split("/"); if (parts.length < 5) continue; const last = parts.pop(); let s = parents.get(last); if (!s) { s = new Set(); parents.set(last, s); } s.add(parts.join("/")); }
const CBLOCK = new Set(["buitenland", "aanvragen", "algemeen", "overzicht", "contact"]);
const COUNTRY = new Set(); for (const [seg, ps] of parents) if (ps.size >= 7 && !CBLOCK.has(seg)) COUNTRY.add(seg);
const PCOUNTRY = corpus.map(p => { const last = (p.url || "").replace(/\/+$/, "").split("/").pop().toLowerCase(); if (COUNTRY.has(last)) return last; for (const c of COUNTRY) if (last.endsWith("-" + c)) return c; return null; });
const detect = t => { const f = " " + fold(t).replace(/[^a-z0-9]+/g, " ") + " "; const o = new Set(); for (const c of COUNTRY) if (f.includes(" " + c.replace(/-/g, " ") + " ")) o.add(c); return o; };
function applyCountry(text, order) { const det = detect(text), g1 = [], g2 = [], g3 = []; for (const i of order) { const pc = PCOUNTRY[i]; if (pc && det.has(pc)) g1.push(i); else if (pc) g3.push(i); else g2.push(i); } return [...g1, ...g2, ...g3]; }
const _idx = new Map(corpus.map((p, i) => [(p.url || "").replace(/\/+$/, ""), i])), _kids = new Map();
for (const p of corpus) { const u = (p.url || "").replace(/\/+$/, ""), par = u.slice(0, u.lastIndexOf("/")); if (_idx.has(par)) _kids.set(par, (_kids.get(par) || 0) + 1); }
const PBLOCK = new Set(["buitenland", "aanvragen", "contact", "thema", "nederland", "overzicht", "landen"]);
const _c = [];
for (const [u, n] of _kids) { const seg = u.slice(u.lastIndexOf("/") + 1).toLowerCase(); if (n < 50 || PBLOCK.has(seg) || seg.length < 4 || seg.includes("-")) continue; const i = _idx.get(u); if (i === undefined) continue; if (!(corpus[i].title || "").toLowerCase().replace(/-/g, "").includes(seg)) continue; _c.push([u, seg, i]); }
const _u = new Set(_c.map(x => x[0])), PRODUCT = new Map();
for (const [u, seg, i] of _c) { if ([..._u].some(o => o !== u && o.startsWith(u + "/"))) continue; PRODUCT.set(stem(seg), i); }
function forceProduct(qt, list) { let best = -1, len = 0; for (const t of new Set(qt)) { const i = PRODUCT.get(t); if (i !== undefined && t.length > len) { best = i; len = t.length; } } if (best < 0 || list[0] === best) return list; return [best, ...list.filter(x => x !== best)]; }

// ---- semantische top-N per vraag: één keer berekenen, daarna hergebruiken ----
const dim = meta.dim, owner = meta.owner;
const CACHE = new URL("./.tune_cache.json", import.meta.url);
let cache = {};
try { cache = JSON.parse(fs.readFileSync(CACHE, "utf-8")); } catch (e) { }
const allQ = [...sets.train, ...sets.hold].map(x => x.q);
const missing = allQ.filter(q => !cache[q]);
if (missing.length) {
  console.log(`semantische ranglijsten berekenen voor ${missing.length} vragen…`);
  const ex = await pipeline("feature-extraction", meta.model, { dtype: "q8" });
  // Eén vraag per keer: in een batch wordt er gevuld (padding) en dat verschuift de vectoren
  // net genoeg om andere ranglijsten te geven dan de app. Het afstellen moet exact spiegelen.
  for (let i = 0; i < missing.length; i += 1) {
    const batch = missing.slice(i, i + 1);
    const out = await ex(batch.map(q => "query: " + q), { pooling: "mean", normalize: true });
    for (let n = 0; n < batch.length; n++) {
      const qv = out.data.subarray(n * dim, (n + 1) * dim), best = new Map();
      for (let k = 0; k < owner.length; k++) { let d = 0; const off = k * dim; for (let x = 0; x < dim; x++) d += qv[x] * (bin[off + x] / 127); const pg = owner[k], c = best.get(pg); if (c === undefined || d > c) best.set(pg, d); }
      cache[batch[n]] = [...best.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40).map(e => e[0]);
    }
    if (i % 100 === 0) { console.log(`  ${i}/${missing.length}`); fs.writeFileSync(CACHE, JSON.stringify(cache)); }
  }
  fs.writeFileSync(CACHE, JSON.stringify(cache));
}

// ---- meten ----
const upath = i => corpus[i].url.replace("https://www.nederlandwereldwijd.nl", "");
// De trefwoordranglijst hangt alleen van de INDEX af, niet van de fusiegewichten. Hem één keer
// per indexvariant berekenen scheelt een factor 200 bij het aftasten van het fusieraster.
const QT = new Map();
const qtok = q => { let t = QT.get(q); if (!t) { t = [...new Set(tokenize(q).map(fuzzyFix))]; QT.set(q, t); } return t; };
function kwLists(set, ix, k1, b) { return set.map(({ q }) => bm25(ix, qtok(q), DEPTH, k1, b)); }
function score(set, kws, P) {
  let rec = 0, mrr = 0;
  for (let n = 0; n < set.length; n++) {
    const { q, expect } = set[n];
    const qt = qtok(q);
    const sem = cache[q].slice(0, DEPTH), kw = kws[n];
    const s = new Map();
    const add = (l, w) => l.forEach((i, r) => s.set(i, (s.get(i) || 0) + w / (P.rrf + r)));
    add(sem, P.wsem); add(kw, P.wkw);
    const fused = [...s.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
    const res = forceProduct(qt, applyCountry(q, fused)).slice(0, TOPK).map(upath);
    const h = res.findIndex(u => expect.some(e => u.includes(e)));
    if (h >= 0) { rec++; mrr += 1 / (h + 1); }
  }
  return { recall: rec / set.length, mrr: mrr / set.length };
}
const show = r => `recall ${(r.recall * 100).toFixed(1)}%  MRR ${r.mrr.toFixed(3)}`;

const BASE = { fw: [3, 2, 2, 1], k1: 1.5, b: 0.75, rrf: 10, wsem: 1.5, wkw: 1.0 };
let ix = buildBM25(BASE.fw);
let kwT = kwLists(sets.train, ix, BASE.k1, BASE.b), kwH = kwLists(sets.hold, ix, BASE.k1, BASE.b);
console.log(`\nUITGANGSPUNT (${BASE.fw.join("/")}, k1 ${BASE.k1}, b ${BASE.b}, rrf ${BASE.rrf}, sem ${BASE.wsem}, kw ${BASE.wkw})`);
console.log(`  train (${sets.train.length}): ${show(score(sets.train, kwT, BASE))}`);
console.log(`  hold  (${sets.hold.length}): ${show(score(sets.hold, kwH, BASE))}`);

// ---- zoeken met een RANDVOORWAARDE ----
// Afstellen op de gegenereerde vragen alleen is riskant: die komen uit titels en kopjes, dus
// alles wat de titel- en URL-velden zwaarder maakt "wint" er automatisch. De handgemaakte set
// (echte voorlichtersvragen) fungeert daarom niet alleen als controle maar als HARDE EIS: een
// instelling telt alleen mee als die set er niet op achteruit gaat. Zo koop je winst op de grote
// set niet af met verlies op de vragen waar het echt om gaat.
const RRF = [4, 6, 8, 10, 14, 20, 30], WSEM = [1.0, 1.25, 1.5, 1.75, 2.0, 2.5], WKW = [0.5, 0.75, 1.0, 1.25, 1.5];
const B_REC = score(sets.hold, kwH, BASE).recall, B_MRR = score(sets.hold, kwH, BASE).mrr;
const ok = h => h.recall >= B_REC - 1e-9 && h.mrr >= B_MRR - 0.005;
let best = { ...BASE }, bestMrr = score(sets.train, kwT, BASE).mrr, bestHold = { recall: B_REC, mrr: B_MRR }, bestKw = kwT;
let tried = 0, passed = 0;
function consider(P, kws, kwsH) {
  tried++;
  const h = score(sets.hold, kwsH, P); if (!ok(h)) return;
  passed++;
  const t = score(sets.train, kws, P);
  if (t.mrr > bestMrr) { bestMrr = t.mrr; best = P; bestHold = h; bestKw = kws; }
}

// stap 1: fusie op de bestaande index
for (const rrf of RRF) for (const wsem of WSEM) for (const wkw of WKW)
  consider({ ...BASE, rrf, wsem, wkw }, kwT, kwH);
console.log(`\nSTAP 1 fusie -> rrf ${best.rrf}, sem ${best.wsem}, kw ${best.wkw}`);
console.log(`  train: ${show(score(sets.train, kwT, best))}`);
console.log(`  hold : ${show(bestHold)}`);

// stap 2: veldgewichten en BM25-vorm (fusie vast op stap 1)
const F1 = { ...best };
for (const title of [2, 3, 4, 5, 6])
  for (const desc of [1, 2, 3])
    for (const url of [1, 2, 3, 4]) {
      const fw = [title, desc, url, 1], jx = buildBM25(fw);
      for (const k1 of [1.2, 1.5]) for (const b of [0.6, 0.75])
        consider({ ...F1, fw, k1, b }, kwLists(sets.train, jx, k1, b), kwLists(sets.hold, jx, k1, b));
      console.log(`  ... velden ${fw.join("/")}: beste ${best.fw.join("/")} k1 ${best.k1} b ${best.b} | train MRR ${bestMrr.toFixed(3)}`);
    }
ix = buildBM25(best.fw);
kwT = bestKw; kwH = kwLists(sets.hold, ix, best.k1, best.b);
console.log(`\nSTAP 2 BM25 -> velden ${best.fw.join("/")} (titel/samenvatting/url/tekst), k1 ${best.k1}, b ${best.b}`);
console.log(`  train: ${show(score(sets.train, kwT, best))}`);
console.log(`  hold : ${show(score(sets.hold, kwH, best))}`);

// stap 3: fusie nog een keer, nu op de gekozen index
for (const rrf of RRF) for (const wsem of WSEM) for (const wkw of WKW)
  consider({ ...best, rrf, wsem, wkw }, kwT, kwH);

console.log(`\nEINDSTAND  velden ${best.fw.join("/")}, k1 ${best.k1}, b ${best.b}, rrf ${best.rrf}, sem ${best.wsem}, kw ${best.wkw}`);
console.log(`  train: ${show(score(sets.train, kwT, best))}`);
console.log(`  hold : ${show(score(sets.hold, kwH, best))}`);
console.log(`  ${passed} van ${tried} instellingen voldeden aan de eis (holdout niet slechter)`);
console.log(`\nJSON: ${JSON.stringify(best)}`);
