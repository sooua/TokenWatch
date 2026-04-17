import type React from 'react';
import { useTranslation } from 'react-i18next';

interface LoadingScreenProps {
  message?: string;
}

export const LoadingScreen: React.FC<LoadingScreenProps> = ({ message }) => {
  const { t } = useTranslation();
  const currentMessage = message || t('loading.message');

  return (
    <div
      className="h-screen w-full flex items-center justify-center px-8"
      style={{
        background: 'var(--parchment)',
        // Let users drag / snap the frameless window even while it's loading.
        WebkitAppRegion: 'drag',
      } as React.CSSProperties}
    >
      <div className="max-w-sm w-full text-center">
        {/* Claude wordmark using the brand terracotta circle */}
        <div className="mb-10 flex justify-center floating">
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center"
            style={{ background: 'var(--terracotta)' }}
          >
            <span className="font-serif text-[24px] leading-none text-white">T</span>
          </div>
        </div>

        <h1
          className="font-serif mb-3"
          style={{
            color: 'var(--claude-black)',
            fontSize: '36px',
            lineHeight: 1.15,
            letterSpacing: '-0.01em',
            fontWeight: 500,
          }}
        >
          TokenWatch
        </h1>

        <p
          className="mb-10 px-4"
          style={{
            color: 'var(--claude-olive)',
            fontSize: '16px',
            lineHeight: 1.6,
            minHeight: '3.2em',
          }}
          aria-live="polite"
        >
          {currentMessage}
        </p>

        <div className="flex justify-center mb-6">
          <div className="loading-spinner" />
        </div>

        <div className="loading-dots justify-center">
          <div className="loading-dot" />
          <div className="loading-dot" />
          <div className="loading-dot" />
        </div>

        <p
          className="mt-10 text-[11px]"
          style={{ color: 'var(--claude-stone)', letterSpacing: '0.02em' }}
        >
          {t('loading.footer')}
        </p>
      </div>
    </div>
  );
};
