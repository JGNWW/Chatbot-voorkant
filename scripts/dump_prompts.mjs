// Zet alle systeemprompts uit docs/index.html in één leesbaar tekstbestand.
// Gebruik: node scripts/dump_prompts.mjs [uitvoerbestand]
//
// Waarom een script en geen handmatige kopie: een losse kopie is binnen een week verouderd.
// Dit leest de prompts uit de app zelf, dus wat je leest is wat er verstuurd wordt.
import fs from "fs";

const html = fs.readFileSync(new URL("../docs/index.html", import.meta.url), "utf-8");
const OUT = process.argv[2] || new URL("../prompts.txt", import.meta.url).pathname;

// Een template-literal uitlezen zonder de escapes te breken: teken voor teken tot de
// afsluitende backtick, met \ als ontsnapping.
function literal(naam) {
  const kop = "const " + naam + "=`";
  const i = html.indexOf(kop);
  if (i < 0) return null;
  let j = i + kop.length;
  const start = j;
  while (j < html.length) {
    if (html[j] === "\\") { j += 2; continue; }
    if (html[j] === "`") break;
    j++;
  }
  return html.slice(start, j);
}

// Volgorde = de volgorde waarin ze in een gesprek gebruikt worden.
const PROMPTS = [
  ["PREPARE_SYSTEM", "Stap 1 — vraag begrijpen",
    "Draait bij ELKE vraag in de cloudmodus, als eerste. Herschrijft de vraag tot een zelfstandige informatiebehoefte en verzint zoektermen, alternatieve formuleringen en een HyDE-tekst.\nWordt NIET gebruikt bij een lokaal model (die slaan deze stap over).",
    "systeem: PREPARE_SYSTEM\ngebruiker: [gesprekscontext] + \"Vraag van de burger: \" + <de getypte vraag>"],

  ["CONDENSE_SYSTEM", "Vervolgvraag zelfstandig maken",
    "Draait alleen bij een LOKAAL model, en alleen als er al een gesprek loopt. Vervangt de zwaardere PREPARE-stap.",
    "systeem: CONDENSE_SYSTEM\ngebruiker: \"Gesprek tot nu toe:\\n\" + <laatste 6 beurten> + \"\\n\\nNieuwe vraag: \" + <de vraag>"],

  ["RERANK_SYSTEM", "Stap 2 — beste pagina's kiezen",
    "Krijgt een genummerde lijst kandidaat-pagina's (titel + tekstfragment) en kiest daaruit maximaal 6.\nCloud: ~25-30 kandidaten met 300 tekens per stuk. Lokaal: 12 kandidaten met 110-140 tekens.",
    "systeem: RERANK_SYSTEM\ngebruiker: \"Vraag van de burger:\\n\" + <vraag> + \"\\n\\nKandidaat-pagina's:\\n\" + <genummerde lijst>"],

  ["SYSTEM", "Stap 3 — antwoord samenstellen (cloud)",
    "De hoofdprompt. Krijgt de gekozen pagina's met hun VOLLEDIGE tekst en levert citaten, bruggen, verduidelijkingsvragen en vervolgvragen als JSON.",
    "systeem: SYSTEM\ngebruiker: \"Vraag van de voorlichter:\\n\" + <vraag> + \"\\n\\nPagina's:\\n\" + <6 pagina's, volledige tekst>"],

  ["SYSTEM_LOKAAL", "Stap 3 — antwoord samenstellen (lokaal model)",
    "Dezelfde opdracht, sterk ingekort. Een lokaal model moet elk woord van de prompt eerst doorrekenen, en de volledige SYSTEM (3.243 tokens) past met bronpagina's niet in een venster van 4.096.",
    "systeem: SYSTEM_LOKAAL\ngebruiker: idem, maar 2-3 pagina's van elk hoogstens 1.400-1.800 tekens"],

  ["GENERATIEF_SYSTEM", "Volledig generatief antwoord (staat standaard uit)",
    "Een EXTRA aanroep na stap 3, alleen als het vinkje aan staat. Schrijft een lopend antwoord op basis van de al gekozen citaten. Elke alinea moet aan een passage hangen; alinea's die dat niet doen vallen af.",
    "systeem: GENERATIEF_SYSTEM\ngebruiker: \"Vraag:\\n\" + <vraag> + \"\\n\\nPassages:\\n\" + <de gekozen citaten, genummerd>"],

  ["SPRAAK_SYSTEM", "Spraak — van gesprek naar vraag",
    "Draait in de spraakmodus als je op 'Geef antwoord' klikt. Maakt van een ruwe transcriptie (twee sprekers door elkaar, halve zinnen) één nette vraag.\nDaarna controleert de code het resultaat nog: verzint het model een invalshoek die niet is uitgesproken, dan wordt de ruwe tekst gebruikt.",
    "systeem: SPRAAK_SYSTEM\ngebruiker: [gesprekscontext] + \"Zojuist gezegd:\\n\" + <laatste 60 woorden>"],
];

const streep = (t) => "═".repeat(t);
let uit = "";
uit += streep(78) + "\n";
uit += "SYSTEEMPROMPTS VAN LEO — " + (html.match(/APP_VERSION="([^"]+)"/) || [, "?"])[1] + "\n";
uit += "uitgelezen uit docs/index.html op " + new Date().toISOString().slice(0, 10) + "\n";
uit += streep(78) + "\n\n";
uit += "Per vraag draaien er in de cloudmodus DRIE aanroepen na elkaar (stap 1, 2, 3).\n";
uit += "Een lokaal model doet er twee: de PREPARE-stap vervalt.\n";
uit += "Staat 'volledig generatief' aan, dan komt daar een vierde aanroep bij.\n\n";

// Inhoudsopgave met maten, zodat je meteen ziet waar het gewicht zit.
uit += "INHOUD\n" + "─".repeat(78) + "\n";
for (const [naam, titel] of PROMPTS) {
  const t = literal(naam);
  const tekens = t ? t.length : 0;
  uit += `  ${naam.padEnd(20)} ${String(tekens).padStart(6)} tekens  ~${String(Math.round(tekens / 3.3)).padStart(5)} tokens   ${titel}\n`;
}
uit += "\n";

for (const [naam, titel, wanneer, opbouw] of PROMPTS) {
  const t = literal(naam);
  uit += "\n" + streep(78) + "\n";
  uit += titel.toUpperCase() + "\n";
  uit += streep(78) + "\n\n";
  uit += "Naam in de code : " + naam + "\n";
  uit += "Grootte         : " + (t ? t.length : 0) + " tekens (~" + Math.round((t ? t.length : 0) / 3.3) + " tokens)\n";
  uit += "Wanneer         : " + wanneer.replace(/\n/g, "\n                  ") + "\n";
  uit += "Wordt verstuurd als:\n                  " + opbouw.replace(/\n/g, "\n                  ") + "\n";
  uit += "\n" + "─".repeat(78) + "\n";
  uit += t === null ? "!! NIET GEVONDEN in docs/index.html — is de naam veranderd?\n" : t + "\n";
  uit += "─".repeat(78) + "\n";
}

uit += "\n\n" + streep(78) + "\n";
uit += "WAT DE CODE ACHTERAF NOG CONTROLEERT (staat dus NIET in de prompts)\n";
uit += streep(78) + "\n\n";
uit += [
  "• Citaten worden niet overgenomen zoals het model ze opschrijft: de app zoekt de passage",
  "  terug in de paginatekst en knipt hem daar zelf uit, op hele zinnen. Wat u ziet is",
  "  daarom altijd letterlijk, ook als het model slordig citeert.",
  "• Bedragen en termijnen in een verbindende zin worden vergeleken met het citaat en",
  "  verwijderd als ze er niet in staan.",
  "• Een verduidelijkingsvraag zonder bruikbare prefill valt af, net als vragen die voor",
  "  vrijwel elke beller gelden ('Woont u in het buitenland?').",
  "• Een vraag die aan de BELLER gericht is ('Bent u ingeschreven in de RNI?') wordt omgezet",
  "  naar een uitvraag met prefill, ook als het model hem bij de vervolgvragen zette.",
  "• Vervolgvragen gaan door de zoeklaag; wat nergens heen leidt valt af.",
  "• Bij een samengestelde vraag wordt gecontroleerd of de citaten alle delen raken.",
  "• In de spraakmodus vervalt een gereconstrueerde vraag die een invalshoek toevoegt die",
  "  niet is uitgesproken (bijvoorbeeld 'kost' terwijl er niet over geld ging).",
].join("\n") + "\n";

fs.writeFileSync(OUT, uit, "utf-8");
console.error("geschreven: " + OUT + " (" + uit.length + " tekens)");
