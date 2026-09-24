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
  "\nreturn {maakVerduidelijking,uitvraagPastBijBron,buildUnits,buildCitation,locateSpan,spanFromAnchors,isWeakQuote,quotesOverlap,bridgeIsSafe,quoteParagraphs,normForMatch,citaatBlokken,blokkenAlsTekst,maakTabel,lijstItems,structuurInAlinea};"
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
  waar(!Q.bridgeIsSafe("Neemt u minder dan \u20ac 10.000 mee?", "Neemt u minder dan \u20ac 10.000 mee? Dan hoeft u geen aangifte te doen."), "brug die het citaat herhaalt niet geweigerd");
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
test("uitvraag moet over de bronpagina gaan, niet over het voorbeeld uit de prompt", () => {
  // Rijbewijs kwijt: geen kind, en "eerst" staat er alleen als "meld het eerst bij de RDW".
  const rijbewijs = ["Mijn Nederlandse rijbewijs is kwijt of gestolen in het buitenland. Wat nu?\n"
    + "Meld het verlies of de diefstal van uw Nederlandse rijbewijs eerst bij de RDW.\n"
    + "Stap 2: Nieuw rijbewijs uit uw woonland aanvragen\n"
    + "Lees meer over hoe u uw Nederlandse rijbewijs kunt verlengen.\nIk woon in een ander EU-land"];
  eq(Q.uitvraagPastBijBron("Voor wie is de aanvraag: voor uzelf of voor een kind?", rijbewijs), false, "kind-vraag bij rijbewijs");
  eq(Q.uitvraagPastBijBron("Is dit een eerste aanvraag of een verlenging?", rijbewijs), false, "losse woorden verspreid over de pagina tellen niet");
  waar(Q.uitvraagPastBijBron("In welk land woont u?", rijbewijs), "landvraag bij rijbewijs werd geweigerd");
  // Staat het wel op de pagina, dan blijft de vraag staan.
  const paspoort = ["Wilt u een paspoort aanvragen voor uw kind? Dan moeten beide ouders toestemming geven."];
  waar(Q.uitvraagPastBijBron("Voor wie is de aanvraag: voor uzelf of voor een kind?", paspoort), "kind-vraag bij paspoortpagina werd geweigerd");
  // Noemt de burger het zelf, dan telt dat ook.
  waar(Q.uitvraagPastBijBron("Voor wie is de aanvraag: voor uzelf of voor een kind?", [...rijbewijs, "Rijbewijs kwijt, gaat om mijn kind"]), "woord uit de vraag van de burger telt niet mee");
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
  const eenheden = html.slice(html.indexOf("const EENHEDEN={"), html.indexOf("};", html.indexOf("const EENHEDEN={")) + 2);
  const src = [eenheden, fn("getalCanon"), fn("eenheidVan"), fn("getalPlekken"), fn("getalInBron"),
               fn("herstelGetallen"), fn("alineaKlopt"), fn("vreemdGetal")].join("\n");
  const G = new Function(src + "\nreturn {alineaKlopt,herstelGetallen,getalCanon};")();
  // De app herstelt eerst en keurt daarna; deze hulp doet precies wat schrijfAntwoord doet.
  const keur = (tekst, passages) => {
    const def = G.herstelGetallen(tekst, passages).tekst;
    return G.alineaKlopt(def, passages) ? def : null;
  };
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
  // Losse cijfers uit een groter getal telden vroeger mee als dekking: in "55,45" zit een "5",
  // dus een verzonnen "5 jaar geldig" kwam er zo doorheen. Nu wordt er op GETAL vergeleken.
  test("cijfer uit een ander getal dekt niets", () =>
    waar(!G.alineaKlopt("Uw paspoort is 5 jaar geldig.", ["De spoedtoeslag is € 55,45."])));

  const BRON = ["Een paspoort kost € 83,85. Uw paspoort is 10 jaar geldig. Dit tarief geldt sinds 2023."];
  test("andere schrijfwijze wordt gelijkgetrokken, niet weggegooid", () => {
    eq(keur("Een paspoort kost 83.85 euro.", BRON), "Een paspoort kost 83,85 euro.", "punt werd komma");
    eq(G.getalCanon("1.234,50"), G.getalCanon("1234,50"), "duizendtallen tellen niet mee");
  });
  test("eenheid komt maar één keer voor: het getal van de bron wint", () => {
    eq(keur("Uw paspoort is 5 jaar geldig.", BRON), "Uw paspoort is 10 jaar geldig.");
    eq(keur("Dit tarief geldt sinds 2024.", BRON), "Dit tarief geldt sinds 2023.", "jaartal");
  });
  test("twee bedragen in de bron: niet gokken, wel afkeuren", () =>
    eq(keur("Een paspoort kost € 90,00.", ["Een paspoort kost € 83,85. De spoedtoeslag is € 55,45."]), null));
  test("getal zonder eenheid wordt niet vervangen", () =>
    eq(keur("U heeft 7 nodig.", ["U heeft 3 nodig."]), null));
  test("herstel raakt de rest van de zin niet", () => {
    const r = G.herstelGetallen("U betaalt 83.85 en wacht 5 jaar.", BRON);
    eq(r.tekst, "U betaalt 83,85 en wacht 10 jaar.");
    eq(r.hersteld.length, 2);
  });
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

// --- tabellen: het antwoord dat niet uit zinnen bestaat ---
console.log("\nTABELLEN\n");

// T1. Het geval waar de klacht mee begon: "wat kost een paspoort?" staat in een tabel, en de
//     crawler zet elke cel op een eigen regel. Geen van die regels is een zin.
test("T1. een prijstabel levert een compleet citaat op", () => {
  const bron = "Wat u betaalt, hangt af van waar u de aanvraag doet.\n" +
    "Kosten paspoort of ID-kaart bij ambassade of consulaat-generaal\nDocument\nKosten\n" +
    "Paspoort 18 jaar en ouder\n\u20ac 169,15\nPaspoort t/m 17 jaar\n\u20ac 147,40\n" +
    "Toeslag tijdelijke aanvraaglocatie\nEen pop-up ambassade is een tijdelijke locatie.";
  const cit = citeer(bron, "Paspoort 18 jaar en ouder", { heads: ["Toeslag tijdelijke aanvraaglocatie"] });
  waar(cit, "geen citaat: de tabel werd weggegooid");
  waar(bron.includes(cit.text), "citaat staat niet letterlijk in de bron");
  waar(cit.text.includes("\u20ac 147,40"), "tabel afgekapt: de rest van de rijen ontbreekt");
  waar(cit.text.startsWith("Kosten paspoort of ID-kaart"), "aankondigingsregel boven de tabel ontbreekt: " + JSON.stringify(cit.text.slice(0, 40)));
  waar(!cit.text.includes("pop-up"), "citaat liep door in de volgende sectie");
});

// T2. Twee losse regels zijn meestal geen tabel maar een restje van een lijst met links; dragen
//     ze een BEDRAG, dan zijn ze wel inhoud.
test("T2. twee regels met een bedrag tellen wel, twee landnamen niet", () => {
  const geld = "Kosten voor naturalisatie\n\u2022    Naturalisatie 1 volwassene: \u20ac 1139\n\u2022    Mee-naturaliseren kind jonger dan 18: \u20ac 168\nLet op:";
  const cit = citeer(geld, "Naturalisatie 1 volwassene: \u20ac 1139", { heads: ["Kosten voor naturalisatie"] });
  waar(cit, "geen citaat voor de twee prijsregels");
  waar(cit.text.includes("\u20ac 168"), "tweede prijsregel ontbreekt");
  const landen = "Verdragslanden\nArgentini\u00eb\nAustrali\u00eb\nU leest hier meer over verdragslanden.";
  waar(!citeer(landen, "Argentini\u00eb\nAustrali\u00eb", { heads: ["Verdragslanden"] }), "twee losse landnamen zijn als citaat getoond");
});

// T3. Staat de tweede kolom tussen haakjes, dan rijgt de zinsopbouw de hele tabel aan elkaar tot
//     één eenheid. Ook dat is een tabel en geen halve zin.
test("T3. tabel die als \u00e9\u00e9n regel is samengevoegd telt ook", () => {
  const bron = "U kunt de code ophalen bij een balie.\nDigiD-balie in het buitenland\n" +
    "Australi\u00eb\n(Sydney)\nCanada\n(Vancouver)\nThailand\n(Bangkok)";
  const cit = citeer(bron, "Thailand\n(Bangkok)", { heads: ["DigiD-balie in het buitenland"] });
  waar(cit, "geen citaat: de landenlijst werd weggegooid");
  waar(cit.text.includes("Australi\u00eb") && cit.text.includes("(Bangkok)"), "lijst niet compleet: " + JSON.stringify(cit.text));
});

// T4. Een regel met een vraagteken aan het eind is een kopje of een aanloop, nooit het slot.
test("T4. een citaat eindigt niet op een vraag", () => {
  const bron = "U mag het volgende meenemen:\n110 liter bier, en:\n10 liter sterke drank\n" +
    "U betaalt hierover geen belasting.\nWat moet ik doen als ik meer meeneem?\nNeemt u meer mee? Dan geldt iets anders.";
  const cit = citeer(bron, "110 liter bier, en:");
  waar(cit, "geen citaat");
  waar(cit.text.includes("10 liter sterke drank"), "opsomming afgekapt");
  waar(!/\?$/.test(cit.text.trim()), "citaat eindigt op een vraag: " + JSON.stringify(cit.text.slice(-50)));
});

// T5. Deze site schrijft in vraag-antwoordvorm. Het antwoord alleen is een halve waarheid.
test("T5. een citaat dat met \"Dan\" begint krijgt zijn voorwaarde erbij", () => {
  const bron = "U mag zoveel geld meenemen als u wilt.\nNeemt u minder dan \u20ac 10.000 mee?\nDan hoeft u geen aangifte te doen in Nederland.";
  const cit = citeer(bron, "Dan hoeft u geen aangifte te doen in Nederland.");
  eisCompleet(cit, bron);
  waar(cit.text.startsWith("Neemt u minder dan"), "voorwaarde ontbreekt: " + JSON.stringify(cit.text));
  // Maar niet zomaar de vorige zin erbij als het geen voorwaarde is.
  const bron2 = "De aanvraag duurt drie weken.\nDan krijgt u een e-mail.";
  const cit2 = citeer(bron2, "Dan krijgt u een e-mail.");
  eq(cit2.text, "Dan krijgt u een e-mail.", "gewone vorige zin werd meegetrokken");
});

// T6. Wijst het model twee items van een opsomming aan, dan is de rest van de lijst geen
//     overbodige tekst maar de rest van het antwoord.
test("T6. een half aangewezen opsomming wordt afgemaakt", () => {
  const bron = "De Europese Unie (EU) bestaat uit 27 landen:\nBelgi\u00eb\nBulgarije\nCyprus\nDenemarken\nZweden\nDe EU-landen Cyprus en Ierland zijn geen Schengenlanden.";
  const cit = citeer(bron, "De Europese Unie (EU) bestaat uit 27 landen:\nBelgi\u00eb\nBulgarije");
  waar(cit, "geen citaat");
  waar(cit.text.includes("Zweden"), "lijst afgekapt: " + JSON.stringify(cit.text));
  waar(!cit.text.includes("geen Schengenlanden"), "citaat liep door in de lopende tekst erna");
});

// T7. Een citaat dat alleen uit een vraag bestaat is een kopje, geen antwoord.
test("T7. een losse vraag is geen citaat", () => {
  waar(Q.isWeakQuote("Beslis op tijd: blijven of vertrekken?"), "losse vraag werd als citaat geaccepteerd");
  waar(!Q.isWeakQuote("Woont u in het buitenland? Dan vraagt u het aan bij de ambassade."), "vraag met antwoord erachter werd afgekeurd");
});

// T8. Een voorwaardenlijst waarvan het voegwoord op een eigen regel staat, mag niet op dat
//     voegwoord eindigen: dan leest de voorlichter een halve voorwaarde voor.
test("T8. citaat eindigt niet op een kaal \"en\" of \"of\"", () => {
  const bron = "U kunt een Anw-uitkering krijgen als u:\nonder de AOW-leeftijd bent,\nen\neen kind onder de 18 heeft,\nof\nminstens 45% arbeidsongeschikt bent.\nWezenuitkering";
  const cit = citeer(bron, "onder de AOW-leeftijd bent,", { heads: ["Wezenuitkering"] });
  waar(cit, "geen citaat");
  waar(cit.text.includes("45% arbeidsongeschikt bent."), "laatste voorwaarde ontbreekt: " + JSON.stringify(cit.text));
  waar(!/\b(en|of)$/i.test(cit.text.trim()), "citaat eindigt op een kaal voegwoord");
  waar(!cit.text.includes("Wezenuitkering"), "citaat liep door in de volgende sectie");
});

// --- opmaak: wat de voorlichter op het scherm ziet ---
console.log("\nOPMAAK\n");

const blokken = (t) => Q.citaatBlokken(t, new Set(), new Set());

// O1. Een tarieftabel wordt een tabel, met de aankondiging als titel en de kolomkoppen apart.
test("O1. prijstabel wordt een tabel met kop en rijen", () => {
  const b = blokken("Kosten paspoort of ID-kaart bij ambassade of consulaat-generaal\nDocument\nKosten\n" +
    "Paspoort 18 jaar en ouder\n\u20ac 169,15\nPaspoort t/m 17 jaar\n\u20ac 147,40\nID-kaart 18 jaar en ouder\n\u20ac 167,80");
  eq(b.length, 1, "verwachtte één blok");
  eq(b[0].soort, "tabel", "geen tabel herkend");
  eq(b[0].titel, "Kosten paspoort of ID-kaart bij ambassade of consulaat-generaal");
  eq(JSON.stringify(b[0].kop), JSON.stringify(["Document", "Kosten"]));
  eq(b[0].rijen.length, 3);
  eq(JSON.stringify(b[0].rijen[0]), JSON.stringify(["Paspoort 18 jaar en ouder", "\u20ac 169,15"]));
});

// O2. Een rij landnamen is géén tabel: twee kolommen suggereren een verband dat er niet is.
test("O2. een landenlijst blijft een opsomming", () => {
  const b = blokken("De Europese Unie (EU) bestaat uit 27 landen:\nBelgi\u00eb\nBulgarije\nCyprus\nDenemarken");
  eq(b.length, 2);
  eq(b[0].soort, "alinea");
  eq(b[1].soort, "lijst");
  eq(b[1].items.length, 4);
  waar(!b.some(x => x.soort === "tabel"), "landen als tabel getoond");
});

// O3. Staat de tweede kolom tussen haakjes, dan is er geen kolomkop: dat is meteen data.
test("O3. tabel zonder kolomkop", () => {
  const b = blokken("Australi\u00eb\n(Sydney)\nCanada\n(Vancouver)\nThailand\n(Bangkok)");
  eq(b[0].soort, "tabel");
  eq(b[0].kop, null, "eerste rij ten onrechte als kop gelezen");
  eq(b[0].rijen.length, 3);
});

// O4. Het bolletje uit de bron is de markering, niet de inhoud; een kaal voegwoord hoort bij
//     het item ervoor.
test("O4. bolletjes en losse voegwoorden", () => {
  const b = blokken("U kunt een Anw-uitkering krijgen als u:\nonder de AOW-leeftijd bent,\nen\neen kind onder de 18 heeft,\nof\nminstens 45% arbeidsongeschikt bent.");
  const lijst = b.find(x => x.soort === "lijst");
  waar(lijst, "geen opsomming herkend");
  eq(lijst.items.length, 3, "voegwoorden werden losse bolletjes");
  eq(lijst.items[0], "onder de AOW-leeftijd bent, en");
  const met = blokken("Kosten voor naturalisatie\n\u2022    Naturalisatie 1 volwassene: \u20ac 1139\n\u2022    Mee-naturaliseren kind jonger dan 18: \u20ac 168");
  const l2 = met.find(x => x.soort === "lijst");
  waar(l2 && l2.items.every(t => !/^[\u2022*-]/.test(t)), "bolletje uit de bron bleef staan: " + JSON.stringify(l2 && l2.items));
});

// O5. Op het klembord hoort dezelfde opbouw te staan, anders plakt de voorlichter een kolom
//     losse bedragen in zijn mail.
test("O5. platte tekst houdt de opbouw", () => {
  const t = Q.blokkenAlsTekst(blokken("Document\nKosten\nPaspoort 18 jaar en ouder\n\u20ac 169,15\nPaspoort t/m 17 jaar\n\u20ac 147,40\nID-kaart\n\u20ac 167,80"));
  waar(t.includes("Paspoort 18 jaar en ouder: \u20ac 169,15"), "tabelrij niet als 'omschrijving: waarde': " + JSON.stringify(t));
  const l = Q.blokkenAlsTekst(blokken("U heeft nodig:\neen pasfoto\neen paspoort"));
  waar(/- een pasfoto/.test(l), "opsomming zonder streepjes: " + JSON.stringify(l));
});

// O6. Een ECHTE opsomming uit de bron-HTML (veld "lists", zie scripts/add_lists.py). Het
//     stappenplan op de DigiD-pagina kwam als bolletjes op het scherm, een stap van twee zinnen
//     werd twee bolletjes, en de "Let op:" eronder werd óók een bolletje.
test("O6. genummerd stappenplan uit de bron blijft genummerd en compleet", () => {
  const pagina = "Wilt u uw gebruikersnaam opvragen via de DigiD-website? Volg hiervoor deze stappen:\n" +
    "Ga naar DigiD Gebruikersnaam opvragen\n.\nKlik op \u2018Volgende\u2019.\n" +
    "Voer uw burgerservicenummer (BSN) en DigiD-wachtwoord in.\nLees waar u uw BSN vindt\n.\n" +
    "U ontvangt een code per e-mail. Vul deze code in en tik op \u2018Volgende\u2019.\n" +
    "Uw gebruikersnaam verschijnt in beeld.\nLet op:\nHeeft u geen toegang meer tot dit e-mailadres? Dan kunt u uw gebruikersnaam niet op deze manier opvragen.";
  const item = (van, tot) => { const s = pagina.indexOf(van); return [s, pagina.indexOf(tot, s) + tot.length]; };
  const lists = [[1, ...item("Ga naar", "\n."), ...item("Klik op", "\u2019."), ...item("Voer uw", "vindt\n."),
    ...item("U ontvangt", "\u2019."), ...item("Uw gebruikers", "beeld.")]];
  const anchors = new Set(["Ga naar DigiD Gebruikersnaam opvragen", "Lees waar u uw BSN vindt"]);
  const b = Q.citaatBlokken(pagina, anchors, new Set(), Q.lijstItems(pagina, lists, pagina));
  eq(b.map(x => x.soort).join(","), "alinea,lijst,alinea,alinea", "verkeerde opbouw: " + JSON.stringify(b));
  const l = b[1];
  eq(l.genummerd, true, "stappenplan niet genummerd");
  eq(l.items.length, 5, "verkeerd aantal stappen: " + JSON.stringify(l.items));
  eq(l.items[0], "Ga naar DigiD Gebruikersnaam opvragen.");
  eq(l.items[2], "Voer uw burgerservicenummer (BSN) en DigiD-wachtwoord in. Lees waar u uw BSN vindt.");
  eq(l.items[3], "U ontvangt een code per e-mail. Vul deze code in en tik op \u2018Volgende\u2019.");
  eq(b[2].tekst, "Let op:", "'Let op:' werd een lijstitem");
  // Begint het citaat halverwege, dan loopt de nummering door waar de bron is.
  const deel = pagina.slice(pagina.indexOf("Voer uw"), pagina.indexOf("Let op:") - 1);
  const b2 = Q.citaatBlokken(deel, anchors, new Set(), Q.lijstItems(pagina, lists, deel));
  eq(b2[0].start, 3, "nummering begint niet bij stap 3");
  const tekst = Q.blokkenAlsTekst(b2);
  waar(/^3\. Voer uw/.test(tekst) && /\n5\. Uw gebruikersnaam/.test(tekst), "klembord zonder nummers: " + JSON.stringify(tekst));
  // Zonder lijstgegevens (oude corpus) blijft de oude herkenning werken.
  eq(Q.lijstItems(pagina, undefined, pagina), null);
});

// O7. Volledig generatief: neemt de AI een stappenplan of tabel LETTERLIJK over, dan krijgt dat
//     stuk zijn vorm uit de bron terug. Anders staan negen stappen achter elkaar in één alinea.
test("O7. letterlijk overgenomen stappen en tabelrijen in een AI-alinea", () => {
  const stappen = { soort: "lijst", genummerd: true, start: 1, items: ["Ga naar Mijn DigiD en log in met de DigiD app.",
    "Klik op 'Meer details' (onder 'Met gebruikersnaam en wachtwoord').", "Kies 'Wachtwoord wijzigen'.", "Voer uw nieuwe wachtwoord 2 keer in."] };
  const ai = "U kunt uw wachtwoord herstellen met de DigiD app. Ga naar Mijn DigiD en log in met de DigiD app. " +
    "Klik op \u2018Meer details\u2019 (onder \u2018Met gebruikersnaam en wachtwoord\u2019). Kies 'Wachtwoord wijzigen'. Daarna bent u klaar.";
  const b = Q.structuurInAlinea(ai, [stappen]);
  eq(b.map(x => x.soort).join(","), "alinea,lijst,alinea", "verkeerde opbouw: " + JSON.stringify(b));
  eq(b[0].tekst, "U kunt uw wachtwoord herstellen met de DigiD app.");
  eq(b[1].items.length, 3); eq(b[1].genummerd, true); eq(b[1].start, 1);
  eq(b[2].tekst, "Daarna bent u klaar.");
  // Met nummers die het model zelf ervoor zette, en halverwege beginnend.
  const b2 = Q.structuurInAlinea("3. Kies 'Wachtwoord wijzigen'. 4. Voer uw nieuwe wachtwoord 2 keer in.", [stappen]);
  eq(b2.length, 1, JSON.stringify(b2)); eq(b2[0].start, 3);
  // Eén losse stap is geen opsomming.
  const b3 = Q.structuurInAlinea("Kies 'Wachtwoord wijzigen'. Dan bent u er.", [stappen]);
  eq(b3.length, 1); eq(b3[0].soort, "alinea");
  // Tabelrijen, met of zonder dubbele punt ertussen.
  const tabel = { soort: "tabel", titel: null, kop: ["Document", "Kosten"], rijen: [["Paspoort 18 jaar en ouder", "\u20ac 169,15"], ["Paspoort t/m 17 jaar", "\u20ac 147,40"], ["ID-kaart", "\u20ac 167,80"]] };
  const t = Q.structuurInAlinea("De kosten zijn: Paspoort 18 jaar en ouder: \u20ac 169,15, Paspoort t/m 17 jaar \u20ac 147,40.", [tabel]);
  eq(t.map(x => x.soort).join(","), "alinea,tabel", JSON.stringify(t));
  eq(t[1].rijen.length, 2);
  waar(/^1\. Ga naar/.test(Q.blokkenAlsTekst(b.slice(1, 2))), "klembord zonder nummers");
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
