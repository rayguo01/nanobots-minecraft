import { Router } from 'express';
import tradeEngine from '../core/trade_engine.js';
import botManager from '../core/bot_manager.js';

const router = Router();

function findBotByAgent(agentId) {
  const bots = botManager.listBots();
  const myBot = bots.find(b => b.agentId === agentId && b.online);
  return myBot ? myBot.botId : null;
}

router.post('/', (req, res) => {
  const botId = findBotByAgent(req.agentId);
  if (!botId) return res.status(400).json({ error: 'No active bot' });
  try {
    const result = tradeEngine.createTrade(botId, req.body);
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/', (req, res) => {
  const botId = findBotByAgent(req.agentId);
  if (!botId) return res.status(400).json({ error: 'No active bot' });
  res.json({ trades: tradeEngine.getTradesForBot(botId) });
});

router.get('/history', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  res.json({ trades: tradeEngine.getHistory(limit) });
});

router.get('/market', (req, res) => {
  const period = req.query.period === '24h' ? 86400000 : 3600000;
  res.json({ period: req.query.period || 'last_1h', summary: tradeEngine.getMarketSummary(period) });
});

router.get('/:id', (req, res) => {
  const trade = tradeEngine.getTrade(req.params.id);
  if (!trade) return res.status(404).json({ error: 'Trade not found' });
  res.json(trade);
});

router.put('/:id/accept', async (req, res) => {
  const botId = findBotByAgent(req.agentId);
  if (!botId) return res.status(400).json({ error: 'No active bot' });
  try {
    const result = await tradeEngine.acceptTrade(req.params.id, botId);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/:id/reject', (req, res) => {
  const botId = findBotByAgent(req.agentId);
  if (!botId) return res.status(400).json({ error: 'No active bot' });
  try {
    const result = tradeEngine.rejectTrade(req.params.id, botId);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/:id/cancel', (req, res) => {
  const botId = findBotByAgent(req.agentId);
  if (!botId) return res.status(400).json({ error: 'No active bot' });
  try {
    const result = tradeEngine.cancelTrade(req.params.id, botId);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
