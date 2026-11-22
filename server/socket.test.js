import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { io } from "socket.io-client";
import { creatureById } from "../shared/creatures.js";

test("private room syncs a match and restores state after a reconnect", { timeout: 10_000 }, async () => {
  const tempDirectory = mkdtempSync(path.join(tmpdir(), "monster-haven-socket-test-"));
  const originalDirectory = process.cwd();
  const clients = [];
  let server;
  let ioServer;

  const connect = (url) => new Promise((resolve, reject) => {
    const client = io(url, { reconnection: false, timeout: 3000 });
    clients.push(client);
    client.once("connect", () => resolve(client));
    client.once("connect_error", reject);
  });
  const emit = (client, event, payload) => new Promise((resolve) => client.emit(event, payload, resolve));
  const nextEvent = (client, event, predicate = () => true) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.off(event, onEvent);
      reject(new Error(`Timed out waiting for ${event}`));
    }, 3000);
    const onEvent = (value) => {
      if (!predicate(value)) return;
      clearTimeout(timer);
      client.off(event, onEvent);
      resolve(value);
    };
    client.on(event, onEvent);
  });

  try {
    process.chdir(tempDirectory);
    const { attachSocket } = await import(new URL("./socket.js", import.meta.url).href);
    server = createServer();
    ioServer = await attachSocket(server);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${server.address().port}`;
    const host = await connect(url);
    const guest = await connect(url);
    const third = await connect(url);
    const hostIdentity = { playerId: randomUUID(), sessionToken: randomUUID(), name: "Host" };
    const guestIdentity = { playerId: randomUUID(), sessionToken: randomUUID(), name: "Guest" };
    const created = await emit(host, "room:create", hostIdentity);
    assert.equal(created.room.players.length, 1);
    const joined = await emit(guest, "room:join", { ...guestIdentity, code: created.code });
    assert.equal(joined.room.players.length, 2);
    const rejected = await emit(third, "room:join", { playerId: randomUUID(), sessionToken: randomUUID(), code: created.code });
    assert.match(rejected.error, /cheia/);

    const teamFor = (prefix, species) => {
      const roster = species.map((speciesId, index) => ({
        id: `${prefix}-${index}`,
        speciesId,
        stage: "normal",
        stats: { ...creatureById(speciesId).baseStats }
      }));
      return { roster, selected: roster };
    };
    const hostTeam = teamFor("host", ["phoenix", "fox", "wolf"]);
    const guestTeam = teamFor("guest", ["chicken", "rat", "rabbit"]);
    const hostUpdate = nextEvent(host, "battle:update");
    const guestUpdate = nextEvent(guest, "battle:update");
    assert.equal((await emit(host, "team:submit", hostTeam)).started, false);
    assert.equal((await emit(guest, "team:submit", guestTeam)).started, true);
    let hostState = await hostUpdate;
    let guestState = await guestUpdate;
    const initialHp = hostState.players.map((player) => player.team[0].hp);
    assert.equal(hostState.turnNumber, 1);
    assert.equal(guestState.turnNumber, 1);
    assert.equal(hostState.players.length, 2);

    let updateCount = 0;
    host.on("battle:update", () => { updateCount++; });
    guest.on("battle:update", () => { updateCount++; });
    const accepted = await emit(host, "battle:choice", {
      choice: { actionType: "attack", attackRegion: "upper", defendRegion: "lower" }
    });
    assert.deepEqual(accepted, { ok: true, resolved: false });
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(updateCount, 0, "A pending choice or update leaked before both players submitted.");

    const disconnectNotice = nextEvent(guest, "battle:update", (state) => state.paused);
    host.disconnect();
    await disconnectNotice;
    const resumedSocket = await connect(url);
    const resumedNotice = nextEvent(guest, "battle:update", (state) => !state.paused && state.turnNumber === 1);
    const resumed = await emit(resumedSocket, "room:resume", { ...hostIdentity, code: created.code });
    assert.equal(resumed.battle.paused, false);
    assert.equal(resumed.submitted, true);
    assert.equal(resumed.battle.turnNumber, 1);
    assert.equal("pendingChoices" in resumed.battle, false);
    assert.deepEqual(resumed.battle.players, hostState.players);
    hostState = resumed.battle;
    guestState = await resumedNotice;
    assert.equal(guestState.turnNumber, hostState.turnNumber);
    const hostResolved = nextEvent(resumedSocket, "battle:update", (state) => state.turnNumber === 2);
    const guestResolved = nextEvent(guest, "battle:update", (state) => state.turnNumber === 2);
    const guestChoice = await emit(guest, "battle:choice", {
      choice: { actionType: "attack", attackRegion: "lower", defendRegion: "upper" }
    });
    assert.deepEqual(guestChoice, { ok: true, resolved: true });
    hostState = await hostResolved;
    guestState = await guestResolved;
    assert.equal(hostState.turnNumber, guestState.turnNumber);
    assert.deepEqual(hostState.players.map((player) => player.team[0].hp), guestState.players.map((player) => player.team[0].hp));
    assert.ok(hostState.players.some((player, index) => player.team[0].hp < initialHp[index]));
    assert.equal("pendingChoices" in hostState, false);
  } finally {
    for (const client of clients) client.disconnect();
    if (ioServer) await new Promise((resolve) => ioServer.close(resolve));
    process.chdir(originalDirectory);
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});
