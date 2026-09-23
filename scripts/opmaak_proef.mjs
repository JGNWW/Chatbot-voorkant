// Beeldproef voor de weergave van een citaat: staat een tabel er als tabel, een opsomming als
// opsomming, en blijft het gele citaat in de bronviewer op zijn plek?
//
// De rookproef (browser_test.mjs) controleert dát de pagina werkt; dit script laat ZIEN hoe een
// citaat eruitziet. Dat is nodig omdat "onoverzichtelijk" geen assertie is: je moet er even naar
// kijken. Het schrijft schermafdrukken naar de opgegeven map en verwijdert nooit iets.
//
// Gebruik: node scripts/opmaak_proef.mjs [uitvoermap]
import { chromium } from "playwright";
import http from "http";
import fs from "fs";
import path from "path";

const ROOT = new URL("../docs/", import.meta.url).pathname;
const UIT = path.resolve(process.argv[2] || "scratch/opmaak");
fs.mkdirSync(UIT, { recursive: true });
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".bin": "application/octet-stream", ".css": "text/css", ".png": "image/png", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json" };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end("nee"); }
  res.writeHead(200, { "content-type": TYPES[path.extname(p)] || "application/octet-stream" });
  fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, r));
const base = "http://127.0.0.1:" + server.address().port;

const VOORAF = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch(fs.existsSync(VOORAF) ? { executablePath: VOORAF } : {});
const page = await browser.newPage({ viewport: { width: 860, height: 1000 } });
const fouten = [];
page.on("pageerror", e => fouten.push("pageerror: " + e.message));
await page.goto(base + "/index.html", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => typeof CORPUS !== "undefined" && CORPUS.length > 0, null, { timeout: 120000 });

// De gevallen waar het om gaat: een prijstabel, een landenlijst met kolommen, een opsomming en
// een voorwaardenlijst. Per geval wijst het script de regel aan die het model zou aanwijzen.
const GEVALLEN = [
  ["prijstabel", "/paspoort-id-kaart/kosten-buitenland", "Paspoort 18 jaar en ouder"],
  ["balies", "/digid-buiten-nederland/activeringscode-balie", "Thailand"],
  ["landenlijst", "/landen-eu-eva-eer-schengen", "De Europese Unie (EU) bestaat uit 27 landen:"],
  ["voorwaarden", "/anw-uitkering-buiten-nederland/anw-uitkering-krijgen", "onder de AOW-leeftijd bent,"],
];

const uitslag = await page.evaluate(gevallen => {
  const kort = u => u.replace("https://www.nederlandwereldwijd.nl", "");
  const out = [];
  // In het ECHTE chatvenster renderen, met dezelfde bubbel eromheen: een citaatblok krijgt zijn
  // breedte van die bubbel, dus los in een kaal <div> meet je een lay-out die niemand ziet.
  // Een losse laag over de pagina heen, met de bubbel op zijn echte breedte: zo staat er op de
  // afdruk alleen waar het om gaat, en klopt de lay-out nog steeds.
  const bak = document.createElement("div");
  bak.id = "proefbak";
  bak.style.cssText = "position:absolute;top:0;left:0;width:760px;z-index:99999;background:#fff;padding:10px 16px 18px;";
  document.body.appendChild(bak);
  for (const [naam, url, aanwijzing] of gevallen) {
    const idx = CORPUS.findIndex(p => kort(p.url) === url);
    if (idx < 0) { out.push({ naam, fout: "pagina niet gevonden" }); continue; }
    const txt = CORPUS[idx].text;
    const i = txt.indexOf(aanwijzing);
    const s = txt.lastIndexOf("\n", i) + 1;
    let e = txt.indexOf("\n", i + aanwijzing.length); if (e < 0) e = txt.length;
    const cit = citationFor(idx, { start: s, end: e });
    if (!cit) { out.push({ naam, fout: "geen citaat" }); continue; }
    const c = { text: cit.text, srcIdx: idx, start: cit.start, src: srcOf(idx) };
    const blok = document.createElement("div");
    blok.className = "proefblok";
    blok.innerHTML = `<h3 style="font:600 15px system-ui;color:#154273;margin:18px 0 6px">${naam} — ${url}</h3>`
      + `<div class="turn"><div class="row bot"><div class="bubble antwoord" style="max-width:700px;width:700px">`
      + `<div class="passage verified"><span class="ans-lab">NWW</span><div class="cite-col">`
      + `<div class="cite-body">${citeBodyHTML(c)}</div>`
      + `<div class="bronvak"><div class="bronkaart" style="position:static;display:block;opacity:1;visibility:visible;margin-top:8px">`
      + `<h4>${(CORPUS[idx].title||"").replace(" | NederlandWereldwijd","")}</h4>`
      + `<div class="pas">${blokkenHTML(citaatBlokken(c.text,anchorSet(idx),headingSet(idx)),"pas")}</div>`
      + `</div></div></div></div></div></div>`;
    bak.appendChild(blok);
    out.push({ naam, url, tabellen: blok.querySelectorAll("table").length, lijsten: blok.querySelectorAll("ul").length, quote: cit.text.slice(0, 60) });
  }
  return out;
}, GEVALLEN);

// Alleen het proefblok afbeelden: de welkomtekst en de instellingenbalk zeggen hier niets.
await page.locator("#proefbak").screenshot({ path: path.join(UIT, "citaten.png") });

// En de bronviewer: het gele citaat moet in de tabel staan, niet ernaast.
await page.evaluate(() => { const b = document.getElementById("proefbak"); if (b) b.remove(); });
const viewer = await page.evaluate(async () => {
  const kort = u => u.replace("https://www.nederlandwereldwijd.nl", "");
  const idx = CORPUS.findIndex(p => kort(p.url) === "/paspoort-id-kaart/kosten-buitenland");
  const txt = CORPUS[idx].text, i = txt.indexOf("Paspoort 18 jaar en ouder");
  const s = txt.lastIndexOf("\n", i) + 1; let e = txt.indexOf("\n", i + 25); if (e < 0) e = txt.length;
  const cit = citationFor(idx, { start: s, end: e });
  await openViewer(idx, cit.text, CORPUS[idx].url, CORPUS[idx].title);
  const hl = document.querySelector("#viewer-body #hl");
  const marks = [...document.querySelectorAll("#viewer-body mark.hl")];
  return { gemarkeerd: !!hl, inTabel: marks.filter(m => m.closest("table")).length,
           markeringen: marks.length, tabellen: document.querySelectorAll("#viewer-body table").length };
});
await page.locator("#viewer").screenshot({ path: path.join(UIT, "bronviewer.png") });
await browser.close(); server.close();

console.log("CITAATBLOKKEN");
for (const u of uitslag) console.log(" ", u.fout ? `${u.naam}: FOUT ${u.fout}` : `${u.naam}: ${u.tabellen} tabel(len), ${u.lijsten} lijst(en) — ${JSON.stringify(u.quote)}…`);
console.log("\nBRONVIEWER");
console.log(`  citaat gemarkeerd: ${viewer.gemarkeerd ? "ja" : "NEE"} | ${viewer.markeringen} gele stukken, waarvan ${viewer.inTabel} in de tabel | tabellen op de pagina: ${viewer.tabellen}`);
console.log(`\nschermafdrukken: ${path.join(UIT, "citaten.png")} en ${path.join(UIT, "bronviewer.png")}`);
if (fouten.length) { console.error("JS-fouten:\n" + fouten.map(f => " - " + f).join("\n")); process.exit(1); }
