import { Server } from "socket.io";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import db from "./database.js";
import { createBattle, normalizeTeam, submitBattleChoice } from "./battle.js";

const activeRooms = new Map();
const RECONNECT_GRACE_MS = 60_000;
const roomAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const makeCode = () => Array.from(randomBytes(6), (byte) => roomAlphabet[byte & 31]).join("");
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "http://localhost:5173,http://127.0.0.1:5173")
  .split(",").map((origin) => origin.trim()).filter(Boolean);
const cleanName = (value, fallback) => String(value || fallback).trim().slice(0, 24) || fallback;
const validIdentity = (value) => typeof value === "string" && value.length >= 8 && value.length <= 80;
const validToken = (value) => typeof value === "string" && value.length >= 24 && value.length <= 128;
const tokenDigest = (value) => createHash("sha256").update(value).digest("hex");
const sameToken = (a, b) => {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};
const matchesSessionToken = (player, token) => {
  const savedDigest = player.sessionTokenHash || (player.sessionToken ? tokenDigest(player.sessionToken) : "");
  return sameToken(savedDigest, tokenDigest(token));
};
const callbackFor = (callback) => typeof callback === "function" ? callback : () => {};

function publicRoom(room) {
  return {
    code: room.code,
    status: room.status,
    players: room.players.map(({ playerId, name, connected, team, ready }) => ({
      playerId, name, connected, teamSize: team?.length || 0, ready
    }))
  };
}

function broadcastRoom(io, room) {
  io.to(room.code).emit("room:update", publicRoom(room));
}

function publicBattle(battle, room) {
  return {
    phase: battle.phase,
    turnNumber: battle.turnNumber,
    players: battle.players.map((player) => ({
      playerId: player.playerId,
      name: player.name,
      team: player.team,
      active: player.active,
      defending: player.defending
    })),
    log: battle.log.slice(-40),
    finished: battle.finished,
    winnerId: battle.winnerId,
    paused: room.players.some((player) => !player.connected)
  };
}

function broadcastBattle(io, room) {
  if (room.battle) io.to(room.code).emit("battle:update", publicBattle(room.battle, room));
}

function findPlayer(room, socket) {
  return room.players.find((player) => player.playerId === socket.data.playerId && player.socketId === socket.id);
}

function emitError(socket, callback, message) {
  const response = { error: message };
  callback(response);
  socket.emit("room:error", response);
}

async function recordResult(room) {
  if (!room.battle?.finished || room.resultRecorded) return;
  if (room.battle.draw) {
    await db.recordResult(room.code, null, null);
  } else {
    const loser = room.players.find((player) => player.playerId !== room.battle.winnerId);
    if (loser) await db.recordResult(room.code, room.battle.winnerId, loser.playerId);
  }
  room.status = "finished";
  room.resultRecorded = true;
}

function scheduleForfeit(io, room, disconnectedPlayer) {
  clearTimeout(room.reconnectTimer);
  room.reconnectTimer = setTimeout(async () => {
    const player = room.players.find((candidate) => candidate.playerId === disconnectedPlayer.playerId);
    if (!player || player.connected) return;
    if (room.battle && !room.battle.finished) {
      room.battle.finished = true;
      room.battle.winnerId = room.players.find((candidate) => candidate.playerId !== player.playerId).playerId;
      room.battle.log.push(`${player.name} não retornou em 60 segundos. Vitória por desistência.`);
      try {
        await recordResult(room);
      } catch (error) {
        console.error(`Não foi possível salvar o resultado da sala ${room.code}:`, error);
      }
      broadcastBattle(io, room);
    } else {
      room.status = "closed";
      try {
        await db.closeRoom(room.code);
      } catch (error) {
        console.error(`Não foi possível encerrar a sala ${room.code}:`, error);
      }
    }
    try {
      await db.saveRoom(room);
    } catch (error) {
      console.error(`Não foi possível salvar a sala ${room.code}:`, error);
    }
    broadcastRoom(io, room);
  }, RECONNECT_GRACE_MS);
  room.reconnectTimer.unref?.();
}

export async function attachSocket(server) {
  await db.init();
  const io = new Server(server, {
    cors: {
      origin: (origin, callback) => callback(null, !origin || allowedOrigins.includes(origin)),
      methods: ["GET", "POST"],
      credentials: false
    },
    allowRequest: (request, callback) => {
      const origin = request.headers.origin;
      callback(null, !origin || allowedOrigins.includes(origin));
    }
  });
  const restoredRooms = await db.loadActiveRooms();
  for (const room of restoredRooms) {
    if (!room || typeof room.code !== "string" || !Array.isArray(room.players) || room.players.length > 2) continue;
    room.players.forEach((player) => {
      player.connected = false;
      player.socketId = null;
    });
    room.reconnectTimer = null;
    room.resultRecorded = false;
    activeRooms.set(room.code, room);
  }

  io.on("connection", (socket) => {
    socket.on("room:create", async (payload = {}, callback = () => {}) => {
      callback = callbackFor(callback);
      if (!validIdentity(payload.playerId) || !validToken(payload.sessionToken)) {
        return emitError(socket, callback, "Não foi possível identificar seu perfil. Recarregue o jogo e tente novamente.");
      }
      if (socket.data.roomCode) return emitError(socket, callback, "Você já está em uma sala.");
      let roomCode;
      try {
        do {
          roomCode = makeCode();
        } while (activeRooms.has(roomCode) || await db.hasRoom(roomCode));
      } catch (error) {
        console.error("Não foi possível reservar um código de sala:", error);
        return emitError(socket, callback, "Não foi possível criar uma sala agora. Tente novamente.");
      }
      const room = {
        code: roomCode,
        status: "waiting",
        createdAt: Date.now(),
        players: [{
          playerId: payload.playerId,
          sessionTokenHash: tokenDigest(payload.sessionToken),
          socketId: socket.id,
          name: cleanName(payload.name, "Guardião"),
          connected: true,
          team: null,
          ready: false
        }],
        battle: null,
        resultRecorded: false,
        reconnectTimer: null
      };
      activeRooms.set(roomCode, room);
      socket.data.roomCode = roomCode;
      socket.data.playerId = payload.playerId;
      socket.join(roomCode);
      try {
        await db.addRoom(roomCode, room.createdAt, room);
      } catch (error) {
        console.error(`Não foi possível persistir a sala ${roomCode}:`, error);
        activeRooms.delete(roomCode);
        socket.leave(roomCode);
        delete socket.data.roomCode;
        delete socket.data.playerId;
        return emitError(socket, callback, "Não foi possível salvar a sala. Tente novamente.");
      }
      callback({ room: publicRoom(room), code: roomCode });
      broadcastRoom(io, room);
    });

    socket.on("room:join", async (payload = {}, callback = () => {}) => {
      callback = callbackFor(callback);
      const code = String(payload.code || "").trim().toUpperCase();
      const room = activeRooms.get(code);
      if (!room || room.status !== "waiting") return emitError(socket, callback, "Sala não encontrada ou partida já iniciada.");
      if (!validIdentity(payload.playerId) || !validToken(payload.sessionToken)) {
        return emitError(socket, callback, "Não foi possível identificar seu perfil. Recarregue o jogo e tente novamente.");
      }
      if (socket.data.roomCode) return emitError(socket, callback, "Você já está em uma sala.");
      if (room.players.some((player) => player.playerId === payload.playerId)) {
        return emitError(socket, callback, "Este perfil já está usando a vaga de outro jogador.");
      }
      if (room.players.length >= 2) return emitError(socket, callback, "Esta sala já está cheia (máximo de 2 jogadores).");
      const player = {
        playerId: payload.playerId,
        sessionTokenHash: tokenDigest(payload.sessionToken),
        socketId: socket.id,
        name: cleanName(payload.name, "Visitante"),
        connected: true,
        team: null,
        ready: false
      };
      room.players.push(player);
      socket.data.roomCode = room.code;
      socket.data.playerId = player.playerId;
      socket.join(room.code);
      try {
        await db.saveRoom(room);
      } catch (error) {
        room.players.pop();
        socket.leave(room.code);
        delete socket.data.roomCode;
        delete socket.data.playerId;
        return emitError(socket, callback, "Não foi possível salvar a entrada na sala. Tente novamente.");
      }
      callback({ room: publicRoom(room) });
      broadcastRoom(io, room);
    });

    socket.on("room:resume", async (payload = {}, callback = () => {}) => {
      callback = callbackFor(callback);
      const code = String(payload.code || "").trim().toUpperCase();
      const room = activeRooms.get(code);
      const player = room?.players.find((candidate) => candidate.playerId === payload.playerId);
      if (!room || !player || !validToken(payload.sessionToken) || !matchesSessionToken(player, payload.sessionToken)) {
        return emitError(socket, callback, "Não foi possível restaurar esta sala. Ela pode ter expirado.");
      }
      if (player.connected && player.socketId !== socket.id) {
        return emitError(socket, callback, "Este perfil já está conectado em outra sessão.");
      }
      clearTimeout(room.reconnectTimer);
      player.connected = true;
      player.socketId = socket.id;
      player.sessionTokenHash = tokenDigest(payload.sessionToken);
      delete player.sessionToken;
      socket.data.roomCode = room.code;
      socket.data.playerId = player.playerId;
      socket.join(room.code);
      try {
        await db.saveRoom(room);
      } catch (error) {
        player.connected = false;
        player.socketId = null;
        socket.leave(room.code);
        delete socket.data.roomCode;
        delete socket.data.playerId;
        return emitError(socket, callback, "Não foi possível restaurar a partida salva. Tente novamente.");
      }
      callback({
        room: publicRoom(room),
        battle: room.battle ? publicBattle(room.battle, room) : null,
        submitted: Boolean(room.battle?.pendingChoices[player.playerId])
      });
      broadcastRoom(io, room);
      broadcastBattle(io, room);
    });

    socket.on("team:submit", async (payload = {}, callback = () => {}) => {
      callback = callbackFor(callback);
      const room = activeRooms.get(socket.data.roomCode);
      const player = room && findPlayer(room, socket);
      if (!room || !player || !player.connected) return emitError(socket, callback, "Você não está conectado a uma sala.");
      if (room.status !== "waiting" || room.players.length !== 2 || room.players.some((member) => !member.connected)) {
        return emitError(socket, callback, "Aguarde os dois jogadores conectarem antes de escolher a equipe.");
      }
      const previousState = { status: room.status, battle: room.battle, team: player.team, ready: player.ready };
      try {
        player.team = normalizeTeam(payload.selected, payload.roster);
        player.ready = true;
      } catch (error) {
        return emitError(socket, callback, error.message);
      }
      if (room.players.every((member) => member.ready && member.team?.length === 3)) {
        room.status = "in_battle";
        room.battle = createBattle(room.players);
      }
      try {
        await db.saveRoom(room);
      } catch (error) {
        room.status = previousState.status;
        room.battle = previousState.battle;
        player.team = previousState.team;
        player.ready = previousState.ready;
        return emitError(socket, callback, "Não foi possível salvar a equipe. Tente confirmar novamente.");
      }
      callback({ room: publicRoom(room), started: Boolean(room.battle) });
      broadcastRoom(io, room);
      broadcastBattle(io, room);
    });

    socket.on("battle:choice", async (payload = {}, callback = () => {}) => {
      callback = callbackFor(callback);
      const room = activeRooms.get(socket.data.roomCode);
      const player = room && findPlayer(room, socket);
      if (!room?.battle || !player || !player.connected) return emitError(socket, callback, "Você não está em uma batalha ativa.");
      if (room.players.some((member) => !member.connected)) return emitError(socket, callback, "A partida está pausada aguardando reconexão.");
      const previousBattle = structuredClone(room.battle);
      let result;
      try {
        result = submitBattleChoice(room.battle, player.playerId, payload.choice);
      } catch (error) {
        return emitError(socket, callback, error.message);
      }
      try {
        if (result.resolved && room.battle.finished) await recordResult(room);
        else await db.saveRoom(room);
      } catch (error) {
        room.battle = previousBattle;
        console.error(`Não foi possível persistir a partida ${room.code}:`, error);
        return emitError(socket, callback, "Não foi possível salvar a rodada. Tente novamente.");
      }
      callback({ ok: true, resolved: result.resolved });
      if (!result.resolved) return;
      broadcastBattle(io, room);
      if (room.battle.finished) broadcastRoom(io, room);
    });

    socket.on("room:leave", async (callback = () => {}) => {
      callback = callbackFor(callback);
      const room = activeRooms.get(socket.data.roomCode);
      const player = room && findPlayer(room, socket);
      if (!room || !player) return callback({ error: "Você não está em uma sala." });
      if (room.battle && !room.battle.finished) return callback({ error: "A batalha ainda está em andamento." });
      const previousStatus = room.status;
      player.connected = false;
      if (!room.battle) room.status = "closed";
      try {
        if (!room.battle) await db.closeRoom(room.code);
        else await db.saveRoom(room);
      } catch (error) {
        console.error(`Não foi possível salvar a saída da sala ${room.code}:`, error);
        room.status = previousStatus;
        player.connected = true;
        return emitError(socket, callback, "Não foi possível sair da sala. Tente novamente.");
      }
      socket.leave(room.code);
      delete socket.data.roomCode;
      delete socket.data.playerId;
      callback({ ok: true });
      broadcastRoom(io, room);
    });

    socket.on("disconnect", () => {
      const room = activeRooms.get(socket.data.roomCode);
      const player = room && findPlayer(room, socket);
      if (!player) return;
      player.connected = false;
      if (room.status !== "finished" && room.status !== "closed") scheduleForfeit(io, room, player);
      void db.saveRoom(room).catch((error) => console.error(`Não foi possível salvar a desconexão da sala ${room.code}:`, error));
      broadcastRoom(io, room);
      broadcastBattle(io, room);
    });
  });

  for (const room of restoredRooms) {
    const disconnectedPlayer = room.players.find((player) => !player.connected);
    if (disconnectedPlayer) scheduleForfeit(io, room, disconnectedPlayer);
  }
  return io;
}
