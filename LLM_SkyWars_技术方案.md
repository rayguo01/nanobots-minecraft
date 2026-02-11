# LLM-Controlled Bot SkyWars — Minecraft AI 对抗系统技术方案

> 2026.02 | Draft v1.0

---

## 1. 项目概述

本项目旨在搭建一个由 LLM（大语言模型）控制的 Minecraft SkyWars 对抗平台。多个 AI Bot 在空岛战争地图中自主决策、搜集资源、搭路进攻、PvP 战斗，最终决出胜负。

**核心设计思路：** 由于所有参与者都是 Bot，可以采用"准回合制"节奏——每个 Bot 每隔固定时间间隔（如 30 秒）进行一次决策，彻底规避 LLM 推理延迟问题，将竞技重心从"操作精度"转移到"策略质量"——这恰好是 LLM 最擅长的领域。

**项目价值：**

- 探索 LLM 在实时对抗游戏中的策略决策能力
- 对比不同 LLM / 不同 Prompt 策略风格的胜率差异
- 产出具有观赏性的 AI 对战内容（直播/录像），适合 YouTube / B站传播

---

## 2. 系统架构

系统采用三层架构设计，将 LLM 的高层策略能力与硬编码的底层操作解耦：

### 2.1 架构分层

| 层级 | 职责 | 详细说明 |
|------|------|----------|
| **LLM 策略层** | 高层决策 | 每轮分析当前局势，输出结构化的战略指令。例如："搭路到中岛""攻击玩家A""撤退"等。支持不同 LLM 或不同 Prompt 实现差异化策略风格。 |
| **战术中间层** | 任务分解与态势感知 | 将 LLM 的高层指令翻译为可执行的任务序列。负责路径规划、威胁评估、资源管理等。由 JavaScript 逻辑实现。 |
| **执行底层** | 精确操作控制 | 硬编码的 Mineflayer 操作模块，负责搭路、开箱、穿装备、PvP 战斗等需要精确控制的动作。不依赖 LLM。 |

### 2.2 架构图

```
┌─────────────────────────────────────────────────┐
│                  Game Coordinator                │
│          (回合调度 / 状态收集 / 胜负判定)          │
└──────────┬──────────┬──────────┬────────────────┘
           │          │          │
     ┌─────▼────┐ ┌───▼──────┐ ┌▼─────────┐
     │  Bot #1  │ │  Bot #2  │ │  Bot #N  │
     │          │ │          │ │          │
     │ ┌──────┐ │ │ ┌──────┐ │ │ ┌──────┐ │
     │ │ LLM  │ │ │ │ LLM  │ │ │ │ LLM  │ │  ← 策略层 (Claude/GPT/...)
     │ │ 策略 │ │ │ │ 策略 │ │ │ │ 策略 │ │
     │ └──┬───┘ │ │ └──┬───┘ │ │ └──┬───┘ │
     │ ┌──▼───┐ │ │ ┌──▼───┐ │ │ ┌──▼───┐ │
     │ │ 战术 │ │ │ │ 战术 │ │ │ │ 战术 │ │  ← 中间层 (JS 逻辑)
     │ │ 中间 │ │ │ │ 中间 │ │ │ │ 中间 │ │
     │ └──┬───┘ │ │ └──┬───┘ │ │ └──┬───┘ │
     │ ┌──▼───┐ │ │ ┌──▼───┐ │ │ ┌──▼───┐ │
     │ │底层  │ │ │ │底层  │ │ │ │底层  │ │  ← 执行层 (Mineflayer)
     │ │执行  │ │ │ │执行  │ │ │ │执行  │ │
     │ └──────┘ │ │ └──────┘ │ │ └──────┘ │
     └──────────┘ └──────────┘ └──────────┘
           │          │          │
     ┌─────▼──────────▼──────────▼────────────────┐
     │           Minecraft Server                  │
     │     (Paper + SkyWarsReloaded 插件)           │
     └────────────────────────────────────────────┘
```

---

## 3. 游戏流程与回合机制

### 3.1 SkyWars 地图结构

```
                    ┌─────┐
                    │ 岛E  │
                    └──┬──┘
              ┌─────┐  │  ┌─────┐
              │ 岛D  │──┼──│ 岛F  │
              └──┬──┘  │  └──┬──┘
                 │  ┌──▼──┐  │
                 ├──│ 中岛 │──┤     ← 最优装备箱
                 │  └──▲──┘  │
              ┌──▼──┐  │  ┌──▼──┐
              │ 岛C  │──┼──│ 岛G  │
              └─────┘  │  └─────┘
                    ┌──▼──┐
                    │ 岛H  │
                    └─────┘

    每个外圈岛 = 1个Bot出生点 + 1-2个基础箱子
    岛之间隔虚空（~15格），掉落即死
```

### 3.2 回合制调度流程

由于所有玩家都是 Bot，不需要实时竞争，可以采用同步回合制：

```
Round N 开始
  │
  ├─→ Coordinator 收集所有 Bot 的状态快照
  │     (位置、血量、装备、背包、视野内敌人)
  │
  ├─→ 并行发送状态到每个 Bot 的 LLM
  │     (各 Bot 独立决策，互不干扰)
  │
  ├─→ 等待所有 Bot 返回决策 (超时30秒)
  │
  ├─→ 按顺序执行各 Bot 的动作
  │     (底层模块执行搭路/战斗/开箱等)
  │
  ├─→ 结算伤害、击杀、掉落
  │
  └─→ Round N+1
```

**关键设计：** 等待所有 Bot 决策完成后再统一执行，确保公平性。每轮时间预算 = LLM 推理时间（通常 3-10 秒）+ 动作执行时间（取决于动作复杂度）。

### 3.3 游戏阶段

| 阶段 | 回合数（参考） | 特点 |
|------|--------------|------|
| 开局搜刮 | 1-3 轮 | Bot 开箱、穿装备、评估资源 |
| 搭路进攻 | 4-10 轮 | Bot 选择目标方向搭路，接近其他岛屿 |
| 中期混战 | 11-20 轮 | 多个 Bot 遭遇，发生 PvP 战斗 |
| 决战 | 20+ 轮 | 剩余 2-3 个 Bot，最终对决 |

---

## 4. LLM 决策接口设计

### 4.1 输入：状态快照（State Snapshot）

每轮发送给 LLM 的 JSON 结构：

```json
{
  "round": 7,
  "phase": "mid_game",
  "self": {
    "position": { "island": "island_C", "x": 15, "y": 68, "z": -22 },
    "health": 16,
    "hunger": 18,
    "equipment": {
      "helmet": "iron_helmet",
      "chestplate": "leather_chestplate",
      "leggings": null,
      "boots": "iron_boots",
      "weapon": "iron_sword",
      "offhand": null
    },
    "inventory": [
      { "item": "cobblestone", "count": 42 },
      { "item": "bow", "count": 1 },
      { "item": "arrow", "count": 8 },
      { "item": "snowball", "count": 3 },
      { "item": "ender_pearl", "count": 1 },
      { "item": "golden_apple", "count": 1 }
    ]
  },
  "visible_players": [
    {
      "name": "Bot_Aggressive",
      "position": { "island": "center", "x": 0, "y": 70, "z": 0 },
      "distance": 18,
      "estimated_equipment": "diamond_armor",
      "health_estimate": "high",
      "current_action": "looting"
    },
    {
      "name": "Bot_Cautious",
      "position": { "island": "island_D", "x": -20, "y": 68, "z": 10 },
      "distance": 25,
      "estimated_equipment": "iron_armor",
      "health_estimate": "medium",
      "current_action": "bridging_toward_center"
    }
  ],
  "map_state": {
    "islands_looted": ["island_C", "island_D", "center_partial"],
    "bridges_built": [
      { "from": "island_C", "to": "center", "builder": "self" },
      { "from": "island_D", "to": "center", "builder": "Bot_Cautious" }
    ],
    "players_alive": 4,
    "players_dead": ["Bot_Rusher", "Bot_Sniper", "Bot_Random"]
  },
  "recent_events": [
    "Bot_Rusher 被 Bot_Aggressive 击杀 (Round 5)",
    "Bot_Sniper 掉入虚空 (Round 6)",
    "你在 Round 6 成功搭路到中岛边缘"
  ]
}
```

### 4.2 输出：动作指令（Action Command）

LLM 从有限的动作空间中选择一个指令输出：

| 动作 | 参数 | 说明 |
|------|------|------|
| `loot_chest` | 无 | 开启当前岛上的箱子，自动穿最优装备 |
| `bridge_to` | `target_island` | 搭路到指定岛屿，底层自动计算路径 |
| `attack` | `target_player` | 向指定玩家发起近战攻击 |
| `ranged_attack` | `target_player`, `weapon` | 弓箭/雪球/蛋远程攻击 |
| `use_item` | `item` | 使用末影珍珠/金苹果等消耗品 |
| `retreat` | `direction` | 向指定方向撤退 |
| `destroy_bridge` | `bridge_id` | 破坏某条桥，切断敌人路线 |
| `wait` | 无 | 原地观察，不采取行动 |

**LLM 输出示例：**

```json
{
  "reasoning": "中岛有钻石装备的 Bot_Aggressive，正面硬打不划算。Bot_Cautious 正在搭路去中岛，我可以先用雪球骚扰他，如果把他打下虚空就少一个对手。之后再绕路从另一侧接近中岛。",
  "action": "ranged_attack",
  "params": {
    "target_player": "Bot_Cautious",
    "weapon": "snowball"
  }
}
```

### 4.3 LLM System Prompt 策略模板

通过不同的 System Prompt 赋予 Bot 不同的性格和策略倾向：

**激进型（Aggressive）：**
> 你是一个激进的 SkyWars 战士。优先冲中岛抢夺最好装备，积极寻找战斗机会，宁可冒险也不猥琐。遇到敌人优先正面进攻。

**保守型（Cautious）：**
> 你是一个谨慎的 SkyWars 玩家。优先搜刮周围岛屿的资源，避免早期战斗。等其他人互相消耗后再出手。搭路时注意防守，不轻易暴露自己。

**控制型（Controller）：**
> 你是一个擅长区域控制的 SkyWars 玩家。优先占据有利地形，用弓箭和雪球压制搭路的敌人。善于拆桥断路，把敌人困在不利位置。

**赌徒型（Gambler）：**
> 你是一个高风险高回报的 SkyWars 玩家。喜欢用末影珍珠偷袭、冲中岛抢装备、在桥上和人对拼。宁可轰轰烈烈地输也不愿无聊地赢。

---

## 5. 底层执行模块设计（Mineflayer）

### 5.1 技术栈

| 组件 | 技术选型 | 说明 |
|------|---------|------|
| Minecraft 服务端 | Paper 1.20.x | 高性能服务端，支持插件 |
| SkyWars 管理 | SkyWarsReloaded | 地图管理、箱子战利品、游戏流程 |
| Bot 客户端 | Mineflayer | Node.js Minecraft bot 框架 |
| 路径规划 | mineflayer-pathfinder | 基础寻路（需扩展虚空搭路） |
| PvP 战斗 | mineflayer-pvp | 基础近战/远程（需扩展击退判断） |
| LLM 接口 | Claude API / OpenAI API | 策略层推理 |
| 回合调度 | 自研 Game Coordinator | Node.js 实现的游戏主循环 |

### 5.2 核心模块

**bridging 模块（搭路）—— 难度最高：**

搭路是 SkyWars 中最核心的操作。Mineflayer 原生不支持虚空搭路，需要自行实现。核心逻辑：计算目标岛方向 → 控制视角朝脚下边缘 → 蹲下 → 放置方块 → 后退一格 → 循环。需要处理虚空检测、方块不足时中止、被攻击时中断等异常情况。

**combat 模块（战斗）：**

基于 mineflayer-pvp 扩展。增加虚空感知（被击退方向如果是虚空则优先回拉）、击退物品使用（雪球/蛋在桥上对战时优先于剑）、血量判断（低血量时触发撤退信号反馈给策略层）。

**loot 模块（开箱装备）：**

相对简单。使用 Mineflayer 的 window API 操作箱子，定义装备评分函数（钻石 > 铁 > 锁链 > 皮革），自动穿最优装备组合。物品按优先级排序存入背包：方块（搭路用）> 武器 > 药水 > 食物。

**perception 模块（感知）：**

每轮收集环境信息生成状态快照。包括：扫描视野内实体、估算敌人装备等级、追踪已知桥梁位置、记录最近事件日志。

### 5.3 模块交互流程

```
LLM 返回: { action: "bridge_to", params: { target: "center" } }
  │
  ▼
战术层: 计算到中岛的最优起点和方向
  │    检查方块库存是否足够 (距离 ÷ 1 = 所需方块数)
  │    如果不够 → 反馈给 LLM 建议更换目标
  │
  ▼
执行层: bridging 模块启动
  │    持续搭路直到到达目标 或 被攻击中断 或 方块耗尽
  │
  ▼
回合结束: 上报执行结果
  │    "成功到达中岛" / "搭到一半被雪球击落" / "方块不足，停在半途"
  │
  ▼
下一轮 LLM 决策基于新的状态
```

---

## 6. 分阶段实施计划

### Phase 1：基础搭路验证（1-2 周）

**目标：** 单个 Bot 能在两个岛之间成功搭路。

- 搭建 Paper 服务端 + 最简 SkyWars 地图（2 个岛，间隔 15 格）
- 实现 Mineflayer bridging 模块的基础版本
- Bot 登录 → 搭路到对面岛 → 成功到达
- 不涉及 LLM，纯硬编码验证底层操作可行性

### Phase 2：开箱与战斗模块（1-2 周）

**目标：** Bot 能完成开箱装备 + 击杀静止假人。

- 实现 loot 模块：自动开箱、装备评分、穿戴装备
- 实现 combat 模块基础版：近战攻击循环
- 测试场景：Bot 出生 → 开箱穿装备 → 搭路到对面岛 → 击杀 Dummy
- 加入虚空感知：被击退时判断是否有掉落风险

### Phase 3：LLM 策略层接入（1-2 周）

**目标：** LLM 能接收状态并返回有效决策。

- 实现 perception 模块和状态快照生成
- 实现 Game Coordinator 回合调度循环
- 接入 Claude API，定义 System Prompt
- 测试场景：2 个 LLM Bot 各在一个岛上，观察决策过程
- 调试 LLM 输出的结构化指令解析

### Phase 4：完整 SkyWars 对战（2-3 周）

**目标：** 4-8 个 Bot 在标准地图上完成一局完整 SkyWars。

- 制作标准 SkyWars 地图（8 个出生岛 + 中岛）
- 配置 SkyWarsReloaded 的战利品表
- 实现所有动作类型（远程攻击、使用物品、拆桥等）
- 完整对战测试，观察策略涌现行为
- 调优各策略 Prompt，平衡胜率

### Phase 5：锦标赛与内容制作（持续）

**目标：** 产出可观赏的 AI 对战内容。

- 设置不同策略风格的 Bot 进行锦标赛
- 接入观战摄像机视角（Replay Mod 或服务端旁观模式）
- 制作解说/配字幕的对战录像
- 收集统计数据：各策略胜率、平均存活轮数、击杀数等
- 迭代优化 Prompt 策略

---

## 7. 关键技术挑战与解决方案

### 7.1 虚空搭路的精确控制

**挑战：** Mineflayer-pathfinder 不支持虚空搭路，需要自行实现精确的视角控制和方块放置。

**方案：** 参考 SkyWars bot 社区的 bridging 算法，核心是控制 bot.look() 朝向脚下方块边缘，蹲下后放置方块。可以先实现最基础的后退搭路，不追求 Speed Bridge 或 God Bridge。回合制模式下速度不重要，稳定性优先。

### 7.2 LLM 输出的可靠性

**挑战：** LLM 可能输出格式错误、不合法的动作、或者不存在的目标。

**方案：** 战术中间层做严格的输出校验。定义 JSON Schema 验证 LLM 返回格式，不合法动作自动降级为 `wait`。加入重试机制：格式错误时附带错误信息重新请求一次。限制动作空间，LLM 只能从枚举列表中选择。

### 7.3 状态感知的准确性

**挑战：** Minecraft 中无法直接获取对方的精确装备信息，只能通过实体数据估算。

**方案：** 利用 Mineflayer 的 entity API 获取可见装备渲染信息（可以看到穿的什么甲）。血量可以通过 scoreboard 或插件辅助暴露。对于无法获取的信息（如背包内容），在状态快照中标记为 "unknown"，让 LLM 在不完全信息下决策——这本身就是一个有趣的挑战。

### 7.4 多 Bot 并发性能

**挑战：** 8 个 Bot 同时连接服务器 + 并行调用 LLM API。

**方案：** 每个 Bot 是独立的 Mineflayer 实例，在同一个 Node.js 进程中管理。LLM 调用使用 Promise.all() 并行发送，不串行等待。Paper 服务端对 bot 数量的支持无压力。API 并发考虑 rate limit，可能需要根据所用 LLM 服务调整。

---

## 8. 技术选型与部署

### 8.1 部署方案

| 组件 | 部署位置 | 说明 |
|------|---------|------|
| Paper 服务端 | Contabo VPS (Singapore) | 已有实例，延迟低 |
| Bot 进程 | 同一 VPS | 与服务端同机，网络延迟最小 |
| LLM API | Claude API (外部) | 通过公网调用，延迟 3-10 秒/轮可接受 |
| 录像/旁观 | 本地客户端 | 通过 Minecraft 客户端旁观模式连入 |

### 8.2 预估资源消耗

| 资源 | 估算 |
|------|------|
| 服务端内存 | Paper + 8 Bot ≈ 2-4 GB RAM |
| LLM API 费用 | 每轮每 Bot 约 1K tokens (输入) + 200 tokens (输出)，一局 20 轮 × 8 Bot ≈ 160K+ tokens/局 |
| 存储 | 地图 + 录像，可忽略 |

---

## 9. 扩展方向

**策略进化：** 记录每局对战日志，将历史战绩作为上下文注入 LLM，让 Bot 能从历史中"学习"和调整策略。

**多模型对抗赛：** Claude vs GPT vs Gemini vs 开源模型，对比不同 LLM 的游戏策略能力。

**直播平台：** 搭建自动化的比赛直播管线，定时开赛、自动录像、自动上传到视频平台。

**其他小游戏适配：** 架构通用化后可以迁移到 Bed Wars、Hunger Games 等其他 Minecraft 对抗小游戏。

**社区参与：** 开放自定义 Prompt 接口，让观众提交策略 Prompt 参加锦标赛。
