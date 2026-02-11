import mineflayer from 'mineflayer';
import { pathfinder } from 'mineflayer-pathfinder';
import { plugin as pvp } from 'mineflayer-pvp';
import config from './config.js';
import mapConfig from './maps/islands.js';
import { generateSnapshot } from './modules/perception.js';
import { getDecision } from './strategy/llm-client.js';
import { dispatch } from './strategy/action-dispatcher.js';
import { PERSONAS } from './strategy/prompts.js';
import { ChatParser } from './modules/chat-parser.js';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Wait for any ChatParser in the list to emit the given event.
 * Returns the event payload. Rejects on timeout.
 */
function waitForEvent(parsers, eventName, timeoutMs = 120_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`timeout waiting for "${eventName}" after ${timeoutMs}ms`));
    }, timeoutMs);

    function handler(data) {
      cleanup();
      resolve(data);
    }

    function cleanup() {
      clearTimeout(timer);
      for (const p of parsers) p.removeListener(eventName, handler);
    }

    for (const p of parsers) p.once(eventName, handler);
  });
}

/**
 * Game phases driven by SkyWarsReloaded plugin events.
 *
 *   idle → joining → waiting → countdown → playing_pre_pvp → playing_pvp → ended
 */
const PHASES = ['idle', 'joining', 'waiting', 'countdown', 'playing_pre_pvp', 'playing_pvp', 'ended'];

export class GameCoordinator {
  constructor(botConfigs) {
    this.botConfigs = botConfigs;
    this.bots = new Map();       // username → mineflayer bot
    this.parsers = new Map();    // username → ChatParser
    this.phase = 'idle';
    this.alivePlayers = new Set();
    this.gameState = {
      round: 0,
      phase: 'waiting',
      pvpEnabled: false,
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
    console.log(`[coordinator] starting SWR game with ${this.botConfigs.length} bots`);

    // --- 1. Connect bots and join SkyWars ---
    await this.connectBots();

    // --- 2. Wait for game to start (ChatParser 'game_start' event) ---
    console.log('[coordinator] waiting for SkyWars game to start...');
    this.phase = 'waiting';
    try {
      await waitForEvent([...this.parsers.values()], 'game_start', 180_000);
    } catch (err) {
      console.error('[coordinator] game never started:', err.message);
      this.disconnectAll();
      return { winner: null, rounds: 0, players: [], error: 'game_start timeout' };
    }

    this.phase = 'playing_pre_pvp';
    this.gameState.phase = 'playing_pre_pvp';
    console.log('[coordinator] game started! Phase: playing_pre_pvp');

    // --- 3. Decision loop (core logic — unchanged) ---
    const decisionInterval = config.swr.decisionIntervalMs;
    while (this.phase !== 'ended') {
      this.gameState.round++;
      this.gameState.phase = this.phase;
      this.gameState.mapState.players_alive = this.alivePlayers.size;

      console.log(`\n=== Decision cycle ${this.gameState.round} (${this.phase}) | alive: ${this.alivePlayers.size} ===`);

      // Exactly the same: parallel collect → sequential dispatch
      const decisions = await this.collectDecisions();

      for (const [username, decision] of decisions) {
        if (!this.alivePlayers.has(username)) continue;
        console.log(`[coordinator] ${username} → ${decision.action}: ${decision.reasoning?.slice(0, 80)}`);
        const result = await dispatch(this.bots.get(username), decision, mapConfig);
        this.recordEvent(username, decision, result);
      }

      // No more checkDeaths() — ChatParser events update alivePlayers automatically

      console.log(`[coordinator] alive: ${[...this.alivePlayers].join(', ') || 'none'}, dead: ${this.gameState.mapState.players_dead.join(', ') || 'none'}`);

      await sleep(decisionInterval);
    }

    // --- 4. Game over ---
    const winner = [...this.alivePlayers];
    console.log('\n=== GAME OVER ===');
    console.log(`Winner: ${winner.length > 0 ? winner.join(', ') : 'no one (draw)'}`);
    console.log(`Total decision cycles: ${this.gameState.round}`);

    const result = {
      winner: winner[0] || null,
      rounds: this.gameState.round,
      players: this.botConfigs.map(cfg => ({
        name: cfg.username,
        persona: cfg.persona,
        survived: this.alivePlayers.has(cfg.username),
      })),
    };

    this.disconnectAll();
    return result;
  }

  async connectBots() {
    this.phase = 'joining';
    const joinDelay = config.swr.joinDelayMs;

    for (let i = 0; i < this.botConfigs.length; i++) {
      const cfg = this.botConfigs[i];

      if (i > 0) await sleep(joinDelay);

      const bot = mineflayer.createBot({
        ...config.server,
        username: cfg.username,
      });
      bot.loadPlugin(pathfinder);
      bot.loadPlugin(pvp);

      await new Promise(r => bot.once('spawn', r));
      await sleep(1000);

      // Create ChatParser and wire up lifecycle events
      const parser = new ChatParser(bot);
      this._bindParserEvents(parser, cfg.username);

      this.bots.set(cfg.username, bot);
      this.parsers.set(cfg.username, parser);
      this.alivePlayers.add(cfg.username);

      // Join SkyWars via plugin command (replaces /tp + /give)
      bot.chat('/sw join');
      console.log(`[coordinator] ${cfg.username} (${cfg.persona}) joined SkyWars`);
    }
  }

  /**
   * Bind ChatParser events to update game state.
   * This runs passively in the background — does NOT interfere with the decision loop.
   */
  _bindParserEvents(parser, botUsername) {
    parser.on('countdown', ({ seconds }) => {
      if (this.phase === 'waiting' || this.phase === 'joining') {
        this.phase = 'countdown';
      }
      console.log(`[coordinator] countdown: ${seconds}s`);
    });

    parser.on('game_start', () => {
      if (this.phase !== 'playing_pre_pvp' && this.phase !== 'playing_pvp') {
        this.phase = 'playing_pre_pvp';
        this.gameState.phase = 'playing_pre_pvp';
      }
    });

    parser.on('pvp_enabled', () => {
      this.phase = 'playing_pvp';
      this.gameState.phase = 'playing_pvp';
      this.gameState.pvpEnabled = true;
      this.gameState.recentEvents.push('PVP is now enabled!');
      console.log('[coordinator] PVP enabled!');
    });

    parser.on('player_kill', ({ victim, killer }) => {
      this._markDead(victim);
      const event = `${victim} was killed by ${killer}`;
      this.gameState.recentEvents.push(event);
      console.log(`[coordinator] KILL: ${event}`);
    });

    parser.on('player_death', ({ player, cause }) => {
      this._markDead(player);
      const event = `${player} died (${cause})`;
      this.gameState.recentEvents.push(event);
      console.log(`[coordinator] DEATH: ${event}`);
    });

    parser.on('game_won', ({ player, map }) => {
      this.phase = 'ended';
      this.gameState.recentEvents.push(`${player} won the game on ${map}`);
      console.log(`[coordinator] WINNER: ${player} on map ${map}`);
    });

    parser.on('game_lost', ({ player, map }) => {
      this.gameState.recentEvents.push(`${player} lost the game on ${map}`);
      console.log(`[coordinator] LOST: ${player} on map ${map}`);
    });

    parser.on('game_join', ({ player, count, max }) => {
      console.log(`[coordinator] SWR join: ${player} (${count}/${max})`);
    });

    parser.on('game_leave', ({ player }) => {
      this._markDead(player);
      console.log(`[coordinator] SWR leave: ${player}`);
    });
  }

  _markDead(username) {
    if (this.alivePlayers.has(username)) {
      this.alivePlayers.delete(username);
      this.gameState.mapState.players_dead.push(username);
      this.gameState.mapState.players_alive = this.alivePlayers.size;
    }
  }

  /**
   * Collect LLM decisions for all alive players — UNCHANGED from original.
   */
  async collectDecisions() {
    const alivePlayers = [...this.alivePlayers];
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

  recordEvent(username, decision, result) {
    const summary = `${username}: ${decision.action} → ${result.success !== false ? 'success' : result.reason || 'failed'}`;
    this.gameState.recentEvents.push(summary);
  }

  disconnectAll() {
    for (const [, parser] of this.parsers) parser.destroy();
    for (const [, bot] of this.bots) bot.quit();
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
