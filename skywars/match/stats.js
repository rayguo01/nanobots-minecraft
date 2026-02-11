export class MatchStats {
  constructor() {
    this.matches = [];
  }

  recordMatch(result) {
    this.matches.push({
      ...result,
      timestamp: new Date().toISOString(),
    });
  }

  getPersonaWinRate() {
    const wins = {};
    const total = {};

    for (const match of this.matches) {
      for (const player of match.players) {
        total[player.persona] = (total[player.persona] || 0) + 1;
        if (player.name === match.winner) {
          wins[player.persona] = (wins[player.persona] || 0) + 1;
        }
      }
    }

    const rates = {};
    for (const persona of Object.keys(total)) {
      rates[persona] = {
        wins: wins[persona] || 0,
        total: total[persona],
        winRate: ((wins[persona] || 0) / total[persona] * 100).toFixed(1) + '%',
      };
    }
    return rates;
  }

  getSummary() {
    return {
      totalMatches: this.matches.length,
      winRates: this.getPersonaWinRate(),
      avgRoundsPerMatch: this.matches.length > 0
        ? (this.matches.reduce((s, m) => s + m.rounds, 0) / this.matches.length).toFixed(1)
        : 0,
    };
  }

  exportJSON() {
    return JSON.stringify({ matches: this.matches, summary: this.getSummary() }, null, 2);
  }
}
