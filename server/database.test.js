import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

test("a room result is persisted only once", async () => {
  const tempDirectory = mkdtempSync(path.join(tmpdir(), "monster-haven-db-test-"));
  const originalDirectory = process.cwd();
  try {
    process.chdir(tempDirectory);
    const { default: database } = await import(new URL("./database.js", import.meta.url));
    const room = { code: "ABC123", status: "waiting", players: [], battle: null };
    await database.addRoom("ABC123", Date.now(), room);
    assert.equal(await database.recordResult("ABC123", "winner", "loser"), true);
    assert.equal(await database.recordResult("ABC123", "attacker", "winner"), false);
    const saved = JSON.parse(readFileSync(path.join(tempDirectory, "data", "server-database", "monster-haven.json"), "utf8"));
    assert.equal(saved.rooms[0].status, "finished");
    assert.equal(saved.rooms[0].result.winnerId, "winner");
    assert.equal(saved.rooms[0].result.loserId, "loser");
  } finally {
    process.chdir(originalDirectory);
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("active room snapshots can be restored with the saved battle state", async () => {
  const tempDirectory = mkdtempSync(path.join(tmpdir(), "monster-haven-room-recovery-test-"));
  const originalDirectory = process.cwd();
  try {
    process.chdir(tempDirectory);
    const { default: database } = await import(new URL(`./database.js?recovery=${Date.now()}`, import.meta.url));
    const room = {
      code: "REC123",
      status: "waiting",
      players: [{ playerId: "player", connected: true }],
      battle: null,
      reconnectTimer: null
    };
    await database.addRoom(room.code, Date.now(), room);
    room.status = "in_battle";
    room.battle = { turnNumber: 4, pendingChoices: { player: { actionType: "attack" } } };
    room.reconnectTimer = { runtimeOnly: true };
    await database.saveRoom(room);

    const [restored] = await database.loadActiveRooms();
    assert.equal(restored.status, "in_battle");
    assert.deepEqual(restored.battle, room.battle);
    assert.equal(restored.reconnectTimer, null);
  } finally {
    process.chdir(originalDirectory);
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});
