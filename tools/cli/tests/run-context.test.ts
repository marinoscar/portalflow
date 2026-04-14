import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RunContext } from '../src/runner/run-context.js';
import pino from 'pino';

// Silent logger for tests
const logger = pino({ level: 'silent' });

describe('RunContext.resolveTemplate', () => {
  const newContext = () => new RunContext('test', logger);

  it('substitutes a known variable', () => {
    const ctx = newContext();
    ctx.setVariable('name', 'alice');
    expect(ctx.resolveTemplate('hello {{name}}')).toBe('hello alice');
  });

  it('leaves unknown variables as literal template text', () => {
    const ctx = newContext();
    expect(ctx.resolveTemplate('hello {{name}}')).toBe('hello {{name}}');
  });

  it('falls back to default value when variable is unset', () => {
    const ctx = newContext();
    expect(ctx.resolveTemplate('count: {{billCount:3}}')).toBe('count: 3');
  });

  it('uses variable value when set, ignoring the default', () => {
    const ctx = newContext();
    ctx.setVariable('billCount', '5');
    expect(ctx.resolveTemplate('count: {{billCount:3}}')).toBe('count: 5');
  });

  it('preserves colons in default values (URL case)', () => {
    const ctx = newContext();
    expect(ctx.resolveTemplate('{{url:http://localhost:3000/api}}')).toBe('http://localhost:3000/api');
  });

  it('handles empty default as empty string', () => {
    const ctx = newContext();
    expect(ctx.resolveTemplate('[{{foo:}}]')).toBe('[]');
  });

  it('does not trim whitespace in the default', () => {
    const ctx = newContext();
    expect(ctx.resolveTemplate('{{greeting: hello }}')).toBe(' hello ');
  });

  it('handles multiple templates in one string', () => {
    const ctx = newContext();
    ctx.setVariable('a', 'first');
    expect(ctx.resolveTemplate('{{a}} and {{b:second}}')).toBe('first and second');
  });
});

describe('RunContext.resolveTemplate system functions', () => {
  // Pin the clock to 2026-04-14 (a Tuesday) at 15:30:45.123 UTC for
  // deterministic date/time assertions.
  const PINNED_ISO = '2026-04-14T15:30:45.123Z';

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(PINNED_ISO));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const newContext = () => new RunContext('Daily Bills', logger);

  it('$date returns YYYY-MM-DD', () => {
    expect(newContext().resolveTemplate('{{$date}}')).toBe('2026-04-14');
  });

  it('$year and $yearShort', () => {
    const ctx = newContext();
    expect(ctx.resolveTemplate('{{$year}}')).toBe('2026');
    expect(ctx.resolveTemplate('{{$yearShort}}')).toBe('26');
  });

  it('$month is unpadded, $month0 is zero-padded', () => {
    const ctx = newContext();
    expect(ctx.resolveTemplate('{{$month}}')).toBe('4');
    expect(ctx.resolveTemplate('{{$month0}}')).toBe('04');
  });

  it('$monthName and $monthNameShort', () => {
    const ctx = newContext();
    expect(ctx.resolveTemplate('{{$monthName}}')).toBe('April');
    expect(ctx.resolveTemplate('{{$monthNameShort}}')).toBe('Apr');
  });

  it('$day and $day0', () => {
    const ctx = newContext();
    expect(ctx.resolveTemplate('{{$day}}')).toBe('14');
    expect(ctx.resolveTemplate('{{$day0}}')).toBe('14');
  });

  it('$dayOfWeek and $dayOfWeekShort (April 14 2026 is a Tuesday)', () => {
    const ctx = newContext();
    expect(ctx.resolveTemplate('{{$dayOfWeek}}')).toBe('Tuesday');
    expect(ctx.resolveTemplate('{{$dayOfWeekShort}}')).toBe('Tue');
  });

  it('$hour, $minute, $second are zero-padded (24-hour)', () => {
    const ctx = newContext();
    // The fake clock is 15:30:45 UTC; in CI/local the runner may be in a
    // different local timezone. We can't assert exact hour without knowing
    // TZ, so just assert format and length.
    expect(ctx.resolveTemplate('{{$hour}}')).toMatch(/^\d{2}$/);
    expect(ctx.resolveTemplate('{{$minute}}')).toBe('30');
    expect(ctx.resolveTemplate('{{$second}}')).toBe('45');
  });

  it('$ampm is AM or PM uppercase', () => {
    const ctx = newContext();
    expect(['AM', 'PM']).toContain(ctx.resolveTemplate('{{$ampm}}'));
  });

  it('$hour12 is 1-12 zero-padded', () => {
    const ctx = newContext();
    const v = ctx.resolveTemplate('{{$hour12}}');
    expect(v).toMatch(/^\d{2}$/);
    const n = parseInt(v, 10);
    expect(n).toBeGreaterThanOrEqual(1);
    expect(n).toBeLessThanOrEqual(12);
  });

  it('$time is HH:MM:SS', () => {
    const ctx = newContext();
    expect(ctx.resolveTemplate('{{$time}}')).toMatch(/^\d{2}:30:45$/);
  });

  it('$isoDateTime is the full ISO string in UTC', () => {
    expect(newContext().resolveTemplate('{{$isoDateTime}}')).toBe(PINNED_ISO);
  });

  it('$timestamp and $timestampSec match the pinned clock', () => {
    const ctx = newContext();
    const expectedMs = new Date(PINNED_ISO).getTime();
    expect(ctx.resolveTemplate('{{$timestamp}}')).toBe(String(expectedMs));
    expect(ctx.resolveTemplate('{{$timestampSec}}')).toBe(
      String(Math.floor(expectedMs / 1000)),
    );
  });

  it('$yesterday and $tomorrow are one day off from $date', () => {
    const ctx = newContext();
    expect(ctx.resolveTemplate('{{$yesterday}}')).toBe('2026-04-13');
    expect(ctx.resolveTemplate('{{$tomorrow}}')).toBe('2026-04-15');
  });

  it('$firstOfMonth and $lastOfMonth for April 2026', () => {
    const ctx = newContext();
    expect(ctx.resolveTemplate('{{$firstOfMonth}}')).toBe('2026-04-01');
    expect(ctx.resolveTemplate('{{$lastOfMonth}}')).toBe('2026-04-30');
  });

  it('$lastOfMonth handles February in a leap year (2024-02-29)', () => {
    vi.setSystemTime(new Date('2024-02-15T12:00:00Z'));
    expect(newContext().resolveTemplate('{{$lastOfMonth}}')).toBe('2024-02-29');
  });

  it('$runId is stable across multiple calls in the same context', () => {
    const ctx = newContext();
    const a = ctx.resolveTemplate('{{$runId}}');
    const b = ctx.resolveTemplate('{{$runId}}');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('$runId differs across two RunContext instances', () => {
    const a = newContext().resolveTemplate('{{$runId}}');
    const b = newContext().resolveTemplate('{{$runId}}');
    expect(a).not.toBe(b);
  });

  it('$uuid returns a different value on each call', () => {
    const ctx = newContext();
    const a = ctx.resolveTemplate('{{$uuid}}');
    const b = ctx.resolveTemplate('{{$uuid}}');
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('$nonce is a short alphanumeric string', () => {
    const v = newContext().resolveTemplate('{{$nonce}}');
    expect(v).toMatch(/^[a-z0-9]+$/);
    expect(v.length).toBeGreaterThanOrEqual(4);
  });

  it('$automationName returns the constructor argument', () => {
    expect(newContext().resolveTemplate('{{$automationName}}')).toBe('Daily Bills');
  });

  it('$startedAt is an ISO timestamp', () => {
    expect(newContext().resolveTemplate('{{$startedAt}}')).toBe(PINNED_ISO);
  });

  it('unknown $function is left literal', () => {
    expect(newContext().resolveTemplate('{{$nope}}')).toBe('{{$nope}}');
  });

  it('default suffix on a system function is silently ignored', () => {
    expect(newContext().resolveTemplate('{{$date:fallback}}')).toBe('2026-04-14');
  });

  it('user variable named "name" is unaffected by the new $-path', () => {
    const ctx = newContext();
    ctx.setVariable('name', 'alice');
    expect(ctx.resolveTemplate('hello {{name}}')).toBe('hello alice');
  });

  it('mixes user variables and system functions in one template', () => {
    const ctx = newContext();
    ctx.setVariable('username', 'alice');
    expect(ctx.resolveTemplate('report-{{$date}}-{{username}}.pdf')).toBe(
      'report-2026-04-14-alice.pdf',
    );
  });

  it('two $uuid references in one template produce different ids', () => {
    const out = newContext().resolveTemplate('{{$uuid}}-{{$uuid}}');
    const [a, b] = out.split('-').reduce<string[]>((acc, _part, idx, arr) => {
      // The uuids are 5 hyphen-separated groups each, joined by a hyphen too.
      // Just split the whole output every 36 chars + 1 hyphen.
      if (idx === 0) {
        acc.push(arr.slice(0, 5).join('-'));
        acc.push(arr.slice(5).join('-'));
      }
      return acc;
    }, []);
    expect(a).not.toBe(b);
  });
});
