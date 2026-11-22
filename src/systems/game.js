import {creatures,rarityOdds,creatureById} from "../data/creatures.js";
import {GAME_CONFIG} from "../data/gameConfig.js";
import {elementMultiplier} from "../../shared/elements.js";
export {elementMultiplier} from "../../shared/elements.js";
export const uid = () => {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === "function") return cryptoApi.randomUUID();
  if (typeof cryptoApi?.getRandomValues === "function") {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};
export function makeCreature(speciesId,stage="normal",sources=[]) {
  const s=creatureById(speciesId); if(!s) throw new Error("Espécie inválida.");
  const mult=GAME_CONFIG.evolutionMultipliers[stage] || 1;
  const sourceAvg=(key)=>sources.length?sources.reduce((n,c)=>n+c.stats[key],0)/sources.length:s.baseStats[key];
  const sourceMultiplier=stage==="giga"?GAME_CONFIG.evolutionMultipliers.big:1;
  const stats={};
  for(const key of ["hp","attack","defense","speed"]) {
    const base=sources.length?sourceAvg(key)/sourceMultiplier:s.baseStats[key];
    const variation=sources.length?0:Math.round((Math.random()*2-1)*s.variation[key]);
    stats[key]=Math.max(1,Math.round((base+variation)*mult));
  }
  return {id:uid(),speciesId,stage,name:`${stage==="normal"?"":stage==="big"?"Big ":"Giga "}${s.name}`,rarity:s.rarity,element:s.element,ability:s.ability,stats,maxHp:stats.hp,createdAt:Date.now()};
}
export function migrateCreatureHealth(game) {
  if (!game) return game;
  const version = Number.isSafeInteger(game.creatureHealthVersion) ? game.creatureHealthVersion : 0;
  if (version >= 2) return game;
  for (const creature of game.creatures || []) {
    if (version < 1 && Number.isFinite(creature?.stats?.hp)) {
      creature.stats.hp = Math.max(1, Math.round(creature.stats.hp / 2));
      if (Number.isFinite(creature.maxHp)) creature.maxHp = Math.max(1, Math.round(creature.maxHp / 2));
      if (Number.isFinite(creature.hp)) creature.hp = Math.max(0, Math.round(creature.hp / 2));
    }
    if (version < 2 && creature?.stage === "giga" && creature.stats) {
      for (const key of ["hp", "attack", "defense", "speed"]) {
        if (Number.isFinite(creature.stats[key])) creature.stats[key] = Math.max(1, Math.round(creature.stats[key] * 0.8));
      }
      if (Number.isFinite(creature.maxHp)) creature.maxHp = Math.max(1, Math.round(creature.maxHp * 0.8));
      if (Number.isFinite(creature.hp)) creature.hp = Math.max(0, Math.round(creature.hp * 0.8));
    }
  }
  game.creatureHealthVersion = 2;
  return game;
}
export function rollRarity() {
  let r=Math.random()*100;
  for(const item of rarityOdds){r-=item.weight;if(r<0)return item.rarity;}
  return "common";
}
export function rollSpecies(rarity) {
  const pool=creatures.filter(c=>c.rarity===rarity);
  if (!pool.length) throw new Error(`Não há criaturas cadastradas para a raridade "${rarity}".`);
  return pool[Math.floor(Math.random()*pool.length)];
}
export function damage(attacker,defender,defending=false) {
  const crit=Math.random()<.08;
  const raw=attacker.stats.attack*(.85+Math.random()*.3);
  const reduction=defender.stats.defense/(defender.stats.defense+100);
  return Math.max(1,Math.round(raw*(1-reduction)*(defending?.55:1)*elementMultiplier(attacker.element,defender.element)*(crit?1.5:1)));
}