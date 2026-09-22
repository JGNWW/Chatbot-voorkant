// Haalt per testvraag het "uitgelicht fragment" (featured snippet) van een zoekmachine op. Dat
// fragment is de lat waar ons eigen citaat later blind naast gelegd wordt: de zoekmachine licht
// daar letterlijk een passage van nederlandwereldwijd.nl die de vraag zo volledig mogelijk
// beantwoordt. Een gereconstrueerd fragment is erger dan geen fragment — dan meet de beoordelaar
// niets meer — dus dit script verzint nooit iets en schrijft liever "niet gevonden" weg.
//
//   node scripts/haal_lat.mjs                       alle vragen uit scripts/aansluiting_set.json
//   node scripts/haal_lat.mjs --limit=3             alleen de eerste paar (proefrondje)
//   node scripts/haal_lat.mjs --pauze=6             seconden tussen twee zoekopdrachten
//
// Uitvoer: scratch/lat/lat.json + een schermafdruk per vraag in scratch/lat/schermafdrukken/.
//
// Dit script schrijft UITSLUITEND binnen zijn eigen uitvoermap en verwijdert nooit iets. In
// scratch/ draaien meerdere metingen tegelijk; een script dat daar "even opruimt" gooit andermans
// meetdata weg. Nodig je een schone start, maak dan een map met een andere naam.
import fs from "fs";
import path from "path";
import { chromium } from "playwright";

const arg = n => { const a = process.argv.find(x => x.startsWith("--" + n + "=")); return a ? a.slice(n.length + 3) : ""; };
const LIMIT = Number(arg("limit") || 0);
const PAUZE = Number(arg("pauze") || 4) * 1000;
const SITE = "nederlandwereldwijd.nl";
const BASIS = "https://www.nederlandwereldwijd.nl";

const UIT_DIR = new URL("../scratch/lat/", import.meta.url).pathname;
const SHOT_DIR = path.join(UIT_DIR, "schermafdrukken");
fs.mkdirSync(SHOT_DIR, { recursive: true });

const vragen = JSON.parse(fs.readFileSync(new URL("./aansluiting_set.json", import.meta.url), "utf-8"));
const set = LIMIT ? vragen.slice(0, LIMIT) : vragen;

// De omgeving heeft Chromium al staan; "playwright install" mag hier niet draaien.
const EXE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const PROXY = process.env.HTTPS_PROXY || process.env.https_proxy || "";
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

const wacht = ms => new Promise(r => setTimeout(r, ms));
// Witruimte, aanhalingstekens en streepjes gelijktrekken; alleen zo is "staat dit letterlijk op
// de pagina?" een eerlijke vraag. Zoekmachines vervangen bijvoorbeeld - door – en ' door ’.
const norm = s => (s || "")
  .replace(/ /g, " ")
  .replace(/[‘’‛]/g, "'")
  .replace(/[“”]/g, '"')
  .replace(/[‐-―]/g, "-")
  .replace(/\s+/g, " ")
  .trim();
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);

// ---------------------------------------------------------------- browser

// Chromium's eigen netwerkstack loopt door de proxy van deze omgeving vast op
// ERR_TOO_MANY_RETRIES zodra het om een zoekresultatenpagina gaat. Via route.fetch gaat het
// verkeer door de Node-stack van Playwright, die er wel doorheen komt; de pagina rendert daarna
// met de echte CSS en afbeeldingen, zodat de schermafdruk toont wat een mens zou zien.
async function maakContext(browser) {
  const ctx = await browser.newContext({
    locale: "nl-NL", timezoneId: "Europe/Amsterdam", viewport: { width: 1280, height: 1800 },
    userAgent: UA, ignoreHTTPSErrors: true,
  });
  // Het EU-toestemmingsscherm van Google is met deze cookies meestal al afgehandeld; wat er
  // toch nog overheen komt, wegklikken we hieronder.
  await ctx.addCookies([
    { name: "CONSENT", value: "YES+cb.20220419-08-p0.nl+FX+111", domain: ".google.com", path: "/" },
    { name: "SOCS", value: "CAISHAgCEhJnd3NfMjAyNDA5MDMtMF9SQzEaAm5sIAEaBgiAtqu3Bg", domain: ".google.com", path: "/" },
  ]);
  await ctx.route("**/*", async route => {
    try { await route.fulfill({ response: await route.fetch({ timeout: 25000 }) }); }
    catch { await route.abort().catch(() => {}); }
  });
  return ctx;
}

// Cookie-/consentmuur wegklikken. Blijft hij staan, dan merken we dat verderop doordat er geen
// resultaten op de pagina staan — en dan valt deze vraag terug op de andere zoekmachine.
async function consentWeg(page) {
  const knoppen = [
    "#L2AGLb", "#W0wltc", "button:has-text('Alles accepteren')", "button:has-text('Accept all')",
    "#bnp_btn_accept", "#bnp_btn_reject", "button:has-text('Accepteren')",
    "form[action*='consent'] button", "[aria-label='Alles accepteren']",
  ];
  for (const sel of knoppen) {
    const knop = page.locator(sel).first();
    if (await knop.count().catch(() => 0) && await knop.isVisible().catch(() => false)) {
      await knop.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(1500);
      return sel;
    }
  }
  return "";
}

// ---------------------------------------------------------------- uitlezen

// Google zet het uitgelichte fragment in een eigen blok boven de gewone treffers. De klassenamen
// wisselen, dus we proberen er een paar en nemen het eerste blok met echte tekst.
const GOOGLE_SNIPPET = [
  "div.xpdopen span.hgKElc", "span.hgKElc", "div.xpdopen .LGOjhe", ".LGOjhe",
  "div[data-attrid='wa:/description'] span", "block-component .wDYxhc span",
  ".webanswers-webanswers_table__webanswers-table", ".xpdopen ul.i8Z77e",
];
const GOOGLE_BRON = ["div.xpdopen a[href^='http']", "block-component a[href^='http']", "#rso a[href^='http']"];

// Bing zet zijn fragment in de "pole"-positie bovenaan, of in een antwoordblok (li.b_ans).
const BING_SNIPPET = [
  "#b_pole .b_algoSlug", "#b_pole li.b_ans .b_caption p", "li.b_ans .b_focusTextLarge",
  "li.b_ans .b_secondaryFocus", "li.b_ans .b_lineclamp4", "li.b_ans .b_caption p", "#b_pole .b_caption p",
];
const BING_BRON = ["#b_pole .b_algo h2 a", "#b_pole cite", "li.b_ans .b_attribution cite", "li.b_ans h2 a"];

async function leesFragment(page, snippetSels, bronSels) {
  return await page.evaluate(([sSels, bSels]) => {
    const tekst = el => (el.innerText || el.textContent || "").trim();
    for (const sel of sSels) {
      for (const el of document.querySelectorAll(sel)) {
        const t = tekst(el);
        // Korte brokjes zijn kopjes of labels, geen fragment dat een vraag beantwoordt.
        if (t.length < 40) continue;
        let bron = "";
        for (const bs of bSels) {
          const a = document.querySelector(bs);
          if (a) { bron = a.getAttribute("href") || tekst(a); break; }
        }
        return { tekst: t, bron, via: sel };
      }
    }
    return null;
  }, [snippetSels, bronSels]);
}

// Verzamelt de hosts waar de resultaten op deze pagina naar wijzen. Zoekmachines serveren
// datacenter-adressen soms een nepresultatenpagina over een heel ander onderwerp; dat is aan de
// hosts te zien en mag nooit als "geen fragment gevonden" doorgaan voor een echte meting.
async function resultaatHosts(page) {
  return await page.evaluate(() => {
    const uit = new Set();
    // Bing verstopt de echte bestemming achter een eigen doorstuur-URL; de host die de gebruiker
    // ziet staat in het cite-element, dus die tellen we mee.
    for (const c of document.querySelectorAll("#b_results cite, #rso cite, .b_attribution cite, .tptt"))
      (c.innerText || "").trim().replace(/^https?:\/\//, "").split(/[\/\s›]/)[0] && uit.add((c.innerText || "").trim().replace(/^https?:\/\//, "").split(/[\/\s›]/)[0].replace(/^www\./, "").toLowerCase());
    for (const a of document.querySelectorAll("#b_results a[href^='http'], #rso a[href^='http'], #search a[href^='http'], .b_algo a[href^='http']")) {
      try { uit.add(new URL(a.href).hostname.replace(/^www\./, "")); } catch {}
    }
    return [...uit].filter(Boolean).slice(0, 40);
  });
}

// Eén zoekopdracht: navigeren, consent weg, schermafdruk, fragment uitlezen. Geeft ook terug
// waaróm er niets uitkwam, want dat verschil (captcha, blokkade, of gewoon geen fragment) is
// voor de beoordelaar net zo belangrijk als het fragment zelf.
async function zoek(page, motor, vraagtekst, shotPad) {
  const url = motor === "google"
    ? "https://www.google.com/search?q=" + encodeURIComponent(vraagtekst) + "&hl=nl&gl=nl&pws=0"
    : "https://www.bing.com/search?q=" + encodeURIComponent(vraagtekst) + "&setlang=nl&cc=NL";

  try { await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 }); }
  catch (e) { return { motor, vraagtekst, fragment: null, reden: "navigatie mislukt: " + e.message.split("\n")[0] }; }

  await page.waitForTimeout(2500);
  const consent = await consentWeg(page);
  if (consent) await page.waitForTimeout(2000);

  // Bing verbergt zijn hele resultatenblok (visibility:hidden) als het een bot vermoedt. De
  // inhoud staat er wel; zichtbaar maken laat de schermafdruk zien wat de pagina bevat.
  await page.evaluate(() => { const c = document.getElementById("b_content"); if (c) c.style.visibility = "visible"; }).catch(() => {});

  await page.screenshot({ path: shotPad }).catch(() => {});
  const paginatekst = await page.evaluate(() => document.body ? document.body.innerText : "").catch(() => "");

  if (/ongebruikelijk verkeer|unusual traffic|recaptcha/i.test(paginatekst) || /\/sorry\//.test(page.url()))
    return { motor, vraagtekst, fragment: null, reden: "captcha/blokkade", consent, schermafdruk: path.basename(shotPad) };
  if (consent && /voordat je doorgaat|before you continue/i.test(paginatekst))
    return { motor, vraagtekst, fragment: null, reden: "consentmuur blijft staan", consent, schermafdruk: path.basename(shotPad) };

  const hosts = await resultaatHosts(page).catch(() => []);
  // De zoekopdracht noemt nederlandwereldwijd.nl met zoveel woorden. Komt die host in geen enkel
  // resultaat voor, dan kijken we niet naar echte treffers maar naar een afleidingspagina die
  // zoekmachines datacenter-adressen voorschotelen. Dat is geen "geen fragment" — dat is geen meting.
  if (hosts.length && !hosts.some(h => h.endsWith(SITE)))
    return { motor, vraagtekst, fragment: null, reden: "zoekmachine gaf onverwante resultaten (bot-afweer)", hosts: hosts.slice(0, 8), consent, schermafdruk: path.basename(shotPad) };

  const sels = motor === "google" ? [GOOGLE_SNIPPET, GOOGLE_BRON] : [BING_SNIPPET, BING_BRON];
  const gevonden = await leesFragment(page, sels[0], sels[1]).catch(() => null);
  if (!gevonden) return { motor, vraagtekst, fragment: null, reden: "geen uitgelicht fragment op de pagina", hosts: hosts.slice(0, 8), consent, schermafdruk: path.basename(shotPad) };

  return { motor, vraagtekst, fragment: norm(gevonden.tekst), bron_url: gevonden.bron, via: gevonden.via, consent, schermafdruk: path.basename(shotPad) };
}

// ---------------------------------------------------------------- controle

const paginaCache = new Map();
async function paginaTekst(ctx, url) {
  if (paginaCache.has(url)) return paginaCache.get(url);
  let tekst = "";
  try {
    const r = await ctx.request.get(url, { timeout: 30000 });
    if (r.ok()) {
      const html = await r.text();
      tekst = norm(html.replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&#39;|&rsquo;/gi, "'").replace(/&quot;/gi, '"'));
    }
  } catch {}
  paginaCache.set(url, tekst);
  return tekst;
}

// Staat het fragment écht zo op de bronpagina? Zoekmachines knippen met "..." of plakken twee
// losse zinnen aan elkaar. Zo'n fragment blijft bruikbaar als volledigheidslat (het zegt wat er
// beantwoord moet worden) maar niet als letterlijkheidslat, dus dat verschil leggen we vast.
function controleer(fragment, brontekst) {
  if (!brontekst) return { letterlijk: false, reden: "bronpagina niet op te halen" };
  const f = norm(fragment);
  if (brontekst.includes(f)) return { letterlijk: true, reden: "fragment staat woordelijk op de bronpagina" };
  // Op de beletseltekens splitsen: staan alle brokken los wél op de pagina, dan is het geknipt
  // maar niet verzonnen.
  const brokken = f.split(/\s*(?:\.\.\.|…)\s*/).map(norm).filter(b => b.length > 25);
  if (brokken.length > 1 && brokken.every(b => brontekst.includes(b)))
    return { letterlijk: false, reden: "aaneengeplakt uit losse stukken (elk stuk staat er wel)", brokken: brokken.length };
  const raak = brokken.filter(b => brontekst.includes(b)).length;
  return { letterlijk: false, reden: `niet woordelijk terug te vinden (${raak}/${brokken.length || 1} stukken wel)` };
}

// ---------------------------------------------------------------- hoofdlus

const browser = await chromium.launch({ executablePath: fs.existsSync(EXE) ? EXE : undefined, proxy: PROXY ? { server: PROXY } : undefined });
const ctx = await maakContext(browser);
const page = await ctx.newPage();

const rijen = [];
let nr = 0;
for (const v of set) {
  nr++;
  const naam = String(nr).padStart(2, "0") + "-" + slug(v.q);
  // Eerst de vraag met sitebeperking (zo hoort de lat te ontstaan), daarna zonder — een
  // uitgelicht fragment verschijnt bij Google vaker zonder site:-operator. Zonder beperking
  // tellen we het fragment alleen als de zoekmachine er nederlandwereldwijd.nl bij noemt.
  const pogingen = [
    ["google", `${v.q} site:${SITE}`],
    ["google", `${v.q} nederlandwereldwijd`],
    ["bing", `${v.q} site:${SITE}`],
    ["bing", `${v.q} nederlandwereldwijd`],
  ];

  const log = [];
  let treffer = null;
  for (const [motor, tekst] of pogingen) {
    const shot = path.join(SHOT_DIR, `${naam}--${motor}-${tekst.includes("site:") ? "site" : "kaal"}.png`);
    const r = await zoek(page, motor, tekst, shot);
    log.push({ motor: r.motor, zoekopdracht: r.vraagtekst, fragment: r.fragment ? r.fragment.slice(0, 120) + "…" : null, reden: r.reden || "", hosts: r.hosts, schermafdruk: r.schermafdruk });
    const opJuisteSite = r.bron_url ? r.bron_url.includes(SITE) : false;
    if (r.fragment && (tekst.includes("site:") || opJuisteSite)) { treffer = r; break; }
    await wacht(PAUZE);
  }

  const rij = {
    q: v.q,
    verwachte_url: v.url,
    fragment_gevonden: !!treffer,
    zoekmachine: treffer ? treffer.motor : null,
    zoekopdracht: treffer ? treffer.vraagtekst : null,
    fragment: treffer ? treffer.fragment : null,
    bron_url: treffer ? treffer.bron_url : null,
    schermafdruk: treffer ? "lat/" + treffer.schermafdruk : (log.length ? "lat/" + log[log.length - 1].schermafdruk : null),
    letterlijk: null,
    controle: treffer ? null : "geen fragment om te controleren",
    pogingen: log,
  };

  if (treffer) {
    // Tegen de pagina die de zoekmachine zelf noemt; kent hij er geen, dan tegen de pagina uit
    // de vragenset. Anders controleren we tegen iets wat niets met het fragment te maken heeft.
    const bron = treffer.bron_url && treffer.bron_url.startsWith("http") ? treffer.bron_url : BASIS + v.url;
    const tekst = await paginaTekst(ctx, bron);
    const c = controleer(treffer.fragment, tekst);
    rij.letterlijk = c.letterlijk;
    rij.controle = c.reden;
    rij.gecontroleerd_tegen = bron;
  }

  rijen.push(rij);
  const kort = treffer ? `${treffer.motor}${rij.letterlijk ? " (letterlijk)" : " (niet-letterlijk)"}` : "geen fragment — " + (log[log.length - 1] || {}).reden;
  console.log(`${nr}/${set.length} "${v.q}" → ${kort}`);
  await wacht(PAUZE);
}

await browser.close();

const gevonden = rijen.filter(r => r.fragment_gevonden);
const uit = {
  gedraaid_op: new Date().toISOString(),
  bron_set: "scripts/aansluiting_set.json",
  n: rijen.length,
  met_fragment: gevonden.length,
  via_google: gevonden.filter(r => r.zoekmachine === "google").length,
  via_bing: gevonden.filter(r => r.zoekmachine === "bing").length,
  letterlijk: gevonden.filter(r => r.letterlijk).length,
  rijen,
};
fs.mkdirSync(UIT_DIR, { recursive: true });
fs.writeFileSync(path.join(UIT_DIR, "lat.json"), JSON.stringify(uit, null, 1));
console.log(`\nscratch/lat/lat.json: ${uit.met_fragment}/${uit.n} met fragment (google ${uit.via_google}, bing ${uit.via_bing}), ${uit.letterlijk} letterlijk op de bronpagina.`);
