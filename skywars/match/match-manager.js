import { MatchStats } from './stats.js';
import { writeFileSync, mkdirSync } from 'fs';

export class MatchManager {
  constructor(GameCoordinator, botConfigs, matchCount = 5) {
    this.GameCoordinator = GameCoordinator;
    this.botConfigs = botConfigs;
    this.matchCount = matchCount;
    this.stats = new MatchStats();
  }

  async runTournament() {
    console.log(`[tournament] starting ${this.matchCount} matches`);

    for (let i = 1; i <= this.matchCount; i++) {
      console.log(`\n====== Match ${i}/${this.matchCount} ======`);
      const game = new this.GameCoordinator(this.botConfigs);
      const result = await game.start();
      this.stats.recordMatch(result);

      console.log(`[tournament] Match ${i} complete. Winner: ${result.winner}`);

      // Cooldown between matches
      await new Promise(r => setTimeout(r, 5000));
    }

    const summary = this.stats.getSummary();
    console.log('\n====== TOURNAMENT RESULTS ======');
    console.log(JSON.stringify(summary, null, 2));

    // Save to file
    mkdirSync('results', { recursive: true });
    const outputPath = `results/tournament-${Date.now()}.json`;
    writeFileSync(outputPath, this.stats.exportJSON());
    console.log(`[tournament] results saved to ${outputPath}`);

    return summary;
  }
}
