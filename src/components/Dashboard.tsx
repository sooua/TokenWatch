import { CalendarDays, CalendarRange, Flame, Gauge, Info, Layers } from 'lucide-react';
import type React from 'react';
import { useTranslation } from 'react-i18next';
import type { UsageStats } from '../types/usage';
import { CodexCard } from './CodexCard';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Progress } from './ui/progress';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';

// Small Claude-style stat card wrapper used across the dashboard grid.
// Uses lucide icons on a warm sand disc — no gradients, no glow.
const StatCard: React.FC<{
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}> = ({ icon, title, subtitle, children }) => (
  <Card className="bg-[var(--ivory)] border-[var(--cream)]">
    <CardContent className="p-4">
      <div className="flex items-center gap-3 mb-3">
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
          style={{ background: 'var(--sand)', color: 'var(--terracotta)' }}
        >
          {icon}
        </div>
        <div className="min-w-0">
          <h3
            className="font-serif leading-tight truncate"
            style={{
              color: 'var(--claude-black)',
              fontSize: '18px',
              fontWeight: 500,
              letterSpacing: '-0.005em',
            }}
          >
            {title}
          </h3>
          <p className="text-[11px]" style={{ color: 'var(--claude-stone)' }}>
            {subtitle}
          </p>
        </div>
      </div>
      <div>{children}</div>
    </CardContent>
  </Card>
);

const StatRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex justify-between items-baseline">
    <span className="text-[12px]" style={{ color: 'var(--claude-olive)' }}>
      {label}
    </span>
    <span
      className="text-[13px]"
      style={{ color: 'var(--claude-black)', fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}
    >
      {value}
    </span>
  </div>
);

// Helper component for model usage item
const ModelUsageItem = ({
  modelName,
  modelData,
  totalTokens,
  index,
}: {
  modelName: string;
  modelData: { tokens: number; cost: number };
  totalTokens: number;
  index: number;
}) => {
  const percentage = totalTokens > 0 ? (modelData.tokens / totalTokens) * 100 : 0;
  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toLocaleString();
  };

  // Warm palette dots to match the Claude design — terracotta primary,
  // olive for secondary, sand-with-outline for tertiary.
  const getModelDotStyle = (index: number): React.CSSProperties => {
    if (index === 0) return { background: 'var(--terracotta)' };
    if (index === 1) return { background: 'var(--claude-olive)' };
    return { background: 'var(--sand)', boxShadow: '0 0 0 1px var(--ring-warm)' };
  };

  return (
    <div className="flex items-center gap-3">
      <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={getModelDotStyle(index)} />
      <div className="flex-1">
        <div className="flex justify-between items-center mb-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className="text-sm font-medium cursor-help"
                style={{ color: 'var(--claude-black)' }}
              >
                {modelName}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              <div className="text-center">
                <p className="font-semibold">{modelName}</p>
                <p className="text-sm mt-1">
                  {formatNumber(modelData.tokens)} tokens • {formatCurrency(modelData.cost)}
                </p>
                <p className="text-xs mt-1 text-muted-foreground">
                  {percentage.toFixed(1)}% of today's usage
                </p>
              </div>
            </TooltipContent>
          </Tooltip>
          <span className="text-sm" style={{ color: 'var(--claude-olive)' }}>
            {formatNumber(modelData.tokens)} ({percentage.toFixed(1)}%)
          </span>
        </div>
        <Progress value={percentage} className="w-full h-1.5" />
      </div>
    </div>
  );
};

// Helper for formatting numbers and currency
const formatNumber = (num: number) => {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toLocaleString();
};

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
};

// Helper for getting status-related values
const getStatusHelpers = (status: 'safe' | 'warning' | 'critical') => {
  const getStatusColor = () => {
    switch (status) {
      case 'critical':
        return 'from-red-600 to-red-700';
      case 'warning':
        return 'from-orange-500 to-orange-600';
      default:
        return 'from-green-600 to-emerald-600';
    }
  };

  const getStatusIcon = () => {
    switch (status) {
      case 'critical':
        return '🔴';
      case 'warning':
        return '🟡';
      default:
        return '🟢';
    }
  };

  return { getStatusColor, getStatusIcon };
};

// Component for key metrics row
const KeyMetricsRow: React.FC<{
  stats: UsageStats;
}> = ({ stats }) => {
  const { t } = useTranslation();
  const timeRemaining =
    stats.actualResetInfo?.formattedTimeRemaining || t('dashboard.noActiveSession');

  const metrics = [
    {
      value: formatNumber(stats.tokensUsed),
      label: t('dashboard.tokensUsed'),
      detail: t('dashboard.tokensUsedOf', { limit: formatNumber(stats.tokenLimit) }),
    },
    {
      value: formatCurrency(stats.today.totalCost),
      label: t('dashboard.costToday'),
      detail: t('dashboard.costTodayTokens', { count: stats.today.totalTokens.toLocaleString() }),
    },
    {
      value: formatNumber(stats.tokensRemaining),
      label: t('dashboard.remaining'),
      detail: timeRemaining,
    },
  ];

  return (
    <div className="grid grid-cols-3 gap-3">
      {metrics.map((m, i) => (
        <div
          key={m.label}
          className="text-left px-3 py-3 rounded-lg"
          style={{
            background: 'var(--parchment)',
            border: '1px solid var(--cream)',
            borderLeft: i === 0 ? '2px solid var(--terracotta)' : '1px solid var(--cream)',
          }}
        >
          <div
            className="font-serif leading-none mb-1"
            style={{
              color: 'var(--claude-black)',
              fontSize: '22px',
              fontWeight: 500,
              letterSpacing: '-0.01em',
            }}
          >
            {m.value}
          </div>
          <div
            className="text-[11px] mb-0.5"
            style={{ color: 'var(--claude-olive)', letterSpacing: '0.02em' }}
          >
            {m.label}
          </div>
          <div className="text-[10px]" style={{ color: 'var(--claude-stone)' }}>
            {m.detail}
          </div>
        </div>
      ))}
    </div>
  );
};

// Component for circular progress charts
const CircularProgressChart: React.FC<{
  percentage: number;
  status?: 'safe' | 'warning' | 'critical';
  label: string;
  subtitle: string;
  emoji: string;
  isTime?: boolean;
  /** Override the ring color (used for the reset-time variant so it always
   *  reads as neutral/warm regardless of token status). */
  ringColorOverride?: string;
}> = ({ percentage, status, label, subtitle, ringColorOverride }) => {
  // subtitle is already prepared by caller (localized "safe"/"warning"/"critical")
  const ringColor =
    ringColorOverride ??
    (status === 'critical'
      ? '#b53333' // error crimson
      : status === 'warning'
        ? '#c96442' // terracotta
        : '#7a9b5f'); // muted green for safe

  return (
    <div className="flex items-center justify-center">
      <div className="relative">
        <svg width="168" height="168" className="transform -rotate-90">
          <circle cx="84" cy="84" r="72" fill="none" stroke="var(--sand)" strokeWidth="6" />
          <circle
            cx="84"
            cy="84"
            r="72"
            fill="none"
            stroke={ringColor}
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={`${2 * Math.PI * 72}`}
            strokeDashoffset={`${2 * Math.PI * 72 * (1 - percentage / 100)}`}
            className="transition-all duration-1000 ease-out"
          />
        </svg>

        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center">
            <div
              className="font-serif leading-none mb-1.5"
              style={{
                color: 'var(--claude-black)',
                fontSize: '42px',
                fontWeight: 500,
                letterSpacing: '-0.02em',
              }}
            >
              {Math.round(percentage)}
              <span style={{ fontSize: '24px', color: 'var(--claude-olive)' }}>%</span>
            </div>
            <div
              className="text-[11px] uppercase mb-0.5"
              style={{ color: 'var(--claude-stone)', letterSpacing: '0.08em' }}
            >
              {label}
            </div>
            <div className="text-[11px]" style={{ color: 'var(--claude-olive)' }}>
              {subtitle}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

interface DashboardProps {
  stats: UsageStats;
  status: 'safe' | 'warning' | 'critical';
  // Whether to render the secondary Codex CLI card below the Claude stats.
  // Off by default; user opts in from Settings.
  showCodex?: boolean;
}

export const Dashboard: React.FC<DashboardProps> = ({ stats, status, showCodex }) => {
  const { t } = useTranslation();
  const { getStatusColor, getStatusIcon } = getStatusHelpers(status);
  const statusWord =
    status === 'critical'
      ? t('dashboard.critical')
      : status === 'warning'
        ? t('dashboard.warning')
        : t('dashboard.safe');

  return (
    <TooltipProvider>
      <div className="space-y-4">
        {/* Hero Section */}
        <Card className="bg-[var(--ivory)] border-[var(--cream)]">
          <CardContent className="p-6">
            <div className="mb-6">
              <h2
                className="font-serif mb-1.5"
                style={{
                  color: 'var(--claude-black)',
                  fontSize: '24px',
                  lineHeight: 1.2,
                  letterSpacing: '-0.01em',
                  fontWeight: 500,
                }}
              >
                {t('dashboard.heroTitle')}
              </h2>
              <p className="text-[13px]" style={{ color: 'var(--claude-olive)' }}>
                {t('dashboard.heroSubtitle')}
              </p>
            </div>

            {/* Dual ring display — token usage on the left, 5-hour session
                reset countdown on the right. Centered as a pair so the hero
                reads as a balanced composition regardless of window width. */}
            <div className="flex items-center justify-center gap-10 mb-8 flex-wrap">
              <Tooltip>
                <TooltipTrigger asChild>
                  <div>
                    <CircularProgressChart
                      percentage={stats.percentageUsed}
                      status={status}
                      label={t('dashboard.ringLabel')}
                      subtitle={statusWord}
                      emoji={getStatusIcon()}
                    />
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <div className="text-center">
                    <p className="font-semibold">
                      {status === 'critical'
                        ? t('dashboard.tooltipCriticalTitle')
                        : status === 'warning'
                          ? t('dashboard.tooltipWarningTitle')
                          : t('dashboard.tooltipSafeTitle')}
                    </p>
                    <p className="text-sm mt-1">
                      {status === 'critical'
                        ? t('dashboard.tooltipCriticalBody')
                        : status === 'warning'
                          ? t('dashboard.tooltipWarningBody')
                          : t('dashboard.tooltipSafeBody')}
                    </p>
                  </div>
                </TooltipContent>
              </Tooltip>

              {(() => {
                // Compute progress through the active 5-hour session window.
                // The subtitle uses a compact `Xh Ym` format so it fits
                // inside the ring — the service's own `formattedTimeRemaining`
                // is a long sentence ("3 hours 20 minutes left") that would
                // overflow the center stack.
                const sessionMs = 5 * 60 * 60 * 1000;
                const timeLeftMs = stats.actualResetInfo?.timeUntilReset ?? 0;
                const elapsedMs = Math.max(0, Math.min(sessionMs, sessionMs - timeLeftMs));
                const resetPct = stats.actualResetInfo?.nextResetTime
                  ? (elapsedMs / sessionMs) * 100
                  : 0;
                const compactTime = (() => {
                  if (!stats.actualResetInfo?.nextResetTime) return null;
                  const ms = Math.max(0, timeLeftMs);
                  const h = Math.floor(ms / (1000 * 60 * 60));
                  const m = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
                  if (h > 0) return `${h}h ${m}m`;
                  if (m > 0) return `${m}m`;
                  return '<1m';
                })();
                const resetSubtitle = compactTime
                  ? t('dashboard.resetRingSubtitle', { value: compactTime })
                  : t('dashboard.resetRingNone');
                return (
                  <CircularProgressChart
                    percentage={resetPct}
                    label={t('dashboard.resetRingLabel')}
                    subtitle={resetSubtitle}
                    emoji=""
                    ringColorOverride="#c96442"
                  />
                );
              })()}
            </div>

            <KeyMetricsRow stats={stats} />
          </CardContent>
        </Card>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 gap-3">
          <StatCard
            icon={<Layers className="w-4 h-4" strokeWidth={1.75} />}
            title={stats.currentPlan}
            subtitle={t('dashboard.plan')}
          >
            <div className="space-y-2">
              <StatRow label={t('dashboard.dailyLimit')} value={formatNumber(stats.tokenLimit)} />
              <Progress value={Math.min(stats.percentageUsed, 100)} className="w-full h-[6px]" />
            </div>
          </StatCard>

          {(() => {
            // burnRate is tokens/hour. tokenLimit is the 5h-window budget, so
            // tokenLimit/5 is the even pace that exactly lasts the window;
            // "high" = burning faster than that (would deplete before reset),
            // "moderate" = above half that pace. The previous 1000/500
            // thresholds dated from when burnRate was tokens/min.
            const burnHigh = Math.max(stats.tokenLimit / 5, 1);
            const burnMid = burnHigh / 2;
            return (
              <StatCard
                icon={<Flame className="w-4 h-4" strokeWidth={1.75} />}
                title={formatNumber(stats.burnRate)}
                subtitle={t('dashboard.burnRate')}
              >
                <div className="space-y-2">
                  <StatRow
                    label={t('dashboard.depletion')}
                    value={
                      stats.actualResetInfo?.formattedTimeRemaining ||
                      t('dashboard.noActiveSession')
                    }
                  />
                  <div
                    className="text-[11px] text-center py-1 rounded-md"
                    style={{
                      color:
                        stats.burnRate > burnHigh
                          ? 'var(--error-crimson)'
                          : stats.burnRate > burnMid
                            ? 'var(--terracotta)'
                            : 'var(--claude-olive)',
                      background: 'var(--parchment)',
                      border: '1px solid var(--cream)',
                      letterSpacing: '0.02em',
                    }}
                  >
                    {stats.burnRate > burnHigh
                      ? t('dashboard.usageHigh')
                      : stats.burnRate > burnMid
                        ? t('dashboard.usageModerate')
                        : t('dashboard.usageNormal')}
                  </div>
                </div>
              </StatCard>
            );
          })()}

          <StatCard
            icon={<CalendarDays className="w-4 h-4" strokeWidth={1.75} />}
            title={t('dashboard.today')}
            subtitle={t('dashboard.todaySubtitle')}
          >
            <div className="space-y-1.5">
              <StatRow
                label={t('dashboard.tokens')}
                value={stats.today.totalTokens.toLocaleString()}
              />
              <StatRow label={t('dashboard.cost')} value={formatCurrency(stats.today.totalCost)} />
              <StatRow
                label={t('dashboard.models')}
                value={String(Object.keys(stats.today.models).length)}
              />
            </div>
          </StatCard>

          <StatCard
            icon={<CalendarRange className="w-4 h-4" strokeWidth={1.75} />}
            title={t('dashboard.thisWeek')}
            subtitle={t('dashboard.thisWeekSubtitle')}
          >
            <div className="space-y-1.5">
              <StatRow
                label={t('dashboard.totalCost')}
                value={formatCurrency(stats.thisWeek.reduce((s, d) => s + d.totalCost, 0))}
              />
              <StatRow
                label={t('dashboard.totalTokens')}
                value={stats.thisWeek.reduce((s, d) => s + d.totalTokens, 0).toLocaleString()}
              />
              <StatRow
                label={t('dashboard.avgDaily')}
                value={formatCurrency(
                  stats.thisWeek.reduce((s, d) => s + d.totalCost, 0) /
                    Math.max(1, stats.thisWeek.length)
                )}
              />
            </div>
          </StatCard>
        </div>

        {/* Codex CLI — opt-in from Settings. The card itself also self-hides
            if ~/.codex/sessions is missing, so toggling on without Codex
            installed is a no-op instead of a broken card. */}
        {showCodex && <CodexCard />}

        {/* Model Breakdown */}
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
                  {t('dashboard.modelUsage')}
                </CardTitle>
                <CardDescription style={{ color: 'var(--claude-olive)' }}>
                  {t('dashboard.modelUsageDesc')}
                </CardDescription>
              </div>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0"
                    style={{ color: 'var(--claude-olive)' }}
                  >
                    <Info className="w-4 h-4" strokeWidth={1.75} />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  className="w-80 border"
                  style={{
                    background: 'var(--ivory)',
                    borderColor: 'var(--cream)',
                    color: 'var(--claude-black)',
                  }}
                >
                  <div className="space-y-3">
                    <div className="font-semibold">{t('dashboard.modelBreakdownTitle')}</div>
                    <div className="text-sm space-y-2" style={{ color: 'var(--claude-olive)' }}>
                      <p>• {t('dashboard.modelBreakdownTokens')}</p>
                      <p>• {t('dashboard.modelBreakdownCost')}</p>
                      <p>• {t('dashboard.modelBreakdownPercentage')}</p>
                      <p>• {t('dashboard.modelBreakdownColors')}</p>
                    </div>
                    <div
                      className="text-xs pt-2 border-t"
                      style={{
                        color: 'var(--claude-stone)',
                        borderColor: 'var(--cream)',
                      }}
                    >
                      {t('dashboard.modelBreakdownHint')}
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {stats.today.models && Object.keys(stats.today.models).length > 0 ? (
                Object.entries(stats.today.models).map(([modelName, modelData], index) => (
                  <ModelUsageItem
                    key={modelName}
                    modelName={modelName}
                    modelData={modelData}
                    totalTokens={stats.today.totalTokens}
                    index={index}
                  />
                ))
              ) : (
                <div className="text-center py-8" style={{ color: 'var(--claude-stone)' }}>
                  <svg
                    className="w-12 h-12 mx-auto mb-3 opacity-50"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    />
                  </svg>
                  <p className="text-sm">{t('dashboard.modelUsageNoData')}</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Quick Actions */}
        {/* <div className="glass-card p-4">
        <h3
          className="text-lg font-bold mb-4"
          style={{ color: 'var(--claude-black)' }}
        >
          Quick Actions
        </h3>
        
        <div className="grid grid-cols-2 gap-3">
          <button className="btn btn-ghost flex items-center justify-center gap-2 py-3">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            View Analytics
          </button>
          
          <button className="btn btn-ghost flex items-center justify-center gap-2 py-3">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Export Data
          </button>
        </div>
      </div> */}
      </div>
    </TooltipProvider>
  );
};
