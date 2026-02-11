import { Router } from 'express';
import messageHub from '../core/message_hub.js';
import botManager from '../core/bot_manager.js';

const router = Router();

function findBotByAgent(agentId) {
  const bots = botManager.listBots();
  const myBot = bots.find(b => b.agentId === agentId && b.online);
  return myBot ? myBot.botId : null;
}

router.post('/', (req, res) => {
  const { to, type, content } = req.body;
  if (!to || !content) {
    return res.status(400).json({ error: 'to and content required' });
  }
  const senderBot = findBotByAgent(req.agentId);
  if (!senderBot) return res.status(400).json({ error: 'You have no active bot' });

  const result = messageHub.send(senderBot, to, type, content);
  res.json(result);
});

router.get('/', (req, res) => {
  const botId = findBotByAgent(req.agentId);
  if (!botId) return res.status(400).json({ error: 'You have no active bot' });

  const since = parseInt(req.query.since) || 0;
  const limit = parseInt(req.query.limit) || 50;
  const messages = messageHub.getMessages(botId, since, limit);
  res.json({ messages });
});

router.post('/broadcast', (req, res) => {
  const { type, content } = req.body;
  if (!content) return res.status(400).json({ error: 'content required' });

  const senderBot = findBotByAgent(req.agentId);
  if (!senderBot) return res.status(400).json({ error: 'You have no active bot' });

  const allBotIds = botManager.listBots().filter(b => b.online).map(b => b.botId);
  const result = messageHub.broadcast(senderBot, type, content, allBotIds);
  res.json(result);
});

router.delete('/', (req, res) => {
  const botId = findBotByAgent(req.agentId);
  if (!botId) return res.status(400).json({ error: 'You have no active bot' });

  const before = parseInt(req.query.before) || undefined;
  messageHub.clearMessages(botId, before);
  res.json({ status: 'cleared' });
});

export default router;
