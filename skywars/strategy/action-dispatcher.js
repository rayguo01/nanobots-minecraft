import { bridge } from '../modules/bridging.js';
import { lootAndEquip } from '../modules/loot.js';
import { meleeAttack, rangedAttack, retreat } from '../modules/combat.js';

export async function dispatch(bot, decision, mapConfig) {
  const { action, params } = decision;
  console.log(`[dispatch] ${bot.username}: ${action} ${JSON.stringify(params || {})}`);

  try {
    switch (action) {
      case 'loot_chest':
        return await lootAndEquip(bot, 16);

      case 'bridge_to': {
        const target = mapConfig.islands[params.target_island];
        if (!target) return { success: false, reason: `unknown island: ${params.target_island}` };
        return await bridge(bot, target);
      }

      case 'attack':
        return await meleeAttack(bot, params.target_player);

      case 'ranged_attack':
        return await rangedAttack(bot, params.target_player, params.weapon);

      case 'use_item':
        return await useItem(bot, params.item);

      case 'retreat':
        return await retreat(bot, directionToVec(params.direction));

      case 'destroy_bridge':
        return await destroyBridge(bot, params.bridge_id, mapConfig);

      case 'wait':
        return { success: true, action: 'wait' };

      default:
        return { success: false, reason: `unknown action: ${action}` };
    }
  } catch (err) {
    console.log(`[dispatch] error executing ${action}: ${err.message}`);
    return { success: false, reason: err.message };
  }
}

async function useItem(bot, itemName) {
  const item = bot.inventory.items().find(i => i.name.includes(itemName));
  if (!item) return { success: false, reason: `item not found: ${itemName}` };

  await bot.equip(item, 'hand');

  if (itemName === 'ender_pearl') {
    const target = Object.values(bot.players)
      .filter(p => p.entity && p.username !== bot.username)
      .sort((a, b) => bot.entity.position.distanceTo(a.entity.position) - bot.entity.position.distanceTo(b.entity.position))[0];

    if (target?.entity) {
      await bot.lookAt(target.entity.position, true);
    }
    bot.activateItem();
  } else if (itemName === 'golden_apple') {
    bot.activateItem();
  }

  return { success: true, item: itemName };
}

async function destroyBridge(bot, bridgeId, mapConfig) {
  const parts = bridgeId.split('_to_');
  if (parts.length !== 2) return { success: false, reason: 'invalid bridge_id format' };

  const fromIsland = parts[0];
  const toIsland = parts[1];
  const from = mapConfig.islands[fromIsland];
  const to = mapConfig.islands[toIsland];
  if (!from || !to) return { success: false, reason: 'unknown islands in bridge_id' };

  const bridgeBlocks = bot.findBlocks({
    matching: block => block.name === 'cobblestone',
    maxDistance: 50,
    count: 100,
  }).filter(pos => {
    const minX = Math.min(from.x, to.x) - 2;
    const maxX = Math.max(from.x, to.x) + 2;
    const minZ = Math.min(from.z, to.z) - 2;
    const maxZ = Math.max(from.z, to.z) + 2;
    return pos.x >= minX && pos.x <= maxX && pos.z >= minZ && pos.z <= maxZ;
  });

  let broken = 0;
  for (const pos of bridgeBlocks.slice(0, 5)) {
    try {
      const block = bot.blockAt(pos);
      if (block && block.diggable) {
        await bot.dig(block);
        broken++;
      }
    } catch { /* can't reach */ }
  }

  return { success: broken > 0, blocksBroken: broken };
}

function directionToVec(direction) {
  const map = {
    north: { x: 0, y: 0, z: -1 },
    south: { x: 0, y: 0, z: 1 },
    east: { x: 1, y: 0, z: 0 },
    west: { x: -1, y: 0, z: 0 },
  };
  return map[direction] || null;
}
