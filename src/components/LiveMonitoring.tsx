import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { UsageStats } from '../types/usage';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';

// Helper functions
const getUsageStatus = (percentage: number): 'safe' | 'warning' | 'critical' => {
  if (percentage >= 90) return 'critical';
  if (percentage >= 70) return 'warning';
  return 'safe';
};

const getStatusColor = (status: string) => {
  switch (status) {
    case 'critical':
      return 'from-red-500 to-red-600';
    case 'warning':
      return 'from-yellow-500 to-orange-500';
    default:
      return 'from-green-500 to-emerald-500';
  }
};

const getStatusEmoji = (status: string) => {
  switch (status) {
    case 'critical':
      return '🔴';
    case 'warning':
      return '🟡';
    default:
      return '🟢';
  }
};

const formatTimeRemaining = (milliseconds: number): string => {
  const hours = Math.floor(milliseconds / (1000 * 60 * 60));
  const minutes = Math.floor((milliseconds % (1000 * 60 * 60)) / (1000 * 60));

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
};

const formatNumber = (num: number) => {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toLocaleString();
};

// Component to render log entries
const LogEntryComponent: React.FC<{ log: LogEntry }> = ({ log }) => (
  <div
    className={`flex items-start gap-2 ${
      log.type === 'error'
        ? 'text-red-400'
        : log.type === 'warning'
          ? 'text-yellow-400'
          : log.type === 'success'
            ? 'text-green-400'
            : 'text-neutral-300'
    }`}
  >
    <span className="text-neutral-500 text-xs w-16 flex-shrink-0">
      {log.timestamp.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })}
    </span>
    <span className="text-sm">{log.emoji}</span>
    <span className="flex-1">{log.message}</span>
  </div>
);

// Component for status overview cards
const StatusCard: React.FC<{
  title: string;
  emoji: string;
  value: string;
  progress: number;
  colorClass: string;
  subtitle: string;
}> = ({ title, emoji, value, progress, colorClass, subtitle }) => (
  <Card className="bg-[var(--sand)]/50 border-[var(--cream)]">
    <CardContent className="p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm" style={{ color: 'var(--claude-olive)' }}>
          {title}
        </span>
        <span className="text-lg">{emoji}</span>
      </div>
      <div className="text-2xl font-bold mb-2" style={{ color: 'var(--claude-black)' }}>
        {value}
      </div>
      <div className="w-full rounded-full h-3 mb-2" style={{ background: 'var(--cream)' }}>
        <div
          className={`h-3 rounded-full bg-gradient-to-r ${colorClass} transition-all duration-1000`}
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="text-xs" style={{ color: 'var(--claude-stone)' }}>
        {subtitle}
      </div>
    </CardContent>
  </Card>
);

interface LiveMonitoringProps {
  stats: UsageStats;
  onRefresh: () => void;
  preferences?: {
    plan?: 'auto' | 'Pro' | 'Max5' | 'Max20' | 'Custom';
  };
}

interface LogEntry {
  id: string;
  timestamp: Date;
  type: 'info' | 'warning' | 'error' | 'success';
  message: string;
  emoji: string;
}

export const LiveMonitoring: React.FC<LiveMonitoringProps> = ({
  stats,
  onRefresh,
  preferences,
}) => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isLiveMode, setIsLiveMode] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const logContainerRef = useRef<HTMLDivElement>(null);
  const intervalRef = useRef<NodeJS.Timeout | undefined>(undefined);

  const addLogEntry = useCallback((type: LogEntry['type'], message: string, emoji: string) => {
    const newEntry: LogEntry = {
      id: Date.now().toString() + Math.random().toString(36).substring(2, 11),
      timestamp: new Date(),
      type,
      message,
      emoji,
    };

    setLogs((prev) => {
      const updated = [newEntry, ...prev];
      return updated.slice(0, 50);
    });
  }, []);

  // Auto-scroll to bottom when new logs are added
  useEffect(() => {
    if (logContainerRef.current && isLiveMode) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [isLiveMode]);

  // Refresh interval. The main process polls every 30s and the service
  // caches for 20s, so a sub-30s interval here just re-renders the cached
  // value while the "Data refreshed" log lies. Match the upstream cadence.
  useEffect(() => {
    if (!isLiveMode) return;

    intervalRef.current = setInterval(() => {
      onRefresh();
      setLastUpdate(new Date());
    }, 30000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isLiveMode, onRefresh]);

  // Log a "data refreshed" line only when token usage actually moves —
  // de-duplicates the previous spam where the 3s interval logged on every
  // tick whether or not anything changed.
  const lastTokensUsedRef = useRef<number | null>(null);
  useEffect(() => {
    if (lastTokensUsedRef.current === null) {
      lastTokensUsedRef.current = stats.tokensUsed;
      return;
    }
    if (stats.tokensUsed !== lastTokensUsedRef.current) {
      addLogEntry('info', 'Usage updated', '🔄');
      lastTokensUsedRef.current = stats.tokensUsed;
    }
  }, [stats.tokensUsed, addLogEntry]);

  // Status logs — only emit when the bucket changes (normal/high/critical),
  // so a 89.9 → 90.1 → 89.8 flicker doesn't spam the feed every poll.
  const lastStatusBucketRef = useRef<'normal' | 'high' | 'critical' | null>(null);
  useEffect(() => {
    const bucket: 'normal' | 'high' | 'critical' =
      stats.percentageUsed >= 95 ? 'critical' : stats.percentageUsed >= 80 ? 'high' : 'normal';
    if (bucket === lastStatusBucketRef.current) return;
    lastStatusBucketRef.current = bucket;
    if (bucket === 'critical') {
      addLogEntry('error', `Critical: ${stats.percentageUsed.toFixed(1)}% usage detected`, '🚨');
    } else if (bucket === 'high') {
      addLogEntry('warning', `High usage: ${stats.percentageUsed.toFixed(1)}%`, '⚠️');
    }
  }, [stats.percentageUsed, addLogEntry]);

  // Reset-imminent log — only fire once per hour-bucket so it doesn't
  // re-log every 30s during the final hour.
  const lastResetLogBucketRef = useRef<number | null>(null);
  useEffect(() => {
    const timeUntilReset = stats.resetInfo?.timeUntilReset;
    if (!timeUntilReset || timeUntilReset >= 3600000) {
      lastResetLogBucketRef.current = null;
      return;
    }
    const bucket = Math.floor(timeUntilReset / (5 * 60 * 1000)); // 5-min buckets
    if (bucket === lastResetLogBucketRef.current) return;
    lastResetLogBucketRef.current = bucket;
    addLogEntry('info', `Reset in ${formatTimeRemaining(timeUntilReset)}`, '⏰');
  }, [stats.resetInfo?.timeUntilReset, addLogEntry]);

  const currentStatus = getUsageStatus(stats.percentageUsed);
  const tokensPercentage = Math.min(stats.percentageUsed, 100);

  // % elapsed of the current Claude session window. cycleDurationMs is the
  // 5h reset cadence supplied by ResetTimeService — previously hardcoded
  // here as 24h, which produced a near-zero progress bar.
  const getTimeProgress = (): number => {
    if (!stats.resetInfo || !stats.resetInfo.cycleDurationMs) return 0;
    return Math.max(0, Math.min(100, stats.resetInfo.percentUntilReset));
  };

  const timeProgress = getTimeProgress();

  return (
    <div className="space-y-4">
      {/* Header with Controls */}
      <Card className="bg-[var(--ivory)] border-[var(--cream)]">
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2
                className="text-xl font-bold mb-1 font-serif"
                style={{ color: 'var(--claude-black)' }}
              >
                Live Monitoring
              </h2>
              <p className="text-sm" style={{ color: 'var(--claude-olive)' }}>
                Real-time terminal-style usage tracking
              </p>
            </div>

            <div className="flex items-center gap-3">
              <div className="glass px-3 py-1 rounded-lg">
                <div className="flex items-center gap-2">
                  <div
                    className={`w-2 h-2 rounded-full ${isLiveMode ? 'bg-green-500 animate-pulse' : 'bg-gray-500'}`}
                  />
                  <span className="text-xs" style={{ color: 'var(--claude-olive)' }}>
                    {isLiveMode ? 'LIVE' : 'PAUSED'}
                  </span>
                </div>
              </div>

              <Button
                onClick={() => setIsLiveMode(!isLiveMode)}
                variant={isLiveMode ? 'secondary' : 'default'}
                size="sm"
                className="text-sm px-3 py-1 transition-all duration-200"
                style={
                  isLiveMode
                    ? { background: 'var(--sand)', color: 'var(--claude-black)' }
                    : { background: 'var(--terracotta)', color: 'var(--ivory)' }
                }
              >
                {isLiveMode ? 'Pause' : 'Resume'}
              </Button>
            </div>
          </div>

          {/* Status Overview */}
          <div className="grid grid-cols-2 gap-4">
            <StatusCard
              title="Token Usage"
              emoji={getStatusEmoji(currentStatus)}
              value={`${tokensPercentage.toFixed(1)}%`}
              progress={tokensPercentage}
              colorClass={getStatusColor(currentStatus)}
              subtitle={`${formatNumber(stats.tokensUsed)} / ${formatNumber(stats.tokenLimit)}`}
            />

            <StatusCard
              title="Time Progress"
              emoji="⏰"
              value={`${timeProgress.toFixed(1)}%`}
              progress={timeProgress}
              colorClass="from-blue-500 to-purple-500"
              subtitle={`${stats.resetInfo ? formatTimeRemaining(stats.resetInfo.timeUntilReset) : 'No reset info'} until reset`}
            />
          </div>
        </CardContent>
      </Card>

      {/* Terminal-style Output */}
      <Card className="bg-[var(--ivory)] border-[var(--cream)]">
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <h3 className="text-lg font-bold" style={{ color: 'var(--claude-black)' }}>
                Live Feed
              </h3>
              <div className="flex gap-1">
                <div className="w-3 h-3 bg-red-500 rounded-full" />
                <div className="w-3 h-3 bg-yellow-500 rounded-full" />
                <div className="w-3 h-3 bg-green-500 rounded-full" />
              </div>
            </div>

            <div className="text-xs" style={{ color: 'var(--claude-stone)' }}>
              Last update: {lastUpdate.toLocaleTimeString()}
            </div>
          </div>

          {/* Terminal Window */}
          <div
            className="rounded-lg border p-4 font-mono text-sm"
            style={{ background: 'var(--claude-black)', borderColor: 'var(--ring-deep)' }}
          >
            <div
              className="flex items-center gap-2 mb-3 pb-2 border-b"
              style={{ borderColor: 'var(--ring-deep)' }}
            >
              <span className="text-green-400">●</span>
              <span style={{ color: 'var(--ivory)' }}>ccmonitor@live</span>
              <span className="text-neutral-400">~</span>
            </div>

            <div
              ref={logContainerRef}
              className="h-60 overflow-y-auto space-y-1 scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent"
            >
              {logs.length === 0 ? (
                <div className="text-neutral-400">
                  <span className="text-green-400">$</span> Waiting for events...
                </div>
              ) : (
                logs.map((log) => <LogEntryComponent key={log.id} log={log} />)
              )}
            </div>

            {/* Command Line */}
            <div className="mt-3 pt-2 border-t border-white/10">
              <div className="flex items-center gap-2 text-neutral-400">
                <span className="text-green-400">$</span>
                <span className="animate-pulse">█</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Current Session Info */}
      <Card className="bg-[var(--ivory)] border-[var(--cream)]">
        <CardHeader>
          <CardTitle style={{ color: 'var(--claude-black)' }}>Current Session</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold mb-1" style={{ color: 'var(--claude-black)' }}>
                {formatNumber(stats.burnRate)}
              </div>
              <div className="text-sm" style={{ color: 'var(--claude-olive)' }}>
                Tokens/Hour
              </div>
              <div className="text-xs mt-1" style={{ color: 'var(--claude-stone)' }}>
                🔥{' '}
                {(() => {
                  // Plan-relative burn rate label. Was hardcoded 1000/500
                  // when burnRate was tokens/min; now it's tokens/hour.
                  const burnHigh = Math.max(stats.tokenLimit / 5, 1);
                  if (stats.burnRate > burnHigh) return 'High';
                  if (stats.burnRate > burnHigh / 2) return 'Moderate';
                  return 'Normal';
                })()}
              </div>
            </div>

            <div className="text-center">
              <div className="text-2xl font-bold mb-1" style={{ color: 'var(--claude-black)' }}>
                {stats.currentPlan}
              </div>
              <div className="text-sm" style={{ color: 'var(--claude-olive)' }}>
                Current Plan
              </div>
              <div className="text-xs mt-1" style={{ color: 'var(--claude-stone)' }}>
                {!preferences?.plan || preferences.plan === 'auto'
                  ? '📊 Auto-detected'
                  : '📌 Manual'}
              </div>
            </div>

            <div className="text-center">
              <div className="text-2xl font-bold mb-1" style={{ color: 'var(--claude-black)' }}>
                {stats.velocity?.trend === 'increasing'
                  ? '📈'
                  : stats.velocity?.trend === 'decreasing'
                    ? '📉'
                    : '➡️'}
              </div>
              <div className="text-sm" style={{ color: 'var(--claude-olive)' }}>
                Trend
              </div>
              <div className="text-xs mt-1" style={{ color: 'var(--claude-stone)' }}>
                {stats.velocity?.trend || 'stable'}
              </div>
            </div>

            <div className="text-center">
              <div className="text-2xl font-bold mb-1" style={{ color: 'var(--claude-black)' }}>
                {stats.prediction?.confidence || 0}%
              </div>
              <div className="text-sm" style={{ color: 'var(--claude-olive)' }}>
                Confidence
              </div>
              <div className="text-xs mt-1" style={{ color: 'var(--claude-stone)' }}>
                🎯 Prediction
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Quick Actions */}
      <Card className="bg-[var(--ivory)] border-[var(--cream)]">
        <CardContent className="p-4">
          <div className="grid grid-cols-3 gap-3">
            <Button
              onClick={onRefresh}
              variant="ghost"
              className="flex items-center justify-center gap-2 py-3 h-auto transition-all duration-200 hover:bg-[var(--sand)]"
            >
              <span>🔄</span>
              Force Refresh
            </Button>

            <Button
              onClick={() => addLogEntry('info', 'Manual checkpoint created', '📍')}
              variant="ghost"
              className="flex items-center justify-center gap-2 py-3 h-auto transition-all duration-200 hover:bg-[var(--sand)]"
            >
              <span>📍</span>
              Checkpoint
            </Button>

            <Button
              onClick={() => setLogs([])}
              variant="ghost"
              className="flex items-center justify-center gap-2 py-3 h-auto transition-all duration-200 hover:bg-[var(--sand)]"
            >
              <span>🗑️</span>
              Clear Logs
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
