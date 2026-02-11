/**
 * setup-swr-map.js — Automatically create a SkyWarsReloaded map.
 *
 * Prerequisites: Bot account must have OP on the server, SkyWarsReloaded v5 installed.
 *
 * Steps:
 *   1. /sw setspawn (lobby spawn)
 *   2. /swm create botarena
 *   3. Build 8 spawn islands + center island with /fill
 *   4. Set player spawns at each island (/swm spawn player × 8)
 *   5. Set spectator spawn (/swm spawn spec)
 *   6. /swm min 2
 *   7. /swm save botarena → /swm register botarena
 *
 * Usage: node skywars/tests/setup-swr-map.js
 */

import mineflayer from 'mineflayer';
import config from '../config.js';
import mapConfig from '../maps/islands.js';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Wait for a chat message matching the given regex (or timeout).
 */
function waitForMessage(bot, regex, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      bot.removeListener('message', handler);
      resolve(null); // resolve null on timeout instead of rejecting
    }, timeoutMs);

    function handler(jsonMsg) {
      const text = jsonMsg.toString();
      if (regex.test(text)) {
        clearTimeout(timer);
        bot.removeListener('message', handler);
        resolve(text);
      }
    }
    bot.on('message', handler);
  });
}

async function cmd(bot, command, confirmRegex, label) {
  console.log(`[swr-setup] ${label || command}`);
  const promise = confirmRegex
    ? waitForMessage(bot, confirmRegex, 8000)
    : sleep(2000);
  bot.chat(command);
  const result = await promise;
  if (confirmRegex && result) {
    console.log(`[swr-setup]   confirmed: ${result.slice(0, 120)}`);
  }
  await sleep(1500);
}

async function main() {
  console.log('[swr-setup] connecting builder bot...');
  const bot = mineflayer.createBot({
    ...config.server,
    username: 'ArenaBuilder',
  });

  bot.on('message', msg => console.log('[chat]', msg.toString()));
  bot.on('error', err => console.error('[bot-error]', err.message));

  await new Promise(r => bot.once('spawn', r));
  console.log('[swr-setup] builder spawned');
  await sleep(3000);

  // ---- Step 1: Set SWR lobby spawn ----
  await cmd(bot, '/sw setspawn', /spawn.*set|lobby/i, 'setting lobby spawn');

  // ---- Step 2: Create map ----
  await cmd(bot, '/swm create botarena', /created|editing|teleport/i, 'creating map "botarena"');

  // Wait a bit for teleport to the new world
  await sleep(3000);

  // ---- Step 3: Creative mode for building ----
  await cmd(bot, '/gamemode creative', /game\s*mode/i, 'switching to creative mode');

  // ---- Step 4: Build islands using /fill ----
  const y = mapConfig.center.y; // 66

  // Clear area first
  console.log('[swr-setup] clearing build area...');
  for (let cx = -50; cx < 50; cx += 30) {
    for (let cz = -50; cz < 50; cz += 30) {
      bot.chat(`/fill ${cx} ${y - 1} ${cz} ${Math.min(cx + 29, 50)} ${y + 10} ${Math.min(cz + 29, 50)} air`);
      await sleep(600);
    }
  }
  await sleep(1000);

  // Build center island (7x7 stone + chest)
  console.log('[swr-setup] building center island...');
  const c = mapConfig.center;
  bot.chat(`/fill ${c.x - 3} ${y} ${c.z - 3} ${c.x + 3} ${y} ${c.z + 3} stone`);
  await sleep(800);
  bot.chat(`/setblock ${c.x} ${y + 1} ${c.z} chest`);
  await sleep(500);

  // Build 8 spawn islands (5x5 stone + chest)
  for (const islandName of mapConfig.spawnIslands) {
    const pos = mapConfig.islands[islandName];
    console.log(`[swr-setup] building ${islandName} at (${pos.x}, ${y}, ${pos.z})`);
    bot.chat(`/fill ${pos.x - 2} ${y} ${pos.z - 2} ${pos.x + 2} ${y} ${pos.z + 2} stone`);
    await sleep(800);
    bot.chat(`/setblock ${pos.x} ${y + 1} ${pos.z} chest`);
    await sleep(500);
  }

  // ---- Step 5: Re-enter editing mode then set player spawn points ----
  console.log('[swr-setup] entering edit mode for botarena...');
  await cmd(bot, '/swm edit botarena', /editing|edit/i, 'entering edit mode');
  await sleep(2000);

  console.log('[swr-setup] setting player spawn points...');
  for (let i = 0; i < mapConfig.spawnIslands.length; i++) {
    const islandName = mapConfig.spawnIslands[i];
    const pos = mapConfig.islands[islandName];
    // Teleport to the island then set spawn
    bot.chat(`/tp ArenaBuilder ${pos.x} ${y + 1} ${pos.z}`);
    await sleep(2000);
    await cmd(bot, '/swm spawn player', /spawn.*set|spawn.*added|player spawn|spawnpoint/i, `spawn point ${i + 1}/8 on ${islandName}`);
  }

  // ---- Step 6: Set spectator spawn above center island ----
  console.log('[swr-setup] setting spectator spawn...');
  bot.chat(`/tp ArenaBuilder ${c.x} ${y + 15} ${c.z}`);
  await sleep(2000);
  await cmd(bot, '/swm spawn spec', /spec|spectator/i, 'spectator spawn');

  // ---- Step 7: Set min players ----
  await cmd(bot, '/swm min botarena 2', /min|minimum|players/i, 'setting min players to 2');

  // ---- Step 8: Save and register ----
  await cmd(bot, '/swm save botarena', /saved|save/i, 'saving map');
  await cmd(bot, '/swm register botarena', /register|enabled|added/i, 'registering map');

  console.log('\n[swr-setup] ============================');
  console.log('[swr-setup] Map "botarena" setup complete!');
  console.log('[swr-setup] Islands:');
  for (const [name, pos] of Object.entries(mapConfig.islands)) {
    console.log(`  ${name}: (${pos.x}, ${pos.y}, ${pos.z})`);
  }
  console.log('[swr-setup] ============================\n');

  await sleep(2000);
  bot.quit();
}

main().catch(err => {
  console.error('[swr-setup] fatal:', err);
  process.exit(1);
});
