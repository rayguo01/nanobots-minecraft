# MC Controller 全量实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 构建完整的 Minecraft Bot Controller HTTP 服务，支持 Mindcraft 全部动作、Agent 间通信、交易系统。

**Architecture:** Express HTTP 服务包装 Mineflayer，管理多 Bot 实例。核心模块：BotManager（生命周期）、ActionQueue（动作队列+中断恢复）、MessageHub（Agent 通信）、TradeEngine（担保交易）、Modes（自动反应层）。所有 Agent 间通信走内存 Message Hub，不走 MC 聊天。

**Tech Stack:** Node.js ES Module, Express 4, Mineflayer 4, jsonwebtoken, uuid, vec3, mineflayer-pathfinder/pvp/collectblock/auto-eat/armor-manager

**Design Doc:** `docs/controller-design.md`

---

## Task 1: 项目脚手架 + 依赖

**Files:**
- Create: `mc-controller/package.json`
- Create: `mc-controller/server.js`
- Create: `mc-controller/config.js`

**Step 1: 创建目录和 package.json**

```json
{
  "name": "mc-controller",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "start": "node server.js",
    "dev": "node --watch server.js",
    "test": "node --test tests/**/*.test.js"
  },
  "dependencies": {
    "express": "^4.21.0",
    "jsonwebtoken": "^9.0.2",
    "uuid": "^10.0.0",
    "mineflayer": "^4.33.0",
    "minecraft-data": "^3.97.0",
    "prismarine-item": "^1.15.0",
    "mineflayer-pathfinder": "^2.4.5",
    "mineflayer-pvp": "^1.3.2",
    "mineflayer-collectblock": "^1.4.1",
    "mineflayer-auto-eat": "^3.3.6",
    "mineflayer-armor-manager": "^2.0.1",
    "vec3": "^0.1.10"
  }
}
```

**Step 2: 创建 config.js**

```javascript
const config = {
  port: parseInt(process.env.PORT || '3000'),
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-in-production',
  jwtExpiresIn: '24h',
  mc: {
    host: process.env.MC_HOST || 'localhost',
    port: parseInt(process.env.MC_PORT || '25565'),
    version: process.env.MC_VERSION || undefined, // auto-detect
    auth: process.env.MC_AUTH || 'offline',
  },
  modes: {
    tickInterval: 100, // ms between mode ticks
  },
  trade: {
    meetingTimeout: 60000, // 60s to meet
    defaultExpiry: 300,    // 5min trade expiry
  },
  messages: {
    maxPerInbox: 200,
  },
};

export default config;
```

**Step 3: 创建 server.js 骨架**

```javascript
import express from 'express';
import config from './config.js';

const app = express();
app.use(express.json());

// Health check
app.get('/v1/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

app.listen(config.port, () => {
  console.log(`MC Controller running on port ${config.port}`);
});

export default app;
```

**Step 4: 安装依赖**

Run: `cd mc-controller && npm install`

**Step 5: 验证启动**

Run: `cd mc-controller && node server.js &` then `curl http://localhost:3000/v1/health`
Expected: `{"status":"ok","uptime":...}`

**Step 6: Commit**

```bash
git add mc-controller/
git commit -m "feat: scaffold mc-controller project with dependencies"
```

---

## Task 2: JWT 认证模块

**Files:**
- Create: `mc-controller/core/auth.js`
- Create: `mc-controller/routes/auth.js`
- Create: `mc-controller/middleware/authenticate.js`

**Step 1: 创建 auth.js 核心模块**

```javascript
// core/auth.js
import jwt from 'jsonwebtoken';
import config from '../config.js';

const registeredAgents = new Map(); // agentId -> { registeredAt }

export function registerAgent(agentId) {
  if (registeredAgents.has(agentId)) {
    return { token: generateToken(agentId), existing: true };
  }
  registeredAgents.set(agentId, { registeredAt: Date.now() });
  return { token: generateToken(agentId), existing: false };
}

export function generateToken(agentId) {
  return jwt.sign({ agentId }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
}

export function verifyToken(token) {
  return jwt.verify(token, config.jwtSecret);
}

export function getRegisteredAgents() {
  return [...registeredAgents.keys()];
}
```

**Step 2: 创建 authenticate 中间件**

```javascript
// middleware/authenticate.js
import { verifyToken } from '../core/auth.js';

export function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }
  try {
    const payload = verifyToken(header.slice(7));
    req.agentId = payload.agentId;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}
```

**Step 3: 创建 auth 路由**

```javascript
// routes/auth.js
import { Router } from 'express';
import { registerAgent, generateToken } from '../core/auth.js';

const router = Router();

router.post('/register', (req, res) => {
  const { agentId } = req.body;
  if (!agentId || typeof agentId !== 'string') {
    return res.status(400).json({ error: 'agentId is required' });
  }
  const result = registerAgent(agentId);
  res.json({ agentId, token: result.token, existing: result.existing });
});

router.post('/refresh', (req, res) => {
  // authenticate middleware already decoded
  const token = generateToken(req.agentId);
  res.json({ token });
});

export default router;
```

**Step 4: 注册到 server.js**

在 server.js 中添加:
```javascript
import authRouter from './routes/auth.js';
import { authenticate } from './middleware/authenticate.js';

app.use('/v1/auth', authRouter);
// All routes after this require auth
app.use('/v1', authenticate);
```

**Step 5: Commit**

```bash
git add mc-controller/core/auth.js mc-controller/middleware/authenticate.js mc-controller/routes/auth.js mc-controller/server.js
git commit -m "feat: add JWT authentication (register, refresh, middleware)"
```

---

## Task 3: 移植 Minecraft 工具层

**Files:**
- Create: `mc-controller/minecraft/mcdata.js` (从 `src/utils/mcdata.js` 适配)
- Create: `mc-controller/minecraft/world.js` (从 `src/agent/library/world.js` 适配)
- Create: `mc-controller/minecraft/skills.js` (从 `src/agent/library/skills.js` 适配)
- Create: `mc-controller/utils/math.js` (从 `src/utils/math.js` 复制)

**关键改动点：**

mcdata.js 改动：
- 移除对 `settings.js` 的依赖，改为接收参数
- `initBot(username, options)` 接收 host/port/version 参数
- 移除 MindServer/profile 相关代码

world.js 改动：
- 导入路径改为 `../minecraft/mcdata.js`
- 几乎不需要改动，函数都是纯查询

skills.js 改动：
- 导入路径改为 `../minecraft/mcdata.js` 和 `./world.js`
- 移除对 `settings.js` 的 block_place_delay 引用（改为 config 或默认值）
- 移除对 `agent.bot` 的引用，直接使用 `bot` 参数（大部分函数已经是这样）

math.js: 直接复制

**Step 1: 复制并适配 mcdata.js**

从 `src/utils/mcdata.js` 复制，做以下修改：
- 移除 `import settings from '../agent/settings.js'`
- `initBot(username, options)` 函数签名改为接收 `{ host, port, version, auth }` 参数
- 在 `mineflayer.createBot()` 调用中使用传入的 options 而非 settings

**Step 2: 复制并适配 world.js**

从 `src/agent/library/world.js` 复制，修改导入路径：
```javascript
// 原: import * as mc from '../../utils/mcdata.js';
// 改: import * as mc from './mcdata.js';
```

**Step 3: 复制并适配 skills.js**

从 `src/agent/library/skills.js` 复制，修改导入路径：
```javascript
// 原:
// import * as mc from '../../utils/mcdata.js';
// import * as world from './world.js';
// import settings from '../settings.js';
// 改:
// import * as mc from './mcdata.js';
// import * as world from './world.js';
// import config from '../config.js';
```
替换 `settings.block_place_delay` → `config.blockPlaceDelay || 0`

**Step 4: 复制 math.js**

直接复制 `src/utils/math.js` → `mc-controller/utils/math.js`

**Step 5: Commit**

```bash
git add mc-controller/minecraft/ mc-controller/utils/
git commit -m "feat: port mcdata, world, skills from Mindcraft"
```

---

## Task 4: BotManager — Bot 生命周期管理

**Files:**
- Create: `mc-controller/core/bot_manager.js`
- Create: `mc-controller/routes/bots.js`

**Step 1: 创建 BotManager**

```javascript
// core/bot_manager.js
import * as mc from '../minecraft/mcdata.js';
import config from '../config.js';
import { EventEmitter } from 'events';

class BotManager extends EventEmitter {
  constructor() {
    super();
    this.bots = new Map(); // botId -> { bot, agentId, status, connectedAt }
  }

  createBot(botId, agentId, username) {
    if (this.bots.has(botId)) throw new Error(`Bot ${botId} already exists`);
    this.bots.set(botId, { bot: null, agentId, username: username || botId, status: 'created', connectedAt: null });
    return { botId, status: 'created' };
  }

  async connectBot(botId, options = {}) {
    const entry = this.bots.get(botId);
    if (!entry) throw new Error(`Bot ${botId} not found`);
    if (entry.bot) throw new Error(`Bot ${botId} already connected`);

    const host = options.host || config.mc.host;
    const port = options.port || config.mc.port;
    const version = options.version || config.mc.version;
    const auth = config.mc.auth;

    const bot = mc.initBot(entry.username, { host, port, version, auth });

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        bot.end();
        reject(new Error('Connection timeout'));
      }, 30000);

      bot.once('spawn', () => {
        clearTimeout(timeout);
        entry.bot = bot;
        entry.status = 'connected';
        entry.connectedAt = Date.now();
        // Initialize bot properties used by skills
        bot.output = '';
        bot.interrupt_code = false;
        this.emit('bot-connected', botId);
        resolve({
          status: 'connected',
          position: bot.entity?.position ? {
            x: Math.round(bot.entity.position.x),
            y: Math.round(bot.entity.position.y),
            z: Math.round(bot.entity.position.z)
          } : null
        });
      });

      bot.once('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      bot.once('kicked', (reason) => {
        clearTimeout(timeout);
        entry.status = 'kicked';
        reject(new Error(`Kicked: ${reason}`));
      });
    });
  }

  disconnectBot(botId) {
    const entry = this.bots.get(botId);
    if (!entry) throw new Error(`Bot ${botId} not found`);
    if (entry.bot) {
      entry.bot.end();
      entry.bot = null;
    }
    entry.status = 'disconnected';
    return { status: 'disconnected' };
  }

  destroyBot(botId) {
    this.disconnectBot(botId);
    this.bots.delete(botId);
    return { status: 'destroyed' };
  }

  getBot(botId) {
    const entry = this.bots.get(botId);
    if (!entry) return null;
    return entry;
  }

  getBotOrThrow(botId) {
    const entry = this.getBot(botId);
    if (!entry) throw new Error(`Bot ${botId} not found`);
    if (!entry.bot) throw new Error(`Bot ${botId} not connected`);
    return entry;
  }

  listBots() {
    const result = [];
    for (const [botId, entry] of this.bots) {
      result.push({
        botId,
        agentId: entry.agentId,
        online: entry.status === 'connected' && entry.bot !== null,
        status: entry.status,
        position: entry.bot?.entity?.position ? {
          x: Math.round(entry.bot.entity.position.x),
          y: Math.round(entry.bot.entity.position.y),
          z: Math.round(entry.bot.entity.position.z)
        } : null
      });
    }
    return result;
  }

  // Check if agentId owns botId
  isOwner(agentId, botId) {
    const entry = this.bots.get(botId);
    return entry && entry.agentId === agentId;
  }
}

// Singleton
const botManager = new BotManager();
export default botManager;
```

**Step 2: 创建 bots 路由**

```javascript
// routes/bots.js
import { Router } from 'express';
import botManager from '../core/bot_manager.js';

const router = Router();

// Middleware: check bot ownership
function requireOwnership(req, res, next) {
  const { id } = req.params;
  if (!botManager.isOwner(req.agentId, id)) {
    return res.status(403).json({ error: 'Not your bot' });
  }
  next();
}

router.post('/', (req, res) => {
  try {
    const { botId, username } = req.body;
    if (!botId) return res.status(400).json({ error: 'botId required' });
    const result = botManager.createBot(botId, req.agentId, username);
    res.status(201).json(result);
  } catch (err) {
    res.status(409).json({ error: err.message });
  }
});

router.post('/:id/connect', requireOwnership, async (req, res) => {
  try {
    const { host, port, version } = req.body || {};
    const result = await botManager.connectBot(req.params.id, { host, port, version });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/disconnect', requireOwnership, (req, res) => {
  try {
    const result = botManager.disconnectBot(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

router.delete('/:id', requireOwnership, (req, res) => {
  try {
    const result = botManager.destroyBot(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

router.get('/', (req, res) => {
  res.json({ bots: botManager.listBots() });
});

export default router;
```

**Step 3: 注册到 server.js**

```javascript
import botsRouter from './routes/bots.js';
app.use('/v1/bots', botsRouter);
```

**Step 4: Commit**

```bash
git add mc-controller/core/bot_manager.js mc-controller/routes/bots.js mc-controller/server.js
git commit -m "feat: add BotManager with lifecycle (create/connect/disconnect/destroy)"
```

---

## Task 5: 状态查询路由

**Files:**
- Create: `mc-controller/minecraft/full_state.js` (从 Mindcraft 适配)
- Create: `mc-controller/routes/state.js`

**Step 1: 移植并适配 full_state.js**

```javascript
// minecraft/full_state.js
import * as world from './world.js';
import botManager from '../core/bot_manager.js';

export function getFullState(botId) {
  const entry = botManager.getBotOrThrow(botId);
  const bot = entry.bot;

  const pos = bot.entity?.position;
  const timeOfDay = bot.time?.timeOfDay;
  let timeLabel = 'Morning';
  if (timeOfDay >= 6000 && timeOfDay < 12000) timeLabel = 'Afternoon';
  else if (timeOfDay >= 12000) timeLabel = 'Night';

  // Weather
  let weather = 'Clear';
  if (bot.thunderState > 0) weather = 'Thunderstorm';
  else if (bot.rainState > 0) weather = 'Rain';

  // Inventory
  const counts = world.getInventoryCounts(bot);
  const stacks = world.getInventoryStacks(bot);
  const equipment = {
    helmet: bot.inventory.slots[5]?.name || null,
    chestplate: bot.inventory.slots[6]?.name || null,
    leggings: bot.inventory.slots[7]?.name || null,
    boots: bot.inventory.slots[8]?.name || null,
    mainHand: bot.heldItem?.name || null,
  };

  // Nearby bots
  const nearbyPlayers = world.getNearbyPlayers(bot, 64);
  const nearbyBots = nearbyPlayers.map(p => ({
    name: p.username,
    distance: Math.round(p.entity?.position?.distanceTo(pos) * 10) / 10,
    position: p.entity?.position ? {
      x: Math.round(p.entity.position.x),
      y: Math.round(p.entity.position.y),
      z: Math.round(p.entity.position.z)
    } : null
  }));

  // Nearby entities (exclude players and items)
  const entityTypes = world.getNearbyEntityTypes(bot);

  // Nearby blocks
  const blockTypes = world.getNearbyBlockTypes(bot, 16);

  // Surroundings
  const surroundings = world.getSurroundingBlocks(bot);

  // Modes
  const modes = bot.modes ? bot.modes.getJson() : {};
  const modeLogs = bot.modes ? bot.modes.flushBehaviorLog() : [];

  return {
    botId,
    position: pos ? { x: Math.round(pos.x * 10) / 10, y: Math.round(pos.y * 10) / 10, z: Math.round(pos.z * 10) / 10 } : null,
    health: bot.health,
    food: bot.food,
    dimension: bot.game?.dimension || 'overworld',
    gameMode: bot.game?.gameMode || 'survival',
    biome: world.getBiomeName(bot),
    weather,
    timeOfDay: timeOfDay || 0,
    timeLabel,
    surroundings: {
      below: surroundings[0] || 'unknown',
      legs: surroundings[1] || 'air',
      head: surroundings[2] || 'air',
      firstBlockAboveHead: world.getFirstBlockAboveHead(bot) || 'air',
    },
    inventory: {
      counts,
      stacksUsed: stacks.length,
      totalSlots: 36,
      equipment,
    },
    nearby: {
      bots: nearbyBots,
      entities: entityTypes,
      blocks: blockTypes.slice(0, 20),
    },
    modes,
    modeLogs,
    currentTask: null, // filled by action queue
    actionQueue: { length: 0, actions: [] }, // filled by action queue
    pendingTrades: 0, // filled by trade engine
    unreadMessages: 0, // filled by message hub
  };
}
```

**Step 2: 创建 state 路由**

```javascript
// routes/state.js
import { Router } from 'express';
import botManager from '../core/bot_manager.js';
import { getFullState } from '../minecraft/full_state.js';
import * as world from '../minecraft/world.js';

const router = Router();

function requireOwnership(req, res, next) {
  if (!botManager.isOwner(req.agentId, req.params.id)) {
    return res.status(403).json({ error: 'Not your bot' });
  }
  next();
}

function requireConnected(req, res, next) {
  try {
    botManager.getBotOrThrow(req.params.id);
    next();
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

router.get('/:id/state', requireOwnership, requireConnected, (req, res) => {
  try {
    const state = getFullState(req.params.id);
    res.json(state);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/inventory', requireOwnership, requireConnected, (req, res) => {
  const { bot } = botManager.getBotOrThrow(req.params.id);
  res.json({
    counts: world.getInventoryCounts(bot),
    stacks: world.getInventoryStacks(bot).map(i => ({ name: i.name, count: i.count })),
  });
});

router.get('/:id/nearby', requireOwnership, requireConnected, (req, res) => {
  const { bot } = botManager.getBotOrThrow(req.params.id);
  const distance = parseInt(req.query.distance) || 16;
  res.json({
    blocks: world.getNearbyBlockTypes(bot, distance),
    entities: world.getNearbyEntityTypes(bot),
    players: world.getNearbyPlayerNames(bot),
  });
});

router.get('/:id/craftable', requireOwnership, requireConnected, (req, res) => {
  const { bot } = botManager.getBotOrThrow(req.params.id);
  res.json({ items: world.getCraftableItems(bot) });
});

router.get('/:id/position', requireOwnership, requireConnected, (req, res) => {
  const { bot } = botManager.getBotOrThrow(req.params.id);
  const pos = world.getPosition(bot);
  res.json({ position: pos ? { x: pos.x, y: pos.y, z: pos.z } : null });
});

export default router;
```

**Step 3: 注册到 server.js**

```javascript
import stateRouter from './routes/state.js';
app.use('/v1/bots', stateRouter);
```

**Step 4: Commit**

```bash
git add mc-controller/minecraft/full_state.js mc-controller/routes/state.js mc-controller/server.js
git commit -m "feat: add state queries (full state, inventory, nearby, craftable, position)"
```

---

## Task 6: ActionQueue — 动作队列执行引擎

**Files:**
- Create: `mc-controller/core/action_queue.js`

**Step 1: 创建 ActionQueue**

```javascript
// core/action_queue.js
import * as skills from '../minecraft/skills.js';
import { v4 as uuid } from 'uuid';

// Map action names to skill functions
const ACTION_MAP = {
  // Movement
  go_to_position: (bot, p) => skills.goToPosition(bot, p.x, p.y, p.z, p.closeness || 2),
  go_to_player: (bot, p) => skills.goToPlayer(bot, p.player, p.closeness || 3),
  follow_player: (bot, p) => skills.followPlayer(bot, p.player, p.distance || 4),
  go_to_nearest_block: (bot, p) => skills.goToNearestBlock(bot, p.type, p.distance || 2, p.range || 64),
  go_to_nearest_entity: (bot, p) => skills.goToNearestEntity(bot, p.type, p.distance || 2, p.range || 64),
  move_away: (bot, p) => skills.moveAway(bot, p.distance),
  go_to_bed: (bot) => skills.goToBed(bot),
  go_to_surface: (bot) => skills.goToSurface(bot),
  dig_down: (bot, p) => skills.digDown(bot, p.distance || 10),
  stay: (bot, p) => skills.stay(bot, p.seconds || 30),
  // Resource
  collect_block: (bot, p) => skills.collectBlock(bot, p.type, p.count || 1),
  break_block_at: (bot, p) => skills.breakBlockAt(bot, p.x, p.y, p.z),
  pickup_items: (bot) => skills.pickupNearbyItems(bot),
  // Craft/Smelt
  craft_recipe: (bot, p) => skills.craftRecipe(bot, p.item, p.count || 1),
  smelt_item: (bot, p) => skills.smeltItem(bot, p.item, p.count || 1),
  clear_furnace: (bot) => skills.clearNearestFurnace(bot),
  // Build/Place
  place_block: (bot, p) => skills.placeBlock(bot, p.type, p.x, p.y, p.z, p.placeOn || 'bottom'),
  till_and_sow: (bot, p) => skills.tillAndSow(bot, p.x, p.y, p.z, p.seedType),
  use_door: (bot, p) => skills.useDoor(bot, p.x != null ? { x: p.x, y: p.y, z: p.z } : null),
  activate_block: (bot, p) => skills.activateNearestBlock(bot, p.type),
  // Combat
  attack_nearest: (bot, p) => skills.attackNearest(bot, p.type, p.kill !== false),
  attack_entity: (bot, p) => skills.attackEntity(bot, p.entityId, p.kill !== false),
  defend_self: (bot, p) => skills.defendSelf(bot, p.range || 9),
  avoid_enemies: (bot, p) => skills.avoidEnemies(bot, p.distance || 16),
  // Inventory
  equip: (bot, p) => skills.equip(bot, p.item),
  discard: (bot, p) => skills.discard(bot, p.item, p.count || -1),
  consume: (bot, p) => skills.consume(bot, p.item),
  give_to_player: (bot, p) => skills.giveToPlayer(bot, p.item, p.player, p.count || 1),
  // Chest
  put_in_chest: (bot, p) => skills.putInChest(bot, p.item, p.count || -1),
  take_from_chest: (bot, p) => skills.takeFromChest(bot, p.item, p.count || -1),
  view_chest: (bot) => skills.viewChest(bot),
  // Villager
  show_villager_trades: (bot, p) => skills.showVillagerTrades(bot, p.villager_id),
  trade_with_villager: (bot, p) => skills.tradeWithVillager(bot, p.villager_id, p.index, p.count),
  // Other
  chat: (bot, p) => { bot.chat(p.message); return true; },
  use_tool_on: (bot, p) => skills.useToolOn(bot, p.tool, p.target),
  wait: (bot, p) => skills.wait(bot, p.ms || 1000),
};

class ActionQueue {
  constructor(botId, getBot) {
    this.botId = botId;
    this.getBot = getBot; // function that returns bot instance
    this.queue = []; // [{id, action, params, status}]
    this.current = null;
    this.executing = false;
    this.interrupted = false;
    this.batchId = null;
  }

  getActionNames() {
    return Object.keys(ACTION_MAP);
  }

  async executeOne(action, params = {}) {
    const fn = ACTION_MAP[action];
    if (!fn) throw new Error(`Unknown action: ${action}`);

    const bot = this.getBot();
    if (!bot) throw new Error('Bot not connected');

    // Interrupt current if running
    if (this.executing) {
      await this.stop();
    }

    const taskId = uuid();
    this.current = { id: taskId, action, params, status: 'running', startedAt: Date.now() };
    this.executing = true;
    bot.interrupt_code = false;

    try {
      const result = await fn(bot, params);
      this.current.status = 'completed';
      const output = bot.output || '';
      bot.output = '';
      return { success: true, message: output || `${action} completed`, taskId, duration_ms: Date.now() - this.current.startedAt };
    } catch (err) {
      this.current.status = 'failed';
      bot.output = '';
      return { success: false, message: err.message, taskId, duration_ms: Date.now() - this.current.startedAt };
    } finally {
      this.executing = false;
      this.current = null;
    }
  }

  async executeBatch(actions) {
    const batchId = uuid();
    this.batchId = batchId;
    this.queue = actions.map((a, i) => ({
      id: `${batchId}-${i}`,
      action: a.action,
      params: a.params || {},
      status: 'pending',
    }));

    // Start processing in background
    this._processBatch(batchId);

    return { batchId, queued: actions.length, status: 'running' };
  }

  async _processBatch(batchId) {
    while (this.queue.length > 0 && this.batchId === batchId) {
      if (this.interrupted) {
        // Mode interrupted us, wait and retry
        await new Promise(r => setTimeout(r, 500));
        if (this.interrupted) continue;
      }

      const task = this.queue[0];
      task.status = 'running';
      this.current = task;
      this.executing = true;

      const bot = this.getBot();
      if (!bot) break;
      bot.interrupt_code = false;

      try {
        const fn = ACTION_MAP[task.action];
        if (!fn) throw new Error(`Unknown action: ${task.action}`);
        await fn(bot, task.params);
        task.status = 'completed';
      } catch (err) {
        task.status = 'failed';
        task.error = err.message;
      } finally {
        bot.output = '';
        this.executing = false;
        this.current = null;
        this.queue.shift();
      }
    }
    this.batchId = null;
  }

  async stop() {
    const bot = this.getBot();
    if (bot) {
      bot.interrupt_code = true;
      bot.pathfinder?.stop();
      bot.pvp?.stop();
    }
    this.queue = [];
    this.batchId = null;
    this.executing = false;
    // Give time for current action to notice interrupt
    await new Promise(r => setTimeout(r, 300));
  }

  // Called by modes when they need to interrupt
  interruptForMode() {
    this.interrupted = true;
    const bot = this.getBot();
    if (bot) bot.interrupt_code = true;
  }

  resumeAfterMode() {
    this.interrupted = false;
    const bot = this.getBot();
    if (bot) bot.interrupt_code = false;
  }

  getStatus() {
    return {
      executing: this.executing,
      current: this.current ? { id: this.current.id, action: this.current.action, status: this.current.status } : null,
      queueLength: this.queue.length,
      actions: this.queue.map(t => `${t.action}(${JSON.stringify(t.params)})`).slice(0, 10),
    };
  }
}

// Registry: botId -> ActionQueue
const queues = new Map();

export function getOrCreateQueue(botId, getBot) {
  if (!queues.has(botId)) {
    queues.set(botId, new ActionQueue(botId, getBot));
  }
  return queues.get(botId);
}

export function getQueue(botId) {
  return queues.get(botId);
}

export function removeQueue(botId) {
  queues.delete(botId);
}

export { ACTION_MAP };
```

**Step 2: Commit**

```bash
git add mc-controller/core/action_queue.js
git commit -m "feat: add ActionQueue with 37 actions, batch execution, mode interruption"
```

---

## Task 7: Actions 路由

**Files:**
- Create: `mc-controller/routes/actions.js`

**Step 1: 创建 actions 路由**

```javascript
// routes/actions.js
import { Router } from 'express';
import botManager from '../core/bot_manager.js';
import { getOrCreateQueue, ACTION_MAP } from '../core/action_queue.js';

const router = Router();

function requireOwnership(req, res, next) {
  if (!botManager.isOwner(req.agentId, req.params.id)) {
    return res.status(403).json({ error: 'Not your bot' });
  }
  next();
}

function requireConnected(req, res, next) {
  try {
    botManager.getBotOrThrow(req.params.id);
    next();
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

router.post('/:id/action', requireOwnership, requireConnected, async (req, res) => {
  const { action, params } = req.body;
  if (!action) return res.status(400).json({ error: 'action required' });
  if (!ACTION_MAP[action]) return res.status(400).json({ error: `Unknown action: ${action}`, available: Object.keys(ACTION_MAP) });

  const entry = botManager.getBotOrThrow(req.params.id);
  const queue = getOrCreateQueue(req.params.id, () => entry.bot);

  try {
    const result = await queue.executeOne(action, params || {});
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/act-batch', requireOwnership, requireConnected, (req, res) => {
  const { actions } = req.body;
  if (!Array.isArray(actions) || actions.length === 0) {
    return res.status(400).json({ error: 'actions array required' });
  }

  // Validate all actions
  for (const a of actions) {
    if (!ACTION_MAP[a.action]) {
      return res.status(400).json({ error: `Unknown action: ${a.action}` });
    }
  }

  const entry = botManager.getBotOrThrow(req.params.id);
  const queue = getOrCreateQueue(req.params.id, () => entry.bot);
  const result = queue.executeBatch(actions);
  res.json(result);
});

router.post('/:id/stop', requireOwnership, requireConnected, async (req, res) => {
  const entry = botManager.getBotOrThrow(req.params.id);
  const queue = getOrCreateQueue(req.params.id, () => entry.bot);
  await queue.stop();
  res.json({ status: 'stopped' });
});

router.get('/:id/actions', (req, res) => {
  res.json({ actions: Object.keys(ACTION_MAP) });
});

export default router;
```

**Step 2: 注册到 server.js**

```javascript
import actionsRouter from './routes/actions.js';
app.use('/v1/bots', actionsRouter);
```

**Step 3: Commit**

```bash
git add mc-controller/routes/actions.js mc-controller/server.js
git commit -m "feat: add action routes (single, batch, stop, list)"
```

---

## Task 8: Modes 反应层

**Files:**
- Create: `mc-controller/minecraft/modes.js` (从 Mindcraft 适配)
- Create: `mc-controller/routes/modes.js`

**Step 1: 移植并适配 modes.js**

从 `src/agent/modes.js` 复制，做以下修改：
- 移除 `import { handleMessage } from './conversation.js'` — modes 不需要发消息
- 移除 MindServer 相关代码
- `execute(mode, agent, func)` 改为 `execute(mode, bot, func)` — 直接操作 bot
- 在 `ModeController.update()` 中，不使用 agent 对象，改用注入的 bot + actionQueue
- 添加 `initModes(bot, actionQueue)` 初始化函数
- behavior_log 改为数组格式（带时间戳）

关键适配：
```javascript
// 原: agent.bot → bot
// 原: agent.actions → actionQueue
// 原: agent.prompter.handleMessage → 移除（不需要 LLM 参与 mode 决策）
// behavior_log: 从字符串改为 [{time, mode, detail}] 数组
```

**Step 2: 创建 modes 路由**

```javascript
// routes/modes.js
import { Router } from 'express';
import botManager from '../core/bot_manager.js';

const router = Router();

function requireOwnership(req, res, next) {
  if (!botManager.isOwner(req.agentId, req.params.id)) {
    return res.status(403).json({ error: 'Not your bot' });
  }
  next();
}

function requireConnected(req, res, next) {
  try {
    botManager.getBotOrThrow(req.params.id);
    next();
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

router.get('/:id/modes', requireOwnership, requireConnected, (req, res) => {
  const { bot } = botManager.getBotOrThrow(req.params.id);
  if (!bot.modes) return res.json({ modes: {} });
  res.json({ modes: bot.modes.getJson() });
});

router.put('/:id/modes/:name', requireOwnership, requireConnected, (req, res) => {
  const { bot } = botManager.getBotOrThrow(req.params.id);
  const { name } = req.params;
  const { on } = req.body;

  if (!bot.modes) return res.status(400).json({ error: 'Modes not initialized' });
  if (!bot.modes.exists(name)) return res.status(404).json({ error: `Mode ${name} not found` });

  bot.modes.setOn(name, !!on);
  res.json({ mode: name, on: bot.modes.isOn(name) });
});

export default router;
```

**Step 3: 在 BotManager 连接时初始化 modes**

在 bot_manager.js 的 `connectBot` 中 spawn 后添加：
```javascript
import { initModes } from '../minecraft/modes.js';
import { getOrCreateQueue } from './action_queue.js';

// 在 bot.once('spawn') 回调中:
const actionQueue = getOrCreateQueue(botId, () => entry.bot);
initModes(bot, actionQueue);
```

**Step 4: 注册到 server.js**

```javascript
import modesRouter from './routes/modes.js';
app.use('/v1/bots', modesRouter);
```

**Step 5: Commit**

```bash
git add mc-controller/minecraft/modes.js mc-controller/routes/modes.js mc-controller/core/bot_manager.js mc-controller/server.js
git commit -m "feat: add Modes reactive layer (9 modes, tick loop, mode routes)"
```

---

## Task 9: Message Hub — Agent 间通信

**Files:**
- Create: `mc-controller/core/message_hub.js`
- Create: `mc-controller/routes/messages.js`

**Step 1: 创建 MessageHub**

```javascript
// core/message_hub.js
import { v4 as uuid } from 'uuid';
import config from '../config.js';

class MessageHub {
  constructor() {
    this.inboxes = new Map(); // botId -> [{id, from, to, type, content, timestamp}]
  }

  ensureInbox(botId) {
    if (!this.inboxes.has(botId)) {
      this.inboxes.set(botId, []);
    }
  }

  send(from, to, type, content) {
    this.ensureInbox(to);
    const msg = {
      id: uuid(),
      from,
      to,
      type: type || 'chat',
      content,
      timestamp: Date.now(),
    };
    const inbox = this.inboxes.get(to);
    inbox.push(msg);
    // Trim if too large
    if (inbox.length > config.messages.maxPerInbox) {
      inbox.splice(0, inbox.length - config.messages.maxPerInbox);
    }
    return { messageId: msg.id, delivered: true };
  }

  broadcast(from, type, content, allBotIds) {
    const results = [];
    for (const botId of allBotIds) {
      if (botId !== from) {
        results.push(this.send(from, botId, type, content));
      }
    }
    return { sent: results.length, messageIds: results.map(r => r.messageId) };
  }

  getMessages(botId, since = 0, limit = 50) {
    this.ensureInbox(botId);
    const inbox = this.inboxes.get(botId);
    const filtered = since > 0 ? inbox.filter(m => m.timestamp > since) : inbox;
    return filtered.slice(-limit);
  }

  getUnreadCount(botId) {
    this.ensureInbox(botId);
    return this.inboxes.get(botId).length;
  }

  clearMessages(botId, beforeTimestamp) {
    if (!this.inboxes.has(botId)) return;
    if (beforeTimestamp) {
      const inbox = this.inboxes.get(botId);
      const idx = inbox.findIndex(m => m.timestamp > beforeTimestamp);
      if (idx > 0) inbox.splice(0, idx);
      else if (idx === -1) inbox.length = 0;
    } else {
      this.inboxes.set(botId, []);
    }
  }

  // System message (e.g., trade notifications)
  systemMessage(to, type, content) {
    return this.send('system', to, type, content);
  }
}

const messageHub = new MessageHub();
export default messageHub;
```

**Step 2: 创建 messages 路由**

```javascript
// routes/messages.js
import { Router } from 'express';
import messageHub from '../core/message_hub.js';
import botManager from '../core/bot_manager.js';

const router = Router();

// Send a message to another agent's bot
router.post('/', (req, res) => {
  const { to, type, content } = req.body;
  if (!to || !content) {
    return res.status(400).json({ error: 'to and content required' });
  }
  // Find sender's botId
  const senderBot = findBotByAgent(req.agentId);
  if (!senderBot) return res.status(400).json({ error: 'You have no active bot' });

  const result = messageHub.send(senderBot, to, type, content);
  res.json(result);
});

// Get my messages
router.get('/', (req, res) => {
  const botId = findBotByAgent(req.agentId);
  if (!botId) return res.status(400).json({ error: 'You have no active bot' });

  const since = parseInt(req.query.since) || 0;
  const limit = parseInt(req.query.limit) || 50;
  const messages = messageHub.getMessages(botId, since, limit);
  res.json({ messages });
});

// Broadcast to all
router.post('/broadcast', (req, res) => {
  const { type, content } = req.body;
  if (!content) return res.status(400).json({ error: 'content required' });

  const senderBot = findBotByAgent(req.agentId);
  if (!senderBot) return res.status(400).json({ error: 'You have no active bot' });

  const allBotIds = botManager.listBots().filter(b => b.online).map(b => b.botId);
  const result = messageHub.broadcast(senderBot, type, content, allBotIds);
  res.json(result);
});

// Clear read messages
router.delete('/', (req, res) => {
  const botId = findBotByAgent(req.agentId);
  if (!botId) return res.status(400).json({ error: 'You have no active bot' });

  const before = parseInt(req.query.before) || undefined;
  messageHub.clearMessages(botId, before);
  res.json({ status: 'cleared' });
});

function findBotByAgent(agentId) {
  const bots = botManager.listBots();
  const myBot = bots.find(b => b.agentId === agentId && b.online);
  return myBot ? myBot.botId : null;
}

export default router;
```

**Step 3: 注册到 server.js**

```javascript
import messagesRouter from './routes/messages.js';
app.use('/v1/messages', messagesRouter);
```

**Step 4: 在 full_state.js 中集成 unreadMessages**

```javascript
import messageHub from '../core/message_hub.js';
// 在 getFullState 中:
unreadMessages: messageHub.getUnreadCount(botId),
```

**Step 5: Commit**

```bash
git add mc-controller/core/message_hub.js mc-controller/routes/messages.js mc-controller/minecraft/full_state.js mc-controller/server.js
git commit -m "feat: add Message Hub for inter-agent communication"
```

---

## Task 10: Trade Engine — 交易系统

**Files:**
- Create: `mc-controller/core/trade_engine.js`
- Create: `mc-controller/routes/trades.js`

**Step 1: 创建 TradeEngine**

```javascript
// core/trade_engine.js
import { v4 as uuid } from 'uuid';
import botManager from './bot_manager.js';
import messageHub from './message_hub.js';
import { getOrCreateQueue } from './action_queue.js';
import * as skills from '../minecraft/skills.js';
import * as world from '../minecraft/world.js';
import config from '../config.js';

// Trade states: pending → accepted → executing → completed/failed
//               pending → rejected/cancelled/expired

class TradeEngine {
  constructor() {
    this.trades = new Map(); // tradeId -> trade object
    this.history = []; // completed trades
    // Expiry check interval
    setInterval(() => this._checkExpired(), 10000);
  }

  createTrade(fromBotId, { to, offer, want, message, expiresIn }) {
    // Validate offer items exist in inventory
    const fromEntry = botManager.getBotOrThrow(fromBotId);
    const counts = world.getInventoryCounts(fromEntry.bot);
    for (const item of offer) {
      if ((counts[item.item] || 0) < item.count) {
        throw new Error(`Insufficient ${item.item}: have ${counts[item.item] || 0}, need ${item.count}`);
      }
    }

    const tradeId = uuid();
    const expiry = expiresIn || config.trade.defaultExpiry;
    const trade = {
      tradeId,
      from: fromBotId,
      to: to || null, // null = open order
      offer,
      want,
      message: message || '',
      status: 'pending',
      createdAt: Date.now(),
      expiresAt: Date.now() + expiry * 1000,
      acceptedBy: null,
      result: null,
    };

    this.trades.set(tradeId, trade);

    // Notify target (or all if open)
    if (to) {
      messageHub.systemMessage(to, 'trade_proposal', {
        tradeId, from: fromBotId, offer, want, message: trade.message, expiresAt: trade.expiresAt,
      });
    } else {
      // Broadcast open trade to all online bots
      const allBots = botManager.listBots().filter(b => b.online && b.botId !== fromBotId);
      for (const b of allBots) {
        messageHub.systemMessage(b.botId, 'trade_proposal', {
          tradeId, from: fromBotId, offer, want, message: trade.message, expiresAt: trade.expiresAt,
        });
      }
    }

    return { tradeId, status: 'pending', expiresAt: trade.expiresAt };
  }

  async acceptTrade(tradeId, acceptorBotId) {
    const trade = this.trades.get(tradeId);
    if (!trade) throw new Error('Trade not found');
    if (trade.status !== 'pending') throw new Error(`Trade is ${trade.status}, cannot accept`);
    if (trade.to && trade.to !== acceptorBotId) throw new Error('This trade is not for you');
    if (trade.from === acceptorBotId) throw new Error('Cannot accept your own trade');
    if (Date.now() > trade.expiresAt) { trade.status = 'expired'; throw new Error('Trade expired'); }

    // Validate acceptor has the wanted items
    const acceptorEntry = botManager.getBotOrThrow(acceptorBotId);
    const counts = world.getInventoryCounts(acceptorEntry.bot);
    for (const item of trade.want) {
      if ((counts[item.item] || 0) < item.count) {
        throw new Error(`Insufficient ${item.item}: have ${counts[item.item] || 0}, need ${item.count}`);
      }
    }

    // Re-validate offerer still has items
    const fromEntry = botManager.getBotOrThrow(trade.from);
    const fromCounts = world.getInventoryCounts(fromEntry.bot);
    for (const item of trade.offer) {
      if ((fromCounts[item.item] || 0) < item.count) {
        trade.status = 'failed';
        trade.result = 'Offerer no longer has the items';
        throw new Error('Offerer no longer has the items');
      }
    }

    trade.status = 'accepted';
    trade.acceptedBy = acceptorBotId;

    // Calculate meeting point
    const posA = fromEntry.bot.entity.position;
    const posB = acceptorEntry.bot.entity.position;
    const meetingPoint = {
      x: Math.round((posA.x + posB.x) / 2),
      y: Math.round((posA.y + posB.y) / 2),
      z: Math.round((posA.z + posB.z) / 2),
    };

    // Execute trade in background
    this._executeTrade(trade, meetingPoint);

    return {
      tradeId,
      status: 'accepted',
      execution: { meetingPoint, estimatedTime: 15000 },
    };
  }

  async _executeTrade(trade, meetingPoint) {
    trade.status = 'executing';
    const fromEntry = botManager.getBotOrThrow(trade.from);
    const toEntry = botManager.getBotOrThrow(trade.acceptedBy);
    const fromBot = fromEntry.bot;
    const toBot = toEntry.bot;

    // 1. Pause action queues and item_collecting
    const fromQueue = getOrCreateQueue(trade.from, () => fromBot);
    const toQueue = getOrCreateQueue(trade.acceptedBy, () => toBot);
    fromQueue.interruptForMode();
    toQueue.interruptForMode();
    if (fromBot.modes) fromBot.modes.pause('item_collecting');
    if (toBot.modes) toBot.modes.pause('item_collecting');

    try {
      // 2. Both move to meeting point
      await Promise.all([
        skills.goToPosition(fromBot, meetingPoint.x, meetingPoint.y, meetingPoint.z, 3),
        skills.goToPosition(toBot, meetingPoint.x, meetingPoint.y, meetingPoint.z, 3),
      ]);

      // 3. Exchange: from gives offer to acceptor
      for (const item of trade.offer) {
        await skills.giveToPlayer(fromBot, item.item, trade.acceptedBy, item.count);
      }

      // 4. Exchange: acceptor gives want to from
      for (const item of trade.want) {
        await skills.giveToPlayer(toBot, item.item, trade.from, item.count);
      }

      // 5. Verify
      trade.status = 'completed';
      trade.completedAt = Date.now();
      this.history.push({ ...trade });

      // Notify both parties
      messageHub.systemMessage(trade.from, 'trade_completed', { tradeId: trade.tradeId });
      messageHub.systemMessage(trade.acceptedBy, 'trade_completed', { tradeId: trade.tradeId });

    } catch (err) {
      trade.status = 'failed';
      trade.result = err.message;

      // Attempt rollback - try to return items
      try {
        // If items were dropped, try to pick them up
        await skills.pickupNearbyItems(fromBot);
        await skills.pickupNearbyItems(toBot);
      } catch (e) {
        // Best effort
      }

      messageHub.systemMessage(trade.from, 'trade_failed', { tradeId: trade.tradeId, reason: err.message });
      messageHub.systemMessage(trade.acceptedBy, 'trade_failed', { tradeId: trade.tradeId, reason: err.message });
    } finally {
      // 6. Resume
      fromQueue.resumeAfterMode();
      toQueue.resumeAfterMode();
      if (fromBot.modes) fromBot.modes.unpause('item_collecting');
      if (toBot.modes) toBot.modes.unpause('item_collecting');
    }
  }

  rejectTrade(tradeId, botId) {
    const trade = this.trades.get(tradeId);
    if (!trade) throw new Error('Trade not found');
    if (trade.status !== 'pending') throw new Error(`Trade is ${trade.status}`);
    trade.status = 'rejected';
    messageHub.systemMessage(trade.from, 'trade_rejected', { tradeId, by: botId });
    return { tradeId, status: 'rejected' };
  }

  cancelTrade(tradeId, botId) {
    const trade = this.trades.get(tradeId);
    if (!trade) throw new Error('Trade not found');
    if (trade.from !== botId) throw new Error('Only the offerer can cancel');
    if (trade.status !== 'pending') throw new Error(`Trade is ${trade.status}`);
    trade.status = 'cancelled';
    return { tradeId, status: 'cancelled' };
  }

  getTrade(tradeId) {
    return this.trades.get(tradeId);
  }

  getTradesForBot(botId) {
    const result = [];
    for (const trade of this.trades.values()) {
      if ((trade.from === botId || trade.to === botId || trade.to === null || trade.acceptedBy === botId)
          && ['pending', 'accepted', 'executing'].includes(trade.status)) {
        result.push(trade);
      }
    }
    return result;
  }

  getHistory(limit = 50) {
    return this.history.slice(-limit);
  }

  getMarketSummary(periodMs = 3600000) {
    const since = Date.now() - periodMs;
    const recent = this.history.filter(t => t.completedAt > since);

    const summary = new Map();
    for (const trade of recent) {
      for (const offered of trade.offer) {
        if (!summary.has(offered.item)) summary.set(offered.item, { trades: 0, rates: {} });
        const entry = summary.get(offered.item);
        entry.trades++;
        for (const wanted of trade.want) {
          const rate = wanted.count / offered.count;
          if (!entry.rates[wanted.item]) entry.rates[wanted.item] = [];
          entry.rates[wanted.item].push(rate);
        }
      }
    }

    const result = [];
    for (const [item, data] of summary) {
      const avgRates = {};
      for (const [rateItem, rates] of Object.entries(data.rates)) {
        avgRates[rateItem] = Math.round((rates.reduce((a, b) => a + b, 0) / rates.length) * 100) / 100;
      }
      result.push({ item, trades: data.trades, avgExchangeRate: avgRates });
    }
    return result;
  }

  getPendingTradeCount(botId) {
    let count = 0;
    for (const trade of this.trades.values()) {
      if ((trade.to === botId || (trade.to === null && trade.from !== botId))
          && trade.status === 'pending') {
        count++;
      }
    }
    return count;
  }

  _checkExpired() {
    const now = Date.now();
    for (const trade of this.trades.values()) {
      if (trade.status === 'pending' && now > trade.expiresAt) {
        trade.status = 'expired';
      }
    }
  }
}

const tradeEngine = new TradeEngine();
export default tradeEngine;
```

**Step 2: 创建 trades 路由**

```javascript
// routes/trades.js
import { Router } from 'express';
import tradeEngine from '../core/trade_engine.js';
import botManager from '../core/bot_manager.js';

const router = Router();

function findBotByAgent(agentId) {
  const bots = botManager.listBots();
  const myBot = bots.find(b => b.agentId === agentId && b.online);
  return myBot ? myBot.botId : null;
}

router.post('/', (req, res) => {
  const botId = findBotByAgent(req.agentId);
  if (!botId) return res.status(400).json({ error: 'No active bot' });
  try {
    const result = tradeEngine.createTrade(botId, req.body);
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/', (req, res) => {
  const botId = findBotByAgent(req.agentId);
  if (!botId) return res.status(400).json({ error: 'No active bot' });
  res.json({ trades: tradeEngine.getTradesForBot(botId) });
});

router.get('/history', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  res.json({ trades: tradeEngine.getHistory(limit) });
});

router.get('/market', (req, res) => {
  const period = req.query.period === '24h' ? 86400000 : 3600000;
  res.json({ period: req.query.period || 'last_1h', summary: tradeEngine.getMarketSummary(period) });
});

router.get('/:id', (req, res) => {
  const trade = tradeEngine.getTrade(req.params.id);
  if (!trade) return res.status(404).json({ error: 'Trade not found' });
  res.json(trade);
});

router.put('/:id/accept', async (req, res) => {
  const botId = findBotByAgent(req.agentId);
  if (!botId) return res.status(400).json({ error: 'No active bot' });
  try {
    const result = await tradeEngine.acceptTrade(req.params.id, botId);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/:id/reject', (req, res) => {
  const botId = findBotByAgent(req.agentId);
  if (!botId) return res.status(400).json({ error: 'No active bot' });
  try {
    const result = tradeEngine.rejectTrade(req.params.id, botId);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/:id/cancel', (req, res) => {
  const botId = findBotByAgent(req.agentId);
  if (!botId) return res.status(400).json({ error: 'No active bot' });
  try {
    const result = tradeEngine.cancelTrade(req.params.id, botId);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
```

**Step 3: 注册到 server.js**

```javascript
import tradesRouter from './routes/trades.js';
app.use('/v1/trades', tradesRouter);
```

**Step 4: 在 full_state.js 中集成 pendingTrades**

```javascript
import tradeEngine from '../core/trade_engine.js';
// 在 getFullState 中:
pendingTrades: tradeEngine.getPendingTradeCount(botId),
```

**Step 5: Commit**

```bash
git add mc-controller/core/trade_engine.js mc-controller/routes/trades.js mc-controller/minecraft/full_state.js mc-controller/server.js
git commit -m "feat: add Trade Engine with escrow, market summary, message notifications"
```

---

## Task 11: 完整 server.js 组装

**Files:**
- Modify: `mc-controller/server.js`

**Step 1: 最终 server.js**

```javascript
import express from 'express';
import config from './config.js';
import authRouter from './routes/auth.js';
import botsRouter from './routes/bots.js';
import stateRouter from './routes/state.js';
import actionsRouter from './routes/actions.js';
import modesRouter from './routes/modes.js';
import messagesRouter from './routes/messages.js';
import tradesRouter from './routes/trades.js';
import { authenticate } from './middleware/authenticate.js';

const app = express();
app.use(express.json());

// Health (no auth)
app.get('/v1/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// Auth routes (no auth required)
app.use('/v1/auth', authRouter);

// All subsequent routes require auth
app.use('/v1', authenticate);

// Bot management
app.use('/v1/bots', botsRouter);

// State queries (mounted on /bots/:id/...)
app.use('/v1/bots', stateRouter);

// Actions (mounted on /bots/:id/...)
app.use('/v1/bots', actionsRouter);

// Modes (mounted on /bots/:id/...)
app.use('/v1/bots', modesRouter);

// Messaging
app.use('/v1/messages', messagesRouter);

// Trading
app.use('/v1/trades', tradesRouter);

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(config.port, () => {
  console.log(`MC Controller v0.1.0 running on port ${config.port}`);
  console.log(`MC Server: ${config.mc.host}:${config.mc.port}`);
  console.log(`Endpoints: /v1/health, /v1/auth, /v1/bots, /v1/messages, /v1/trades`);
});

export default app;
```

**Step 2: Commit**

```bash
git add mc-controller/server.js
git commit -m "feat: assemble complete server with all routes"
```

---

## Task 12: 更新 OpenClaw Skill

**Files:**
- Modify: `openclaw-minecraft-0.1.26/SKILL.md`
- Modify: `openclaw-minecraft-0.1.26/CRON_PROMPT.md`
- Modify: `openclaw-minecraft-0.1.26/personas/*.json`

**Step 1: 重写 SKILL.md**

更新 API 文档：新增所有 37 个动作的调用方式、Message Hub API、Trade API、Modes API。

**Step 2: 重写 CRON_PROMPT.md**

按设计文档 8.2 节的新流程重写。

**Step 3: 增强 Persona**

按设计文档 8.3 节添加 cooperationRules、hostilityRules、tradingStrategy 等字段。

**Step 4: Commit**

```bash
git add openclaw-minecraft-0.1.26/
git commit -m "feat: update OpenClaw skill for full Controller API"
```

---

## 执行顺序总结

```
Task 1  → 项目脚手架
Task 2  → JWT 认证
Task 3  → 移植 MC 工具层 (mcdata, world, skills, math)
Task 4  → BotManager 生命周期
Task 5  → 状态查询路由
Task 6  → ActionQueue 动作队列
Task 7  → Actions 路由
Task 8  → Modes 反应层
Task 9  → Message Hub
Task 10 → Trade Engine
Task 11 → server.js 组装
Task 12 → OpenClaw Skill 更新
```

依赖关系：
- Task 1 必须先完成（其他都依赖它）
- Task 2 独立（仅依赖 Task 1）
- Task 3 独立（仅依赖 Task 1）
- Task 4 依赖 Task 3 (mcdata.js)
- Task 5 依赖 Task 3 + Task 4
- Task 6 依赖 Task 3
- Task 7 依赖 Task 4 + Task 6
- Task 8 依赖 Task 3 + Task 4 + Task 6
- Task 9 依赖 Task 4
- Task 10 依赖 Task 3 + Task 4 + Task 6 + Task 9
- Task 11 依赖 Task 2-10 全部
- Task 12 独立（仅需要知道 API 结构）

可并行的组：
- 组 1: Task 1
- 组 2: Task 2 + Task 3 (并行)
- 组 3: Task 4 + Task 6 (并行，都依赖 Task 3)
- 组 4: Task 5 + Task 7 + Task 8 + Task 9 (部分可并行)
- 组 5: Task 10
- 组 6: Task 11 + Task 12 (并行)
