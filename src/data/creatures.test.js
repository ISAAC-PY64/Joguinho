import assert from "node:assert/strict";
import test from "node:test";
import { creatures, validateCreatureCatalog } from "./creatures.js";

test("the creature catalog is valid and every species has a unique ID", () => {
  assert.equal(validateCreatureCatalog(), true);
  assert.equal(new Set(creatures.map((creature) => creature.id)).size, creatures.length);
});

test("the creature catalog rejects duplicate IDs and unsupported abilities", () => {
  assert.throws(() => validateCreatureCatalog([...creatures, { ...creatures[0] }]), /ID repetido/);
  const invalid = creatures.map((creature) => ({ ...creature }));
  invalid[0] = { ...invalid[0], ability: "unknown_ability" };
  assert.throws(() => validateCreatureCatalog(invalid), /habilidade inválida/);
});
