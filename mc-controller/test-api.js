#!/usr/bin/env node

/**
 * ClawCraft MC Controller API 测试脚本
 *
 * 用法:
 *   node test-api.js                          # 测试全部（默认连接 https://moltbots.app）
 *   node test-api.js --base http://localhost:3000  # 指定 Controller 地址
 *   node test-api.js --no-mc                  # 跳过需要 MC 服务器的测试
 *   node test-api.js --mc-host mc.example.com # 指定 MC 服务器地址
 */

const args = process.argv.slice(2);
function getArg(name) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
}
const hasFlag = (name) => args.includes(name);

const BASE = (getArg('--base') || 'https://moltbots.app').replace(/\/+$/, '');
const BASE_URL = `${BASE}/v1`;
const SKIP_MC = hasFlag('--no-mc');
const MC_HOST = getArg('--mc-host') || undefined;
const MC_PORT = getArg('--mc-port') ? parseInt(getArg('--mc-port')) : undefined;

// ── 测试框架 ──────────────────────────────────────────

let passed = 0;
let failed = 0;
let skipped = 0;
const failures = [];

function log(icon, msg) {
  console.log(`  ${icon} ${msg}`);
}

async function test(name, fn) {
  try {
    await fn();
    passed++;
    log('✓', name);
  } catch (err) {
    failed++;
    const msg = err?.message || String(err);
    log('✗', `${name} — ${msg}`);
    failures.push({ name, error: msg });
  }
}

function skip(name, reason) {
  skipped++;
  log('○', `${name} (跳过: ${reason})`);
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg || 'assertEqual'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ── HTTP 工具 ──────────────────────────────────────────

async function api(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const opts = { method, headers };
  if (body !== undefined) opts.body = JSON.stringify(body);

  const url = path.startsWith('http') ? path : `${BASE_URL}${path}`;
  const res = await fetch(url, opts);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

// ── 测试开始 ──────────────────────────────────────────

async function main() {
  console.log(`\n🔧 ClawCraft MC Controller 测试`);
  console.log(`   Controller: ${BASE_URL}`);
  console.log(`   跳过 MC 测试: ${SKIP_MC}\n`);

  // ════════════════════════════════════════════════════
  // 第 1 层：不需要 MC 服务器
  // ════════════════════════════════════════════════════
  console.log('── 第 1 层: 基础 API（无需 MC 服务器）──');

  // --- Health ---
  await test('GET /health 返回 ok', async () => {
    const { status, data } = await api('GET', '/health');
    assertEqual(status, 200, 'status');
    assertEqual(data.status, 'ok', 'health status');
    assert(typeof data.uptime === 'number', 'uptime should be number');
  });

  // --- Auth ---
  let tokenA, tokenB;

  await test('POST /auth/register 注册 agent-a', async () => {
    const { status, data } = await api('POST', '/auth/register', { agentId: 'test-agent-a' });
    assertEqual(status, 200, 'status');
    assert(data.token, 'should return token');
    assertEqual(data.agentId, 'test-agent-a', 'agentId');
    tokenA = data.token;
  });

  await test('POST /auth/register 注册 agent-b', async () => {
    const { status, data } = await api('POST', '/auth/register', { agentId: 'test-agent-b' });
    assertEqual(status, 200, 'status');
    assert(data.token, 'should return token');
    tokenB = data.token;
  });

  await test('POST /auth/register 缺少 agentId 返回 400', async () => {
    const { status } = await api('POST', '/auth/register', {});
    assertEqual(status, 400, 'status');
  });

  await test('POST /auth/refresh 刷新 token', async () => {
    const { status, data } = await api('POST', '/auth/refresh', {}, tokenA);
    assertEqual(status, 200, 'status');
    assert(data.token, 'should return new token');
    tokenA = data.token; // 使用新 token
  });

  await test('无 token 访问受保护路由返回 401', async () => {
    const { status } = await api('GET', '/bots');
    assertEqual(status, 401, 'status');
  });

  await test('无效 token 返回 401', async () => {
    const { status } = await api('GET', '/bots', undefined, 'invalid-token-xxx');
    assertEqual(status, 401, 'status');
  });

  // --- Bot 创建（不连接 MC）---
  await test('POST /bots 创建 bot-a', async () => {
    const { status, data } = await api('POST', '/bots', { botId: 'test-bot-a', username: 'TestBotA' }, tokenA);
    assertEqual(status, 201, 'status');
    assertEqual(data.botId, 'test-bot-a', 'botId');
    assertEqual(data.status, 'created', 'status');
  });

  await test('POST /bots 创建 bot-b', async () => {
    const { status, data } = await api('POST', '/bots', { botId: 'test-bot-b', username: 'TestBotB' }, tokenB);
    assertEqual(status, 201, 'status');
    assertEqual(data.botId, 'test-bot-b', 'botId');
  });

  await test('POST /bots 重复创建返回 409', async () => {
    const { status } = await api('POST', '/bots', { botId: 'test-bot-a' }, tokenA);
    assertEqual(status, 409, 'status');
  });

  await test('POST /bots 缺少 botId 返回 400', async () => {
    const { status } = await api('POST', '/bots', {}, tokenA);
    assertEqual(status, 400, 'status');
  });

  await test('GET /bots 列出所有 bot', async () => {
    const { status, data } = await api('GET', '/bots', undefined, tokenA);
    assertEqual(status, 200, 'status');
    assert(Array.isArray(data.bots), 'bots should be array');
    const botA = data.bots.find(b => b.botId === 'test-bot-a');
    assert(botA, 'should find test-bot-a');
    assertEqual(botA.online, false, 'bot should be offline');
    assertEqual(botA.status, 'created', 'status');
  });

  // --- 权限检查 ---
  await test('agent-b 不能操作 agent-a 的 bot', async () => {
    const { status } = await api('POST', '/bots/test-bot-a/disconnect', {}, tokenB);
    assertEqual(status, 403, 'status');
  });

  // --- Actions 列表（不需要连接）---
  await test('GET /bots/:id/actions 返回动作列表', async () => {
    const { status, data } = await api('GET', '/bots/test-bot-a/actions', undefined, tokenA);
    assertEqual(status, 200, 'status');
    assert(Array.isArray(data.actions), 'actions should be array');
    assert(data.actions.length >= 30, `should have 30+ actions, got ${data.actions.length}`);
    assert(data.actions.includes('go_to_position'), 'should include go_to_position');
    assert(data.actions.includes('collect_block'), 'should include collect_block');
    assert(data.actions.includes('craft_recipe'), 'should include craft_recipe');
    assert(data.actions.includes('attack_nearest'), 'should include attack_nearest');
  });

  // --- 未连接 Bot 操作应报错 ---
  await test('未连接的 bot 查询状态返回 400', async () => {
    const { status } = await api('GET', '/bots/test-bot-a/state', undefined, tokenA);
    assertEqual(status, 400, 'status');
  });

  await test('未连接的 bot 执行动作返回 400', async () => {
    const { status } = await api('POST', '/bots/test-bot-a/action', { action: 'stay' }, tokenA);
    assertEqual(status, 400, 'status');
  });

  // --- Trade 历史 & 市场（空数据）---
  await test('GET /trades/history 返回空历史', async () => {
    const { status, data } = await api('GET', '/trades/history', undefined, tokenA);
    assertEqual(status, 200, 'status');
    assert(Array.isArray(data.trades), 'trades should be array');
  });

  await test('GET /trades/market 返回市场汇总', async () => {
    const { status, data } = await api('GET', '/trades/market', undefined, tokenA);
    assertEqual(status, 200, 'status');
    assert(data.period, 'should have period');
    assert(Array.isArray(data.summary), 'summary should be array');
  });

  // ════════════════════════════════════════════════════
  // 第 2 层：需要 MC 服务器
  // ════════════════════════════════════════════════════
  if (SKIP_MC) {
    console.log('\n── 第 2 层: MC 连接测试（已跳过 --no-mc）──');
    skip('Bot 连接到 MC 服务器', '--no-mc');
    skip('状态查询', '--no-mc');
    skip('动作执行', '--no-mc');
    skip('Modes 控制', '--no-mc');
    skip('消息系统', '--no-mc');
    skip('交易系统', '--no-mc');
  } else {
    console.log('\n── 第 2 层: MC 连接测试 ──');

    const connectBody = {};
    if (MC_HOST) connectBody.host = MC_HOST;
    if (MC_PORT) connectBody.port = MC_PORT;

    let botAConnected = false;
    let botBConnected = false;

    await test('POST /bots/test-bot-a/connect 连接 MC', async () => {
      const { status, data } = await api('POST', '/bots/test-bot-a/connect', connectBody, tokenA);
      assertEqual(status, 200, 'status');
      assertEqual(data.status, 'connected', 'connection status');
      assert(data.position, 'should return position');
      assert(typeof data.position.x === 'number', 'position.x');
      botAConnected = true;
      console.log(`     📍 Bot A 出生点: (${data.position.x}, ${data.position.y}, ${data.position.z})`);
    });

    await test('POST /bots/test-bot-b/connect 连接 MC', async () => {
      const { status, data } = await api('POST', '/bots/test-bot-b/connect', connectBody, tokenB);
      assertEqual(status, 200, 'status');
      assertEqual(data.status, 'connected', 'connection status');
      botBConnected = true;
      console.log(`     📍 Bot B 出生点: (${data.position.x}, ${data.position.y}, ${data.position.z})`);
    });

    if (!botAConnected) {
      console.log('\n  ⚠ Bot A 连接失败，跳过后续所有 MC 测试\n');
    } else {
      // 等待 Bot 完全加载
      await new Promise(r => setTimeout(r, 2000));

      // --- 状态查询 ---
      console.log('\n── 状态查询 ──');

      await test('GET /bots/:id/state 完整状态快照', async () => {
        const { status, data } = await api('GET', '/bots/test-bot-a/state', undefined, tokenA);
        assertEqual(status, 200, 'status');
        assert(data.botId === 'test-bot-a', 'botId');
        assert(data.position, 'should have position');
        assert(typeof data.health === 'number', 'health should be number');
        assert(typeof data.food === 'number', 'food should be number');
        assert(data.inventory, 'should have inventory');
        assert(data.modes, 'should have modes');
        console.log(`     ❤ HP: ${data.health}, 🍗 Food: ${data.food}, 🌍 Dim: ${data.dimension || 'N/A'}`);
      });

      await test('GET /bots/:id/position 坐标', async () => {
        const { status, data } = await api('GET', '/bots/test-bot-a/position', undefined, tokenA);
        assertEqual(status, 200, 'status');
        assert(data.position, 'should have position');
        assert(typeof data.position.x === 'number', 'x');
        assert(typeof data.position.y === 'number', 'y');
        assert(typeof data.position.z === 'number', 'z');
      });

      await test('GET /bots/:id/inventory 背包', async () => {
        const { status, data } = await api('GET', '/bots/test-bot-a/inventory', undefined, tokenA);
        assertEqual(status, 200, 'status');
        assert(data.counts !== undefined, 'should have counts');
        assert(Array.isArray(data.stacks), 'stacks should be array');
      });

      await test('GET /bots/:id/nearby 附近环境', async () => {
        const { status, data } = await api('GET', '/bots/test-bot-a/nearby', undefined, tokenA);
        assertEqual(status, 200, 'status');
        assert(Array.isArray(data.blocks), 'blocks should be array');
        assert(Array.isArray(data.entities), 'entities should be array');
        assert(Array.isArray(data.players), 'players should be array');
        console.log(`     🧱 附近方块: ${data.blocks.slice(0, 5).join(', ')}...`);
        console.log(`     👾 附近实体: ${data.entities.length > 0 ? data.entities.join(', ') : '(无)'}`);
      });

      await test('GET /bots/:id/nearby?distance=32 自定义距离', async () => {
        const { status, data } = await api('GET', '/bots/test-bot-a/nearby?distance=32', undefined, tokenA);
        assertEqual(status, 200, 'status');
        assert(Array.isArray(data.blocks), 'blocks array');
      });

      await test('GET /bots/:id/craftable 可合成物品', async () => {
        const { status, data } = await api('GET', '/bots/test-bot-a/craftable', undefined, tokenA);
        assertEqual(status, 200, 'status');
        assert(Array.isArray(data.items), 'items should be array');
        console.log(`     🔨 可合成: ${data.items.length > 0 ? data.items.slice(0, 5).join(', ') : '(无)'}`);
      });

      // --- Modes ---
      console.log('\n── Modes 控制 ──');

      await test('GET /bots/:id/modes 获取所有 mode', async () => {
        const { status, data } = await api('GET', '/bots/test-bot-a/modes', undefined, tokenA);
        assertEqual(status, 200, 'status');
        assert(data.modes, 'should have modes');
        const modeNames = Object.keys(data.modes);
        assert(modeNames.length >= 8, `should have 8+ modes, got ${modeNames.length}`);
        console.log(`     🎮 Modes: ${modeNames.map(m => `${m}=${data.modes[m] ? 'ON' : 'OFF'}`).join(', ')}`);
      });

      await test('PUT /bots/:id/modes/hunting 开启 hunting', async () => {
        const { status, data } = await api('PUT', '/bots/test-bot-a/modes/hunting', { on: true }, tokenA);
        assertEqual(status, 200, 'status');
        assertEqual(data.mode, 'hunting', 'mode name');
        assertEqual(data.on, true, 'should be on');
      });

      await test('PUT /bots/:id/modes/hunting 关闭 hunting', async () => {
        const { status, data } = await api('PUT', '/bots/test-bot-a/modes/hunting', { on: false }, tokenA);
        assertEqual(status, 200, 'status');
        assertEqual(data.on, false, 'should be off');
      });

      await test('PUT /bots/:id/modes/invalid_mode 返回 404', async () => {
        const { status } = await api('PUT', '/bots/test-bot-a/modes/nonexistent', { on: true }, tokenA);
        assertEqual(status, 404, 'status');
      });

      // --- 动作执行 ---
      console.log('\n── 动作执行 ──');

      await test('POST /bots/:id/action 无效动作返回 400', async () => {
        const { status, data } = await api('POST', '/bots/test-bot-a/action', { action: 'fly_to_moon' }, tokenA);
        assertEqual(status, 400, 'status');
        assert(data.available, 'should return available actions');
      });

      await test('POST /bots/:id/action 缺少 action 返回 400', async () => {
        const { status } = await api('POST', '/bots/test-bot-a/action', { params: {} }, tokenA);
        assertEqual(status, 400, 'status');
      });

      await test('POST /bots/:id/action chat 发送聊天', async () => {
        const { status, data } = await api('POST', '/bots/test-bot-a/action',
          { action: 'chat', params: { message: 'Hello from ClawCraft test!' } }, tokenA);
        assertEqual(status, 200, 'status');
        assert(data.success !== undefined, 'should have success field');
      });

      await test('POST /bots/:id/action wait 等待', async () => {
        const { status, data } = await api('POST', '/bots/test-bot-a/action',
          { action: 'wait', params: { ms: 500 } }, tokenA);
        assertEqual(status, 200, 'status');
      });

      await test('POST /bots/:id/act-batch 批量动作', async () => {
        const { status, data } = await api('POST', '/bots/test-bot-a/act-batch', {
          actions: [
            { action: 'chat', params: { message: 'Batch test 1' } },
            { action: 'wait', params: { ms: 300 } },
            { action: 'chat', params: { message: 'Batch test 2' } },
          ]
        }, tokenA);
        assertEqual(status, 200, 'status');
        assert(data.batchId || data.status, 'should return batchId or status');
      });

      await test('POST /bots/:id/act-batch 空数组返回 400', async () => {
        const { status } = await api('POST', '/bots/test-bot-a/act-batch', { actions: [] }, tokenA);
        assertEqual(status, 400, 'status');
      });

      await test('POST /bots/:id/stop 停止动作', async () => {
        const { status, data } = await api('POST', '/bots/test-bot-a/stop', {}, tokenA);
        assertEqual(status, 200, 'status');
        assertEqual(data.status, 'stopped', 'stop status');
      });

      // --- 消息系统（需要双 Bot）---
      if (botBConnected) {
        console.log('\n── 消息系统 ──');

        await test('POST /messages agent-a 向 agent-b 发消息', async () => {
          const { status, data } = await api('POST', '/messages', {
            to: 'test-bot-b',
            type: 'request',
            content: { text: 'Hello from bot-a!', data: { item: 'iron_ingot', count: 5 } }
          }, tokenA);
          assertEqual(status, 200, 'status');
          assert(data.messageId, 'should return messageId');
          assertEqual(data.delivered, true, 'should be delivered');
        });

        await test('GET /messages agent-b 收到消息', async () => {
          const { status, data } = await api('GET', '/messages?limit=10', undefined, tokenB);
          assertEqual(status, 200, 'status');
          assert(Array.isArray(data.messages), 'messages array');
          const msg = data.messages.find(m => m.from === 'test-bot-a');
          assert(msg, 'should find message from bot-a');
          assertEqual(msg.type, 'request', 'type');
          assertEqual(msg.content.text, 'Hello from bot-a!', 'content');
        });

        await test('POST /messages/broadcast 广播消息', async () => {
          const { status, data } = await api('POST', '/messages/broadcast', {
            type: 'alert',
            content: { text: 'Broadcast test!' }
          }, tokenA);
          assertEqual(status, 200, 'status');
          assert(data.sent >= 1, 'should send to at least 1 bot');
        });

        await test('GET /messages?since=时间戳过滤', async () => {
          const futureTs = Date.now() + 60000;
          const { status, data } = await api('GET', `/messages?since=${futureTs}`, undefined, tokenB);
          assertEqual(status, 200, 'status');
          assertEqual(data.messages.length, 0, 'no future messages');
        });

        await test('DELETE /messages 清除消息', async () => {
          const { status, data } = await api('DELETE', `/messages?before=${Date.now() + 1000}`, undefined, tokenB);
          assertEqual(status, 200, 'status');
          assertEqual(data.status, 'cleared', 'cleared status');
        });

        await test('GET /messages 清除后旧消息已删', async () => {
          const { status, data } = await api('GET', '/messages', undefined, tokenB);
          assertEqual(status, 200, 'status');
          // 可能有系统消息（如 trade_proposal）在 delete 之后写入，所以只验证之前的手动消息已清除
          const manualMsgs = data.messages.filter(m => m.from === 'test-bot-a' && m.type === 'request');
          assertEqual(manualMsgs.length, 0, 'manual messages should be cleared');
        });

        // --- 交易系统 ---
        console.log('\n── 交易系统 ──');

        // Bot 刚出生背包为空，createTrade 会校验背包物品，所以先测试校验逻辑
        await test('POST /trades 背包不足时正确拒绝', async () => {
          const { status, data } = await api('POST', '/trades', {
            to: 'test-bot-b',
            offer: [{ item: 'iron_ingot', count: 5 }],
            want: [{ item: 'oak_log', count: 10 }],
            message: 'Should fail - no items'
          }, tokenA);
          assertEqual(status, 400, 'status');
          assert(data.error.includes('Insufficient'), `error should mention insufficient: ${data.error}`);
        });

        // 给 Bot A 一些物品以便测试完整交易流程（需要创意模式或 /give）
        // 先尝试用 chat 命令给物品
        let hasItems = false;
        await test('给 Bot A 物品用于交易测试', async () => {
          // 尝试通过 chat 执行 /give 命令
          await api('POST', '/bots/test-bot-a/action',
            { action: 'chat', params: { message: '/give TestBotA stone 64' } }, tokenA);
          await new Promise(r => setTimeout(r, 500));
          // 检查背包
          const { data } = await api('GET', '/bots/test-bot-a/inventory', undefined, tokenA);
          hasItems = (data.counts?.stone || data.counts?.cobblestone || 0) > 0;
          if (!hasItems) {
            // 可能服务器不允许 /give，尝试 creative /gamemode
            await api('POST', '/bots/test-bot-a/action',
              { action: 'chat', params: { message: '/gamemode creative TestBotA' } }, tokenA);
            await new Promise(r => setTimeout(r, 500));
            await api('POST', '/bots/test-bot-a/action',
              { action: 'chat', params: { message: '/give TestBotA stone 64' } }, tokenA);
            await new Promise(r => setTimeout(r, 500));
            await api('POST', '/bots/test-bot-a/action',
              { action: 'chat', params: { message: '/gamemode survival TestBotA' } }, tokenA);
            await new Promise(r => setTimeout(r, 500));
            const { data: inv2 } = await api('GET', '/bots/test-bot-a/inventory', undefined, tokenA);
            hasItems = (inv2.counts?.stone || inv2.counts?.cobblestone || 0) > 0;
          }
          // 不论是否拿到物品，这个测试本身不失败
          console.log(`     📦 Bot A 背包有物品: ${hasItems}`);
          assert(true);
        });

        let tradeId;

        if (hasItems) {
          // 同样给 Bot B 物品
          await api('POST', '/bots/test-bot-b/action',
            { action: 'chat', params: { message: '/give TestBotB oak_log 64' } }, tokenB);
          await new Promise(r => setTimeout(r, 500));

          await test('POST /trades 创建交易（有物品）', async () => {
            const { data: inv } = await api('GET', '/bots/test-bot-a/inventory', undefined, tokenA);
            // 用 Bot A 实际拥有的物品创建交易
            const item = Object.keys(inv.counts).find(k => inv.counts[k] > 0);
            assert(item, 'Bot A should have at least one item');
            const { status, data } = await api('POST', '/trades', {
              to: 'test-bot-b',
              offer: [{ item, count: 1 }],
              want: [{ item: 'oak_log', count: 1 }],
              message: 'Test trade with real items'
            }, tokenA);
            assertEqual(status, 201, 'status');
            assert(data.tradeId, 'should return tradeId');
            assertEqual(data.status, 'pending', 'trade status');
            tradeId = data.tradeId;
          });

          await test('GET /trades/:id 查看交易详情', async () => {
            const { status, data } = await api('GET', `/trades/${tradeId}`, undefined, tokenA);
            assertEqual(status, 200, 'status');
            assertEqual(data.tradeId, tradeId, 'tradeId');
            assertEqual(data.status, 'pending', 'status');
          });

          await test('GET /trades agent-a 查看活跃交易', async () => {
            const { status, data } = await api('GET', '/trades', undefined, tokenA);
            assertEqual(status, 200, 'status');
            const t = data.trades.find(t => t.tradeId === tradeId);
            assert(t, 'should find the trade');
          });

          await test('GET /trades agent-b 也能看到交易', async () => {
            const { status, data } = await api('GET', '/trades', undefined, tokenB);
            assertEqual(status, 200, 'status');
            const t = data.trades.find(t => t.tradeId === tradeId);
            assert(t, 'agent-b should see the trade');
          });

          await test('PUT /trades/:id/reject agent-b 拒绝交易', async () => {
            const { status, data } = await api('PUT', `/trades/${tradeId}/reject`, {}, tokenB);
            assertEqual(status, 200, 'status');
            assertEqual(data.status, 'rejected', 'rejected');
          });

          // 测试取消
          await test('POST /trades + cancel 创建并取消交易', async () => {
            const { data: inv } = await api('GET', '/bots/test-bot-a/inventory', undefined, tokenA);
            const item = Object.keys(inv.counts).find(k => inv.counts[k] > 0);
            const { data: createData } = await api('POST', '/trades', {
              to: 'test-bot-b',
              offer: [{ item, count: 1 }],
              want: [{ item: 'dirt', count: 1 }],
            }, tokenA);
            assert(createData.tradeId, 'should create trade');
            const { status, data } = await api('PUT', `/trades/${createData.tradeId}/cancel`, {}, tokenA);
            assertEqual(status, 200, 'status');
            assertEqual(data.status, 'cancelled', 'cancelled');
          });
        } else {
          skip('完整交易流程（创建/查看/拒绝/取消）', 'Bot 背包为空，MC 服务器可能不允许 /give');
        }

        // 这些不需要物品
        await test('GET /trades/history 查看交易历史', async () => {
          const { status, data } = await api('GET', '/trades/history', undefined, tokenA);
          assertEqual(status, 200, 'status');
          assert(Array.isArray(data.trades), 'trades array');
        });

        await test('GET /trades/market?period=1h 市场汇总', async () => {
          const { status, data } = await api('GET', '/trades/market?period=1h', undefined, tokenA);
          assertEqual(status, 200, 'status');
          assertEqual(data.period, '1h', 'period');
        });

        await test('GET /trades/market?period=24h 24h 市场', async () => {
          const { status, data } = await api('GET', '/trades/market?period=24h', undefined, tokenA);
          assertEqual(status, 200, 'status');
          assertEqual(data.period, '24h', 'period');
        });
      } else {
        skip('消息系统测试', 'Bot B 未连接');
        skip('交易系统测试', 'Bot B 未连接');
      }

      // --- 移动动作测试（较慢）---
      console.log('\n── 游戏动作测试 ──');

      await test('POST /action go_to_surface 前往地表', async () => {
        const { status, data } = await api('POST', '/bots/test-bot-a/action',
          { action: 'go_to_surface', params: {} }, tokenA);
        assertEqual(status, 200, 'status');
      });

      await test('POST /action pickup_items 捡起物品', async () => {
        const { status, data } = await api('POST', '/bots/test-bot-a/action',
          { action: 'pickup_items', params: {} }, tokenA);
        assertEqual(status, 200, 'status');
      });
    }

    // ════════════════════════════════════════════════════
    // 清理
    // ════════════════════════════════════════════════════
    console.log('\n── 清理 ──');

    await test('POST /bots/test-bot-a/disconnect 断开 Bot A', async () => {
      const { status, data } = await api('POST', '/bots/test-bot-a/disconnect', {}, tokenA);
      assertEqual(status, 200, 'status');
      assertEqual(data.status, 'disconnected', 'disconnected');
    });

    if (botBConnected) {
      await test('POST /bots/test-bot-b/disconnect 断开 Bot B', async () => {
        const { status, data } = await api('POST', '/bots/test-bot-b/disconnect', {}, tokenB);
        assertEqual(status, 200, 'status');
      });
    }

    await test('DELETE /bots/test-bot-a 销毁 Bot A', async () => {
      const { status, data } = await api('POST', '/bots/test-bot-a/disconnect', {}, tokenA).catch(() => ({}));
      const r = await api('DELETE', '/bots/test-bot-a', undefined, tokenA);
      assertEqual(r.status, 200, 'status');
      assertEqual(r.data.status, 'destroyed', 'destroyed');
    });

    await test('DELETE /bots/test-bot-b 销毁 Bot B', async () => {
      const r = await api('DELETE', '/bots/test-bot-b', undefined, tokenB);
      assertEqual(r.status, 200, 'status');
    });

    await test('GET /bots 确认 bot 已清理', async () => {
      const { data } = await api('GET', '/bots', undefined, tokenA);
      const testBots = data.bots.filter(b => b.botId.startsWith('test-bot-'));
      assertEqual(testBots.length, 0, 'test bots should be cleaned up');
    });
  }

  // ════════════════════════════════════════════════════
  // 报告
  // ════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════');
  console.log(`  ✓ 通过: ${passed}`);
  console.log(`  ✗ 失败: ${failed}`);
  if (skipped > 0) console.log(`  ○ 跳过: ${skipped}`);
  console.log('══════════════════════════════════════');

  if (failures.length > 0) {
    console.log('\n失败详情:');
    failures.forEach((f, i) => {
      console.log(`  ${i + 1}. ${f.name}`);
      console.log(`     ${f.error}`);
    });
  }

  console.log('');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('测试脚本异常:', err);
  process.exit(1);
});
