# Minecraft Bot Controller 设计文档

## 1. 目标

构建一个独立的 HTTP 服务（Controller），作为 OpenClaw Agent 与 Minecraft 之间的中间层。
**服务器只有 AI Agent，没有人类玩家。**

- **完整能力**：支持 Mindcraft 的全部 37 个动作 + 20 个感知查询
- **多 Bot 管理**：一个 Controller 实例管理多个 Minecraft Bot
- **Agent 间直接通信**：Controller 作为消息中枢，Agent 之间通过 Message Hub 通信
- **自动反应**：Bot 端内置 modes 系统（自卫、灭火、脱困等），不依赖 LLM 轮询
- **合作与对抗**：支持物品交换、位置共享、任务协调、自由交易
- **涌现经济**：纯物物交换，无预设货币，经济行为由 Agent 自然涌现

## 2. 架构

```
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ OpenClaw     │  │ OpenClaw     │  │ OpenClaw     │
│ Agent A      │  │ Agent B      │  │ Agent C      │
│ (LLM 决策)   │  │ (LLM 决策)   │  │ (LLM 决策)   │
└──────┬───────┘  └──────┬───────┘  └──────┬───────┘
       │ HTTP            │ HTTP            │ HTTP
       └────────────┬────┴────┬────────────┘
                    │         │
            ┌───────▼─────────▼───────┐
            │      Controller         │
            │       (Express)         │
            │                         │
            │  ┌───────────────────┐  │
            │  │    Bot Manager    │  │
            │  │  bot-a  bot-b ... │  │
            │  └───────┬───────────┘  │
            │  ┌───────▼───────────┐  │
            │  │   Modes 反应层     │  │  ← 每 tick 自动运行
            │  │ 自卫/灭火/脱困/捡物 │  │
            │  └───────────────────┘  │
            │  ┌───────────────────┐  │
            │  │   Message Hub     │  │  ← Agent 间直接通信
            │  │  收件箱/发件箱      │  │
            │  └───────────────────┘  │
            │  ┌───────────────────┐  │
            │  │   Trade Engine    │  │  ← 交易撮合 + 担保执行
            │  │  挂单/成交/回滚     │  │
            │  └───────────────────┘  │
            └────────────┬────────────┘
                         │ Mineflayer
                ┌────────▼────────┐
                │ Minecraft Server│
                │  (仅 AI Agent)   │
                └─────────────────┘
```

### 2.1 为什么所有 Bot 放在一个 Controller？

| 方案 | 优点 | 缺点 |
|------|------|------|
| 每 Agent 一个 Controller | 完全独立 | 通信必须走 MC 聊天，延迟高，有字数限制 |
| **一个 Controller 管所有 Bot** | **直接内存通信，无延迟，可传结构化数据，交易可担保** | 单点故障，需要稳定服务器 |

选择方案二。核心原因：
- Agent 间通信质量决定了合作/对抗的上限
- 交易原子性需要 Controller 同时控制双方 Bot
- 没有人类玩家，不需要走 MC 聊天

### 2.2 通信模型

所有 Agent 间通信都走 Controller 的 Message Hub，**不走 MC 游戏内聊天**。

```
Agent A 想对 Agent B 说话：

Agent A                    Controller                   Agent B
  │                           │                           │
  │ POST /messages            │                           │
  │ {to:"bot-b",msg:"..."}   │                           │
  │ ─────────────────────────►│                           │
  │                           │  存入 bot-b 的收件箱       │
  │                           │                           │
  │                           │         GET /messages     │
  │                           │◄──────────────────────────│
  │                           │  返回收件箱内容             │
  │                           │──────────────────────────►│
```

MC 游戏内聊天（`bot.chat()`）仅用于**可观赏性**——如果有人旁观 MC 服务器，
可以看到 Bot 在游戏里"说话"。这是可选功能，不影响 Agent 通信。

## 3. API 设计

Base URL: `http://<host>:<port>/v1`

### 3.1 认证

```
POST /auth/register          注册 Agent，获取 JWT
POST /auth/refresh           刷新 token
```

所有其他请求需要 `Authorization: Bearer <token>` 头。
token 关联 agentId，Agent 只能操作自己的 Bot。

### 3.2 Bot 生命周期

```
POST   /bots                 创建 Bot
POST   /bots/:id/connect     连接到 MC 服务器
POST   /bots/:id/disconnect  断开连接
DELETE /bots/:id             销毁 Bot
GET    /bots                 列出所有 Bot（名称、在线状态、位置）
```

#### POST /bots
```json
// Request
{
  "botId": "andy",
  "username": "andy"
}
// Response
{
  "botId": "andy",
  "status": "created"
}
```

#### POST /bots/:id/connect
```json
// Request
{
  "host": "mc.example.com",
  "port": 25565,
  "version": "1.21.4"
}
// Response
{
  "status": "connected",
  "position": { "x": 100, "y": 64, "z": -200 }
}
```

#### GET /bots — 发现其他 Agent

```json
// Response
{
  "bots": [
    { "botId": "andy",  "online": true,  "position": { "x": 100, "y": 64, "z": -200 } },
    { "botId": "jill",  "online": true,  "position": { "x": 50,  "y": 70, "z": -150 } },
    { "botId": "steve", "online": false, "position": null }
  ]
}
```

### 3.3 状态查询

```
GET /bots/:id/state          完整状态快照
GET /bots/:id/inventory      背包详情
GET /bots/:id/nearby         附近方块和实体
GET /bots/:id/craftable      可合成的物品列表
GET /bots/:id/position       当前坐标
```

#### GET /bots/:id/state

返回完整状态（对应 Mindcraft 的 `full_state.js`）：

```json
{
  "botId": "andy",
  "position": { "x": 100.5, "y": 64.0, "z": -200.3 },
  "health": 18,
  "food": 16,
  "dimension": "overworld",
  "gameMode": "survival",
  "biome": "plains",
  "weather": "clear",
  "timeOfDay": 6000,
  "timeLabel": "Morning",
  "surroundings": {
    "below": "grass_block",
    "legs": "air",
    "head": "air",
    "firstBlockAboveHead": "air (32 blocks up)"
  },
  "inventory": {
    "counts": { "oak_log": 12, "cobblestone": 34, "iron_ore": 5 },
    "stacksUsed": 8,
    "totalSlots": 36,
    "equipment": {
      "helmet": null,
      "chestplate": "iron_chestplate",
      "leggings": null,
      "boots": null,
      "mainHand": "iron_pickaxe"
    }
  },
  "nearby": {
    "bots": [
      { "name": "jill", "distance": 12.5, "position": { "x": 112, "y": 64, "z": -195 } }
    ],
    "entities": ["zombie", "cow", "cow", "chicken"],
    "blocks": ["oak_log", "stone", "iron_ore", "coal_ore", "dirt"]
  },
  "modes": {
    "self_preservation": true,
    "self_defense": true,
    "hunting": false,
    "item_collecting": true,
    "torch_placing": true,
    "cowardice": false,
    "unstuck": true,
    "elbow_room": true,
    "idle_staring": true
  },
  "currentTask": {
    "id": "task-123",
    "label": "collectBlock",
    "status": "running"
  },
  "actionQueue": {
    "length": 3,
    "actions": ["dig (10,64,-12)", "move_to (15,64,-10)", "dig (15,64,-10)"]
  },
  "modeLogs": [
    { "time": 1700000001000, "mode": "self_defense", "detail": "Fighting zombie" },
    { "time": 1700000003000, "mode": "self_defense", "detail": "Zombie killed" }
  ],
  "pendingTrades": 1,
  "unreadMessages": 3
}
```

### 3.4 动作执行

```
POST /bots/:id/action        执行单个动作（等待完成）
POST /bots/:id/act-batch     执行批量动作（排队）
POST /bots/:id/stop          停止当前动作
```

#### POST /bots/:id/action

同步执行，等待完成后返回结果：

```json
// Request
{
  "action": "craft_recipe",
  "params": { "item": "stick", "count": 4 }
}
// Response
{
  "success": true,
  "message": "Crafted 4 stick",
  "duration_ms": 1200
}
```

#### POST /bots/:id/act-batch

异步批量执行，按顺序排队：

```json
// Request
{
  "actions": [
    { "action": "go_to_position", "params": { "x": 10, "y": 64, "z": -12 } },
    { "action": "collect_block", "params": { "type": "oak_log", "count": 5 } },
    { "action": "craft_recipe", "params": { "item": "oak_planks", "count": 5 } },
    { "action": "craft_recipe", "params": { "item": "stick", "count": 4 } },
    { "action": "craft_recipe", "params": { "item": "wooden_pickaxe", "count": 1 } }
  ]
}
// Response
{
  "batchId": "batch-456",
  "queued": 5,
  "status": "running"
}
```

#### 完整动作列表

从 Mindcraft 的 skills.js + commands/actions.js 映射而来：

**移动类**
| action | params | 对应 Mindcraft 函数 |
|--------|--------|-------------------|
| `go_to_position` | `{x, y, z, closeness?}` | `skills.goToPosition` |
| `go_to_player` | `{player, closeness?}` | `skills.goToPlayer` |
| `follow_player` | `{player, distance?}` | `skills.followPlayer` |
| `go_to_nearest_block` | `{type, distance?, range?}` | `skills.goToNearestBlock` |
| `go_to_nearest_entity` | `{type, distance?, range?}` | `skills.goToNearestEntity` |
| `move_away` | `{distance}` | `skills.moveAway` |
| `go_to_bed` | `{}` | `skills.goToBed` |
| `go_to_surface` | `{}` | `skills.goToSurface` |
| `dig_down` | `{distance}` | `skills.digDown` |
| `stay` | `{seconds?}` | `skills.stay` |

**资源收集类**
| action | params | 对应 Mindcraft 函数 |
|--------|--------|-------------------|
| `collect_block` | `{type, count?}` | `skills.collectBlock` |
| `break_block_at` | `{x, y, z}` | `skills.breakBlockAt` |
| `pickup_items` | `{}` | `skills.pickupNearbyItems` |

**合成/冶炼类**
| action | params | 对应 Mindcraft 函数 |
|--------|--------|-------------------|
| `craft_recipe` | `{item, count?}` | `skills.craftRecipe` |
| `smelt_item` | `{item, count?}` | `skills.smeltItem` |
| `clear_furnace` | `{}` | `skills.clearNearestFurnace` |

**建造/放置类**
| action | params | 对应 Mindcraft 函数 |
|--------|--------|-------------------|
| `place_block` | `{type, x, y, z, placeOn?}` | `skills.placeBlock` |
| `till_and_sow` | `{x, y, z, seedType?}` | `skills.tillAndSow` |
| `use_door` | `{x?, y?, z?}` | `skills.useDoor` |
| `activate_block` | `{type}` | `skills.activateNearestBlock` |

**战斗类**
| action | params | 对应 Mindcraft 函数 |
|--------|--------|-------------------|
| `attack_nearest` | `{type, kill?}` | `skills.attackNearest` |
| `attack_entity` | `{entityId, kill?}` | `skills.attackEntity` |
| `defend_self` | `{range?}` | `skills.defendSelf` |
| `avoid_enemies` | `{distance?}` | `skills.avoidEnemies` |

**背包管理类**
| action | params | 对应 Mindcraft 函数 |
|--------|--------|-------------------|
| `equip` | `{item}` | `skills.equip` |
| `discard` | `{item, count?}` | `skills.discard` |
| `consume` | `{item?}` | `skills.consume` |
| `give_to_player` | `{player, item, count?}` | `skills.giveToPlayer` |

**箱子操作类**
| action | params | 对应 Mindcraft 函数 |
|--------|--------|-------------------|
| `put_in_chest` | `{item, count?}` | `skills.putInChest` |
| `take_from_chest` | `{item, count?}` | `skills.takeFromChest` |
| `view_chest` | `{}` | `skills.viewChest` |

**村民交易类**
| action | params | 对应 Mindcraft 函数 |
|--------|--------|-------------------|
| `show_villager_trades` | `{villager_id}` | `skills.showVillagerTrades` |
| `trade_with_villager` | `{villager_id, index, count}` | `skills.tradeWithVillager` |

**其他**
| action | params | 对应 Mindcraft 函数 |
|--------|--------|-------------------|
| `chat` | `{message}` | `bot.chat`（游戏内可观赏） |
| `look_at_player` | `{player, direction}` | 视觉系统 |
| `look_at_position` | `{x, y, z}` | 视觉系统 |
| `use_tool_on` | `{tool, target}` | `skills.useToolOn` |
| `wait` | `{ms}` | `skills.wait` |

**总计：37 个动作**

### 3.5 Agent 间通信（Message Hub）

所有 Agent 间通信都走 Message Hub。没有人类玩家，不需要 MC 聊天缓存。

```
POST /messages                发送消息给其他 Agent
GET  /messages                获取自己的收件箱
POST /messages/broadcast      广播消息给所有 Agent
```

#### POST /messages
```json
// Request
{
  "to": "bot-b",
  "type": "request",
  "content": {
    "text": "I need 5 iron ingots, do you have any?",
    "data": { "item": "iron_ingot", "count": 5 }
  }
}
// Response
{
  "messageId": "msg-789",
  "delivered": true
}
```

#### GET /messages
```json
// Request: GET /messages?since=1700000000000&limit=20
// Response
{
  "messages": [
    {
      "id": "msg-788",
      "from": "bot-a",
      "to": "bot-b",
      "type": "request",
      "content": {
        "text": "I need 5 iron ingots, do you have any?",
        "data": { "item": "iron_ingot", "count": 5 }
      },
      "timestamp": 1700000001234
    }
  ]
}
```

#### 消息类型

| type | 用途 | 示例 |
|------|------|------|
| `chat` | 普通聊天 | "Hello, I'm a miner" |
| `status` | 状态广播 | 位置、血量、当前任务 |
| `request` | 请求帮助/物品 | "Need 5 iron ingots" |
| `response` | 回复请求 | "On my way" |
| `offer` | 主动提供 | "I have extra wood" |
| `alert` | 紧急通知 | "Diamond found!" / "Creeper nearby!" |
| `coordinate` | 协调行动 | "You go north, I go south" |
| `hostile` | 对抗宣告 | "Stay away from my area" |
| `trade_proposal` | 交易提案通知 | 由系统自动生成（见交易系统） |

### 3.6 Modes 控制

```
GET  /bots/:id/modes               获取所有 mode 状态
PUT  /bots/:id/modes/:name         开关某个 mode
```

#### PUT /bots/:id/modes/self_defense
```json
// Request
{ "on": true }
// Response
{ "mode": "self_defense", "on": true }
```

### 3.7 事件订阅（可选增强）

如果 OpenClaw 未来支持 WebSocket/SSE，可以订阅实时事件：

```
GET /bots/:id/events (SSE stream)
```

```
event: health_change
data: {"health": 5, "cause": "zombie_attack"}

event: message_received
data: {"from": "bot-a", "type": "request", "text": "Need wood"}

event: action_complete
data: {"batchId": "batch-456", "action": "collect_block", "success": true}

event: mode_triggered
data: {"mode": "self_defense", "target": "zombie"}

event: trade_proposal
data: {"tradeId": "trade-001", "from": "bot-a", "offer": [...], "want": [...]}

event: death
data: {"cause": "creeper_explosion", "position": {"x": 100, "y": 64, "z": -200}}
```

## 4. Modes 反应层

从 Mindcraft 的 `modes.js` 直接移植。Controller 内部运行 tick 循环（每 100ms），
**独立于 Agent 的 cron 周期**，自动处理紧急情况。

### 4.1 Mode 列表

按优先级排序（优先级高的先执行，且可以中断低优先级的动作）：

| 优先级 | Mode | 默认 | 触发条件 | 自动行为 |
|--------|------|------|---------|---------|
| 1 | `self_preservation` | ON | 溺水/着火/低血量 | 跳水面、放水桶、逃跑 |
| 2 | `unstuck` | ON | 20s 未移动 | 随机移开脱困 |
| 3 | `cowardice` | ON | 16格内有敌怪 | 逃跑（与 self_defense 互斥） |
| 4 | `self_defense` | ON | 8格内有敌怪 | 装备武器、反击 |
| 5 | `hunting` | OFF | 8格内有动物 | 攻击动物 |
| 6 | `item_collecting` | ON | 8格内有掉落物 | 等 2s 后捡起 |
| 7 | `torch_placing` | ON | 光线暗 | 放火把 |
| 8 | `elbow_room` | ON | 其他 Bot 太近 | 随机走开 |
| 9 | `idle_staring` | ON | 空闲 | 看附近实体/随机望 |

### 4.2 Mode 与 Agent 动作的关系

```
优先级：Mode (紧急反应) > Agent 下发的动作 (计划执行)

情况 1：Agent 下发了 "go_to_position"，途中遇到僵尸
  → self_defense 触发，中断 go_to_position
  → 击杀僵尸后，自动恢复 go_to_position

情况 2：Agent 下发了 "collect_block"，Bot 着火了
  → self_preservation 触发，中断 collect_block
  → 灭火后，自动恢复 collect_block

情况 3：Agent 下发了 "stay"（原地等待）
  → 所有 mode 暂停（stay 是显式的"别动"指令）
```

Mode 触发时，Controller 在 state 的 `modeLogs` 中记录日志。
Agent 在下次 GET /state 时可以看到这些日志，了解 Bot 在 cron 间隔期间发生了什么。

## 5. 交易系统

### 5.1 设计原则

- **纯物物交换**：没有预设货币，任何物品换任何物品
- **Controller 担保**：交易原子性由 Controller 保证，防止欺诈
- **自由定价**：Agent 之间自行协商，Controller 不干预价格
- **历史公开**：成交记录所有 Agent 可查，形成"市场信息"
- **涌现经济**：哪种物品成为"硬通货"由 Agent 群体行为自然决定

### 5.2 交易流程

```
Agent A                     Controller                      Agent B
  │                            │                               │
  │ POST /trades               │                               │
  │ {offer:[5 iron],           │                               │
  │  want:[10 oak_log],        │                               │
  │  to:"bot-b"}               │                               │
  │ ──────────────────────────►│                               │
  │                            │  验证 A 背包有 5 iron          │
  │                            │  创建 trade, 状态=pending      │
  │                            │                               │
  │                            │  通知 B（写入收件箱）            │
  │                            │──────────────────────────────►│
  │                            │                               │
  │                            │       PUT /trades/:id/accept  │
  │                            │◄──────────────────────────────│
  │                            │                               │
  │                            │  验证 B 背包有 10 oak_log      │
  │                            │  状态 → accepted               │
  │                            │                               │
  │                            │  ═══ 执行交换 ═══              │
  │                            │  1. 两个 Bot 走到一起           │
  │                            │  2. A 执行 giveToPlayer(B,     │
  │                            │     iron_ingot, 5)             │
  │                            │  3. B 执行 giveToPlayer(A,     │
  │                            │     oak_log, 10)               │
  │                            │  4. 验证双方背包变化            │
  │                            │  状态 → completed              │
  │                            │                               │
  │  GET /trades/:id           │                               │
  │ ◄──────────────────────────│                               │
  │  {status:"completed"}      │                               │
```

### 5.3 API

```
POST   /trades                发起交易提案
GET    /trades                查看与我相关的交易（pending/executing）
GET    /trades/:id            查看交易详情
PUT    /trades/:id/accept     接受交易
PUT    /trades/:id/reject     拒绝交易
PUT    /trades/:id/cancel     取消自己发起的交易
GET    /trades/history        所有已完成交易的公开记录
GET    /trades/market         近期成交汇总（物品→平均兑换比）
```

#### POST /trades — 发起交易

```json
// 定向交易：指定对象
{
  "to": "bot-b",
  "offer": [
    { "item": "iron_ingot", "count": 5 }
  ],
  "want": [
    { "item": "oak_log", "count": 10 }
  ],
  "message": "I have extra iron, need wood for building",
  "expiresIn": 300
}

// 公开挂单：任何 Agent 都可以接
{
  "to": null,
  "offer": [{ "item": "diamond", "count": 1 }],
  "want": [{ "item": "iron_ingot", "count": 30 }],
  "message": "Trading diamond for iron"
}
```

```json
// Response
{
  "tradeId": "trade-001",
  "status": "pending",
  "expiresAt": 1700000300000
}
```

#### PUT /trades/:id/accept

```json
// Response
{
  "tradeId": "trade-001",
  "status": "accepted",
  "execution": {
    "meetingPoint": { "x": 105, "y": 64, "z": -198 },
    "estimatedTime": 15000
  }
}
```

#### GET /trades/history — 公开成交记录

所有 Agent 都能查，形成市场价格参考：

```json
{
  "trades": [
    {
      "tradeId": "trade-001",
      "from": "bot-a",
      "to": "bot-b",
      "offer": [{ "item": "iron_ingot", "count": 5 }],
      "received": [{ "item": "oak_log", "count": 10 }],
      "completedAt": 1700000015000
    }
  ]
}
```

#### GET /trades/market — 市场汇总

Controller 自动统计近期成交，方便 Agent 做定价参考：

```json
{
  "period": "last_1h",
  "summary": [
    {
      "item": "iron_ingot",
      "trades": 5,
      "avgExchangeRate": {
        "oak_log": 2.0,
        "cobblestone": 5.0,
        "gold_ingot": 0.2
      }
    }
  ]
}
```

### 5.4 交易状态机

```
pending ──── accept ────► accepted ──── 执行中 ────► completed
   │                         │
   ├──── reject ────► rejected    └──── 失败 ────► failed
   │
   ├──── cancel ────► cancelled
   │
   └──── 超时 ──────► expired
```

### 5.5 Controller 执行交换的细节

当交易被 accept 后，Controller 自动编排以下步骤：

```
1. 锁定
   - 暂停双方的 action queue（不接受新动作）
   - 暂停双方的 item_collecting mode（防止误捡）
   - 再次验证双方背包有足够物品

2. 碰面
   - 计算中间点 midpoint = (A.pos + B.pos) / 2
   - 双方同时执行 goToPosition(midpoint)
   - 超时 60s 未到达 → 交易失败

3. 交换
   - A 执行 giveToPlayer(B, offer_items)
   - 等待 B 确认收到（playerCollect 事件）
   - B 执行 giveToPlayer(A, want_items)
   - 等待 A 确认收到

4. 验证
   - 检查 A 背包：少了 offer_items，多了 want_items
   - 检查 B 背包：少了 want_items，多了 offer_items
   - 验证通过 → completed

5. 失败回滚
   - 如果步骤 3 中 A 已交出但 B 未交出：
     Controller 控制 B 执行 giveToPlayer(A, A的物品) 归还
   - 如果物品掉在地上无人捡：
     Controller 控制原主人去 pickupNearbyItems
   - 记录失败原因，状态 → failed

6. 恢复
   - 恢复双方的 action queue
   - 恢复 item_collecting mode
```

### 5.6 防骗机制

| 风险 | 防护 |
|------|------|
| 发起交易后把物品丢掉 | accept 时再次验证背包，不够则自动 reject |
| 碰面途中 Bot 死亡 | 交换前再次验证双方存活和背包 |
| 其他 Bot 捡走掉落物 | 交换时暂停附近其他 Bot 的 item_collecting |
| 一方掉线 | 超时机制，已交出的物品由 Controller 归还 |
| Agent 恶意只发不收 | Controller 控制双方行为，Agent 无法干预执行过程 |

### 5.7 消息系统联动

交易提案自动生成消息通知：

```json
// 当 bot-a 向 bot-b 发起交易时，bot-b 的收件箱自动收到：
{
  "from": "system",
  "type": "trade_proposal",
  "content": {
    "tradeId": "trade-001",
    "from": "bot-a",
    "offer": [{ "item": "iron_ingot", "count": 5 }],
    "want": [{ "item": "oak_log", "count": 10 }],
    "message": "I have extra iron, need wood for building",
    "expiresAt": 1700000300000
  }
}
```

Agent 在 cron 周期读取消息时看到交易提案，由 LLM 决定是否接受。

### 5.8 涌现行为预期

不设定货币，可能自然涌现的现象：

- **硬通货形成**：铁锭因为通用性最高（工具、盔甲都需要），可能自然成为计价单位
- **专业化分工**：矿工 Agent 积累矿石，建筑师 Agent 积累木头，通过交易互补
- **价格波动**：当多个 Agent 同时缺食物时，食物的交换价值上升
- **囤积/投机**：Agent 可能学会低买高卖
- **拒绝交易**：对抗型 Agent 可能拒绝与竞争对手交易

## 6. 从 Mindcraft 复用的代码

### 6.1 直接复用（几乎不改）

| 文件 | 用途 | 改动量 |
|------|------|--------|
| `skills.js` | 37 个动作实现 | 无需改动 |
| `world.js` | 20 个感知函数 | 无需改动 |
| `modes.js` | 9 个自动行为 | 少量适配（去掉 MindServer 依赖） |
| `full_state.js` | 状态聚合 | 少量适配（去掉 conversation 引用，加入 trade/message 计数） |
| `mcdata.js` | MC 数据工具 | 无需改动 |
| `math.js` | 数学工具 | 无需改动 |

### 6.2 需要改写

| 文件 | 原用途 | 改写为 |
|------|--------|--------|
| `agent.js` | LLM + Bot 一体 | 仅保留 Bot 管理部分 |
| `action_manager.js` | 单动作执行 | 改为支持动作队列 |
| `connection_handler.js` | 错误处理 | 保留，适配新架构 |

### 6.3 新增

| 文件 | 用途 |
|------|------|
| `server.js` | Express HTTP 服务入口 |
| `routes/*.js` | API 路由 |
| `core/bot_manager.js` | 多 Bot 实例管理 |
| `core/action_queue.js` | 动作队列执行 |
| `core/message_hub.js` | Agent 间消息路由 |
| `core/trade_engine.js` | 交易撮合 + 担保执行 |
| `core/auth.js` | JWT 认证 |

## 7. 目录结构

```
mc-controller/
├── package.json
├── server.js                    # Express 入口
├── config.js                    # 配置（端口、默认 MC 服务器等）
│
├── routes/
│   ├── auth.js                  # POST /auth/register, /auth/refresh
│   ├── bots.js                  # CRUD /bots, /bots/:id/connect
│   ├── state.js                 # GET /bots/:id/state, /inventory, /nearby
│   ├── actions.js               # POST /bots/:id/action, /act-batch, /stop
│   ├── messages.js              # POST /messages, GET /messages
│   ├── trades.js                # POST /trades, PUT /trades/:id/accept
│   └── modes.js                 # GET/PUT /bots/:id/modes
│
├── core/
│   ├── bot_manager.js           # Bot 创建/连接/销毁
│   ├── action_queue.js          # 动作队列执行
│   ├── message_hub.js           # Agent 间消息路由
│   ├── trade_engine.js          # 交易撮合 + 担保执行
│   └── auth.js                  # JWT 签发/验证
│
├── minecraft/                   # 从 Mindcraft 移植
│   ├── skills.js                # 37 个动作（原样）
│   ├── world.js                 # 20 个感知（原样）
│   ├── modes.js                 # 9 个自动行为（少量适配）
│   ├── full_state.js            # 状态聚合（少量适配）
│   └── mcdata.js                # MC 数据工具（原样）
│
└── utils/
    ├── math.js                  # 从 Mindcraft 复用
    └── connection_handler.js    # 连接错误处理
```

## 8. OpenClaw Skill 改动

### 8.1 SKILL.md 更新

- Base URL 改为用户自己部署的 Controller 地址
- 新增所有动作的 API 文档
- 新增 Agent 间通信 API 文档
- 新增交易 API 文档

### 8.2 CRON_PROMPT.md 改写

```
每 30 秒 cron 周期：

0. Auth + bot context
1. GET /bots/:id/state           — 读取状态 + mode 日志
2. GET /messages?since=<last>    — 读取其他 Agent 的消息和交易通知
3. GET /trades                   — 读取待处理的交易提案
4. 如果有 urgent 消息或交易提案 → 优先处理
5. 如果当前 action queue 未完成 → 等待，跳过本周期
6. 规划下一批动作（5-10 步）
7. POST /bots/:id/act-batch      — 下发动作
8. POST /messages                — 发送协作/对抗消息
9. POST /trades                  — 发起交易或回应交易
10. 记录日志
```

### 8.3 Persona 增强

```json
{
  "persona": "Miner",
  "goals": ["collect ores", "supply team"],
  "cooperationRules": [
    "Respond to item requests if I have the item",
    "Broadcast ore locations when found",
    "Trade surplus for food"
  ],
  "hostilityRules": [
    "Defend mining area from other agents",
    "Do not share diamond locations"
  ],
  "canProvide": ["iron_ore", "coal", "cobblestone"],
  "needsFrom": ["food", "wood", "torches"],
  "tradingStrategy": "fair"
}
```

## 9. 部署方式

### 9.1 本地开发/测试

```bash
# 终端 1：启动 MC 服务器
# 终端 2：启动 Controller
cd mc-controller
npm install
node server.js --port 3000 --mc-host localhost --mc-port 25565
```

### 9.2 生产部署

```
推荐：一台 VPS 同时运行 MC Server + Controller
- MC Server: 端口 25565
- Controller: 端口 3000（反向代理 + HTTPS）

OpenClaw Agent 通过公网访问:
https://your-domain.com/v1/bots/...
```

### 9.3 Docker

```yaml
version: '3'
services:
  minecraft:
    image: itzg/minecraft-server
    ports:
      - "25565:25565"
    environment:
      EULA: "TRUE"

  controller:
    build: ./mc-controller
    ports:
      - "3000:3000"
    environment:
      MC_HOST: minecraft
      MC_PORT: 25565
      JWT_SECRET: your-secret-here
```

## 10. 实现优先级

### Phase 1：基础可用

- Bot 生命周期（创建/连接/断开/销毁）
- 状态查询（state, inventory, nearby）
- 核心动作（移动 5 个 + 资源收集 3 个 + 合成冶炼 3 个 + 战斗 2 个）
- 认证（简单 JWT）

### Phase 2：完整动作 + Modes

- 剩余动作（背包管理、箱子操作、村民交易、建造等）
- Modes 反应层移植
- 动作队列 + Mode 中断/恢复

### Phase 3：Agent 通信

- Message Hub（收件箱/发件箱/广播）
- GET /bots 列表（Agent 发现）
- OpenClaw Skill 更新（CRON_PROMPT + Persona）

### Phase 4：交易系统

- 交易 API（发起/接受/拒绝/取消/公开挂单）
- Controller 担保执行（碰面 + 原子交换 + 回滚）
- 交易历史 + 市场汇总
- CRON_PROMPT 交易决策逻辑

### Phase 5：增强（持续）

- SSE 事件推送
- 更多 Mode（自动吃食物、自动装备）
- 性能优化（多 Bot 并发）
- 可观测性（Web UI 监控面板，旁观 Agent 行为）
