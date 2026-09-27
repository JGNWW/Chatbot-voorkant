// Plakt een losgeknipte beginletter weer aan zijn woord: "Nederland? E\nn wilt u" -> "En wilt u".
//
// WAAROM: de site zet de eerste letter van sommige zinnen of links in een eigen inline-element.
// De crawler haalt de tekst op met get_text(separator="\n") en zet dus ook daartussen een
// regelbreuk. Het citaat begon daardoor met "n wilt u uw DigiD activeren?", en een link
// "N\nederlandse nationaliteit bij geboorte" werd niet meer als link herkend.
//
// DE REGEL: één hoofdletter die als los woord aan het eind van een regel staat, gevolgd door een
// regel die met een kleine letter begint. Uitgezonderd zijn de hoofdletters die zelf een woord
// zijn: "U\nkunt niet zelf kiezen" is een echte regelbreuk en mag geen "Ukunt" worden.
// Dezelfde regel staat in scripts/crawl.py (plak_beginletters), zodat een nieuwe crawl het
// probleem niet terugbrengt. Wijzig ze samen.
//
// Gebruik: node scripts/plak_beginletters.mjs
//          daarna: node scripts/split_corpus.mjs && node scripts/build_index.mjs
// Het script past docs/data/corpus.json aan en schuift de tekstposities in "lists" mee.
import fs from "fs";
import { fileURLToPath } from "url";

export const EENLETTERWOORDEN = new Set(["U", "A", "O", "I"]);
const RX = /(^|[^\p{L}])(\p{Lu})\n(?=\p{Ll})/gu;

// Geeft de nieuwe tekst en de posities (in de OUDE tekst) van de verwijderde regelbreuken.
export function plakBeginletters(tekst) {
  const weg = [];
  const nieuw = (tekst || "").replace(RX, (m, voor, letter, pos) => {
    if (EENLETTERWOORDEN.has(letter)) return m;
    weg.push(pos + voor.length + 1);            // de "\n" direct na de letter
    return voor + letter;
  });
  return { tekst: nieuw, weg };
}

// Een positie in de oude tekst omrekenen naar de nieuwe: elke verwijderde breuk ervóór telt -1.
export function schuif(pos, weg) {
  let n = 0;
  for (const w of weg) if (w < pos) n++;
  return pos - n;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const pad = new URL("../docs/data/corpus.json", import.meta.url);
  const corpus = JSON.parse(fs.readFileSync(pad, "utf-8"));
  let paginas = 0, breuken = 0;
  for (const p of corpus) {
    const { tekst, weg } = plakBeginletters(p.text);
    if (!weg.length) continue;
    paginas++; breuken += weg.length;
    p.text = tekst;
    // lists: [genummerd, s1, e1, s2, e2, ...] — het eerste getal is een vlag, geen positie.
    if (Array.isArray(p.lists)) p.lists = p.lists.map(l => [l[0], ...l.slice(1).map(x => schuif(x, weg))]);
    // Linkteksten en kopjes haalt de crawler op met een spatie als scheiding, niet met "\n";
    // daar komt dit probleem niet voor (en "categorie C of D" moet blijven staan).
    console.log("  " + p.url.replace(/^https?:\/\/[^/]+/, "") + ": " + weg.length);
  }
  // Zelfde opmaak als json.dumps(..., ensure_ascii=False) in crawl.py/add_*.py, zodat de diff
  // alleen de echte wijzigingen laat zien en niet het hele bestand.
  const py = v => Array.isArray(v) ? "[" + v.map(py).join(", ") + "]"
    : v && typeof v === "object" ? "{" + Object.entries(v).map(([k, x]) => JSON.stringify(k) + ": " + py(x)).join(", ") + "}"
    : JSON.stringify(v);
  fs.writeFileSync(pad, py(corpus));
  console.log(`${breuken} beginletter(s) teruggeplakt op ${paginas} pagina's`);
}
