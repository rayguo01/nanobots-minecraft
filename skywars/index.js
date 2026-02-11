import mineflayer from 'mineflayer';
import { bridge } from './modules/bridging.js';

// ---------------------------------------------------------------------------
// Hard-coded config — tweak these before each test run
// ---------------------------------------------------------------------------
const CONFIG = {
  host: 'localhost',
  port: 25565,
  username: 'SkyWars_Test',
  version: '1.20.1',
  // Target position: center of platform B (5x5 stone at Y=116)
  targetPos: { x: 23, y: 117, z: -10 },
};

const BLOCK_NAME = 'cobblestone';
const MIN_BLOCKS = 5;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('[skywars] creating bot...');
  const bot = mineflayer.createBot({
    host: CONFIG.host,
    port: CONFIG.port,
    username: CONFIG.username,
    version: CONFIG.version,
  });

  bot.on('error', (err) => {
    console.error('[skywars] bot error:', err.message);
  });

  bot.on('kicked', (reason) => {
    console.error('[skywars] bot kicked:', reason);
  });

  // Wait for spawn
  await new Promise(resolve => bot.once('spawn', resolve));
  console.log('[skywars] bot spawned at', fmtPos(bot.entity.position));

  // Wait for chunks to load
  console.log('[skywars] waiting 2s for chunks...');
  await sleep(2000);

  // Check inventory for cobblestone
  const stoneCount = bot.inventory.items()
    .filter(i => i.name === BLOCK_NAME)
    .reduce((sum, i) => sum + i.count, 0);

  console.log(`[skywars] cobblestone in inventory: ${stoneCount}`);

  if (stoneCount < MIN_BLOCKS) {
    console.log(`[skywars] not enough cobblestone (need at least ${MIN_BLOCKS}). Trying /give...`);
    bot.chat(`/give ${CONFIG.username} cobblestone 64`);
    await sleep(1000);

    const newCount = bot.inventory.items()
      .filter(i => i.name === BLOCK_NAME)
      .reduce((sum, i) => sum + i.count, 0);
    console.log(`[skywars] cobblestone after /give: ${newCount}`);

    if (newCount < MIN_BLOCKS) {
      console.error('[skywars] still not enough cobblestone — aborting');
      bot.quit();
      process.exit(1);
    }
  }

  // Run bridging
  console.log(`[skywars] starting bridge toward (${CONFIG.targetPos.x}, ${CONFIG.targetPos.y}, ${CONFIG.targetPos.z})`);
  const result = await bridge(bot, CONFIG.targetPos);

  if (result.success) {
    console.log(`[skywars] SUCCESS — bridged with ${result.blocksPlaced} blocks`);
  } else {
    console.log(`[skywars] FAILED — reason: ${result.reason}, blocksPlaced: ${result.blocksPlaced}`);
  }

  bot.quit();
  process.exit(result.success ? 0 : 1);
}

function fmtPos(v) {
  return `(${v.x.toFixed(1)}, ${v.y.toFixed(1)}, ${v.z.toFixed(1)})`;
}

main().catch(err => {
  console.error('[skywars] fatal:', err);
  process.exit(1);
});
