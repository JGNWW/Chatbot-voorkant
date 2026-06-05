// Bereken paginavectoren met hetzelfde model dat de browser gebruikt (pariteit).
// Output: docs/data/embeddings.bin (int8) + docs/data/embeddings.json (meta).
import { pipeline } from "@huggingface/transformers";
import fs from "fs";

const MODEL = "Xenova/multilingual-e5-small";
const CORPUS = "/home/user/Chatbot-voorkant/docs/data/corpus.json";
const OUT_BIN = "/home/user/Chatbot-voorkant/docs/data/embeddings.bin";
const OUT_META = "/home/user/Chatbot-voorkant/docs/data/embeddings.json";

// Zelfde zoektekst als de frontend: titel + samenvatting/meta-omschrijving.
function searchText(p){return (p.title + ". " + (p.summary || p.desc || p.text.slice(0,200))).replace(/\s+/g," ").trim();}

const corpus = JSON.parse(fs.readFileSync(CORPUS, "utf-8"));
console.log("Pagina's:", corpus.length, "| model laden…");
const extractor = await pipeline("feature-extraction", MODEL);

const N = corpus.length;
let DIM = 0;
const BATCH = 32;
const int8 = [];

for (let i = 0; i < N; i += BATCH) {
  const slice = corpus.slice(i, i + BATCH).map(p => "passage: " + searchText(p));
  const out = await extractor(slice, { pooling: "mean", normalize: true });
  DIM = out.dims[out.dims.length - 1];
  const data = out.data; // Float32Array, lengte = slice.length * DIM
  for (let k = 0; k < data.length; k++) {
    let q = Math.round(data[k] * 127);
    int8.push(q < -127 ? -127 : q > 127 ? 127 : q);
  }
  if ((i / BATCH) % 10 === 0) console.log(`  ${Math.min(i+BATCH,N)}/${N}`);
}

fs.writeFileSync(OUT_BIN, Buffer.from(Int8Array.from(int8).buffer));
fs.writeFileSync(OUT_META, JSON.stringify({
  model: MODEL, dim: DIM, count: N,
  doc_prefix: "passage: ", query_prefix: "query: ",
  quant: "int8/127", note: "volgorde komt overeen met corpus.json"
}));
console.log(`KLAAR: ${N} vectoren × ${DIM} dims -> ${(int8.length/1e6).toFixed(1)}MB int8`);
