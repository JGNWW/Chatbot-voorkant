// Zoekkern van de voorlichter-chatbot: trefwoorden (BM25 + spelling), semantiek,
// fusie (RRF), zoekgebied (land/onderwerp) en productpagina's.
//
// Dit bestand is de ENIGE plek waar de zoeklogica staat. docs/index.html laadt het als gewoon
// script; scripts/eval.mjs en scripts/probe.mjs laden hetzelfde bestand in Node. Er is dus geen
// spiegel meer die uit de pas kan lopen met wat de gebruiker in de browser krijgt.

const STOP=new Set("de het een en van in op te voor met aan is ik je u hoe wat waar wanneer kan moet mijn uw ben wil naar om dat die er ook als of bij dan zijn heb heeft wordt worden the a to of".split(" "));

const TOPK=6; // aantal kandidaat-pagina's dat naar het AI-model gaat

// Fusie- en veldgewichten, afgesteld met scripts/tune_fusion.mjs op de vijandige vragenset,
// met als HARDE EIS dat de 126 handgemaakte en de 1000 gegenereerde vragen er niet op
// achteruit gaan — anders koop je winst op moeilijke vragen af met verlies op gewone.
//
// RRF_K bepaalt hoe vlak de fusiecurve is. Hij stond op 14: het verschil tussen plek 1 en
// plek 12 was dan nog geen factor 2, zodat een pagina die in BEIDE lijsten middelmatig scoort
// won van een pagina die in één lijst bovenaan stond. Juist bij vragen in eigen woorden is de
// semantische lijst de enige die het goed heeft, en die werd zo weggestemd. Met k=5 telt een
// eerste plek echt mee. Dieper kijken in beide lijsten (50 in plaats van 12) kost niets — beide
// lijsten zijn toch al helemaal doorgerekend — en vangt de gevallen waarin het goede antwoord
// net buiten de eerste twaalf viel.
const RRF_K=5, W_SEM=1.0, W_KW=1.0, FUSE_DEPTH=50;
const FW_TITLE=4, FW_DESC=1, FW_URL=3, FW_TEXT=1, FW_ANCHOR=1;
let CORPUS=[],PTOKENS=[],DF=null,NDOCS=0;

let TIDX=null;

// Lichte Nederlandse stemmer: haalt veelvoorkomende uitgangen weg zodat varianten
// op elkaar matchen ('verkracht'/'verkrachting', 'document'/'documenten').
function stem(w){
  if(w.length<5)return w;
  for(const suf of ["ingen","ing","heden","heid","en","s"]){
    if(w.length-suf.length>=4&&w.endsWith(suf))return w.slice(0,-suf.length);
  }
  return w;
}
function tokenize(t){return t.toLowerCase().split(/[^a-z0-9à-ÿ]+/).filter(w=>w.length>2&&!STOP.has(w)).map(stem);}
// ---- Ankertekst: de woorden waarmee de rest van de site naar een pagina verwijst ----
// De titel van /verklaring/in-leven-zijn zegt niets over "attestatie de vita", maar de links
// ernaartoe wel. Zo weet de site zelf al hoe burgers een pagina noemen; die kennis stond alleen
// nergens in de index. Alleen UNIEKE linkteksten per doelpagina tellen mee: staat een
// navigatieblok op 209 pagina's, dan telt die tekst één keer en niet 209 keer.
let ANCHOR=null;
function buildAnchors(){
  ANCHOR=CORPUS.map(()=>null);
  const m=urlIndex();
  for(const p of CORPUS){
    const zelf=(p.url||"").replace(/\/+$/,"");
    for(const l of p.links||[]){
      if(!Array.isArray(l))continue;
      const doel=String(l[1]||"").replace(/\/+$/,"");
      if(!doel||doel===zelf)continue;
      const i=m.get(doel);if(i===undefined)continue;
      const tekst=String(l[0]||"").trim();if(!tekst)continue;
      let s=ANCHOR[i];if(!s){s=new Set();ANCHOR[i]=s;}
      s.add(tekst);
    }
  }
}
// Trefwoord-index per pagina = term-frequenties over VOLLEDIGE tekst, met veldweging
// (titel telt zwaarder dan lopende tekst). Nodig voor BM25.
function tokensOf(p,i){
  if(!ANCHOR)buildAnchors();
  const m=new Map();
  const add=(text,w)=>{for(const t of tokenize(text||""))m.set(t,(m.get(t)||0)+w);};
  add(p.title,FW_TITLE);add(p.summary||p.desc,FW_DESC);add(p.url,FW_URL);add(p.text,FW_TEXT);
  const ank=ANCHOR[i];if(ank)for(const a of ank)add(a,FW_ANCHOR);
  return m;
}
// Document-frequenties + lengtes voor BM25.
let DLEN=[],AVGDL=1;
function buildDF(){
  DF=new Map();NDOCS=PTOKENS.length;DLEN=new Array(NDOCS);let tot=0;
  for(let i=0;i<NDOCS;i++){const m=PTOKENS[i];let len=0;for(const [t,c] of m){DF.set(t,(DF.get(t)||0)+1);len+=c;}DLEN[i]=len;tot+=len;}
  AVGDL=tot/Math.max(1,NDOCS);
}
function bm25idf(t){const df=(DF&&DF.get(t))||0;return df?Math.log(1+(NDOCS-df+0.5)/(df+0.5)):0;}
// Spellingscorrectie: corrigeer een query-woord dat NIET in het corpus voorkomt naar het
// dichtstbijzijnde corpus-woord (edit-afstand 1, of 2 bij langere woorden; hoogste df wint).
let VOCAB=null;
function buildVocab(){VOCAB=new Map();for(const [t,df] of DF){if(df<3||t.length<5)continue;const L=t.length;let a=VOCAB.get(L);if(!a){a=[];VOCAB.set(L,a);}a.push(t);}}
function editLE(a,b,max){ // Levenshtein-afstand <= max? (banded DP)
  const la=a.length,lb=b.length;if(Math.abs(la-lb)>max)return false;
  let prev=new Array(lb+1),cur=new Array(lb+1);
  for(let j=0;j<=lb;j++)prev[j]=j;
  for(let i=1;i<=la;i++){cur[0]=i;let rowMin=cur[0];
    for(let j=1;j<=lb;j++){cur[j]=Math.min(prev[j]+1,cur[j-1]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));if(cur[j]<rowMin)rowMin=cur[j];}
    if(rowMin>max)return false;[prev,cur]=[cur,prev];}
  return prev[lb]<=max;
}
function fuzzyFix(t){
  if(t.length<5||(DF.get(t)||0)>0)return t;
  if(!VOCAB)buildVocab();
  const max=t.length>=8?2:1;let best=null,bestDf=0;
  for(let L=t.length-max;L<=t.length+max;L++){
    const arr=VOCAB.get(L);if(!arr)continue;
    for(const c of arr){if(c[0]!==t[0]&&max<2)continue;if(editLE(t,c,max)){const df=DF.get(c);if(df>bestDf){best=c;bestDf=df;}}}
  }
  return best||t;
}
// ---- Titeldekking: hoeveel van de vraag staat er in de TITEL? ----
// BM25 weegt de titel zwaarder, maar telt frequenties; het telt niet hoeveel van de vraag een
// titel dekt. Daardoor won de algemene pagina van een rubriek het van de pagina die precies de
// gestelde deelvraag behandelt: "wat kost een nieuw paspoort" kwam uit bij de aanvraagpagina,
// terwijl /paspoort-id-kaart/kosten-buitenland gewoon bestaat. Een titel die de hele vraag dekt
// is bijna altijd de goede bladzijde.
let TITLETOK=null;
function buildTitleTokens(){TITLETOK=CORPUS.map(p=>new Set(tokenize((p.title||"").replace(/ \| NederlandWereldwijd$/,""))));}
const W_TITELDEKKING=2;
// Trefwoord-ranking met BM25 (term-frequentie + lengtenormalisatie + IDF), daarna een bonus
// naar rato van hoeveel vraagwoorden de titel dekt. Onbekende woorden worden eerst gecorrigeerd
// op spelling (fuzzyFix).
function rank(q,limit){
  if(!DF)buildDF();
  if(!TITLETOK)buildTitleTokens();
  const qt=[...new Set(tokenize(q).map(fuzzyFix))];if(!qt.length)return [];
  // k1 stond op 1,5. Lager laat herhaling van hetzelfde woord minder zwaar wegen, wat
  // langere pagina's minder bevoordeelt; gemeten over 1240 vragen gaf 1,2 op elke set een
  // beter resultaat.
  const k1=1.2,b=0.75,s=[];
  const dekking=i=>{let raak=0;const t=TITLETOK[i];for(const x of qt)if(t.has(x))raak++;return 1+W_TITELDEKKING*(raak/qt.length);};
  if(TIDX){
    // Zelfde formule, andere route: alleen de postings van de gevraagde termen doorlopen in
    // plaats van alle 4431 pagina's. scripts/index_test.mjs bewijst dat de uitkomst gelijk is.
    const sc=TIDX.score;sc.fill(0);
    for(const t of qt){
      const id=TIDX.id.get(t);if(id===undefined)continue;
      const w=bm25idf(t);
      for(let k=TIDX.ptr[id],e=TIDX.ptr[id+1];k<e;k++){
        const d=TIDX.postDoc[k],tf=TIDX.postTf[k];
        sc[d]+=w*(tf*(k1+1))/(tf+k1*(1-b+b*DLEN[d]/AVGDL));
      }
    }
    for(let i=0;i<NDOCS;i++)if(sc[i]>0)s.push([sc[i]*dekking(i),i]);
    s.sort((a,b)=>b[0]-a[0]);return s.slice(0,limit||TOPK).map(x=>x[1]);
  }
  for(let i=0;i<NDOCS;i++){
    const m=PTOKENS[i];let sc=0;
    for(const t of qt){const tf=m.get(t);if(!tf)continue;sc+=bm25idf(t)*(tf*(k1+1))/(tf+k1*(1-b+b*DLEN[i]/AVGDL));}
    if(sc>0)s.push([sc*dekking(i),i]);
  }
  s.sort((a,b)=>b[0]-a[0]);return s.slice(0,limit||TOPK).map(x=>x[1]);
}
function normalize(s){return s.replace(/\s+/g," ").trim().toLowerCase();}

// ---- Landherkenning (afgeleid uit de corpus-URL-structuur) ----
// Een laatste URL-segment dat onder >=7 verschillende rubrieken voorkomt is vrijwel zeker een land
// (bv. /trouwen/frankrijk, /verklaring/.../frankrijk, /paspoort-id-kaart/buitenland/...-frankrijk).
let COUNTRY=null,PCOUNTRY=null;
function fold(s){return (s||"").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"");}
function buildCountries(){
  const parents=new Map();
  for(const p of CORPUS){const parts=(p.url||"").replace(/\/+$/,"").split("/");if(parts.length<5)continue;const last=parts.pop();let s=parents.get(last);if(!s){s=new Set();parents.set(last,s);}s.add(parts.join("/"));}
  const BLOCK=new Set(["buitenland","aanvragen","algemeen","overzicht","contact"]);
  COUNTRY=new Set();for(const [seg,ps] of parents)if(ps.size>=7&&!BLOCK.has(seg))COUNTRY.add(seg);
  PCOUNTRY=new Array(CORPUS.length).fill(null);
  for(let i=0;i<CORPUS.length;i++){const last=(CORPUS[i].url||"").replace(/\/+$/,"").split("/").pop().toLowerCase();
    if(COUNTRY.has(last)){PCOUNTRY[i]=last;continue;}
    for(const c of COUNTRY)if(last.endsWith("-"+c)){PCOUNTRY[i]=c;break;}}
}
function detectCountries(text){if(!COUNTRY)buildCountries();const f=" "+fold(text).replace(/[^a-z0-9]+/g," ")+" ";const out=new Set();for(const c of COUNTRY)if(f.includes(" "+c.replace(/-/g," ")+" "))out.add(c);return out;}

// ---- Spreiding: niet vier keer dezelfde pagina in een ander land ----
// De site heeft van de meeste onderwerpen een versie per land, en die lijken zo op elkaar dat
// ze samen de hele top 6 kunnen vullen. Dan staat er zes keer "MVV aanvragen" — in België, in
// Tokelau, in Iran — en is er geen plek meer voor de pagina die de gestelde vraag beantwoordt.
// Van elke familie mogen er hoogstens twee mee naar voren; de rest schuift naar achteren, maar
// verdwijnt niet. Gemeten: +2,6 punten recall@6 op de vijandige vragen, +0,8 op de 126.
let FAMILY=null;
function buildFamilies(){
  if(!COUNTRY)buildCountries();
  FAMILY=CORPUS.map((p,i)=>{
    const pad=(p.url||"").replace(/^https?:\/\/[^/]+/,"").replace(/\/+$/,"");
    const c=PCOUNTRY[i];
    if(!c)return pad;
    const delen=pad.split("/"),last=(delen.pop()||"").toLowerCase();
    // /verklaring/in-leven-zijn/india -> /verklaring/in-leven-zijn
    // /visum-nederland/.../aanvragen-marokko -> /visum-nederland/.../aanvragen
    return last===c?delen.join("/"):delen.concat(last.slice(0,-(c.length+1))).join("/");
  });
}
const MAX_PER_FAMILIE=2;
function spread(order,limit){
  if(!FAMILY)buildFamilies();
  const n=limit||TOPK,tel=new Map(),voor=[],achter=[];
  for(const i of order){
    if(voor.length>=n)break;
    const f=FAMILY[i],k=tel.get(f)||0;
    if(k<MAX_PER_FAMILIE){tel.set(f,k+1);voor.push(i);}else achter.push(i);
  }
  return [...voor,...achter].slice(0,n);
}
// Actieve handmatige filters (zoekgebied): land en onderwerp (eerste URL-segment).
const FILTER={country:"",topic:""};
function firstSeg(idx){return (CORPUS[idx].url||"").replace(/^https?:\/\/[^/]+\//,"").split("/")[0]||"";}
// Beperk + herorden kandidaten op het zoekgebied dat de voorlichter zelf heeft INGESTELD:
// het onderwerp-filter (met terugval als het te streng is) en het land-filter. Gekozen land
// eerst, dan algemene pagina's, andere landen achteraan.
//
// Hier stond eerder ook een automatische variant: werd er een land in de vraag HERKEND, dan
// schoof elke pagina van dat land naar voren. Dat kostte meer dan het opleverde. De site heeft
// van bijna elk onderwerp een landversie, dus "ik ben beroofd in thailand" leverde zes
// Thailand-pagina's op over visum en trouwen, en de pagina over beroving stond er niet bij.
// Gemeten over 1126 vragen kostte die groepering 4 punten recall@6 en 7 punten op plek 1 —
// ook op de landvragen zelf, waarvoor hij bedoeld was. Het land staat al in de URL en de titel
// en telt daar mee in de score; dat is genoeg.
function applyScope(text,order){
  if(!PCOUNTRY)buildCountries();
  if(!FILTER.topic&&!FILTER.country)return order;
  let o=order;
  if(FILTER.topic){const m=o.filter(i=>firstSeg(i)===FILTER.topic);if(m.length>=2)o=m;}
  if(!FILTER.country)return o;
  const g1=[],g2=[],g3=[];
  for(const idx of o){const pc=PCOUNTRY[idx];if(pc===FILTER.country)g1.push(idx);else if(pc)g3.push(idx);else g2.push(idx);}
  return [...g1,...g2,...g3];
}
// Leesbare zoekwoorden van actieve filters (voor betere recall in de trefwoordzoeker).
function scopeTerms(){const t=[];if(FILTER.country)t.push(FILTER.country.replace(/-/g," "));if(FILTER.topic)t.push(FILTER.topic.replace(/-/g," "));return t;}
// Vul de land- en onderwerp-filters (afgeleid uit het corpus) en bedraad ze.

// ---- Semantisch zoeken (embeddings in de browser, zelfde model als de vooraf berekende vectoren) ----
const SEM={ready:false,meta:null,vecs:null,extractor:null,modelPromise:null,pct:0};

// Hoe lang een vraag hoogstens op dat model wacht. Stond er geen grens, dan hing de eerste vraag
// na het openen van de pagina net zo lang als de download duurt — op een trage lijn minuten,
// zonder dat je iets anders zag dan "Bezig met opzoeken…". Liever een antwoord dat alleen op
// trefwoorden is gevonden (91% recall in plaats van 95%) dan een scherm dat stilstaat.
const SEM_WACHT_MS=1500;

async function semanticRank(q,limit){
  if(!SEM.ready){
    // Wacht kort — is het model bijna binnen, dan is het die anderhalve seconde waard.
    // Anders val terug op trefwoorden; het model laadt op de achtergrond gewoon door.
    await Promise.race([SEM.modelPromise,new Promise(r=>setTimeout(r,SEM_WACHT_MS))]);
    if(!SEM.ready)return rank(q,limit);
  }
  const out=await SEM.extractor([SEM.meta.query_prefix+q],{pooling:"mean",normalize:true});
  const qv=out.data,dim=SEM.meta.dim,v=SEM.vecs,owner=SEM.owner;
  let scored;
  if(owner){
    // Meerdere chunks per pagina: bewaar de hoogste chunk-score per pagina.
    const best=new Map();
    for(let k=0,nv=owner.length;k<nv;k++){let dot=0;const off=k*dim;for(let d=0;d<dim;d++)dot+=qv[d]*v[off+d];const pg=owner[k],c=best.get(pg);if(c===undefined||dot>c)best.set(pg,dot);}
    scored=[...best.entries()].map(([pg,sc])=>[sc,pg]);
  }else{
    const n=SEM.meta.count;scored=new Array(n);
    for(let i=0;i<n;i++){let dot=0;const off=i*dim;for(let d=0;d<dim;d++)dot+=qv[d]*v[off+d];scored[i]=[dot,i];}
  }
  scored.sort((a,b)=>b[0]-a[0]);
  return scored.slice(0,limit||TOPK).map(x=>x[1]);
}
// URL -> index, voor het opzoeken van bovenliggende (algemenere) pagina's.
let URL2IDX=null;
function urlIndex(){if(!URL2IDX){URL2IDX=new Map();CORPUS.forEach((p,i)=>URL2IDX.set((p.url||"").replace(/\/+$/,""),i));}return URL2IDX;}
// Bovenliggende pagina's (hub/overzicht) van een URL die ook echt in het corpus staan — niet de domeinroot.
function ancestorsOf(url){
  const m=urlIndex(),out=[];let u=(url||"").replace(/\/+$/,"");
  const root=u.match(/^https?:\/\/[^/]+/);if(!root)return out;const base=root[0];
  while(u.length>base.length){const cut=u.lastIndexOf("/");if(cut<base.length)break;u=u.slice(0,cut);if(u.length>base.length&&m.has(u))out.push(m.get(u));}
  return out;
}
// ---- Productpagina's: harde regel voor genoemde vaktermen ----
// Uit de site-structuur afgeleid: een pagina die zelf subpagina's heeft én waarvan het
// URL-segment in de eigen titel voorkomt, is een PRODUCT (inreisvisum, nooddocument,
// schengenvisum, ...). Noemt de burger zo'n term letterlijk, dan hoort die pagina bovenaan —
// dat laten we niet aan het taalmodel over, want dat koos soms de algemene rubriekspagina.
let PRODUCT=null;
function buildProducts(){
  PRODUCT=new Map();
  const m=urlIndex(),kids=new Map();
  for(const p of CORPUS){const u=(p.url||"").replace(/\/+$/,""),par=u.slice(0,u.lastIndexOf("/"));if(m.has(par))kids.set(par,(kids.get(par)||0)+1);}
  const BLOCK=new Set(["buitenland","aanvragen","contact","thema","nederland","overzicht","landen"]);
  const cand=[];
  for(const [u,n] of kids){
    const seg=u.slice(u.lastIndexOf("/")+1).toLowerCase();
    // Alleen echte PRODUCTFAMILIES (veel subpagina's). Zonder deze drempel zouden gewone
    // woorden als "pensioen" of "crisis" onterecht een pagina forceren.
    if(n<50||BLOCK.has(seg)||seg.length<4||seg.includes("-"))continue;
    const i=m.get(u);if(i===undefined)continue;
    if(!(CORPUS[i].title||"").toLowerCase().replace(/-/g,"").includes(seg))continue;
    cand.push([u,seg,i]);
  }
  // Ouderpagina's van andere productpagina's overslaan (bv. /verklaring boven
  // /verklaring/woonplaats), anders verdringen ze hun eigen, specifiekere subpagina's.
  const urls=new Set(cand.map(c=>c[0]));
  for(const [u,seg,i] of cand){
    if([...urls].some(o=>o!==u&&o.startsWith(u+"/")))continue;
    PRODUCT.set(stem(seg),i);
  }
}
// Geeft de paginaindex van de meest SPECIFIEKE genoemde vakterm (langste match), of -1.
function productMatch(text){
  if(!PRODUCT)buildProducts();
  let best=-1,len=0;
  for(const t of new Set(tokenize(text||""))){const i=PRODUCT.get(t);if(i!==undefined&&t.length>len){best=i;len=t.length;}}
  return best;
}
// Zet de productpagina vooraan, maar alleen als de vakterm zo ongeveer de HELE vraag is
// ("nooddocument", "schengenvisum"). Dat was ook de bedoeling: een losse vakterm is een
// specifieke vraag, geen brede.
//
// Zonder die voorwaarde sloeg de regel te breed toe. Van de acht termen die hem laten vuren
// zijn "trouwen" en "woonplaats" gewone woorden, dus elke vraag waarin ze voorkwamen kreeg de
// algemene pagina opgedrongen: "trouwen in denemarken" gaf /trouwen in plaats van
// /trouwen/denemarken. Dat kostte 5 punten op plek 1 over 1000 vragen.
const PRODUCT_MAX_WOORDEN=2;
function forceProduct(text,list){
  if(tokenize(text||"").length>PRODUCT_MAX_WOORDEN)return list;
  const i=productMatch(text);
  if(i<0||!Array.isArray(list)||list[0]===i)return list;
  return [i,...list.filter(x=>x!==i)];
}
// Pagina die een specifieke situatie aanneemt (eerste aanvraag, kind, verlies/diefstal).
const SPECIFIC_RX=/voor het eerst|eerste keer|voor (mijn|uw|je|een) kind|verloren|gestolen|kwijt|vermist/i;
const isSpecificPage=idx=>SPECIFIC_RX.test(CORPUS[idx].title||"");
// Hybride kandidaten: Reciprocal Rank Fusion van semantisch (synoniemen/parafrase) en
// trefwoord (exacte/zeldzame termen + zoektermen). Geen hub-logica; geeft top `limit`.
async function hybrid(q,terms,limit){
  const K=Math.max(limit,FUSE_DEPTH);
  let sem=[];
  if(SEM.meta){try{sem=await semanticRank(q,K);}catch(e){/* val terug op trefwoord */}}
  const kw=rank([q,...(terms||[]),...scopeTerms()].join(" "),K);
  if(!sem.length&&!kw.length)return [];
  const score=new Map();
  const add=(list,w)=>list.forEach((idx,r)=>score.set(idx,(score.get(idx)||0)+w/(RRF_K+r)));
  add(sem,W_SEM);add(kw,W_KW);
  const fused=[...score.entries()].sort((a,b)=>b[1]-a[1]).map(e=>e[0]);
  // Zoekgebied (filters) + landherkenning toepassen.
  return spread(applyScope([q,...(terms||[])].join(" "),fused),limit);
}
// Voeg de algemene/hub-pagina van de beste treffer toe (en zet die vooraan als de beste
// treffer situatie-specifiek is), zodat een algemene vraag altijd een algemene passage heeft.
function withHub(cands){
  if(!cands.length)return cands;
  const top=cands[0],rest=cands.slice(1);
  const anc=ancestorsOf(CORPUS[top].url).filter(i=>!cands.includes(i)).slice(0,2);
  if(anc.length&&isSpecificPage(top))return [anc[0],top,...anc.slice(1),...rest];
  if(anc.length)return [top,...anc,...rest];
  return cands;
}
// Voeg bovenliggende hub-pagina's toe aan de kandidatenlijst (alleen voor recall, geen herordening),
// zodat de AI-herrangschikking ook een algemene pagina kan kiezen als dat past.
function hubCandidates(cands,text){
  const extra=[];
  for(const i of cands)for(const a of ancestorsOf(CORPUS[i].url))if(!cands.includes(a)&&!extra.includes(a))extra.push(a);
  if(!extra.length)return cands;
  // Zoekgebied opnieuw toepassen, zodat een toegevoegde ALGEMENE pagina (bv.
  // /visum-nederland/inreisvisum) boven de vele land-specifieke varianten uitkomt
  // wanneer er geen land genoemd is.
  return applyScope(text||"",[...cands,...extra]);
}
// Eenvoudige retrieval (gebruikt in demo/zonder-sleutel pad).
async function rankFor(q){return forceProduct(q,withHub(await hybrid(q,[],TOPK)));}

// ---- Corpus en semantiek van buitenaf vullen (browser doet dit via de globals) ----
function setCorpus(c){
  CORPUS=c;TIDX=null;TITLETOK=null;
  DF=null;VOCAB=null;COUNTRY=null;PCOUNTRY=null;URL2IDX=null;PRODUCT=null;ANCHOR=null;
  PTOKENS=CORPUS.map(tokensOf);
  buildDF();
}
function setSemantic(s){Object.assign(SEM,s);}
// Node (eval-harnas en probe). In de browser bestaat `module` niet en gebeurt hier niets.
if(typeof module!=="undefined"&&module.exports){
  module.exports={
    setCorpus,setSemantic,SEM,FILTER,
    stem,tokenize,tokensOf,rank,fuzzyFix,normalize,
    fold,detectCountries,applyScope,scopeTerms,
    urlIndex,ancestorsOf,productMatch,forceProduct,
    semanticRank,hybrid,withHub,hubCandidates,rankFor,spread,
    get CORPUS(){return CORPUS;},
    get PTOKENS(){return PTOKENS;},
    weights:{get TOPK(){return TOPK;},get RRF_K(){return RRF_K;},get W_SEM(){return W_SEM;},get W_KW(){return W_KW;},get FUSE_DEPTH(){return FUSE_DEPTH;},
             get FW_TITLE(){return FW_TITLE;},get FW_DESC(){return FW_DESC;},get FW_URL(){return FW_URL;},get FW_TEXT(){return FW_TEXT;},get FW_ANCHOR(){return FW_ANCHOR;}},
  };
}
