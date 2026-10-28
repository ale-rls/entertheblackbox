import { beforeEach, describe, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({
  setNotificationHandler: vi.fn(), setNotificationChannelAsync: vi.fn(async () => {}),
  getPermissionsAsync: vi.fn(), requestPermissionsAsync: vi.fn(),
  scheduleNotificationAsync: vi.fn(async () => 'id'),
  cancelScheduledNotificationAsync: vi.fn(async () => {}), dismissNotificationAsync: vi.fn(async () => {}),
  AndroidImportance: { HIGH: 4 }, IosAuthorizationStatus: { PROVISIONAL: 3 },
}));
vi.mock('expo-notifications', () => api);
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
import { createActionAlerts, enableActionNotifications } from './notifications';
beforeEach(() => vi.clearAllMocks());
describe('system notification integration', () => {
  it('creates the Android channel before requesting permission', async () => {
    api.getPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: true });
    api.requestPermissionsAsync.mockResolvedValue({ granted: true });
    expect(await enableActionNotifications()).toBe(true);
    expect(api.setNotificationChannelAsync.mock.invocationCallOrder[0]!).toBeLessThan(api.requestPermissionsAsync.mock.invocationCallOrder[0]!);
  });
  it('respects permanent denial without another permission request', async () => {
    api.getPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: false });
    expect(await enableActionNotifications()).toBe(false);
    expect(api.requestPermissionsAsync).not.toHaveBeenCalled();
  });
  it('delivers silent action alerts and cancels and dismisses them on completion', async () => {
    const alerts = createActionAlerts(vi.fn());
    alerts.update({ key: 'k', body: 'Open the app' }); await alerts.settled();
    expect(api.scheduleNotificationAsync).toHaveBeenCalledWith(expect.objectContaining({ content: expect.objectContaining({ sound: false, body: 'Open the app' }), trigger: { channelId: 'show-actions' } }));
    alerts.update(null); await alerts.settled();
    expect(api.cancelScheduledNotificationAsync).toHaveBeenCalledWith('id');
    expect(api.dismissNotificationAsync).toHaveBeenCalledWith('id');
  });
});
