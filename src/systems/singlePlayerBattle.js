import { createBattle, submitBattleChoice } from "../../server/battle.js";
import { creatures } from "../data/creatures.js";
import { makeCreature } from "./game.js";

const PLAYER_ID = "player";
const MACHINE_ID = "machine";

function prepareCreature(creature) {
  return {
    ...creature,
    hp: creature.stats.hp,
    maxHp: creature.stats.hp,
    effects: { shield: false, poisonTurns: 0, speedBoost: false, evasion: false, rebirthUsed: false }
  };
}

export function createSinglePlayerBattle(owned) {
  const playerTeam = owned.map(prepareCreature);
  const uncommon = creatures.filter((species) => species.rarity === "uncommon");
  const candidates = uncommon.length >= 3 ? uncommon : creatures;
  const shuffled = [...candidates];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const other = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[other]] = [shuffled[other], shuffled[index]];
  }
  const machineTeam = shuffled.slice(0, 3).map((species) => prepareCreature(makeCreature(species.id)));
  return createBattle([
    { playerId: PLAYER_ID, name: "Você", team: playerTeam },
    { playerId: MACHINE_ID, name: "Máquina", team: machineTeam }
  ]);
}

function chooseMachineAction(player) {
  const active = player.team[player.active];
  const switchTargets = player.team
    .map((creature, index) => ({ creature, index }))
    .filter(({ creature, index }) => index !== player.active && creature.hp > 0);

  if (active.ability === "healing" && active.hp <= active.maxHp * 0.55) {
    return { actionType: "ability" };
  }
  if (Math.random() < 0.22) return { actionType: "ability" };
  if (switchTargets.length > 0 && Math.random() < 0.1) {
    const target = switchTargets[Math.floor(Math.random() * switchTargets.length)];
    return { actionType: "switch", targetIndex: target.index };
  }
  return { actionType: "attack" };
}

function chooseMachineRound(player) {
  const action = chooseMachineAction(player);
  return {
    ...action,
    attackRegion: Math.random() < 0.5 ? "upper" : "lower",
    defendRegion: Math.random() < 0.5 ? "upper" : "lower"
  };
}

export function resolveSinglePlayerRound(battle, playerChoice) {
  const next = structuredClone(battle);
  submitBattleChoice(next, PLAYER_ID, playerChoice);
  const machine = next.players.find((player) => player.playerId === MACHINE_ID);
  submitBattleChoice(next, MACHINE_ID, chooseMachineRound(machine));
  return next;
}
