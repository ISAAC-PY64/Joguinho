import fs from "node:fs";
import path from "node:path";

const dir = path.resolve(process.env.DATA_DIR || "data/server-database");
const file = path.join(dir, "monster-haven.json");
let data = { rooms: [], players: [] };
let pool = null;
fs.mkdirSync(dir, { recursive: true });
const roomSnapshot = (room) => ({ ...room, reconnectTimer: null });

try {
  if (fs.existsSync(file)) {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    data = {
      rooms: Array.isArray(parsed.rooms) ? parsed.rooms : [],
      players: Array.isArray(parsed.players) ? parsed.players : []
    };
  }
} catch (error) {
  throw new Error(`Não foi possível ler o banco local (${file}): ${error.message}`, { cause: error });
}

function saveLocal() {
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(data, null, 2));
  fs.renameSync(temp, file);
}

async function init() {
  if (!process.env.DATABASE_URL || pool) return;
  const { Pool } = await import("pg");
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false },
    max: Number(process.env.PGPOOL_MAX || 5),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000
  });
  await pool.query(`
    CREATE TABLE IF NOT EXISTS game_rooms (
      code VARCHAR(6) PRIMARY KEY,
      created_at BIGINT NOT NULL,
      status VARCHAR(20) NOT NULL,
      snapshot JSONB,
      result JSONB
    );
    CREATE TABLE IF NOT EXISTS profile_backups (
      backup_key VARCHAR(180) PRIMARY KEY,
      record JSONB NOT NULL
    );
  `);
  await pool.query("SELECT 1");
}

const db = {
  init,
  get usesPersistentStorage() {
    return Boolean(pool);
  },
  async hasRoom(code) {
    if (pool) {
      const result = await pool.query("SELECT 1 FROM game_rooms WHERE code = $1", [code]);
      return result.rowCount > 0;
    }
    return data.rooms.some((room) => room.code === code);
  },
  async addRoom(code, createdAt, room) {
    if (pool) {
      await pool.query(
        "INSERT INTO game_rooms (code, created_at, status, snapshot) VALUES ($1, $2, $3, $4)",
        [code, createdAt, room.status, roomSnapshot(room)]
      );
      return;
    }
    data.rooms.push({ code, createdAt, status: room.status, snapshot: roomSnapshot(room) });
    saveLocal();
  },
  async saveRoom(room) {
    const snapshot = ["finished", "closed"].includes(room.status) ? null : roomSnapshot(room);
    if (pool) {
      await pool.query(
        "UPDATE game_rooms SET status = $2, snapshot = $3 WHERE code = $1",
        [room.code, room.status, snapshot]
      );
      return;
    }
    const stored = data.rooms.find((entry) => entry.code === room.code);
    if (stored) {
      stored.status = room.status;
      stored.snapshot = snapshot;
      saveLocal();
    }
  },
  async loadActiveRooms() {
    if (pool) {
      const result = await pool.query(
        "SELECT snapshot FROM game_rooms WHERE status IN ('waiting', 'in_battle') AND snapshot IS NOT NULL"
      );
      return result.rows.map((row) => row.snapshot);
    }
    return data.rooms
      .filter((room) => ["waiting", "in_battle"].includes(room.status) && room.snapshot)
      .map((room) => room.snapshot);
  },
  async closeRoom(code) {
    if (pool) {
      await pool.query(
        "UPDATE game_rooms SET status = 'closed', snapshot = NULL WHERE code = $1",
        [code]
      );
      return;
    }
    const room = data.rooms.find((entry) => entry.code === code);
    if (room) {
      room.status = "closed";
      room.snapshot = null;
      saveLocal();
    }
  },
  async updateRoomStatus(code, status, snapshot) {
    if (pool) {
      await pool.query(
        "UPDATE game_rooms SET status = $2, snapshot = COALESCE($3, snapshot) WHERE code = $1",
        [code, status, snapshot ? roomSnapshot(snapshot) : null]
      );
      return;
    }
    const room = data.rooms.find((entry) => entry.code === code);
    if (room) {
      room.status = status;
      if (snapshot) room.snapshot = roomSnapshot(snapshot);
      saveLocal();
    }
  },
  async recordResult(code, winnerId, loserId) {
    const result = { winnerId, loserId, draw: !winnerId && !loserId, recordedAt: Date.now() };
    if (pool) {
      const saved = await pool.query(
        `UPDATE game_rooms SET status = 'finished', snapshot = NULL, result = $2
         WHERE code = $1 AND result IS NULL RETURNING code`,
        [code, result]
      );
      return saved.rowCount > 0;
    }
    const room = data.rooms.find((entry) => entry.code === code);
    if (!room || room.result) return false;
    room.status = "finished";
    room.snapshot = null;
    room.result = result;
    saveLocal();
    return true;
  },
  async getBackupRecord(key) {
    if (!pool) return null;
    const result = await pool.query("SELECT record FROM profile_backups WHERE backup_key = $1", [key]);
    return result.rows[0]?.record || null;
  },
  async putBackupRecord(key, record) {
    if (!pool) throw new Error("O armazenamento de backups em PostgreSQL não está configurado.");
    await pool.query(
      `INSERT INTO profile_backups (backup_key, record) VALUES ($1, $2)
       ON CONFLICT (backup_key) DO UPDATE SET record = EXCLUDED.record`,
      [key, record]
    );
  }
};

export default db;
