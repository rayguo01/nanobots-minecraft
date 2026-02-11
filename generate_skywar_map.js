/**
 * SkyWars 地图自动生成器
 * 
 * 使用 Mineflayer 连接服务器，通过 /fill 命令自动生成简易 SkyWars 地图
 * 
 * 前置条件：
 *   - Paper 服务端已运行
 *   - Bot 账号有 OP 权限（需要执行 /fill 命令）
 *   - 服务端 server.properties 中 online-mode=false（离线模式，方便 bot 登录）
 * 
 * 安装依赖：
 *   npm install mineflayer
 * 
 * 使用方式：
 *   node generate_skywar_map.js
 * 
 * 可选参数（修改下方 CONFIG 对象）：
 *   - host/port: 服务器地址
 *   - numIslands: 外圈岛屿数量（建议 4-8）
 *   - radius: 外圈岛离中心的距离
 *   - center: 地图中心坐标
 */

const mineflayer = require('mineflayer');

// ==================== 配置区 ====================
const CONFIG = {
  // 服务器连接
  host: 'localhost',
  port: 25565,
  username: 'ray',
  version: '1.20.4',            // 根据你的服务端版本修改

  // 地图中心坐标
  center: { x: 0, y: 65, z: 0 },

  // 外圈岛屿
  numIslands: 8,                // 出生岛数量（即 Bot 数量上限）
  radius: 30,                   // 外圈岛距中心距离（格）
  islandSize: 5,                // 外圈岛边长（奇数，方便居中）
  islandBlock: 'sandstone',     // 外圈岛方块材质

  // 中岛
  centerIslandSize: 9,          // 中岛边长
  centerBlock: 'quartz_block',  // 中岛方块材质

  // 清理区域（先清空这片区域为空气）
  clearRadius: 50,              // 清理半径
  clearHeight: 30,              // 清理高度（中心Y上下各多少格）

  // 战利品箱
  spawnChestLoot: [
    // 外圈岛箱子的物品（基础装备）
    { item: 'stone_sword', count: 1 },
    { item: 'iron_helmet', count: 1 },
    { item: 'leather_chestplate', count: 1 },
    { item: 'cobblestone', count: 32 },
    { item: 'bow', count: 1 },
    { item: 'arrow', count: 8 },
    { item: 'cooked_beef', count: 5 },
    { item: 'snowball', count: 4 },
  ],
  centerChestLoot: [
    // 中岛箱子的物品（高级装备）
    { item: 'diamond_sword', count: 1 },
    { item: 'iron_chestplate', count: 1 },
    { item: 'iron_leggings', count: 1 },
    { item: 'iron_boots', count: 1 },
    { item: 'ender_pearl', count: 2 },
    { item: 'golden_apple', count: 2 },
    { item: 'cobblestone', count: 64 },
    { item: 'diamond_helmet', count: 1 },
  ],
};

// ==================== 主逻辑 ====================

const bot = mineflayer.createBot({
  host: CONFIG.host,
  port: CONFIG.port,
  username: CONFIG.username,
  version: CONFIG.version,
});

// 命令队列，避免发送过快被服务器忽略
const commandQueue = [];
let isProcessing = false;

function queueCommand(cmd) {
  return new Promise((resolve) => {
    commandQueue.push({ cmd, resolve });
    processQueue();
  });
}

async function processQueue() {
  if (isProcessing) return;
  isProcessing = true;
  while (commandQueue.length > 0) {
    const { cmd, resolve } = commandQueue.shift();
    bot.chat(cmd);
    // 每条命令之间间隔，防止服务端过载
    await sleep(150);
    resolve();
  }
  isProcessing = false;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 用 /fill 命令填充一个长方体区域
 */
async function fill(x1, y1, z1, x2, y2, z2, block) {
  // /fill 一次最多 32768 个方块，大区域需要分批
  const maxBlocks = 32768;
  const dx = Math.abs(x2 - x1) + 1;
  const dy = Math.abs(y2 - y1) + 1;
  const dz = Math.abs(z2 - z1) + 1;

  if (dx * dy * dz <= maxBlocks) {
    await queueCommand(`/fill ${x1} ${y1} ${z1} ${x2} ${y2} ${z2} ${block}`);
  } else {
    // 按 Y 轴分批
    const minY = Math.min(y1, y2);
    const maxY = Math.max(y1, y2);
    const sliceSize = Math.floor(maxBlocks / (dx * dz));
    for (let y = minY; y <= maxY; y += sliceSize) {
      const yEnd = Math.min(y + sliceSize - 1, maxY);
      await queueCommand(`/fill ${x1} ${y} ${z1} ${x2} ${yEnd} ${z2} ${block}`);
    }
  }
}

/**
 * 在指定位置放置箱子并填入物品
 */
async function placeChestWithLoot(x, y, z, lootTable) {
  // 放置箱子
  await queueCommand(`/setblock ${x} ${y} ${z} chest`);
  await sleep(100);

  // 向箱子中添加物品
  for (let i = 0; i < lootTable.length; i++) {
    const { item, count } = lootTable[i];
    await queueCommand(`/item replace block ${x} ${y} ${z} container.${i} with ${item} ${count}`);
  }
}

/**
 * 生成一个平台岛屿
 */
async function buildIsland(cx, cy, cz, size, block) {
  const half = Math.floor(size / 2);
  // 主平台（1格厚）
  await fill(cx - half, cy, cz - half, cx + half, cy, cz + half, block);
  // 平台下方加一层深色方块作为边缘装饰
  await fill(cx - half + 1, cy - 1, cz - half + 1, cx + half - 1, cy - 1, cz + half - 1,
    block === 'quartz_block' ? 'quartz_bricks' : 'cut_sandstone');
}

/**
 * 计算外圈岛屿的坐标（圆形均匀分布）
 */
function getIslandPositions() {
  const positions = [];
  for (let i = 0; i < CONFIG.numIslands; i++) {
    const angle = (2 * Math.PI * i) / CONFIG.numIslands;
    const x = Math.round(CONFIG.center.x + CONFIG.radius * Math.cos(angle));
    const z = Math.round(CONFIG.center.z + CONFIG.radius * Math.sin(angle));
    positions.push({ x, y: CONFIG.center.y, z, index: i + 1 });
  }
  return positions;
}

/**
 * 主生成流程
 */
async function generateMap() {
  const { center } = CONFIG;

  console.log('=== SkyWars 地图生成器 ===\n');

  // 0. 确保 bot 有 OP 和创造模式
  console.log('[0/5] 设置权限...');
  await sleep(1000);
  await queueCommand('/gamemode creative');
  await sleep(500);

  // 1. 清理区域（全部替换为空气，制造虚空效果）
  console.log('[1/5] 清理区域...');
  const cr = CONFIG.clearRadius;
  const ch = CONFIG.clearHeight;
  await fill(
    center.x - cr, center.y - ch, center.z - cr,
    center.x + cr, center.y + ch, center.z + cr,
    'air'
  );
  // 底部放一层屏障方块防止掉到世界底部（可选）
  await fill(
    center.x - cr, center.y - ch - 1, center.z - cr,
    center.x + cr, center.y - ch - 1, center.z + cr,
    'barrier'
  );
  console.log('  ✓ 区域已清理');

  // 2. 生成中岛
  console.log('[2/5] 生成中岛...');
  await buildIsland(center.x, center.y, center.z, CONFIG.centerIslandSize, CONFIG.centerBlock);
  // 中岛放 4 个箱子（四个方向）
  const centerChestOffset = Math.floor(CONFIG.centerIslandSize / 2) - 1;
  await placeChestWithLoot(center.x + centerChestOffset, center.y + 1, center.z, CONFIG.centerChestLoot);
  await placeChestWithLoot(center.x - centerChestOffset, center.y + 1, center.z, CONFIG.centerChestLoot);
  await placeChestWithLoot(center.x, center.y + 1, center.z + centerChestOffset, CONFIG.centerChestLoot);
  await placeChestWithLoot(center.x, center.y + 1, center.z - centerChestOffset, CONFIG.centerChestLoot);
  console.log('  ✓ 中岛已生成（含 4 个高级战利品箱）');

  // 3. 生成外圈岛屿
  console.log('[3/5] 生成外圈岛屿...');
  const islands = getIslandPositions();
  for (const island of islands) {
    await buildIsland(island.x, island.y, island.z, CONFIG.islandSize, CONFIG.islandBlock);
    // 每个岛放 1 个箱子
    await placeChestWithLoot(island.x, island.y + 1, island.z, CONFIG.spawnChestLoot);
    console.log(`  ✓ 岛屿 #${island.index} 已生成 (${island.x}, ${island.y}, ${island.z})`);
  }

  // 4. 设置出生点标记（用告示牌标记，方便后续 bot 定位）
  console.log('[4/5] 设置出生点标记...');
  for (const island of islands) {
    // 在岛上放一个告示牌标记出生点编号
    await queueCommand(
      `/setblock ${island.x} ${island.y + 1} ${island.z + Math.floor(CONFIG.islandSize / 2)} ` +
      `oak_sign[rotation=8]{front_text:{messages:['{"text":"Spawn"}','{"text":"#${island.index}"}','{"text":""}','{"text":""}']}}`
    );
  }
  console.log('  ✓ 出生点标记已设置');

  // 5. 输出地图信息
  console.log('[5/5] 地图生成完成！\n');
  console.log('=== 地图信息 ===');
  console.log(`中心坐标: (${center.x}, ${center.y}, ${center.z})`);
  console.log(`外圈岛数量: ${CONFIG.numIslands}`);
  console.log(`外圈半径: ${CONFIG.radius} 格`);
  console.log(`岛屿间距: ~${Math.round(2 * CONFIG.radius * Math.sin(Math.PI / CONFIG.numIslands))} 格`);
  console.log('\n出生点坐标:');
  for (const island of islands) {
    console.log(`  #${island.index}: (${island.x}, ${island.y}, ${island.z})`);
  }

  console.log('\n=== 配置提示 ===');
  console.log('将以下坐标配置到 SkyWarsReloaded 或你的 Bot 代码中：');
  console.log(JSON.stringify({
    center: { x: center.x, y: center.y, z: center.z },
    spawns: islands.map(i => ({ id: i.index, x: i.x, y: i.y + 1, z: i.z }))
  }, null, 2));

  // 传送 bot 到中心上空查看全景
  await queueCommand(`/tp ${CONFIG.username} ${center.x} ${center.y + 30} ${center.z}`);

  console.log('\n✓ 全部完成！Bot 已传送到地图上空。');
  console.log('  你可以用 Minecraft 客户端连入服务器查看地图效果。');
  console.log('  按 Ctrl+C 退出脚本。');
}

// ==================== 事件处理 ====================

bot.on('login', () => {
  console.log(`Bot "${CONFIG.username}" 已登录服务器 ${CONFIG.host}:${CONFIG.port}`);
  console.log('等待 3 秒后开始生成地图...\n');
  setTimeout(generateMap, 3000);
});

bot.on('error', (err) => {
  console.error('连接错误:', err.message);
});

bot.on('kicked', (reason) => {
  console.error('被踢出:', reason);
});

bot.on('end', () => {
  console.log('连接已断开');
  process.exit(0);
});
