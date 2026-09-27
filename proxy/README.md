# Doorgeefluik voor NVIDIA NIM

NVIDIA ([build.nvidia.com](https://build.nvidia.com)) biedt gratis toegang tot tientallen open
modellen via een OpenAI-compatibele API. Vanuit de browser rechtstreeks bellen lukt alleen niet:
NVIDIA staat dat alleen toe vanaf `build.nvidia.com` zelf (CORS). Deze app draait volledig in de
browser, dus er moet een klein doorgeefluik tussen. `nvidia-nim-worker.js` is dat luik.

Het luik **bewaart niets** en kent **geen sleutel**: de sleutel die je in de app invult, gaat per
aanroep mee, net als bij de andere providers. Het geeft alleen `/v1/models` en
`/v1/chat/completions` door, en alleen voor de adressen in `TOEGESTAAN` bovenin het bestand.

## Eenmalig installeren (± 5 minuten, gratis)

1. Maak een gratis account op [dash.cloudflare.com](https://dash.cloudflare.com).
2. Ga naar **Workers & Pages → Create → Create Worker**, geef hem een naam (bv. `nim`) en klik
   **Deploy**.
3. Klik **Edit code**, vervang alles door de inhoud van `nvidia-nim-worker.js` en klik **Deploy**.
4. Kopieer het adres van de worker, bijvoorbeeld `https://nim.jouwnaam.workers.dev`.

Host je de app op een ander adres dan `https://jgnww.github.io`? Zet dat adres dan in
`TOEGESTAAN` voordat je op Deploy klikt.

## In de app

1. Haal een gratis sleutel (`nvapi-…`) op via
   [build.nvidia.com → API keys](https://build.nvidia.com/settings/api-keys).
2. Open **Instellingen**, kies **NVIDIA NIM (gratis, via doorgeefluik)**.
3. Plak de sleutel, en in het veld ernaast het adres van de worker.
4. De modellenlijst wordt dan bij NVIDIA opgehaald; de modellen die het best bij deze app passen
   staan bovenaan.

## Welke modellen?

Bovenaan staan modellen die sterk zijn in het Nederlands, betrouwbaar JSON teruggeven en **niet
eerst uitgebreid nadenken**. Dat laatste telt: een vraag kost drie aanroepen, en een denkmodel
zet bij elke aanroep eerst honderden redeneer-tokens neer.

| Model | Waarom |
|---|---|
| `google/gemma-4-31b-it` | Sterk meertalig, snel, denkt standaard niet — goede standaardkeuze |
| `mistralai/mistral-large-2-instruct` | Europees model, heel goed Nederlands, betrouwbare JSON |
| `deepseek-ai/deepseek-v4.1-flash` | Sterk en snel |
| `z-ai/glm-5.3-flash` | Snel, goed meertalig |
| `moonshotai/kimi-k2.6` | Sterk, wel groter en dus trager |
| `nvidia/nemotron-3-super-120b-a12b` | NVIDIA's eigen model, snel op hun hardware |
| `moonshotai/kimi-k3`, `z-ai/glm-5.3` | Zwaarder; beter, maar trager |
| `openai/gpt-oss-20b` | Denkmodel — werkt, maar trager per vraag |

Dit is een rangschikking op basis van wat de modellen zijn, **niet** op basis van een meting met
onze eigen vragen. Meten kan met een sleutel:

```sh
NVIDIA_KEY=nvapi-... node scripts/letterlijk_eval.mjs --provider=nvidia --model=google/gemma-4-31b-it
```

(De scripts draaien in Node en hebben het doorgeefluik niet nodig.)

Let op: de gratis laag van NVIDIA heeft een limiet op het aantal aanroepen per minuut en is
bedoeld om te proberen, niet voor productie.
