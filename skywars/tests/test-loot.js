import mineflayer from 'mineflayer';
import { pathfinder } from 'mineflayer-pathfinder';
import config from '../config.js';
import { lootAndEquip, scoreEquipment } from '../modules/loot.js';

const bot = mineflayer.createBot({
  ...config.server,
  username: 'LootTest',
});
bot.loadPlugin(pathfinder);

bot.once('spawn', async () => {
  await new Promise(r => setTimeout(r, 2000));
  console.log('[test-loot] bot spawned, starting loot test...');

  const looted = await lootAndEquip(bot, 16);
  console.log('[test-loot] looted items:', looted);

  // Report equipped gear
  const equipment = ['head', 'torso', 'legs', 'feet', 'hand'].map(slot => {
    const item = bot.inventory.slots[{ head: 5, torso: 6, legs: 7, feet: 8, hand: bot.getEquipmentDestSlot('hand') }[slot]];
    return `${slot}: ${item ? item.name : 'empty'}`;
  });
  console.log('[test-loot] equipment:', equipment.join(', '));

  bot.quit();
});
