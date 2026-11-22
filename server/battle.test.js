import test from "node:test";
import assert from "node:assert/strict";
import { createBattle, normalizeTeam, submitBattleChoice } from "./battle.js";
import { creatureById } from "../shared/creatures.js";

const stageMultipliers = { normal: 1, big: 1.25, giga: 1.6 };
const choice = (overrides = {}) => ({
  actionType: "attack",
  attackRegion: "upper",
  defendRegion: "upper",
  ...overrides
});

function rosterCreature(id, speciesId, stage = "normal", stats) {
  const species = creatureById(speciesId);
  return {
    id,
    speciesId,
    stage,
    stats: stats || Object.fromEntries(
      Object.entries(species.baseStats).map(([key, value]) => [key, Math.round(value * stageMultipliers[stage])])
    )
  };
}

function makeTeam(playerId, speciesIds) {
  const roster = speciesIds.map((speciesId, index) => rosterCreature(`${playerId}-creature-${index}`, speciesId));
  return normalizeTeam(roster, roster);
}

function makeBattle(playerOne = ["phoenix", "fox", "wolf"], playerTwo = ["chicken", "rat", "rabbit"]) {
  return createBattle([
    { playerId: "player-one", name: "Um", team: makeTeam("one", playerOne) },
    { playerId: "player-two", name: "Dois", team: makeTeam("two", playerTwo) }
  ]);
}

function resolveRound(battle, first = choice(), second = choice()) {
  const waiting = submitBattleChoice(battle, "player-one", first);
  assert.equal(waiting.resolved, false);
  return submitBattleChoice(battle, "player-two", second);
}

test("team selection requires three distinct creatures from the submitted roster", () => {
  const roster = [
    rosterCreature("owned-a", "chicken"),
    rosterCreature("owned-b", "rat"),
    rosterCreature("owned-c", "rabbit")
  ];
  assert.throws(() => normalizeTeam(roster.slice(0, 2), roster), /exatamente três/);
  assert.throws(() => normalizeTeam([roster[0], roster[0], roster[2]], roster), /repetidas/);
  assert.throws(() => normalizeTeam([{ ...roster[0], id: "not-owned" }, roster[1], roster[2]], roster), /não pertence/);
});

test("valid individual stats are preserved while manipulated stats are rejected", () => {
  const roster = [
    rosterCreature("a", "chicken", "normal", { hp: 52, attack: 23, defense: 12, speed: 20 }),
    rosterCreature("b", "rat", "big"),
    rosterCreature("c", "rabbit")
  ];
  const team = normalizeTeam(roster.map(({ id, speciesId, stage }) => ({ id, speciesId, stage })), roster);
  assert.equal(team[0].stats.hp, 52);
  assert.equal(team[0].stats.attack, 23);
  assert.equal(team[1].stats.hp, 56);
  assert.equal(team[1].stage, "big");
  assert.equal(team[0].rarity, "common");
  const tampered = [...roster];
  tampered[0] = { ...tampered[0], stats: { ...tampered[0].stats, attack: 999999 } };
  assert.throws(
    () => normalizeTeam(roster.map(({ id, speciesId, stage }) => ({ id, speciesId, stage })), tampered),
    /atributos.*inválidos/
  );
});

test("a submitted choice stays secret and does not resolve until both players submit", () => {
  const battle = makeBattle();
  const initialHp = battle.players.map((player) => player.team[0].hp);
  assert.deepEqual(submitBattleChoice(battle, "player-one", choice()), { resolved: false });
  assert.deepEqual(battle.players.map((player) => player.team[0].hp), initialHp);
  assert.deepEqual(battle.log, ["A batalha começou!"]);
  assert.equal(Object.keys(battle.pendingChoices).length, 1);
  assert.throws(() => submitBattleChoice(battle, "player-two", choice({ attackRegion: "head" })), /Escolha um golpe e uma defesa válidos/);
  assert.throws(() => submitBattleChoice(battle, "player-one", choice()), /já confirmou/);
  assert.deepEqual(submitBattleChoice(battle, "player-two", choice({ attackRegion: "lower" })), { resolved: true });
  assert.equal(battle.turnNumber, 2);
  assert.deepEqual(battle.pendingChoices, {});
  assert.ok(battle.players.some((player, index) => player.team[0].hp < initialHp[index]));
  assert.ok(battle.log.some((entry) => entry.includes("parte inferior")));
});

test("blocking the region that was attacked reduces damage by the defender's defense", () => {
  const matching = makeBattle(["phoenix", "fox", "wolf"], ["chicken", "rat", "rabbit"]);
  const mismatching = makeBattle(["phoenix", "fox", "wolf"], ["chicken", "rat", "rabbit"]);
  const originalRandom = Math.random;
  Math.random = () => 0.9;
  try {
    resolveRound(matching, choice({ defendRegion: "upper" }), choice({ attackRegion: "upper" }));
    resolveRound(mismatching, choice({ defendRegion: "lower" }), choice({ attackRegion: "upper" }));
  } finally {
    Math.random = originalRandom;
  }
  const matchingHp = matching.players[0].team[0].hp;
  const mismatchingHp = mismatching.players[0].team[0].hp;
  assert.ok(matchingHp > mismatchingHp);
  assert.ok(matching.log.some((entry) => entry.includes("defendeu a parte superior")));
  assert.ok(mismatching.log.every((entry) => !entry.startsWith("Um defendeu a parte superior")));
});

test("simultaneous switch is validated and the switching player gives up their attack", () => {
  const battle = makeBattle(["chicken", "rat", "rabbit"]);
  const enemyHp = battle.players[1].team[0].hp;
  assert.throws(
    () => submitBattleChoice(battle, "player-one", choice({ actionType: "switch", targetIndex: 0 })),
    /Não é possível trocar/
  );
  resolveRound(battle, choice({ actionType: "switch", targetIndex: 1 }), choice({ attackRegion: "lower" }));
  assert.equal(battle.players[0].active, 1);
  assert.equal(battle.players[1].team[0].hp, enemyHp);
  assert.ok(battle.players[0].team[1].hp < battle.players[0].team[1].maxHp);
});

test("simultaneous attacks still finish the match when the final opposing creature falls", () => {
  const battle = makeBattle();
  const rival = battle.players[1];
  rival.team.forEach((creature) => { creature.hp = 0; });
  rival.team[0].hp = 1;
  battle.players[0].team[0].stats.attack = 10000;
  const originalRandom = Math.random;
  Math.random = () => 0.9;
  try {
    resolveRound(battle);
  } finally {
    Math.random = originalRandom;
  }
  assert.equal(battle.finished, true);
  assert.equal(battle.winnerId, "player-one");
});

test("both submitted attacks land even if one creature is knocked out first", () => {
  const battle = makeBattle(["chicken", "rat", "rabbit"], ["chicken", "rat", "rabbit"]);
  for (const player of battle.players) {
    player.team.forEach((creature) => { creature.hp = 0; });
    player.team[0].hp = 1;
    player.team[0].stats.attack = 10000;
  }
  const originalRandom = Math.random;
  Math.random = () => 0.9;
  try {
    resolveRound(battle);
  } finally {
    Math.random = originalRandom;
  }
  assert.equal(battle.finished, true);
  assert.equal(battle.draw, true);
  assert.equal(battle.winnerId, null);
});

test("special abilities still work during simultaneous rounds", () => {
  const doubleAttack = makeBattle(["chicken", "fox", "wolf"]);
  const doubleTarget = doubleAttack.players[1].team[0];
  const doubleBefore = doubleTarget.hp;
  const originalRandom = Math.random;
  Math.random = () => 0.9;
  try {
    resolveRound(doubleAttack, choice({ actionType: "ability" }));
  } finally {
    Math.random = originalRandom;
  }
  assert.ok(doubleTarget.hp < doubleBefore);
  assert.equal(doubleAttack.log.filter((entry) => entry.includes("atingiu a parte")).length, 3);

  const healing = makeBattle(["dog", "fox", "wolf"]);
  const healer = healing.players[0].team[0];
  healer.hp = Math.floor(healer.maxHp / 2);
  resolveRound(healing, choice({ actionType: "ability" }));
  assert.ok(healer.hp > Math.floor(healer.maxHp / 2));

  const shielding = makeBattle(["turtle", "fox", "wolf"]);
  const protectedCreature = shielding.players[0].team[0];
  const before = protectedCreature.hp;
  resolveRound(shielding, choice({ actionType: "ability", defendRegion: "lower" }), choice({ attackRegion: "upper" }));
  assert.ok(protectedCreature.hp > 0 && protectedCreature.hp < before);
  assert.equal(protectedCreature.effects.shield, false);

  const poison = makeBattle(["snake", "fox", "wolf"]);
  const victim = poison.players[1].team[0];
  const victimBefore = victim.hp;
  resolveRound(poison, choice({ actionType: "ability" }));
  assert.equal(victim.effects.poisonTurns, 2);
  assert.ok(victim.hp < victimBefore);

  const speed = makeBattle(["rabbit", "fox", "wolf"]);
  const speedy = speed.players[0].team[0];
  const speedBefore = speedy.stats.speed;
  resolveRound(speed, choice({ actionType: "ability" }));
  assert.ok(speedy.stats.speed > speedBefore);
});

test("evasion blocks a hit and rebirth prevents a defeat once per battle", () => {
  const evasion = makeBattle(["owl", "fox", "wolf"]);
  const dodger = evasion.players[0].team[0];
  const before = dodger.hp;
  resolveRound(evasion, choice({ actionType: "ability", defendRegion: "lower" }), choice({ attackRegion: "upper" }));
  assert.equal(dodger.hp, before);
  assert.equal(dodger.effects.evasion, false);

  const rebirth = makeBattle(["phoenix", "fox", "wolf"]);
  const phoenix = rebirth.players[0].team[0];
  phoenix.hp = 1;
  rebirth.players[1].team[0].stats.attack = 10000;
  const originalRandom = Math.random;
  Math.random = () => 0.9;
  try {
    resolveRound(rebirth, choice(), choice());
  } finally {
    Math.random = originalRandom;
  }
  assert.ok(phoenix.hp > 0);
  assert.equal(phoenix.effects.rebirthUsed, true);
  assert.equal(rebirth.finished, false);
});
