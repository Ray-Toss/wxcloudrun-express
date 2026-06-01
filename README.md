# BrickRogue Rank Server

微信小游戏《肉鸽弹弹弹》全服排行榜服务，基于微信云托管 Express 模板改造。

## API

- `GET /healthz`
- `POST /api/login`
- `POST /api/score`
- `GET /api/leaderboard`
- `GET /api/me/rank`

`/api/leaderboard` 默认返回本周榜，可通过 `period=history` 读取历史榜：

```text
GET /api/leaderboard?period=weekly&limit=50
GET /api/leaderboard?period=history&limit=50
```

## 环境变量

必填：

```text
RANK_TOKEN_SECRET=一串足够长的随机密钥
```

生产环境必须配置 `RANK_TOKEN_SECRET`，并且不要配置 `ALLOW_MOCK_LOGIN=1`。

云托管通过 `wx.cloud.callContainer` 调用时，服务端会优先读取请求头中的
`x-wx-openid` / `x-wx-from-openid`，因此不强制依赖 `WECHAT_APPID` 和
`WECHAT_SECRET`。

## 数据库

服务会优先识别微信云托管模板默认环境变量：

```text
MYSQL_ADDRESS=host:port
MYSQL_USERNAME=用户名
MYSQL_PASSWORD=密码
```

也兼容自定义变量：

```text
MYSQL_HOST=数据库地址
MYSQL_PORT=3306
MYSQL_USER=用户名
MYSQL_PASSWORD=密码
MYSQL_DATABASE=nodejs_demo
```

没有数据库配置时会使用内存榜，只适合测试，服务重启后数据会丢失。

## 安全策略

- `/api/leaderboard` 和 `/api/me/rank` 不返回 `openid`。
- `/api/score` 会校验分数、波次和单波最高得分的基础合理性。
- `/api/score` 会同时更新历史最高分和北京时间自然周周榜分数。
- 同一 `openid` 默认 10 秒内最多提交一次分数，可通过
  `SCORE_SUBMIT_INTERVAL_MS` 调整。
- 分数默认上限为 `5000000`，可通过 `MAX_REASONABLE_SCORE` 调整。
- `ALLOW_MOCK_LOGIN=1` 仅在非生产环境生效。
