import {
  AppWindow,
  Bot,
  Clock,
  Gauge,
  Globe,
  Languages,
  PictureInPicture,
  Rocket,
} from 'lucide-react';
import type React from 'react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { UsageStats } from '../types/usage';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Switch } from './ui/switch';

// Small section header used across settings — serif title + olive subtitle
// next to a warm lucide icon in a sand disc.
const SectionHeader: React.FC<{
  icon: React.ReactNode;
  title: string;
  description: string;
}> = ({ icon, title, description }) => (
  <div className="flex items-center space-x-3">
    <div
      className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
      style={{ background: 'var(--sand)', color: 'var(--terracotta)' }}
    >
      {icon}
    </div>
    <div>
      <div
        className="font-serif"
        style={{
          color: 'var(--claude-black)',
          fontSize: '16px',
          fontWeight: 500,
          letterSpacing: '-0.005em',
        }}
      >
        {title}
      </div>
      <div className="text-[12px]" style={{ color: 'var(--claude-olive)' }}>
        {description}
      </div>
    </div>
  </div>
);

interface SettingsPanelProps {
  preferences: {
    timezone?: string;
    resetHour?: number;
    plan?: 'auto' | 'Pro' | 'Max5' | 'Max20' | 'Custom';
    customTokenLimit?: number;
    menuBarDisplayMode?: 'percentage' | 'cost' | 'alternate';
    menuBarCostSource?: 'today' | 'sessionWindow';
    launchOnStartup?: boolean;
    standaloneWindow?: boolean;
    language?: 'auto' | 'en' | 'zh';
    miniHud?: boolean;
    miniHudContent?: 'percentage' | 'percentageCost' | 'percentageCostBurn';
  };
  onUpdatePreferences: (preferences: Partial<SettingsPanelProps['preferences']>) => void;
  stats: UsageStats;
}

export const SettingsPanel: React.FC<SettingsPanelProps> = ({
  preferences,
  onUpdatePreferences,
  stats,
}) => {
  const { t } = useTranslation();
  const [currentTime, setCurrentTime] = useState(new Date());

  const handlePreferenceChange = (key: string, value: boolean | number | string) => {
    onUpdatePreferences({ [key]: value });
  };

  // Update current time every minute for real-time countdown
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000); // Update every minute

    return () => clearInterval(interval);
  }, []);

  // Calculate real-time countdown
  const getRealtimeCountdown = () => {
    if (!stats.actualResetInfo?.nextResetTime) {
      return t('settings.nextResetUnavailable');
    }

    const now = currentTime;
    const resetTime = new Date(stats.actualResetInfo.nextResetTime);
    const timeUntilReset = Math.max(0, resetTime.getTime() - now.getTime());

    if (timeUntilReset <= 0) {
      // Same copy as the "available" countdown
      return t('settings.nextResetUnavailable');
    }

    const hours = Math.floor(timeUntilReset / (1000 * 60 * 60));
    const minutes = Math.floor((timeUntilReset % (1000 * 60 * 60)) / (1000 * 60));

    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m`;
    return '<1m';
  };

  return (
    <div className="space-y-6 stagger-children">
      {/* Header */}
      <Card className="bg-neutral-900/80 backdrop-blur-sm border-neutral-800">
        <CardHeader>
          <CardTitle
            className="font-serif"
            style={{
              color: 'var(--claude-black)',
              fontSize: '26px',
              fontWeight: 500,
              letterSpacing: '-0.01em',
            }}
          >
            {t('settings.title')}
          </CardTitle>
          <CardDescription style={{ color: 'var(--claude-olive)' }}>
            {t('settings.subtitle')}
          </CardDescription>
        </CardHeader>
      </Card>

      {/* General Settings */}
      <Card className="bg-neutral-900/80 backdrop-blur-sm border-neutral-800">
        <CardContent className="p-6 space-y-6">
          {/* Timezone Configuration */}
          <div className="space-y-3">
            <SectionHeader
              icon={<Globe className="w-4 h-4" strokeWidth={1.75} />}
              title={t('settings.timezone')}
              description={t('settings.timezoneDesc')}
            />

            <div className="ml-11 space-y-3">
              <div className="bg-white/5 border border-white/10 rounded-lg px-3 py-2">
                <div className="text-white text-sm font-medium">
                  {preferences.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone}
                </div>
                <div className="text-white/50 text-xs mt-1">{t('settings.timezoneAutoHint')}</div>
              </div>

              <div className="space-y-3">
                <div
                  className="rounded-lg p-3 flex items-center gap-2"
                  style={{
                    background: 'var(--parchment)',
                    border: '1px solid var(--cream)',
                    color: 'var(--terracotta-dark)',
                  }}
                >
                  <Clock className="w-4 h-4 flex-shrink-0" strokeWidth={1.75} />
                  <div className="text-[13px]">
                    <span style={{ fontWeight: 500, color: 'var(--claude-black)' }}>
                      {t('settings.nextReset')}
                    </span>
                    <span className="font-mono" style={{ color: 'var(--claude-olive)' }}>
                      {getRealtimeCountdown()}
                    </span>
                  </div>
                </div>

                {!stats.actualResetInfo?.nextResetTime && (
                  <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3">
                    <div className="text-yellow-300 text-sm">
                      {t('settings.estimatedReset', {
                        value: stats.resetInfo
                          ? new Date(stats.resetInfo.nextResetTime).toLocaleString([], {
                              timeZone:
                                preferences.timezone ||
                                Intl.DateTimeFormat().resolvedOptions().timeZone,
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })
                          : t('settings.nextResetUnavailable'),
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Language */}
          <div className="space-y-3">
            <SectionHeader
              icon={<Languages className="w-4 h-4" strokeWidth={1.75} />}
              title={t('settings.language')}
              description={t('settings.languageDesc')}
            />
            <div className="ml-11">
              <Select
                value={preferences.language || 'auto'}
                onValueChange={(value) =>
                  handlePreferenceChange('language', value as 'auto' | 'en' | 'zh')
                }
              >
                <SelectTrigger className="w-full bg-white/10 border-white/20 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">{t('settings.languageAuto')}</SelectItem>
                  <SelectItem value="en">{t('settings.languageEn')}</SelectItem>
                  <SelectItem value="zh">{t('settings.languageZh')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Claude Plan Configuration */}
          <div className="space-y-3">
            <SectionHeader
              icon={<Bot className="w-4 h-4" strokeWidth={1.75} />}
              title={t('settings.plan')}
              description={t('settings.planDesc')}
            />

            <div className="ml-11 space-y-3">
              <div>
                <div className="text-white/70 text-sm mb-2">{t('settings.planSelection')}</div>
                <Select
                  value={preferences.plan || 'auto'}
                  onValueChange={(value) =>
                    handlePreferenceChange(
                      'plan',
                      value as 'auto' | 'Pro' | 'Max5' | 'Max20' | 'Custom'
                    )
                  }
                >
                  <SelectTrigger className="w-full bg-white/10 border-white/20 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">{t('settings.planAuto')}</SelectItem>
                    <SelectItem value="Pro">{t('settings.planPro')}</SelectItem>
                    <SelectItem value="Max5">{t('settings.planMax5')}</SelectItem>
                    <SelectItem value="Max20">{t('settings.planMax20')}</SelectItem>
                    <SelectItem value="Custom">{t('settings.planCustom')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {preferences.plan === 'Custom' && (
                <div>
                  <div className="text-white/70 text-sm mb-2">
                    {t('settings.customLimitLabel')}
                  </div>
                  <input
                    type="number"
                    min="1000"
                    max="1000000"
                    step="1000"
                    value={preferences.customTokenLimit || ''}
                    onChange={(e) =>
                      handlePreferenceChange(
                        'customTokenLimit',
                        Number.parseInt(e.target.value) || 0
                      )
                    }
                    className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white placeholder:text-white/50 focus:border-blue-500 focus:outline-none"
                    placeholder={t('settings.customLimitPlaceholder')}
                  />
                  <div className="text-white/50 text-xs mt-1">
                    {t('settings.customLimitHint')}
                  </div>
                </div>
              )}

              <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3">
                <div className="text-green-300 text-sm">
                  {t('settings.detectedPlan', {
                    plan: stats.currentPlan,
                    limit: stats.tokenLimit?.toLocaleString() ?? '—',
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Menu Bar Display Mode */}
          <div className="space-y-3">
            <SectionHeader
              icon={<Gauge className="w-4 h-4" strokeWidth={1.75} />}
              title={t('settings.display')}
              description={t('settings.displayDesc')}
            />

            <div className="ml-11 space-y-3">
              <div>
                <div className="text-white/70 text-sm mb-2">{t('settings.displayMode')}</div>
                <Select
                  value={preferences.menuBarDisplayMode || 'alternate'}
                  onValueChange={(value: 'percentage' | 'cost' | 'alternate') =>
                    handlePreferenceChange('menuBarDisplayMode', value)
                  }
                >
                  <SelectTrigger className="w-full bg-white/5 border-white/10 text-white hover:bg-white/10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percentage">{t('settings.displayPercentage')}</SelectItem>
                    <SelectItem value="cost">{t('settings.displayCost')}</SelectItem>
                    <SelectItem value="alternate">{t('settings.displayAlternate')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3">
                <div className="text-blue-300 text-sm">
                  {preferences.menuBarDisplayMode === 'percentage' &&
                    t('settings.displayPercentageHint')}
                  {preferences.menuBarDisplayMode === 'cost' && t('settings.displayCostHint')}
                  {(!preferences.menuBarDisplayMode ||
                    preferences.menuBarDisplayMode === 'alternate') &&
                    t('settings.displayAlternateHint')}
                </div>
              </div>

              {/* Cost Basis for Menu Bar (hidden when Percentage Only is selected) */}
              {preferences.menuBarDisplayMode !== 'percentage' && (
                <div>
                  <div className="text-white/70 text-sm mb-2">{t('settings.costBasis')}</div>
                  <Select
                    value={preferences.menuBarCostSource || 'today'}
                    onValueChange={(value: 'today' | 'sessionWindow') =>
                      handlePreferenceChange('menuBarCostSource', value)
                    }
                  >
                    <SelectTrigger className="w-full bg-white/5 border-white/10 text-white hover:bg-white/10">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="today">{t('settings.costToday')}</SelectItem>
                      <SelectItem value="sessionWindow">{t('settings.costSession')}</SelectItem>
                    </SelectContent>
                  </Select>
                  <div className="text-white/50 text-xs mt-2">
                    When set to Current session window, the menu bar cost reflects the rolling
                    5-hour session window instead of today's total.
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Launch on Startup */}
          <div className="flex items-center justify-between gap-3 pt-1">
            <SectionHeader
              icon={<Rocket className="w-4 h-4" strokeWidth={1.75} />}
              title={t('settings.launchStartup')}
              description={t('settings.launchStartupDesc')}
            />
            <Switch
              checked={preferences.launchOnStartup === true}
              onCheckedChange={(checked) =>
                handlePreferenceChange('launchOnStartup', Boolean(checked))
              }
            />
          </div>

          {/* Standalone Window Mode */}
          <div className="flex items-center justify-between gap-3">
            <SectionHeader
              icon={<AppWindow className="w-4 h-4" strokeWidth={1.75} />}
              title={t('settings.standalone')}
              description={t('settings.standaloneDesc')}
            />
            <Switch
              checked={preferences.standaloneWindow === true}
              onCheckedChange={(checked) =>
                handlePreferenceChange('standaloneWindow', Boolean(checked))
              }
            />
          </div>

          {/* Mini HUD */}
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <SectionHeader
                icon={<PictureInPicture className="w-4 h-4" strokeWidth={1.75} />}
                title={t('settings.miniHud')}
                description={t('settings.miniHudDesc')}
              />
              <Switch
                checked={preferences.miniHud === true}
                onCheckedChange={(checked) =>
                  handlePreferenceChange('miniHud', Boolean(checked))
                }
              />
            </div>
            {preferences.miniHud && (
              <div className="ml-11">
                <div className="text-white/70 text-sm mb-2">{t('settings.miniHudContent')}</div>
                <Select
                  value={preferences.miniHudContent || 'percentageCost'}
                  onValueChange={(value) =>
                    handlePreferenceChange(
                      'miniHudContent',
                      value as 'percentage' | 'percentageCost' | 'percentageCostBurn'
                    )
                  }
                >
                  <SelectTrigger className="w-full bg-white/5 border-white/10 text-white hover:bg-white/10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percentage">
                      {t('settings.miniHudPercentage')}
                    </SelectItem>
                    <SelectItem value="percentageCost">
                      {t('settings.miniHudPercentageCost')}
                    </SelectItem>
                    <SelectItem value="percentageCostBurn">
                      {t('settings.miniHudPercentageCostBurn')}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
