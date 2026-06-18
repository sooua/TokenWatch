import { describe, expect, it } from 'vitest';
import {
  PLAN_LIMITS,
  calculateBurnRate,
  detectPlan,
  getTokenLimit,
  toISOStringLocal,
} from './ccusage-utils';

describe('toISOStringLocal', () => {
  it('formats a date in local time with the system offset suffix', () => {
    const d = new Date(2026, 3, 18, 14, 30, 45, 123); // 2026-04-18 14:30:45.123 local
    const out = toISOStringLocal(d);
    // We can't hard-code the offset (tests run on machines in various zones)
    // but the shape is invariant: yyyy-mm-ddThh:mm:ss.sss±hh:mm.
    expect(out).toMatch(/^2026-04-18T14:30:45\.123[+-]\d{2}:\d{2}$/);
  });

  it('zero-pads single-digit components', () => {
    const d = new Date(2026, 0, 3, 4, 5, 6, 7); // Jan 3 04:05:06.007
    const out = toISOStringLocal(d);
    expect(out.startsWith('2026-01-03T04:05:06.007')).toBe(true);
  });
});

describe('detectPlan', () => {
  it('classifies each bracket on its upper bound', () => {
    expect(detectPlan(0)).toBe('Pro');
    expect(detectPlan(PLAN_LIMITS.Pro)).toBe('Pro');
    expect(detectPlan(PLAN_LIMITS.Pro + 1)).toBe('Max5');
    expect(detectPlan(PLAN_LIMITS.Max5)).toBe('Max5');
    expect(detectPlan(PLAN_LIMITS.Max5 + 1)).toBe('Max20');
    expect(detectPlan(PLAN_LIMITS.Max20)).toBe('Max20');
    expect(detectPlan(PLAN_LIMITS.Max20 + 1)).toBe('Custom');
    expect(detectPlan(PLAN_LIMITS.Custom + 1)).toBe('Custom');
  });
});

describe('getTokenLimit', () => {
  it('returns the per-plan 5h-window cap', () => {
    expect(getTokenLimit('Pro')).toBe(PLAN_LIMITS.Pro);
    expect(getTokenLimit('Max5')).toBe(PLAN_LIMITS.Max5);
    expect(getTokenLimit('Max20')).toBe(PLAN_LIMITS.Max20);
  });

  it('falls back to the Custom ceiling for unknown plans', () => {
    expect(getTokenLimit('Custom')).toBe(PLAN_LIMITS.Custom);
    expect(getTokenLimit('auto')).toBe(PLAN_LIMITS.Custom);
    expect(getTokenLimit('')).toBe(PLAN_LIMITS.Custom);
  });
});

describe('calculateBurnRate', () => {
  const now = new Date('2026-04-18T12:00:00.000Z');

  it('averages input+output+cacheCreation tokens over 24 h', () => {
    const data = [
      {
        date: '2026-04-18T06:00:00.000Z',
        inputTokens: 240,
        outputTokens: 0,
        cacheCreationTokens: 0,
      },
    ];
    // 240 / 24 = 10 tokens/hr
    expect(calculateBurnRate(data, now)).toBe(10);
  });

  it('drops entries older than 24 h', () => {
    const data = [
      // 48 h old — excluded
      { date: '2026-04-16T12:00:00.000Z', inputTokens: 1_000_000 },
      // 12 h old — included
      { date: '2026-04-18T00:00:00.000Z', inputTokens: 2400 },
    ];
    expect(calculateBurnRate(data, now)).toBe(100);
  });

  it('sums all three token types', () => {
    const data = [
      {
        date: '2026-04-18T06:00:00.000Z',
        inputTokens: 100,
        outputTokens: 200,
        cacheCreationTokens: 300,
      },
    ];
    // (100+200+300)/24 = 25
    expect(calculateBurnRate(data, now)).toBe(25);
  });

  it('returns zero for an empty window', () => {
    expect(calculateBurnRate([], now)).toBe(0);
  });

  it('treats missing token fields as zero', () => {
    const data = [{ date: '2026-04-18T06:00:00.000Z' }];
    expect(calculateBurnRate(data, now)).toBe(0);
  });
});
