import {
  Activity,
  BarChart3,
  CalendarDays,
  Clock,
  Coins,
  Flame,
  Gauge,
  LineChart,
  Sparkles,
} from 'lucide-react';
import type React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { UsageStats } from '../types/usage';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';

interface AnalyticsProps {
  stats: UsageStats;
  preferences: Record<string, unknown>;
}

type ChartTimeRange = '7d' | '30d';
type ChartType = 'area' | 'line' | 'bar';

// ---------------- helpers ----------------

const formatNumber = (num: number) => {
  if (!num || Number.isNaN(num)) return '0';
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toLocaleString();
};

const formatCurrency = (amount: number) =>
  !amount || Number.isNaN(amount)
    ? '$0.000'
    : new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 3,
        maximumFractionDigits: 5,
      }).format(amount);

// Translator-aware: returns a localized string from a translator function.
const getDepletionText = (
  stats: UsageStats,
  t: (key: string, opts?: Record<string, unknown>) => string
) => {
  if (!stats.predictedDepleted || stats.burnRate <= 0) return t('analytics.depletionNone');
  try {
    const depletionDate = new Date(stats.predictedDepleted);
    if (Number.isNaN(depletionDate.getTime())) return t('analytics.depletionNone');
    const diffDays = Math.ceil((depletionDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    if (diffDays < 0) return t('analytics.depletionDone');
    if (diffDays === 0) return t('analytics.depletionToday');
    if (diffDays === 1) return t('analytics.depletionTomorrow');
    if (diffDays < 7) return t('analytics.depletionDays', { count: diffDays });
    if (diffDays < 30) return t('analytics.depletionWeeks', { count: Math.ceil(diffDays / 7) });
    return t('analytics.depletionMonths', { count: Math.ceil(diffDays / 30) });
  } catch {
    return t('analytics.depletionNone');
  }
};

// Warm palette for model colors — terracotta family + olive, no rainbow.
const modelColors = ['#c96442', '#8a6b4a', '#5e5d59', '#b0aea5'];

// ---------------- small pieces ----------------

type SegmentedOption<T extends string> = {
  value: T;
  label: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
};

function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div
      className="inline-flex rounded-lg p-0.5"
      style={{ background: 'var(--sand)', border: '1px solid var(--ring-warm)' }}
    >
      {options.map(({ value: v, label, icon: Icon }) => {
        const active = value === v;
        return (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-all text-[12px]"
            style={{
              background: active ? 'var(--ivory)' : 'transparent',
              color: active ? 'var(--claude-black)' : 'var(--claude-olive)',
              boxShadow: active ? '0 0 0 1px var(--ring-deep)' : 'none',
              fontWeight: active ? 500 : 400,
              letterSpacing: '0.02em',
            }}
          >
            <Icon className="w-3.5 h-3.5" strokeWidth={1.75} />
            {label}
          </button>
        );
      })}
    </div>
  );
}

const SummaryTile: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div
    className="px-3 py-3 rounded-lg"
    style={{
      background: 'var(--parchment)',
      border: '1px solid var(--cream)',
    }}
  >
    <div
      className="font-serif leading-none"
      style={{
        color: 'var(--claude-black)',
        fontSize: '20px',
        fontWeight: 500,
        letterSpacing: '-0.01em',
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {value}
    </div>
    <div
      className="text-[11px] mt-1.5"
      style={{ color: 'var(--claude-olive)', letterSpacing: '0.02em' }}
    >
      {label}
    </div>
  </div>
);

// ---------------- hooks ----------------

const useChartData = (stats: UsageStats, timeRange: ChartTimeRange) =>
  useMemo(() => {
    const rawData = timeRange === '7d' ? stats.thisWeek : stats.thisMonth;
    return rawData.map((day, index) => ({
      shortDate: new Date(day.date).toLocaleDateString('en-US', {
        month: 'numeric',
        day: 'numeric',
      }),
      fullDate: day.date,
      totalTokens: day.totalTokens,
      totalCost: day.totalCost,
      dayIndex: index,
    }));
  }, [stats, timeRange]);

const useModelBreakdown = (stats: UsageStats) =>
  useMemo(() => {
    const today = stats.today;
    if (!today.models || Object.keys(today.models).length === 0) return [];
    return Object.entries(today.models).map(([model, data], index) => ({
      name: model
        .replace(/^claude-/, '')
        .replace(/-(\d{8}.*)?$/, '')
        .replace('opus', 'Opus')
        .replace('sonnet', 'Sonnet')
        .replace('haiku', 'Haiku')
        .trim(),
      value: data.tokens,
      cost: data.cost,
      percentage: today.totalTokens > 0 ? (data.tokens / today.totalTokens) * 100 : 0,
      color: modelColors[index % modelColors.length],
    }));
  }, [stats]);

const useChartDimensions = () => {
  const [dim, setDim] = useState({ width: 0, height: 220 });
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const update = () => {
      if (ref.current) setDim({ width: ref.current.clientWidth, height: 220 });
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  return { dim, ref };
};

// ---------------- chart ----------------

const MainChart: React.FC<{
  chartData: ReturnType<typeof useChartData>;
  chartType: ChartType;
  selectedMetric: 'tokens' | 'cost';
  timeRange: ChartTimeRange;
  dim: { width: number; height: number };
  chartRef: React.RefObject<HTMLDivElement | null>;
}> = ({ chartData, chartType, selectedMetric, timeRange, dim, chartRef }) => {
  const { t } = useTranslation();
  const maxValue = useMemo(() => {
    if (chartData.length === 0) return 1;
    const values = chartData.map((d) =>
      selectedMetric === 'tokens' ? d.totalTokens : d.totalCost
    );
    const max = Math.max(...values);
    return max > 0 ? max : 1;
  }, [chartData, selectedMetric]);

  const width = dim.width;
  const height = dim.height;
  const padding = { top: 16, right: 16, bottom: 28, left: 44 };
  const plotWidth = Math.max(width - padding.left - padding.right, 0);
  const plotHeight = Math.max(height - padding.top - padding.bottom, 0);

  const points = chartData.map((d, i) => {
    const x = padding.left + (i / Math.max(chartData.length - 1, 1)) * plotWidth;
    const value = selectedMetric === 'tokens' ? d.totalTokens : d.totalCost;
    const y = padding.top + plotHeight - (value / maxValue) * plotHeight;
    return { x, y, value };
  });

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const areaPath =
    points.length === 0
      ? ''
      : `${linePath} L ${points[points.length - 1].x} ${padding.top + plotHeight} L ${padding.left} ${padding.top + plotHeight} Z`;

  return (
    <Card className="bg-[var(--ivory)] border-[var(--cream)]">
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3
              className="font-serif mb-1"
              style={{
                color: 'var(--claude-black)',
                fontSize: '18px',
                fontWeight: 500,
                letterSpacing: '-0.005em',
              }}
            >
              {selectedMetric === 'tokens'
                ? t('analytics.trendTitleTokens')
                : t('analytics.trendTitleCost')}
            </h3>
            <p className="text-[12px]" style={{ color: 'var(--claude-olive)' }}>
              {t('analytics.trendSubtitle', {
                range:
                  timeRange === '7d' ? t('analytics.trendLast7d') : t('analytics.trendLast30d'),
                chart:
                  chartType === 'area'
                    ? t('analytics.chartArea')
                    : chartType === 'line'
                      ? t('analytics.chartLine')
                      : t('analytics.chartBar'),
              })}
            </p>
          </div>

          <span
            className="px-2.5 py-1 rounded-md text-[11px]"
            style={{
              color: 'var(--claude-olive)',
              background: 'var(--sand)',
              letterSpacing: '0.02em',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {t('analytics.max', {
              value:
                selectedMetric === 'tokens' ? formatNumber(maxValue) : formatCurrency(maxValue),
            })}
          </span>
        </div>

        <div ref={chartRef} className="relative w-full" style={{ height }}>
          {width > 0 && (
            <svg
              width={width}
              height={height}
              className="absolute inset-0"
              style={{ overflow: 'visible' }}
            >
              <defs>
                <linearGradient id="chartArea" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#c96442" stopOpacity={0.22} />
                  <stop offset="100%" stopColor="#c96442" stopOpacity={0.03} />
                </linearGradient>
              </defs>

              {/* Grid lines — warm border cream */}
              {[0, 0.25, 0.5, 0.75, 1].map((ratio) => (
                <line
                  key={`grid-${ratio}`}
                  x1={padding.left}
                  y1={padding.top + plotHeight * ratio}
                  x2={padding.left + plotWidth}
                  y2={padding.top + plotHeight * ratio}
                  stroke="var(--sand)"
                  strokeDasharray={ratio === 1 ? undefined : '3,3'}
                  strokeWidth={ratio === 1 ? 1 : 1}
                />
              ))}

              {/* Y-axis labels */}
              {[1, 0.75, 0.5, 0.25, 0].map((ratio) => {
                const value = maxValue * ratio;
                const y = padding.top + plotHeight * (1 - ratio);
                const display =
                  selectedMetric === 'tokens' ? formatNumber(value) : formatCurrency(value);
                return (
                  <text
                    key={`ylab-${ratio}`}
                    x={padding.left - 8}
                    y={y + 3}
                    textAnchor="end"
                    fontSize="10"
                    fill="var(--claude-stone)"
                    fontFamily="inherit"
                  >
                    {display}
                  </text>
                );
              })}

              {chartType === 'area' && areaPath && (
                <path
                  d={areaPath}
                  fill="url(#chartArea)"
                  stroke="var(--terracotta)"
                  strokeWidth="1.75"
                />
              )}
              {chartType === 'line' && linePath && (
                <path
                  d={linePath}
                  fill="none"
                  stroke="var(--terracotta)"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
              {chartType === 'bar' &&
                chartData.map((d, i) => {
                  const barWidth = (plotWidth / Math.max(chartData.length, 1)) * 0.6;
                  const x =
                    padding.left +
                    (i * plotWidth) / Math.max(chartData.length, 1) +
                    (plotWidth / Math.max(chartData.length, 1) - barWidth) / 2;
                  const value = selectedMetric === 'tokens' ? d.totalTokens : d.totalCost;
                  const barHeight = (value / maxValue) * plotHeight;
                  const y = padding.top + plotHeight - barHeight;
                  return (
                    <rect
                      key={`bar-${d.fullDate}-${d.dayIndex}`}
                      x={x}
                      y={y}
                      width={barWidth}
                      height={barHeight}
                      fill="var(--terracotta)"
                      rx="2"
                    />
                  );
                })}

              {/* Data points on area/line charts */}
              {chartType !== 'bar' &&
                points.map((p, i) => (
                  <circle
                    key={`pt-${chartData[i]?.fullDate}-${i}`}
                    cx={p.x}
                    cy={p.y}
                    r="3"
                    fill="var(--ivory)"
                    stroke="var(--terracotta)"
                    strokeWidth="1.75"
                  />
                ))}

              {/* X-axis labels — every Nth to avoid overlap */}
              {chartData.map((d, i) => {
                if (chartData.length > 10 && i % Math.ceil(chartData.length / 8) !== 0) return null;
                const x =
                  chartType === 'bar'
                    ? padding.left +
                      (i * plotWidth) / Math.max(chartData.length, 1) +
                      plotWidth / Math.max(chartData.length, 1) / 2
                    : padding.left + (i / Math.max(chartData.length - 1, 1)) * plotWidth;
                return (
                  <text
                    key={`xlab-${d.fullDate}-${i}`}
                    x={x}
                    y={height - 8}
                    textAnchor="middle"
                    fontSize="10"
                    fill="var(--claude-stone)"
                    fontFamily="inherit"
                  >
                    {d.shortDate}
                  </text>
                );
              })}
            </svg>
          )}

          {chartData.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center" style={{ color: 'var(--claude-stone)' }}>
                <BarChart3 className="w-10 h-10 mx-auto mb-3 opacity-40" strokeWidth={1.25} />
                <p className="text-[13px]">{t('analytics.noData')}</p>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

// ---------------- small metric card ----------------

const MetricCard: React.FC<{
  icon: React.ReactNode;
  value: string;
  label: string;
  detail?: string;
  badge?: { text: string; tone: 'normal' | 'warning' | 'critical' };
  progress?: { pct: number; tone: 'normal' | 'warning' | 'critical' };
}> = ({ icon, value, label, detail, badge, progress }) => {
  const tone = badge?.tone ?? progress?.tone ?? 'normal';
  const toneColor =
    tone === 'critical'
      ? 'var(--error-crimson)'
      : tone === 'warning'
        ? 'var(--terracotta)'
        : 'var(--claude-olive)';

  return (
    <div
      className="p-4 rounded-xl"
      style={{
        background: 'var(--parchment)',
        border: '1px solid var(--cream)',
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background: 'var(--sand)', color: 'var(--terracotta)' }}
          >
            {icon}
          </div>
          <div>
            <div
              className="font-serif leading-none"
              style={{
                color: 'var(--claude-black)',
                fontSize: '20px',
                fontWeight: 500,
                letterSpacing: '-0.01em',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {value}
            </div>
            <div
              className="text-[11px] mt-1"
              style={{ color: 'var(--claude-olive)', letterSpacing: '0.02em' }}
            >
              {label}
            </div>
          </div>
        </div>

        {badge && (
          <span
            className="px-2 py-0.5 rounded-full text-[10px]"
            style={{
              color: toneColor,
              background: 'var(--ivory)',
              border: `1px solid ${toneColor}`,
              letterSpacing: '0.03em',
            }}
          >
            {badge.text}
          </span>
        )}
      </div>

      {detail && (
        <div className="text-[11px]" style={{ color: 'var(--claude-stone)' }}>
          {detail}
        </div>
      )}

      {progress && (
        <div className="w-full h-1.5 rounded-full mt-2" style={{ background: 'var(--sand)' }}>
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{
              width: `${Math.min(progress.pct, 100)}%`,
              background: toneColor,
            }}
          />
        </div>
      )}
    </div>
  );
};

// ---------------- main ----------------

export const Analytics: React.FC<AnalyticsProps> = ({ stats }) => {
  const { t } = useTranslation();
  const [timeRange, setTimeRange] = useState<ChartTimeRange>('7d');
  const [chartType, setChartType] = useState<ChartType>('area');
  const [selectedMetric, setSelectedMetric] = useState<'tokens' | 'cost'>('tokens');
  const { dim, ref } = useChartDimensions();

  const chartData = useChartData(stats, timeRange);
  const modelBreakdown = useModelBreakdown(stats);

  const totalWeekTokens = stats.thisWeek.reduce((sum, d) => sum + d.totalTokens, 0);
  const totalWeekCost = stats.thisWeek.reduce((sum, d) => sum + d.totalCost, 0);
  const avgDailyTokens = totalWeekTokens / 7;
  const avgDailyCost = totalWeekCost / 7;

  const burnTone: 'normal' | 'warning' | 'critical' =
    stats.burnRate > 1000 ? 'critical' : stats.burnRate > 500 ? 'warning' : 'normal';

  const usageTone: 'normal' | 'warning' | 'critical' =
    stats.percentageUsed >= 90 ? 'critical' : stats.percentageUsed >= 70 ? 'warning' : 'normal';

  return (
    <div className="space-y-4">
      {/* Header */}
      <Card className="bg-[var(--ivory)] border-[var(--cream)]">
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2
                className="font-serif mb-1"
                style={{
                  color: 'var(--claude-black)',
                  fontSize: '24px',
                  lineHeight: 1.2,
                  fontWeight: 500,
                  letterSpacing: '-0.01em',
                }}
              >
                {t('analytics.title')}
              </h2>
              <p className="text-[13px]" style={{ color: 'var(--claude-olive)' }}>
                {t('analytics.subtitle')}
              </p>
            </div>

            <span
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px]"
              style={{
                color: 'var(--claude-olive)',
                background: 'var(--sand)',
                letterSpacing: '0.02em',
              }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: 'var(--terracotta)' }}
              />
              {t('analytics.live')}
            </span>
          </div>

          <div className="flex flex-wrap gap-2 mb-5">
            <Segmented
              value={timeRange}
              onChange={setTimeRange}
              options={[
                { value: '7d', label: t('analytics.range7d'), icon: CalendarDays },
                { value: '30d', label: t('analytics.range30d'), icon: CalendarDays },
              ]}
            />
            <Segmented
              value={chartType}
              onChange={setChartType}
              options={[
                { value: 'area', label: t('analytics.chartArea'), icon: Activity },
                { value: 'line', label: t('analytics.chartLine'), icon: LineChart },
                { value: 'bar', label: t('analytics.chartBar'), icon: BarChart3 },
              ]}
            />
            <Segmented
              value={selectedMetric}
              onChange={setSelectedMetric}
              options={[
                { value: 'tokens', label: t('analytics.metricTokens'), icon: Sparkles },
                { value: 'cost', label: t('analytics.metricCost'), icon: Coins },
              ]}
            />
          </div>

          <div className="grid grid-cols-4 gap-3">
            <SummaryTile
              label={t('analytics.totalTokens7d')}
              value={formatNumber(totalWeekTokens)}
            />
            <SummaryTile label={t('analytics.totalCost7d')} value={formatCurrency(totalWeekCost)} />
            <SummaryTile
              label={t('analytics.avgDailyTokens')}
              value={formatNumber(Math.round(avgDailyTokens))}
            />
            <SummaryTile label={t('analytics.avgDailyCost')} value={formatCurrency(avgDailyCost)} />
          </div>
        </CardContent>
      </Card>

      <MainChart
        chartData={chartData}
        chartType={chartType}
        selectedMetric={selectedMetric}
        timeRange={timeRange}
        dim={dim}
        chartRef={ref}
      />

      {/* Model Distribution */}
      <Card className="bg-[var(--ivory)] border-[var(--cream)]">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle
                className="font-serif"
                style={{
                  color: 'var(--claude-black)',
                  fontSize: '18px',
                  fontWeight: 500,
                  letterSpacing: '-0.005em',
                }}
              >
                {t('analytics.modelDistribution')}
              </CardTitle>
              <CardDescription style={{ color: 'var(--claude-olive)' }}>
                {t('analytics.modelDistributionSubtitle')}
              </CardDescription>
            </div>
            <span
              className="px-2.5 py-1 rounded-md text-[11px]"
              style={{
                color: 'var(--claude-olive)',
                background: 'var(--sand)',
                letterSpacing: '0.02em',
              }}
            >
              {t('analytics.modelsCount', { count: modelBreakdown.length })}
            </span>
          </div>
        </CardHeader>
        <CardContent>
          {modelBreakdown.length > 0 ? (
            <div className="flex items-center gap-6">
              {/* Donut */}
              <div className="relative w-36 h-36 flex-shrink-0">
                <svg width="144" height="144" className="transform -rotate-90">
                  <circle
                    cx="72"
                    cy="72"
                    r="56"
                    fill="none"
                    stroke="var(--sand)"
                    strokeWidth="12"
                  />
                  {(() => {
                    const circumference = 2 * Math.PI * 56;
                    let offset = 0;
                    return modelBreakdown.map((m) => {
                      const dash = (m.percentage / 100) * circumference;
                      const circle = (
                        <circle
                          key={m.name}
                          cx="72"
                          cy="72"
                          r="56"
                          fill="none"
                          stroke={m.color}
                          strokeWidth="12"
                          strokeDasharray={`${dash} ${circumference - dash}`}
                          strokeDashoffset={-offset}
                          strokeLinecap="butt"
                          className="transition-all duration-500"
                        />
                      );
                      offset += dash;
                      return circle;
                    });
                  })()}
                </svg>

                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="text-center">
                    <div
                      className="font-serif leading-none"
                      style={{
                        color: 'var(--claude-black)',
                        fontSize: '20px',
                        fontWeight: 500,
                        letterSpacing: '-0.01em',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {formatNumber(stats.today.totalTokens)}
                    </div>
                    <div
                      className="text-[10px] mt-1 uppercase"
                      style={{ color: 'var(--claude-stone)', letterSpacing: '0.08em' }}
                    >
                      {t('analytics.tokensLabel')}
                    </div>
                  </div>
                </div>
              </div>

              {/* Legend */}
              <div className="flex-1 space-y-2">
                {modelBreakdown.map((m) => (
                  <div
                    key={m.name}
                    className="flex items-center justify-between px-3 py-2.5 rounded-lg"
                    style={{
                      background: 'var(--parchment)',
                      border: '1px solid var(--cream)',
                    }}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                        style={{ background: m.color }}
                      />
                      <div className="min-w-0">
                        <div
                          className="text-[13px] truncate"
                          style={{ color: 'var(--claude-black)', fontWeight: 500 }}
                        >
                          {m.name}
                        </div>
                        <div className="text-[11px]" style={{ color: 'var(--claude-stone)' }}>
                          {m.percentage.toFixed(1)}%
                        </div>
                      </div>
                    </div>
                    <div className="text-right ml-3">
                      <div
                        className="text-[13px]"
                        style={{
                          color: 'var(--claude-black)',
                          fontWeight: 500,
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {formatNumber(m.value)}
                      </div>
                      <div className="text-[11px]" style={{ color: 'var(--claude-stone)' }}>
                        {formatCurrency(m.cost)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-center py-12" style={{ color: 'var(--claude-stone)' }}>
              <BarChart3 className="w-10 h-10 mx-auto mb-3 opacity-40" strokeWidth={1.25} />
              <p className="text-[13px]">{t('analytics.noData')}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Performance */}
      <Card className="bg-[var(--ivory)] border-[var(--cream)]">
        <CardHeader>
          <CardTitle
            className="font-serif"
            style={{
              color: 'var(--claude-black)',
              fontSize: '18px',
              fontWeight: 500,
              letterSpacing: '-0.005em',
            }}
          >
            {t('analytics.performance')}
          </CardTitle>
          <CardDescription style={{ color: 'var(--claude-olive)' }}>
            {t('analytics.performanceSubtitle')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3">
            <MetricCard
              icon={<Flame className="w-4 h-4" strokeWidth={1.75} />}
              value={formatNumber(stats.burnRate)}
              label={t('analytics.burnRateLabel')}
              detail={t('analytics.burnRateDetail', {
                pct: Math.min((stats.burnRate / 2000) * 100, 100).toFixed(0),
              })}
              badge={{
                text:
                  burnTone === 'critical'
                    ? t('analytics.toneHigh')
                    : burnTone === 'warning'
                      ? t('analytics.toneModerate')
                      : t('analytics.toneNormal'),
                tone: burnTone,
              }}
              progress={{ pct: Math.min((stats.burnRate / 2000) * 100, 100), tone: burnTone }}
            />
            <MetricCard
              icon={<Gauge className="w-4 h-4" strokeWidth={1.75} />}
              value={`${stats.percentageUsed.toFixed(1)}%`}
              label={t('analytics.planUtilization')}
              detail={t('analytics.planUtilizationDetail')}
              progress={{ pct: stats.percentageUsed, tone: usageTone }}
            />
            <MetricCard
              icon={<Clock className="w-4 h-4" strokeWidth={1.75} />}
              value={getDepletionText(stats, t)}
              label={t('analytics.depletion')}
              detail={t('analytics.depletionDetail')}
            />
            <MetricCard
              icon={<Coins className="w-4 h-4" strokeWidth={1.75} />}
              value={
                stats.today.totalTokens > 0 && stats.today.totalCost > 0
                  ? formatCurrency((stats.today.totalCost / stats.today.totalTokens) * 1000)
                  : '$0.000'
              }
              label={t('analytics.avgCost')}
              detail={t('analytics.avgCostDetail')}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
