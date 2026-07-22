import type React from 'react';
import { createContext, useContext } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Are the numbers on screen the result of a real read?
 *
 * `UsageStats.fetchedAt` is undefined when the main process fell back to a
 * zeroed payload. Rendered verbatim that reads as a quiet day — 0 tokens,
 * $0.00, 0% — which is the opposite of the truth. Views wrap their value slots
 * in `<Metric>` so the distinction is made once, here, instead of being
 * re-derived in every card.
 */
const DataAvailableContext = createContext(true);

export const DataAvailabilityProvider: React.FC<{
  available: boolean;
  children: React.ReactNode;
}> = ({ available, children }) => (
  <DataAvailableContext.Provider value={available}>{children}</DataAvailableContext.Provider>
);

export const useDataAvailable = (): boolean => useContext(DataAvailableContext);

/**
 * A numeric slot: the real value, or an explicit "not available" marker.
 * Wrap the *number*, not the label — the label still tells the user what the
 * missing figure would have been.
 */
export const Metric: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const available = useDataAvailable();
  const { t } = useTranslation();

  if (available) return <>{children}</>;
  return (
    <span title={t('app.dataUnavailableHint')} aria-label={t('app.dataUnavailable')}>
      —
    </span>
  );
};
