import { EventEmitter } from 'events';

/**
 * Strip Minecraft color/format codes: &X, §X, and ANSI escape sequences.
 * mineflayer's msg.toString() usually strips § codes already, but we
 * handle them defensively in case raw JSON or toAnsi() leaks through.
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
    this._onMessage = (jsonMsg) => this._parse(jsonMsg);
    this._onTitle = (text) => this._parseTitle(text);
    bot.on('message', this._onMessage);
    // SWR sends "SkyWars has started" as a title action bar / title
    bot.on('title', this._onTitle);
  }

  destroy() {
    this.bot.removeListener('message', this._onMessage);
    this.bot.removeListener('title', this._onTitle);
    this.removeAllListeners();
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
        player: joinMatch[1],
        count: parseInt(joinMatch[2]),
        max: parseInt(joinMatch[3]),
      });
      return;
    }

    // --- Leave: [-] PlayerName ---
    const leaveMatch = raw.match(/\[-\]\s*(\S+)/);
    if (leaveMatch) {
      this.emit('game_leave', { player: leaveMatch[1] });
      return;
    }

    // --- Countdown: SkyWars is starting in: Xs ---
    const countdownMatch = raw.match(/SkyWars is starting in:\s*(\d+)/i);
    if (countdownMatch) {
      this.emit('countdown', { seconds: parseInt(countdownMatch[1]) });
      return;
    }

    // --- Game start (chat variant — title handled separately) ---
    if (/skywars has started/i.test(raw)) {
      this.emit('game_start', {});
      return;
    }

    // --- PVP enabled ---
    if (/pvp is now enabled/i.test(raw)) {
      this.emit('pvp_enabled', {});
      return;
    }

    // --- Kill: "PlayerA was killed by PlayerB" / "was shot by" ---
    const killMatch = raw.match(/(\S+) was (?:killed|shot|slain) by (\S+)/i);
    if (killMatch) {
      this.emit('player_kill', { victim: killMatch[1], killer: killMatch[2] });
      this.emit('player_death', { player: killMatch[1], cause: `killed by ${killMatch[2]}` });
      return;
    }

    // --- Death: "PlayerA died in the void" / "PlayerA died" ---
    const voidDeath = raw.match(/(\S+) died in the void/i);
    if (voidDeath) {
      this.emit('player_death', { player: voidDeath[1], cause: 'void' });
      return;
    }
    const genericDeath = raw.match(/(\S+) died/i);
    if (genericDeath) {
      // Avoid double-firing on "died in the void" (handled above)
      this.emit('player_death', { player: genericDeath[1], cause: 'unknown' });
      return;
    }

    // --- Won: "PlayerA won a SkyWars game on the map MapName" ---
    const wonMatch = raw.match(/(\S+) won a SkyWars game on the map (\S+)/i);
    if (wonMatch) {
      this.emit('game_won', { player: wonMatch[1], map: wonMatch[2] });
      return;
    }

    // --- Lost: "PlayerA lost a SkyWars game on the map MapName" ---
    const lostMatch = raw.match(/(\S+) lost a SkyWars game on the map (\S+)/i);
    if (lostMatch) {
      this.emit('game_lost', { player: lostMatch[1], map: lostMatch[2] });
      return;
    }
  }
}
