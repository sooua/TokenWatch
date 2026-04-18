import { Download, RefreshCw, X } from 'lucide-react';
import type React from 'react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error';

interface UpdatePayload {
  status: UpdateStatus;
  version?: string;
  error?: string;
  percent?: number;
  bytesPerSecond?: number;
  transferred?: number;
  total?: number;
  releaseNotes?: string;
  // Marks where a failure originated. `'check'` failures are handled by
  // the SettingsPanel "check now" toast flow; the banner hides them to
  // avoid doubling up on the same message. Download/install errors
  // omit this field and still paint the persistent banner.
  source?: 'check' | 'download' | 'install';
}

// A thin Claude-styled banner that appears when an update is available.
// Sits above the header so it doesn't shift the main content around.
// Hidden while idle / not-available to keep the UI quiet on day-to-day use.
export const UpdateBanner: React.FC = () => {
  const { t } = useTranslation();
  const [payload, setPayload] = useState<UpdatePayload>({ status: 'idle' });
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const listener = window.electronAPI?.onUpdateStatus?.((p) => {
      const next = p as unknown as UpdatePayload;
      setPayload(next);
      // Re-show banner whenever a new status arrives (user may have dismissed
      // a prior 'not-available' but an 'available' just came in).
      if (next.status === 'available' || next.status === 'downloaded' || next.status === 'error') {
        setDismissed(false);
      }
    });
    return () => {
      if (listener) window.electronAPI?.removeUpdateStatusListener?.(listener);
    };
  }, []);

  // Only render for states that matter to the user. A check-time error
  // (e.g. 504 from the manual "check now" button) is surfaced as a toast
  // in SettingsPanel instead — rendering it here too would double up.
  const visible =
    !dismissed &&
    (payload.status === 'available' ||
      payload.status === 'downloading' ||
      payload.status === 'downloaded' ||
      (payload.status === 'error' && payload.source !== 'check'));

  if (!visible) return null;

  const barStyle: React.CSSProperties = {
    background: 'var(--ivory)',
    border: '1px solid var(--cream)',
    color: 'var(--claude-black)',
    boxShadow: 'var(--shadow-whisper)',
  };

  return (
    <div className="mx-3 mt-2 rounded-lg px-3 py-2 flex items-center gap-3" style={barStyle}>
      <div
        className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
        style={{ background: 'var(--sand)', color: 'var(--terracotta)' }}
      >
        {payload.status === 'downloading' ? (
          <RefreshCw className="w-3.5 h-3.5 animate-spin" strokeWidth={1.75} />
        ) : (
          <Download className="w-3.5 h-3.5" strokeWidth={1.75} />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium truncate">
          {payload.status === 'available' &&
            t('update.available', { version: payload.version || '' })}
          {payload.status === 'downloading' &&
            t('update.downloading', {
              percent: Math.round(payload.percent || 0),
            })}
          {payload.status === 'downloaded' &&
            t('update.downloaded', { version: payload.version || '' })}
          {payload.status === 'error' && t('update.error')}
        </div>
        {payload.status === 'error' && payload.error && (
          <div
            className="text-[11px] truncate"
            style={{ color: 'var(--claude-stone)' }}
            title={payload.error}
          >
            {payload.error}
          </div>
        )}
        {payload.status === 'downloading' && (
          <div
            className="h-[3px] mt-1.5 rounded-full overflow-hidden"
            style={{ background: 'var(--sand)' }}
          >
            <div
              className="h-full transition-all duration-300"
              style={{
                width: `${Math.min(payload.percent || 0, 100)}%`,
                background: 'var(--terracotta)',
              }}
            />
          </div>
        )}
      </div>

      <div className="flex items-center gap-1.5 flex-shrink-0">
        {payload.status === 'available' && (
          <button
            type="button"
            onClick={() => window.electronAPI?.updateDownload?.()}
            className="px-2.5 py-1 rounded-md text-[12px] font-medium transition-colors"
            style={{
              background: 'var(--terracotta)',
              color: 'var(--ivory)',
            }}
          >
            {t('update.downloadBtn')}
          </button>
        )}
        {payload.status === 'downloaded' && (
          <button
            type="button"
            onClick={() => window.electronAPI?.updateInstall?.()}
            className="px-2.5 py-1 rounded-md text-[12px] font-medium transition-colors"
            style={{
              background: 'var(--terracotta)',
              color: 'var(--ivory)',
            }}
          >
            {t('update.installBtn')}
          </button>
        )}
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => setDismissed(true)}
          className="w-6 h-6 inline-flex items-center justify-center rounded transition-colors"
          style={{ color: 'var(--claude-olive)' }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--cream)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
          }}
        >
          <X className="w-3.5 h-3.5" strokeWidth={2} />
        </button>
      </div>
    </div>
  );
};
