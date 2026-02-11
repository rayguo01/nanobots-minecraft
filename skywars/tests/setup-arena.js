import mineflayer from 'mineflayer';
import config from '../config.js';
import mapConfig from '../maps/islands.js';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const bot = mineflayer.createBot({ ...config.server, username: 'ArenaBuilder' });
  bot.on('message', msg => console.log('[chat]', msg.toString()));
  await new Promise(r => bot.once('spawn', r));
  await sleep(2000);

  const y = 65;

  // Clear large area
  console.log('[setup] clearing area...');
  // Clear in chunks to stay within /fill limit (32768 blocks)
  for (let cx = -50; cx < 50; cx += 30) {
    for (let cz = -50; cz < 50; cz += 30) {
      bot.chat(`/fill ${cx} ${y - 1} ${cz} ${Math.min(cx + 29, 50)} ${y + 10} ${Math.min(cz + 29, 50)} air`);
      await sleep(800);
    }
  }
  await sleep(1000);

  // Build center island (7x7)
  console.log('[setup] building center island...');
  const c = mapConfig.center;
  bot.chat(`/fill ${c.x - 3} ${y} ${c.z - 3} ${c.x + 3} ${y} ${c.z + 3} stone`);
  await sleep(1000);
  bot.chat(`/setblock ${c.x} ${y + 1} ${c.z} chest`);
  await sleep(500);

  // Build 8 spawn islands (5x5 each)
  for (const islandName of mapConfig.spawnIslands) {
    const pos = mapConfig.islands[islandName];
    console.log(`[setup] building ${islandName} at (${pos.x}, ${y}, ${pos.z})...`);
    bot.chat(`/fill ${pos.x - 2} ${y} ${pos.z - 2} ${pos.x + 2} ${y} ${pos.z + 2} stone`);
    await sleep(800);
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
