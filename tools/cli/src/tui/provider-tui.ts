// Main TUI entry point — stub
import type { ConfigService } from '../config/config.service.js';

export async function runProviderTui(): Promise<void> {
  // Implementation pending
  const { ConfigService: CS } = await import('../config/config.service.js');
  const configService: ConfigService = new CS();
  void configService;
}
