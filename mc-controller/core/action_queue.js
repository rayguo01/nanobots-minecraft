import * as skills from '../minecraft/skills.js';
import { v4 as uuid } from 'uuid';

const ACTION_MAP = {
  // Movement
  go_to_position: (bot, p) => skills.goToPosition(bot, p.x, p.y, p.z, p.closeness || 2),
  go_to_player: (bot, p) => skills.goToPlayer(bot, p.player, p.closeness || 3),
  follow_player: (bot, p) => skills.followPlayer(bot, p.player, p.distance || 4),
  go_to_nearest_block: (bot, p) => skills.goToNearestBlock(bot, p.type, p.distance || 2, p.range || 64),
  go_to_nearest_entity: (bot, p) => skills.goToNearestEntity(bot, p.type, p.distance || 2, p.range || 64),
  move_away: (bot, p) => skills.moveAway(bot, p.distance),
  go_to_bed: (bot) => skills.goToBed(bot),
  go_to_surface: (bot) => skills.goToSurface(bot),
  dig_down: (bot, p) => skills.digDown(bot, p.distance || 10),
  stay: (bot, p) => skills.stay(bot, p.seconds || 30),
  // Resource
  collect_block: (bot, p) => skills.collectBlock(bot, p.type, p.count || 1),
  break_block_at: (bot, p) => skills.breakBlockAt(bot, p.x, p.y, p.z),
  pickup_items: (bot) => skills.pickupNearbyItems(bot),
  // Craft/Smelt
  craft_recipe: (bot, p) => skills.craftRecipe(bot, p.item, p.count || 1),
  smelt_item: (bot, p) => skills.smeltItem(bot, p.item, p.count || 1),
  clear_furnace: (bot) => skills.clearNearestFurnace(bot),
  // Build/Place
  place_block: (bot, p) => skills.placeBlock(bot, p.type, p.x, p.y, p.z, p.placeOn || 'bottom'),
  till_and_sow: (bot, p) => skills.tillAndSow(bot, p.x, p.y, p.z, p.seedType),
  use_door: (bot, p) => skills.useDoor(bot, p.x != null ? { x: p.x, y: p.y, z: p.z } : null),
  activate_block: (bot, p) => skills.activateNearestBlock(bot, p.type),
  // Combat
  attack_nearest: (bot, p) => skills.attackNearest(bot, p.type, p.kill !== false),
  attack_entity: (bot, p) => skills.attackEntity(bot, p.entityId, p.kill !== false),
  defend_self: (bot, p) => skills.defendSelf(bot, p.range || 9),
  avoid_enemies: (bot, p) => skills.avoidEnemies(bot, p.distance || 16),
  // Inventory
  equip: (bot, p) => skills.equip(bot, p.item),
  discard: (bot, p) => skills.discard(bot, p.item, p.count || -1),
  consume: (bot, p) => skills.consume(bot, p.item),
  give_to_player: (bot, p) => skills.giveToPlayer(bot, p.item, p.player, p.count || 1),
  // Chest
  put_in_chest: (bot, p) => skills.putInChest(bot, p.item, p.count || -1),
  take_from_chest: (bot, p) => skills.takeFromChest(bot, p.item, p.count || -1),
  view_chest: (bot) => skills.viewChest(bot),
  // Villager
  show_villager_trades: (bot, p) => skills.showVillagerTrades(bot, p.villager_id),
  trade_with_villager: (bot, p) => skills.tradeWithVillager(bot, p.villager_id, p.index, p.count),
  // Other
  chat: (bot, p) => { bot.chat(p.message); return true; },
  use_tool_on: (bot, p) => skills.useToolOn(bot, p.tool, p.target),
  wait: (bot, p) => skills.wait(bot, p.ms || 1000),
};

class ActionQueue {
  constructor(botId, getBot) {
    this.botId = botId;
    this.getBot = getBot;
    this.queue = [];
    this.current = null;
    this.executing = false;
    this.interrupted = false;
    this.batchId = null;
  }

  getActionNames() {
    return Object.keys(ACTION_MAP);
  }

  async executeOne(action, params = {}) {
    const fn = ACTION_MAP[action];
    if (!fn) throw new Error(`Unknown action: ${action}`);

    const bot = this.getBot();
    if (!bot) throw new Error('Bot not connected');

    if (this.executing) {
      await this.stop();
    }

    const taskId = uuid();
    this.current = { id: taskId, action, params, status: 'running', startedAt: Date.now() };
    this.executing = true;
    bot.interrupt_code = false;

    try {
      await fn(bot, params);
      this.current.status = 'completed';
      const output = bot.output || '';
      bot.output = '';
      return { success: true, message: output || `${action} completed`, taskId, duration_ms: Date.now() - this.current.startedAt };
    } catch (err) {
      this.current.status = 'failed';
      bot.output = '';
      return { success: false, message: err.message, taskId, duration_ms: Date.now() - this.current.startedAt };
    } finally {
      this.executing = false;
      this.current = null;
    }
  }

  async executeBatch(actions) {
    const batchId = uuid();
    this.batchId = batchId;
    this.queue = actions.map((a, i) => ({
      id: `${batchId}-${i}`,
      action: a.action,
      params: a.params || {},
      status: 'pending',
    }));

    this._processBatch(batchId);
    return { batchId, queued: actions.length, status: 'running' };
  }

  async _processBatch(batchId) {
    while (this.queue.length > 0 && this.batchId === batchId) {
      if (this.interrupted) {
        await new Promise(r => setTimeout(r, 500));
        if (this.interrupted) continue;
      }

      const task = this.queue[0];
      task.status = 'running';
      this.current = task;
      this.executing = true;

      const bot = this.getBot();
      if (!bot) break;
      bot.interrupt_code = false;

      try {
        const fn = ACTION_MAP[task.action];
        if (!fn) throw new Error(`Unknown action: ${task.action}`);
        await fn(bot, task.params);
        task.status = 'completed';
      } catch (err) {
        task.status = 'failed';
        task.error = err.message;
      } finally {
        bot.output = '';
        this.executing = false;
        this.current = null;
        this.queue.shift();
      }
    }
    this.batchId = null;
  }

  async stop() {
    const bot = this.getBot();
    if (bot) {
      bot.interrupt_code = true;
      if (bot.pathfinder) bot.pathfinder.stop();
      if (bot.pvp) bot.pvp.stop();
    }
    this.queue = [];
    this.batchId = null;
    this.executing = false;
    await new Promise(r => setTimeout(r, 300));
  }

  interruptForMode() {
    this.interrupted = true;
    const bot = this.getBot();
    if (bot) bot.interrupt_code = true;
  }

  resumeAfterMode() {
    this.interrupted = false;
    const bot = this.getBot();
    if (bot) bot.interrupt_code = false;
  }

  getStatus() {
    return {
      executing: this.executing,
      current: this.current ? { id: this.current.id, action: this.current.action, status: this.current.status } : null,
      queueLength: this.queue.length,
      actions: this.queue.map(t => `${t.action}(${JSON.stringify(t.params)})`).slice(0, 10),
    };
  }
}

const queues = new Map();

export function getOrCreateQueue(botId, getBot) {
  if (!queues.has(botId)) {
    queues.set(botId, new ActionQueue(botId, getBot));
  }
  return queues.get(botId);
}

export function getQueue(botId) {
  return queues.get(botId);
}

export function removeQueue(botId) {
  queues.delete(botId);
}

export { ACTION_MAP };
