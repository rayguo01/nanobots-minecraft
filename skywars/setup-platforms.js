import mineflayer from 'mineflayer';

// Bot spawns near (8.5, 117, -9.5), feet Y=117, ground Y=116
// Platform A: 5x5 centered at X=8, Z=-10, Y=116
// Platform B: 5x5 centered at X=23, Z=-10, Y=116 (15 blocks gap)

const CONFIG = {
  host: 'localhost',
  port: 25565,
  username: 'SkyWars_Test',
  version: '1.20.1',
};

const COMMANDS = [
  // 1. Clear a large area (air) from Y=116 to Y=125, X=4 to X=27, Z=-14 to Z=-6
  '/fill 4 116 -14 27 125 -6 air',

  // 2. Build Platform A: 5x5 stone slab at Y=116, X=6..10, Z=-12..-8
  '/fill 6 116 -12 10 116 -8 stone',

  // 3. Build Platform B: 5x5 stone slab at Y=116, X=21..25, Z=-12..-8
  '/fill 21 116 -12 25 116 -8 stone',

  // 4. TP bot to center of Platform A
  '/tp SkyWars_Test 8 117 -10',
];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('[setup] connecting...');
  const bot = mineflayer.createBot(CONFIG);

  bot.on('message', msg => console.log('[chat]', msg.toString()));
  bot.on('error', e => console.error('[error]', e.message));

  await new Promise(resolve => bot.once('spawn', resolve));
  console.log('[setup] spawned at', bot.entity.position);

  await sleep(2000);

  for (const cmd of COMMANDS) {
    console.log(`[setup] running: ${cmd}`);
    bot.chat(cmd);
    await sleep(1500);
  }

  console.log('[setup] done! Bot is now on Platform A.');
  console.log('[setup] Platform A: (6,116,-12) to (10,116,-8) center=(8,117,-10)');
  console.log('[setup] Platform B: (21,116,-12) to (25,116,-8) center=(23,117,-10)');
  console.log('[setup] Gap: 10 blocks (X=11 to X=20)');

  await sleep(1000);
  bot.quit();
}

main().catch(err => {
  console.error('[setup] fatal:', err);
  process.exit(1);
});
