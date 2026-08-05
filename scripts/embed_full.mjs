// Bereken full-text paginavectoren met chunking (zelfde model als de browser).
// Elke pagina wordt in stukken (chunks) geknipt; elk stuk krijgt een vector.
// Bij zoeken neemt de frontend de beste (max) chunk-score per pagina.
// Output: docs/data/embeddings.bin (int8) + docs/data/embeddings.json (meta + owner).
import { pipeline } from "@huggingface/transformers";
import fs from "fs";

const MODEL = process.env.EMB_MODEL || "Xenova/multilingual-e5-small";
const ROOT = "/home/user/Chatbot-voorkant/docs/data";
const OUT = process.env.EMB_OUT || ROOT;   // schrijf evt. naar tijdelijke map om te vergelijken
const CORPUS = ROOT + "/corpus.json";
const OUT_BIN = OUT + "/embeddings.bin";
const OUT_META = OUT + "/embeddings.json";

const MAX_WORDS = 220, MIN_WORDS = 90, MAX_CHUNKS = 16, BATCH = 32;

// CONTEXTUELE CHUNKING:
// - grenzen op ALINEA's (niet hard op woordaantal), zodat een stuk niet midden in een zin breekt
// - elk stuk krijgt de PAGINATITEL en het dichtstbijzijnde TUSSENKOPJE mee als context,
//   zodat "Kosten" onder de paspoortpagina ook echt over paspoortkosten gaat
function chunksOf(p) {
  const title = (p.title || "").replace(/\s*\|\s*NederlandWereldwijd\s*$/i, "").replace(/\s+/g, " ").trim();
  const headings = new Map();
  for (const [lvl, t] of (p.headings || [])) if (t && !headings.has(t)) headings.set(t, lvl);
  const lines = (p.text || "").split("\n").map((l) => l.trim()).filter(Boolean);
  const out = [];
  let head = "";          // laatst geziene tussenkopje
  let buf = [], bufWords = 0, bufHead = "";

  const flush = () => {
    if (!buf.length) return;
    const ctx = [title, bufHead].filter(Boolean).join(" — ");
    out.push((ctx ? ctx + ". " : "") + buf.join(" "));
    buf = []; bufWords = 0;
  };

  for (const ln of lines) {
    if (headings.has(ln)) { if (bufWords >= MIN_WORDS) flush(); head = ln; if (!buf.length) bufHead = head; continue; }   // kop = grens, mits er genoeg staat
    const w = ln.split(/\s+/).length;
    if (!buf.length) bufHead = head;
    if (bufWords + w > MAX_WORDS && bufWords >= MIN_WORDS) { flush(); bufHead = head; }
    buf.push(ln); bufWords += w;
    if (out.length >= MAX_CHUNKS) break;
  }
  flush();
  if (!out.length) out.push(title || (p.desc || "").slice(0, 300));
  // Extra vector op titel + samenvatting: korte, hoge-signaaltekst voor titelachtige vragen.
  const brief = [title, (p.desc || "").replace(/\s+/g, " ").trim()].filter(Boolean).join(". ");
  if (brief) out.unshift(brief);
  return out.slice(0, MAX_CHUNKS + 1);
}

const corpus = JSON.parse(fs.readFileSync(CORPUS, "utf-8"));
console.log("Pagina's:", corpus.length, "| model laden…");
const extractor = await pipeline("feature-extraction", MODEL, { dtype: "q8" });

// Bouw de lijst van (chunk-tekst, paginaindex).
const texts = [], owner = [];
corpus.forEach((p, idx) => { for (const c of chunksOf(p)) { texts.push("passage: " + c); owner.push(idx); } });
console.log("Chunks:", texts.length);

let DIM = 0;
let int8 = [];
// Hervatbaar: elke ~2000 chunks tussentijds wegschrijven, zodat een onderbreking
// (of een afgebroken sessie) geen uren rekenwerk kost.
const PART = OUT + "/embeddings.part";
const PART_META = OUT + "/embeddings.part.json";
let start = 0;
try {
  const pm = JSON.parse(fs.readFileSync(PART_META, "utf-8"));
  if (pm.total === texts.length && pm.model === MODEL) {
    const buf = fs.readFileSync(PART);
    int8 = Array.from(new Int8Array(buf.buffer, buf.byteOffset, buf.length));
    DIM = pm.dim; start = pm.done;
    console.log(`Hervatten vanaf ${start}/${texts.length}`);
  }
} catch (e) { /* geen bruikbaar deelbestand: gewoon opnieuw */ }

let sinceSave = 0;
for (let i = start; i < texts.length; i += BATCH) {
  const out = await extractor(texts.slice(i, i + BATCH), { pooling: "mean", normalize: true });
  DIM = out.dims[out.dims.length - 1];
  const data = out.data;
  for (let k = 0; k < data.length; k++) {
    let q = Math.round(data[k] * 127);
    int8.push(q < -127 ? -127 : q > 127 ? 127 : q);
  }
  sinceSave += BATCH;
  const done = Math.min(i + BATCH, texts.length);
  if (sinceSave >= 2000 || done === texts.length) {
    fs.writeFileSync(PART, Buffer.from(Int8Array.from(int8).buffer));
    fs.writeFileSync(PART_META, JSON.stringify({ done, total: texts.length, dim: DIM, model: MODEL }));
    sinceSave = 0;
    console.log(`  ${done}/${texts.length} (opgeslagen)`);
  } else if ((i / BATCH) % 20 === 0) console.log(`  ${done}/${texts.length}`);
}

fs.writeFileSync(OUT_BIN, Buffer.from(Int8Array.from(int8).buffer));
try { fs.unlinkSync(PART); fs.unlinkSync(PART_META); } catch (e) {}
fs.writeFileSync(OUT_META, JSON.stringify({
  model: MODEL, dim: DIM, pages: corpus.length, vectors: owner.length,
  doc_prefix: "passage: ", query_prefix: "query: ", quant: "int8/127",
  owner, note: "owner[v] = corpus-index; meerdere chunks per pagina, score = max per pagina",
}));
console.log(`KLAAR: ${owner.length} vectoren × ${DIM} dims -> ${(int8.length / 1e6).toFixed(1)}MB int8`);
