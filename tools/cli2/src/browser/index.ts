export { ExtensionHost, ExtensionCommandError } from './extension-host.js';
export type { ExtensionHostOptions } from './extension-host.js';
export { PageClient } from './page-client.js';
export type { PageClientOptions } from './page-client.js';

// Re-export protocol type guards for downstream consumers.
export {
  isRunnerResponse,
  isRunnerEvent,
  RUNNER_PROTOCOL_VERSION,
} from './protocol.js';

export type {
  RunnerCommand,
  RunnerResponse,
  RunnerResult,
  RunnerError,
  RunnerEvent,
  RunnerSession,
  NavigateCommand,
  InteractCommand,
  WaitCommand,
  ExtractCommand,
  DownloadCommand,
  ScreenshotCommand,
  CountMatchingCommand,
  AnyMatchCommand,
  OpenWindowCommand,
  CloseWindowCommand,
  TabSelector,
  SelectorCascade,
  WaitCondition,
  ExtractTarget,
  InteractAction,
  DownloadTrigger,
  LogLevel,
  ServerToClient,
  ClientToServer,
} from './protocol.js';
