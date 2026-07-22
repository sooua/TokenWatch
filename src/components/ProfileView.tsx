import type React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
import type { ProfileStats } from '../types/usage';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';

// One formatter per locale, built lazily and cached — the grid calls compact()
// hundreds of times per render (one per cell tooltip), so rebuilding an
// Intl.NumberFormat each call was pure waste.
const fmtCache = new Map<string, Intl.NumberFormat>();
const compact = (n: number): string => {
  if (!Number.isFinite(n)) return '0';
  const locale = i18n.language?.startsWith('zh') ? 'zh-CN' : 'en';
  let f = fmtCache.get(locale);
  if (!f) {
    f = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 });
    fmtCache.set(locale, f);
  }
  return f.format(n);
};

const DAY_MS = 24 * 60 * 60 * 1000;
const parseDay = (s: string) => new Date(`${s}T00:00:00`).getTime();
const fmtDay = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const monthLabel = (d: Date): string => {
  const locale = i18n.language?.startsWith('zh') ? 'zh-CN' : 'en';
  return new Intl.DateTimeFormat(locale, { month: 'short' }).format(d);
};

// 5-level ramp driven off the live --terracotta token (mixed with the card
// surface), so both light and dark themes get correct, well-separated steps.
// Level 0 is the empty-cell tint.
const RAMP = [
  'var(--sand)',
  'color-mix(in srgb, var(--terracotta) 25%, var(--ivory))',
  'color-mix(in srgb, var(--terracotta) 50%, var(--ivory))',
  'color-mix(in srgb, var(--terracotta) 75%, var(--ivory))',
  'var(--terracotta)',
];
const levelFor = (value: number, max: number): number => {
  if (value <= 0 || max <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil((value / max) * 4)));
};

type HeatMode = 'daily' | 'cumulative';
const WEEKS_SHOWN = 52; // one year of activity, GitHub-style

interface Cell {
  date: string;
  value: number; // drives cell color, per mode
  tokens: number; // that day's raw tokens
  cum: number; // all-time cumulative up to this day
}

// Builds `weeks` columns of day cells (columns = weeks, rows = weekday) ending
// today. Grid coloring value depends on mode; also returns the flat day list
// (for the cumulative area chart) and the per-mode max.
function buildCells(
  daily: { date: string; tokens: number }[],
  mode: HeatMode,
  weeks: number
): { columns: Cell[][]; days: Cell[]; max: number } {
  const tokenByDate = new Map(daily.map((d) => [d.date, d.tokens]));
  const cumByDate = new Map<string, number>();
  let running = 0;
  for (const d of daily) {
    running += d.tokens;
    cumByDate.set(d.date, running);
  }

  const end = parseDay(fmtDay(Date.now()));
  // Walk calendar days, not fixed 24-hour steps. A DST fall-back day is 25
  // hours long, so `+= DAY_MS` lands at 23:00 of the *same* local date and
  // emits it twice — a duplicate grid cell, every later column shifted by one
  // weekday row, a React duplicate-key warning, and that day counted twice in
  // cumulative mode. `setDate` is DST-aware.
  const cursor = new Date(end);
  cursor.setDate(cursor.getDate() - (weeks - 1) * 7);
  cursor.setDate(cursor.getDate() - cursor.getDay()); // align to prior Sunday

  const columns: Cell[][] = [];
  const days: Cell[] = [];
  let col: Cell[] = [];
  let max = 0;
  let lastCum = 0;
  while (cursor.getTime() <= end) {
    const date = fmtDay(cursor.getTime());
    const tokens = tokenByDate.get(date) ?? 0;
    const cum = cumByDate.get(date) ?? lastCum; // carry forward on gap days
    lastCum = cum;
    const value = tokens; // grid colors by daily tokens
    if (mode !== 'cumulative' && value > max) max = value;
    const cell: Cell = { date, value, tokens, cum };
    col.push(cell);
    days.push(cell);
    if (cursor.getDay() === 6) {
      columns.push(col);
      col = [];
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  if (col.length) columns.push(col);
  return { columns, days, max };
}

const StatCell: React.FC<{ value: string; label: string }> = ({ value, label }) => (
  <div className="px-2 py-1 text-center flex-1 min-w-0">
    <div
      className="font-serif"
      style={{
        color: 'var(--claude-black)',
        fontSize: '18px',
        fontWeight: 500,
        letterSpacing: '-0.01em',
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {value}
    </div>
    <div
      className="text-[10px] mt-1 leading-tight min-h-[26px] flex items-start justify-center"
      style={{ color: 'var(--claude-olive)' }}
    >
      {label}
    </div>
  </div>
);

const Bar: React.FC<{ label: string; value: string; pct: number; color: string }> = ({
  label,
  value,
  pct,
  color,
}) => (
  <div className="space-y-1">
    <div className="flex items-baseline justify-between text-[12px]">
      <span style={{ color: 'var(--claude-charcoal)' }} className="truncate mr-2">
        {label}
      </span>
      <span
        style={{ color: 'var(--claude-olive)', fontVariantNumeric: 'tabular-nums' }}
        className="flex-shrink-0"
      >
        {value}
      </span>
    </div>
    <div className="h-[6px] rounded-full overflow-hidden" style={{ background: 'var(--sand)' }}>
      <div
        className="h-full transition-all duration-700 motion-reduce:transition-none"
        style={{ width: `${Math.max(2, Math.min(100, pct))}%`, background: color }}
      />
    </div>
  </div>
);

// Toggle group with proper aria-pressed state.
const Toggle: React.FC<{
  options: { id: string; label: string }[];
  active: string;
  onSelect: (id: string) => void;
  ariaLabel: string;
}> = ({ options, active, onSelect, ariaLabel }) => (
  // biome-ignore lint/a11y/useSemanticElements: segmented toggle, not a form fieldset
  <div className="flex items-center gap-0.5 text-[12px]" role="group" aria-label={ariaLabel}>
    {options.map((o) => {
      const on = active === o.id;
      return (
        <button
          key={o.id}
          type="button"
          aria-pressed={on}
          onClick={() => onSelect(o.id)}
          className="px-2 py-0.5 rounded-md transition-colors"
          style={{
            color: on ? 'var(--claude-black)' : 'var(--claude-olive)',
            fontWeight: on ? 500 : 400,
            background: on ? 'var(--sand)' : 'transparent',
          }}
        >
          {o.label}
        </button>
      );
    })}
  </div>
);

// Cumulative growth as a filled area — the honest shape for a monotonic series
// (coloring a contribution grid by cumulative value read as near-blank).
const CumulativeArea: React.FC<{ days: Cell[] }> = ({ days }) => {
  const W = 1000; // logical width; viewBox stretches it to fill the card
  const H = 72;
  const max = days.length ? days[days.length - 1].cum : 0;
  if (max <= 0 || days.length < 2) {
    return (
      <div className="text-[12px] py-6 text-center" style={{ color: 'var(--claude-olive)' }}>
        —
      </div>
    );
  }
  const stepX = W / (days.length - 1);
  const y = (v: number) => H - (v / max) * (H - 4) - 2;
  const pts = days.map((d, i) => `${i * stepX},${y(d.cum)}`);
  const line = `M${pts.join(' L')}`;
  const area = `${line} L${W},${H} L0,${H} Z`;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height={H}
      preserveAspectRatio="none"
      role="img"
      aria-label={`Cumulative tokens reaching ${compact(max)}`}
      style={{ display: 'block' }}
    >
      <path d={area} fill="color-mix(in srgb, var(--terracotta) 14%, transparent)" />
      <path
        d={line}
        fill="none"
        stroke="var(--terracotta)"
        strokeWidth={1.75}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
};

export const ProfileView: React.FC = () => {
  const { t } = useTranslation();
  const [stats, setStats] = useState<ProfileStats | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [mode, setMode] = useState<HeatMode>('daily');

  useEffect(() => {
    let active = true;
    const fetchStats = async () => {
      try {
        const s = await window.electronAPI?.getProfileStats?.();
        if (active) setStats((s as ProfileStats) ?? null);
      } catch (err) {
        console.error('ProfileView fetch failed:', err);
      } finally {
        if (active) setLoaded(true);
      }
    };
    fetchStats();
    const listener = () => fetchStats();
    window.electronAPI?.onUsageUpdated?.(listener);
    return () => {
      active = false;
      window.electronAPI?.removeUsageUpdatedListener?.(listener);
    };
  }, []);

  const heat = useMemo(
    () => (stats ? buildCells(stats.daily, mode, WEEKS_SHOWN) : { columns: [], days: [], max: 0 }),
    [stats, mode]
  );

  const claudeColor = 'var(--terracotta)';
  const codexColor = 'var(--color-success-light)';

  // Cold start: the full ccusage parse can take a while. Show a loading state
  // until the first fetch resolves so an unfinished parse doesn't read as
  // "no data" — only show the empty state once we've actually heard back.
  if (!loaded) {
    return (
      <div
        className="py-16 text-center text-[13px] flex items-center justify-center gap-2"
        style={{ color: 'var(--claude-olive)' }}
      >
        <span
          className="inline-block w-1.5 h-1.5 rounded-full animate-pulse"
          style={{ background: 'var(--terracotta)' }}
        />
        {t('profile.loading')}
      </div>
    );
  }

  if (!stats || stats.totalTokens === 0) {
    return (
      <div className="py-16 text-center text-[13px]" style={{ color: 'var(--claude-olive)' }}>
        {t('profile.noData')}
      </div>
    );
  }

  const totalModelTokens = stats.models.reduce((s, m) => s + m.tokens, 0) || 1;
  const totalEffortTurns = stats.efforts.reduce((s, e) => s + e.turns, 0) || 1;
  const cols = heat.columns.length || 1;

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="px-1">
        <h2
          className="font-serif"
          style={{ color: 'var(--claude-black)', fontSize: '18px', fontWeight: 500 }}
        >
          {t('profile.title')}
        </h2>
        <p className="text-[12px] mt-0.5" style={{ color: 'var(--claude-olive)' }}>
          {t('profile.subtitle')}
        </p>
      </div>

      {/* Stat row */}
      <Card className="bg-[var(--ivory)] border-[var(--cream)]">
        <CardContent className="py-4">
          <div className="flex items-stretch divide-x divide-[var(--cream)]">
            <StatCell value={compact(stats.totalTokens)} label={t('profile.totalTokens')} />
            <StatCell value={compact(stats.peakDayTokens)} label={t('profile.peakTokens')} />
            <StatCell
              value={t('profile.days', { count: stats.currentStreak })}
              label={t('profile.currentStreak')}
            />
            <StatCell
              value={t('profile.days', { count: stats.longestStreak })}
              label={t('profile.longestStreak')}
            />
            <StatCell value={String(stats.activeDays)} label={t('profile.activeDays')} />
          </div>
        </CardContent>
      </Card>

      {/* Activity */}
      <Card className="bg-[var(--ivory)] border-[var(--cream)]">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle
              className="font-serif"
              style={{ color: 'var(--claude-black)', fontSize: '16px', fontWeight: 500 }}
            >
              {t('profile.activityTitle')}
            </CardTitle>
            <Toggle
              ariaLabel={t('profile.activityTitle')}
              active={mode}
              onSelect={(id) => setMode(id as HeatMode)}
              options={[
                { id: 'daily', label: t('profile.daily') },
                { id: 'cumulative', label: t('profile.cumulative') },
              ]}
            />
          </div>
        </CardHeader>
        <CardContent>
          {mode === 'cumulative' ? (
            <CumulativeArea days={heat.days} />
          ) : (
            <div
              role="img"
              aria-label={t('profile.heatmapAria', {
                active: stats.activeDays,
                peak: compact(stats.peakDayTokens),
              })}
            >
              {/* Month labels — anchored to each month's first column, in % so
                  they track the fluid grid. */}
              <div className="relative h-[14px] w-full">
                {heat.columns.map((c, i) => {
                  const first = c[0];
                  const d = first ? new Date(parseDay(first.date)) : null;
                  const prev = i > 0 ? heat.columns[i - 1][0] : null;
                  const show =
                    d &&
                    (i === 0 ||
                      (prev && new Date(parseDay(prev.date)).getMonth() !== d.getMonth()));
                  if (!show || !d) return null;
                  return (
                    <span
                      key={c[0]?.date ?? i}
                      className="absolute top-0 text-[9px]"
                      style={{
                        left: `${(i / cols) * 100}%`,
                        color: 'var(--claude-olive)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {monthLabel(d)}
                    </span>
                  );
                })}
              </div>
              {/* Grid fills the card width via 1fr columns; cells stay square
                  through aspect-ratio, so no JS measurement and no dead space. */}
              <div
                style={{
                  display: 'grid',
                  gridAutoFlow: 'column',
                  gridTemplateRows: 'repeat(7, auto)',
                  gridAutoColumns: '1fr',
                  gap: 3,
                  width: '100%',
                }}
              >
                {heat.days.map((cd) => (
                  <div
                    key={cd.date}
                    title={`${cd.date} · ${compact(cd.value)} ${t('profile.tokensSuffix')}`}
                    style={{
                      aspectRatio: '1 / 1',
                      borderRadius: 2,
                      background: RAMP[levelFor(cd.value, heat.max)],
                    }}
                  />
                ))}
              </div>
            </div>
          )}
          {/* Legend */}
          <div
            className="flex items-center justify-end gap-1 mt-2 text-[10px]"
            style={{ color: 'var(--claude-olive)' }}
          >
            <span>{t('profile.less')}</span>
            {RAMP.map((c, i) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: fixed 5-level legend
                key={i}
                className="rounded-[2px]"
                style={{ width: 11, height: 11, background: c }}
              />
            ))}
            <span>{t('profile.more')}</span>
          </div>
        </CardContent>
      </Card>

      {/* Insights: model + effort distribution */}
      <Card className="bg-[var(--ivory)] border-[var(--cream)]">
        <CardHeader className="pb-2">
          <CardTitle
            className="font-serif"
            style={{ color: 'var(--claude-black)', fontSize: '16px', fontWeight: 500 }}
          >
            {t('profile.insightsTitle')}
          </CardTitle>
          <CardDescription
            className="flex items-center gap-3"
            style={{ color: 'var(--claude-olive)' }}
          >
            <span className="inline-flex items-center gap-1.5">
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{ background: claudeColor }}
              />
              {t('profile.claude')} {compact(stats.claudeTokens)}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{ background: codexColor }}
              />
              {t('profile.codex')} {compact(stats.codexTokens)}
            </span>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <div className="mb-3">
                <div
                  className="text-[11px] uppercase"
                  style={{ color: 'var(--claude-olive)', letterSpacing: '0.08em' }}
                >
                  {t('profile.modelDistribution')}
                </div>
                <div className="text-[10px]" style={{ color: 'var(--claude-stone)' }}>
                  {t('profile.basisTokens')}
                </div>
              </div>
              <div className="space-y-2.5">
                {stats.models.slice(0, 6).map((m) => (
                  <Bar
                    key={`${m.provider}:${m.name}`}
                    label={m.name}
                    value={compact(m.tokens)}
                    pct={(m.tokens / totalModelTokens) * 100}
                    color={m.provider === 'claude' ? claudeColor : codexColor}
                  />
                ))}
              </div>
            </div>
            {stats.codexInstalled && stats.efforts.length > 0 && (
              <div>
                <div className="mb-3">
                  <div
                    className="text-[11px] uppercase"
                    style={{ color: 'var(--claude-olive)', letterSpacing: '0.08em' }}
                  >
                    {t('profile.reasoningEffort')}
                  </div>
                  <div className="text-[10px]" style={{ color: 'var(--claude-stone)' }}>
                    {t('profile.basisTurns')}
                  </div>
                </div>
                <div className="space-y-2.5">
                  {stats.efforts.map((e) => (
                    <Bar
                      key={e.effort}
                      label={e.effort}
                      value={`${Math.round((e.turns / totalEffortTurns) * 100)}%`}
                      pct={(e.turns / totalEffortTurns) * 100}
                      color={codexColor}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
