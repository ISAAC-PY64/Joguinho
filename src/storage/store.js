import {makeCreature,migrateCreatureHealth,uid} from "../systems/game.js";
import {GAME_CONFIG} from "../data/gameConfig.js";
const DB="monster-haven-db", STORE="state", KEY="save";
const PROFILE_ID_KEY="monster-haven-profile-id";
function rememberProfile(state){
  if(!state?.profile)return state;
  const id=typeof state.profile.id==="string"&&state.profile.id
    ?state.profile.id
    :localStorage.getItem(PROFILE_ID_KEY)||uid();
  state.profile.id=id;
  localStorage.setItem(PROFILE_ID_KEY,id);
  return state;
}
function openDB(){return new Promise((resolve,reject)=>{
  if(!("indexedDB" in window)){resolve(null);return;}
  const req=indexedDB.open(DB,1);
  req.onupgradeneeded=()=>req.result.createObjectStore(STORE);
  req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
});}
const starter=()=>({
  profile:{id:localStorage.getItem(PROFILE_ID_KEY)||uid(),name:"Guardião",level:1,xp:0},
  gold:GAME_CONFIG.startingGold, gems:0,
  creatures:["chicken","rat","rabbit"].map(id=>makeCreature(id)),
  creatureHealthVersion:2,
  eggs:[],focus:null,missions:{focus:0,hatches:0,fusions:0,wins:0},
  stats:{wins:0,losses:0},createdAt:Date.now()
});
export async function loadGame(){
  try{const db=await openDB();if(db){const value=await new Promise((res,rej)=>{const r=db.transaction(STORE).objectStore(STORE).get(KEY);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});if(value)return rememberProfile(migrateCreatureHealth(value));const s=starter();await saveGame(s);return s;}}
  catch(e){console.warn("IndexedDB indisponível; usando armazenamento local.",e);}
  const raw=localStorage.getItem(KEY);if(raw)return rememberProfile(migrateCreatureHealth(JSON.parse(raw)));const s=starter();localStorage.setItem(KEY,JSON.stringify(s));rememberProfile(s);return s;
}
export async function saveGame(state){
  migrateCreatureHealth(state);
  rememberProfile(state);
  localStorage.setItem(KEY,JSON.stringify(state));
  try{const db=await openDB();if(db)await new Promise((res,rej)=>{const tx=db.transaction(STORE,"readwrite");tx.objectStore(STORE).put(state,KEY);tx.oncomplete=res;tx.onerror=()=>rej(tx.error)});}catch(e){console.warn(e);}
}
export function exportSave(state){const blob=new Blob([JSON.stringify(state,null,2)],{type:"application/json"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="monster-haven-backup.json";a.click();URL.revokeObjectURL(a.href);}
export async function importSave(file){const data=JSON.parse(await file.text());if(!data.profile||!Array.isArray(data.creatures))throw new Error("Arquivo de backup inválido.");return migrateCreatureHealth(data);}