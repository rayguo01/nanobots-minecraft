import mineflayer from 'mineflayer';
import { pathfinder } from 'mineflayer-pathfinder';
import { plugin as pvp } from 'mineflayer-pvp';
import config from '../config.js';
import { generateSnapshot } from '../modules/perception.js';
import { getDecision } from '../strategy/llm-client.js';
import { PERSONAS } from '../strategy/prompts.js';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const bots = [];

  for (const { name, persona } of [
    { name: 'Test_Aggro', persona: 'aggressive' },
    { name: 'Test_Cautious', persona: 'cautious' },
  ]) {
    if (bots.length > 0) await sleep(5000); // connection throttle

    const bot = mineflayer.createBot({ ...config.server, username: name });
    bot.loadPlugin(pathfinder);
    bot.loadPlugin(pvp);
    await new Promise(r => bot.once('spawn', r));
    await sleep(1000);
    bots.push({ bot, name, persona });
  }

  // TP to positions
  bots[0].bot.chat('/tp Test_Aggro 8 117 -10');
  bots[1].bot.chat('/tp Test_Cautious 23 117 -10');
  bots[0].bot.chat('/give Test_Aggro cobblestone 64');
  bots[1].bot.chat('/give Test_Cautious cobblestone 64');
  await sleep(2000);

  const gameState = {
    round: 0,
    phase: 'early_game',
    mapState: { islands_looted: [], bridges_built: [], players_alive: 2, players_dead: [] },
    recentEvents: [],
  };

  // Run 3 rounds
  for (let round = 1; round <= 3; round++) {
    gameState.round = round;
    console.log(`\n--- Round ${round} ---`);

    for (const { bot, name, persona } of bots) {
      const snapshot = generateSnapshot(bot, gameState);
      console.log(`[${name}] snapshot position: (${snapshot.self.position.x}, ${snapshot.self.position.y}, ${snapshot.self.position.z})`);

      const decision = await getDecision(snapshot, PERSONAS[persona].prompt);
      console.log(`[${name}] decision: ${decision.action} — ${decision.reasoning?.slice(0, 100)}`);
    }

    await sleep(1000);
  }

  bots.forEach(b => b.bot.quit());
  console.log('\n[test] 2-bot LLM test complete');
}

main().catch(err => {
  console.error('[test] fatal:', err);
  process.exit(1);
});
