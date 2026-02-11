import mineflayer from 'mineflayer';
import { pathfinder } from 'mineflayer-pathfinder';
import { plugin as pvp } from 'mineflayer-pvp';
import config from '../config.js';
import { meleeAttack, checkVoidRisk } from '../modules/combat.js';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function connectBot(username, plugins = []) {
  return new Promise((resolve, reject) => {
    const bot = mineflayer.createBot({ ...config.server, username });
    for (const p of plugins) bot.loadPlugin(p);
    bot.once('spawn', () => resolve(bot));
    bot.on('kicked', reason => reject(new Error(`${username} kicked: ${JSON.stringify(reason)}`)));
    bot.on('error', err => reject(new Error(`${username} error: ${err.message}`)));
  });
}

async function main() {
  // Spawn target dummy bot
  const dummy = await connectBot('CombatDummy');
  console.log('[test-combat] dummy spawned');

  // Wait for connection throttle (server: 4000ms)
  await sleep(5000);

  // Spawn attacker bot
  const attacker = await connectBot('CombatAttacker', [pathfinder, pvp]);
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
