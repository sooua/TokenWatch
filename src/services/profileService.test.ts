import { describe, expect, it } from 'vitest';
import { computeStreaks } from './profileService';

describe('computeStreaks', () => {
  it('returns zero for an empty set', () => {
    expect(computeStreaks([], '2026-07-11')).toEqual({ current: 0, longest: 0 });
  });

  it('counts a current streak ending today', () => {
    const dates = ['2026-07-09', '2026-07-10', '2026-07-11'];
    expect(computeStreaks(dates, '2026-07-11')).toEqual({ current: 3, longest: 3 });
  });

  it('keeps the current streak alive when today is idle but yesterday active', () => {
    const dates = ['2026-07-09', '2026-07-10'];
    expect(computeStreaks(dates, '2026-07-11')).toEqual({ current: 2, longest: 2 });
  });

  it('resets current to 0 when both today and yesterday are idle', () => {
    const dates = ['2026-07-01', '2026-07-02', '2026-07-03'];
    expect(computeStreaks(dates, '2026-07-11').current).toBe(0);
  });

  it('finds the longest run independent of the current run', () => {
    // 5-day run in June, 1 day now.
    const dates = [
      '2026-06-01',
      '2026-06-02',
      '2026-06-03',
      '2026-06-04',
      '2026-06-05',
      '2026-07-11',
    ];
    expect(computeStreaks(dates, '2026-07-11')).toEqual({ current: 1, longest: 5 });
  });

  it('handles a month boundary', () => {
    const dates = ['2026-06-30', '2026-07-01'];
    expect(computeStreaks(dates, '2026-07-01')).toEqual({ current: 2, longest: 2 });
  });
});
