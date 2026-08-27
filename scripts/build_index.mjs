// Bouwt de BM25-index ÉÉN keer, buiten de browser, en schrijft hem als binair bestand.
// Gebruik: node scripts/build_index.mjs
//
// WAAROM: de app bouwt die index nu bij ELKE paginalading opnieuw op — 4431 JavaScript-Maps met
// samen 507.677 (term,pagina)-paren. Gemeten kost dat 987 ms plus 74 ms voor de
// document-frequenties, op de hoofddraad, terwijl de gebruiker niets kan doen.
// Ingelezen als typed arrays is dat een kwestie van bytes kopiëren.
//
// De index is een exacte afspiegeling van tokensOf() in docs/index.html: zelfde stopwoorden,
// zelfde stemmer, zelfde veldgewichten. Wijzigt daar iets, dan MOET dit bestand opnieuw
// gebouwd worden — scripts/index_test.mjs controleert dat en faalt als ze uit elkaar lopen.
//
// De index staat per TERM, niet per pagina. Dat is niet alleen compacter om te laden maar ook
// sneller te bevragen: een vraag van vijf woorden raakt alleen de postings van die vijf termen,
// in plaats van alle 4431 pagina's langs te lopen zoals de huidige code doet.
//
// FORMAAT (little-endian):
//   "LEOB" | versie u16 | pagina's u32 | termen u32 | posities u32
//   vocabOffsets  Uint32Array(termen+1)   -> posities in de vocab-blob
//   vocabBlob     UTF-8, termen aan elkaar
//   dlen          Uint32Array(pagina's)   -> som van de gewichten per pagina
//   ptr           Uint32Array(termen+1)   -> waar de postings van term t beginnen
//   postDoc       Uint32Array(posities)   -> paginanummer
//   postTf        Uint16Array(posities)   -> gewogen frequentie (hoogste gemeten: 122)
// df is af te leiden uit ptr (ptr[t+1]-ptr[t]) en staat er dus niet apart in.
import fs from "fs";

const html = fs.readFileSync(new URL("../docs/index.html", import.meta.url), "utf-8");
const corpus = JSON.parse(fs.readFileSync(new URL("../docs/data/corpus.json", import.meta.url), "utf-8"));
const OUT = new URL("../docs/data/bm25.bin", import.meta.url).pathname;

// De veldgewichten uit de app halen in plaats van ze over te typen: één plek waar ze staan.
const gew = (naam) => {
  const m = new RegExp("const FW_TITLE=(\\d+), FW_DESC=(\\d+), FW_URL=(\\d+), FW_TEXT=(\\d+)").exec(html);
  if (!m) { console.error("veldgewichten niet gevonden in docs/index.html"); process.exit(1); }
  return { TITLE: +m[1], DESC: +m[2], URL: +m[3], TEXT: +m[4] }[naam];
};
const FW = { title: gew("TITLE"), desc: gew("DESC"), url: gew("URL"), text: gew("TEXT") };

const STOP = new Set("de het een en van in op te voor met aan is ik je u hoe wat waar wanneer kan moet mijn uw ben wil naar om dat die er ook als of bij dan zijn heb heeft wordt worden the a to of".split(" "));
const stem = w => { if (w.length < 5) return w; for (const s of ["ingen", "ing", "heden", "heid", "en", "s"]) if (w.length - s.length >= 4 && w.endsWith(s)) return w.slice(0, -s.length); return w; };
const tokenize = t => (t || "").toLowerCase().split(/[^a-z0-9à-ÿ]+/).filter(w => w.length > 2 && !STOP.has(w)).map(stem);

// 1. per pagina de gewogen termfrequenties, precies zoals tokensOf()
const perPagina = corpus.map(p => {
  const m = new Map();
  const add = (t, w) => { for (const x of tokenize(t || "")) m.set(x, (m.get(x) || 0) + w); };
  add(p.title, FW.title); add(p.summary || p.desc, FW.desc); add(p.url, FW.url); add(p.text, FW.text);
  return m;
});

// 2. vocabulaire vaststellen. Gesorteerd, zodat het bestand reproduceerbaar is: dezelfde invoer
//    geeft byte-voor-byte hetzelfde bestand, en een diff laat echte wijzigingen zien.
const termen = [...new Set(perPagina.flatMap(m => [...m.keys()]))].sort();
const termId = new Map(termen.map((t, i) => [t, i]));

// 3. postings per TERM + dlen per pagina
const posities = perPagina.reduce((a, m) => a + m.size, 0);
const dlen = new Uint32Array(corpus.length);
const aantal = new Uint32Array(termen.length);
for (let i = 0; i < corpus.length; i++) {
  let len = 0;
  for (const [t, c] of perPagina[i]) {
    if (c > 65535) { console.error("frequentie past niet in Uint16: " + c); process.exit(1); }
    aantal[termId.get(t)]++; len += c;
  }
  dlen[i] = len;
}
const ptr = new Uint32Array(termen.length + 1);
for (let t = 0; t < termen.length; t++) ptr[t + 1] = ptr[t] + aantal[t];
const postDoc = new Uint32Array(posities);
const postTf = new Uint16Array(posities);
{
  const cursor = Uint32Array.from(ptr.subarray(0, termen.length));
  // Pagina's in oplopende volgorde per term: dat is de natuurlijke volgorde bij het doorlopen.
  for (let i = 0; i < corpus.length; i++)
    for (const [t, c] of perPagina[i]) {
      const id = termId.get(t), k = cursor[id]++;
      postDoc[k] = i; postTf[k] = c;
    }
}

// 4. schrijven
const blob = Buffer.from(termen.join(""), "utf-8");
const vocabOff = new Uint32Array(termen.length + 1);
{ let o = 0; for (let i = 0; i < termen.length; i++) { vocabOff[i] = o; o += Buffer.byteLength(termen[i], "utf-8"); } vocabOff[termen.length] = o; }

const kop = Buffer.alloc(18);
kop.write("LEOB", 0, "ascii");
kop.writeUInt16LE(1, 4);
kop.writeUInt32LE(corpus.length, 6);
kop.writeUInt32LE(termen.length, 10);
kop.writeUInt32LE(posities, 14);

const uit = Buffer.concat([
  kop,
  Buffer.from(vocabOff.buffer), blob,
  Buffer.from(dlen.buffer),
  Buffer.from(ptr.buffer), Buffer.from(postDoc.buffer), Buffer.from(postTf.buffer),
]);
fs.writeFileSync(OUT, uit);

console.error(`geschreven: ${OUT}`);
console.error(`  ${corpus.length} pagina's, ${termen.length} termen, ${posities} postings`);
console.error(`  ${(uit.length / 1e6).toFixed(2)} MB rauw`);
console.error(`  veldgewichten uit index.html: titel ${FW.title}, desc ${FW.desc}, url ${FW.url}, tekst ${FW.text}`);
