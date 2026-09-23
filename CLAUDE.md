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
