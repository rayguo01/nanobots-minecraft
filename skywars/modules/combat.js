import config from '../config.js';
import vec3 from 'vec3';

const { meleeReachBlocks, rangedMaxBlocks, lowHealthThreshold, voidYThreshold, knockbackCheckRadiusBlocks } = config.combat;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export async function meleeAttack(bot, targetName) {
  const player = bot.players[targetName];
  if (!player?.entity) {
    return { success: false, reason: 'target_not_visible' };
  }

  const entity = player.entity;

  // Equip best melee weapon
  const weapons = bot.inventory.items().filter(i =>
    i.name.includes('sword') || (i.name.includes('axe') && !i.name.includes('pickaxe'))
  );
  if (weapons.length > 0) {
    weapons.sort((a, b) => (b.attackDamage || 0) - (a.attackDamage || 0));
    await bot.equip(weapons[0], 'hand');
  }

  // Start PvP attack
  bot.pvp.attack(entity);

  // Wait for combat to resolve (max 30s per round)
  return new Promise(resolve => {
    const cleanup = () => {
      clearInterval(checkInterval);
      clearTimeout(timeout);
      bot.removeListener('stoppedAttacking', onStopped);
    };

    const timeout = setTimeout(() => {
      cleanup();
      bot.pvp.stop();
      resolve({ success: false, reason: 'timeout' });
    }, 30_000);

    const onStopped = () => {
      cleanup();
      resolve({ success: false, reason: 'target_lost' });
    };
    bot.once('stoppedAttacking', onStopped);

    const checkInterval = setInterval(() => {
      // Target dead?
      if (!player.entity || entity.metadata?.[7] <= 0) {
        cleanup();
        bot.pvp.stop();
        resolve({ success: true, reason: 'target_killed' });
        return;
      }
      // Self low health?
      if (bot.health <= lowHealthThreshold) {
        cleanup();
        bot.pvp.stop();
        resolve({ success: false, reason: 'low_health', health: bot.health });
        return;
      }
    }, 500);
  });
}

export async function rangedAttack(bot, targetName, weapon) {
  const player = bot.players[targetName];
  if (!player?.entity) {
    return { success: false, reason: 'target_not_visible' };
  }

  const entity = player.entity;
  const dist = bot.entity.position.distanceTo(entity.position);

  if (dist > rangedMaxBlocks) {
    return { success: false, reason: 'target_too_far' };
  }

  // Find and equip the weapon item
  const item = bot.inventory.items().find(i => i.name === weapon || i.name.includes(weapon));
  if (!item) {
    return { success: false, reason: 'no_ammo' };
  }
  await bot.equip(item, 'hand');

  // Aim at target (lead slightly above for projectile arc)
  const targetPos = entity.position.offset(0, 1.6, 0);
  await bot.lookAt(targetPos, true);

  if (weapon === 'bow') {
    bot.activateItem();
    await sleep(1200);
    const arrowItem = bot.inventory.items().find(i => i.name === 'arrow');
    if (!arrowItem) {
      bot.deactivateItem();
      return { success: false, reason: 'no_arrows' };
    }
    await bot.lookAt(player.entity?.position.offset(0, 1.6, 0) || targetPos, true);
    bot.deactivateItem();
  } else {
    bot.activateItem();
  }

  return { success: true, weapon, target: targetName };
}

export function checkVoidRisk(bot) {
  const pos = bot.entity.position;
  const directions = [
    vec3(1, 0, 0), vec3(-1, 0, 0),
    vec3(0, 0, 1), vec3(0, 0, -1),
  ];

  let atRisk = false;
  let safeDirection = null;

  for (const dir of directions) {
    const checkPos = pos.offset(dir.x * knockbackCheckRadiusBlocks, 0, dir.z * knockbackCheckRadiusBlocks);
    const blockBelow = bot.blockAt(checkPos.offset(0, -1, 0));
    const isVoid = !blockBelow || blockBelow.name === 'air';

    if (isVoid) {
      atRisk = true;
    } else if (!safeDirection) {
      safeDirection = dir;
    }
  }

  const below = bot.blockAt(pos.offset(0, -1, 0));
  if (!below || below.name === 'air') {
    atRisk = true;
  }

  return { atRisk, safeDirection };
}

export async function retreat(bot, direction = null) {
  if (!direction) {
    const { safeDirection } = checkVoidRisk(bot);
    direction = safeDirection || vec3(0, 0, 1);
  }

  const yaw = Math.atan2(-direction.x, direction.z);
  await bot.look(yaw, 0, true);

  bot.setControlState('sprint', true);
  bot.setControlState('forward', true);
  bot.setControlState('jump', true);

  await sleep(2000);

  bot.setControlState('sprint', false);
  bot.setControlState('forward', false);
  bot.setControlState('jump', false);

  return { success: true, newPosition: bot.entity.position.clone() };
}
