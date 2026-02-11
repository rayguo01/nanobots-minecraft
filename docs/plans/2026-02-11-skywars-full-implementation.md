# SkyWars 全阶段实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 构建完整的 LLM 控制 SkyWars 对抗系统——多个 AI Bot 在空岛中自主决策、开箱装备、搭路进攻、PvP 战斗，最终决出胜负。

**Architecture:** 三层解耦架构：LLM 策略层（Claude API 高层决策）→ 战术中间层（JS 逻辑，指令分解/校验/状态收集）→ 执行底层（Mineflayer 硬编码操作模块）。Game Coordinator 负责回合调度，所有 Bot 同步决策后统一执行。`skywars/` 独立于 `mc-controller/`，后续按需引入底层工具函数。

**Tech Stack:** Node.js (ES Modules), Mineflayer 4.x, mineflayer-pvp, mineflayer-pathfinder, vec3, Claude API (@anthropic-ai/sdk), Paper 1.20.x + SkyWarsReloaded

---

## 已完成

- ✅ Phase 1: `skywars/modules/bridging.js` — 后退搭路，10 格 cobblestone 精准直线放置
- ✅ `skywars/index.js` — bot 连接/spawn/搭路测试入口
- ✅ `skywars/setup-platforms.js` — 测试平台搭建脚本

## 目标目录结构

```
skywars/
├── package.json
├── config.js                        # 服务器/游戏配置
├── coordinator.js                   # Game Coordinator 主入口
├── index.js                         # Phase 1 测试入口 (保留)
├── modules/
│   ├── bridging.js                  # ✅ 已完成
│   ├── loot.js                      # 开箱/装备评分/自动穿戴
│   ├── combat.js                    # 近战/远程/虚空感知
│   └── perception.js                # 状态快照生成
├── strategy/
│   ├── llm-client.js                # Claude API 封装
│   ├── action-dispatcher.js         # LLM 指令 → 模块调用
│   ├── schema.js                    # JSON Schema 校验
│   └── prompts.js                   # 4 种策略人格模板
├── maps/
│   └── islands.js                   # 岛屿坐标/地图配置
├── match/
│   ├── match-manager.js             # 锦标赛管理
│   └── stats.js                     # 统计收集
└── tests/
    ├── test-loot.js                 # 开箱测试
    ├── test-combat.js               # 战斗测试
    ├── test-2bot-llm.js             # 2 Bot LLM 对战测试
    └── test-full-match.js           # 完整对战测试
```

---

## Phase 2: 开箱与战斗模块

### Task 1: 配置模块

**Files:**
- Create: `skywars/config.js`

**Step 1: 创建共享配置**

```js
// skywars/config.js
const config = {
  server: {
    host: process.env.MC_HOST || 'localhost',
    port: parseInt(process.env.MC_PORT || '25565'),
    version: '1.20.1',
  },
  game: {
    roundIntervalMs: 30_000,
    roundTimeoutMs: 30_000,
    maxRounds: 50,
  },
  equipment: {
    // 装备评分：越高越好
    tierScore: {
      diamond: 4,
      iron: 3,
      chainmail: 2,
      golden: 2,
      leather: 1,
    },
    slotScore: {
      chestplate: 3,   // 胸甲权重最高
      leggings: 2,
      helmet: 1,
      boots: 1,
    },
  },
  bridging: {
    pollIntervalMs: 50,
    placeDelayMs: 300,
    timeoutMs: 60_000,
    blockName: 'cobblestone',
  },
  combat: {
    meleeReachBlocks: 3.5,
    rangedMaxBlocks: 30,
    retreatDistanceBlocks: 8,
    lowHealthThreshold: 6,        // 3 颗心以下触发撤退信号
    voidYThreshold: 0,            // Y<0 判定虚空
    knockbackCheckRadiusBlocks: 2,
  },
  llm: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-5-20250929',
    maxTokens: 1024,
    maxRetries: 1,
  },
};

export default config;
```

**Step 2: 验证**

Run: `node -e "import('./config.js').then(m => console.log(JSON.stringify(m.default.equipment, null, 2)))"`

Expected: 打印 equipment 配置 JSON

**Step 3: Commit**

```bash
git add skywars/config.js
git commit -m "feat(skywars): add shared config module"
```

---

### Task 2: Loot 模块 — 开箱与装备

**Files:**
- Create: `skywars/modules/loot.js`
- Create: `skywars/tests/test-loot.js`

**Step 1: 实现 loot 模块**

`skywars/modules/loot.js` 核心功能：

1. **`findAndLootChests(bot, radius)`** — 扫描半径内所有箱子，逐个打开并取出所有物品
   - `bot.findBlocks()` 找 `chest` 类型方块
   - `mineflayer-pathfinder` 走到箱子旁边
   - `bot.openContainer()` 打开箱子
   - 遍历 `window.slots` 把所有物品 `window.withdraw()` 取出
   - 关闭窗口

2. **`scoreEquipment(item)`** — 根据材质和部位计算装备评分
   - 解析 item.name（如 `iron_chestplate` → tier=iron, slot=chestplate）
   - 评分 = `tierScore[tier] * slotScore[slot]`
   - 武器评分用 `item.attackDamage` 属性

3. **`equipBestGear(bot)`** — 遍历背包，给每个槽位穿上最高分装备
   - 槽位: helmet, chestplate, leggings, boots, hand (武器)
   - 对每个槽位找背包中评分最高的对应物品
   - `bot.equip(item, destination)` 穿上

4. **`lootAndEquip(bot, radius)`** — 组合函数：开箱 → 装备最优 → 返回战利品列表

```js
// skywars/modules/loot.js
import config from '../config.js';
import pf from 'mineflayer-pathfinder';

const { tierScore, slotScore } = config.equipment;

const ARMOR_SLOTS = ['helmet', 'chestplate', 'leggings', 'boots'];
const ARMOR_TIERS = Object.keys(tierScore);

export function scoreEquipment(item) {
  if (!item) return 0;
  const name = item.name;

  // Weapon scoring — use attackDamage directly
  if (name.includes('sword') || name.includes('axe')) {
    return item.attackDamage || 1;
  }

  // Armor scoring
  for (const slot of ARMOR_SLOTS) {
    if (!name.includes(slot)) continue;
    for (const tier of ARMOR_TIERS) {
      if (name.includes(tier)) {
        return tierScore[tier] * (slotScore[slot] || 1);
      }
    }
  }
  return 0;
}

export async function findAndLootChests(bot, radius = 16) {
  const chestPositions = bot.findBlocks({
    matching: block => block.name === 'chest' || block.name === 'trapped_chest',
    maxDistance: radius,
    count: 20,
  });

  const looted = [];

  for (const pos of chestPositions) {
    try {
      // Walk to chest
      const goal = new pf.goals.GoalNear(pos.x, pos.y, pos.z, 2);
      bot.pathfinder.setGoal(goal);
      await waitForGoal(bot, 10_000);

      // Open chest
      const chestBlock = bot.blockAt(pos);
      const window = await bot.openContainer(chestBlock);

      // Withdraw all items
      for (const item of window.containerItems()) {
        try {
          await window.withdraw(item.type, item.metadata, item.count);
          looted.push({ name: item.name, count: item.count });
        } catch { /* slot empty or full inventory */ }
      }

      window.close();
    } catch (err) {
      console.log(`[loot] failed to loot chest at ${pos}: ${err.message}`);
    }
  }

  return looted;
}

export async function equipBestGear(bot) {
  const inventory = bot.inventory.items();

  // Equip best armor per slot
  for (const slot of ARMOR_SLOTS) {
    const candidates = inventory.filter(i => i.name.includes(slot));
    if (candidates.length === 0) continue;
    candidates.sort((a, b) => scoreEquipment(b) - scoreEquipment(a));
    const best = candidates[0];
    const current = bot.inventory.slots[armorSlotIndex(slot)];
    if (!current || scoreEquipment(best) > scoreEquipment(current)) {
      await bot.equip(best, slotToDestination(slot));
    }
  }

  // Equip best weapon
  const weapons = inventory.filter(i =>
    i.name.includes('sword') || (i.name.includes('axe') && !i.name.includes('pickaxe'))
  );
  if (weapons.length > 0) {
    weapons.sort((a, b) => scoreEquipment(b) - scoreEquipment(a));
    await bot.equip(weapons[0], 'hand');
  }
}

export async function lootAndEquip(bot, radius = 16) {
  const looted = await findAndLootChests(bot, radius);
  await equipBestGear(bot);
  console.log(`[loot] looted ${looted.length} items, equipped best gear`);
  return looted;
}

// --- helpers ---

function slotToDestination(slot) {
  return { helmet: 'head', chestplate: 'torso', leggings: 'legs', boots: 'feet' }[slot];
}

function armorSlotIndex(slot) {
  // Mineflayer armor slot indices: helmet=5, chestplate=6, leggings=7, boots=8
  return { helmet: 5, chestplate: 6, leggings: 7, boots: 8 }[slot];
}

function waitForGoal(bot, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      bot.pathfinder.stop();
      reject(new Error('pathfinder timeout'));
    }, timeoutMs);

    bot.once('goal_reached', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
```

**Step 2: 创建测试脚本**

```js
// skywars/tests/test-loot.js
// 测试场景：服务器上有一个箱子（手动放置并填入装备），bot 连接后开箱并穿戴
// 准备：在平台 A 上放一个箱子，里面放 iron_sword, iron_chestplate, diamond_boots
import mineflayer from 'mineflayer';
import { pathfinder } from 'mineflayer-pathfinder';
import config from '../config.js';
import { lootAndEquip, scoreEquipment } from '../modules/loot.js';

const bot = mineflayer.createBot({
  ...config.server,
  username: 'LootTest',
});
bot.loadPlugin(pathfinder);

bot.once('spawn', async () => {
  await new Promise(r => setTimeout(r, 2000));
  console.log('[test-loot] bot spawned, starting loot test...');

  const looted = await lootAndEquip(bot, 16);
  console.log('[test-loot] looted items:', looted);

  // Report equipped gear
  const equipment = ['head', 'torso', 'legs', 'feet', 'hand'].map(slot => {
    const item = bot.inventory.slots[{ head: 5, torso: 6, legs: 7, feet: 8, hand: bot.getEquipmentDestSlot('hand') }[slot]];
    return `${slot}: ${item ? item.name : 'empty'}`;
  });
  console.log('[test-loot] equipment:', equipment.join(', '));

  bot.quit();
});
```

**Step 3: 在服务器上手动准备测试环境**

在平台 A 上放置一个箱子，用命令填入装备：
```
/setblock 8 117 -9 chest
```
然后手动放入 iron_sword, iron_chestplate, diamond_boots, cobblestone x64

**Step 4: 运行测试**

Run: `cd skywars && node tests/test-loot.js`

Expected: bot 开箱取出物品，穿戴 iron_chestplate (torso), diamond_boots (feet), iron_sword (hand)

**Step 5: Commit**

```bash
git add skywars/modules/loot.js skywars/tests/test-loot.js
git commit -m "feat(skywars): add loot module — chest opening and auto-equip"
```

---

### Task 3: Combat 模块 — 近战 + 远程 + 虚空感知

**Files:**
- Create: `skywars/modules/combat.js`
- Create: `skywars/tests/test-combat.js`

**Step 1: 实现 combat 模块**

核心功能：

1. **`meleeAttack(bot, targetName)`** — 近战攻击循环
   - `bot.players[targetName]?.entity` 获取目标实体
   - 用 pathfinder 接近到攻击距离内（3.5 格）
   - `bot.pvp.attack(entity)` 启动 PvP
   - 返回结果：击杀/目标逃跑/自己低血量

2. **`rangedAttack(bot, targetName, weapon)`** — 远程攻击
   - weapon: 'bow', 'snowball', 'egg', 'ender_pearl'
   - 装备对应物品到手
   - snowball/egg: `bot.lookAt(target)` → `bot.activateItem()`
   - bow: `bot.activateItem()` 蓄力 → `bot.deactivateItem()` 释放

3. **`checkVoidRisk(bot)`** — 虚空风险检测
   - 检查 bot 脚下及四周 2 格内是否有虚空（Y < voidYThreshold 的空气列）
   - 返回 `{ atRisk: boolean, safeDirection: Vec3 | null }`

4. **`retreat(bot, direction)`** — 撤退
   - 沿指定方向快速移动（sprint + jump）
   - 如果方向是虚空则自动找安全方向

```js
// skywars/modules/combat.js
import config from '../config.js';
import vec3 from 'vec3';

const { meleeReachBlocks, rangedMaxBlocks, lowHealthThreshold, voidYThreshold, knockbackCheckRadiusBlocks } = config.combat;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export async function meleeAttack(bot, targetName) {
  const player = bot.players[targetName];
  if (!player?.entity) {
    return { success: false, reason: 'target_not_visible' };
  }

  const entity = player.entity;
  const dist = bot.entity.position.distanceTo(entity.position);

  // Equip best melee weapon
  const weapons = bot.inventory.items().filter(i =>
    i.name.includes('sword') || (i.name.includes('axe') && !i.name.includes('pickaxe'))
  );
  if (weapons.length > 0) {
    weapons.sort((a, b) => (b.attackDamage || 0) - (a.attackDamage || 0));
    await bot.equip(weapons[0], 'hand');
  }

  // Start PvP attack
  bot.pvp.attack(entity);

  // Wait for combat to resolve (max 30s per round)
  return new Promise(resolve => {
    const timeout = setTimeout(() => {
      bot.pvp.stop();
      resolve({ success: false, reason: 'timeout' });
    }, 30_000);

    const checkInterval = setInterval(() => {
      // Target dead?
      if (!player.entity || entity.metadata?.[7] <= 0) {
        clearInterval(checkInterval);
        clearTimeout(timeout);
        bot.pvp.stop();
        resolve({ success: true, reason: 'target_killed' });
        return;
      }
      // Self low health?
      if (bot.health <= lowHealthThreshold) {
        clearInterval(checkInterval);
        clearTimeout(timeout);
        bot.pvp.stop();
        resolve({ success: false, reason: 'low_health', health: bot.health });
        return;
      }
    }, 500);

    // pvp 'stoppedAttacking' 事件
    bot.pvp.once('stoppedAttacking', () => {
      clearInterval(checkInterval);
      clearTimeout(timeout);
      resolve({ success: false, reason: 'target_lost' });
    });
  });
}

export async function rangedAttack(bot, targetName, weapon) {
  const player = bot.players[targetName];
  if (!player?.entity) {
    return { success: false, reason: 'target_not_visible' };
  }

  const entity = player.entity;
  const dist = bot.entity.position.distanceTo(entity.position);

  if (dist > rangedMaxBlocks) {
    return { success: false, reason: 'target_too_far' };
  }

  // Find and equip the weapon item
  const item = bot.inventory.items().find(i => i.name === weapon || i.name.includes(weapon));
  if (!item) {
    return { success: false, reason: 'no_ammo' };
  }
  await bot.equip(item, 'hand');

  // Aim at target (lead slightly above for projectile arc)
  const targetPos = entity.position.offset(0, 1.6, 0); // head height
  await bot.lookAt(targetPos, true);

  if (weapon === 'bow') {
    // Draw bow and release
    bot.activateItem();
    await sleep(1200); // charge time
    const arrowItem = bot.inventory.items().find(i => i.name === 'arrow');
    if (!arrowItem) {
      bot.deactivateItem();
      return { success: false, reason: 'no_arrows' };
    }
    // Re-aim (target may have moved)
    await bot.lookAt(player.entity?.position.offset(0, 1.6, 0) || targetPos, true);
    bot.deactivateItem();
  } else {
    // Throwable: snowball, egg, ender_pearl
    bot.activateItem();
  }

  return { success: true, weapon, target: targetName };
}

export function checkVoidRisk(bot) {
  const pos = bot.entity.position;
  const directions = [
    vec3(1, 0, 0), vec3(-1, 0, 0),
    vec3(0, 0, 1), vec3(0, 0, -1),
  ];

  let atRisk = false;
  let safeDirection = null;

  // Check if standing near void edge
  for (const dir of directions) {
    const checkPos = pos.offset(dir.x * knockbackCheckRadiusBlocks, 0, dir.z * knockbackCheckRadiusBlocks);
    const blockBelow = bot.blockAt(checkPos.offset(0, -1, 0));
    const isVoid = !blockBelow || blockBelow.name === 'air';

    if (isVoid) {
      atRisk = true;
    } else if (!safeDirection) {
      safeDirection = dir;
    }
  }

  // Check directly below
  const below = bot.blockAt(pos.offset(0, -1, 0));
  if (!below || below.name === 'air') {
    atRisk = true;
  }

  return { atRisk, safeDirection };
}

export async function retreat(bot, direction = null) {
  if (!direction) {
    const { safeDirection } = checkVoidRisk(bot);
    direction = safeDirection || vec3(0, 0, 1);
  }

  // Look away from danger, sprint backward
  const yaw = Math.atan2(-direction.x, direction.z);
  await bot.look(yaw, 0, true);

  bot.setControlState('sprint', true);
  bot.setControlState('forward', true);
  bot.setControlState('jump', true);

  await sleep(2000);

  bot.setControlState('sprint', false);
  bot.setControlState('forward', false);
  bot.setControlState('jump', false);

  return { success: true, newPosition: bot.entity.position.clone() };
}
```

**Step 2: 创建测试脚本**

```js
// skywars/tests/test-combat.js
// 测试场景：2 个 bot 连接，bot A 近战攻击 bot B
import mineflayer from 'mineflayer';
import { plugin as pvp } from 'mineflayer-pvp';
import config from '../config.js';
import { meleeAttack, checkVoidRisk } from '../modules/combat.js';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  // Spawn target dummy bot
  const dummy = mineflayer.createBot({
    ...config.server,
    username: 'CombatDummy',
  });

  await new Promise(r => dummy.once('spawn', r));
  console.log('[test-combat] dummy spawned');

  // Spawn attacker bot
  const attacker = mineflayer.createBot({
    ...config.server,
    username: 'CombatAttacker',
  });
  attacker.loadPlugin(pvp);

  await new Promise(r => attacker.once('spawn', r));
  await sleep(2000);
  console.log('[test-combat] attacker spawned');

  // Give attacker a sword
  attacker.chat('/give CombatAttacker iron_sword 1');
  await sleep(1000);

  // TP both to same area
  attacker.chat('/tp CombatAttacker 8 117 -10');
  attacker.chat('/tp CombatDummy 10 117 -10');
  await sleep(1500);

  // Check void risk
  const risk = checkVoidRisk(attacker);
  console.log('[test-combat] void risk:', risk);

  // Attack
  console.log('[test-combat] starting melee attack...');
  const result = await meleeAttack(attacker, 'CombatDummy');
  console.log('[test-combat] attack result:', result);

  attacker.quit();
  dummy.quit();
}

main().catch(err => {
  console.error('[test-combat] fatal:', err);
  process.exit(1);
});
```

**Step 3: 安装 pvp 依赖**

Run: `cd skywars && npm install mineflayer-pvp mineflayer-pathfinder`

**Step 4: 运行测试**

Run: `cd skywars && node tests/test-combat.js`

Expected: attacker 接近 dummy 并发起近战攻击，输出 attack result

**Step 5: Commit**

```bash
git add skywars/modules/combat.js skywars/tests/test-combat.js skywars/package.json skywars/package-lock.json
git commit -m "feat(skywars): add combat module — melee, ranged, void awareness"
```

---

### Task 4: 更新 bridging 模块使用共享配置

**Files:**
- Modify: `skywars/modules/bridging.js`

**Step 1: 重构 bridging.js 引用 config**

将顶部的硬编码常量替换为 `import config from '../config.js'`：
- `POLL_INTERVAL_MS` → `config.bridging.pollIntervalMs`
- `PLACE_DELAY_MS` → `config.bridging.placeDelayMs`
- `TIMEOUT_MS` → `config.bridging.timeoutMs`
- `BLOCK_NAME` → `config.bridging.blockName`

**Step 2: 验证搭路仍然正常工作**

Run: `cd skywars && node index.js`

Expected: 搭路成功，行为与之前一致

**Step 3: Commit**

```bash
git add skywars/modules/bridging.js
git commit -m "refactor(skywars): bridging uses shared config"
```

---

### Task 5: Phase 2 集成测试 — 开箱→搭路→战斗

**Files:**
- Create: `skywars/tests/test-phase2-integration.js`

**Step 1: 创建集成测试**

场景：bot 出生在平台 A → 开附近箱子穿装备 → 搭路到平台 B → 击杀 dummy

```js
// skywars/tests/test-phase2-integration.js
import mineflayer from 'mineflayer';
import { pathfinder } from 'mineflayer-pathfinder';
import { plugin as pvp } from 'mineflayer-pvp';
import config from '../config.js';
import { lootAndEquip } from '../modules/loot.js';
import { bridge } from '../modules/bridging.js';
import { meleeAttack } from '../modules/combat.js';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  // Spawn dummy on platform B
  const dummy = mineflayer.createBot({ ...config.server, username: 'IntegDummy' });
  await new Promise(r => dummy.once('spawn', r));
  dummy.chat('/tp IntegDummy 23 117 -10');
  await sleep(1000);

  // Spawn main bot on platform A
  const bot = mineflayer.createBot({ ...config.server, username: 'IntegBot' });
  bot.loadPlugin(pathfinder);
  bot.loadPlugin(pvp);

  await new Promise(r => bot.once('spawn', r));
  await sleep(2000);
  bot.chat('/tp IntegBot 8 117 -10');
  bot.chat('/give IntegBot cobblestone 64');
  await sleep(1500);

  // Phase 1: Loot
  console.log('[integration] Step 1: Loot chests...');
  const looted = await lootAndEquip(bot, 16);
  console.log(`[integration] looted ${looted.length} items`);

  // Phase 2: Bridge
  console.log('[integration] Step 2: Bridge to platform B...');
  const bridgeResult = await bridge(bot, { x: 23, y: 117, z: -10 });
  console.log(`[integration] bridge result: ${bridgeResult.success ? 'SUCCESS' : bridgeResult.reason}`);

  // Phase 3: Combat
  if (bridgeResult.success) {
    console.log('[integration] Step 3: Attack dummy...');
    const combatResult = await meleeAttack(bot, 'IntegDummy');
    console.log(`[integration] combat result:`, combatResult);
  }

  bot.quit();
  dummy.quit();
  console.log('[integration] Phase 2 integration test complete');
}

main().catch(err => {
  console.error('[integration] fatal:', err);
  process.exit(1);
});
```

**Step 2: 运行**

Run: `cd skywars && node tests/test-phase2-integration.js`

Expected: 三步顺序完成，各步骤 log 输出正常

**Step 3: Commit**

```bash
git add skywars/tests/test-phase2-integration.js
git commit -m "test(skywars): Phase 2 integration — loot, bridge, combat pipeline"
```

---

## Phase 3: LLM 策略层接入

### Task 6: Perception 模块 — 状态快照生成

**Files:**
- Create: `skywars/modules/perception.js`

**Step 1: 实现 perception 模块**

生成技术方案 §4.1 定义的状态快照 JSON。

```js
// skywars/modules/perception.js
import config from '../config.js';

const ARMOR_TIERS = ['diamond', 'iron', 'chainmail', 'golden', 'leather'];
const ARMOR_SLOTS = ['helmet', 'chestplate', 'leggings', 'boots'];

export function generateSnapshot(bot, gameState) {
  return {
    round: gameState.round,
    phase: gameState.phase,
    self: getSelfState(bot),
    visible_players: getVisiblePlayers(bot),
    map_state: gameState.mapState,
    recent_events: gameState.recentEvents.slice(-10),
  };
}

function getSelfState(bot) {
  const pos = bot.entity.position;
  return {
    position: { x: Math.round(pos.x), y: Math.round(pos.y), z: Math.round(pos.z) },
    health: bot.health,
    hunger: bot.food,
    equipment: {
      helmet: bot.inventory.slots[5]?.name || null,
      chestplate: bot.inventory.slots[6]?.name || null,
      leggings: bot.inventory.slots[7]?.name || null,
      boots: bot.inventory.slots[8]?.name || null,
      weapon: bot.heldItem?.name || null,
      offhand: bot.inventory.slots[45]?.name || null,
    },
    inventory: bot.inventory.items().map(i => ({
      item: i.name,
      count: i.count,
    })),
  };
}

function getVisiblePlayers(bot) {
  const players = [];
  for (const [name, player] of Object.entries(bot.players)) {
    if (name === bot.username) continue;
    if (!player.entity) continue;

    const entity = player.entity;
    const dist = bot.entity.position.distanceTo(entity.position);

    players.push({
      name,
      position: {
        x: Math.round(entity.position.x),
        y: Math.round(entity.position.y),
        z: Math.round(entity.position.z),
      },
      distance: Math.round(dist),
      estimated_equipment: estimateEquipmentTier(entity),
      health_estimate: estimateHealth(entity),
    });
  }
  return players;
}

function estimateEquipmentTier(entity) {
  // Mineflayer entity equipment: [held, boots, leggings, chestplate, helmet]
  const equipment = entity.equipment || [];
  let bestTier = 'none';
  for (const item of equipment) {
    if (!item) continue;
    for (const tier of ARMOR_TIERS) {
      if (item.name?.includes(tier)) {
        if (ARMOR_TIERS.indexOf(tier) < ARMOR_TIERS.indexOf(bestTier) || bestTier === 'none') {
          bestTier = tier;
        }
        break;
      }
    }
  }
  return bestTier === 'none' ? 'unknown' : `${bestTier}_armor`;
}

function estimateHealth(entity) {
  // entity.metadata[9] is health for players (if exposed by server)
  const health = entity.metadata?.[9];
  if (health == null) return 'unknown';
  if (health > 14) return 'high';
  if (health > 8) return 'medium';
  return 'low';
}
```

**Step 2: Commit**

```bash
git add skywars/modules/perception.js
git commit -m "feat(skywars): add perception module — state snapshot generation"
```

---

### Task 7: LLM Client — Claude API 封装

**Files:**
- Create: `skywars/strategy/llm-client.js`
- Create: `skywars/strategy/schema.js`
- Create: `skywars/strategy/prompts.js`

**Step 1: 安装依赖**

Run: `cd skywars && npm install @anthropic-ai/sdk`

**Step 2: 实现 LLM Client**

```js
// skywars/strategy/llm-client.js
import Anthropic from '@anthropic-ai/sdk';
import config from '../config.js';
import { validateAction } from './schema.js';

const client = new Anthropic();

export async function getDecision(snapshot, systemPrompt) {
  const userMessage = `当前状态：\n${JSON.stringify(snapshot, null, 2)}\n\n请选择你的行动。以 JSON 格式回复，包含 reasoning、action、params 字段。`;

  for (let attempt = 0; attempt <= config.llm.maxRetries; attempt++) {
    try {
      const response = await client.messages.create({
        model: config.llm.model,
        max_tokens: config.llm.maxTokens,
        system: systemPrompt,
        messages: [
          { role: 'user', content: attempt === 0 ? userMessage : `${userMessage}\n\n上次回复格式有误: ${lastError}。请严格按 JSON 格式回复。` },
        ],
      });

      const text = response.content[0].text;
      // Extract JSON from response (may be wrapped in markdown code block)
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        lastError = 'no JSON found in response';
        continue;
      }

      const decision = JSON.parse(jsonMatch[0]);
      const validation = validateAction(decision);
      if (!validation.valid) {
        lastError = validation.error;
        continue;
      }

      return decision;
    } catch (err) {
      console.log(`[llm-client] attempt ${attempt} failed: ${err.message}`);
      var lastError = err.message;
    }
  }

  // Fallback to wait
  console.log('[llm-client] all attempts failed, defaulting to wait');
  return { reasoning: 'LLM error, defaulting to wait', action: 'wait', params: {} };
}
```

**Step 3: 实现 JSON Schema 校验**

```js
// skywars/strategy/schema.js
const VALID_ACTIONS = [
  'loot_chest',
  'bridge_to',
  'attack',
  'ranged_attack',
  'use_item',
  'retreat',
  'destroy_bridge',
  'wait',
];

const PARAM_RULES = {
  loot_chest: [],
  bridge_to: ['target_island'],
  attack: ['target_player'],
  ranged_attack: ['target_player', 'weapon'],
  use_item: ['item'],
  retreat: ['direction'],
  destroy_bridge: ['bridge_id'],
  wait: [],
};

export function validateAction(decision) {
  if (!decision || typeof decision !== 'object') {
    return { valid: false, error: 'decision is not an object' };
  }
  if (!decision.action || !VALID_ACTIONS.includes(decision.action)) {
    return { valid: false, error: `invalid action: ${decision.action}` };
  }
  const required = PARAM_RULES[decision.action];
  const params = decision.params || {};
  for (const key of required) {
    if (!(key in params)) {
      return { valid: false, error: `missing param "${key}" for action "${decision.action}"` };
    }
  }
  return { valid: true };
}
```

**Step 4: 实现策略 Prompt 模板**

```js
// skywars/strategy/prompts.js
const BASE_PROMPT = `你是一个参与 Minecraft SkyWars 对战的 AI Bot。
每轮你会收到当前状态快照（JSON），你需要从以下动作中选择一个：

可用动作：
- loot_chest: 开箱搜刮（无参数）
- bridge_to: 搭路到指定岛屿（params: { target_island: "center" | "island_A".."island_H" }）
- attack: 近战攻击（params: { target_player: "玩家名" }）
- ranged_attack: 远程攻击（params: { target_player: "玩家名", weapon: "bow"|"snowball"|"egg" }）
- use_item: 使用物品（params: { item: "ender_pearl"|"golden_apple" }）
- retreat: 撤退（params: { direction: "north"|"south"|"east"|"west"|"back_to_island" }）
- destroy_bridge: 拆桥（params: { bridge_id: "island_A_to_center" }）
- wait: 原地等待（无参数）

回复格式（严格 JSON）：
{
  "reasoning": "你的分析（中文）",
  "action": "动作名",
  "params": { ... }
}`;

export const PERSONAS = {
  aggressive: {
    name: 'Aggressive',
    prompt: `${BASE_PROMPT}\n\n你的性格：激进型。优先冲中岛抢最好装备，积极寻找战斗机会，宁可冒险也不猥琐。遇到敌人优先正面进攻。`,
  },
  cautious: {
    name: 'Cautious',
    prompt: `${BASE_PROMPT}\n\n你的性格：保守型。优先搜刮周围岛屿资源，避免早期战斗。等其他人互相消耗后再出手。搭路时注意防守，不轻易暴露自己。`,
  },
  controller: {
    name: 'Controller',
    prompt: `${BASE_PROMPT}\n\n你的性格：控制型。优先占据有利地形，用弓箭和雪球压制搭路的敌人。善于拆桥断路，把敌人困在不利位置。`,
  },
  gambler: {
    name: 'Gambler',
    prompt: `${BASE_PROMPT}\n\n你的性格：赌徒型。喜欢用末影珍珠偷袭、冲中岛抢装备、在桥上和人对拼。宁可轰轰烈烈地输也不愿无聊地赢。`,
  },
};
```

**Step 5: Commit**

```bash
git add skywars/strategy/
git commit -m "feat(skywars): add LLM strategy layer — client, schema validation, persona prompts"
```

---

### Task 8: Action Dispatcher — LLM 指令到模块调用

**Files:**
- Create: `skywars/strategy/action-dispatcher.js`

**Step 1: 实现 dispatcher**

将 LLM 返回的 `{ action, params }` 翻译为对应模块的函数调用。

```js
// skywars/strategy/action-dispatcher.js
import { bridge } from '../modules/bridging.js';
import { lootAndEquip } from '../modules/loot.js';
import { meleeAttack, rangedAttack, retreat } from '../modules/combat.js';

export async function dispatch(bot, decision, mapConfig) {
  const { action, params } = decision;
  console.log(`[dispatch] ${bot.username}: ${action} ${JSON.stringify(params || {})}`);

  try {
    switch (action) {
      case 'loot_chest':
        return await lootAndEquip(bot, 16);

      case 'bridge_to': {
        const target = mapConfig.islands[params.target_island];
        if (!target) return { success: false, reason: `unknown island: ${params.target_island}` };
        return await bridge(bot, target);
      }

      case 'attack':
        return await meleeAttack(bot, params.target_player);

      case 'ranged_attack':
        return await rangedAttack(bot, params.target_player, params.weapon);

      case 'use_item':
        return await useItem(bot, params.item);

      case 'retreat':
        return await retreat(bot, directionToVec(params.direction));

      case 'destroy_bridge':
        return await destroyBridge(bot, params.bridge_id, mapConfig);

      case 'wait':
        return { success: true, action: 'wait' };

      default:
        return { success: false, reason: `unknown action: ${action}` };
    }
  } catch (err) {
    console.log(`[dispatch] error executing ${action}: ${err.message}`);
    return { success: false, reason: err.message };
  }
}

async function useItem(bot, itemName) {
  const item = bot.inventory.items().find(i => i.name.includes(itemName));
  if (!item) return { success: false, reason: `item not found: ${itemName}` };

  await bot.equip(item, 'hand');

  if (itemName === 'ender_pearl') {
    // Throw toward nearest enemy or center
    const target = Object.values(bot.players)
      .filter(p => p.entity && p.username !== bot.username)
      .sort((a, b) => bot.entity.position.distanceTo(a.entity.position) - bot.entity.position.distanceTo(b.entity.position))[0];

    if (target?.entity) {
      await bot.lookAt(target.entity.position, true);
    }
    bot.activateItem();
  } else if (itemName === 'golden_apple') {
    bot.activateItem();
  }

  return { success: true, item: itemName };
}

async function destroyBridge(bot, bridgeId, mapConfig) {
  // bridgeId format: "island_A_to_center"
  // Find bridge blocks along the path and break them
  // Simplified: break blocks in the path between two islands
  return { success: false, reason: 'destroy_bridge not yet implemented' };
}

function directionToVec(direction) {
  const map = {
    north: { x: 0, y: 0, z: -1 },
    south: { x: 0, y: 0, z: 1 },
    east: { x: 1, y: 0, z: 0 },
    west: { x: -1, y: 0, z: 0 },
  };
  return map[direction] || null;
}
```

**Step 2: Commit**

```bash
git add skywars/strategy/action-dispatcher.js
git commit -m "feat(skywars): add action dispatcher — LLM decisions to module calls"
```

---

### Task 9: Game Coordinator — 回合调度引擎

**Files:**
- Create: `skywars/coordinator.js`
- Create: `skywars/maps/islands.js`

**Step 1: 实现地图配置**

```js
// skywars/maps/islands.js
// 8 岛 + 中岛，圆形排列，间距 ~30 格
// Y=65 为地面层，spawn 点 Y=66

const RADIUS = 30;
const CENTER = { x: 0, y: 66, z: 0 };

function islandPos(angleDeg) {
  const rad = (angleDeg * Math.PI) / 180;
  return {
    x: Math.round(CENTER.x + RADIUS * Math.cos(rad)),
    y: CENTER.y,
    z: Math.round(CENTER.z + RADIUS * Math.sin(rad)),
  };
}

const islands = {
  center: CENTER,
  island_A: islandPos(0),
  island_B: islandPos(45),
  island_C: islandPos(90),
  island_D: islandPos(135),
  island_E: islandPos(180),
  island_F: islandPos(225),
  island_G: islandPos(270),
  island_H: islandPos(315),
};

// Island assignments for spawning bots
const spawnIslands = ['island_A', 'island_B', 'island_C', 'island_D', 'island_E', 'island_F', 'island_G', 'island_H'];

export default { islands, spawnIslands, center: CENTER };
```

**Step 2: 实现 Game Coordinator**

```js
// skywars/coordinator.js
import mineflayer from 'mineflayer';
import { pathfinder } from 'mineflayer-pathfinder';
import { plugin as pvp } from 'mineflayer-pvp';
import config from './config.js';
import mapConfig from './maps/islands.js';
import { generateSnapshot } from './modules/perception.js';
import { getDecision } from './strategy/llm-client.js';
import { dispatch } from './strategy/action-dispatcher.js';
import { PERSONAS } from './strategy/prompts.js';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

class GameCoordinator {
  constructor(botConfigs) {
    // botConfigs: [{ username, persona }]
    this.botConfigs = botConfigs;
    this.bots = new Map();          // username → mineflayer bot
    this.gameState = {
      round: 0,
      phase: 'early_game',
      mapState: {
        islands_looted: [],
        bridges_built: [],
        players_alive: botConfigs.length,
        players_dead: [],
      },
      recentEvents: [],
    };
  }

  async start() {
    console.log(`[coordinator] starting game with ${this.botConfigs.length} bots`);

    // Connect all bots
    await this.connectBots();

    // Main game loop
    while (this.gameState.mapState.players_alive > 1 && this.gameState.round < config.game.maxRounds) {
      this.gameState.round++;
      this.updatePhase();
      console.log(`\n=== Round ${this.gameState.round} (${this.gameState.phase}) ===`);

      // Collect snapshots and get decisions in parallel
      const decisions = await this.collectDecisions();

      // Execute decisions sequentially
      for (const [username, decision] of decisions) {
        if (!this.isAlive(username)) continue;
        console.log(`[coordinator] ${username} → ${decision.action}: ${decision.reasoning?.slice(0, 80)}`);
        const result = await dispatch(this.bots.get(username), decision, mapConfig);
        this.recordEvent(username, decision, result);
      }

      // Check for deaths (fallen into void or health <= 0)
      this.checkDeaths();

      console.log(`[coordinator] alive: ${this.gameState.mapState.players_alive}, dead: ${this.gameState.mapState.players_dead.join(', ')}`);

      // Wait between rounds
      await sleep(2000);
    }

    // Game over
    const winner = this.getAlivePlayers();
    console.log(`\n=== GAME OVER ===`);
    console.log(`Winner: ${winner.length > 0 ? winner.join(', ') : 'no one (draw)'}`);
    console.log(`Total rounds: ${this.gameState.round}`);

    this.disconnectAll();
  }

  async connectBots() {
    const connectPromises = this.botConfigs.map(async (cfg, i) => {
      const bot = mineflayer.createBot({
        ...config.server,
        username: cfg.username,
      });
      bot.loadPlugin(pathfinder);
      bot.loadPlugin(pvp);

      await new Promise(r => bot.once('spawn', r));
      await sleep(1000);

      // TP to spawn island
      const island = mapConfig.spawnIslands[i];
      const pos = mapConfig.islands[island];
      bot.chat(`/tp ${cfg.username} ${pos.x} ${pos.y} ${pos.z}`);
      bot.chat(`/give ${cfg.username} cobblestone 64`);
      await sleep(500);

      this.bots.set(cfg.username, bot);
      console.log(`[coordinator] ${cfg.username} (${cfg.persona}) spawned on ${island}`);
    });

    await Promise.all(connectPromises);
  }

  async collectDecisions() {
    const alivePlayers = this.getAlivePlayers();
    const decisionPromises = alivePlayers.map(async (username) => {
      const bot = this.bots.get(username);
      const cfg = this.botConfigs.find(c => c.username === username);
      const persona = PERSONAS[cfg.persona];

      const snapshot = generateSnapshot(bot, this.gameState);
      const decision = await getDecision(snapshot, persona.prompt);

      return [username, decision];
    });

    const results = await Promise.allSettled(decisionPromises);
    return results
      .filter(r => r.status === 'fulfilled')
      .map(r => r.value);
  }

  isAlive(username) {
    return !this.gameState.mapState.players_dead.includes(username);
  }

  getAlivePlayers() {
    return this.botConfigs
      .map(c => c.username)
      .filter(u => this.isAlive(u));
  }

  checkDeaths() {
    for (const [username, bot] of this.bots) {
      if (!this.isAlive(username)) continue;
      // Void death (Y < 0) or health death
      if (bot.entity.position.y < 0 || bot.health <= 0) {
        this.gameState.mapState.players_dead.push(username);
        this.gameState.mapState.players_alive--;
        this.gameState.recentEvents.push(`${username} died (Round ${this.gameState.round})`);
        console.log(`[coordinator] ${username} DIED`);
      }
    }
  }

  recordEvent(username, decision, result) {
    const summary = `${username}: ${decision.action} → ${result.success !== false ? 'success' : result.reason || 'failed'}`;
    this.gameState.recentEvents.push(`${summary} (Round ${this.gameState.round})`);
  }

  updatePhase() {
    const r = this.gameState.round;
    if (r <= 3) this.gameState.phase = 'early_game';
    else if (r <= 10) this.gameState.phase = 'mid_game';
    else if (r <= 20) this.gameState.phase = 'late_game';
    else this.gameState.phase = 'final';
  }

  disconnectAll() {
    for (const [, bot] of this.bots) {
      bot.quit();
    }
  }
}

// --- CLI Entry Point ---

const botConfigs = [
  { username: 'Bot_Aggressive', persona: 'aggressive' },
  { username: 'Bot_Cautious', persona: 'cautious' },
  { username: 'Bot_Controller', persona: 'controller' },
  { username: 'Bot_Gambler', persona: 'gambler' },
];

// Allow overriding bot count via CLI arg
const botCount = parseInt(process.argv[2]) || botConfigs.length;
const activeBots = botConfigs.slice(0, botCount);

const game = new GameCoordinator(activeBots);
game.start().catch(err => {
  console.error('[coordinator] fatal:', err);
  process.exit(1);
});
```

**Step 3: Commit**

```bash
git add skywars/coordinator.js skywars/maps/islands.js
git commit -m "feat(skywars): add Game Coordinator — round-based scheduling engine"
```

---

### Task 10: Phase 3 集成测试 — 2 Bot LLM 对战

**Files:**
- Create: `skywars/tests/test-2bot-llm.js`

**Step 1: 创建 2 bot 测试**

```js
// skywars/tests/test-2bot-llm.js
// 最小化测试：2 个 LLM bot，各在一个岛上，观察 3 轮决策
import mineflayer from 'mineflayer';
import { pathfinder } from 'mineflayer-pathfinder';
import { plugin as pvp } from 'mineflayer-pvp';
import config from '../config.js';
import { generateSnapshot } from '../modules/perception.js';
import { getDecision } from '../strategy/llm-client.js';
import { PERSONAS } from '../strategy/prompts.js';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const bots = [];

  for (const { name, persona } of [
    { name: 'Test_Aggro', persona: 'aggressive' },
    { name: 'Test_Cautious', persona: 'cautious' },
  ]) {
    const bot = mineflayer.createBot({ ...config.server, username: name });
    bot.loadPlugin(pathfinder);
    bot.loadPlugin(pvp);
    await new Promise(r => bot.once('spawn', r));
    await sleep(1000);
    bots.push({ bot, name, persona });
  }

  // TP to positions
  bots[0].bot.chat('/tp Test_Aggro 8 117 -10');
  bots[1].bot.chat('/tp Test_Cautious 23 117 -10');
  bots[0].bot.chat('/give Test_Aggro cobblestone 64');
  bots[1].bot.chat('/give Test_Cautious cobblestone 64');
  await sleep(2000);

  const gameState = {
    round: 0,
    phase: 'early_game',
    mapState: { islands_looted: [], bridges_built: [], players_alive: 2, players_dead: [] },
    recentEvents: [],
  };

  // Run 3 rounds
  for (let round = 1; round <= 3; round++) {
    gameState.round = round;
    console.log(`\n--- Round ${round} ---`);

    for (const { bot, name, persona } of bots) {
      const snapshot = generateSnapshot(bot, gameState);
      console.log(`[${name}] snapshot position: (${snapshot.self.position.x}, ${snapshot.self.position.y}, ${snapshot.self.position.z})`);

      const decision = await getDecision(snapshot, PERSONAS[persona].prompt);
      console.log(`[${name}] decision: ${decision.action} — ${decision.reasoning?.slice(0, 100)}`);
    }

    await sleep(1000);
  }

  bots.forEach(b => b.bot.quit());
  console.log('\n[test] 2-bot LLM test complete');
}

main().catch(err => {
  console.error('[test] fatal:', err);
  process.exit(1);
});
```

**Step 2: 运行（需要 ANTHROPIC_API_KEY 环境变量）**

Run: `cd skywars && ANTHROPIC_API_KEY=sk-xxx node tests/test-2bot-llm.js`

Expected: 每轮每个 bot 打印 snapshot 和 LLM 决策

**Step 3: Commit**

```bash
git add skywars/tests/test-2bot-llm.js
git commit -m "test(skywars): 2-bot LLM decision test — verify strategy layer"
```

---

## Phase 4: 完整 SkyWars 对战

### Task 11: 地图搭建脚本 — 8 岛 + 中岛

**Files:**
- Create: `skywars/tests/setup-arena.js`

**Step 1: 实现 arena 搭建**

用 bot 连接服务器，通过 `/fill` 命令创建 8 个出生岛（5x5 石头平台）+ 中岛（7x7）+ 每个出生岛上放置箱子。

```js
// skywars/tests/setup-arena.js
import mineflayer from 'mineflayer';
import config from '../config.js';
import mapConfig from '../maps/islands.js';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const bot = mineflayer.createBot({ ...config.server, username: 'ArenaBuilder' });
  await new Promise(r => bot.once('spawn', r));
  await sleep(2000);

  const y = 65; // ground level

  // Clear large area
  console.log('[setup] clearing area...');
  bot.chat(`/fill -45 ${y - 1} -45 45 ${y + 20} 45 air`);
  await sleep(3000);

  // Build center island (7x7)
  console.log('[setup] building center island...');
  const c = mapConfig.center;
  bot.chat(`/fill ${c.x - 3} ${y} ${c.z - 3} ${c.x + 3} ${y} ${c.z + 3} stone`);
  await sleep(1000);
  // Center chest with good loot
  bot.chat(`/setblock ${c.x} ${y + 1} ${c.z} chest`);
  await sleep(500);

  // Build 8 spawn islands (5x5 each)
  for (const islandName of mapConfig.spawnIslands) {
    const pos = mapConfig.islands[islandName];
    console.log(`[setup] building ${islandName} at (${pos.x}, ${y}, ${pos.z})...`);
    bot.chat(`/fill ${pos.x - 2} ${y} ${pos.z - 2} ${pos.x + 2} ${y} ${pos.z + 2} stone`);
    await sleep(800);
    // Place chest on each island
    bot.chat(`/setblock ${pos.x} ${y + 1} ${pos.z} chest`);
    await sleep(500);
  }

  console.log('[setup] arena complete!');
  console.log('[setup] islands:', Object.entries(mapConfig.islands).map(([k, v]) => `${k}: (${v.x}, ${v.z})`).join(', '));

  await sleep(1000);
  bot.quit();
}

main().catch(err => {
  console.error('[setup] fatal:', err);
  process.exit(1);
});
```

**Step 2: 运行**

Run: `cd skywars && node tests/setup-arena.js`

Expected: 服务器上创建 9 个平台，每个有箱子

**Step 3: Commit**

```bash
git add skywars/tests/setup-arena.js
git commit -m "feat(skywars): arena setup script — 8 islands + center with chests"
```

---

### Task 12: 补全剩余动作 — destroy_bridge

**Files:**
- Modify: `skywars/strategy/action-dispatcher.js`

**Step 1: 实现 destroy_bridge**

在 action-dispatcher.js 中补全 `destroyBridge` 函数：扫描两岛之间的方块，逐个破坏非原始岛屿的方块（cobblestone/其他搭路方块）。

```js
async function destroyBridge(bot, bridgeId, mapConfig) {
  // bridgeId: "island_A_to_center"
  const parts = bridgeId.split('_to_');
  if (parts.length !== 2) return { success: false, reason: 'invalid bridge_id format' };

  const fromIsland = parts[0];
  const toIsland = parts[1];
  const from = mapConfig.islands[fromIsland];
  const to = mapConfig.islands[toIsland];
  if (!from || !to) return { success: false, reason: 'unknown islands in bridge_id' };

  // Find and break cobblestone blocks along the path
  const bridgeBlocks = bot.findBlocks({
    matching: block => block.name === 'cobblestone',
    maxDistance: 50,
    count: 100,
  }).filter(pos => {
    // Only blocks roughly between the two islands
    const minX = Math.min(from.x, to.x) - 2;
    const maxX = Math.max(from.x, to.x) + 2;
    const minZ = Math.min(from.z, to.z) - 2;
    const maxZ = Math.max(from.z, to.z) + 2;
    return pos.x >= minX && pos.x <= maxX && pos.z >= minZ && pos.z <= maxZ;
  });

  let broken = 0;
  for (const pos of bridgeBlocks.slice(0, 5)) { // Max 5 blocks per round
    try {
      const block = bot.blockAt(pos);
      if (block && block.diggable) {
        await bot.dig(block);
        broken++;
      }
    } catch { /* can't reach */ }
  }

  return { success: broken > 0, blocksBroken: broken };
}
```

**Step 2: Commit**

```bash
git add skywars/strategy/action-dispatcher.js
git commit -m "feat(skywars): implement destroy_bridge action"
```

---

### Task 13: 完整对战测试 — 4 Bot Match

**Files:**
- Create: `skywars/tests/test-full-match.js`

**Step 1: 创建完整对战测试**

```js
// skywars/tests/test-full-match.js
// 启动 4 个 LLM bot 进行完整 SkyWars 对战
// 使用: ANTHROPIC_API_KEY=sk-xxx node tests/test-full-match.js [bot_count]

// 直接使用 coordinator.js，它已经是 CLI 入口
console.log('Run directly: node coordinator.js [bot_count]');
console.log('Example: ANTHROPIC_API_KEY=sk-xxx node coordinator.js 4');
console.log('Make sure to run tests/setup-arena.js first to create the map');
```

实际测试直接运行 `coordinator.js`：

Run: `cd skywars && ANTHROPIC_API_KEY=sk-xxx node coordinator.js 4`

Expected: 4 个 bot 按回合制对战，每轮打印决策和执行结果，最终输出胜者

**Step 2: 根据测试结果调优**

- 调整 `prompts.js` 中各性格的提示词
- 调整 `config.js` 中的超时、血量阈值等参数
- 修复 dispatcher 中发现的 edge case

**Step 3: Commit**

```bash
git add skywars/tests/test-full-match.js
git commit -m "test(skywars): full match test script for 4-bot SkyWars"
```

---

## Phase 5: 锦标赛与统计

### Task 14: 统计收集模块

**Files:**
- Create: `skywars/match/stats.js`

**Step 1: 实现 stats 模块**

```js
// skywars/match/stats.js

export class MatchStats {
  constructor() {
    this.matches = [];
  }

  recordMatch(result) {
    // result: { winner, rounds, players: [{ name, persona, kills, roundsSurvived, damageDealt }] }
    this.matches.push({
      ...result,
      timestamp: new Date().toISOString(),
    });
  }

  getPersonaWinRate() {
    const wins = {};
    const total = {};

    for (const match of this.matches) {
      for (const player of match.players) {
        total[player.persona] = (total[player.persona] || 0) + 1;
        if (player.name === match.winner) {
          wins[player.persona] = (wins[player.persona] || 0) + 1;
        }
      }
    }

    const rates = {};
    for (const persona of Object.keys(total)) {
      rates[persona] = {
        wins: wins[persona] || 0,
        total: total[persona],
        winRate: ((wins[persona] || 0) / total[persona] * 100).toFixed(1) + '%',
      };
    }
    return rates;
  }

  getSummary() {
    return {
      totalMatches: this.matches.length,
      winRates: this.getPersonaWinRate(),
      avgRoundsPerMatch: this.matches.length > 0
        ? (this.matches.reduce((s, m) => s + m.rounds, 0) / this.matches.length).toFixed(1)
        : 0,
    };
  }

  exportJSON() {
    return JSON.stringify({ matches: this.matches, summary: this.getSummary() }, null, 2);
  }
}
```

**Step 2: Commit**

```bash
git add skywars/match/stats.js
git commit -m "feat(skywars): add match statistics collection"
```

---

### Task 15: Match Manager — 锦标赛管理

**Files:**
- Create: `skywars/match/match-manager.js`

**Step 1: 实现 match manager**

自动运行多场对战，收集统计，输出结果报告。

```js
// skywars/match/match-manager.js
import { MatchStats } from './stats.js';
import { writeFileSync } from 'fs';

// Coordinator 需要被重构为可导入的类（而非直接执行的脚本）
// 此文件将在 coordinator.js 被重构为 export class 后使用

export class MatchManager {
  constructor(GameCoordinator, botConfigs, matchCount = 5) {
    this.GameCoordinator = GameCoordinator;
    this.botConfigs = botConfigs;
    this.matchCount = matchCount;
    this.stats = new MatchStats();
  }

  async runTournament() {
    console.log(`[tournament] starting ${this.matchCount} matches`);

    for (let i = 1; i <= this.matchCount; i++) {
      console.log(`\n====== Match ${i}/${this.matchCount} ======`);
      const game = new this.GameCoordinator(this.botConfigs);
      const result = await game.start();
      this.stats.recordMatch(result);

      console.log(`[tournament] Match ${i} complete. Winner: ${result.winner}`);

      // Cooldown between matches
      await new Promise(r => setTimeout(r, 5000));
    }

    const summary = this.stats.getSummary();
    console.log('\n====== TOURNAMENT RESULTS ======');
    console.log(JSON.stringify(summary, null, 2));

    // Save to file
    const outputPath = `results/tournament-${Date.now()}.json`;
    writeFileSync(outputPath, this.stats.exportJSON());
    console.log(`[tournament] results saved to ${outputPath}`);
  }
}
```

**Step 2: Commit**

```bash
git add skywars/match/match-manager.js
git commit -m "feat(skywars): add match manager for automated tournaments"
```

---

### Task 16: Coordinator 重构 — 导出为类并返回结果

**Files:**
- Modify: `skywars/coordinator.js`

**Step 1: 重构 coordinator**

将 `GameCoordinator` 类改为 `export class`，`start()` 方法返回 match result 对象，CLI 入口逻辑移到文件底部的 `if` 块中。

修改 `start()` 的末尾：

```js
// 在 start() 方法末尾，return match result 而非 void
const winner = this.getAlivePlayers();
const result = {
  winner: winner[0] || null,
  rounds: this.gameState.round,
  players: this.botConfigs.map(cfg => ({
    name: cfg.username,
    persona: cfg.persona,
    survived: this.isAlive(cfg.username),
  })),
};

this.disconnectAll();
return result;
```

文件底部：

```js
// CLI entry (only when run directly)
const isMain = process.argv[1]?.endsWith('coordinator.js');
if (isMain) {
  // ...existing CLI code...
}

export { GameCoordinator };
```

**Step 2: 验证 CLI 仍然正常工作**

Run: `cd skywars && node coordinator.js 2`

**Step 3: Commit**

```bash
git add skywars/coordinator.js
git commit -m "refactor(skywars): export GameCoordinator class, return match results"
```

---

## 任务依赖关系

```
Task 1 (config) ─────┬──→ Task 2 (loot) ──┬──→ Task 5 (integration)
                      ├──→ Task 3 (combat) ─┤
                      └──→ Task 4 (bridging refactor)
                                            │
Task 6 (perception) ──┬──→ Task 9 (coordinator) ──→ Task 10 (2bot test)
Task 7 (LLM client) ──┤
Task 8 (dispatcher) ──┘
                                                    │
Task 11 (arena setup) ─────────────────────────────→ Task 13 (full match)
Task 12 (destroy_bridge) ──────────────────────────→┘
                                                    │
Task 14 (stats) ──┬──→ Task 15 (match manager) ──→ Task 16 (coordinator refactor)
                  └──→┘
```

**总计 16 个 Task，覆盖 Phase 2-5 全部内容。**
