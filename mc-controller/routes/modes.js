import { Router } from 'express';
import botManager from '../core/bot_manager.js';

const router = Router();

function requireOwnership(req, res, next) {
  if (!botManager.isOwner(req.agentId, req.params.id)) {
    return res.status(403).json({ error: 'Not your bot' });
  }
  next();
}

function requireConnected(req, res, next) {
  try {
    botManager.getBotOrThrow(req.params.id);
    next();
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

router.get('/:id/modes', requireOwnership, requireConnected, (req, res) => {
  const { bot } = botManager.getBotOrThrow(req.params.id);
  if (!bot.modes) return res.json({ modes: {} });
  res.json({ modes: bot.modes.getJson() });
});

router.put('/:id/modes/:name', requireOwnership, requireConnected, (req, res) => {
  const { bot } = botManager.getBotOrThrow(req.params.id);
  const { name } = req.params;
  const { on } = req.body;

  if (!bot.modes) return res.status(400).json({ error: 'Modes not initialized' });
  if (!bot.modes.exists(name)) return res.status(404).json({ error: `Mode ${name} not found` });

  bot.modes.setOn(name, !!on);
  res.json({ mode: name, on: bot.modes.isOn(name) });
});

export default router;
