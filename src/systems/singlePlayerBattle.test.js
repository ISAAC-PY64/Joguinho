import assert from "node:assert/strict";
import test from "node:test";
import { creatures } from "../data/creatures.js";
import { normalizeTeam } from "../../server/battle.js";
import { makeCreature, migrateCreatureHealth } from "./game.js";
import { createSinglePlayerBattle, resolveSinglePlayerRound } from "./singlePlayerBattle.js";

test("creature health models are halved and saved health migrates only once", () => {
  const originalRandom = Math.random;
  Math.random = () => 0.5;
  try {
    assert.equal(makeCreature("chicken").stats.hp, 50);
    assert.equal(makeCreature("chicken", "giga").stats.hp, 80);
  } finally {
    Math.random = originalRandom;
  }

  const save = {
    creatures: [{ stats: { hp: 101 }, maxHp: 101, hp: 23 }]
  };
  migrateCreatureHealth(save);
  assert.deepEqual(save.creatures[0], { stats: { hp: 51 }, maxHp: 51, hp: 12 });
  migrateCreatureHealth(save);
  assert.equal(save.creatures[0].stats.hp, 51);
});

test("Giga fusion uses the species multiplier and old Giga stats migrate once", () => {
  const originalRandom = Math.random;
  Math.random = () => 0.5;
  try {
    const owl = makeCreature("owl");
    const big = makeCreature("owl", "big", [owl, owl, owl]);
    const giga = makeCreature("owl", "giga", [big, big, big, big, big]);
    assert.equal(giga.stats.hp, 120);
    const team = [giga, makeCreature("chicken"), makeCreature("rat")];
    normalizeTeam(team, team);
  } finally {
    Math.random = originalRandom;
  }

  const oldSave = {
    creatureHealthVersion: 1,
    creatures: [{
      stage: "giga",
      stats: { hp: 150, attack: 94, defense: 58, speed: 76 },
      maxHp: 150,
      hp: 75
    }]
  };
  migrateCreatureHealth(oldSave);
  assert.deepEqual(oldSave.creatures[0], {
    stage: "giga",
    stats: { hp: 120, attack: 75, defense: 46, speed: 61 },
    maxHp: 120,
    hp: 60
  });
  migrateCreatureHealth(oldSave);
  assert.equal(oldSave.creatures[0].stats.hp, 120);
});

test("single-player battles use simultaneous choices and the shared round engine", () => {
  const team = ["chicken", "rat", "rabbit"].map((speciesId) => makeCreature(speciesId));
  const battle = createSinglePlayerBattle(team);
  const originalRandom = Math.random;
  Math.random = () => 0.9;
  try {
    const next = resolveSinglePlayerRound(battle, {
      actionType: "attack",
      attackRegion: "upper",
      defendRegion: "upper"
    });
    assert.equal(next.turnNumber, 2);
    assert.deepEqual(next.pendingChoices, {});
    assert.ok(next.players[0].team[0].hp < next.players[0].team[0].maxHp);
    assert.ok(next.players[1].team[0].hp < next.players[1].team[0].maxHp);
    assert.ok(next.log.some((entry) => entry.includes("parte superior")));
    assert.ok(next.log.some((entry) => entry.includes("parte inferior")));
  } finally {
    Math.random = originalRandom;
  }
});

test("single-player machine team uses three distinct species from the catalog", () => {
  const team = ["chicken", "rat", "rabbit"].map((speciesId) => makeCreature(speciesId));
  const battle = createSinglePlayerBattle(team);
  const machineSpecies = battle.players[1].team.map((creature) => creature.speciesId);

  assert.equal(machineSpecies.length, 3);
  assert.equal(new Set(machineSpecies).size, 3);
  assert.ok(machineSpecies.every((speciesId) => creatures.some((species) => species.id === speciesId)));
});
