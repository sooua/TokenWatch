import { ArrowDown, ArrowRight, ArrowUp, RefreshCw } from 'lucide-react';
import type React from 'react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { UsageStats } from '../types/usage';

interface TerminalViewProps {
  stats: UsageStats;
  onRefresh: () => void;
  preferences: {
    timezone?: string;
    resetHour?: number;
    plan?: 'auto' | 'Pro' | 'Max5' | 'Max20' | 'Custom';
    customTokenLimit?: number;
  };
}

// Claude "dark section" terminal — near-black surface, warm silver text,
// terracotta prompts and accents. Monospace throughout (that's the whole point),
// but the chrome is restrained and editorial rather than retro-hacker green.

const formatNumber = (num: number) => {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toLocaleString();
};

const generateBar = (percentage: number, width = 22): string => {
  const filled = Math.round((percentage / 100) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
};

export const TerminalView: React.FC<TerminalViewProps> = ({ stats, onRefresh, preferences }) => {
  const { t } = useTranslation();
  const [animatedPercentage, setAnimatedPercentage] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setAnimatedPercentage(stats.percentageUsed), 100);
    return () => clearTimeout(timer);
  }, [stats]);

  const formatPlan = (): string => {
    const selected = preferences.plan || 'auto';
    if (selected === 'auto') return `auto (${stats.currentPlan})`;
    if (selected === 'Custom') {
      const limit = preferences.customTokenLimit || stats.tokenLimit;
      return `Custom (${formatNumber(limit)})`;
    }
    const limits = { Pro: '7K', Max5: '35K', Max20: '140K' } as const;
    return `${selected} (${limits[selected as keyof typeof limits]})`;
  };

  const statusTone =
    stats.percentageUsed >= 90
      ? { color: '#d97757', label: t('terminal.criticalLabel') }
      : stats.percentageUsed >= 70
        ? { color: '#c96442', label: t('terminal.warningLabel') }
        : { color: '#7a9b5f', label: t('terminal.normalLabel') };

  const velocityGlyph =
    stats.velocity?.trend === 'increasing' ? (
      <ArrowUp className="inline w-3 h-3 -mt-0.5" strokeWidth={2} />
    ) : stats.velocity?.trend === 'decreasing' ? (
      <ArrowDown className="inline w-3 h-3 -mt-0.5" strokeWidth={2} />
    ) : (
      <ArrowRight className="inline w-3 h-3 -mt-0.5" strokeWidth={2} />
    );

  const velocityColor =
    stats.velocity && stats.velocity.trendPercent > 0
      ? '#d97757'
      : stats.velocity && stats.velocity.trendPercent < 0
        ? '#7a9b5f'
        : '#b0aea5';

  return (
    <div
      className="font-mono rounded-xl p-5 space-y-4"
      style={{
        background: '#141413',
        border: '1px solid #30302e',
        color: '#b0aea5',
        fontSize: '13px',
        lineHeight: 1.55,
        boxShadow: 'var(--shadow-whisper-md)',
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between pb-3"
        style={{ borderBottom: '1px solid #30302e' }}
      >
        <div className="flex items-center gap-2">
          {/* traffic-light-ish but warm */}
          <span
            className="w-2.5 h-2.5 rounded-full"
            style={{ background: '#c96442', boxShadow: '0 0 0 1px #b0533a' }}
          />
          <span
            className="w-2.5 h-2.5 rounded-full"
            style={{ background: '#87867f', boxShadow: '0 0 0 1px #5e5d59' }}
          />
          <span
            className="w-2.5 h-2.5 rounded-full"
            style={{ background: '#30302e', boxShadow: '0 0 0 1px #5e5d59' }}
          />
          <span className="ml-2 text-[12px]" style={{ color: '#faf9f5' }}>
            claude-code-monitor
          </span>
        </div>
        <div className="text-[11px]" style={{ color: '#87867f', letterSpacing: '0.02em' }}>
          {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </div>
      </div>

      {/* Token usage row */}
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <span style={{ color: '#87867f' }}>token_usage</span>
          <span style={{ color: '#faf9f5' }}>
            <span className="font-serif" style={{ fontSize: '18px', fontWeight: 500 }}>
              {animatedPercentage.toFixed(1)}
            </span>
            <span style={{ color: '#b0aea5' }}>%</span>
          </span>
        </div>
        <div className="flex items-center gap-3 text-[12px]">
          <span style={{ color: '#5e5d59' }}>[</span>
          <span style={{ color: statusTone.color, letterSpacing: '-0.02em' }}>
            {generateBar(animatedPercentage)}
          </span>
          <span style={{ color: '#5e5d59' }}>]</span>
          <span style={{ color: '#87867f', fontVariantNumeric: 'tabular-nums' }}>
            {formatNumber(stats.tokensUsed)} / {formatNumber(stats.tokenLimit)}
          </span>
        </div>
      </div>

      {/* Stats grid */}
      <div
        className="grid grid-cols-2 gap-x-6 gap-y-3 pt-3"
        style={{ borderTop: '1px solid #30302e' }}
      >
        <Row label="burn_rate" value={`${formatNumber(stats.burnRate)} tok/hr`} />
        <Row label="plan" value={formatPlan()} />
        <Row label="cost_today" value={`$${stats.today.totalCost.toFixed(3)}`} />
        <Row label="remaining" value={`${formatNumber(stats.tokensRemaining)} tok`} />
      </div>

      {/* Session tracking */}
      {stats.sessionTracking && (
        <div className="pt-3" style={{ borderTop: '1px solid #30302e' }}>
          <div className="text-[11px] mb-2" style={{ color: '#87867f', letterSpacing: '0.08em' }}>
            SESSION WINDOW · 5H
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-[12px]">
            <Row
              label="active_sessions"
              value={`${stats.sessionTracking.sessionsInWindow} sessions`}
            />
            <Row
              label="window_tokens"
              value={formatNumber(stats.sessionTracking.activeWindow.totalTokens)}
            />
          </div>
        </div>
      )}

      {/* Velocity */}
      {stats.velocity && (
        <div className="pt-3" style={{ borderTop: '1px solid #30302e' }}>
          <div className="text-[11px] mb-2" style={{ color: '#87867f', letterSpacing: '0.08em' }}>
            VELOCITY
          </div>
          <div className="flex items-center gap-6 text-[12px]">
            <div>
              <span style={{ color: '#87867f' }}>trend </span>
              <span style={{ color: velocityColor }} className="inline-flex items-center gap-1">
                {velocityGlyph} {stats.velocity.trend}
              </span>
            </div>
            <div>
              <span style={{ color: '#87867f' }}>change </span>
              <span style={{ color: velocityColor, fontVariantNumeric: 'tabular-nums' }}>
                {stats.velocity.trendPercent > 0 ? '+' : ''}
                {stats.velocity.trendPercent}%
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Prompt */}
      <div className="pt-4" style={{ borderTop: '1px solid #30302e' }}>
        <div className="flex items-center gap-2 text-[12px]">
          <span style={{ color: '#c96442' }}>user@tokenwatch</span>
          <span style={{ color: '#87867f' }}>:</span>
          <span style={{ color: '#b0aea5' }}>~</span>
          <span style={{ color: '#87867f' }}>$</span>
          <button
            type="button"
            onClick={onRefresh}
            className="inline-flex items-center gap-1.5 transition-colors"
            style={{ color: '#d97757' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = '#faf9f5';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = '#d97757';
            }}
          >
            <RefreshCw className="w-3 h-3" strokeWidth={1.75} />
            refresh
          </button>
          <span style={{ color: '#c96442' }} className="ml-1 animate-pulse">
            █
          </span>
        </div>
      </div>

      {/* Footer status bar */}
      <div
        className="flex justify-between text-[11px] pt-2"
        style={{
          borderTop: '1px solid #30302e',
          color: '#87867f',
          letterSpacing: '0.02em',
        }}
      >
        <span>
          system{' '}
          <span style={{ color: statusTone.color, fontWeight: 500 }}>{statusTone.label}</span>
        </span>
        <span>session up {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
      </div>
    </div>
  );
};

// Editorial key/value row inside the terminal. The label is olive-silver with
// a trailing dot leader so eye can trace across easily.
const Row: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex items-baseline gap-2 text-[12px]">
    <span style={{ color: '#87867f' }}>{label}</span>
    <span className="flex-1" style={{ color: '#30302e', letterSpacing: '2px', minWidth: 12 }}>
      {'·'.repeat(30)}
    </span>
    <span
      style={{
        color: '#faf9f5',
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {value}
    </span>
  </div>
);
