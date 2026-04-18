import { X } from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import type { UsageStats } from '../types/usage';

type ContentMode = 'percentage' | 'percentageCost' | 'percentageCostBurn';

interface HudData {
  percentageUsed: number;
  cost: number;
  burnRate: number;
  status: 'safe' | 'warning' | 'critical';
}

// Ring color by threshold — same palette as Dashboard's circular progress.
const toneColor = (s: HudData['status']) =>
  s === 'critical' ? '#b53333' : s === 'warning' ? '#c96442' : '#7a9b5f';

const formatNumber = (n: number): string => {
  if (!Number.isFinite(n)) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return Math.round(n).toString();
};

const statsToHud = (stats: UsageStats): HudData => {
  const p = stats.percentageUsed ?? 0;
  return {
    percentageUsed: p,
    cost: stats.today?.totalCost ?? 0,
    burnRate: stats.burnRate ?? 0,
    status: p >= 90 ? 'critical' : p >= 70 ? 'warning' : 'safe',
  };
};

export const MiniHud: React.FC = () => {
  const [data, setData] = useState<HudData | null>(null);
  const [content, setContent] = useState<ContentMode>('percentageCost');
  const [hover, setHover] = useState(false);

  // The BrowserWindow is created with transparent: true. The HTML document it
  // loads is shared with the main app window (same index.html), whose body
  // has a parchment background. Strip that here so the HUD's rounded corners
  // actually read as floating rather than sitting on a solid rectangle.
  useEffect(() => {
    const prevBody = document.body.style.background;
    const prevHtml = document.documentElement.style.background;
    document.body.style.background = 'transparent';
    document.documentElement.style.background = 'transparent';
    // Also remove the `.app-background` pseudo-element by flagging the root.
    document.body.classList.add('mini-hud-mode');
    return () => {
      document.body.style.background = prevBody;
      document.documentElement.style.background = prevHtml;
      document.body.classList.remove('mini-hud-mode');
    };
  }, []);

  const fetchStats = useCallback(async () => {
    try {
      // Prefer cache for instant paint; fall back to a real fetch if no cache.
      const cached = await window.electronAPI?.getCachedUsageStats?.();
      if (cached) setData(statsToHud(cached));
      const fresh = await window.electronAPI?.getUsageStats?.();
      if (fresh) setData(statsToHud(fresh));
    } catch (err) {
      console.error('MiniHud fetch failed:', err);
    }
  }, []);

  useEffect(() => {
    fetchStats();

    window.electronAPI?.miniHudGetContent?.().then((c) => {
      if (c === 'percentage' || c === 'percentageCost' || c === 'percentageCostBurn') {
        setContent(c);
      }
    });

    const contentListener = window.electronAPI?.onMiniHudContentChanged?.((c) => {
      if (c === 'percentage' || c === 'percentageCost' || c === 'percentageCostBurn') {
        setContent(c as ContentMode);
      }
    });

    const updateListener = () => fetchStats();
    window.electronAPI?.onUsageUpdated?.(updateListener);

    return () => {
      if (contentListener) {
        window.electronAPI?.removeMiniHudContentChangedListener?.(contentListener);
      }
      window.electronAPI?.removeUsageUpdatedListener?.(updateListener);
    };
  }, [fetchStats]);

  const ring = toneColor(data?.status ?? 'safe');
  const pct = data ? Math.round(data.percentageUsed) : 0;
  const cost = data?.cost ?? 0;
  const burn = data?.burnRate ?? 0;

  return (
    <div
      // Fills the whole frameless window. Drag region lets users pull it
      // around; interactive controls explicitly opt out below.
      className="w-screen h-screen flex items-center px-3 gap-3"
      style={
        {
          background: 'var(--ivory)',
          border: '1px solid var(--cream)',
          borderRadius: 12,
          boxShadow: 'var(--shadow-whisper-md)',
          color: 'var(--claude-black)',
          WebkitAppRegion: 'drag',
          cursor: 'grab',
          overflow: 'hidden',
        } as React.CSSProperties
      }
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {/* Percentage ring + number */}
      <button
        type="button"
        onClick={() => window.electronAPI?.miniHudOpenMain?.()}
        title="Open TokenWatch"
        className="flex items-center gap-2 flex-shrink-0"
        style={
          {
            WebkitAppRegion: 'no-drag',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
          } as React.CSSProperties
        }
      >
        <div className="relative" style={{ width: 36, height: 36 }}>
          <svg width="36" height="36" className="transform -rotate-90">
            <circle cx="18" cy="18" r="14" fill="none" stroke="var(--sand)" strokeWidth="3" />
            <circle
              cx="18"
              cy="18"
              r="14"
              fill="none"
              stroke={ring}
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray={`${2 * Math.PI * 14}`}
              strokeDashoffset={`${2 * Math.PI * 14 * (1 - pct / 100)}`}
              style={{ transition: 'stroke-dashoffset 0.6s ease' }}
            />
          </svg>
          <div
            className="absolute inset-0 flex items-center justify-center font-serif"
            style={{
              fontSize: 12,
              fontWeight: 500,
              letterSpacing: '-0.02em',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {pct}
          </div>
        </div>
      </button>

      {/* Numeric readouts */}
      <div className="flex-1 min-w-0 flex flex-col justify-center" style={{ lineHeight: 1.15 }}>
        <div className="flex items-baseline gap-1.5">
          <span
            className="font-serif"
            style={{
              color: 'var(--claude-black)',
              fontSize: 15,
              fontWeight: 500,
              fontVariantNumeric: 'tabular-nums',
              letterSpacing: '-0.01em',
            }}
          >
            {pct}
            <span style={{ color: 'var(--claude-olive)', fontSize: 11, marginLeft: 1 }}>%</span>
          </span>
          {content !== 'percentage' && (
            <span
              className="font-serif"
              style={{
                color: 'var(--claude-charcoal)',
                fontSize: 13,
                fontWeight: 500,
                fontVariantNumeric: 'tabular-nums',
                letterSpacing: '-0.005em',
              }}
            >
              ${cost.toFixed(2)}
            </span>
          )}
        </div>
        {content === 'percentageCostBurn' && (
          <div
            className="text-[10px] mt-0.5 truncate"
            style={{ color: 'var(--claude-stone)', letterSpacing: '0.02em' }}
          >
            {formatNumber(burn)} tok/hr
          </div>
        )}
        {content === 'percentageCost' && (
          <div
            className="text-[10px] mt-0.5 truncate"
            style={{ color: 'var(--claude-stone)', letterSpacing: '0.02em' }}
          >
            today
          </div>
        )}
      </div>

      {/* Close button — only visible on hover to keep the HUD minimal */}
      {hover && (
        <button
          type="button"
          aria-label="Close mini HUD"
          title="Close mini HUD"
          onClick={() => window.electronAPI?.miniHudClose?.()}
          style={
            {
              WebkitAppRegion: 'no-drag',
              width: 20,
              height: 20,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 4,
              color: 'var(--claude-olive)',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
            } as React.CSSProperties
          }
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--cream)';
            e.currentTarget.style.color = 'var(--claude-black)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = 'var(--claude-olive)';
          }}
        >
          <X className="w-3 h-3" strokeWidth={2} />
        </button>
      )}
    </div>
  );
};
