const config = {
  port: parseInt(process.env.PORT || '3000'),
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-in-production',
  jwtExpiresIn: '24h',
  mc: {
    host: process.env.MC_HOST || 'localhost',
    port: parseInt(process.env.MC_PORT || '25565'),
    version: process.env.MC_VERSION || undefined,
    auth: process.env.MC_AUTH || 'offline',
  },
  modes: {
    tickInterval: 100,
  },
  trade: {
    meetingTimeout: 60000,
    defaultExpiry: 300,
  },
  messages: {
    maxPerInbox: 200,
  },
  blockPlaceDelay: parseInt(process.env.BLOCK_PLACE_DELAY || '0'),
};

export default config;
