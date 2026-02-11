// Full SkyWars match test
// Usage: ANTHROPIC_API_KEY=sk-xxx node tests/test-full-match.js [bot_count]
//
// Prerequisites:
//   1. Run tests/setup-arena.js first to create the map
//   2. Set ANTHROPIC_API_KEY environment variable
//
// This script uses the coordinator directly:
//   node coordinator.js [bot_count]

import { GameCoordinator } from '../coordinator.js';

const botConfigs = [
  { username: 'Bot_Aggressive', persona: 'aggressive' },
  { username: 'Bot_Cautious', persona: 'cautious' },
  { username: 'Bot_Controller', persona: 'controller' },
  { username: 'Bot_Gambler', persona: 'gambler' },
];

const botCount = parseInt(process.argv[2]) || 4;
const activeBots = botConfigs.slice(0, botCount);

console.log(`[test-full-match] starting ${botCount}-bot match`);
console.log('[test-full-match] make sure to run tests/setup-arena.js first!\n');

const game = new GameCoordinator(activeBots);
game.start()
  .then(result => {
    console.log('\n[test-full-match] result:', JSON.stringify(result, null, 2));
  })
  .catch(err => {
    console.error('[test-full-match] fatal:', err);
    process.exit(1);
  });
