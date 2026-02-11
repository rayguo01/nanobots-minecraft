import { v4 as uuid } from 'uuid';
import botManager from './bot_manager.js';
import messageHub from './message_hub.js';
import { getOrCreateQueue } from './action_queue.js';
import * as skills from '../minecraft/skills.js';
import * as world from '../minecraft/world.js';
import config from '../config.js';

class TradeEngine {
  constructor() {
    this.trades = new Map();
    this.history = [];
    setInterval(() => this._checkExpired(), 10000);
  }

  createTrade(fromBotId, { to, offer, want, message, expiresIn }) {
    const fromEntry = botManager.getBotOrThrow(fromBotId);
    const counts = world.getInventoryCounts(fromEntry.bot);
    for (const item of offer) {
      if ((counts[item.item] || 0) < item.count) {
        throw new Error(`Insufficient ${item.item}: have ${counts[item.item] || 0}, need ${item.count}`);
      }
    }

    const tradeId = uuid();
    const expiry = expiresIn || config.trade.defaultExpiry;
    const trade = {
      tradeId,
      from: fromBotId,
      to: to || null,
      offer,
      want,
      message: message || '',
      status: 'pending',
      createdAt: Date.now(),
      expiresAt: Date.now() + expiry * 1000,
      acceptedBy: null,
      result: null,
    };

    this.trades.set(tradeId, trade);

    if (to) {
      messageHub.systemMessage(to, 'trade_proposal', {
        tradeId, from: fromBotId, offer, want, message: trade.message, expiresAt: trade.expiresAt,
      });
    } else {
      const allBots = botManager.listBots().filter(b => b.online && b.botId !== fromBotId);
      for (const b of allBots) {
        messageHub.systemMessage(b.botId, 'trade_proposal', {
          tradeId, from: fromBotId, offer, want, message: trade.message, expiresAt: trade.expiresAt,
        });
      }
    }

    return { tradeId, status: 'pending', expiresAt: trade.expiresAt };
  }

  async acceptTrade(tradeId, acceptorBotId) {
    const trade = this.trades.get(tradeId);
    if (!trade) throw new Error('Trade not found');
    if (trade.status !== 'pending') throw new Error(`Trade is ${trade.status}, cannot accept`);
    if (trade.to && trade.to !== acceptorBotId) throw new Error('This trade is not for you');
    if (trade.from === acceptorBotId) throw new Error('Cannot accept your own trade');
    if (Date.now() > trade.expiresAt) { trade.status = 'expired'; throw new Error('Trade expired'); }

    const acceptorEntry = botManager.getBotOrThrow(acceptorBotId);
    const counts = world.getInventoryCounts(acceptorEntry.bot);
    for (const item of trade.want) {
      if ((counts[item.item] || 0) < item.count) {
        throw new Error(`Insufficient ${item.item}: have ${counts[item.item] || 0}, need ${item.count}`);
      }
    }

    const fromEntry = botManager.getBotOrThrow(trade.from);
    const fromCounts = world.getInventoryCounts(fromEntry.bot);
    for (const item of trade.offer) {
      if ((fromCounts[item.item] || 0) < item.count) {
        trade.status = 'failed';
        trade.result = 'Offerer no longer has the items';
        throw new Error('Offerer no longer has the items');
      }
    }

    trade.status = 'accepted';
    trade.acceptedBy = acceptorBotId;

    const posA = fromEntry.bot.entity.position;
    const posB = acceptorEntry.bot.entity.position;
    const meetingPoint = {
      x: Math.round((posA.x + posB.x) / 2),
      y: Math.round((posA.y + posB.y) / 2),
      z: Math.round((posA.z + posB.z) / 2),
    };

    this._executeTrade(trade, meetingPoint);

    return {
      tradeId,
      status: 'accepted',
      execution: { meetingPoint, estimatedTime: 15000 },
    };
  }

  async _executeTrade(trade, meetingPoint) {
    trade.status = 'executing';
    const fromEntry = botManager.getBotOrThrow(trade.from);
    const toEntry = botManager.getBotOrThrow(trade.acceptedBy);
    const fromBot = fromEntry.bot;
    const toBot = toEntry.bot;

    const fromQueue = getOrCreateQueue(trade.from, () => fromBot);
    const toQueue = getOrCreateQueue(trade.acceptedBy, () => toBot);
    fromQueue.interruptForMode();
    toQueue.interruptForMode();
    if (fromBot.modes) fromBot.modes.pause('item_collecting');
    if (toBot.modes) toBot.modes.pause('item_collecting');

    try {
      await Promise.all([
        skills.goToPosition(fromBot, meetingPoint.x, meetingPoint.y, meetingPoint.z, 3),
        skills.goToPosition(toBot, meetingPoint.x, meetingPoint.y, meetingPoint.z, 3),
      ]);

      for (const item of trade.offer) {
        await skills.giveToPlayer(fromBot, item.item, trade.acceptedBy, item.count);
      }

      for (const item of trade.want) {
        await skills.giveToPlayer(toBot, item.item, trade.from, item.count);
      }

      trade.status = 'completed';
      trade.completedAt = Date.now();
      this.history.push({ ...trade });

      messageHub.systemMessage(trade.from, 'trade_completed', { tradeId: trade.tradeId });
      messageHub.systemMessage(trade.acceptedBy, 'trade_completed', { tradeId: trade.tradeId });

    } catch (err) {
      trade.status = 'failed';
      trade.result = err.message;

      try {
        await skills.pickupNearbyItems(fromBot);
        await skills.pickupNearbyItems(toBot);
      } catch (e) { /* best effort */ }

      messageHub.systemMessage(trade.from, 'trade_failed', { tradeId: trade.tradeId, reason: err.message });
      messageHub.systemMessage(trade.acceptedBy, 'trade_failed', { tradeId: trade.tradeId, reason: err.message });
    } finally {
      fromQueue.resumeAfterMode();
      toQueue.resumeAfterMode();
      if (fromBot.modes) fromBot.modes.unpause('item_collecting');
      if (toBot.modes) toBot.modes.unpause('item_collecting');
    }
  }

  rejectTrade(tradeId, botId) {
    const trade = this.trades.get(tradeId);
    if (!trade) throw new Error('Trade not found');
    if (trade.status !== 'pending') throw new Error(`Trade is ${trade.status}`);
    trade.status = 'rejected';
    messageHub.systemMessage(trade.from, 'trade_rejected', { tradeId, by: botId });
    return { tradeId, status: 'rejected' };
  }

  cancelTrade(tradeId, botId) {
    const trade = this.trades.get(tradeId);
    if (!trade) throw new Error('Trade not found');
    if (trade.from !== botId) throw new Error('Only the offerer can cancel');
    if (trade.status !== 'pending') throw new Error(`Trade is ${trade.status}`);
    trade.status = 'cancelled';
    return { tradeId, status: 'cancelled' };
  }

  getTrade(tradeId) {
    return this.trades.get(tradeId);
  }

  getTradesForBot(botId) {
    const result = [];
    for (const trade of this.trades.values()) {
      if ((trade.from === botId || trade.to === botId || trade.to === null || trade.acceptedBy === botId)
          && ['pending', 'accepted', 'executing'].includes(trade.status)) {
        result.push(trade);
      }
    }
    return result;
  }

  getHistory(limit = 50) {
    return this.history.slice(-limit);
  }

  getMarketSummary(periodMs = 3600000) {
    const since = Date.now() - periodMs;
    const recent = this.history.filter(t => t.completedAt > since);

    const summary = new Map();
    for (const trade of recent) {
      for (const offered of trade.offer) {
        if (!summary.has(offered.item)) summary.set(offered.item, { trades: 0, rates: {} });
        const entry = summary.get(offered.item);
        entry.trades++;
        for (const wanted of trade.want) {
          const rate = wanted.count / offered.count;
          if (!entry.rates[wanted.item]) entry.rates[wanted.item] = [];
          entry.rates[wanted.item].push(rate);
        }
      }
    }

    const result = [];
    for (const [item, data] of summary) {
      const avgRates = {};
      for (const [rateItem, rates] of Object.entries(data.rates)) {
        avgRates[rateItem] = Math.round((rates.reduce((a, b) => a + b, 0) / rates.length) * 100) / 100;
      }
      result.push({ item, trades: data.trades, avgExchangeRate: avgRates });
    }
    return result;
  }

  getPendingTradeCount(botId) {
    let count = 0;
    for (const trade of this.trades.values()) {
      if ((trade.to === botId || (trade.to === null && trade.from !== botId))
          && trade.status === 'pending') {
        count++;
      }
    }
    return count;
  }

  _checkExpired() {
    const now = Date.now();
    for (const trade of this.trades.values()) {
      if (trade.status === 'pending' && now > trade.expiresAt) {
        trade.status = 'expired';
      }
    }
  }
}

const tradeEngine = new TradeEngine();
export default tradeEngine;
