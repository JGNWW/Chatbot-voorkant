// Rookproef in een echte browser: laadt docs/index.html, wacht tot het corpus binnen is en
// controleert dat de zoekkern daar hetzelfde rangschikt als in Node. Vangt op wat een
// eval-harnas niet ziet: een stuk kapotte pagina, een ontbrekend script, een globale naam die
// na het opsplitsen niet meer bestaat.
import { chromium } from "playwright";
import http from "http";
import fs from "fs";
import path from "path";

const ROOT = new URL("../docs/", import.meta.url).pathname;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".bin": "application/octet-stream", ".css": "text/css", ".png": "image/png", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json" };

const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end("nee"); }
  res.writeHead(200, { "content-type": TYPES[path.extname(p)] || "application/octet-stream" });
  fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, r));
const base = "http://127.0.0.1:" + server.address().port;

// De vooraf geïnstalleerde Chromium van deze omgeving; valt terug op wat Playwright zelf vindt.
const VOORAF = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch(fs.existsSync(VOORAF) ? { executablePath: VOORAF } : {});
const page = await browser.newPage();
const fouten = [];
page.on("pageerror", e => fouten.push("pageerror: " + e.message));
// ERR_CERT/ERR_NAME zijn de CDN's (transformers, het embeddingmodel) die in een afgesloten
// testomgeving niet bereikbaar zijn; dat zegt niets over de pagina zelf.
const NEGEER = /favicon|coi-serviceworker|ERR_CERT|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|jsdelivr/i;
page.on("console", m => { if (m.type() === "error" && !NEGEER.test(m.text())) fouten.push("console: " + m.text()); });

await page.goto(base + "/index.html", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.CORPUS && window.CORPUS.length > 0 || (typeof CORPUS !== "undefined" && CORPUS.length > 0), null, { timeout: 120000 });
await page.waitForFunction(() => typeof PTOKENS !== "undefined" && PTOKENS.length > 0, null, { timeout: 120000 });

const VRAGEN = ["waar blijft mijn paspoort", "paspoort kwijt in spanje", "wat is een apostille", "rijbewijs verlopen buitenland", "hoe word ik nederlander"];
const inBrowser = await page.evaluate(async qs => {
  const uit = [];
  for (const q of qs) uit.push((await rankFor(q)).map(i => CORPUS[i].url));
  return uit;
}, VRAGEN);

const corpusLen = await page.evaluate(() => CORPUS.length);
const welkom = await page.textContent("#loadmsg").catch(() => "");

// Echt een vraag stellen, zoals een voorlichter dat doet. Zonder AI-sleutel valt de app terug
// op de demoweg: kandidaten zoeken en de bronnen tonen. Dat is precies de weg die het harnas
// meet, en hier zie je of hij ook daadwerkelijk iets op het scherm zet.
await page.fill("#input", "wat kost een paspoort vanuit het buitenland");
await page.click("#send");
await page.waitForSelector(".turn .src-title, .turn .error", { timeout: 60000 });
const bronnen = await page.$$eval(".turn .src-title", els => els.map(e => e.textContent.trim()));
const fout = await page.textContent(".turn .error").catch(() => "");
await browser.close();
server.close();

// Dezelfde vragen in Node.
const { loadCore, loadCorpus, retrieve } = await import("./corelib.mjs");
const core = loadCore();
loadCorpus(core);
const inNode = [];
for (const q of VRAGEN) inNode.push((await retrieve(core, q, 6)).map(i => core.CORPUS[i].url));

let verschil = 0;
VRAGEN.forEach((q, i) => {
  const a = inBrowser[i].join("|"), b = inNode[i].join("|");
  if (a !== b) { verschil++; console.error(`VERSCHIL bij "${q}"\n  browser: ${inBrowser[i].slice(0, 3)}\n  node:    ${inNode[i].slice(0, 3)}`); }
});

console.log(`pagina geladen: ${corpusLen} pagina's, welkomtekst ${welkom.includes("Leo") ? "ok" : "ONTBREEKT"}`);
console.log(`zoekresultaten browser == node: ${VRAGEN.length - verschil}/${VRAGEN.length}`);
console.log(`echte vraag gesteld: ${bronnen.length} bronnen getoond${fout ? " — FOUTMELDING: " + fout.slice(0, 120) : ""}`);
if (bronnen.length) console.log("  eerste bron: " + bronnen[0]);
if (fouten.length) { console.error("JS-fouten:\n" + fouten.map(f => " - " + f).join("\n")); }
if (verschil || fouten.length || !welkom.includes("Leo") || !bronnen.length) process.exit(1);
console.log("rookproef OK");
