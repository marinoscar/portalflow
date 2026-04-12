import pino from 'pino';

export function createRunLogger(automationName: string): pino.Logger {
  try {
    return pino({
      name: `portalflow:${automationName}`,
      level: process.env['LOG_LEVEL'] ?? 'info',
      transport: {
        target: 'pino-pretty',
        options: { colorize: true },
      },
    });
  } catch {
    // pino-pretty not available — fall back to plain JSON output
    return pino({
      name: `portalflow:${automationName}`,
      level: process.env['LOG_LEVEL'] ?? 'info',
    });
  }
}
