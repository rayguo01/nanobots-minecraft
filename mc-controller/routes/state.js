import { Router } from 'express';
import botManager from '../core/bot_manager.js';
import { getFullState } from '../minecraft/full_state.js';
import * as world from '../minecraft/world.js';

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

router.get('/:id/state', requireOwnership, requireConnected, (req, res) => {
  try {
    const state = getFullState(req.params.id);
    res.json(state);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/inventory', requireOwnership, requireConnected, (req, res) => {
  const { bot } = botManager.getBotOrThrow(req.params.id);
  res.json({
    counts: world.getInventoryCounts(bot),
    stacks: world.getInventoryStacks(bot).map(i => ({ name: i.name, count: i.count })),
  });
});

router.get('/:id/nearby', requireOwnership, requireConnected, (req, res) => {
  const { bot } = botManager.getBotOrThrow(req.params.id);
  const distance = parseInt(req.query.distance) || 16;
  res.json({
    blocks: world.getNearbyBlockTypes(bot, distance),
    entities: world.getNearbyEntityTypes(bot),
    players: world.getNearbyPlayerNames(bot),
  });
});

router.get('/:id/craftable', requireOwnership, requireConnected, (req, res) => {
  const { bot } = botManager.getBotOrThrow(req.params.id);
  res.json({ items: world.getCraftableItems(bot) });
});

router.get('/:id/position', requireOwnership, requireConnected, (req, res) => {
  const { bot } = botManager.getBotOrThrow(req.params.id);
  const pos = world.getPosition(bot);
  res.json({ position: pos ? { x: pos.x, y: pos.y, z: pos.z } : null });
});

export default router;
