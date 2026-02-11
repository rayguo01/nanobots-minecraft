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
  await sleep(3000); // avoid connection throttle

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
