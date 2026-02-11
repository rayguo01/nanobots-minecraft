import config from '../config.js';
import pf from 'mineflayer-pathfinder';

const { tierScore, slotScore } = config.equipment;

const ARMOR_SLOTS = ['helmet', 'chestplate', 'leggings', 'boots'];
const ARMOR_TIERS = Object.keys(tierScore);

export function scoreEquipment(item) {
  if (!item) return 0;
  const name = item.name;

  // Weapon scoring — use attackDamage directly
  if (name.includes('sword') || name.includes('axe')) {
    return item.attackDamage || 1;
  }

  // Armor scoring
  for (const slot of ARMOR_SLOTS) {
    if (!name.includes(slot)) continue;
    for (const tier of ARMOR_TIERS) {
      if (name.includes(tier)) {
        return tierScore[tier] * (slotScore[slot] || 1);
      }
    }
  }
  return 0;
}

export async function findAndLootChests(bot, radius = 16) {
  const chestPositions = bot.findBlocks({
    matching: block => block.name === 'chest' || block.name === 'trapped_chest',
    maxDistance: radius,
    count: 20,
  });

  const looted = [];

  for (const pos of chestPositions) {
    try {
      // Walk to chest
      const goal = new pf.goals.GoalNear(pos.x, pos.y, pos.z, 2);
      bot.pathfinder.setGoal(goal);
      await waitForGoal(bot, 10_000);

      // Open chest
      const chestBlock = bot.blockAt(pos);
      const window = await bot.openContainer(chestBlock);

      // Withdraw all items
      for (const item of window.containerItems()) {
        try {
          await window.withdraw(item.type, item.metadata, item.count);
          looted.push({ name: item.name, count: item.count });
        } catch { /* slot empty or full inventory */ }
      }

      window.close();
    } catch (err) {
      console.log(`[loot] failed to loot chest at ${pos}: ${err.message}`);
    }
  }

  return looted;
}

export async function equipBestGear(bot) {
  const inventory = bot.inventory.items();

  // Equip best armor per slot
  for (const slot of ARMOR_SLOTS) {
    const candidates = inventory.filter(i => i.name.includes(slot));
    if (candidates.length === 0) continue;
    candidates.sort((a, b) => scoreEquipment(b) - scoreEquipment(a));
    const best = candidates[0];
    const current = bot.inventory.slots[armorSlotIndex(slot)];
    if (!current || scoreEquipment(best) > scoreEquipment(current)) {
      await bot.equip(best, slotToDestination(slot));
    }
  }

  // Equip best weapon
  const weapons = inventory.filter(i =>
    i.name.includes('sword') || (i.name.includes('axe') && !i.name.includes('pickaxe'))
  );
  if (weapons.length > 0) {
    weapons.sort((a, b) => scoreEquipment(b) - scoreEquipment(a));
    await bot.equip(weapons[0], 'hand');
  }
}

export async function lootAndEquip(bot, radius = 16) {
  const looted = await findAndLootChests(bot, radius);
  await equipBestGear(bot);
  console.log(`[loot] looted ${looted.length} items, equipped best gear`);
  return looted;
}

// --- helpers ---

function slotToDestination(slot) {
  return { helmet: 'head', chestplate: 'torso', leggings: 'legs', boots: 'feet' }[slot];
}

function armorSlotIndex(slot) {
  return { helmet: 5, chestplate: 6, leggings: 7, boots: 8 }[slot];
}

function waitForGoal(bot, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      bot.pathfinder.stop();
      reject(new Error('pathfinder timeout'));
    }, timeoutMs);

    bot.once('goal_reached', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
