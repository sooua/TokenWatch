import { Camera, Maximize2, Minimize2, Minus, RefreshCw, X } from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Analytics } from './components/Analytics';
import { Dashboard } from './components/Dashboard';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LoadingScreen } from './components/LoadingScreen';
import { NavigationTabs } from './components/NavigationTabs';
import { SettingsPanel } from './components/SettingsPanel';
import { TerminalView } from './components/TerminalView';
import { UpdateBanner } from './components/UpdateBanner';
import { Button } from './components/ui/button';
import { Toaster } from './components/ui/sonner';
import i18n, { resolveLanguage, type SupportedLanguage } from './i18n';
import type { UsageStats } from './types/usage';

type ViewType = 'dashboard' | 'live' | 'analytics' | 'terminal' | 'settings';

interface IconButtonProps {
  onClick: () => void;
  title: string;
  ariaLabel: string;
  danger?: boolean;
  children: React.ReactNode;
}

// Minimal ghost icon button in Claude editorial style. Sits flat on the
// parchment canvas; hover shows a warm cream pad. Never a gradient or glow.
// noDrag=true marks it as click-through-capable inside a draggable title bar.
const IconButton: React.FC<IconButtonProps & { noDrag?: boolean }> = ({
  onClick,
  title,
  ariaLabel,
  danger,
  children,
  noDrag,
}) => (
  <button
    type="button"
    onClick={onClick}
    title={title}
    aria-label={ariaLabel}
    className="inline-flex items-center justify-center w-7 h-7 rounded-md transition-colors"
    style={{
      color: danger ? 'var(--error-crimson)' : 'var(--claude-olive)',
      background: 'transparent',
      ...(noDrag ? ({ WebkitAppRegion: 'no-drag' } as React.CSSProperties) : {}),
    }}
    onMouseEnter={(e) => {
      e.currentTarget.style.background = 'var(--cream)';
      e.currentTarget.style.color = danger ? 'var(--error-crimson)' : 'var(--claude-black)';
    }}
    onMouseLeave={(e) => {
      e.currentTarget.style.background = 'transparent';
      e.currentTarget.style.color = danger ? 'var(--error-crimson)' : 'var(--claude-olive)';
    }}
  >
    {children}
  </button>
);

// Custom window controls (minimize / maximize / close) drawn in renderer
// because the BrowserWindow is frameless. We don't rely on Windows' native
// buttons at all — they don't match the Claude palette and can't be restyled.
const WindowControls: React.FC<{ isMaximized: boolean }> = ({ isMaximized }) => {
  const btnBase: React.CSSProperties = {
    width: 36,
    height: 28,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    color: 'var(--claude-olive)',
    background: 'transparent',
    transition: 'all 0.15s ease',
    WebkitAppRegion: 'no-drag',
  } as React.CSSProperties;

  return (
    <div className="flex items-center gap-0.5 ml-1">
      <button
        type="button"
        aria-label="Minimize"
        title="Minimize"
        style={btnBase}
        onClick={() => window.electronAPI?.windowMinimize?.()}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--cream)';
          e.currentTarget.style.color = 'var(--claude-black)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent';
          e.currentTarget.style.color = 'var(--claude-olive)';
        }}
      >
        <Minus className="w-4 h-4" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        aria-label={isMaximized ? 'Restore' : 'Maximize'}
        title={isMaximized ? 'Restore' : 'Maximize'}
        style={btnBase}
        onClick={() => window.electronAPI?.windowToggleMaximize?.()}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--cream)';
          e.currentTarget.style.color = 'var(--claude-black)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent';
          e.currentTarget.style.color = 'var(--claude-olive)';
        }}
      >
        {isMaximized ? (
          <Minimize2 className="w-3.5 h-3.5" strokeWidth={1.75} />
        ) : (
          <Maximize2 className="w-3.5 h-3.5" strokeWidth={1.75} />
        )}
      </button>
      <button
        type="button"
        aria-label="Close"
        title="Close"
        style={btnBase}
        onClick={() => window.electronAPI?.windowClose?.()}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--terracotta)';
          e.currentTarget.style.color = 'var(--ivory)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent';
          e.currentTarget.style.color = 'var(--claude-olive)';
        }}
      >
        <X className="w-4 h-4" strokeWidth={2} />
      </button>
    </div>
  );
};

interface AppNotification {
  type: 'success' | 'warning' | 'error' | 'info';
  title: string;
  message?: string;
}

interface AppState {
  currentView: ViewType;
  stats: UsageStats | null;
  loading: boolean;
  isStale: boolean;
  loadingMessage: string;
  error: string | null;
  sidebarExpanded: boolean;
  preferences: {
    timezone?: string;
    resetHour?: number;
    plan?: 'auto' | 'Pro' | 'Max5' | 'Max20' | 'Custom';
    customTokenLimit?: number;
    calibratedTokenLimit?: number;
    menuBarDisplayMode?: 'percentage' | 'cost' | 'alternate';
    menuBarCostSource?: 'today' | 'sessionWindow';
    launchOnStartup?: boolean;
    standaloneWindow?: boolean;
    language?: 'auto' | 'en' | 'zh';
    miniHud?: boolean;
    miniHudContent?: 'percentage' | 'percentageCost' | 'percentageCostBurn';
    autoCheckUpdates?: boolean;
    showCodexCard?: boolean;
  };
}

const App: React.FC = () => {
  const { t } = useTranslation();
  const [state, setState] = useState<AppState>({
    currentView: 'dashboard',
    stats: null,
    loading: true,
    isStale: false,
    loadingMessage: 'Initializing usage tracking...',
    error: null,
    sidebarExpanded: false,
    preferences: {
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      resetHour: 0,
      plan: 'auto',
      customTokenLimit: undefined,
    },
  });

  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    if (!window.electronAPI) return;
    window.electronAPI.windowIsMaximized?.().then(setIsMaximized);
    const listener = window.electronAPI.onWindowMaximizeChanged?.((val) => setIsMaximized(val));
    return () => {
      if (listener) window.electronAPI.removeWindowMaximizeChangedListener?.(listener);
    };
  }, []);

  // Load settings from storage
  const loadSettings = useCallback(async () => {
    try {
      if (!window.electronAPI) {
        throw new Error('Electron API not available');
      }

      const settings = await window.electronAPI.loadSettings();
      // Apply language before any UI renders with t() so the first paint is
      // already localized.
      if (settings?.language) {
        const next = resolveLanguage(settings.language as SupportedLanguage);
        if (i18n.language !== next) i18n.changeLanguage(next);
      }
      setState((prev) => ({
        ...prev,
        preferences: {
          ...prev.preferences,
          ...settings,
        },
      }));
    } catch (error) {
      console.error('Error loading settings:', error);
      // Continue with default settings if loading fails
    }
  }, []);

  // Save settings to storage
  const saveSettings = useCallback(
    async (newSettings: Partial<AppState['preferences']>) => {
      try {
        if (!window.electronAPI) {
          throw new Error('Electron API not available');
        }

        await window.electronAPI.saveSettings(newSettings);
      } catch (error) {
        console.error('Error saving settings:', error);
        addNotification({
          type: 'error',
          title: t('toast.settingsSaveFailed'),
          message: t('toast.settingsSaveFailedDesc'),
        });
      }
    },
    [t]
  );

  // Load usage stats with enhanced error handling.
  // `showLoading` controls whether the full LoadingScreen blocks the UI while
  // we wait — callers pass false for silent background refreshes so cached
  // data stays visible.
  const loadUsageStats = useCallback(
    async (showLoading = true) => {
      try {
        if (showLoading) {
          setState((prev) => ({ ...prev, loading: true, error: null }));
        }

        if (!window.electronAPI) {
          throw new Error('Electron API not available');
        }

        const data = await window.electronAPI.getUsageStats();

        setState((prev) => ({
          ...prev,
          stats: data,
          loading: false,
          isStale: false,
          error: null,
        }));

        // Add success notification for manual refresh
        if (!showLoading) {
          addNotification({
            type: 'success',
            title: t('toast.dataRefreshed'),
            message: t('toast.dataRefreshedDesc'),
          });
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to load usage stats';

        setState((prev) => ({
          ...prev,
          error: errorMessage,
          loading: false,
        }));

        addNotification({
          type: 'error',
          title: t('toast.updateFailed'),
          message: errorMessage,
        });
      }
    },
    [t]
  );

  // Force refresh data
  const refreshData = useCallback(async () => {
    try {
      setState((prev) => ({ ...prev, error: null }));

      if (!window.electronAPI) {
        throw new Error('Electron API not available');
      }

      const data = await window.electronAPI.refreshData();

      setState((prev) => ({ ...prev, stats: data }));
      addNotification({
        type: 'success',
        title: t('toast.dataRefreshed'),
        message: t('toast.latestDataLoaded'),
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to refresh data';

      setState((prev) => ({ ...prev, error: errorMessage }));

      addNotification({
        type: 'error',
        title: t('toast.refreshFailed'),
        message: errorMessage,
      });
    }
  }, [t]);

  // Take screenshot
  const takeScreenshot = useCallback(async () => {
    try {
      if (!window.electronAPI) {
        throw new Error('Electron API not available');
      }

      const result = await window.electronAPI.takeScreenshot();

      if (result.success) {
        toast.success(t('toast.screenshotCaptured'), {
          description: result.message,
          duration: 4000,
        });
      } else {
        toast.error(t('toast.screenshotFailed'), {
          description: result.error || 'Unknown error occurred',
          duration: 4000,
        });
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to take screenshot';
      toast.error(t('toast.screenshotFailed'), {
        description: errorMessage,
        duration: 4000,
      });
    }
  }, [t]);

  // Surface a notification via sonner's <Toaster> (mounted below). Earlier this
  // pushed into a state queue that nothing rendered, so the toasts were dropped.
  const addNotification = (notification: AppNotification) => {
    const opts = notification.message ? { description: notification.message } : undefined;
    switch (notification.type) {
      case 'error':
        toast.error(notification.title, opts);
        break;
      case 'success':
        toast.success(notification.title, opts);
        break;
      case 'warning':
        toast.warning(notification.title, opts);
        break;
      default:
        toast(notification.title, opts);
    }
  };

  // Update preferences
  const updatePreferences = useCallback(
    (newPreferences: Partial<AppState['preferences']>) => {
      setState((prev) => ({
        ...prev,
        preferences: { ...prev.preferences, ...newPreferences },
      }));

      // Reflect language changes into i18next immediately so the UI swaps
      // locale without waiting for a reload.
      if (newPreferences.language !== undefined) {
        const next = resolveLanguage(newPreferences.language);
        if (i18n.language !== next) i18n.changeLanguage(next);
      }

      // Save settings immediately when changed
      saveSettings(newPreferences);
    },
    [saveSettings]
  );

  // Handle navigation
  const navigateTo = useCallback((view: ViewType) => {
    setState((prev) => ({ ...prev, currentView: view }));
  }, []);

  // Setup auto-refresh and event listeners
  useEffect(() => {
    // Cold-start flow:
    //   1. Load settings in parallel with reading the persisted stats cache.
    //   2. If we have cached stats, render the full UI immediately (stale=true)
    //      so the user never stares at a loading screen.
    //   3. Fire the real fetch. If no cache existed, we stay on the loading
    //      screen until it resolves; otherwise it's a silent background refresh.
    const hydrate = async () => {
      await loadSettings();

      let hadCache = false;
      try {
        if (window.electronAPI?.getCachedUsageStats) {
          const cached = await window.electronAPI.getCachedUsageStats();
          if (cached) {
            hadCache = true;
            setState((prev) => ({
              ...prev,
              stats: cached,
              loading: false,
              isStale: true,
              error: null,
            }));
          }
        }
      } catch (err) {
        console.error('Failed to read cached stats:', err);
      }

      await loadUsageStats(!hadCache);
    };
    hydrate();

    // Handle usage updates from main process
    const handleUsageUpdate = () => {
      // Silent update — keep showing current data, flip to "stale" briefly.
      setState((prev) => ({ ...prev, isStale: true, error: null }));

      window.electronAPI
        .getUsageStats()
        .then((data) => {
          setState((prev) => ({
            ...prev,
            stats: data,
            loading: false,
            isStale: false,
            error: null,
          }));
        })
        .catch((err) => {
          const errorMessage = err instanceof Error ? err.message : 'Failed to load usage stats';
          setState((prev) => ({
            ...prev,
            error: errorMessage,
            loading: false,
            isStale: false,
          }));
        });
    };

    // Progress messages from the main process first-fetch flow.
    const progressListener = window.electronAPI?.onLoadingProgress?.((payload) => {
      setState((prev) => ({ ...prev, loadingMessage: payload.message }));
    });

    if (window.electronAPI) {
      window.electronAPI.onUsageUpdated(handleUsageUpdate);
    }

    return () => {
      if (window.electronAPI) {
        window.electronAPI.removeUsageUpdatedListener(handleUsageUpdate);
        if (progressListener) {
          window.electronAPI.removeLoadingProgressListener(progressListener);
        }
      }
    };
  }, [loadSettings, loadUsageStats]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyPress = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey) {
        switch (event.key) {
          case 'r':
            event.preventDefault();
            refreshData();
            break;
          case 'q':
            event.preventDefault();
            window.electronAPI?.quitApp();
            break;
          // Number shortcuts map to the visible tabs in order. There is no
          // 'live' view rendered, so Ctrl/Cmd+2 previously navigated to a blank
          // screen — the mapping now matches NavigationTabs exactly.
          case '1':
            event.preventDefault();
            navigateTo('dashboard');
            break;
          case '2':
            event.preventDefault();
            navigateTo('analytics');
            break;
          case '3':
            event.preventDefault();
            navigateTo('terminal');
            break;
          case '4':
            event.preventDefault();
            navigateTo('settings');
            break;
          case ',':
            event.preventDefault();
            navigateTo('settings');
            break;
          case 'S':
            if (event.shiftKey) {
              event.preventDefault();
              takeScreenshot();
            }
            break;
        }
      }
    };

    document.addEventListener('keydown', handleKeyPress);
    return () => document.removeEventListener('keydown', handleKeyPress);
  }, [navigateTo, refreshData, takeScreenshot]);

  // Helper functions
  const getUsageStatus = (percentage: number): 'safe' | 'warning' | 'critical' => {
    if (percentage >= 90) return 'critical';
    if (percentage >= 75) return 'warning';
    return 'safe';
  };

  const formatTimeRemaining = (burnRate: number, tokensRemaining: number): string => {
    if (burnRate <= 0) return 'Unlimited';
    const hoursRemaining = tokensRemaining / burnRate;
    if (hoursRemaining < 1) return `${Math.round(hoursRemaining * 60)}m remaining`;
    if (hoursRemaining < 24) return `${Math.round(hoursRemaining)}h remaining`;
    return `${Math.round(hoursRemaining / 24)}d remaining`;
  };

  // Render loading screen
  if (state.loading && !state.stats) {
    return (
      <div className="app-background">
        <LoadingScreen message={state.loadingMessage} />
      </div>
    );
  }

  // Render error state
  if (state.error && !state.stats) {
    return (
      <div className="app-background">
        <div className="min-h-screen flex items-center justify-center p-6">
          <div className="glass-card p-8 max-w-md w-full text-center">
            <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-gradient-to-r from-red-500 to-red-600 flex items-center justify-center">
              <svg
                className="w-8 h-8 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"
                />
              </svg>
            </div>
            <h2 className="text-xl font-bold mb-4" style={{ color: 'var(--claude-black)' }}>
              {t('app.connectionError')}
            </h2>
            <p className="mb-6" style={{ color: 'var(--claude-olive)' }}>
              {state.error}
            </p>
            <Button
              onClick={() => loadUsageStats()}
              className="w-full transition-all duration-200"
              style={{ background: 'var(--terracotta)', color: 'var(--ivory)' }}
            >
              {t('app.tryAgain')}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const currentStats = state.stats;
  if (!currentStats) {
    return (
      <div className="app-background">
        <LoadingScreen message={state.loadingMessage} />
      </div>
    );
  }

  const usageStatus = getUsageStatus(currentStats.percentageUsed);
  const timeRemaining = formatTimeRemaining(currentStats.burnRate, currentStats.tokensRemaining);

  return (
    <ErrorBoundary>
      <div className="app-background" />

      {state.isStale && (
        <div className="absolute top-0 inset-x-0 z-50 flex justify-center pointer-events-none">
          <div
            className="mt-2 px-3 py-1 rounded-full text-[11px] font-medium flex items-center gap-2"
            style={{
              color: 'var(--claude-olive)',
              background: 'var(--ivory)',
              border: '1px solid var(--cream)',
              boxShadow: 'var(--shadow-whisper)',
            }}
          >
            <span
              className="inline-block w-1.5 h-1.5 rounded-full animate-pulse"
              style={{ background: 'var(--terracotta)' }}
            />
            {state.loadingMessage || t('app.refreshing')}
          </div>
        </div>
      )}

      {/* Column layout: the header is its own row (never scrolls), the main
          area is the only scroll container. This avoids sticky-positioning
          games so the header can never drift on scroll. */}
      <div className="relative flex flex-col h-screen overflow-hidden">
        <UpdateBanner />
        <header
          className="flex-shrink-0 pl-5 pr-3 pt-5 pb-0 z-40"
          // Whole header strip is the drag region. Interactive bits inside
          // (action buttons, window controls, nav tabs) individually opt out
          // via WebkitAppRegion: no-drag so clicks reach them normally.
          style={
            {
              background: 'var(--parchment)',
              WebkitAppRegion: 'drag',
            } as React.CSSProperties
          }
        >
          <div
            // items-start pulls the right-side controls up to the top of
            // the row while the logo + stacked title/tagline fill more
            // vertical space on the left. Drag is inherited from <header>.
            className="flex items-start justify-between mb-3"
          >
            <div className="flex items-center gap-2.5">
              {/* TokenWatch brand mark: V13 Tally Five (four ink verticals + terracotta diagonal). */}
              <svg className="w-10 h-10 flex-shrink-0" viewBox="0 0 128 128" aria-hidden="true">
                <rect x="30" y="18" width="7" height="92" fill="var(--claude-black)" />
                <rect x="49" y="18" width="7" height="92" fill="var(--claude-black)" />
                <rect x="68" y="18" width="7" height="92" fill="var(--claude-black)" />
                <rect x="87" y="18" width="7" height="92" fill="var(--claude-black)" />
                <line
                  x1="22"
                  y1="106"
                  x2="102"
                  y2="22"
                  stroke="var(--terracotta)"
                  strokeWidth="9"
                  strokeLinecap="round"
                />
              </svg>
              {/* Single-line editorial lockup: title · tagline, aligned to the baseline. */}
              <div className="flex items-baseline gap-2">
                <h1
                  className="font-serif leading-none"
                  style={{
                    color: 'var(--claude-black)',
                    fontSize: '20px',
                    letterSpacing: '-0.005em',
                    fontWeight: 500,
                    margin: 0,
                  }}
                >
                  {t('app.title')}
                </h1>
                <span
                  aria-hidden="true"
                  style={{
                    color: 'var(--claude-stone)',
                    fontSize: '13px',
                    lineHeight: 1,
                  }}
                >
                  ·
                </span>
                <p
                  className="text-[12px] leading-none"
                  style={{
                    color: 'var(--claude-olive)',
                    letterSpacing: '0.01em',
                    margin: 0,
                  }}
                >
                  {t('app.tagline')}
                </p>
              </div>
            </div>

            <div
              // -mt-2 pulls the controls up so their top offset matches
              // the right-side padding (pr-3 = 12px), giving the row a
              // balanced gutter around the buttons.
              className="flex items-center gap-1.5 -mt-2"
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            >
              <span
                className="px-2.5 py-1 rounded-md text-[11px] font-medium"
                style={{
                  color: 'var(--claude-olive)',
                  background: 'var(--sand)',
                  letterSpacing: '0.02em',
                }}
              >
                {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>

              <IconButton
                onClick={refreshData}
                title={t('app.refresh')}
                ariaLabel={t('app.refreshAria')}
                noDrag
              >
                <RefreshCw className="w-4 h-4" strokeWidth={1.75} />
              </IconButton>

              <IconButton
                onClick={takeScreenshot}
                title={t('app.screenshot')}
                ariaLabel={t('app.screenshotAria')}
                noDrag
              >
                <Camera className="w-4 h-4" strokeWidth={1.75} />
              </IconButton>

              {state.preferences.standaloneWindow ? (
                <>
                  {/* Small vertical separator between app actions and
                          window controls so the three Windows-style buttons
                          read as a distinct group. */}
                  <span className="mx-1 h-5" style={{ width: 1, background: 'var(--cream)' }} />
                  <WindowControls isMaximized={isMaximized} />
                </>
              ) : (
                <IconButton
                  onClick={() => window.electronAPI?.quitApp()}
                  title={t('app.quit')}
                  ariaLabel={t('app.quitAria')}
                  danger
                  noDrag
                >
                  <X className="w-4 h-4" strokeWidth={2} />
                </IconButton>
              )}
            </div>
          </div>

          {/* Navigation Tabs */}
          <NavigationTabs currentView={state.currentView} onNavigate={navigateTo} />
        </header>

        {/* Scrollable content region */}
        <main className="flex-1 overflow-y-auto px-3 pt-4 pb-3">
          <div className="space-y-3">
            {state.currentView === 'dashboard' && (
              <Dashboard
                stats={currentStats}
                status={usageStatus}
                showCodex={state.preferences.showCodexCard === true}
              />
            )}

            {state.currentView === 'analytics' && (
              <Analytics stats={currentStats} preferences={state.preferences} />
            )}

            {state.currentView === 'terminal' && (
              <TerminalView
                stats={currentStats}
                onRefresh={refreshData}
                preferences={state.preferences}
              />
            )}

            {state.currentView === 'settings' && (
              <SettingsPanel
                preferences={state.preferences}
                onUpdatePreferences={updatePreferences}
                stats={currentStats}
              />
            )}
          </div>
        </main>
      </div>
      <Toaster />
    </ErrorBoundary>
  );
};

export default App;
