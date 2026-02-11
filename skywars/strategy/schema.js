const VALID_ACTIONS = [
  'loot_chest',
  'bridge_to',
  'attack',
  'ranged_attack',
  'use_item',
  'retreat',
  'destroy_bridge',
  'wait',
];

const PARAM_RULES = {
  loot_chest: [],
  bridge_to: ['target_island'],
  attack: ['target_player'],
  ranged_attack: ['target_player', 'weapon'],
  use_item: ['item'],
  retreat: ['direction'],
  destroy_bridge: ['bridge_id'],
  wait: [],
};

export function validateAction(decision) {
  if (!decision || typeof decision !== 'object') {
    return { valid: false, error: 'decision is not an object' };
  }
  if (!decision.action || !VALID_ACTIONS.includes(decision.action)) {
    return { valid: false, error: `invalid action: ${decision.action}` };
  }
  const required = PARAM_RULES[decision.action];
  const params = decision.params || {};
  for (const key of required) {
    if (!(key in params)) {
      return { valid: false, error: `missing param "${key}" for action "${decision.action}"` };
    }
  }
  return { valid: true };
}
