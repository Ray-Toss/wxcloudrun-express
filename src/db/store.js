"use strict";

let mysql = null;
try {
  mysql = require("mysql2/promise");
} catch (error) {
  mysql = null;
}

function publicPlayer(item, rank) {
  const source = item || {};
  return {
    rank,
    nickname: String(source.nickname || "").trim().slice(0, 64),
    avatar: String(source.avatar || "").trim().slice(0, 512),
    score: Math.max(0, Math.floor(Number(source.best_score || source.score) || 0)),
    round: Math.max(1, Math.floor(Number(source.best_round || source.round) || 1)),
    bestWaveGain: Math.max(0, Math.floor(Number(source.best_wave_gain || source.bestWaveGain) || 0)),
    updatedAt: source.updated_at || source.updatedAt || "",
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
      week_key: "",
      week_score: 0,
      week_round: 1,
      week_best_wave_gain: 0,
      week_revived: false,
      day_key: "",
      day_score: 0,
      day_round: 1,
      day_best_wave_gain: 0,
      day_revived: false,
    };
    if (score.nickname) current.nickname = score.nickname;
    if (score.avatar) current.avatar = score.avatar;
    if (score.score > current.best_score) {
      current.best_score = score.score;
      current.best_round = score.round;
      current.best_wave_gain = score.bestWaveGain;
      current.revived = !!score.revived;
      current.updated_at = new Date().toISOString();
    }
    if (score.weekKey && (current.week_key !== score.weekKey || score.score > current.week_score)) {
      current.week_key = score.weekKey;
      current.week_score = score.score;
      current.week_round = score.round;
      current.week_best_wave_gain = score.bestWaveGain;
      current.week_revived = !!score.revived;
      current.week_updated_at = new Date().toISOString();
    }
    if (score.dayKey && (current.day_key !== score.dayKey || score.score > current.day_score)) {
      current.day_key = score.dayKey;
      current.day_score = score.score;
      current.day_round = score.round;
      current.day_best_wave_gain = score.bestWaveGain;
      current.day_revived = !!score.revived;
      current.day_updated_at = new Date().toISOString();
    }
    this.players.set(openid, current);
    return current;
  }

  async syncBestScore(openid, score) {
    const current = this.players.get(openid);
    if (!current) return null;
    if (score.score > current.best_score) {
      current.best_score = score.score;
      current.best_round = score.round;
      current.best_wave_gain = score.bestWaveGain;
      current.revived = !!score.revived;
      current.updated_at = new Date().toISOString();
    }
    if (score.nickname) current.nickname = score.nickname;
    if (score.avatar) current.avatar = score.avatar;
    this.players.set(openid, current);
    return current;
  }

  async leaderboard(limit, period, periodKey) {
    const rows = [...this.players.values()];
    if (period === "daily") {
      return rows
        .filter((item) => item.day_key === periodKey && item.day_score > 0)
        .sort((a, b) => b.day_score - a.day_score)
        .slice(0, limit)
        .map((item, index) => publicPlayer({
          ...item,
          best_score: item.day_score,
          best_round: item.day_round,
          best_wave_gain: item.day_best_wave_gain,
          revived: item.day_revived,
          updated_at: item.day_updated_at,
        }, index + 1));
    }
    if (period === "weekly") {
      return rows
        .filter((item) => item.week_key === periodKey && item.week_score > 0)
        .sort((a, b) => b.week_score - a.week_score)
        .slice(0, limit)
        .map((item, index) => publicPlayer({
          ...item,
          best_score: item.week_score,
          best_round: item.week_round,
          best_wave_gain: item.week_best_wave_gain,
          revived: item.week_revived,
          updated_at: item.week_updated_at,
        }, index + 1));
    }
    return rows
      .sort((a, b) => b.best_score - a.best_score)
      .slice(0, limit)
      .map((item, index) => publicPlayer(item, index + 1));
  }

  async updateProfile(openid, profile) {
    const current = this.players.get(openid);
    if (!current) return null;
    if (profile.nickname) current.nickname = profile.nickname;
    if (profile.avatar) current.avatar = profile.avatar;
    this.players.set(openid, current);
    return current;
  }

  async myRank(openid, period, periodKey) {
    const rows = [...this.players.values()];
    let sorted = rows;
    let target = this.players.get(openid);
    if (period === "daily") {
      if (!target || target.day_key !== periodKey || !target.day_score) return null;
      sorted = rows
        .filter((item) => item.day_key === periodKey && item.day_score > 0)
        .sort((a, b) => b.day_score - a.day_score);
      const index = sorted.findIndex((item) => item.openid === openid);
      if (index < 0) return null;
      target = sorted[index];
      return publicPlayer({
        ...target,
        best_score: target.day_score,
        best_round: target.day_round,
        best_wave_gain: target.day_best_wave_gain,
        revived: target.day_revived,
        updated_at: target.day_updated_at,
      }, index + 1);
    }
    if (period === "weekly") {
      if (!target || target.week_key !== periodKey || !target.week_score) return null;
      sorted = rows
        .filter((item) => item.week_key === periodKey && item.week_score > 0)
        .sort((a, b) => b.week_score - a.week_score);
      const index = sorted.findIndex((item) => item.openid === openid);
      if (index < 0) return null;
      target = sorted[index];
      return publicPlayer({
        ...target,
        best_score: target.week_score,
        best_round: target.week_round,
        best_wave_gain: target.week_best_wave_gain,
        revived: target.week_revived,
        updated_at: target.week_updated_at,
      }, index + 1);
    }
    if (!target || !target.best_score) return null;
    sorted = rows
      .filter((item) => item.best_score > 0)
      .sort((a, b) => b.best_score - a.best_score);
    const index = sorted.findIndex((item) => item.openid === openid);
    return index >= 0 ? publicPlayer(sorted[index], index + 1) : null;
  }
}

class MysqlStore {
  constructor() {
    const address = process.env.MYSQL_ADDRESS || "";
    const [addressHost, addressPort] = address.split(":");
    this.pool = mysql.createPool({
      host: process.env.MYSQL_HOST || addressHost || "127.0.0.1",
      port: Number(process.env.MYSQL_PORT || addressPort || 3306),
      user: process.env.MYSQL_USER || process.env.MYSQL_USERNAME || "root",
      password: process.env.MYSQL_PASSWORD || "",
      database: process.env.MYSQL_DATABASE || process.env.MYSQL_DATABASE_NAME || "nodejs_demo",
      waitForConnections: true,
      connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT || 4),
      charset: "utf8mb4",
    });
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
    // 跳过 ensureColumn，因为字段已经手动添加
    // await this.ensureColumn("week_key", "VARCHAR(16) NOT NULL DEFAULT ''");
    // await this.ensureColumn("week_score", "INT UNSIGNED NOT NULL DEFAULT 0");
    // await this.ensureColumn("week_round", "INT UNSIGNED NOT NULL DEFAULT 1");
    // await this.ensureColumn("week_best_wave_gain", "INT UNSIGNED NOT NULL DEFAULT 0");
    // await this.ensureColumn("week_revived", "TINYINT(1) NOT NULL DEFAULT 0");
    // await this.ensureColumn("week_updated_at", "TIMESTAMP NULL DEFAULT NULL");
    // await this.ensureIndex("idx_week_score", "week_key, week_score DESC, week_updated_at ASC");
  }

  async ensureColumn(name, definition) {
    const [rows] = await this.pool.query(`SHOW COLUMNS FROM players LIKE '${name}'`);
    if (rows.length) return;
    await this.pool.query(`ALTER TABLE players ADD COLUMN ${name} ${definition}`);
  }

  async ensureIndex(name, columns) {
    const [rows] = await this.pool.execute(`
      SELECT 1
      FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name = 'players'
        AND index_name = ?
      LIMIT 1
    `, [name]);
    if (rows.length) return;
    await this.pool.query(`ALTER TABLE players ADD KEY ${name} (${columns})`);
  }

  async upsertScore(openid, score) {
    await this.pool.execute(`
      INSERT INTO players (
        openid, nickname, avatar,
        best_score, best_round, best_wave_gain, revived,
        week_key, week_score, week_round, week_best_wave_gain, week_revived, week_updated_at,
        day_key, day_score, day_round, day_best_wave_gain, day_revived, day_updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON DUPLICATE KEY UPDATE
        nickname = IF(VALUES(nickname) <> '', VALUES(nickname), nickname),
        avatar = IF(VALUES(avatar) <> '', VALUES(avatar), avatar),
        best_round = IF(VALUES(best_score) > best_score, VALUES(best_round), best_round),
        best_wave_gain = IF(VALUES(best_score) > best_score, VALUES(best_wave_gain), best_wave_gain),
        revived = IF(VALUES(best_score) > best_score, VALUES(revived), revived),
        best_score = GREATEST(best_score, VALUES(best_score)),
        week_key = VALUES(week_key),
        week_round = IF(week_key <> VALUES(week_key), VALUES(week_round), IF(VALUES(week_score) > week_score, VALUES(week_round), week_round)),
        week_best_wave_gain = IF(week_key <> VALUES(week_key), VALUES(week_best_wave_gain), IF(VALUES(week_score) > week_score, VALUES(week_best_wave_gain), week_best_wave_gain)),
        week_revived = IF(week_key <> VALUES(week_key), VALUES(week_revived), IF(VALUES(week_score) > week_score, VALUES(week_revived), week_revived)),
        week_updated_at = IF(week_key <> VALUES(week_key), CURRENT_TIMESTAMP, IF(VALUES(week_score) > week_score, CURRENT_TIMESTAMP, week_updated_at)),
        week_score = IF(week_key <> VALUES(week_key), VALUES(week_score), GREATEST(week_score, VALUES(week_score))),
        day_key = VALUES(day_key),
        day_round = IF(day_key <> VALUES(day_key), VALUES(day_round), IF(VALUES(day_score) > day_score, VALUES(day_round), day_round)),
        day_best_wave_gain = IF(day_key <> VALUES(day_key), VALUES(day_best_wave_gain), IF(VALUES(day_score) > day_score, VALUES(day_best_wave_gain), day_best_wave_gain)),
        day_revived = IF(day_key <> VALUES(day_key), VALUES(day_revived), IF(VALUES(day_score) > day_score, VALUES(day_revived), day_revived)),
        day_updated_at = IF(day_key <> VALUES(day_key), CURRENT_TIMESTAMP, IF(VALUES(day_score) > day_score, CURRENT_TIMESTAMP, day_updated_at)),
        day_score = IF(day_key <> VALUES(day_key), VALUES(day_score), GREATEST(day_score, VALUES(day_score)))
    `, [
      openid,
      score.nickname,
      score.avatar,
      score.score,
      score.round,
      score.bestWaveGain,
      score.revived ? 1 : 0,
      score.weekKey || "",
      score.score,
      score.round,
      score.bestWaveGain,
      score.revived ? 1 : 0,
      score.dayKey || "",
      score.score,
      score.round,
      score.bestWaveGain,
      score.revived ? 1 : 0,
    ]);
    const [rows] = await this.pool.execute("SELECT * FROM players WHERE openid = ?", [openid]);
    return rows[0] || null;
  }

  async syncBestScore(openid, score) {
    await this.pool.execute(`
      INSERT INTO players (openid, nickname, avatar, best_score, best_round, best_wave_gain, revived)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        nickname = IF(VALUES(nickname) <> '', VALUES(nickname), nickname),
        avatar = IF(VALUES(avatar) <> '', VALUES(avatar), avatar),
        best_round = IF(VALUES(best_score) > best_score, VALUES(best_round), best_round),
        best_wave_gain = IF(VALUES(best_score) > best_score, VALUES(best_wave_gain), best_wave_gain),
        revived = IF(VALUES(best_score) > best_score, VALUES(revived), revived),
        best_score = GREATEST(best_score, VALUES(best_score))
    `, [
      openid,
      score.nickname || "",
      score.avatar || "",
      score.score,
      score.round,
      score.bestWaveGain,
      score.revived ? 1 : 0,
    ]);
    const [rows] = await this.pool.execute("SELECT * FROM players WHERE openid = ?", [openid]);
    return rows[0] || null;
  }

  async leaderboard(limit, period, periodKey) {
    if (period === "daily") {
      const [rows] = await this.pool.execute(`
        SELECT
          openid,
          nickname,
          avatar,
          day_score AS best_score,
          day_round AS best_round,
          day_best_wave_gain AS best_wave_gain,
          day_updated_at AS updated_at
        FROM players
        WHERE day_key = ? AND day_score > 0
        ORDER BY day_score DESC, day_updated_at ASC
        LIMIT ?
      `, [periodKey, limit]);
      return rows.map((item, index) => publicPlayer(item, index + 1));
    }
    if (period === "weekly") {
      const [rows] = await this.pool.execute(`
        SELECT
          openid,
          nickname,
          avatar,
          week_score AS best_score,
          week_round AS best_round,
          week_best_wave_gain AS best_wave_gain,
          week_updated_at AS updated_at
        FROM players
        WHERE week_key = ? AND week_score > 0
        ORDER BY week_score DESC, week_updated_at ASC
        LIMIT ?
      `, [periodKey, limit]);
      return rows.map((item, index) => publicPlayer(item, index + 1));
    }
    const [rows] = await this.pool.execute(`
      SELECT openid, nickname, avatar, best_score, best_round, best_wave_gain, updated_at
      FROM players
      WHERE best_score > 0
      ORDER BY best_score DESC, updated_at ASC
      LIMIT ?
    `, [limit]);
    return rows.map((item, index) => publicPlayer(item, index + 1));
  }

  async updateProfile(openid, profile) {
    await this.pool.execute(`
      UPDATE players
      SET
        nickname = IF(? <> '', ?, nickname),
        avatar = IF(? <> '', ?, avatar)
      WHERE openid = ?
    `, [profile.nickname, profile.nickname, profile.avatar, profile.avatar, openid]);
    const [rows] = await this.pool.execute("SELECT * FROM players WHERE openid = ?", [openid]);
    return rows[0] || null;
  }

  async myRank(openid, period, periodKey) {
    if (period === "daily") {
      const [mine] = await this.pool.execute(
        "SELECT day_score, day_updated_at FROM players WHERE openid = ? AND day_key = ? AND day_score > 0",
        [openid, periodKey]
      );
      if (!mine.length) return null;
      const [rankRows] = await this.pool.execute(`
        SELECT COUNT(*) + 1 AS rank
        FROM players
        WHERE day_key = ?
          AND day_score > 0
          AND (
            day_score > ?
            OR (day_score = ? AND day_updated_at < ?)
          )
      `, [periodKey, mine[0].day_score, mine[0].day_score, mine[0].day_updated_at]);
      const [playerRows] = await this.pool.execute(`
        SELECT
          openid,
          nickname,
          avatar,
          day_score AS best_score,
          day_round AS best_round,
          day_best_wave_gain AS best_wave_gain,
          day_updated_at AS updated_at
        FROM players
        WHERE openid = ? AND day_key = ?
      `, [openid, periodKey]);
      return playerRows.length ? publicPlayer(playerRows[0], rankRows[0].rank) : null;
    }
    if (period === "weekly") {
      const [mine] = await this.pool.execute(
        "SELECT week_score, week_updated_at FROM players WHERE openid = ? AND week_key = ? AND week_score > 0",
        [openid, periodKey]
      );
      if (!mine.length) return null;
      const [rankRows] = await this.pool.execute(`
        SELECT COUNT(*) + 1 AS rank
        FROM players
        WHERE week_key = ?
          AND week_score > 0
          AND (
            week_score > ?
            OR (week_score = ? AND week_updated_at < ?)
          )
      `, [periodKey, mine[0].week_score, mine[0].week_score, mine[0].week_updated_at]);
      const [playerRows] = await this.pool.execute(`
        SELECT
          openid,
          nickname,
          avatar,
          week_score AS best_score,
          week_round AS best_round,
          week_best_wave_gain AS best_wave_gain,
          week_updated_at AS updated_at
        FROM players
        WHERE openid = ? AND week_key = ?
      `, [openid, periodKey]);
      return playerRows.length ? publicPlayer(playerRows[0], rankRows[0].rank) : null;
    }
    const [mine] = await this.pool.execute("SELECT best_score, updated_at FROM players WHERE openid = ? AND best_score > 0", [openid]);
    if (!mine.length) return null;
    const [rankRows] = await this.pool.execute(`
      SELECT COUNT(*) + 1 AS rank
      FROM players
      WHERE best_score > ?
        OR (best_score = ? AND updated_at < ?)
    `, [mine[0].best_score, mine[0].best_score, mine[0].updated_at]);
    const [playerRows] = await this.pool.execute("SELECT * FROM players WHERE openid = ?", [openid]);
    const player = playerRows[0];
    return publicPlayer(player, rankRows[0].rank);
  }
}

function createStore() {
  console.log("[store] MYSQL_HOST=%s, MYSQL_ADDRESS=%s, mysql=%s",
    process.env.MYSQL_HOST || "undefined",
    process.env.MYSQL_ADDRESS || "undefined",
    mysql ? "loaded" : "not loaded");
  if ((process.env.MYSQL_HOST || process.env.MYSQL_ADDRESS) && mysql) {
    console.log("[store] using MysqlStore");
    return new MysqlStore();
  }
  console.log("[store] using MemoryStore");
  return new MemoryStore();
}

module.exports = { createStore, publicPlayer };
