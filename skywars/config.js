const config = {
  server: {
    host: process.env.MC_HOST || 'localhost',
    port: parseInt(process.env.MC_PORT || '25565'),
    version: '1.20.1',
  },
  game: {
    roundIntervalMs: 30_000,
    roundTimeoutMs: 30_000,
    maxRounds: 50,
  },
  equipment: {
    tierScore: {
      diamond: 4,
      iron: 3,
      chainmail: 2,
      golden: 2,
      leather: 1,
    },
    slotScore: {
      chestplate: 3,
      leggings: 2,
      helmet: 1,
      boots: 1,
    },
  },
  bridging: {
    pollIntervalMs: 50,
    placeDelayMs: 300,
    timeoutMs: 60_000,
    blockName: 'cobblestone',
  },
  combat: {
    meleeReachBlocks: 3.5,
    rangedMaxBlocks: 30,
    retreatDistanceBlocks: 8,
    lowHealthThreshold: 6,
    voidYThreshold: 0,
    knockbackCheckRadiusBlocks: 2,
  },
  llm: {
    // provider: 'anthropic' | 'gemini'
    provider: 'gemini',
    model: 'gemini-2.5-flash',
    apiKey: 'AIzaSyCVz5Rfloi_2O2PMhcjOWuwGKxn_QADE1c',
    maxTokens: 1024,
    maxRetries: 1,
  },
  swr: {
    mapName: 'botarena',
    decisionIntervalMs: 12_000,
    joinDelayMs: 5000,
    prePvpActions: ['loot_chest', 'bridge_to', 'wait'],
  },
};

export default config;
