import { creatureById } from "../shared/creatures.js";
import { elementMultiplier } from "../shared/elements.js";

const stages = new Set(["normal", "big", "giga"]);
const stageNames = { normal: "", big: "Big ", giga: "Giga " };
const stageBaseMultipliers = { normal: 1, big: 1.25, giga: 1.6 };
const stageStatScales = { normal: 1, big: 1.25, giga: 2 };
const statKeys = ["hp", "attack", "defense", "speed"];
const maxTeamSize = 3;

export function normalizeTeam(selected, roster) {
  if (!Array.isArray(selected) || selected.length !== maxTeamSize || !Array.isArray(roster)) {
    throw new Error("Escolha exatamente três criaturas da sua coleção.");
  }
  const owned = new Map();
  for (const creature of roster) {
    if (creature && typeof creature.id === "string" && typeof creature.speciesId === "string" && stages.has(creature.stage)) {
      owned.set(creature.id, creature);
    }
  }
  const ids = new Set();
  return selected.map((choice) => {
    if (!choice || typeof choice.id !== "string" || ids.has(choice.id)) {
      throw new Error("A equipe contém criaturas inválidas ou repetidas.");
    }
    ids.add(choice.id);
    const ownedCreature = owned.get(choice.id);
    if (!ownedCreature || ownedCreature.speciesId !== choice.speciesId || ownedCreature.stage !== choice.stage) {
      throw new Error("Uma das criaturas escolhidas não pertence à coleção enviada.");
    }
    const species = creatureById(ownedCreature.speciesId);
    if (!species) throw new Error("A equipe contém uma espécie inválida.");
    const invalidStat = statKeys.map((key) => {
      const value = ownedCreature.stats?.[key];
      const base = species.baseStats[key] * stageBaseMultipliers[ownedCreature.stage];
      const variation = species.variation[key] * stageStatScales[ownedCreature.stage];
      return {
        key,
        value,
        minimum: Math.max(1, Math.round(base - variation) - 1),
        maximum: Math.round(base + variation) + 1
      };
    }).find(({ key, value, minimum, maximum }) =>
      !Number.isSafeInteger(value) || value < minimum || value > maximum
    );
    if (invalidStat) {
      throw new Error(
        `Os atributos de ${ownedCreature.name || species.name} estão inválidos: ${invalidStat.key.toUpperCase()} ${invalidStat.value} (esperado ${invalidStat.minimum}-${invalidStat.maximum}).`
      );
    }
    const stats = Object.fromEntries(statKeys.map((key) => [key, ownedCreature.stats[key]]));
    return {
      id: ownedCreature.id,
      speciesId: species.id,
      stage: ownedCreature.stage,
      name: `${stageNames[ownedCreature.stage]}${species.name}`,
      rarity: species.rarity,
      element: species.element,
      ability: species.ability,
      stats: { hp: stats.hp, attack: stats.attack, defense: stats.defense, speed: stats.speed },
      maxHp: stats.hp,
      hp: stats.hp,
      effects: { shield: false, poisonTurns: 0, speedBoost: false, evasion: false, rebirthUsed: false }
    };
  });
}

function damage(attacker, defender, power = 1, criticalChance = 0.08) {
  const critical = Math.random() < criticalChance;
  const raw = attacker.stats.attack * (0.85 + Math.random() * 0.3) * power;
  const reduction = defender.stats.defense / (defender.stats.defense + 100);
  return Math.max(
    1,
    Math.round(raw * (1 - reduction) * elementMultiplier(attacker.element, defender.element) * (critical ? 1.5 : 1))
  );
}

function applyDamage(target, amount, log) {
  if (target.effects.evasion) {
    target.effects.evasion = false;
    log.push(`${target.name} esquivou o ataque!`);
    return false;
  }
  const reduction = target.effects.shield ? 0.5 : 1;
  target.effects.shield = false;
  const dealt = Math.max(1, Math.round(amount * reduction));
  target.hp = Math.max(0, target.hp - dealt);
  log.push(`${target.name} recebeu ${dealt} de dano.`);
  if (target.hp === 0 && target.ability === "rebirth" && !target.effects.rebirthUsed) {
    target.effects.rebirthUsed = true;
    target.hp = Math.max(1, Math.round(target.maxHp * 0.25));
    log.push(`${target.name} renasceu com ${target.hp} HP!`);
  }
  return true;
}

export function createBattle(players) {
  return {
    phase: "battle",
    turnNumber: 1,
    players: players.map((player) => ({ playerId: player.playerId, name: player.name, team: player.team, active: 0, defending: false })),
    log: ["A batalha começou!"],
    finished: false,
    winnerId: null,
    draw: false,
    pendingChoices: {}
  };
}

function prepareChoice(battle, player, choice) {
  const regions = new Set(["upper", "lower"]);
  const actions = new Set(["attack", "ability", "switch"]);
  if (!choice || !actions.has(choice.actionType) || !regions.has(choice.attackRegion) || !regions.has(choice.defendRegion)) {
    throw new Error("Escolha um golpe e uma defesa válidos.");
  }
  const active = player.team[player.active];
  if (!active || active.hp <= 0) throw new Error("Sua criatura ativa está derrotada.");
  if (choice.actionType === "switch") {
    if (!Number.isInteger(choice.targetIndex) || choice.targetIndex < 0 || choice.targetIndex >= player.team.length ||
      choice.targetIndex === player.active || player.team[choice.targetIndex].hp <= 0) {
      throw new Error("Não é possível trocar para essa criatura.");
    }
    return {
      actionType: choice.actionType,
      attackRegion: choice.attackRegion,
      defendRegion: choice.defendRegion,
      targetIndex: choice.targetIndex
    };
  }
  return {
    actionType: choice.actionType,
    attackRegion: choice.attackRegion,
    defendRegion: choice.defendRegion
  };
}

function isNonAttackingAbility(ability) {
  return ["healing", "shield", "speed_boost", "evasion"].includes(ability);
}

function activateAbility(player, log) {
  const active = player.team[player.active];
  switch (active.ability) {
    case "healing": {
      const restored = Math.min(active.maxHp - active.hp, Math.round(active.maxHp * 0.25));
      active.hp += restored;
      log.push(`${active.name} recuperou ${restored} HP.`);
      break;
    }
    case "shield":
      active.effects.shield = true;
      log.push(`${active.name} ergueu um escudo contra o próximo ataque.`);
      break;
    case "speed_boost":
      if (!active.effects.speedBoost) {
        active.stats.speed = Math.round(active.stats.speed * 1.2);
        active.effects.speedBoost = true;
      }
      log.push(`${active.name} aumentou sua velocidade!`);
      break;
    case "evasion":
      active.effects.evasion = true;
      log.push(`${active.name} preparou uma esquiva.`);
      break;
    default:
      return false;
  }
  return true;
}

function applyAttack(attackerPlayer, defenderPlayer, choice, log) {
  const attacker = attackerPlayer.team[attackerPlayer.active];
  const defender = defenderPlayer.team[defenderPlayer.active];
  if (!attacker || !defender || defender.hp <= 0) return;

  const powered = choice.actionType === "ability";
  const hits = powered && attacker.ability === "double_attack" ? 2 : 1;
  const power = powered && attacker.ability === "heavy_strike" ? 1.5
    : powered && attacker.ability === "critical_focus" ? 1.25 : 1;
  const criticalChance = powered && attacker.ability === "critical_focus" ? 0.35 : 0.08;
  let successfulHit = false;

  for (let hit = 0; hit < hits && defender.hp > 0; hit++) {
    const rawDamage = damage(attacker, defender, power, criticalChance);
    const blocked = choice.attackRegion === defenderPlayer.pendingDefendRegion;
    const defenseReduction = blocked ? Math.min(defender.stats.defense, rawDamage - 1) : 0;
    const reducedDamage = Math.max(1, rawDamage - defenseReduction);
    const before = defender.hp;
    const landed = applyDamage(defender, reducedDamage, log);
    if (landed) {
      successfulHit = true;
      const dealt = before - defender.hp;
      log.push(`${attacker.name} atingiu a parte ${choice.attackRegion === "upper" ? "superior" : "inferior"} de ${defender.name}: ${dealt} de dano.`);
      if (blocked) {
        log.push(`${defenderPlayer.name} defendeu a parte ${choice.attackRegion === "upper" ? "superior" : "inferior"} e reduziu ${defenseReduction} de dano.`);
      }
    } else {
      log.push(`${attacker.name} atacou a parte ${choice.attackRegion === "upper" ? "superior" : "inferior"}, mas ${defender.name} esquivou.`);
    }
    if (defender.hp === 0 && defender.ability === "rebirth" && defender.effects.rebirthUsed) break;
  }

  if (powered && attacker.ability === "poison" && successfulHit && defender.hp > 0) {
    defender.effects.poisonTurns = 3;
    log.push(`${defender.name} foi envenenado por três turnos.`);
  }
}

function tickPoison(player, log) {
  const active = player.team[player.active];
  if (!active || active.hp <= 0 || active.effects.poisonTurns <= 0) return;
  const amount = Math.max(1, Math.round(active.stats.hp * 0.06));
  active.hp = Math.max(0, active.hp - amount);
  active.effects.poisonTurns -= 1;
  log.push(`${active.name} sofreu ${amount} de dano por veneno.`);
  if (active.hp === 0 && active.ability === "rebirth" && !active.effects.rebirthUsed) {
    active.effects.rebirthUsed = true;
    active.hp = Math.max(1, Math.round(active.maxHp * 0.25));
    log.push(`${active.name} renasceu com ${active.hp} HP!`);
  }
}

function updateDefeatedCreatures(battle, log) {
  for (const player of battle.players) {
    if (player.team[player.active].hp > 0) continue;
    const previous = player.team[player.active];
    log.push(`${previous.name} foi derrotado!`);
    const next = player.team.findIndex((creature) => creature.hp > 0);
    if (next >= 0) {
      player.active = next;
      log.push(`${player.name} enviou ${player.team[next].name}.`);
    }
  }
  const defeated = battle.players.map((player) => player.team.every((creature) => creature.hp <= 0));
  if (defeated[0] && defeated[1]) {
    battle.finished = true;
    battle.draw = true;
    log.push("As duas equipes foram derrotadas. A partida terminou em empate.");
  } else if (defeated[0] || defeated[1]) {
    battle.finished = true;
    battle.winnerId = battle.players[defeated[0] ? 1 : 0].playerId;
    log.push(`${battle.players[defeated[0] ? 0 : 1].name} perdeu a batalha.`);
  }
}

function resolveRound(battle) {
  const log = [`Rodada ${battle.turnNumber}: as escolhas foram reveladas.`];
  const choices = battle.players.map((player) => battle.pendingChoices[player.playerId]);

  for (let index = 0; index < battle.players.length; index++) {
    const player = battle.players[index];
    const choice = choices[index];
    player.defending = choice.defendRegion;
    if (choice.actionType === "switch") {
      player.active = choice.targetIndex;
      log.push(`${player.name} trocou para ${player.team[player.active].name}.`);
    }
  }

  for (let index = 0; index < battle.players.length; index++) {
    const player = battle.players[index];
    const choice = choices[index];
    if (choice.actionType === "ability" && isNonAttackingAbility(player.team[player.active].ability)) {
      activateAbility(player, log);
    }
  }

  for (let index = 0; index < battle.players.length; index++) {
    const choice = choices[index];
    const attacker = battle.players[index];
    if (choice.actionType === "switch" ||
      (choice.actionType === "ability" && isNonAttackingAbility(attacker.team[attacker.active].ability))) continue;
    const defender = battle.players[1 - index];
    defender.pendingDefendRegion = choices[1 - index].defendRegion;
    applyAttack(attacker, defender, choice, log);
  }

  for (const player of battle.players) tickPoison(player, log);
  updateDefeatedCreatures(battle, log);
  battle.log.push(...log);
  battle.pendingChoices = {};
  if (!battle.finished) battle.turnNumber += 1;
  for (const player of battle.players) delete player.pendingDefendRegion;
}

export function submitBattleChoice(battle, playerId, choice) {
  if (!battle || battle.finished) throw new Error("A partida já terminou.");
  const player = battle.players.find((candidate) => candidate.playerId === playerId);
  if (!player) throw new Error("Jogador inválido.");
  if (battle.pendingChoices[playerId]) throw new Error("Você já confirmou suas escolhas nesta rodada.");
  battle.pendingChoices[playerId] = prepareChoice(battle, player, choice);
  const resolved = battle.players.every((member) => battle.pendingChoices[member.playerId]);
  if (resolved) resolveRound(battle);
  return { resolved };
}
