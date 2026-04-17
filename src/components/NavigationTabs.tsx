import { BarChart3, LayoutDashboard, Settings, TerminalSquare } from 'lucide-react';
import type React from 'react';
import { useTranslation } from 'react-i18next';

type ViewType = 'dashboard' | 'live' | 'analytics' | 'terminal' | 'settings';

interface NavigationTabsProps {
  currentView: ViewType;
  onNavigate: (view: ViewType) => void;
  className?: string;
}

type TabDef = {
  id: ViewType;
  tKey: 'dashboard' | 'analytics' | 'terminal' | 'settings';
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
};

const tabs: TabDef[] = [
  { id: 'dashboard', tKey: 'dashboard', icon: LayoutDashboard },
  { id: 'analytics', tKey: 'analytics', icon: BarChart3 },
  { id: 'terminal', tKey: 'terminal', icon: TerminalSquare },
  { id: 'settings', tKey: 'settings', icon: Settings },
];

// Editorial underline tabs — no pill, no background. Active tab gets a
// terracotta underline and near-black text; inactive tabs stay olive gray.
export const NavigationTabs: React.FC<NavigationTabsProps> = ({
  currentView,
  onNavigate,
  className = '',
}) => {
  const { t } = useTranslation();
  return (
    <nav
      className={`${className} relative`}
      style={{ borderBottom: '1px solid var(--cream)' }}
    >
      <div className="flex items-center gap-1">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = currentView === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onNavigate(tab.id)}
              className="relative inline-flex items-center gap-2 px-3 py-2 text-sm transition-colors"
              style={{
                color: active ? 'var(--claude-black)' : 'var(--claude-olive)',
                fontWeight: active ? 500 : 400,
                // Header is the drag region; individual tab buttons need to
                // opt out so clicks register normally.
                WebkitAppRegion: 'no-drag',
              } as React.CSSProperties}
              onMouseEnter={(e) => {
                if (!active) e.currentTarget.style.color = 'var(--claude-charcoal)';
              }}
              onMouseLeave={(e) => {
                if (!active) e.currentTarget.style.color = 'var(--claude-olive)';
              }}
            >
              <Icon className="w-[15px] h-[15px]" strokeWidth={active ? 2 : 1.75} />
              <span className="font-sans text-[13px] tracking-tight">
                {t(`tabs.${tab.tKey}`)}
              </span>
              {active && (
                <span
                  className="absolute left-2 right-2 -bottom-px h-[2px] rounded-full"
                  style={{ background: 'var(--terracotta)' }}
                />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
};
