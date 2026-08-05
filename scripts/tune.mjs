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
  for (let i = 0; i < missing.length; i += 16) {
    const batch = missing.slice(i, i + 16);
    const out = await ex(batch.map(q => "query: " + q), { pooling: "mean", normalize: true });
    for (let n = 0; n < batch.length; n++) {
      const qv = out.data.subarray(n * dim, (n + 1) * dim), best = new Map();
      for (let k = 0; k < owner.length; k++) { let d = 0; const off = k * dim; for (let x = 0; x < dim; x++) d += qv[x] * (bin[off + x] / 127); const pg = owner[k], c = best.get(pg); if (c === undefined || d > c) best.set(pg, d); }
      cache[batch[n]] = [...best.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40).map(e => e[0]);
    }
    if (i % 160 === 0) { console.log(`  ${i}/${missing.length}`); fs.writeFileSync(CACHE, JSON.stringify(cache)); }
  }
  fs.writeFileSync(CACHE, JSON.stringify(cache));
}

// ---- meten ----
const upath = i => corpus[i].url.replace("https://www.nederlandwereldwijd.nl", "");
function score(set, ix, P) {
  let rec = 0, mrr = 0;
  for (const { q, expect } of set) {
    const qt = [...new Set(tokenize(q))];
    const sem = cache[q].slice(0, DEPTH), kw = bm25(ix, qt, DEPTH, P.k1, P.b);
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
console.log(`\nUITGANGSPUNT (${BASE.fw.join("/")}, k1 ${BASE.k1}, b ${BASE.b}, rrf ${BASE.rrf}, sem ${BASE.wsem}, kw ${BASE.wkw})`);
console.log(`  train (${sets.train.length}): ${show(score(sets.train, ix, BASE))}`);
console.log(`  hold  (${sets.hold.length}): ${show(score(sets.hold, ix, BASE))}`);

// ---- stap 1: fusie afstellen (goedkoop; de BM25-index blijft gelijk) ----
let best = { ...BASE }, bestScore = score(sets.train, ix, BASE).mrr;
for (const rrf of [4, 6, 8, 10, 14, 20, 30])
  for (const wsem of [1.0, 1.25, 1.5, 1.75, 2.0, 2.5])
    for (const wkw of [0.5, 0.75, 1.0, 1.25, 1.5]) {
      const P = { ...best, rrf, wsem, wkw }, r = score(sets.train, ix, P);
      if (r.mrr > bestScore) { bestScore = r.mrr; best = P; }
    }
console.log(`\nSTAP 1 fusie -> rrf ${best.rrf}, sem ${best.wsem}, kw ${best.wkw}`);
console.log(`  train: ${show(score(sets.train, ix, best))}`);
console.log(`  hold : ${show(score(sets.hold, ix, best))}`);

// ---- stap 2: veldgewichten en BM25-vorm ----
let bestFw = best.fw, bestK = best.k1, bestB = best.b;
for (const title of [2, 3, 4, 5, 6])
  for (const desc of [1, 2, 3])
    for (const url of [1, 2, 3, 4]) {
      const fw = [title, desc, url, 1], jx = buildBM25(fw);
      for (const k1 of [1.2, 1.5])
        for (const b of [0.6, 0.75]) {
          const P = { ...best, fw, k1, b }, r = score(sets.train, jx, P);
          if (r.mrr > bestScore) { bestScore = r.mrr; bestFw = fw; bestK = k1; bestB = b; }
        }
    }
best = { ...best, fw: bestFw, k1: bestK, b: bestB };
ix = buildBM25(best.fw);
console.log(`\nSTAP 2 BM25 -> velden ${best.fw.join("/")} (titel/samenvatting/url/tekst), k1 ${best.k1}, b ${best.b}`);
const rt = score(sets.train, ix, best), rh = score(sets.hold, ix, best);
console.log(`  train: ${show(rt)}`);
console.log(`  hold : ${show(rh)}`);

// ---- stap 3: nog een keer de fusie, nu op de nieuwe index ----
for (const rrf of [4, 6, 8, 10, 14, 20, 30])
  for (const wsem of [1.0, 1.25, 1.5, 1.75, 2.0, 2.5])
    for (const wkw of [0.5, 0.75, 1.0, 1.25, 1.5]) {
      const P = { ...best, rrf, wsem, wkw }, r = score(sets.train, ix, P);
      if (r.mrr > bestScore) { bestScore = r.mrr; best = P; }
    }
console.log(`\nEINDSTAND  velden ${best.fw.join("/")}, k1 ${best.k1}, b ${best.b}, rrf ${best.rrf}, sem ${best.wsem}, kw ${best.wkw}`);
console.log(`  train: ${show(score(sets.train, ix, best))}`);
console.log(`  hold : ${show(score(sets.hold, ix, best))}`);
console.log(`\nJSON: ${JSON.stringify(best)}`);
