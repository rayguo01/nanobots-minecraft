import * as mc from '../minecraft/mcdata.js';
import config from '../config.js';
import { EventEmitter } from 'events';
import { initModes } from '../minecraft/modes.js';
import { getOrCreateQueue, removeQueue } from './action_queue.js';

class BotManager extends EventEmitter {
  constructor() {
    super();
    this.bots = new Map(); // botId -> { bot, agentId, username, status, connectedAt }
  }

  createBot(botId, agentId, username) {
    if (this.bots.has(botId)) throw new Error(`Bot ${botId} already exists`);
    this.bots.set(botId, { bot: null, agentId, username: username || botId, status: 'created', connectedAt: null });
    return { botId, status: 'created' };
  }

  async connectBot(botId, options = {}) {
    const entry = this.bots.get(botId);
    if (!entry) throw new Error(`Bot ${botId} not found`);
    if (entry.bot) throw new Error(`Bot ${botId} already connected`);

    const host = options.host || config.mc.host;
    const port = options.port || config.mc.port;
    const version = options.version || config.mc.version;
    const auth = config.mc.auth;

    const bot = mc.initBot(entry.username, { host, port, version, auth });

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        bot.end();
        reject(new Error('Connection timeout'));
      }, 30000);

      bot.once('spawn', () => {
        clearTimeout(timeout);
        entry.bot = bot;
        entry.status = 'connected';
        entry.connectedAt = Date.now();
        bot.output = '';
        bot.interrupt_code = false;
        // Initialize action queue and modes
        const actionQueue = getOrCreateQueue(botId, () => entry.bot);
        initModes(bot, actionQueue);
        this.emit('bot-connected', botId);
        resolve({
          status: 'connected',
          position: bot.entity?.position ? {
            x: Math.round(bot.entity.position.x),
            y: Math.round(bot.entity.position.y),
            z: Math.round(bot.entity.position.z)
          } : null
        });
      });

      bot.once('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      bot.once('kicked', (reason) => {
        clearTimeout(timeout);
        entry.status = 'kicked';
        reject(new Error(`Kicked: ${reason}`));
      });
    });
  }

  disconnectBot(botId) {
    const entry = this.bots.get(botId);
    if (!entry) throw new Error(`Bot ${botId} not found`);
    if (entry.bot) {
      entry.bot.end(); // triggers modes cleanup via bot.once('end')
      entry.bot = null;
    }
    removeQueue(botId);
    entry.status = 'disconnected';
    return { status: 'disconnected' };
  }

  destroyBot(botId) {
    const entry = this.bots.get(botId);
    if (!entry) throw new Error(`Bot ${botId} not found`);
    if (entry.bot) {
      entry.bot.end();
      entry.bot = null;
    }
    removeQueue(botId);
    this.bots.delete(botId);
    return { status: 'destroyed' };
  }

  getBot(botId) {
    return this.bots.get(botId) || null;
  }

  getBotOrThrow(botId) {
    const entry = this.getBot(botId);
    if (!entry) throw new Error(`Bot ${botId} not found`);
    if (!entry.bot) throw new Error(`Bot ${botId} not connected`);
    return entry;
  }

  listBots() {
    const result = [];
    for (const [botId, entry] of this.bots) {
      result.push({
        botId,
        agentId: entry.agentId,
        online: entry.status === 'connected' && entry.bot !== null,
        status: entry.status,
        position: entry.bot?.entity?.position ? {
          x: Math.round(entry.bot.entity.position.x),
          y: Math.round(entry.bot.entity.position.y),
          z: Math.round(entry.bot.entity.position.z)
        } : null
      });
    }
    return result;
  }

  isOwner(agentId, botId) {
    const entry = this.bots.get(botId);
    return entry && entry.agentId === agentId;
  }
}

const botManager = new BotManager();
export default botManager;
