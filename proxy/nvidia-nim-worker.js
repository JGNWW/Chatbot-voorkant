// Doorgeefluik voor NVIDIA NIM — een Cloudflare Worker (gratis: 100.000 aanroepen per dag).
//
// WAAROM: de app draait volledig in de browser, en NVIDIA staat aanroepen vanuit de browser alleen
// toe vanaf build.nvidia.com zelf. Vanaf GitHub Pages krijgt de CORS-preflight geen
// Access-Control-Allow-Origin terug, en dan blokkeert de browser het verzoek. Dit luik zet die
// kop er wél op en geeft het verzoek verder ongewijzigd door.
//
// Het bewaart niets en kent geen sleutel: de API-sleutel van de voorlichter reist per aanroep mee
// in de Authorization-kop, precies zoals bij de andere providers. Alleen /v1/models en
// /v1/chat/completions gaan door, en alleen voor de adressen in TOEGESTAAN.
//
// Installeren: zie proxy/README.md.

const DOEL = "https://integrate.api.nvidia.com";

// Vanaf welke pagina's de app het luik mag gebruiken. Voeg je eigen adres toe als je de app
// ergens anders host. (Een browser stuurt Origin altijd mee; dat is wat hier wordt gecontroleerd.)
const TOEGESTAAN = [
  "https://jgnww.github.io",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
];

const PADEN = /^\/v1\/(models|chat\/completions)$/;

export default {
  async fetch(req) {
    const origin = req.headers.get("Origin") || "";
    const cors = {
      "Access-Control-Allow-Origin": TOEGESTAAN.includes(origin) ? origin : TOEGESTAAN[0],
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin",
    };
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const pad = new URL(req.url).pathname.replace(/\/+$/, "");
    // Controle: open het adres van de worker in een tabblad (dan stuurt de browser geen Origin
    // mee, dus dit staat vóór de origin-controle). De app zoekt deze zin op om te zien of het
    // luik goed staat; vanaf een niet-toegestaan adres mag de app hem juist NIET kunnen lezen.
    if (pad === "" && req.method === "GET")
      return new Response("Doorgeefluik voor NVIDIA NIM werkt", { status: 200, headers: { ...cors, "content-type": "text/plain; charset=utf-8" } });
    if (!TOEGESTAAN.includes(origin))
      return new Response("Dit adres mag het doorgeefluik niet gebruiken: " + origin, { status: 403, headers: cors });

    if (!PADEN.test(pad)) return new Response("Onbekend pad", { status: 404, headers: cors });
    if (req.method !== (pad === "/v1/models" ? "GET" : "POST"))
      return new Response("Methode niet toegestaan", { status: 405, headers: cors });

    const kop = { "content-type": "application/json", accept: req.headers.get("accept") || "application/json" };
    const sleutel = req.headers.get("authorization");
    if (sleutel) kop.authorization = sleutel;

    // De vraag eerst helemaal inlezen (± 30 kB): een doorgestroomd verzoeklijf werkt niet in
    // elke omgeving hetzelfde, een ingelezen lijf wel.
    const lijf = req.method === "POST" ? await req.arrayBuffer() : undefined;
    let antw;
    try {
      antw = await fetch(DOEL + pad, { method: req.method, headers: kop, body: lijf });
    } catch (e) {
      // Zonder deze vangst geeft Cloudflare een eigen foutpagina ZONDER CORS-koppen, en dan ziet
      // de app alleen een nietszeggende "NetworkError" in plaats van wat er misging.
      return new Response(JSON.stringify({ error: { message: "Doorgeefluik kon NVIDIA niet bereiken: " + (e && e.message || e) } }),
        { status: 502, headers: { ...cors, "content-type": "application/json" } });
    }
    // Het lijf gaat als stroom door, dus een gestreamd antwoord blijft gestreamd.
    const uit = new Headers(antw.headers);
    for (const [k, v] of Object.entries(cors)) uit.set(k, v);
    return new Response(antw.body, { status: antw.status, headers: uit });
  },
};
