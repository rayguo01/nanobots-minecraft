import { Router } from 'express';
import botManager from '../core/bot_manager.js';
import { getOrCreateQueue, ACTION_MAP } from '../core/action_queue.js';

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

router.post('/:id/action', requireOwnership, requireConnected, async (req, res) => {
  const { action, params } = req.body;
  if (!action) return res.status(400).json({ error: 'action required' });
  if (!ACTION_MAP[action]) return res.status(400).json({ error: `Unknown action: ${action}`, available: Object.keys(ACTION_MAP) });

  const entry = botManager.getBotOrThrow(req.params.id);
  const queue = getOrCreateQueue(req.params.id, () => entry.bot);

  try {
    const result = await queue.executeOne(action, params || {});
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/act-batch', requireOwnership, requireConnected, async (req, res) => {
  const { actions } = req.body;
  if (!Array.isArray(actions) || actions.length === 0) {
    return res.status(400).json({ error: 'actions array required' });
  }

  for (const a of actions) {
    if (!ACTION_MAP[a.action]) {
      return res.status(400).json({ error: `Unknown action: ${a.action}` });
    }
  }

  const entry = botManager.getBotOrThrow(req.params.id);
  const queue = getOrCreateQueue(req.params.id, () => entry.bot);
  const result = await queue.executeBatch(actions);
  res.json(result);
});

router.post('/:id/stop', requireOwnership, requireConnected, async (req, res) => {
  const entry = botManager.getBotOrThrow(req.params.id);
  const queue = getOrCreateQueue(req.params.id, () => entry.bot);
  await queue.stop();
  res.json({ status: 'stopped' });
});

router.get('/:id/actions', (req, res) => {
  res.json({ actions: Object.keys(ACTION_MAP) });
});

export default router;
