import * as Notifications from 'expo-notifications';
import { AppState, Platform } from 'react-native';
import { ActionAlerts } from './action-prompt';
const channelId = 'show-actions';
Notifications.setNotificationHandler({ handleNotification: async () => {
  // An alert queued as the app returns to the foreground must not cover the staff corner.
  const background = AppState.currentState !== 'active';
  return {
    shouldShowBanner: background, shouldShowList: background,
    // The silent Android channel controls audio while allowing a heads-up alert in the background.
    shouldPlaySound: background && Platform.OS === 'android', shouldSetBadge: false,
  };
} });
export async function enableActionNotifications(): Promise<boolean> {
  if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync(channelId, {
    name: 'Show actions', importance: Notifications.AndroidImportance.HIGH,
    sound: null, enableVibrate: true,
  });
  let permission = await Notifications.getPermissionsAsync();
  if (!permission.granted && permission.canAskAgain) permission = await Notifications.requestPermissionsAsync();
  return permission.granted || permission.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
}
export function createActionAlerts(failed: () => void) {
  return new ActionAlerts(prompt => Notifications.scheduleNotificationAsync({
    content: { title: 'Your turn · Enter the Blackbox', body: prompt.body, sound: false,
      data: { actionKey: prompt.key } },
    trigger: Platform.OS === 'android' ? { channelId } : null,
  }), async id => {
    await Notifications.cancelScheduledNotificationAsync(id);
    await Notifications.dismissNotificationAsync(id);
  }, failed);
}
