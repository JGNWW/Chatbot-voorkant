# Versienummer ophogen

`docs/index.html` toont een zichtbaar versielabel (`APP_VERSION`, regel ± 2281,
`id="buildstatus"` in de header). Een voorlichter of tester gebruikt dit label om te zien of
de browser de nieuwste versie heeft geladen — dat werkt alleen als het nummer ook echt
verandert.

**Regel: verhoog `APP_VERSION` met 1 in dezelfde commit als elke functionele wijziging aan de
app.** "Functioneel" is elke wijziging aan:
- `docs/index.html` (op comments, whitespace en het versielabel zelf na), of
- `docs/search-core.js` (de zoeklogica; die verandert het gedrag ook als `index.html` zelf
  niet wijzigt).

```js
const APP_VERSION="build 113";   // -> "build 114"
```

Sla dit niet over "omdat het maar een kleine wijziging is" — een tabel- of promptfix is voor
de voorlichter net zo goed een nieuwe versie als een grote herbouw. Eén ophoging per commit is
genoeg, ook als een commit meerdere bestanden raakt.

Vergeet je het toch, bump dan gewoon meteen naar het eerstvolgende nummer zodra het opvalt —
het gaat om een oplopend, geen exact tellend nummer.

# Branchnamen

Geef een branch een naam die zegt **welke functie** erin zit, niet de willekeurige naam die de
sessie meekrijgt (zoals `claude/beautiful-archimedes-cdocns`). Vorm:

```
claude/<functie-in-een-paar-woorden>
```

- kleine letters, woorden gescheiden door `-`, geen spaties of leestekens;
- kort (2–5 woorden) en in het Nederlands, zoals de rest van de repo;
- beschrijf de functie of fix, niet het bestand: `claude/keuzeknoppen-uit-kopjes`,
  `claude/typeahead-verwijderen`, `claude/zoekscore-bijstellen`.

Werkwijze aan het begin van een sessie met een nieuwe functie:

```sh
git checkout -b claude/<functie>        # vanaf een actuele main
# ... werk, commit ...
git push -u origin claude/<functie>
```

Gaat een sessie verder op een functie waar al een branch voor bestaat, werk dan op die branch
door in plaats van een nieuwe aan te maken. Weigert de sessieproxy de push naar de nieuwe naam,
push dan naar de toegewezen sessiebranch en noem de functie duidelijk in de PR-titel.

# Oude branches

Elke sessie maakt een eigen branch aan. Een branch die volledig in `main` zit (niets meer
bevat wat `main` niet heeft) wordt automatisch verwijderd door
`.github/workflows/branches-opruimen.yml`: na elke push naar `main` (dus na elke merge), elke
nacht, en handmatig via Actions → "Samengevoegde branches opruimen" → Run workflow. Branches
met een open PR of met nog niet samengevoegde commits blijven staan. Dit geldt voor elke
branchnaam, dus ook voor de functienamen hierboven.

Verwijder dus zelf geen branches en pas deze workflow niet aan om ook branches met
onsamengevoegd werk op te ruimen.
