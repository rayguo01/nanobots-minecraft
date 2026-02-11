import { EventEmitter } from 'events';

/**
 * Strip Minecraft color/format codes: &X, §X, and ANSI escape sequences.
 */
export function stripColors(msg) {
  return msg
    .replace(/[&§][0-9a-fk-or]/gi, '')
    .replace(/\x1b\[[0-9;]*m/g, '')
    .trim();
}

/**
 * ChatParser — passively listens to bot chat messages and emits
 * SkyWarsReloaded game-lifecycle events.
 *
 * Events:
 *   game_join   { player, count, max }
 *   game_leave  { player }
 *   countdown   { seconds }
 *   game_start  {}
 *   pvp_enabled {}
 *   player_kill { victim, killer }
 *   player_death { player, cause }
 *   game_won    { player, map }
 *   game_lost   { player, map }
 */
export class ChatParser extends EventEmitter {
  constructor(bot) {
    super();
    this.bot = bot;
    this.botUsername = bot.username;
    this._onMessage = (jsonMsg) => this._parse(jsonMsg);
    this._onTitle = (text) => this._parseTitle(text);
    bot.on('message', this._onMessage);
    // SWR sends "SkyWars has started" as a title
    bot.on('title', this._onTitle);
  }

  destroy() {
    this.bot.removeListener('message', this._onMessage);
    this.bot.removeListener('title', this._onTitle);
    this.removeAllListeners();
  }

  /** Replace "You" with the bot's own username */
  _resolveYou(name) {
    return (name === 'You' || name === 'you') ? this.botUsername : name;
  }

  _parseTitle(text) {
    const clean = stripColors(typeof text === 'string' ? text : String(text));
    if (/skywars has started/i.test(clean)) {
      this.emit('game_start', {});
    }
  }

  _parse(jsonMsg) {
    const raw = stripColors(jsonMsg.toString());
    if (!raw) return;

    // --- Join: [+] PlayerName (2/8) ---
    const joinMatch = raw.match(/\[\+\]\s*(\S+)\s*\((\d+)\/(\d+)\)/);
    if (joinMatch) {
      this.emit('game_join', {
        player: this._resolveYou(joinMatch[1]),
        count: parseInt(joinMatch[2]),
        max: parseInt(joinMatch[3]),
      });
      return;
    }

    // --- Leave: [-] PlayerName ---
    const leaveMatch = raw.match(/\[-\]\s*(\S+)/);
    if (leaveMatch) {
      this.emit('game_leave', { player: this._resolveYou(leaveMatch[1]) });
      return;
    }

    // --- Countdown: SkyWars is starting in: Xs ---
    const countdownMatch = raw.match(/SkyWars is starting in:\s*(\d+)/i);
    if (countdownMatch) {
      const seconds = parseInt(countdownMatch[1]);
      this.emit('countdown', { seconds });
      // 倒计时到 1 秒时提前发 game_start 作为备用信号
      if (seconds <= 1) {
        this.emit('game_start', {});
      }
      return;
    }

    // --- Game start (chat variant — title handled separately) ---
    if (/skywars has started/i.test(raw)) {
      this.emit('game_start', {});
      return;
    }

    // --- PVP enabled (also confirms game has started) ---
    if (/pvp is now enabled/i.test(raw)) {
      this.emit('game_start', {});
      this.emit('pvp_enabled', {});
      return;
    }

    // --- Kill: "PlayerA was killed by PlayerB" / "was shot by" ---
    const killMatch = raw.match(/(\S+) was (?:killed|shot|slain) by (\S+)/i);
    if (killMatch) {
      const victim = this._resolveYou(killMatch[1]);
      const killer = this._resolveYou(killMatch[2]);
      this.emit('player_kill', { victim, killer });
      this.emit('player_death', { player: victim, cause: `killed by ${killer}` });
      return;
    }

    // --- Death: "PlayerA died in the void" / "PlayerA died" ---
    const voidDeath = raw.match(/(\S+) died in the void/i);
    if (voidDeath) {
      this.emit('player_death', { player: this._resolveYou(voidDeath[1]), cause: 'void' });
      return;
    }
    const genericDeath = raw.match(/(\S+) died/i);
    if (genericDeath) {
      this.emit('player_death', { player: this._resolveYou(genericDeath[1]), cause: 'unknown' });
      return;
    }

    // --- Won: "You/PlayerA won a SkyWars game on the map MapName" ---
    const wonMatch = raw.match(/(\S+) won a SkyWars game on the map (\S+)/i);
    if (wonMatch) {
      this.emit('game_won', { player: this._resolveYou(wonMatch[1]), map: wonMatch[2] });
      return;
    }

    // --- Lost: "You/PlayerA lost a SkyWars game on the map MapName" ---
    const lostMatch = raw.match(/(\S+) lost a SkyWars game on the map (\S+)/i);
    if (lostMatch) {
      this.emit('game_lost', { player: this._resolveYou(lostMatch[1]), map: lostMatch[2] });
      return;
    }
  }
}
