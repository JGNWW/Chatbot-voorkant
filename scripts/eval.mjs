// Evaluatie-harnas voor de zoeklaag (retrieval). Spiegelt de hybride zoeker uit docs/index.html
// (BM25 + semantisch + RRF + landherkenning) en meet recall@k en MRR op scripts/eval_set.json.
// Gebruik: node eval.mjs            (standaard model uit embeddings.json)
// Doel: objectief vergelijken bij wijzigingen (model, BM25, chunking, ...). Meet de RETRIEVAL,
// niet de AI-stappen (expansie/rerank) — die vergen een sleutel.
import { pipeline } from "@huggingface/transformers";
import fs from "fs";

const ROOT = "/home/user/Chatbot-voorkant/docs/data";
const EMB = process.argv[2] || ROOT;   // optioneel: map met alternatieve embeddings om te vergelijken
const corpus = JSON.parse(fs.readFileSync(ROOT + "/corpus.json", "utf-8"));
const meta = JSON.parse(fs.readFileSync(EMB + "/embeddings.json", "utf-8"));
const bin = new Int8Array(fs.readFileSync(EMB + "/embeddings.bin").buffer);
const evalSet = JSON.parse(fs.readFileSync(new URL("./eval_set.json", import.meta.url), "utf-8"));
const TOPK = 6;

// --- tekstverwerking (identiek aan index.html) ---
const STOP = new Set("de het een en van in op te voor met aan is ik je u hoe wat waar wanneer kan moet mijn uw ben wil naar om dat die er ook als of bij dan zijn heb heeft wordt worden the a to of".split(" "));
function stem(w){ if(w.length<5)return w; for(const s of ["ingen","ing","heden","heid","en","s"]) if(w.length-s.length>=4&&w.endsWith(s)) return w.slice(0,-s.length); return w; }
function tokenize(t){ return (t||"").toLowerCase().split(/[^a-z0-9à-ÿ]+/).filter(w=>w.length>2&&!STOP.has(w)).map(stem); }

// --- BM25 index ---
const PT = corpus.map(p=>{ const m=new Map(); const add=(t,w)=>{for(const x of tokenize(t||""))m.set(x,(m.get(x)||0)+w);}; add(p.title,3); add(p.summary||p.desc,2); add(p.url,2); add(p.text,1); return m; });
const N = PT.length; const DF=new Map(); const DLEN=new Array(N); let tot=0;
for(let i=0;i<N;i++){ let len=0; for(const [t,c] of PT[i]){ DF.set(t,(DF.get(t)||0)+1); len+=c; } DLEN[i]=len; tot+=len; }
const AVGDL=tot/N;
const bm25idf=t=>{ const df=DF.get(t)||0; return df?Math.log(1+(N-df+0.5)/(df+0.5)):0; };
function rank(q,limit){ const qt=[...new Set(tokenize(q))]; if(!qt.length)return []; const k1=1.5,b=0.75,s=[];
  for(let i=0;i<N;i++){ const m=PT[i]; let sc=0; for(const t of qt){ const tf=m.get(t); if(!tf)continue; sc+=bm25idf(t)*(tf*(k1+1))/(tf+k1*(1-b+b*DLEN[i]/AVGDL)); } if(sc>0)s.push([sc,i]); }
  s.sort((a,b)=>b[0]-a[0]); return s.slice(0,limit).map(x=>x[1]); }

// --- landherkenning (identiek) ---
const fold=s=>(s||"").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"");
const parents=new Map();
for(const p of corpus){ const parts=(p.url||"").replace(/\/+$/,"").split("/"); if(parts.length<5)continue; const last=parts.pop(); let s=parents.get(last); if(!s){s=new Set();parents.set(last,s);} s.add(parts.join("/")); }
const BLOCK=new Set(["buitenland","aanvragen","algemeen","overzicht","contact"]);
const COUNTRY=new Set(); for(const [seg,ps] of parents) if(ps.size>=7&&!BLOCK.has(seg)) COUNTRY.add(seg);
const PCOUNTRY=corpus.map(p=>{ const last=(p.url||"").replace(/\/+$/,"").split("/").pop().toLowerCase(); if(COUNTRY.has(last))return last; for(const c of COUNTRY) if(last.endsWith("-"+c))return c; return null; });
function detectCountries(text){ const f=" "+fold(text).replace(/[^a-z0-9]+/g," ")+" "; const out=new Set(); for(const c of COUNTRY) if(f.includes(" "+c.replace(/-/g," ")+" ")) out.add(c); return out; }
function applyCountry(text,order){ const det=detectCountries(text),g1=[],g2=[],g3=[]; for(const idx of order){ const pc=PCOUNTRY[idx]; if(pc&&det.has(pc))g1.push(idx); else if(pc)g3.push(idx); else g2.push(idx);} return [...g1,...g2,...g3]; }

// --- semantisch (chunked, max per pagina) ---
const dim=meta.dim, owner=meta.owner;
const extractor = await pipeline("feature-extraction", meta.model, { dtype: "q8" });
async function semanticRank(q,limit){ const out=await extractor(["query: "+q],{pooling:"mean",normalize:true}); const qv=out.data; const best=new Map();
  for(let k=0;k<owner.length;k++){ let dot=0; const off=k*dim; for(let d=0;d<dim;d++)dot+=qv[d]*(bin[off+d]/127); const pg=owner[k],c=best.get(pg); if(c===undefined||dot>c)best.set(pg,dot); }
  return [...best.entries()].map(([pg,sc])=>[sc,pg]).sort((a,b)=>b[0]-a[0]).slice(0,limit).map(x=>x[1]); }

// --- hybride (RRF) ---
async function hybrid(q,limit){ const K=Math.max(limit,12); const sem=await semanticRank(q,K); const kw=rank(q,K);
  const score=new Map(); const add=l=>l.forEach((idx,r)=>score.set(idx,(score.get(idx)||0)+1/(20+r))); add(sem);add(kw);
  const fused=[...score.entries()].sort((a,b)=>b[1]-a[1]).map(e=>e[0]); return applyCountry(q,fused).slice(0,limit); }

// --- meten ---
const url=i=>corpus[i].url.replace("https://www.nederlandwereldwijd.nl","");
const hit=(u,exp)=>exp.some(e=>u.includes(e));
let recall=0, mrrSum=0; const misses=[];
for(const {q,expect} of evalSet){
  const res=await hybrid(q,TOPK); const urls=res.map(url);
  const firstHit=urls.findIndex(u=>hit(u,expect));
  if(firstHit>=0){ recall++; mrrSum+=1/(firstHit+1); }
  else misses.push({q,expect,got:urls.slice(0,4)});
}
const n=evalSet.length;
console.log(`Model: ${meta.model} | dim ${dim} | vectors ${meta.vectors||meta.count}`);
console.log(`recall@${TOPK}: ${recall}/${n} = ${(recall/n*100).toFixed(0)}%`);
console.log(`MRR@${TOPK}: ${(mrrSum/n).toFixed(3)}`);
if(misses.length){ console.log(`\nMissers (${misses.length}):`); for(const m of misses){ console.log(` - "${m.q}" verwacht ${JSON.stringify(m.expect)}`); console.log(`     kreeg: ${m.got.join(", ")}`); } }
