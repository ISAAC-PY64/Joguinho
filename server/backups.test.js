import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createBackupStore } from "./backups.js";

test("profile backups keep the latest save, daily recovery points, and reject other sessions", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "monster-haven-backups-test-"));
  const deviceId = "device-123";
  const playerId = "profile-123";
  const sessionToken = "session-token-with-enough-entropy";
  let now = Date.parse("2026-01-01T10:00:00.000Z");
  const store = createBackupStore(directory, () => now);
  const game = (gold) => ({
    profile: { id: playerId, name: "Guardião" },
    gold,
    creatures: [],
    eggs: []
  });

  try {
    await assert.rejects(store.save(), { statusCode: 400 });
    await store.save({ deviceId, playerId, sessionToken, game: game(10) });
    now += 30_000;
    await store.save({ deviceId, playerId, sessionToken, game: game(20) });
    const sameDayBackups = await store.list({ deviceId, playerId, sessionToken });
    assert.equal(sameDayBackups.length, 1);

    now = Date.parse("2026-01-02T00:00:00.000Z");
    await store.save({ deviceId, playerId, sessionToken, game: game(30) });
    const backups = await store.list({ deviceId, playerId, sessionToken });
    assert.equal(backups.length, 2);
    assert.equal(backups[0].kind, "latest");
    assert.equal(backups[1].kind, "daily");
    const restored = await store.restore({ deviceId, playerId, sessionToken, backupId: backups[1].id });
    assert.equal(restored.game.gold, 20);
    await assert.rejects(
      store.list({ deviceId, playerId, sessionToken: "another-session-token-value" }),
      { statusCode: 403 }
    );
    await assert.rejects(
      store.save({ deviceId, playerId: "../other", sessionToken, game: game(40) }),
      { statusCode: 400 }
    );
    await assert.rejects(
      store.list({ deviceId: "another-device", playerId, sessionToken }),
      { statusCode: 404 }
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("profile backup history is capped at 30 daily recovery points", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "monster-haven-backups-retention-test-"));
  const deviceId = "device-retention";
  const playerId = "profile-retention";
  const sessionToken = "session-token-with-enough-entropy";
  let now = Date.parse("2026-01-01T00:00:00.000Z");
  const store = createBackupStore(directory, () => now);
  const save = () => store.save({
    deviceId,
    playerId,
    sessionToken,
    game: { profile: { id: playerId }, gold: 0, creatures: [], eggs: [] }
  });

  try {
    for (let day = 0; day < 35; day++) {
      now = Date.parse("2026-01-01T00:00:00.000Z") + day * 24 * 60 * 60 * 1000;
      await save();
    }
    const backups = await store.list({ deviceId, playerId, sessionToken });
    assert.equal(backups.length, 31);
    assert.equal(backups.filter((backup) => backup.kind === "daily").length, 30);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the same profile gets isolated backups on separate devices", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "monster-haven-device-isolation-test-"));
  const playerId = "shared-profile-id";
  const deviceOne = "device-one";
  const deviceTwo = "device-two";
  const tokenOne = "device-one-session-token-long";
  const tokenTwo = "device-two-session-token-long";
  const store = createBackupStore(directory);
  const game = (gold) => ({ profile: { id: playerId }, gold, creatures: [], eggs: [] });

  try {
    await store.save({ deviceId: deviceOne, playerId, sessionToken: tokenOne, game: game(100) });
    await store.save({ deviceId: deviceTwo, playerId, sessionToken: tokenTwo, game: game(200) });
    const backupsOne = await store.list({ deviceId: deviceOne, playerId, sessionToken: tokenOne });
    const backupsTwo = await store.list({ deviceId: deviceTwo, playerId, sessionToken: tokenTwo });
    const restoredOne = await store.restore({
      deviceId: deviceOne, playerId, sessionToken: tokenOne, backupId: backupsOne[0].id
    });
    const restoredTwo = await store.restore({
      deviceId: deviceTwo, playerId, sessionToken: tokenTwo, backupId: backupsTwo[0].id
    });
    assert.equal(restoredOne.game.gold, 100);
    assert.equal(restoredTwo.game.gold, 200);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("legacy profile backups migrate to the device-specific file without losing the old snapshot", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "monster-haven-backups-migration-test-"));
  const deviceId = "device-migration";
  const secondDeviceId = "device-migration-second";
  const playerId = "profile-migration";
  const sessionToken = "migration-session-token-123456";
  const secondSessionToken = "other-device-session-token-123456";
  const legacyFile = path.join(directory, `${playerId}.json`);
  const oldGame = { profile: { id: playerId }, gold: 77, creatures: [], eggs: [] };
  const oldCreatedAt = Date.parse("2026-01-01T10:00:00.000Z");
  mkdirSync(directory, { recursive: true });
  writeFileSync(legacyFile, JSON.stringify({
    profileId: playerId,
    tokenHash: createHash("sha256").update(sessionToken).digest("hex"),
    latest: { id: "legacy-backup", createdAt: oldCreatedAt, day: "2026-01-01", game: oldGame },
    history: []
  }));
  const store = createBackupStore(directory, () => oldCreatedAt + 30_000);

  try {
    await store.save({
      deviceId: secondDeviceId,
      playerId,
      sessionToken: secondSessionToken,
      game: { profile: { id: playerId }, gold: 88, creatures: [], eggs: [] }
    });
    const secondDeviceBackups = await store.list({
      deviceId: secondDeviceId, playerId, sessionToken: secondSessionToken
    });
    assert.equal((await store.restore({
      deviceId: secondDeviceId,
      playerId,
      sessionToken: secondSessionToken,
      backupId: secondDeviceBackups[0].id
    })).game.gold, 88);
    assert.equal(existsSync(legacyFile), true);

    const backups = await store.list({ deviceId, playerId, sessionToken });
    assert.equal(backups[0].id, "legacy-backup");
    await store.save({
      deviceId,
      playerId,
      sessionToken,
      game: { profile: { id: playerId }, gold: 99, creatures: [], eggs: [] }
    });
    const migrated = await store.list({ deviceId, playerId, sessionToken });
    assert.equal(migrated.length, 2);
    assert.equal((await store.restore({ deviceId, playerId, sessionToken, backupId: migrated[1].id })).game.gold, 77);
    assert.equal(existsSync(legacyFile), false);
    assert.equal(existsSync(path.join(directory, `${deviceId}--${playerId}.json`)), true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
