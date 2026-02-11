import config from '../config.js';

const ARMOR_TIERS = ['diamond', 'iron', 'chainmail', 'golden', 'leather'];

export function generateSnapshot(bot, gameState) {
  return {
    round: gameState.round,
    phase: gameState.phase,
    pvp_enabled: gameState.pvpEnabled || false,
    self: getSelfState(bot),
    visible_players: getVisiblePlayers(bot),
    map_state: gameState.mapState,
    recent_events: gameState.recentEvents.slice(-10),
  };
}

function getSelfState(bot) {
  const pos = bot.entity.position;
  return {
    position: { x: Math.round(pos.x), y: Math.round(pos.y), z: Math.round(pos.z) },
    health: bot.health,
    hunger: bot.food,
    equipment: {
      helmet: bot.inventory.slots[5]?.name || null,
      chestplate: bot.inventory.slots[6]?.name || null,
      leggings: bot.inventory.slots[7]?.name || null,
      boots: bot.inventory.slots[8]?.name || null,
      weapon: bot.heldItem?.name || null,
      offhand: bot.inventory.slots[45]?.name || null,
    },
    inventory: bot.inventory.items().map(i => ({
      item: i.name,
      count: i.count,
    })),
  };
}

function getVisiblePlayers(bot) {
  const players = [];
  for (const [name, player] of Object.entries(bot.players)) {
    if (name === bot.username) continue;
    if (!player.entity) continue;

    const entity = player.entity;
    const dist = bot.entity.position.distanceTo(entity.position);

    players.push({
      name,
      position: {
        x: Math.round(entity.position.x),
        y: Math.round(entity.position.y),
        z: Math.round(entity.position.z),
      },
      distance: Math.round(dist),
      estimated_equipment: estimateEquipmentTier(entity),
      health_estimate: estimateHealth(entity),
    });
  }
  return players;
}

function estimateEquipmentTier(entity) {
  const equipment = entity.equipment || [];
  let bestTier = 'none';
  for (const item of equipment) {
    if (!item) continue;
    for (const tier of ARMOR_TIERS) {
      if (item.name?.includes(tier)) {
        if (ARMOR_TIERS.indexOf(tier) < ARMOR_TIERS.indexOf(bestTier) || bestTier === 'none') {
          bestTier = tier;
        }
        break;
      }
    }
  }
  return bestTier === 'none' ? 'unknown' : `${bestTier}_armor`;
}

function estimateHealth(entity) {
  const health = entity.metadata?.[9];
  if (health == null) return 'unknown';
  if (health > 14) return 'high';
  if (health > 8) return 'medium';
  return 'low';
}
