/**
 * setup-swr-map.js — Create a SkyWarsReloaded map with proper islands and chests.
 *
 * Prerequisites: ArenaBuilder must have OP.
 * Usage: node skywars/tests/setup-swr-map.js
 */

import mineflayer from 'mineflayer';
import fs from 'fs';
import path from 'path';
import config from '../config.js';
import mapConfig from '../maps/islands.js';

const SWR_MAP_DATA = '/home/ubuntu/minecraft-server/plugins/Skywars/mapsData/botarena.yml';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function waitForMessage(bot, regex, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      bot.removeListener('message', handler);
      resolve(null);
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

async function cmd(bot, command, confirmRegex, label, waitMs = 2000) {
  console.log(`[swr-setup] ${label || command}`);
  const promise = confirmRegex
    ? waitForMessage(bot, confirmRegex, 10000)
    : sleep(waitMs);
  bot.chat(command);
  const result = await promise;
  if (confirmRegex && result) {
    console.log(`[swr-setup]   OK: ${result.slice(0, 120)}`);
  }
  await sleep(waitMs);
}

async function fill(bot, x1, y1, z1, x2, y2, z2, block) {
  bot.chat(`/fill ${x1} ${y1} ${z1} ${x2} ${y2} ${z2} ${block}`);
  await sleep(800);
}

async function setblock(bot, x, y, z, block) {
  bot.chat(`/setblock ${x} ${y} ${z} ${block}`);
  await sleep(400);
}

// ---- Island builders ----

async function buildSpawnIsland(bot, cx, y, cz) {
  // Layer 1: 7x7 base platform (stone bricks)
  await fill(bot, cx - 3, y, cz - 3, cx + 3, y, cz + 3, 'stone_bricks');
  // Layer 2: 5x5 top layer (stone)
  await fill(bot, cx - 2, y + 1, cz - 2, cx + 2, y + 1, cz + 2, 'stone');
  // Corner pillars (2 blocks high)
  for (const [dx, dz] of [[-2, -2], [-2, 2], [2, -2], [2, 2]]) {
    await setblock(bot, cx + dx, y + 2, cz + dz, 'oak_fence');
  }
  // 2 chests on each island
  await setblock(bot, cx - 1, y + 2, cz, 'chest');
  await setblock(bot, cx + 1, y + 2, cz, 'chest');
}

async function buildCenterIsland(bot, cx, y, cz) {
  // Layer 1: 11x11 base (stone bricks)
  await fill(bot, cx - 5, y, cz - 5, cx + 5, y, cz + 5, 'stone_bricks');
  // Layer 2: 9x9 middle (stone)
  await fill(bot, cx - 4, y + 1, cz - 4, cx + 4, y + 1, cz + 4, 'stone');
  // Layer 3: 5x5 raised center platform (iron block)
  await fill(bot, cx - 2, y + 2, cz - 2, cx + 2, y + 2, cz + 2, 'iron_block');
  // Corner pillars with glowstone
  for (const [dx, dz] of [[-4, -4], [-4, 4], [4, -4], [4, 4]]) {
    await fill(bot, cx + dx, y + 2, cz + dz, cx + dx, y + 3, cz + dz, 'oak_log');
    await setblock(bot, cx + dx, y + 4, cz + dz, 'glowstone');
  }
  // 4 chests around center (center chests = better loot)
  await setblock(bot, cx - 1, y + 3, cz - 1, 'chest');
  await setblock(bot, cx + 1, y + 3, cz - 1, 'chest');
  await setblock(bot, cx - 1, y + 3, cz + 1, 'chest');
  await setblock(bot, cx + 1, y + 3, cz + 1, 'chest');
}

// ---- Register chests into botarena.yml ----

function registerChestsInYaml() {
  if (!fs.existsSync(SWR_MAP_DATA)) {
    console.log('[swr-setup] WARNING: botarena.yml not found, skipping chest registration');
    return;
  }

  let yml = fs.readFileSync(SWR_MAP_DATA, 'utf-8');
  const y = mapConfig.center.y; // 66

  // Normal chests: 2 per spawn island (at y+2)
  const chestCoords = [];
  for (const name of mapConfig.spawnIslands) {
    const p = mapConfig.islands[name];
    chestCoords.push(`'${p.x - 1}:${y + 2}:${p.z}'`);
    chestCoords.push(`'${p.x + 1}:${y + 2}:${p.z}'`);
  }

  // Center chests: 4 on center island (at y+3)
  const cx = mapConfig.center.x;
  const cz = mapConfig.center.z;
  const centerCoords = [
    `'${cx - 1}:${y + 3}:${cz - 1}'`,
    `'${cx + 1}:${y + 3}:${cz - 1}'`,
    `'${cx - 1}:${y + 3}:${cz + 1}'`,
    `'${cx + 1}:${y + 3}:${cz + 1}'`,
  ];

  // Replace chests: [] and centerChests: []
  yml = yml.replace(/^chests: \[.*\]$/m, `chests:\n${chestCoords.map(c => `- ${c}`).join('\n')}`);
  yml = yml.replace(/^centerChests: \[.*\]$/m, `centerChests:\n${centerCoords.map(c => `- ${c}`).join('\n')}`);

  fs.writeFileSync(SWR_MAP_DATA, yml);
  console.log(`[swr-setup] registered ${chestCoords.length} normal chests + ${centerCoords.length} center chests in YAML`);
}

// ---- Main ----

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
  await sleep(4000);

  // Step 1: Lobby spawn
  await cmd(bot, '/sw setspawn', /spawn.*set|lobby/i, 'setting lobby spawn');

  // Step 2: Delete old map
  console.log('[swr-setup] deleting old map (if exists)...');
  bot.chat('/swm delete botarena');
  await sleep(5000);

  // Step 3: Create new map
  await cmd(bot, '/swm create botarena', /created|success/i, 'creating map "botarena"', 3000);
  await sleep(5000);

  // Step 4: Creative mode
  await cmd(bot, '/gamemode creative', /game\s*mode/i, 'switching to creative mode');
  await sleep(2000);

  const y = mapConfig.center.y; // 66

  // Step 5: Build center island
  console.log('[swr-setup] === Building center island ===');
  await buildCenterIsland(bot, mapConfig.center.x, y, mapConfig.center.z);

  // Step 6: Build 8 spawn islands
  for (const name of mapConfig.spawnIslands) {
    const pos = mapConfig.islands[name];
    console.log(`[swr-setup] === Building ${name} at (${pos.x}, ${y}, ${pos.z}) ===`);
    await buildSpawnIsland(bot, pos.x, y, pos.z);
  }

  console.log('[swr-setup] all islands built, waiting for world to settle...');
  await sleep(5000);

  // Step 7: Set player spawn points (standing on top layer y+2 of spawn islands)
  console.log('[swr-setup] setting player spawn points...');
  for (let i = 0; i < mapConfig.spawnIslands.length; i++) {
    const name = mapConfig.spawnIslands[i];
    const pos = mapConfig.islands[name];
    bot.chat(`/tp ArenaBuilder ${pos.x} ${y + 2} ${pos.z}`);
    await sleep(3000);
    const bp = bot.entity.position;
    console.log(`[swr-setup] bot at (${Math.round(bp.x)}, ${Math.round(bp.y)}, ${Math.round(bp.z)})`);
    await cmd(bot, '/swm spawn player', /spawn.*added|spawn #/i, `spawn ${i + 1}/8 on ${name}`, 2000);
  }

  // Step 8: Spectator spawn
  bot.chat(`/tp ArenaBuilder ${mapConfig.center.x} ${y + 20} ${mapConfig.center.z}`);
  await sleep(3000);
  await cmd(bot, '/swm spawn spec', /spec|spectator/i, 'spectator spawn');

  // Step 9: Min players
  await cmd(bot, '/swm min botarena 2', /min|minimum|players/i, 'min players = 2');

  // Step 10: Save and register
  await cmd(bot, '/swm save botarena', /saved|save/i, 'saving map');
  await sleep(2000);
  await cmd(bot, '/swm register botarena', /register|success/i, 'registering map');

  // Step 11: Register chests in YAML + reload
  console.log('[swr-setup] registering chests in YAML...');
  registerChestsInYaml();

  await sleep(1000);
  await cmd(bot, '/sw reload', /reload/i, 'reloading SWR plugin');

  console.log('\n[swr-setup] ============================');
  console.log('[swr-setup] Map "botarena" setup complete!');
  console.log('[swr-setup] 8 spawn islands (7x7 base, 2 chests each)');
  console.log('[swr-setup] 1 center island (11x11 base, 4 center chests)');
  console.log('[swr-setup] Total: 16 normal chests + 4 center chests');
  console.log('[swr-setup] ============================\n');

  await sleep(2000);
  bot.quit();
}

main().catch(err => {
  console.error('[swr-setup] fatal:', err);
  process.exit(1);
});
