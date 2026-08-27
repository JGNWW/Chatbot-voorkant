// Splitst docs/data/corpus.json in een LICHT deel en een ZWAAR deel, voor de turbomodus.
// Gebruik: node scripts/split_corpus.mjs
//
// WAAROM: bij het opstarten heeft de app de paginatekst helemaal niet nodig. Zoeken gebeurt op
// de voorgebouwde index (bm25.bin); de typeahead heeft alleen titels nodig, en landherkenning
// alleen URL's. De 12,8 MB tekst plus 5,5 MB links en kopjes zijn pas nodig vanaf de
// herrangschikking — seconden later, terwijl de voorlichter nog aan het typen is.
//
//   corpus_lite.json   titel + url + desc     1,4 MB rauw   0,11 MB gzip
//   corpus_text.json   tekst + links + kopjes  18,9 MB rauw  1,40 MB gzip
//
// De twee bestanden staan in DEZELFDE volgorde als corpus.json; de app voegt ze op index samen.
// Klopt het aantal niet, dan valt turbo terug op het gewone corpus.json.
import fs from "fs";

const corpus = JSON.parse(fs.readFileSync(new URL("../docs/data/corpus.json", import.meta.url), "utf-8"));
const dir = new URL("../docs/data/", import.meta.url).pathname;

const lite = corpus.map(p => ({ title: p.title || "", url: p.url || "", desc: p.desc || "" }));
const zwaar = corpus.map(p => ({ text: p.text || "", links: p.links || [], headings: p.headings || [] }));

// summary komt in het huidige corpus niet voor, maar tokensOf() leest het wel (p.summary||p.desc).
// Zit het er ooit wel in, dan hoort het bij het lichte deel — anders wijkt de app af van de index.
if (corpus.some(p => p.summary)) {
  for (let i = 0; i < corpus.length; i++) lite[i].summary = corpus[i].summary || "";
  console.error("let op: 'summary' gevonden en meegenomen in corpus_lite.json");
}

const schrijf = (naam, obj) => {
  const pad = dir + naam;
  fs.writeFileSync(pad, JSON.stringify(obj));
  return fs.statSync(pad).size;
};
const a = schrijf("corpus_lite.json", lite);
const b = schrijf("corpus_text.json", zwaar);

console.error(`geschreven: ${corpus.length} pagina's`);
console.error(`  corpus_lite.json  ${(a / 1e6).toFixed(2)} MB`);
console.error(`  corpus_text.json  ${(b / 1e6).toFixed(2)} MB`);
