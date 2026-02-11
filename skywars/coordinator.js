import mineflayer from 'mineflayer';
import { pathfinder } from 'mineflayer-pathfinder';
import { plugin as pvp } from 'mineflayer-pvp';
import config from './config.js';
import mapConfig from './maps/islands.js';
import { generateSnapshot } from './modules/perception.js';
import { getDecision } from './strategy/llm-client.js';
import { dispatch } from './strategy/action-dispatcher.js';
import { PERSONAS } from './strategy/prompts.js';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export class GameCoordinator {
  constructor(botConfigs) {
    this.botConfigs = botConfigs;
    this.bots = new Map();
    this.gameState = {
      round: 0,
      phase: 'early_game',
      mapState: {
        islands_looted: [],
        bridges_built: [],
        players_alive: botConfigs.length,
        players_dead: [],
      },
      recentEvents: [],
    };
  }

  async start() {
    console.log(`[coordinator] starting game with ${this.botConfigs.length} bots`);

    await this.connectBots();

    while (this.gameState.mapState.players_alive > 1 && this.gameState.round < config.game.maxRounds) {
      this.gameState.round++;
      this.updatePhase();
      console.log(`\n=== Round ${this.gameState.round} (${this.gameState.phase}) ===`);

      const decisions = await this.collectDecisions();

      for (const [username, decision] of decisions) {
        if (!this.isAlive(username)) continue;
        console.log(`[coordinator] ${username} → ${decision.action}: ${decision.reasoning?.slice(0, 80)}`);
        const result = await dispatch(this.bots.get(username), decision, mapConfig);
        this.recordEvent(username, decision, result);
      }

      this.checkDeaths();

      console.log(`[coordinator] alive: ${this.gameState.mapState.players_alive}, dead: ${this.gameState.mapState.players_dead.join(', ') || 'none'}`);

      await sleep(2000);
    }

    const winner = this.getAlivePlayers();
    console.log(`\n=== GAME OVER ===`);
    console.log(`Winner: ${winner.length > 0 ? winner.join(', ') : 'no one (draw)'}`);
    console.log(`Total rounds: ${this.gameState.round}`);

    const result = {
      winner: winner[0] || null,
      rounds: this.gameState.round,
      players: this.botConfigs.map(cfg => ({
        name: cfg.username,
        persona: cfg.persona,
        survived: this.isAlive(cfg.username),
      })),
    };

    this.disconnectAll();
    return result;
  }

  async connectBots() {
    for (let i = 0; i < this.botConfigs.length; i++) {
      const cfg = this.botConfigs[i];

      if (i > 0) await sleep(5000); // connection throttle

      const bot = mineflayer.createBot({
        ...config.server,
        username: cfg.username,
      });
      bot.loadPlugin(pathfinder);
      bot.loadPlugin(pvp);

      await new Promise(r => bot.once('spawn', r));
      await sleep(1000);

      const island = mapConfig.spawnIslands[i];
      const pos = mapConfig.islands[island];
      bot.chat(`/tp ${cfg.username} ${pos.x} ${pos.y} ${pos.z}`);
      bot.chat(`/give ${cfg.username} cobblestone 64`);
      await sleep(500);

      this.bots.set(cfg.username, bot);
      console.log(`[coordinator] ${cfg.username} (${cfg.persona}) spawned on ${island}`);
    }
  }

  async collectDecisions() {
    const alivePlayers = this.getAlivePlayers();
    const decisionPromises = alivePlayers.map(async (username) => {
      const bot = this.bots.get(username);
      const cfg = this.botConfigs.find(c => c.username === username);
      const persona = PERSONAS[cfg.persona];

      const snapshot = generateSnapshot(bot, this.gameState);
      const decision = await getDecision(snapshot, persona.prompt);

      return [username, decision];
    });

    const results = await Promise.allSettled(decisionPromises);
    return results
      .filter(r => r.status === 'fulfilled')
      .map(r => r.value);
  }

  isAlive(username) {
    return !this.gameState.mapState.players_dead.includes(username);
  }

  getAlivePlayers() {
    return this.botConfigs
      .map(c => c.username)
      .filter(u => this.isAlive(u));
  }

  checkDeaths() {
    for (const [username, bot] of this.bots) {
      if (!this.isAlive(username)) continue;
      if (bot.entity.position.y < 0 || bot.health <= 0) {
        this.gameState.mapState.players_dead.push(username);
        this.gameState.mapState.players_alive--;
        this.gameState.recentEvents.push(`${username} died (Round ${this.gameState.round})`);
        console.log(`[coordinator] ${username} DIED`);
      }
    }
  }

  recordEvent(username, decision, result) {
    const summary = `${username}: ${decision.action} → ${result.success !== false ? 'success' : result.reason || 'failed'}`;
    this.gameState.recentEvents.push(`${summary} (Round ${this.gameState.round})`);
  }

  updatePhase() {
    const r = this.gameState.round;
    if (r <= 3) this.gameState.phase = 'early_game';
    else if (r <= 10) this.gameState.phase = 'mid_game';
    else if (r <= 20) this.gameState.phase = 'late_game';
    else this.gameState.phase = 'final';
  }

  disconnectAll() {
    for (const [, bot] of this.bots) {
      bot.quit();
    }
  }
}

// --- CLI Entry Point ---
const isMain = process.argv[1]?.endsWith('coordinator.js');
if (isMain) {
  const botConfigs = [
    { username: 'Bot_Aggressive', persona: 'aggressive' },
    { username: 'Bot_Cautious', persona: 'cautious' },
    { username: 'Bot_Controller', persona: 'controller' },
    { username: 'Bot_Gambler', persona: 'gambler' },
  ];

  const botCount = parseInt(process.argv[2]) || botConfigs.length;
  const activeBots = botConfigs.slice(0, botCount);

  const game = new GameCoordinator(activeBots);
  game.start().catch(err => {
    console.error('[coordinator] fatal:', err);
    process.exit(1);
  });
}
