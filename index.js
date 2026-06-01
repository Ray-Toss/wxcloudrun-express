"use strict";

const crypto = require("crypto");
const express = require("express");
const { createStore } = require("./src/db/store.js");

const app = express();
const store = createStore();
const port = Number(process.env.PORT || 80);
const tokenSecret = resolveTokenSecret();
const scoreSubmitLimiter = new Map();
const SCORE_SUBMIT_INTERVAL_MS = Number(process.env.SCORE_SUBMIT_INTERVAL_MS || 10000);
const MAX_REASONABLE_SCORE = Number(process.env.MAX_REASONABLE_SCORE || 5000000);

app.use(express.json({ limit: "64kb" }));

function resolveTokenSecret() {
  if (process.env.RANK_TOKEN_SECRET) return process.env.RANK_TOKEN_SECRET;
  if (process.env.NODE_ENV === "production") {
    throw new Error("RANK_TOKEN_SECRET is required in production");
  }
  return "brickrogue-dev-secret";
}

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", tokenSecret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function verify(token) {
  if (!token || token.indexOf(".") < 0) return null;
  const [body, sig] = token.split(".");
  const expected = crypto.createHmac("sha256", tokenSecret).update(body).digest("base64url");
  if (Buffer.byteLength(sig) !== Buffer.byteLength(expected)) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch (error) {
    return null;
  }
}

function auth(req, res, next) {
  const header = req.get("authorization") || "";
  const token = header.replace(/^Bearer\s+/i, "");
  const payload = verify(token);
  if (!payload || !payload.openid) {
    res.status(401).json({ ok: false, errMsg: "unauthorized" });
    return;
  }
  req.openid = payload.openid;
  next();
}

function openidFromHeaders(req) {
  const openid = req.get("x-wx-openid") || req.get("x-wx-from-openid") || "";
  return String(openid || "").slice(0, 128);
}

async function codeToOpenid(code) {
  if (!process.env.WECHAT_APPID || !process.env.WECHAT_SECRET) {
    if (process.env.ALLOW_MOCK_LOGIN === "1" && process.env.NODE_ENV !== "production") {
      return `mock_${String(code || "dev").slice(0, 32)}`;
    }
    throw new Error("WECHAT_APPID/WECHAT_SECRET not configured");
  }
  const url =
    "https://api.weixin.qq.com/sns/jscode2session" +
    `?appid=${encodeURIComponent(process.env.WECHAT_APPID)}` +
    `&secret=${encodeURIComponent(process.env.WECHAT_SECRET)}` +
    `&js_code=${encodeURIComponent(code)}` +
    "&grant_type=authorization_code";
  const response = await fetch(url);
  const data = await response.json();
  if (!data.openid) throw new Error(data.errmsg || "jscode2session failed");
  return data.openid;
}

async function resolveOpenid(req, code) {
  const headerOpenid = openidFromHeaders(req);
  if (headerOpenid) return headerOpenid;
  if (!code) {
    const error = new Error("missing code");
    error.statusCode = 400;
    throw error;
  }
  return codeToOpenid(code);
}

function cleanScore(input) {
  return {
    score: Math.max(0, Math.min(MAX_REASONABLE_SCORE, Math.floor(Number(input.score) || 0))),
    round: Math.max(1, Math.min(9999, Math.floor(Number(input.round) || 1))),
    bestWaveGain: Math.max(0, Math.min(MAX_REASONABLE_SCORE, Math.floor(Number(input.bestWaveGain) || 0))),
    revived: !!input.revived,
    nickname: String(input.nickname || "").trim().slice(0, 64),
    avatar: String(input.avatar || "").trim().slice(0, 512),
  };
}

function currentWeekKey(date) {
  const source = date || new Date();
  const dayMs = 24 * 60 * 60 * 1000;
  const chinaTime = source.getTime() + 8 * 60 * 60 * 1000;
  const chinaDate = new Date(chinaTime);
  const day = chinaDate.getUTCDay();
  const daysSinceMonday = (day + 6) % 7;
  const monday = new Date(chinaTime - daysSinceMonday * dayMs);
  const year = monday.getUTCFullYear();
  const month = String(monday.getUTCMonth() + 1).padStart(2, "0");
  const dateOfMonth = String(monday.getUTCDate()).padStart(2, "0");
  return `${year}${month}${dateOfMonth}`;
}

function validateScore(score) {
  if (!Number.isFinite(score.score) || !Number.isFinite(score.round) || !Number.isFinite(score.bestWaveGain)) {
    return "invalid score payload";
  }
  if (score.score < 0 || score.round < 1 || score.bestWaveGain < 0) {
    return "invalid score range";
  }
  if (score.bestWaveGain > score.score) {
    return "bestWaveGain exceeds score";
  }
  const roundCap = score.round * 25000 + 250000;
  if (score.score > Math.min(MAX_REASONABLE_SCORE, roundCap)) {
    return "score exceeds round limit";
  }
  return "";
}

function checkScoreSubmitRate(openid) {
  if (!SCORE_SUBMIT_INTERVAL_MS) return "";
  const now = Date.now();
  const last = scoreSubmitLimiter.get(openid) || 0;
  if (now - last < SCORE_SUBMIT_INTERVAL_MS) {
    return "score submit too frequent";
  }
  scoreSubmitLimiter.set(openid, now);
  if (scoreSubmitLimiter.size > 5000) {
    const cutoff = now - SCORE_SUBMIT_INTERVAL_MS * 6;
    scoreSubmitLimiter.forEach((time, key) => {
      if (time < cutoff) scoreSubmitLimiter.delete(key);
    });
  }
  return "";
}

app.get("/healthz", (req, res) => {
  res.json({ ok: true });
});

app.get("/", (req, res) => {
  res.json({ ok: true, service: "brickrogue-rank" });
});

app.post("/api/login", async (req, res) => {
  try {
    const code = req.body && req.body.code;
    const openid = await resolveOpenid(req, code);
    res.json({ ok: true, token: sign({ openid, ts: Date.now() }) });
  } catch (error) {
    res.status(error.statusCode || 500).json({ ok: false, errMsg: error.message || "login failed" });
  }
});

app.post("/api/score", auth, async (req, res) => {
  try {
    const score = cleanScore(req.body || {});
    score.weekKey = currentWeekKey();
    const scoreError = validateScore(score);
    if (scoreError) {
      res.status(400).json({ ok: false, errMsg: scoreError });
      return;
    }
    const rateError = checkScoreSubmitRate(req.openid);
    if (rateError) {
      res.status(429).json({ ok: false, errMsg: rateError });
      return;
    }
    const player = await store.upsertScore(req.openid, score);
    res.json({ ok: true, player });
  } catch (error) {
    res.status(500).json({ ok: false, errMsg: error.message || "score submit failed" });
  }
});

app.post("/api/profile", auth, async (req, res) => {
  try {
    const profile = cleanScore(req.body || {});
    const player = await store.updateProfile(req.openid, profile);
    res.json({ ok: true, player });
  } catch (error) {
    res.status(500).json({ ok: false, errMsg: error.message || "profile update failed" });
  }
});

app.get("/api/leaderboard", async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(100, Math.floor(Number(req.query.limit) || 50)));
    const period = req.query.period === "history" ? "history" : "weekly";
    const weekKey = currentWeekKey();
    const list = await store.leaderboard(limit, period, weekKey);
    res.json({ ok: true, list, period, weekKey });
  } catch (error) {
    res.status(500).json({ ok: false, errMsg: error.message || "leaderboard failed" });
  }
});

app.get("/api/me/rank", auth, async (req, res) => {
  try {
    const rank = await store.myRank(req.openid);
    res.json({ ok: true, rank });
  } catch (error) {
    res.status(500).json({ ok: false, errMsg: error.message || "rank failed" });
  }
});

store.init().then(() => {
  app.listen(port, () => {
    console.log(`[BrickRogue] rank server listening on ${port}`);
  });
}).catch((error) => {
  console.error("[BrickRogue] rank server failed to start", error);
  process.exit(1);
});
