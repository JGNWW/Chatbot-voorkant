// Laadt de zoekkern (docs/search-core.js) in Node, met het corpus en desgewenst de semantiek.
// Zowel eval.mjs als probe.mjs gebruiken dit, zodat er precies één zoeklogica is: dezelfde die
// docs/index.html in de browser laadt.
import fs from "fs";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const dataDir = new URL("../docs/data/", import.meta.url).pathname;

export function loadCore() {
  return require("../docs/search-core.js");
}

export function loadCorpus(core, file = "corpus.json") {
  const corpus = JSON.parse(fs.readFileSync(dataDir + file, "utf-8"));
  core.setCorpus(corpus);
  return corpus;
}

// Zet de semantische laag aan: de vooraf berekende vectoren + het embeddingmodel.
// Zonder dit blijft SEM.meta leeg en zoekt de kern alleen op trefwoorden — precies zoals in de
// browser voordat het model binnen is.
export async function loadSemantic(core, dir = dataDir) {
  const meta = JSON.parse(fs.readFileSync(dir + "/embeddings.json", "utf-8"));
  const vecs = new Int8Array(fs.readFileSync(dir + "/embeddings.bin").buffer);
  const { pipeline } = await import("@huggingface/transformers");
  const extractor = await pipeline("feature-extraction", meta.model, { dtype: "q8" });
  core.setSemantic({
    ready: true, meta, vecs,
    owner: Array.isArray(meta.owner) ? Int32Array.from(meta.owner) : null,
    extractor,
  });
  return meta;
}

// Precies wat de app zonder AI-stappen als kandidaten toont.
export async function retrieve(core, q, limit = 6) {
  return (await core.rankFor(q)).slice(0, limit);
}
