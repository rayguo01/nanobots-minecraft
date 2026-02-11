import * as world from './world.js';
import botManager from '../core/bot_manager.js';
import messageHub from '../core/message_hub.js';
import tradeEngine from '../core/trade_engine.js';
import { getQueue } from '../core/action_queue.js';

export function getFullState(botId) {
  const entry = botManager.getBotOrThrow(botId);
  const bot = entry.bot;

  const pos = bot.entity?.position;
  const timeOfDay = bot.time?.timeOfDay;
  let timeLabel = 'Morning';
  if (timeOfDay >= 6000 && timeOfDay < 12000) timeLabel = 'Afternoon';
  else if (timeOfDay >= 12000) timeLabel = 'Night';

  let weather = 'Clear';
  if (bot.thunderState > 0) weather = 'Thunderstorm';
  else if (bot.rainState > 0) weather = 'Rain';

  const counts = world.getInventoryCounts(bot);
  const stacks = world.getInventoryStacks(bot);
  const equipment = {
    helmet: bot.inventory.slots[5]?.name || null,
    chestplate: bot.inventory.slots[6]?.name || null,
    leggings: bot.inventory.slots[7]?.name || null,
    boots: bot.inventory.slots[8]?.name || null,
    mainHand: bot.heldItem?.name || null,
  };

  const nearbyPlayers = world.getNearbyPlayers(bot, 64);
  const nearbyBots = nearbyPlayers.map(p => ({
    name: p.username,
    distance: pos ? Math.round(p.entity?.position?.distanceTo(pos) * 10) / 10 : null,
    position: p.entity?.position ? {
      x: Math.round(p.entity.position.x),
      y: Math.round(p.entity.position.y),
      z: Math.round(p.entity.position.z)
    } : null
  }));

  const entityTypes = world.getNearbyEntityTypes(bot);
  const blockTypes = world.getNearbyBlockTypes(bot, 16);

  const modes = bot.modes ? bot.modes.getJson() : {};
  const modeLogs = bot.modes ? bot.modes.flushBehaviorLog() : [];

  return {
    botId,
    position: pos ? { x: Math.round(pos.x * 10) / 10, y: Math.round(pos.y * 10) / 10, z: Math.round(pos.z * 10) / 10 } : null,
    health: bot.health,
    food: bot.food,
    dimension: bot.game?.dimension || 'overworld',
    gameMode: bot.game?.gameMode || 'survival',
    biome: world.getBiomeName(bot),
    weather,
    timeOfDay: timeOfDay || 0,
    timeLabel,
    surroundings: (() => {
      const blocks = world.getSurroundingBlocks(bot);
      return {
        below: blocks[0] || 'unknown',
        legs: blocks[1] || 'air',
        head: blocks[2] || 'air',
        firstBlockAboveHead: world.getFirstBlockAboveHead(bot) || 'air',
      };
    })(),
    inventory: {
      counts,
      stacksUsed: stacks.length,
      totalSlots: 36,
      equipment,
    },
    nearby: {
      bots: nearbyBots,
      entities: entityTypes,
      blocks: blockTypes.slice(0, 20),
    },
    modes,
    modeLogs,
    currentTask: (() => {
      const q = getQueue(botId);
      if (!q || !q.current) return null;
      return { id: q.current.id, label: q.current.action, status: q.current.status };
    })(),
    actionQueue: (() => {
      const q = getQueue(botId);
      if (!q) return { length: 0, actions: [] };
      return q.getStatus();
    })(),
    pendingTrades: tradeEngine.getPendingTradeCount(botId),
    unreadMessages: messageHub.getUnreadCount(botId),
  };
}
