import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MenuBarData } from '../types/usage.js';

// The service runs in the Electron main process; the test only cares about the
// text handed to the Notification constructor, so `electron` is faked.
const state = { locale: 'en-US', shown: [] as { title: string; body: string }[] };
vi.mock('electron', () => ({
  app: { getLocale: () => state.locale },
  Notification: class {
    constructor(opts: { title: string; body: string }) {
      state.shown.push({ title: opts.title, body: opts.body });
    }
    static isSupported() {
      return true;
    }
    show() {}
  },
}));

const { NotificationService } = await import('./notificationService.js');

function menuBar(percentageUsed: number, status: MenuBarData['status']): MenuBarData {
  return { tokensUsed: 1000, tokenLimit: 10000, percentageUsed, status, cost: 1 } as MenuBarData;
}

/** Each test needs a service with no notification history of its own. */
function freshService(): InstanceType<typeof NotificationService> {
  (NotificationService as unknown as { instance?: unknown }).instance = undefined;
  return NotificationService.getInstance();
}

describe('NotificationService language', () => {
  beforeEach(() => {
    state.shown = [];
    state.locale = 'en-US';
  });

  it('renders the body in the selected language with the percentage filled in', () => {
    const service = freshService();
    service.setLanguage('zh');
    service.checkAndNotify(menuBar(93.4, 'critical'));

    expect(state.shown).toHaveLength(1);
    expect(state.shown[0].title).toBe('TokenWatch：用量告急');
    expect(state.shown[0].body).toContain('93%');
    expect(state.shown[0].body).not.toContain('{{');
  });

  it('falls back to English for a non-Chinese system locale under auto', () => {
    const service = freshService();
    service.setLanguage('auto');
    service.checkAndNotify(menuBar(80, 'warning'));

    expect(state.shown[0].title).toBe('TokenWatch: Usage warning');
  });

  it('resolves auto to Chinese when the OS locale is Chinese', () => {
    state.locale = 'zh-CN';
    const service = freshService();
    service.setLanguage('auto');
    service.checkAndNotify(menuBar(80, 'warning'));

    expect(state.shown[0].title).toBe('TokenWatch：用量提醒');
  });
});
