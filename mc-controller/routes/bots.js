import { Router } from 'express';
import botManager from '../core/bot_manager.js';

const router = Router();

function requireOwnership(req, res, next) {
  const { id } = req.params;
  if (!botManager.isOwner(req.agentId, id)) {
    return res.status(403).json({ error: 'Not your bot' });
  }
  next();
}

router.post('/', (req, res) => {
  try {
    const { botId, username } = req.body;
    if (!botId) return res.status(400).json({ error: 'botId required' });
    const result = botManager.createBot(botId, req.agentId, username);
    res.status(201).json(result);
  } catch (err) {
    res.status(409).json({ error: err.message });
  }
});

router.post('/:id/connect', requireOwnership, async (req, res) => {
  try {
    const { host, port, version } = req.body || {};
    const result = await botManager.connectBot(req.params.id, { host, port, version });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/disconnect', requireOwnership, (req, res) => {
  try {
    const result = botManager.disconnectBot(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

router.delete('/:id', requireOwnership, (req, res) => {
  try {
    const result = botManager.destroyBot(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

router.get('/', (req, res) => {
  res.json({ bots: botManager.listBots() });
});

export default router;
