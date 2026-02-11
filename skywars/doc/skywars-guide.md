# SkyWars Bot 使用指南

## 前置条件

- Minecraft 服务器运行中（1.20.1，离线模式）
- SkyWarsReloaded 插件已安装
- `ANTHROPIC_API_KEY` 环境变量已设置

## 1. 建图（仅首次）

```bash
node skywars/tests/setup-swr-map.js
```

自动完成以下操作：
- 设置 SkyWars 大厅出生点
- 创建地图 `botarena`
- 建造 8 个出生岛（5x5）+ 1 个中心岛（7x7），每个岛上有箱子
- 设置 8 个玩家出生点 + 1 个观察者出生点
- 最少 2 人即可开局
- 保存并注册地图

建图 bot 使用 `ArenaBuilder` 账号（需要 OP 权限）。

## 2. 启动比赛

```bash
# 默认 2 个 bot
ANTHROPIC_API_KEY=sk-xxx node skywars/tests/test-swr-game.js

# 指定 bot 数量（2-4）
ANTHROPIC_API_KEY=sk-xxx node skywars/tests/test-swr-game.js 4
```

可用 bot 及性格：

| Bot | 性格 | 风格 |
|-----|------|------|
| Bot_Aggressive | 激进型 | 冲中岛、正面刚 |
| Bot_Cautious | 保守型 | 搜刮资源、后期出手 |
| Bot_Controller | 控制型 | 占地形、弓箭压制、拆桥 |
| Bot_Gambler | 赌徒型 | 珍珠偷袭、桥上对拼 |

### 游戏流程

1. Bot 逐个连接服务器（间隔 5 秒）
2. 每个 Bot 执行 `/sw join` 加入 SkyWars
3. 满足最少人数后自动倒计时 10 秒
4. 游戏开始 → Pre-PVP 阶段（搜刮、搭路）
5. 10 秒后 PVP 开启 → 可以攻击
6. LLM 每 12 秒做一次决策
7. 最后一人存活获胜，游戏结束

## 3. 观战

在 Minecraft 客户端登录服务器后，执行以下命令：

```
/sw spectate botarena
```

或按玩家名观战：

```
/sw spectate Bot_Aggressive
```

### 观战操作

- 按 **E** 打开观战菜单（可切换观战对象）
- 输入 `/spawn` 退出观战
- 观战中聊天会显示 `[Spec]` 前缀

## 4. 服务器信息

| 项目 | 值 |
|------|-----|
| 服务器地址 | 217.216.33.32 / moltbots.app |
| 端口 | 25565 |
| 版本 | 1.20.1 |
| 认证模式 | 离线（offline） |
| 地图名 | botarena |
