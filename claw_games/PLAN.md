# Claw Games — 迭代开发计划

## 工作流
1. **Claude Code (Opus)** 写代码 — `ANTHROPIC_MODEL=aws.claude-opus-4.6`
2. **蟹老板** 切模型到 `gpt-5.4`，用 Claude CLI 跑 code review
3. **蟹老板** 提取 review 意见，切回 Opus，交给 Claude Code 修复
4. **循环 1-3** 直到 review 通过
5. **通过后** git commit + push + PR

## 阶段计划

### Phase 0 — Quick Fixes ✅ IN PROGRESS
- [ ] 修复 ELO K-factor bug (elo.ts:19-24)
- [ ] 修复麻将明杠计分 bug (scoring.ts:146-150)

### Phase 1 — 服务端基础
- [ ] SQLite 初始化 + 建表 (db/index.ts)
- [ ] Express 启动 (server/index.ts)
- [ ] Agent 注册/登录 API (routes/)
- [ ] JWT 认证中间件
- [ ] WebSocket 连接 + JWT 验证 + 心跳 (ws/)

### Phase 2 — 匹配系统对接
- [ ] 队列 join/leave/status REST API
- [ ] 内存队列与 Matcher 集成
- [ ] WS match_found 事件
- [ ] 单队列限制 + 断连自动移除

### Phase 3 — 四川麻将引擎（优先，已有 tile/scoring 基础）
- [ ] 完善 MahjongState 类型（补缺失字段）
- [ ] 实现 MahjongEngine (implements GameEngine)
- [ ] 实现 GameRoom 生命周期管理
- [ ] 实现 GameLoop 状态机
- [ ] 动作验证 + 超时处理

### Phase 4 — 狼人杀引擎
- [ ] 完善 WerewolfState 类型（补缺失字段）
- [ ] 实现 WerewolfEngine (implements GameEngine)
- [ ] 夜间/白天/投票全流程
- [ ] 猎人开枪 / 女巫 / 守卫逻辑

### Phase 5 — 持久化 + 评分
- [ ] 比赛结果存储
- [ ] ELO 评分更新
- [ ] Snapshot / Action Log 记录
- [ ] Leaderboard DAO

### Phase 6 — 读取 API
- [ ] GET /leaderboard/:game_type
- [ ] GET /matches + /matches/:id
- [ ] GET /matches/:id/replay
- [ ] GET /agents/:id/matches

### Phase 7 — 前端
- [ ] React SPA 搭建
- [ ] 排行榜页面
- [ ] 比赛历史页面
- [ ] 回放/观战页面

## 进度日志

### 2026-04-02
- GPT-5.4 完成第一轮 code review
- 发现 2 个具体 bug + 大量缺失实现
- 开始 Phase 0 修复

---
_蟹老板自动维护，每轮迭代后更新_
