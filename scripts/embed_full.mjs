// Bereken full-text paginavectoren met chunking (zelfde model als de browser).
// Elke pagina wordt in stukken (chunks) geknipt; elk stuk krijgt een vector.
// Bij zoeken neemt de frontend de beste (max) chunk-score per pagina.
// Output: docs/data/embeddings.bin (int8) + docs/data/embeddings.json (meta + owner).
import { pipeline } from "@huggingface/transformers";
import fs from "fs";

const MODEL = "Xenova/multilingual-e5-small";
const ROOT = "/home/user/Chatbot-voorkant/docs/data";
const CORPUS = ROOT + "/corpus.json";
const OUT_BIN = ROOT + "/embeddings.bin";
const OUT_META = ROOT + "/embeddings.json";

const MAX_WORDS = 200, OVERLAP = 25, MAX_CHUNKS = 8, BATCH = 32;

// Knip een pagina in overlappende stukken; titel vooraan elk stuk voor context.
function chunksOf(p) {
  const title = (p.title || "").replace(/\s+/g, " ").trim();
  const body = (p.text || "").replace(/\s+/g, " ").trim();
  const words = body.split(" ").filter(Boolean);
  const out = [];
  if (!words.length) { out.push(title); return out; }
  for (let i = 0; i < words.length && out.length < MAX_CHUNKS; i += (MAX_WORDS - OVERLAP)) {
    const seg = words.slice(i, i + MAX_WORDS).join(" ");
    out.push((title ? title + ". " : "") + seg);
  }
  return out;
}

const corpus = JSON.parse(fs.readFileSync(CORPUS, "utf-8"));
console.log("Pagina's:", corpus.length, "| model laden…");
const extractor = await pipeline("feature-extraction", MODEL, { dtype: "q8" });

// Bouw de lijst van (chunk-tekst, paginaindex).
const texts = [], owner = [];
corpus.forEach((p, idx) => { for (const c of chunksOf(p)) { texts.push("passage: " + c); owner.push(idx); } });
console.log("Chunks:", texts.length);

let DIM = 0;
const int8 = [];
for (let i = 0; i < texts.length; i += BATCH) {
  const out = await extractor(texts.slice(i, i + BATCH), { pooling: "mean", normalize: true });
  DIM = out.dims[out.dims.length - 1];
  const data = out.data;
  for (let k = 0; k < data.length; k++) {
    let q = Math.round(data[k] * 127);
    int8.push(q < -127 ? -127 : q > 127 ? 127 : q);
  }
  if ((i / BATCH) % 20 === 0) console.log(`  ${Math.min(i + BATCH, texts.length)}/${texts.length}`);
}

fs.writeFileSync(OUT_BIN, Buffer.from(Int8Array.from(int8).buffer));
fs.writeFileSync(OUT_META, JSON.stringify({
  model: MODEL, dim: DIM, pages: corpus.length, vectors: owner.length,
  doc_prefix: "passage: ", query_prefix: "query: ", quant: "int8/127",
  owner, note: "owner[v] = corpus-index; meerdere chunks per pagina, score = max per pagina",
}));
console.log(`KLAAR: ${owner.length} vectoren × ${DIM} dims -> ${(int8.length / 1e6).toFixed(1)}MB int8`);
