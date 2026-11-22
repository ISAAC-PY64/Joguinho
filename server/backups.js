import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import db from "./database.js";

const serverDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultDirectory = path.resolve(serverDirectory, "..", "data", "player-backups");
const maxBackupBytes = 2 * 1024 * 1024;
const maxHistoryEntries = 30;
const historyAgeMs = 30 * 24 * 60 * 60 * 1000;

function backupError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function validateIdentity(deviceId, playerId, sessionToken) {
  if (typeof deviceId !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(deviceId)) {
    throw backupError("O identificador do dispositivo é inválido.", 400);
  }
  if (typeof playerId !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(playerId)) {
    throw backupError("O identificador do perfil é inválido.", 400);
  }
  if (typeof sessionToken !== "string" || sessionToken.length < 20 || sessionToken.length > 200) {
    throw backupError("O token da sessão é inválido.", 400);
  }
}

function validateGame(game, playerId) {
  if (!game || typeof game !== "object" || Array.isArray(game) ||
    !game.profile || game.profile.id !== playerId ||
    !Array.isArray(game.creatures) || !Array.isArray(game.eggs) ||
    !Number.isFinite(game.gold) || game.gold < 0) {
    throw backupError("Os dados do perfil estão incompletos ou inválidos.", 400);
  }
  const serialized = JSON.stringify(game);
  if (Buffer.byteLength(serialized, "utf8") > maxBackupBytes) {
    throw backupError("O backup excede o limite de tamanho permitido.", 413);
  }
  return JSON.parse(serialized);
}

function tokenDigest(token) {
  return createHash("sha256").update(token).digest();
}

function authorize(record, token) {
  const storedDigest = Buffer.from(record.tokenHash, "hex");
  const suppliedDigest = tokenDigest(token);
  if (storedDigest.length !== suppliedDigest.length || !timingSafeEqual(storedDigest, suppliedDigest)) {
    throw backupError("Este perfil já está vinculado a outra sessão.", 403);
  }
}

export function createBackupStore(directory = defaultDirectory, now = Date.now, persistentStore = null) {
  const writeQueues = new Map();

  function fileFor(deviceId, playerId) {
    return path.join(directory, `${deviceId}--${playerId}.json`);
  }

  function legacyFileFor(playerId) {
    return path.join(directory, `${playerId}.json`);
  }

  async function readRecord(deviceId, playerId, sessionToken) {
    if (persistentStore?.usesPersistentStorage) {
      return persistentStore.getBackupRecord(`${deviceId}--${playerId}`);
    }
    try {
      return JSON.parse(await fs.readFile(fileFor(deviceId, playerId), "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    try {
      const legacy = JSON.parse(await fs.readFile(legacyFileFor(playerId), "utf8"));
      if (legacy.profileId !== playerId || (legacy.deviceId && legacy.deviceId !== deviceId)) {
        throw backupError("O backup antigo não pertence a este dispositivo e perfil.", 403);
      }
      try {
        authorize(legacy, sessionToken);
      } catch (error) {
        if (error.statusCode === 403) return null;
        throw error;
      }
      return { ...legacy, deviceId, legacyFile: legacyFileFor(playerId) };
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }

  async function writeRecord(deviceId, playerId, record) {
    if (persistentStore?.usesPersistentStorage) {
      await persistentStore.putBackupRecord(`${deviceId}--${playerId}`, record);
      return;
    }
    await fs.mkdir(directory, { recursive: true });
    const file = fileFor(deviceId, playerId);
    const temporaryFile = `${file}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporaryFile, JSON.stringify(record), { flag: "wx" });
      await fs.rename(temporaryFile, file);
    } finally {
      await fs.rm(temporaryFile, { force: true });
    }
  }

  function enqueue(playerId, task) {
    const previous = writeQueues.get(playerId) || Promise.resolve();
    const current = previous.then(task, task);
    writeQueues.set(playerId, current);
    return current.finally(() => {
      if (writeQueues.get(playerId) === current) writeQueues.delete(playerId);
    });
  }

  return {
    async save(input) {
      const { deviceId, playerId, sessionToken, game } = input && typeof input === "object" ? input : {};
      validateIdentity(deviceId, playerId, sessionToken);
      const cleanGame = validateGame(game, playerId);
      const backupKey = `${deviceId}--${playerId}`;
      return enqueue(backupKey, async () => {
        const existing = await readRecord(deviceId, playerId, sessionToken);
        if (existing) {
          authorize(existing, sessionToken);
          if (existing.deviceId !== deviceId || existing.profileId !== playerId) {
            throw backupError("O backup não pertence a este dispositivo e perfil.", 403);
          }
        }

        const createdAt = now();
        const day = new Date(createdAt).toISOString().slice(0, 10);
        const history = Array.isArray(existing?.history) ? existing.history : [];
        const shouldArchiveLatest = existing?.latest && (
          existing.legacyFile
            ? !history.some((entry) => entry.day === existing.latest.day)
            : existing.latest.day !== day
        );
        if (shouldArchiveLatest &&
          !history.some((entry) => entry.day === existing.latest.day)) {
          history.unshift(existing.latest);
        }
        const cutoff = createdAt - historyAgeMs;
        const retainedHistory = history
          .filter((entry) => entry.createdAt >= cutoff)
          .slice(0, maxHistoryEntries);
        const latest = { id: randomUUID(), createdAt, day, game: cleanGame };
        const record = {
          deviceId,
          profileId: playerId,
          tokenHash: existing?.tokenHash || tokenDigest(sessionToken).toString("hex"),
          latest,
          history: retainedHistory
        };
        await writeRecord(deviceId, playerId, record);
        if (existing?.legacyFile) await fs.rm(existing.legacyFile, { force: true });
        return { createdAt, backupId: latest.id };
      });
    },

    async list(input) {
      const { deviceId, playerId, sessionToken } = input && typeof input === "object" ? input : {};
      validateIdentity(deviceId, playerId, sessionToken);
      const record = await readRecord(deviceId, playerId, sessionToken);
      if (!record) throw backupError("Ainda não há backups para este perfil.", 404);
      authorize(record, sessionToken);
      if (record.deviceId !== deviceId || record.profileId !== playerId) {
        throw backupError("O backup não pertence a este dispositivo e perfil.", 403);
      }
      return [record.latest, ...(Array.isArray(record.history) ? record.history : [])]
        .filter(Boolean)
        .map((backup, index) => ({
          id: backup.id,
          createdAt: backup.createdAt,
          kind: index === 0 ? "latest" : "daily"
        }));
    },

    async restore(input) {
      const { deviceId, playerId, sessionToken, backupId } = input && typeof input === "object" ? input : {};
      validateIdentity(deviceId, playerId, sessionToken);
      if (typeof backupId !== "string" || backupId.length > 80) {
        throw backupError("A versão de backup escolhida é inválida.", 400);
      }
      const record = await readRecord(deviceId, playerId, sessionToken);
      if (!record) throw backupError("Ainda não há backups para este perfil.", 404);
      authorize(record, sessionToken);
      if (record.deviceId !== deviceId || record.profileId !== playerId) {
        throw backupError("O backup não pertence a este dispositivo e perfil.", 403);
      }
      const backup = [record.latest, ...(Array.isArray(record.history) ? record.history : [])]
        .find((entry) => entry?.id === backupId);
      if (!backup) throw backupError("A versão escolhida não existe mais.", 404);
      return { createdAt: backup.createdAt, game: backup.game };
    }
  };
}

const backupStore = createBackupStore(defaultDirectory, Date.now, db);
export default backupStore;
