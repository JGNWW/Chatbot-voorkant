// Stelt de drempel af voor "de keuzestap overslaan bij een duidelijke winnaar" (zie
// duidelijkeWinnaar() en WINNAAR_MARGE in docs/search-core.js, winnaarVoorKeuze() in docs/index.html).
//
// Per vraag: wat is de marge van de beste pagina, en is die pagina een treffer? Per drempel dan:
// hoeveel vragen komen in de "winnaarsgroep" (dekking) en hoe vaak is de winnaar daar goed
// (precisie). De app slaat de keuzestap alleen over bij een marge boven de drempel, en zet de
// winnaar dan vooraan in de zes pagina's voor het antwoordmodel. Dat is veilig zolang die
// winnaar ook echt een goede pagina is — vandaar precisie op plek 1, niet recall@6.
//
// WAT DIT NIET MEET: wat de keuzestap verder doet — de volgorde van plek 2 t/m 6 en de
// "past er niets bij"-controle. Daar is een sleutel voor nodig. Als benadering van dat laatste
// staan hieronder vragen die buiten het domein vallen: daar hoort de winnaarsregel NIET af te
// gaan, want dan zou een pagina doorgaan die de keuzestap had afgewezen.
//
// Gebruik: node scripts/winnaar_eval.mjs            (laadt het embeddingmodel, zoals de app)
//          node scripts/winnaar_eval.mjs --drempel=0.3
import fs from "fs";
import { loadCore, loadCorpus, loadSemantic } from "./corelib.mjs";

const core = loadCore();
loadCorpus(core);
await loadSemantic(core);
const url = i => core.CORPUS[i].url.replace("https://www.nederlandwereldwijd.nl", "");
// Zelfde treffertoets als eval.mjs: een landvariant telt alleen als de vraag dat land noemt.
const hit = (u, exp, vraag) => exp.some(e => {
  if (!u.includes(e)) return false;
  const staart = u.slice(e.replace(/\/+$/, "").length).replace(/^\//, "");
  if (!staart) return true;
  const landen = core.detectCountries(staart.replace(/-/g, " "));
  if (!landen.size) return true;
  const gevraagd = core.detectCountries(vraag);
  for (const l of landen) if (gevraagd.has(l)) return true;
  return false;
});
const lees = f => JSON.parse(fs.readFileSync(new URL("./" + f, import.meta.url), "utf-8"));
const SETS = {
  "handgemaakt (126)": lees("eval_set.json"),
  "gegenereerd (1000)": lees("eval_set_auto.json"),
  "vijandig dev": lees("eval_set_gauntlet_dev.json"),
  "vijandig blind": lees("eval_set_gauntlet_blind.json"),
  "standaardvragen": lees("standaardvragen.json").map(x => ({ q: x.q, expect: [x.pagina.replace("https://www.nederlandwereldwijd.nl", "")] })),
};
// Buiten het domein: hier mag geen "duidelijke winnaar" uitkomen.
const BUITEN = ["hoe maak ik pannenkoeken", "wie won het WK voetbal in 2022", "wat voor weer wordt het morgen in Utrecht",
  "hoe laat vertrekt de trein naar Groningen", "wat is de hoofdstad van Australië", "hoe reset ik mijn router",
  "wat is een goed recept voor erwtensoep", "hoeveel calorieën zitten er in een banaan", "wanneer is de volgende zonsverduistering",
  "hoe word ik lid van een voetbalclub", "wat kost een abonnement op Netflix", "hoe vervang ik de accu van mijn auto",
  "wie is de premier van Canada", "hoe leer ik gitaar spelen", "welke film draait er in de bioscoop",
  "hoe zet ik een tent op", "hoe lang moet een ei koken", "wat is de beste smartphone van dit jaar",
  "hoe schrijf ik een sollicitatiebrief", "waar kan ik goedkoop tanken in Utrecht"];

const DREMPELS = [0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5];
const gekozen = Number((process.argv.find(a => a.startsWith("--drempel=")) || "").slice(10)) || null;
const rijen = [];
for (const [naam, set] of Object.entries(SETS)) {
  const uit = [];
  for (const { q, expect } of set) {
    const w = await core.duidelijkeWinnaar(q);
    // Waar staat de eerste goede pagina in de brede lijst (25, zoals de keuzestap die krijgt)?
    const breed = core.hubCandidates(await core.rankFor(q, 25), q);
    const plek = breed.findIndex(i => hit(url(i), expect, q));
    uit.push({ q, marge: w.marge, idx: w.idx, goed: w.idx >= 0 && hit(url(w.idx), expect, q), plek });
  }
  rijen.push([naam, uit]);
}
const buiten = [];
for (const q of BUITEN) { const w = await core.duidelijkeWinnaar(q); buiten.push({ q, marge: w.marge, idx: w.idx }); }

console.log("marge ≥ drempel → keuzestap overgeslagen. Per set: dekking · precisie op plek 1 · VERLIES (goede pagina stond op plek 7-25:\n alleen de keuzestap had hem nog kunnen kiezen; bij overslaan valt hij weg)\n");
console.log("drempel  " + rijen.map(([n]) => n.padEnd(22)).join("") + "buiten domein");
for (const d of (gekozen ? [gekozen] : DREMPELS)) {
  let regel = d.toFixed(2).padEnd(9);
  for (const [, uit] of rijen) {
    const groep = uit.filter(x => x.idx >= 0 && x.marge >= d);
    const goed = groep.filter(x => x.goed).length;
    const verlies = groep.filter(x => x.plek >= 6).length;
    regel += `${(100 * groep.length / uit.length).toFixed(0).padStart(3)}% · ${groep.length ? (100 * goed / groep.length).toFixed(0) : "-"}% · ${verlies}`.padEnd(22);
  }
  regel += `${buiten.filter(x => x.idx >= 0 && x.marge >= d).length}/${buiten.length}`;
  console.log(regel);
}
if (gekozen) {
  console.log("\nFout gekozen winnaars bij drempel " + gekozen + ":");
  for (const [naam, uit] of rijen) for (const x of uit.filter(x => x.idx >= 0 && x.marge >= gekozen && !x.goed))
    console.log(`  [${naam}] ${x.q} -> ${url(x.idx)} (marge ${x.marge.toFixed(2)}${x.plek >= 6 ? ", VERLIES: goede pagina op plek " + (x.plek + 1) : x.plek < 0 ? ", goede pagina niet in de 25" : ""})`);
  for (const x of buiten.filter(x => x.idx >= 0 && x.marge >= gekozen)) console.log(`  [buiten domein] ${x.q} -> ${url(x.idx)} (marge ${x.marge.toFixed(2)})`);
}
