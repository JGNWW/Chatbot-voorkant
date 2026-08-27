// Regressietests voor de citaatlogica: een getoond citaat moet altijd LETTERLIJK, aaneengesloten
// en compleet zijn — nooit midden in een zin afgebroken, nooit met beletseltekens gemaskeerd.
//
// Gebruik: node scripts/quote_test.mjs            (faalt met exit 1 als een test faalt)
//
// De te testen functies staan in docs/index.html tussen de markeringen <<CITAAT-LOGICA>> en
// <</CITAAT-LOGICA>>. Dit bestand knipt dat blok eruit en voert het uit, zodat test en app
// gegarandeerd dezelfde code gebruiken; verdwijnt het blok, dan faalt de test meteen.
import fs from "fs";

const html = fs.readFileSync(new URL("../docs/index.html", import.meta.url), "utf-8");
const A = html.indexOf("// ===== <<CITAAT-LOGICA>>");
const B = html.indexOf("// ===== <</CITAAT-LOGICA>>");
if (A < 0 || B < 0) { console.error("CITAAT-LOGICA-blok niet gevonden in docs/index.html"); process.exit(1); }
// findFrom hoort bij de reservemethode en staat net buiten het blok.
const fn = (naam) => { const i = html.indexOf("function " + naam + "("); return html.slice(i, html.indexOf("\n}", i) + 2); };
const findFromSrc = fn("escRe") + "\n" + fn("findFrom");
const Q = new Function(
  findFromSrc + "\n" + html.slice(A, B) +
  "\nreturn {maakVerduidelijking,buildUnits,buildCitation,locateSpan,spanFromAnchors,isWeakQuote,quotesOverlap,bridgeIsSafe,quoteParagraphs,normForMatch};"
)();

let gefaald = 0, gedaan = 0;
function test(naam, fn) {
  gedaan++;
  try { fn(); console.log("  ✓ " + naam); }
  catch (e) { gefaald++; console.log("  ✗ " + naam + "\n      " + e.message); }
}
const eq = (a, b, wat) => { if (a !== b) throw new Error(`${wat || ""}\n      kreeg   : ${JSON.stringify(a)}\n      verwacht: ${JSON.stringify(b)}`); };
const waar = (v, wat) => { if (!v) throw new Error(wat || "verwachtte waar"); };

// Een citaat maken zoals de app dat doet: model wijst iets aan, app bepaalt de grenzen.
function citeer(text, aanwijzing, { heads = [], anchors = [], start, end } = {}) {
  const span = aanwijzing ? Q.locateSpan(text, aanwijzing) : Q.spanFromAnchors(text, start, end);
  return Q.buildCitation(text, span, new Set(heads), new Set(anchors));
}
// De harde eis waar alles op neerkomt.
function eisCompleet(cit, bron) {
  waar(cit, "geen citaat opgeleverd");
  waar(bron.includes(cit.text), "citaat staat niet letterlijk in de bron");
  waar(!/…|\.\.\./.test(cit.text), "citaat bevat een beletselteken");
  const laatste = cit.text.trim().split("\n").pop().trim();
  waar(/[.!?][)"'”’]?$/.test(laatste) || cit.lijst, "citaat eindigt midden in een zin: " + JSON.stringify(laatste.slice(-40)));
}

console.log("\nCITAATLOGICA\n");

// 1. Een relevante passage eindigt midden in een zin (het RDW-geval: inline link).
test("1. inline link breekt de zin niet af", () => {
  const bron = "Dat kan digitaal via RDW.nl. Om in te loggen op RDW.nl heeft u\nDigiD\nnodig.\nVermissing melden\n(RDW.nl)\nKunt u niet inloggen?";
  const cit = citeer(bron, "Om in te loggen op RDW.nl heeft u DigiD nodig.", { anchors: ["DigiD", "Vermissing melden"] });
  eisCompleet(cit, bron);
  eq(cit.text, "Om in te loggen op RDW.nl heeft u\nDigiD\nnodig.", "hele zin inclusief de inline link");
});

// 2. Een relevante passage bestaat uit meerdere zinnen.
test("2. meerdere zinnen blijven heel", () => {
  const bron = "Eerste zin over paspoorten. Tweede zin met details. Derde zin die er niet bij hoort.";
  const cit = citeer(bron, "Eerste zin over paspoorten. Tweede zin met details.");
  eisCompleet(cit, bron);
  eq(cit.text, "Eerste zin over paspoorten. Tweede zin met details.");
});

// 3. Een relevant antwoord staat verdeeld over twee opeenvolgende regels (chunks).
test("3. antwoord over twee regels wordt samengevoegd", () => {
  const bron = "U vraagt het aan bij de gemeente.\nDat kan alleen op afspraak.\nAndere sectie.";
  const cit = citeer(bron, "U vraagt het aan bij de gemeente. Dat kan alleen op afspraak.");
  eisCompleet(cit, bron);
  waar(cit.text.includes("op afspraak."), "tweede zin ontbreekt");
});

// 4. Een opsomming wordt gebruikt: die hoort er heel bij.
test("4. opsomming wordt compleet meegenomen", () => {
  const bron = "U heeft altijd deze documenten nodig:\neen ingevuld aanvraagformulier\neen geldig identiteitsbewijs\neen recente pasfoto\nKosten\nEen paspoort kost geld.";
  const cit = citeer(bron, "U heeft altijd deze documenten nodig:", { heads: ["Kosten"] });
  waar(cit, "geen citaat");
  waar(bron.includes(cit.text), "niet letterlijk");
  waar(cit.text.includes("pasfoto"), "opsomming afgekapt: " + JSON.stringify(cit.text));
  waar(!cit.text.includes("Kosten"), "liep door in de volgende sectie");
});

// 5. Twee bronpassages moeten met elkaar worden verbonden -> geen dubbele tekst.
test("5. overlappende passages worden herkend", () => {
  waar(Q.quotesOverlap("De aanvraag duurt drie weken.", "De aanvraag duurt drie weken."), "identiek niet herkend");
  waar(Q.quotesOverlap("De aanvraag duurt drie weken. Daarna krijgt u bericht.", "De aanvraag duurt drie weken."), "deelverzameling niet herkend");
  waar(!Q.quotesOverlap("De aanvraag duurt drie weken.", "Een paspoort kost 83,85 euro."), "onterecht als overlap gezien");
});

// 6. Er is geen overbruggingszin nodig: een lege brug is geldig.
test("6. lege overbruggingszin is toegestaan", () => {
  waar(Q.bridgeIsSafe("", "Wat dan ook."), "lege brug afgekeurd");
  waar(Q.bridgeIsSafe("Over de kosten:", "Een paspoort kost geld."), "onschuldige brug afgekeurd");
});

// 7. De AI zou informatie afleiden die niet in de bron staat -> brug vervalt.
test("7. brug met eigen feiten wordt geweigerd", () => {
  waar(!Q.bridgeIsSafe("De aanvraag duurt 3 weken.", "U vraagt het aan bij de gemeente."), "verzonnen termijn niet geweigerd");
  waar(!Q.bridgeIsSafe("Dat kost 83,85 euro.", "U vraagt het aan bij de gemeente."), "verzonnen bedrag niet geweigerd");
  waar(Q.bridgeIsSafe("Houd rekening met 3 weken.", "De aanvraag duurt 3 weken."), "termijn die WEL in de bron staat, geweigerd");
  waar(!Q.bridgeIsSafe("Dit is een veel te lange overbruggingszin die veel meer uitlegt dan strikt nodig is en die daarmee zelf een soort antwoord wordt in plaats van een verbinding.", "Bron."), "te lange brug niet geweigerd");
});

// 8. De bron bevat een uitzondering of voorwaarde: die mag niet wegvallen.
test("8. voorwaardezin blijft heel", () => {
  const bron = "U kunt het aanvragen bij de gemeente. Woont u in het buitenland? Dan doet u dat bij de ambassade.";
  const cit = citeer(bron, "Woont u in het buitenland? Dan doet u dat bij de ambassade.");
  eisCompleet(cit, bron);
  eq(cit.text, "Woont u in het buitenland? Dan doet u dat bij de ambassade.");
});

// 9. Dezelfde passage wordt met verschillende aanwijzingen geraakt -> zelfde citaat.
test("9. verschillende aanwijzingen geven hetzelfde citaat", () => {
  const bron = "Eerste zin hier. De aanvraag duurt drie weken. Laatste zin hier.";
  const a = citeer(bron, "De aanvraag duurt drie weken.");
  const b = citeer(bron, "aanvraag duurt drie");                       // halve zin als aanwijzing
  const c = citeer(bron, null, { start: "De aanvraag duurt", end: "drie weken." });
  eq(a.text, "De aanvraag duurt drie weken.");
  eq(b.text, a.text, "halve aanwijzing werd niet opgerekt tot de hele zin");
  eq(c.text, a.text, "ankermethode gaf een ander resultaat");
});

// 10. De bron bevat HTML-achtige opmaak/entiteiten: vergelijken normaliseert, tonen niet.
test("10. typografie wordt genegeerd bij zoeken, niet bij tonen", () => {
  const bron = "De regel “een geldig document” geldt altijd hier. Volgende zin.";
  const cit = citeer(bron, 'De regel "een geldig document" geldt altijd hier.');
  eisCompleet(cit, bron);
  waar(cit.text.includes("“"), "originele aanhalingstekens zijn vervangen bij het tonen");
});

// 11. De bron bevat links als eigen regels: menu-items zijn een grens, inline links niet.
test("11. menu-item begrenst het citaat", () => {
  const bron = "De aanvraag duurt drie weken.\nPaspoort aanvragen\nSchengenvisum aanvragen";
  const cit = citeer(bron, "De aanvraag duurt drie weken.", { anchors: ["Paspoort aanvragen", "Schengenvisum aanvragen"] });
  eisCompleet(cit, bron);
  eq(cit.text, "De aanvraag duurt drie weken.", "menu is meegeciteerd");
});

// 12. De bron bevat een kop gevolgd door tekst.
test("12. kop hoort niet in het citaat", () => {
  const bron = "Kosten\nEen paspoort kost 83,85 euro voor volwassenen. Voor kinderen is dat minder.\nTermijn\nHoud rekening met drie weken.";
  const cit = citeer(bron, "Een paspoort kost 83,85 euro voor volwassenen.", { heads: ["Kosten", "Termijn"] });
  eisCompleet(cit, bron);
  waar(!cit.text.startsWith("Kosten"), "kop staat nog in het citaat");
  waar(!cit.text.includes("Termijn"), "citaat liep door in de volgende sectie");
});

// 13. Meer relevante tekst dan er past: hele zinnen weglaten, niet afkappen.
test("13. te lange passage verliest hele zinnen, geen halve", () => {
  const zin = "Dit is een zin van precies tien woorden om mee te tellen. ";
  const bron = zin.repeat(30);
  const cit = citeer(bron, bron.trim());
  eisCompleet(cit, bron);
  const woorden = cit.text.trim().split(/\s+/).length;
  waar(woorden <= 110, "boven de woordgrens: " + woorden);
  waar(woorden > 60, "onnodig veel weggelaten: " + woorden);
});

// 14. Er is geen geschikte bronpassage.
test("14. onvindbare passage levert geen citaat op", () => {
  const bron = "Een paspoort kost 83,85 euro.";
  eq(citeer(bron, "Dit staat helemaal niet op deze pagina."), null, "verzonnen citaat werd toch geaccepteerd");
  eq(citeer(bron, null, { start: "Bestaat niet", end: "ook niet" }), null, "onvindbare ankers gaven toch een citaat");
});

// 15. Een los kopje of label is geen citaat.
test("15. kaal kopje wordt geweigerd", () => {
  waar(Q.isWeakQuote("Buitenland"), "kopje niet als zwak herkend");
  waar(Q.isWeakQuote("Let op:"), "label niet als zwak herkend");
  waar(!Q.isWeakQuote("U vraagt uw paspoort aan bij de gemeente."), "echte zin onterecht geweigerd");
  const bron = "Buitenland\nWoont u in het buitenland? Dan geldt een andere procedure.";
  const cit = citeer(bron, "Buitenland", { heads: ["Buitenland"] });
  if (cit) waar(!cit.text.trim().startsWith("Buitenland"), "kaal kopje werd als citaat getoond");
});

// --- uitvraagvragen ---
console.log("\nUITVRAAGVRAGEN\n");
test("prefill begint het antwoord in plaats van de vraag te herhalen", () => {
  const v = Q.maakVerduidelijking("In welk land woont u?", "Ik woon in");
  waar(v, "geldige verduidelijking werd geweigerd");
  eq(v.prefill, "Ik woon in ", "prefill hoort op een spatie te eindigen");
});
test("prefill die de vraag herhaalt valt af", () => {
  eq(Q.maakVerduidelijking("Woont u in Duitsland?", "Woont u in"), null, "echo van de vraag werd geaccepteerd");
  eq(Q.maakVerduidelijking("In welk land woont u?", "In welk land woont u?"), null, "identieke prefill werd geaccepteerd");
});
test("vraag die voor elke beller geldt valt af", () => {
  eq(Q.maakVerduidelijking("Woont u in het buitenland?", "Ik woon in "), null, "loze vraag werd geaccepteerd");
  waar(Q.maakVerduidelijking("In welk land woont u?", "Ik woon in "), "goede landvraag werd geweigerd");
});
test("verduidelijking zonder prefill valt af", () => {
  eq(Q.maakVerduidelijking("Is dit een eerste aanvraag of een verlenging?", ""), null);
  waar(Q.maakVerduidelijking("Is dit een eerste aanvraag of een verlenging?", "Het is een"), "geldige keuzevraag geweigerd");
});

// --- gesproken vraag mag geen invalshoek verzinnen ---
console.log("\nGESPROKEN VRAAG\n");
{
  // vraagIsTrouw zit in de spraakmodule (browsercode met DOM), dus de regel staat hier los
  // gespiegeld. Wijzigt de lijst in index.html, dan hoort deze mee te veranderen.
  const groepen = (html.match(/const INVALSHOEKEN=\[([\s\S]*?)\]\.map/) || [])[1];
  test("de invalshoekenlijst staat nog in de app", () => waar(!!groepen, "INVALSHOEKEN niet gevonden in docs/index.html"));
  const sets = (groepen || "").split("\n").map(r => (r.match(/"([^"]+)"/) || [])[1]).filter(Boolean).map(g => new Set(g.split(" ")));
  const woorden = t => new Set((t || "").toLowerCase().match(/[a-zà-ÿ]+/g) || []);
  const trouw = (ruw, vraag) => {
    const r = woorden(ruw), v = woorden(vraag);
    return sets.every(g => ![...v].some(w => g.has(w)) || [...r].some(w => g.has(w)));
  };
  test("verzonnen kostenvraag wordt geweigerd", () =>
    waar(!trouw("ik ben benieuwd wat paspoort kunnen aanvragen in het buitenland", "Wat kost een paspoort aanvragen in het buitenland?")));
  test("verzonnen locatievraag wordt geweigerd", () =>
    waar(!trouw("ik wil een paspoort aanvragen", "Waar kan ik een paspoort aanvragen?")));
  test("uitgesproken invalshoek blijft toegestaan", () => {
    waar(trouw("mevrouw vraagt zich af wat het kost", "Wat kost een paspoort?"), "kosten waren wel gezegd");
    waar(trouw("hoe lang moet ik wachten op mijn paspoort", "Hoe lang duurt een paspoortaanvraag?"), "tijd was wel gezegd");
    waar(trouw("ik ben benieuwd wat paspoort kunnen aanvragen", "Hoe vraag ik een paspoort aan?"), "geen invalshoek toegevoegd");
  });
}

// --- volledig generatief antwoord: vangrails ---
console.log("\nGENERATIEF ANTWOORD\n");
{
  const src = fn("getallenIn") + "\n" + fn("alineaKlopt");
  const G = new Function(src + "\nreturn {alineaKlopt};")();
  test("getal dat in de bron staat mag", () =>
    waar(G.alineaKlopt("De verwerkingstijd is 4 weken.", ["De reguliere verwerkingstijd is 4 weken."])));
  test("getal dat NIET in de bron staat valt af", () =>
    waar(!G.alineaKlopt("De verwerkingstijd is 6 weken.", ["De reguliere verwerkingstijd is 4 weken."])));
  test("bedrag dat NIET in de bron staat valt af", () => {
    waar(!G.alineaKlopt("Een paspoort kost \u20ac 83,85.", ["U betaalt alleen de kosten die nodig zijn."]));
    waar(G.alineaKlopt("Een paspoort kost \u20ac 83,85.", ["Een paspoort kost \u20ac 83,85 voor volwassenen."]), "bedrag stond wel in de bron");
    // Het WOORD euro zonder bedrag verzint niets. Deze regel sloeg juist bij kostenvragen toe en
    // gooide daardoor het hele generatieve antwoord weg.
    waar(G.alineaKlopt("Wat u in euro's betaalt, hangt af van het land waar u de aanvraag doet.",
      ["Wat u betaalt, hangt af van waar u de aanvraag doet."]), "euro zonder bedrag mag");
    waar(!G.alineaKlopt("Een paspoort kost 83,85 euro.", ["Wat u betaalt, hangt af van waar u de aanvraag doet."]),
      "bedrag in woorden-vorm zonder dekking valt af");
  });
  test("alinea zonder getallen is altijd in orde", () =>
    waar(G.alineaKlopt("U doet aangifte bij de lokale politie.", ["Doe aangifte bij de lokale politie."])));
}

// --- weergave ---
console.log("\nWEERGAVE\n");
test("inline link wordt in de alinea teruggeplaatst", () => {
  const alineas = Q.quoteParagraphs("Om in te loggen op RDW.nl heeft u\nDigiD\nnodig.", new Set(["DigiD"]));
  eq(alineas.length, 1, "zin werd in meerdere alinea's gesplitst");
  eq(alineas[0], "Om in te loggen op RDW.nl heeft u DigiD nodig.");
});
test("zinnen uit dezelfde bronalinea vormen één lopende alinea", () => {
  const alineas = Q.quoteParagraphs("Eerste zin van de alinea. Tweede zin van dezelfde alinea. Derde zin.", new Set());
  eq(alineas.length, 1, "één bronalinea werd in losse regels opgeknipt");
  eq(alineas[0], "Eerste zin van de alinea. Tweede zin van dezelfde alinea. Derde zin.");
});
test("geen spatie voor een leesteken na een inline link", () => {
  const alineas = Q.quoteParagraphs("U heeft het\npaspoortaanvraagformulier\nnodig.", new Set(["paspoortaanvraagformulier"]));
  eq(alineas[0], "U heeft het paspoortaanvraagformulier nodig.");
  const b = Q.quoteParagraphs("Zie het\nformulier\n. Daarna klaar.", new Set(["formulier"]));
  waar(!/\s\./.test(b.join(" ")), "spatie voor de punt: " + JSON.stringify(b));
});
test("lijstitems blijven aparte regels", () => {
  const alineas = Q.quoteParagraphs("U heeft nodig:\neen paspoort\neen pasfoto", new Set());
  eq(alineas.length, 3, "opsomming werd samengevoegd tot één regel");
});
test("losse alinea's blijven gescheiden", () => {
  const alineas = Q.quoteParagraphs("Eerste alinea eindigt hier.\nTweede alinea begint hier.", new Set());
  eq(alineas.length, 2);
});

// --- steekproef op het echte corpus ---
console.log("\nCORPUS-STEEKPROEF\n");
test("citaten uit het echte corpus zijn compleet en letterlijk", () => {
  const corpus = JSON.parse(fs.readFileSync(new URL("../docs/data/corpus.json", import.meta.url), "utf-8"));
  let gecontroleerd = 0, stuk = [];
  for (let i = 0; i < corpus.length; i += 37) {              // gespreide steekproef
    const p = corpus[i], tekst = p.text || "";
    if (tekst.length < 200) continue;
    const heads = new Set((p.headings || []).map(h => (h[1] || "").trim()).filter(Boolean));
    const anchors = new Set((p.links || []).map(l => (Array.isArray(l) ? l[0] : l || "").trim()).filter(Boolean));
    // Neem een willekeurig stuk uit het midden — precies het geval waarin het model een
    // halve zin zou kunnen aanwijzen.
    const m = tekst.slice(Math.floor(tekst.length / 3), Math.floor(tekst.length / 3) + 90);
    const cit = Q.buildCitation(tekst, Q.locateSpan(tekst, m), heads, anchors);
    if (!cit) continue;
    gecontroleerd++;
    const laatste = cit.text.trim().split("\n").pop().trim();
    // Een lijstitem eindigt van nature zonder punt; dat telt als compleet zolang er een
    // aankondiging met dubbele punt boven staat.
    const regels = cit.text.trim().split("\n");
    const inLijst = regels.length > 1 && regels.slice(0, -1).some(r => /:$/.test(r.trim()));
    const eindigtGoed = /[.!?][)"'”’]?$/.test(laatste) || inLijst;
    const letterlijk = tekst.includes(cit.text);
    const geenBeletsel = !/…/.test(cit.text) || tekst.includes("…");
    if (!eindigtGoed || !letterlijk || !geenBeletsel) stuk.push({ url: p.url, laatste: laatste.slice(-50), letterlijk, eindigtGoed });
  }
  console.log("      " + gecontroleerd + " citaten gecontroleerd, " + stuk.length + " onvolledig");
  if (stuk.length) {
    stuk.slice(0, 5).forEach(x => console.log("        - " + x.url + " -> " + JSON.stringify(x.laatste)));
    throw new Error(stuk.length + " van de " + gecontroleerd + " citaten was niet compleet");
  }
  waar(gecontroleerd > 50, "te weinig gecontroleerd: " + gecontroleerd);
});

console.log("\n" + (gedaan - gefaald) + "/" + gedaan + " geslaagd");
if (gefaald) process.exit(1);
