// Proef voor de demomodus: klikt elke voorbeeldvraag aan, met en zonder "volledig generatief
// antwoord", en controleert dat er een opname speelt (geen AI-aanroep), dat het ~5 seconden duurt,
// dat er citaten staan en dat de vangrails geen enkele opgenomen alinea afkeuren. Keurt de
// vangrail iets af, dan klopt de opname niet meer met de site: pas DEMO_OPNAMES aan.
//   node scripts/demo_test.mjs [map-voor-screenshots]
import { chromium } from "playwright";
import http from "http";
import fs from "fs";
import path from "path";

const ROOT = new URL("../docs/", import.meta.url).pathname;
const SHOTS = process.argv[2];
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json" };
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

let fout = 0;
for (const gen of [false, true]) {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 1400 } });
  await ctx.addInitScript(g => { try { localStorage.setItem("vk_generatief", g ? "1" : "0"); localStorage.setItem("vk_stream", g ? "1" : "0"); localStorage.setItem("vk_demomodus", "1"); } catch (e) {} }, gen);
  const page = await ctx.newPage();
  const meldingen = [];
  page.on("pageerror", e => meldingen.push("pageerror: " + e.message));
  page.on("console", m => { if (/afgekeurd|valt af|getal dat niet/.test(m.text())) meldingen.push(m.text()); });
  await page.goto(base + "/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => typeof CORPUS !== "undefined" && CORPUS.length > 0 && typeof PTOKENS !== "undefined" && PTOKENS.length > 0 && corpusKlaar, null, { timeout: 120000 });
  const samples = await page.evaluate(() => SAMPLES);
  for (let n = 0; n < samples.length; n++) {
    const q = samples[n];
    meldingen.length = 0;
    const t0 = Date.now();
    await page.evaluate(q => askText(q), q);
    await page.waitForSelector(".turn:last-child .answer-actions .fb-up", { timeout: 20000 });
    const ms = Date.now() - t0;
    const r = await page.evaluate(() => {
      const t = document.querySelector(".turn:last-child");
      return { meting: (t.querySelector(".meting") || {}).textContent || "", bronnen: t.querySelectorAll(".src-card").length, genweg: !!t.querySelector(".genweg") };
    });
    const problemen = [];
    if (!/demomodus/.test(r.meting)) problemen.push("geen opname gespeeld");
    if (ms < 4500 || ms > 7500) problemen.push("duur " + ms + " ms");
    if (!r.bronnen) problemen.push("geen bronnen");
    if (r.genweg) problemen.push("generatief antwoord afgekeurd");
    problemen.push(...meldingen);
    console.log((problemen.length ? "FOUT " : "ok   ") + (gen ? "[generatief] " : "[letterlijk] ") + q + " — " + ms + " ms" + (problemen.length ? "\n     " + problemen.join("\n     ") : ""));
    fout += problemen.length ? 1 : 0;
    if (SHOTS) await page.locator(".turn:last-child").screenshot({ path: path.join(SHOTS, `${gen ? "gen" : "lit"}-${n}.png`) });
  }
  await ctx.close();
}
await browser.close();
server.close();
if (fout) { console.log(fout + " fout(en)"); process.exit(1); }
console.log("demomodus OK");
