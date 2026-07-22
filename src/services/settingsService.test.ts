import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// SettingsService reads os.homedir() at construction and writes to
// ~/.tokenwatch/settings.json. Redirect homedir to a per-test tmp dir
// so we never touch the real user profile.
const state = { tempHomeDir: '' };
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return {
    ...actual,
    homedir: () => state.tempHomeDir,
  };
});

import { SettingsService } from './settingsService';

beforeEach(() => {
  state.tempHomeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tokenwatch-settings-test-'));
});

afterEach(() => {
  if (state.tempHomeDir && fs.existsSync(state.tempHomeDir)) {
    fs.rmSync(state.tempHomeDir, { recursive: true, force: true });
  }
});

describe('SettingsService', () => {
  it('creates the ~/.tokenwatch directory on construction', () => {
    new SettingsService();
    expect(fs.existsSync(path.join(state.tempHomeDir, '.tokenwatch'))).toBe(true);
  });

  it('returns defaults when no settings file exists', async () => {
    const svc = new SettingsService();
    const settings = await svc.loadSettings();
    expect(settings.plan).toBe('auto');
    expect(settings.menuBarDisplayMode).toBe('alternate');
    expect(settings.language).toBe('auto');
    expect(settings.miniHud).toBe(false);
    expect(settings.showCodexCard).toBe(false);
    expect(settings.autoCheckUpdates).toBe(true);
    // Timezone is auto-detected; just assert it's a non-empty string.
    expect(typeof settings.timezone).toBe('string');
    expect(settings.timezone.length).toBeGreaterThan(0);
  });

  it('round-trips a save/load', async () => {
    const svc = new SettingsService();
    await svc.saveSettings({
      plan: 'Max20',
      customTokenLimit: 200000,
      menuBarDisplayMode: 'cost',
      miniHud: true,
      miniHudX: 100,
      miniHudY: 50,
      showCodexCard: true,
    });

    // Re-construct to ensure persistence survives a fresh instance.
    const svc2 = new SettingsService();
    const reloaded = await svc2.loadSettings();
    expect(reloaded.plan).toBe('Max20');
    expect(reloaded.customTokenLimit).toBe(200000);
    expect(reloaded.menuBarDisplayMode).toBe('cost');
    expect(reloaded.miniHud).toBe(true);
    expect(reloaded.miniHudX).toBe(100);
    expect(reloaded.miniHudY).toBe(50);
    expect(reloaded.showCodexCard).toBe(true);
  });

  it('merges partial saves with existing values', async () => {
    const svc = new SettingsService();
    await svc.saveSettings({ plan: 'Max5', miniHud: true });
    // Second save only touches one field — other fields must persist.
    await svc.saveSettings({ language: 'zh' });

    const reloaded = await svc.loadSettings();
    expect(reloaded.plan).toBe('Max5');
    expect(reloaded.miniHud).toBe(true);
    expect(reloaded.language).toBe('zh');
  });

  it('backfills missing fields from defaults (forward-compat with older files)', async () => {
    // Simulate an older settings.json written before `showCodexCard` existed.
    const tokenwatchDir = path.join(state.tempHomeDir, '.tokenwatch');
    fs.mkdirSync(tokenwatchDir, { recursive: true });
    fs.writeFileSync(
      path.join(tokenwatchDir, 'settings.json'),
      JSON.stringify({ plan: 'Pro' }),
      'utf8'
    );

    const svc = new SettingsService();
    const settings = await svc.loadSettings();
    expect(settings.plan).toBe('Pro');
    // New fields filled from defaults — no crash, no undefined.
    expect(settings.showCodexCard).toBe(false);
    expect(settings.autoCheckUpdates).toBe(true);
  });

  it('returns defaults when settings.json is malformed', async () => {
    const tokenwatchDir = path.join(state.tempHomeDir, '.tokenwatch');
    fs.mkdirSync(tokenwatchDir, { recursive: true });
    fs.writeFileSync(path.join(tokenwatchDir, 'settings.json'), '{ not valid json', 'utf8');

    const svc = new SettingsService();
    const settings = await svc.loadSettings();
    expect(settings.plan).toBe('auto');
    expect(settings.menuBarDisplayMode).toBe('alternate');
  });

  it('backs up a malformed settings.json and refuses to overwrite it', async () => {
    const tokenwatchDir = path.join(state.tempHomeDir, '.tokenwatch');
    fs.mkdirSync(tokenwatchDir, { recursive: true });
    const settingsPath = path.join(tokenwatchDir, 'settings.json');
    const corrupt = '{ "calibratedTokenLimit": 30951188, not valid json';
    fs.writeFileSync(settingsPath, corrupt, 'utf8');

    const svc = new SettingsService();
    await svc.loadSettings();

    // The unreadable file is preserved, both in place and as a copy.
    expect(fs.readFileSync(`${settingsPath}.corrupt`, 'utf8')).toBe(corrupt);
    await expect(svc.saveSettings({ plan: 'Max20' })).rejects.toThrow(/Refusing to overwrite/);
    expect(fs.readFileSync(settingsPath, 'utf8')).toBe(corrupt);
  });

  it('saves normally again once the file is readable', async () => {
    const svc = new SettingsService();
    await svc.saveSettings({ plan: 'Max20', calibratedTokenLimit: 30951188 });

    const reloaded = await svc.loadSettings();
    expect(reloaded.plan).toBe('Max20');
    expect(reloaded.calibratedTokenLimit).toBe(30951188);
    // No temp file left behind by the atomic write.
    expect(fs.existsSync(`${svc.getSettingsPath()}.tmp`)).toBe(false);
  });

  it('exposes the resolved settings path for diagnostics', () => {
    const svc = new SettingsService();
    const p = svc.getSettingsPath();
    expect(p).toContain('.tokenwatch');
    expect(p.endsWith('settings.json')).toBe(true);
  });
});
