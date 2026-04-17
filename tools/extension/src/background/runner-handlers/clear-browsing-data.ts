import type { ClearBrowsingDataCommand, ClearBrowsingDataRange, RunnerResponse } from '../../shared/runner-protocol';

export async function clearBrowsingData(
  command: ClearBrowsingDataCommand,
  _tabId: number,
): Promise<RunnerResponse> {
  if (command.range === 'none') {
    return { kind: 'result', commandId: command.commandId, ok: true, value: null };
  }

  const since = rangeToTimestamp(command.range);

  try {
    await chrome.browsingData.remove(
      { since },
      { history: true, cache: true },
    );
    return { kind: 'result', commandId: command.commandId, ok: true, value: { since, cleared: ['history', 'cache'] } };
  } catch (err) {
    return {
      kind: 'result',
      commandId: command.commandId,
      ok: false,
      message: err instanceof Error ? err.message : String(err),
      code: 'clear_browsing_data_failed',
      recoverable: true,
    };
  }
}

function rangeToTimestamp(range: ClearBrowsingDataRange): number {
  const now = Date.now();
  switch (range) {
    case 'last15min': return now - 15 * 60 * 1000;
    case 'last1hour': return now - 60 * 60 * 1000;
    case 'last24hour': return now - 24 * 60 * 60 * 1000;
    case 'last7days': return now - 7 * 24 * 60 * 60 * 1000;
    case 'all': return 0;
    default: return now;
  }
}
