// Genereert een GROTE testset vragen uit het corpus, met de bronpagina als goede antwoord.
// Gebruik: node gen_questions.mjs [aantal] > /dev/null   (schrijft scripts/eval_set_auto.json)
//
// Waarom dit werkt als testset: nederlandwereldwijd.nl schrijft titels en tussenkopjes vaak al
// als VRAAG van de burger ("Hoe vraag ik AOW aan buiten Nederland?"). Die vraag hoort per
// definitie bij de pagina waar hij op staat — dat is een gratis, betrouwbaar label.
//
// Twee voorzorgen, anders meet je jezelf rijk:
//  1. HERSCHRIJVEN. Een letterlijke titel overnemen test alleen of de titelindex werkt. Elke
//     vraag wordt omgezet naar hoe een beller het zou zeggen (u -> ik, andere werkwoorden,
//     stopwoorden eruit) en een deel krijgt tikfouten, zoals in de handgemaakte set.
//  2. UNIEKHEID + SPREIDING. Een kopje dat op 20 pagina's staat ("Waar woont u?") levert geen
//     eenduidig label op en valt af. Per rubriek geldt een maximum, anders bestaat de set voor
//     driekwart uit landenpagina's.
import fs from "fs";

const N = Number(process.argv[2] || 1000);
const root = new URL("../docs/data/corpus.json", import.meta.url);
const corpus = JSON.parse(fs.readFileSync(root, "utf-8"));
const OUT = new URL("./eval_set_auto.json", import.meta.url);
const path = u => (u || "").replace("https://www.nederlandwereldwijd.nl", "").replace(/\/+$/, "");
const clean = t => (t || "").replace(/\s*\|\s*NederlandWereldwijd\s*$/i, "").replace(/\s+/g, " ").trim();

// --- 1. kandidaten verzamelen: elke vraagzin met de pagina waar hij op staat ---
const owners = new Map();                         // vraagtekst (genormaliseerd) -> Set van paden
const cands = [];                                 // {text, url, src}
const norm = s => s.toLowerCase().replace(/[^a-z0-9à-ÿ ]/g, " ").replace(/\s+/g, " ").trim();
const push = (text, url, src) => {
  const t = clean(text);
  const w = t.split(/\s+/).length;
  if (!/\?$/.test(t) || w < 4 || w > 16) return;
  const k = norm(t);
  let s = owners.get(k); if (!s) { s = new Set(); owners.set(k, s); }
  s.add(path(url));
  cands.push({ text: t, key: k, url: path(url), src });
};
for (const p of corpus) {
  push(p.title, p.url, "titel");
  for (const [, h] of (p.headings || [])) push(h, p.url, "kop");
}

// --- 2. herschrijven naar de taal van de beller ---
const SWAP = [
  [/\bhoe vraag ik (.+?) aan\b/i, "hoe kan ik $1 aanvragen"],
  [/\bhoe kan ik (.+?) aanvragen\b/i, "hoe vraag ik $1 aan"],
  [/\bwat is\b/i, "wat houdt"], [/\bhoeveel kost\b/i, "wat kost"],
  [/\bwaar kan ik\b/i, "waar moet ik zijn om"], [/\bkan ik\b/i, "mag ik"],
  [/\bwanneer moet ik\b/i, "vanaf wanneer moet ik"], [/\bmoet ik\b/i, "ben ik verplicht"],
];
const YOU = [
  [/\bbent u\b/gi, "ben ik"], [/\bkunt u\b/gi, "kan ik"], [/\bheeft u\b/gi, "heb ik"],
  [/\bhebt u\b/gi, "heb ik"], [/\bmoet u\b/gi, "moet ik"], [/\bwoont u\b/gi, "woon ik"],
  [/\bgaat u\b/gi, "ga ik"], [/\bwilt u\b/gi, "wil ik"], [/\bdoet u\b/gi, "doe ik"],
  [/\bkrijgt u\b/gi, "krijg ik"], [/\bverhuist u\b/gi, "verhuis ik"], [/\bblijft u\b/gi, "blijf ik"],
  [/\bziet u\b/gi, "zie ik"], [/\bweet u\b/gi, "weet ik"], [/\blaat u\b/gi, "laat ik"],
  [/\bstaat u\b/gi, "sta ik"], [/\bmag u\b/gi, "mag ik"], [/\bzit u\b/gi, "zit ik"],
  // Overige werkwoorden: "geeft u" -> "geef ik". Alleen als de stam op een medeklinker (geen t)
  // eindigt; zo blijven "moet u", "gaat u" en "weet u" buiten schot (die staan hierboven).
  [/\b([a-zà-ÿ]{2,}[bcdfghjklmnpqrsvwxz])t u\b/gi, "$1 ik"],
  [/\buw\b/gi, "mijn"], [/\bu\b/gi, "ik"],
];
const OPEN = ["", "", "", "ik wil weten ", "vraagje: ", "even checken: "];
// Tikfouten zoals bij snel typen: letter dubbel, letter weg, twee letters gewisseld.
function typo(s, seed) {
  const words = s.split(" ").map((w, i) => [w, i]).filter(([w]) => w.length > 6);
  if (!words.length) return s;
  const [w, i] = words[seed % words.length];
  const p = 2 + (seed % (w.length - 3));
  const mode = seed % 3;
  const nw = mode === 0 ? w.slice(0, p) + w[p] + w.slice(p)
    : mode === 1 ? w.slice(0, p) + w.slice(p + 1)
      : w.slice(0, p) + w[p + 1] + w[p] + w.slice(p + 2);
  return s.split(" ").map((x, j) => (j === i ? nw : x)).join(" ");
}
function rewrite(text, seed) {
  let s = text.replace(/\?+$/, "").trim();
  for (const [re, to] of YOU) s = s.replace(re, to);
  if (seed % 2 === 0) for (const [re, to] of SWAP) if (re.test(s)) { s = s.replace(re, to); break; }
  s = s.toLowerCase().replace(/\s+/g, " ").trim();
  s = OPEN[seed % OPEN.length] + s;
  if (seed % 7 === 3) s = typo(s, seed);
  return s.trim();
}

// --- 3. selecteren: eenduidig label, geen dubbelen, gespreid over de rubrieken ---
// Een vraag moet OP ZICHZELF te beantwoorden zijn. "Welke wijzigingen moet ik doorgeven?" staat
// op tientallen uitkeringspagina's en is zonder context onbeantwoordbaar; zulke kopjes leverden
// missers op die niets over de zoeklaag zeggen. Eis daarom minstens één onderscheidend woord:
// een term die in hooguit 1% van de pagina's voorkomt.
const STOPQ = new Set("de het een en van in op te voor met aan is ik je u hoe wat waar wanneer kan moet mijn uw ben wil naar om dat die er ook als of bij dan zijn heb heeft wordt worden".split(" "));
const words = t => (t || "").toLowerCase().split(/[^a-z0-9à-ÿ]+/).filter(w => w.length > 2 && !STOPQ.has(w));
const DFW = new Map();
for (const p of corpus) { for (const t of new Set(words([p.title, p.desc, p.text].join(" ")))) DFW.set(t, (DFW.get(t) || 0) + 1); }
const RARE = Math.max(10, Math.round(corpus.length * 0.01));
const distinctive = q => words(q).some(t => (DFW.get(t) || 0) <= RARE);
// Een kopje staat in de CONTEXT van zijn pagina; aan de telefoon noemt de beller die context zelf
// ("welke wijzigingen moet ik doorgeven" -> bij welke uitkering?). Ontbreekt het onderwerp van de
// rubriek in de vraag, dan plakken we het eraan. Zonder dat meet je onbeantwoordbare vragen.
const GENERIEK = new Set("buiten nederland buitenland naar het een van voor thema".split(" "));
function rubriek(u) {
  const seg = u.split("/")[1] || "";
  const w = seg.split("-").filter(x => x.length > 2 && !GENERIEK.has(x));
  return w.slice(0, 2).join(" ");
}
function withTopic(q, u) {
  const r = rubriek(u); if (!r) return q;
  const qs = new Set(words(q));
  if (r.split(" ").some(x => qs.has(x))) return q;
  return q + " " + r;
}
const section = u => (u.split("/")[1] || "overig");
const perSection = new Map(), seen = new Set(), out = [];
const CAP = Math.max(8, Math.ceil(N / 22));       // spreiding houden, maar wel genoeg vragen halen
// Kopjes eerst (de vraag staat dan NIET in de titel — een echtere test dan een titel kopiëren).
const order = [...cands.filter(c => c.src === "kop"), ...cands.filter(c => c.src === "titel")];
let seed = 0;
for (const c of order) {
  if (out.length >= N) break;
  const own = owners.get(c.key);
  // Staat dezelfde vraag op meer dan twee pagina's, dan is er geen duidelijk goed antwoord
  // ("Waar woont u?" staat overal). Bij twee pagina's telt elk van beide als goed.
  if (own.size > 2) continue;
  if (seen.has(c.key)) continue;
  const sec = section(c.url), n = perSection.get(sec) || 0;
  if (n >= CAP) continue;
  const q = rewrite(c.text, seed++);
  if (q.split(/\s+/).length < 3) continue;
  if (!distinctive(q)) continue;                  // te algemeen om een goed antwoord te hebben
  seen.add(c.key); perSection.set(sec, n + 1);
  out.push({ q: c.src === "kop" ? withTopic(q, c.url) : q, expect: [...own], src: c.src });
}

// --- 4. aanvullen met landvragen ---
// Veel pagina's heten "<handeling> in <land>" ("Afspraak maken in Duitsland"). Dat zijn precies
// de vragen die een voorlichter aan de telefoon krijgt, en het label is opnieuw de pagina zelf.
const LAND_T = [
  (a, l) => `${a} in ${l}`,
  (a, l) => `hoe werkt ${a} in ${l}`,
  (a, l) => `waar moet ik zijn voor ${a} in ${l}`,
  (a, l) => `ik zit in ${l} en wil ${a}`,
  (a, l) => `kan ik ${a} in ${l}`,
  (a, l) => `${a} ${l}`,
];
const perLand = new Map(), LANDCAP = 9;
for (const p of corpus) {
  if (out.length >= N) break;
  const t = clean(p.title), m = t.match(/^(.{6,60}?) in ([A-Z][\wà-ÿ' -]{3,25})$/);
  if (!m) continue;
  const a = m[1].toLowerCase(), l = m[2].toLowerCase(), u = path(p.url);
  const n = perLand.get(l) || 0; if (n >= LANDCAP) continue;
  const q = LAND_T[seed % LAND_T.length](a, l);
  const k = norm(q); if (seen.has(k)) continue;
  seed++; seen.add(k); perLand.set(l, n + 1);
  out.push({ q, expect: [u], src: "land" });
}

fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
const bySrc = out.reduce((m, o) => (m[o.src] = (m[o.src] || 0) + 1, m), {});
console.error(`geschreven: ${out.length} vragen -> ${OUT.pathname}`);
console.error(`bron: ${JSON.stringify(bySrc)} | rubrieken: ${perSection.size} (max ${CAP} per rubriek)`);
console.error([...perSection.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
  .map(([s, n]) => `${s}:${n}`).join("  "));
