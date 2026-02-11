# SkyWars Phase 1 — 基础搭路验证

> 2026.02.11 | 基于 LLM_SkyWars_技术方案.md Phase 1

## 目标

单个 Bot 在两个平台之间成功搭路，纯硬编码验证底层操作可行性，不涉及 LLM。

## 架构决策

- `skywars/` 目录与 `mc-controller/` 平级，独立入口和依赖管理
- Phase 1 不 import mc-controller 代码，后续 Phase 按需引入底层工具函数
- 测试环境使用创造模式手动搭建的两个平台，不走 SkyWarsReloaded 插件流程

## 目录结构

```
skywars/
├── package.json            # 独立依赖：mineflayer, mineflayer-pathfinder
├── index.js                # 入口：连接 bot，执行搭路测试
└── modules/
    └── bridging.js         # 核心搭路模块
```

## Bridging 算法：后退搭路法

采用最稳定的 Backward Bridging，回合制下速度不重要，稳定性优先。

### 核心步骤

1. **计算方向**：从当前位置到目标位置的水平方向向量
2. **转身**：Bot 面朝远离目标的方向（背对目标）
3. **走到边缘**：走到当前平台的边缘位置
4. **搭路循环**：
   - `bot.setControlState('sneak', true)` 蹲下
   - `bot.setControlState('back', true)` 后退
   - 检测脚下是否悬空（下方无方块）
   - 悬空时停下 → `bot.look()` 看向脚下刚离开的方块边缘
   - `bot.placeBlock()` 在脚下放置方块
   - 继续后退，重复
5. **终止条件**：到达目标平台坐标范围内，或方块用完

### 关键细节

- 始终保持 sneak 状态，防止走过头掉落
- `bot.look()` 的 pitch 朝下（约 -π/2 方向看脚下边缘）
- 每次放完方块后短暂等待（~200ms），确保服务端确认
- 背包预先给足 cobblestone（创造模式）

## Bot 连接与测试流程

```
启动
 │
 ├→ 读取硬编码配置（服务器地址、端口、bot 用户名、目标坐标）
 ├→ 创建 Mineflayer bot 实例连接服务器
 ├→ 等待 'spawn' 事件
 ├→ 等待 2 秒（确保区块加载完成）
 ├→ 检查背包是否有足够方块（不够则 log 提示，退出）
 ├→ 调用 bridging.bridge(bot, targetPos)
 │    └→ 持续 log 进度："已放置 3/15 个方块..."
 ├→ 成功 → log "成功到达目标平台"
 │   失败 → log 失败原因（方块耗尽/位置异常/超时）
 └→ bot 断开连接，进程退出
```

### 配置（硬编码常量）

```js
const CONFIG = {
  host: 'moltbots.app',
  port: 25565,
  username: 'SkyWars_Test',
  targetPos: { x: 15, y: 65, z: 0 }  // 手动确认后填入
}
```

### 测试前手动准备

1. 在服务器上创造模式搭两个 5x5 平台，间隔 15 格，Y=65
2. 给 bot 出生点设在第一个平台上
3. 用命令给 bot 背包塞满 cobblestone

## 实现任务清单

1. 初始化 `skywars/` 项目（package.json、目录结构）
2. 实现 `index.js`（bot 连接、spawn 等待、流程控制）
3. 实现 `modules/bridging.js`（后退搭路算法）
4. 连接服务器实测，调试搭路参数（look 角度、等待时间等）
