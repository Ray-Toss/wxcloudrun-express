"use strict";

let mysql = null;
try {
  mysql = require("mysql2/promise");
} catch (error) {
  mysql = null;
}

function mysqlConfig() {
  const address = process.env.MYSQL_ADDRESS || "";
  const [addressHost, addressPort] = address.split(":");
  const host = process.env.MYSQL_HOST || addressHost || "";
  if (!host) return null;
  return {
    host,
    port: Number(process.env.MYSQL_PORT || addressPort || 3306),
    user: process.env.MYSQL_USER || process.env.MYSQL_USERNAME || "root",
    password: process.env.MYSQL_PASSWORD || "",
    database: process.env.MYSQL_DATABASE || process.env.MYSQL_DATABASE_NAME || "nodejs_demo",
    waitForConnections: true,
    connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT || 4),
    charset: "utf8mb4",
  };
}

class MemoryStore {
  constructor() {
    this.players = new Map();
  }

  async init() {}

  async upsertScore(openid, score) {
    const current = this.players.get(openid) || {
      openid,
      best_score: 0,
      best_round: 1,
      best_wave_gain: 0,
      revived: false,
    };
    if (score.score > current.best_score) {
      current.best_score = score.score;
      current.best_round = score.round;
      current.best_wave_gain = score.bestWaveGain;
      current.revived = !!score.revived;
      current.updated_at = new Date().toISOString();
    }
    this.players.set(openid, current);
    return current;
  }

  async leaderboard(limit) {
    return [...this.players.values()]
      .sort((a, b) => b.best_score - a.best_score)
      .slice(0, limit)
      .map((item, index) => ({
        rank: index + 1,
        openid: item.openid,
        nickname: item.nickname || "",
        score: item.best_score,
        round: item.best_round,
        bestWaveGain: item.best_wave_gain,
        updatedAt: item.updated_at || "",
      }));
  }

  async myRank(openid) {
    const rows = await this.leaderboard(this.players.size || 1);
    const index = rows.findIndex((item) => item.openid === openid);
    return index >= 0 ? rows[index] : null;
  }
}

class MysqlStore {
  constructor(config) {
    this.pool = mysql.createPool(config);
  }

  async init() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS players (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        openid VARCHAR(128) NOT NULL,
        nickname VARCHAR(64) NOT NULL DEFAULT '',
        avatar VARCHAR(512) NOT NULL DEFAULT '',
        best_score INT UNSIGNED NOT NULL DEFAULT 0,
        best_round INT UNSIGNED NOT NULL DEFAULT 1,
        best_wave_gain INT UNSIGNED NOT NULL DEFAULT 0,
        revived TINYINT(1) NOT NULL DEFAULT 0,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uk_openid (openid),
        KEY idx_score (best_score DESC, updated_at ASC)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
  }

  async upsertScore(openid, score) {
    await this.pool.execute(`
      INSERT INTO players (openid, best_score, best_round, best_wave_gain, revived)
      VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        best_round = IF(VALUES(best_score) > best_score, VALUES(best_round), best_round),
        best_wave_gain = IF(VALUES(best_score) > best_score, VALUES(best_wave_gain), best_wave_gain),
        revived = IF(VALUES(best_score) > best_score, VALUES(revived), revived),
        best_score = GREATEST(best_score, VALUES(best_score))
    `, [openid, score.score, score.round, score.bestWaveGain, score.revived ? 1 : 0]);
    const [rows] = await this.pool.execute("SELECT * FROM players WHERE openid = ?", [openid]);
    return rows[0] || null;
  }

  async leaderboard(limit) {
    const [rows] = await this.pool.execute(`
      SELECT openid, nickname, best_score, best_round, best_wave_gain, updated_at
      FROM players
      ORDER BY best_score DESC, updated_at ASC
      LIMIT ?
    `, [limit]);
    return rows.map((item, index) => ({
      rank: index + 1,
      openid: item.openid,
      nickname: item.nickname || "",
      score: item.best_score,
      round: item.best_round,
      bestWaveGain: item.best_wave_gain,
      updatedAt: item.updated_at,
    }));
  }

  async myRank(openid) {
    const [mine] = await this.pool.execute("SELECT best_score, updated_at FROM players WHERE openid = ?", [openid]);
    if (!mine.length) return null;
    const [rankRows] = await this.pool.execute(`
      SELECT COUNT(*) + 1 AS rank
      FROM players
      WHERE best_score > ?
        OR (best_score = ? AND updated_at < ?)
    `, [mine[0].best_score, mine[0].best_score, mine[0].updated_at]);
    const [playerRows] = await this.pool.execute("SELECT * FROM players WHERE openid = ?", [openid]);
    const player = playerRows[0];
    return {
      rank: rankRows[0].rank,
      openid,
      nickname: player.nickname || "",
      score: player.best_score,
      round: player.best_round,
      bestWaveGain: player.best_wave_gain,
      updatedAt: player.updated_at,
    };
  }
}

function createStore() {
  const config = mysqlConfig();
  if (config && mysql) return new MysqlStore(config);
  return new MemoryStore();
}

module.exports = { createStore };
