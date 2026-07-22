import { Box, Clock, Cpu } from 'lucide-react';
import type React from 'react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';

interface CodexWindow {
  used_percent?: number;
  window_minutes?: number;
  resets_at?: number;
}

interface CodexStats {
  installed: boolean;
  tokens: {
    input_tokens?: number;
    cached_input_tokens?: number;
    output_tokens?: number;
    reasoning_output_tokens?: number;
    total_tokens?: number;
  } | null;
  lastTokens: {
    total_tokens?: number;
  } | null;
  rateLimits: {
    primary?: CodexWindow;
    secondary?: CodexWindow;
    plan_type?: string | null;
  } | null;
  modelContextWindow: number | null;
  lastEventAt: string | null;
  sessionsSeen: number;
  latestFile: string | null;
}

const formatNumber = (n: number | undefined | null): string => {
  if (!n || !Number.isFinite(n)) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
};

/**
 * Three distinct states, not one string: an elapsed window is not "about to
 * reset". Clamping the remaining time to 0 and calling that "<1m" left the card
 * claiming a reset was seconds away for days on end, so the caller relabels the
 * whole row rather than just swapping the value.
 */
type ResetState = { kind: 'unknown' | 'expired' } | { kind: 'left'; text: string };

const resetState = (resetsAt: number | undefined): ResetState => {
  if (!resetsAt) return { kind: 'unknown' };
  const msLeft = resetsAt * 1000 - Date.now();
  if (msLeft <= 0) return { kind: 'expired' };
  const h = Math.floor(msLeft / (1000 * 60 * 60));
  const m = Math.floor((msLeft % (1000 * 60 * 60)) / (1000 * 60));
  const d = Math.floor(h / 24);
  if (d > 0) return { kind: 'left', text: `${d}d ${h % 24}h` };
  if (h > 0) return { kind: 'left', text: `${h}h ${m}m` };
  return { kind: 'left', text: `${m}m` };
};

const tone = (pct: number | undefined): string => {
  const p = pct ?? 0;
  if (p >= 90) return '#b53333';
  if (p >= 70) return '#c96442';
  return '#7a9b5f';
};

// Shows a compact reset-percent bar for one Codex rate-limit window.
const WindowBar: React.FC<{
  label: string;
  win: CodexWindow | undefined;
}> = ({ label, win }) => {
  const pct = win?.used_percent ?? 0;
  const color = tone(pct);
  const reset = resetState(win?.resets_at);
  const { t } = useTranslation();

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <div>
          <div
            className="text-[11px] uppercase"
            style={{ color: 'var(--claude-stone)', letterSpacing: '0.08em' }}
          >
            {label}
          </div>
          <div
            className="font-serif leading-none mt-1"
            style={{
              color: 'var(--claude-black)',
              fontSize: '22px',
              fontWeight: 500,
              letterSpacing: '-0.01em',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {pct.toFixed(1)}
            <span style={{ color: 'var(--claude-olive)', fontSize: '14px', marginLeft: 2 }}>%</span>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[11px]" style={{ color: 'var(--claude-stone)' }}>
            {reset.kind === 'expired' ? t('codex.windowStatus') : t('codex.resetIn')}
          </div>
          <div
            className="text-[12px] mt-0.5 font-mono"
            style={{ color: 'var(--claude-olive)', fontVariantNumeric: 'tabular-nums' }}
          >
            {reset.kind === 'left' && reset.text}
            {reset.kind === 'expired' && t('codex.windowExpired')}
            {reset.kind === 'unknown' && '—'}
          </div>
        </div>
      </div>
      <div className="h-[6px] rounded-full overflow-hidden" style={{ background: 'var(--sand)' }}>
        <div
          className="h-full transition-all duration-700"
          style={{
            width: `${Math.min(pct, 100)}%`,
            background: color,
          }}
        />
      </div>
    </div>
  );
};

export const CodexCard: React.FC = () => {
  const { t } = useTranslation();
  const [stats, setStats] = useState<CodexStats | null>(null);

  useEffect(() => {
    let active = true;
    const fetchStats = async () => {
      try {
        const s = await window.electronAPI?.getCodexStats?.();
        if (active) setStats((s as CodexStats | null) ?? null);
      } catch (err) {
        console.error('CodexCard fetch failed:', err);
      }
    };
    fetchStats();
    // Piggy-back on the main usage update pulse so we refresh alongside
    // Claude stats (every 30s) without adding a second poller.
    const listener = () => fetchStats();
    window.electronAPI?.onUsageUpdated?.(listener);
    return () => {
      active = false;
      window.electronAPI?.removeUsageUpdatedListener?.(listener);
    };
  }, []);

  // Render nothing at all if Codex CLI isn't installed — keeps the dashboard
  // clean for users who only run Claude.
  if (!stats || !stats.installed) return null;

  const totalTokens = stats.tokens?.total_tokens ?? 0;
  const contextWindow = stats.modelContextWindow ?? 0;
  // Context occupancy is the *current turn's* tokens, not the whole-session
  // cumulative. Falling back to the cumulative total meant a routinely
  // window-exceeding number got clamped into a plausible-looking "100%" —
  // an invented figure presented as a measurement. When the CLI doesn't
  // report last-turn usage the honest answer is to omit the percentage.
  const contextTokens = stats.lastTokens?.total_tokens;
  const contextPct =
    contextTokens != null && contextWindow > 0
      ? Math.min(100, (contextTokens / contextWindow) * 100)
      : null;

  return (
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
              {t('codex.title')}
            </CardTitle>
            <CardDescription style={{ color: 'var(--claude-olive)' }}>
              {t('codex.subtitle')}
            </CardDescription>
          </div>
          <span
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px]"
            style={{
              color: 'var(--claude-olive)',
              background: 'var(--sand)',
              letterSpacing: '0.02em',
            }}
          >
            <Cpu className="w-3 h-3" strokeWidth={1.75} />
            {stats.rateLimits?.plan_type || 'codex'}
          </span>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-5">
          <WindowBar label={t('codex.primary5h')} win={stats.rateLimits?.primary} />
          <WindowBar label={t('codex.secondary7d')} win={stats.rateLimits?.secondary} />
        </div>

        <div
          className="mt-5 pt-4 grid grid-cols-3 gap-3"
          style={{ borderTop: '1px solid var(--cream)' }}
        >
          <div>
            <div className="text-[11px]" style={{ color: 'var(--claude-stone)' }}>
              {t('codex.lastSessionTokens')}
            </div>
            <div
              className="font-serif mt-1"
              style={{
                color: 'var(--claude-black)',
                fontSize: '16px',
                fontWeight: 500,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {formatNumber(totalTokens)}
            </div>
          </div>
          <div>
            <div className="text-[11px]" style={{ color: 'var(--claude-stone)' }}>
              {t('codex.contextWindow')}
            </div>
            <div
              className="font-serif mt-1 flex items-baseline gap-1"
              style={{
                color: 'var(--claude-black)',
                fontSize: '16px',
                fontWeight: 500,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {formatNumber(contextWindow)}
              {contextPct != null && (
                <span style={{ color: 'var(--claude-olive)', fontSize: '11px' }}>
                  ({contextPct.toFixed(0)}%)
                </span>
              )}
            </div>
          </div>
          <div>
            <div className="text-[11px]" style={{ color: 'var(--claude-stone)' }}>
              {t('codex.sessions')}
            </div>
            <div
              className="font-serif mt-1 flex items-center gap-1.5"
              style={{
                color: 'var(--claude-black)',
                fontSize: '16px',
                fontWeight: 500,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              <Box
                className="w-3.5 h-3.5"
                strokeWidth={1.75}
                style={{ color: 'var(--claude-olive)' }}
              />
              {stats.sessionsSeen}
            </div>
          </div>
        </div>

        {stats.lastEventAt && (
          <div
            className="flex items-center gap-1.5 mt-3 text-[11px]"
            style={{ color: 'var(--claude-stone)' }}
          >
            <Clock className="w-3 h-3" strokeWidth={1.75} />
            {t('codex.lastEvent', {
              value: new Date(stats.lastEventAt).toLocaleString([], {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              }),
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
