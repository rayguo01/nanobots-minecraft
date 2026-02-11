import vec3 from 'vec3';

const POLL_INTERVAL_MS = 50;
const PLACE_DELAY_MS = 300;
const TIMEOUT_MS = 60_000;
const BLOCK_NAME = 'cobblestone';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Backward-bridge from the bot's current position toward targetPos.
 * Pre-computes a straight line of blocks, then places them one by one.
 *
 * @param {import('mineflayer').Bot} bot
 * @param {{ x: number, y: number, z: number }} targetPos
 * @returns {Promise<{ success: boolean, blocksPlaced: number, reason?: string }>}
 */
export async function bridge(bot, targetPos) {
  const target = vec3(targetPos.x, targetPos.y, targetPos.z);
  const startPos = bot.entity.position.clone();
  let blocksPlaced = 0;

  const dx = target.x - startPos.x;
  const dz = target.z - startPos.z;
  const bridgeY = Math.floor(startPos.y) - 1;

  // --- Pre-compute the straight line of block positions to place ----------
  const blockLine = computeBlockLine(startPos, target, bridgeY);
  // Filter out positions that already have solid blocks
  const toPlace = blockLine.filter(pos => {
    const block = bot.blockAt(pos);
    return !block || block.name === 'air';
  });

  console.log(`[bridge] start=${fmt(startPos)} target=${fmt(target)}`);
  console.log(`[bridge] bridgeY=${bridgeY}, total line=${blockLine.length}, need to place=${toPlace.length}`);

  if (toPlace.length === 0) {
    console.log('[bridge] no blocks to place — path already solid');
    return { success: true, blocksPlaced: 0 };
  }

  // Yaw: face AWAY from target, so "back" moves toward target
  const yawToTarget = Math.atan2(-dx, dz);
  const yawAway = yawToTarget + Math.PI;

  bot.setControlState('sneak', true);

  const deadline = Date.now() + TIMEOUT_MS;

  try {
    for (const placePos of toPlace) {
      if (Date.now() > deadline) {
        console.log('[bridge] timeout');
        return { success: false, blocksPlaced, reason: 'timeout' };
      }

      // --- Walk backward until we are over or past the target block --------
      // Re-orient before each step to prevent drift
      await bot.look(yawAway, 0, true);
      await sleep(100);
      bot.setControlState('back', true);

      const arrived = await waitUntilOver(bot, placePos, deadline);
      bot.setControlState('back', false);

      if (!arrived) {
        console.log(`[bridge] could not reach position above ${fmt(placePos)}`);
        return { success: false, blocksPlaced, reason: 'stuck' };
      }

      // --- Check if block below is already solid (maybe placed by previous step drift)
      const currentBelow = bot.blockAt(bot.entity.position.offset(0, -1, 0));
      if (currentBelow && currentBelow.name !== 'air') {
        continue;
      }

      // --- Find reference block and place ---------------------------------
      const refPos = findReferenceBlock(bot, placePos);
      if (!refPos) {
        console.log(`[bridge] no reference block for ${fmt(placePos)}`);
        return { success: false, blocksPlaced, reason: 'no_reference_block' };
      }

      const refBlock = bot.blockAt(refPos);
      const faceVec = vec3(
        placePos.x - refPos.x,
        placePos.y - refPos.y,
        placePos.z - refPos.z,
      );

      // Look down at the reference block
      await bot.lookAt(refPos.offset(0.5, 0.5, 0.5), true);
      await sleep(50);

      // Equip cobblestone
      const item = bot.inventory.items().find(i => i.name === BLOCK_NAME);
      if (!item) {
        console.log('[bridge] out of cobblestone');
        return { success: false, blocksPlaced, reason: 'out_of_blocks' };
      }
      await bot.equip(item, 'hand');

      try {
        await bot.placeBlock(refBlock, faceVec);
        blocksPlaced++;
        console.log(`[bridge] placed #${blocksPlaced}/${toPlace.length} at ${fmt(placePos)}`);
      } catch (err) {
        console.log(`[bridge] placeBlock error at ${fmt(placePos)}: ${err.message}`);
      }

      await sleep(PLACE_DELAY_MS);
    }

    // Walk to the target platform
    await bot.look(yawAway, 0, true);
    bot.setControlState('back', true);
    await sleep(1500);
    bot.setControlState('back', false);

    const finalDist = bot.entity.position.distanceTo(target);
    console.log(`[bridge] done! finalDist=${finalDist.toFixed(1)} blocksPlaced=${blocksPlaced}`);
    return { success: true, blocksPlaced };

  } finally {
    bot.setControlState('sneak', false);
    bot.setControlState('back', false);
  }
}

/**
 * Compute a straight line of block positions from start to near target,
 * along the primary axis (whichever of X or Z has the bigger delta).
 */
function computeBlockLine(startPos, target, y) {
  const sx = Math.floor(startPos.x);
  const sz = Math.floor(startPos.z);
  const tx = Math.floor(target.x);
  const tz = Math.floor(target.z);

  const adx = Math.abs(tx - sx);
  const adz = Math.abs(tz - sz);
  const line = [];

  if (adx >= adz) {
    // Primary axis: X
    const step = tx > sx ? 1 : -1;
    const z = sz; // keep Z constant
    for (let x = sx + step; step > 0 ? x <= tx : x >= tx; x += step) {
      line.push(vec3(x, y, z));
    }
  } else {
    // Primary axis: Z
    const step = tz > sz ? 1 : -1;
    const x = sx;
    for (let z = sz + step; step > 0 ? z <= tz : z >= tz; z += step) {
      line.push(vec3(x, y, z));
    }
  }

  return line;
}

/**
 * Wait until the bot's position is over the target block (same X/Z).
 * Returns true if arrived, false on timeout.
 */
async function waitUntilOver(bot, blockPos, deadline) {
  for (let i = 0; i < 100; i++) { // max ~5 seconds
    if (Date.now() > deadline) return false;

    const pos = bot.entity.position;
    const bx = Math.floor(pos.x);
    const bz = Math.floor(pos.z);

    if (bx === blockPos.x && bz === blockPos.z) {
      return true;
    }

    await sleep(POLL_INTERVAL_MS);
  }
  return false;
}

/**
 * Find the best adjacent solid block to use as placeBlock reference.
 */
function findReferenceBlock(bot, placePos) {
  const candidates = [
    vec3(placePos.x - 1, placePos.y, placePos.z),
    vec3(placePos.x + 1, placePos.y, placePos.z),
    vec3(placePos.x, placePos.y, placePos.z - 1),
    vec3(placePos.x, placePos.y, placePos.z + 1),
    vec3(placePos.x, placePos.y - 1, placePos.z),
  ];

  for (const c of candidates) {
    const block = bot.blockAt(c);
    if (block && block.name !== 'air') {
      return c;
    }
  }
  return null;
}

function fmt(v) {
  return `(${v.x.toFixed(1)}, ${v.y.toFixed(1)}, ${v.z.toFixed(1)})`;
}
