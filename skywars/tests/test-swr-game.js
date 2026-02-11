/**
 * test-swr-game.js — Integration test for SkyWarsReloaded plugin mode.
 *
 * Connects 2 bots, both /sw join, waits for game_start via ChatParser,
 * runs LLM decision cycles, waits for game_won / game_lost, outputs result.
 *
 * Prerequisites:
 *   1. SkyWarsReloaded plugin installed + map registered (run tests/setup-swr-map.js)
 *   2. ANTHROPIC_API_KEY set
 *
 * Usage:
 *   # 1. 建图（仅首次）
 *   node skywars/tests/setup-swr-map.js
 *
 *   # 2. 启动比赛（默认 2 bot，可指定数量 2-8）
 *   ANTHROPIC_API_KEY=sk-xxx node skywars/tests/test-swr-game.js [bot_count]
 *
 *   # 3. 观战（在 Minecraft 客户端登录服务器后执行）
 *   /sw spectate botarena        — 按地图名观战
 *   /sw spectate Bot_Aggressive   — 按玩家名观战
 *   进入后按 E 打开观战菜单，用 /spawn 退出观战
 */

import { GameCoordinator } from '../coordinator.js';

const botConfigs = [
  { username: 'Bot_Aggressive', persona: 'aggressive' },
  { username: 'Bot_Cautious', persona: 'cautious' },
  { username: 'Bot_Controller', persona: 'controller' },
  { username: 'Bot_Gambler', persona: 'gambler' },
];

const botCount = parseInt(process.argv[2]) || 2;
const activeBots = botConfigs.slice(0, botCount);

console.log(`[test-swr] starting ${activeBots.length}-bot SkyWars match (SWR plugin mode)`);
console.log('[test-swr] make sure to run tests/setup-swr-map.js first!\n');

const game = new GameCoordinator(activeBots);
game.start()
  .then(result => {
    console.log('\n[test-swr] === MATCH RESULT ===');
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  })
  .catch(err => {
    console.error('[test-swr] fatal:', err);
    process.exit(1);
  });
