const rows = [
  ["chicken","Chicken","common","nature","🐔",50,20,15,18,"double_attack"],
  ["rat","Rat","common","earth","🐀",45,22,12,24,"evasion"],
  ["rabbit","Rabbit","common","nature","🐇",48,18,13,30,"speed_boost"],
  ["cat","Cat","common","dark","🐈",53,23,16,25,"critical_focus"],
  ["dog","Dog","common","light","🐕",58,21,19,20,"healing"],
  ["frog","Frog","common","water","🐸",50,19,17,22,"poison"],
  ["fox","Fox","uncommon","fire","🦊",60,30,19,31,"critical_focus"],
  ["turtle","Turtle","uncommon","water","🐢",78,19,34,10,"shield"],
  ["snake","Snake","uncommon","dark","🐍",55,32,16,29,"poison"],
  ["penguin","Penguin","uncommon","ice","🐧",65,27,25,18,"shield"],
  ["wolf","Wolf","rare","nature","🐺",73,39,25,32,"double_attack"],
  ["deer","Deer","rare","light","🦌",75,31,28,35,"healing"],
  ["eagle","Eagle","rare","air","🦅",63,42,20,40,"critical_focus"],
  ["bear","Bear","rare","earth","🐻",95,38,36,16,"heavy_strike"],
  ["owl","Owl","epic","air","🦉",75,47,29,38,"evasion"],
  ["lion","Lion","epic","fire","🦁",95,53,34,30,"heavy_strike"],
  ["crocodile","Crocodile","epic","water","🐊",105,46,43,15,"poison"],
  ["shark","Shark","legendary","water","🦈",110,62,39,35,"heavy_strike"],
  ["panda","Panda","legendary","nature","🐼",125,51,55,19,"healing"],
  ["phoenix","Phoenix","mythic","fire","🔥",123,72,42,48,"rebirth"]
];

export const creatures = rows.map(([id,name,rarity,element,emoji,hp,attack,defense,speed,ability]) => ({
  id,name,rarity,element,emoji,
  baseStats:{hp,attack,defense,speed},
  variation:{hp:2.5,attack:4,defense:4,speed:4},
  ability,
  description:`Uma criatura ${element} do Santuário.`
}));
export const creatureById = id => creatures.find(c => c.id === id);
export const rarityOrder = ["common","uncommon","rare","epic","legendary","mythic"];
export const rarityLabels = {common:"Common",uncommon:"Uncommon",rare:"Rare",epic:"Epic",legendary:"Legendary",mythic:"Mythic"};
export const rarityOdds = [
  {rarity:"common",weight:50},{rarity:"uncommon",weight:25},{rarity:"rare",weight:15},
  {rarity:"epic",weight:7},{rarity:"legendary",weight:2.5},{rarity:"mythic",weight:.5}
];
export const elements = ["nature","fire","water","earth","air","electric","ice","dark","light"];
export const elementLabels = {nature:"Nature",fire:"Fire",water:"Water",earth:"Earth",air:"Air",electric:"Electric",ice:"Ice",dark:"Dark",light:"Light"};
export const abilities = {
  double_attack:{name:"Double Attack",description:"Ataca duas vezes."},
  heavy_strike:{name:"Heavy Strike",description:"Golpe poderoso."},
  healing:{name:"Healing",description:"Recupera parte da própria vida."},
  shield:{name:"Shield",description:"Reduz o próximo dano recebido."},
  poison:{name:"Poison",description:"Envenena o adversário."},
  speed_boost:{name:"Speed Boost",description:"Aumenta a velocidade."},
  critical_focus:{name:"Critical Focus",description:"Aumenta a chance de crítico."},
  evasion:{name:"Evasion",description:"Aumenta a chance de esquiva."},
  rebirth:{name:"Rebirth",description:"Recupera vida uma vez por batalha."}
};

export function validateCreatureCatalog(catalog = creatures) {
  const errors = [];
  const ids = new Set();
  const statKeys = ["hp", "attack", "defense", "speed"];

  if (!Array.isArray(catalog) || catalog.length < 3) {
    throw new Error("O catálogo precisa conter pelo menos três criaturas.");
  }

  for (const creature of catalog) {
    if (!creature || typeof creature.id !== "string" || !creature.id.trim()) {
      errors.push("Toda criatura precisa de um ID.");
      continue;
    }
    if (ids.has(creature.id)) errors.push(`ID repetido: ${creature.id}.`);
    ids.add(creature.id);
    if (!creature.name || !creature.emoji) errors.push(`${creature.id}: informe nome e emoji.`);
    if (!rarityLabels[creature.rarity] || !rarityOdds.some((item) => item.rarity === creature.rarity)) {
      errors.push(`${creature.id}: raridade inválida (${creature.rarity}).`);
    }
    if (!elements.includes(creature.element) || !elementLabels[creature.element]) {
      errors.push(`${creature.id}: elemento inválido (${creature.element}).`);
    }
    if (!abilities[creature.ability]) errors.push(`${creature.id}: habilidade inválida (${creature.ability}).`);
    for (const key of statKeys) {
      if (!Number.isSafeInteger(creature.baseStats?.[key]) || creature.baseStats[key] < 1) {
        errors.push(`${creature.id}: atributo base ${key} inválido.`);
      }
      if (!Number.isFinite(creature.variation?.[key]) || creature.variation[key] < 0) {
        errors.push(`${creature.id}: variação de ${key} inválida.`);
      }
    }
  }

  const totalWeight = rarityOdds.reduce((total, item) => total + item.weight, 0);
  if (Math.abs(totalWeight - 100) > 1e-9) errors.push("Os pesos de raridade devem somar 100.");
  for (const item of rarityOdds) {
    if (item.weight <= 0 || !catalog.some((creature) => creature.rarity === item.rarity)) {
      errors.push(`A raridade ${item.rarity} precisa de peso positivo e ao menos uma criatura.`);
    }
  }

  if (errors.length) throw new Error(`Catálogo de criaturas inválido: ${errors.join(" ")}`);
  return true;
}

validateCreatureCatalog();
