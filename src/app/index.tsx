import { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import DetailsScreen from '../screens/DetailsScreen';
import { HelloWorldScreen } from '../screens/HelloWorldScreen';
import { NotificationsScreen } from '../screens/NotificationsScreen';
import { NotificationDetailScreen } from '../screens/NotificationDetailScreen';
import { HealthSyncScreen } from '../screens/HealthSyncScreen';
import { navigationRef, type AppStackParamList } from './navigationRef';
import {
  flushPendingNotification,
  initializeNotifications,
  subscribeToNotifeeEvents,
  subscribeToPushEvents,
} from '../services/notifications';

// Still used by HomeScreen, which isn't mounted right now.
export type RootStackParamList = {
  Home: undefined;
  Details: undefined;
};

const Stack = createNativeStackNavigator<AppStackParamList>();
const BottomTabs = createBottomTabNavigator();

function MainTabs() {
  return (
    <BottomTabs.Navigator initialRouteName="Home">
      <BottomTabs.Screen name="Home" component={HelloWorldScreen} />
      <BottomTabs.Screen
        name="Notifications"
        component={NotificationsScreen}
        options={{ title: 'Health Notifications' }}
      />
      <BottomTabs.Screen
        name="Background"
        component={HealthSyncScreen}
        options={{ title: 'Background Sync' }}
      />
      <BottomTabs.Screen name="Profile" component={DetailsScreen} />
    </BottomTabs.Navigator>
  );
}

function App() {
  useEffect(() => {
    // Create channels/categories first, so they exist before any
    // notification is shown.
    initializeNotifications();

    // Listen for notification events while the app is running. Background
    // and killed-state handlers are registered separately in index.js.
    const unsubscribeNotifee = subscribeToNotifeeEvents();
    const unsubscribePush = subscribeToPushEvents();

    return () => {
      unsubscribeNotifee();
      unsubscribePush();
    };
  }, []);

  return (
    <SafeAreaProvider>
      {/* `ref` lets notification handlers navigate from outside any screen.
          `onReady` replays a tap that launched the app before nav mounted. */}
      <NavigationContainer
        ref={navigationRef}
        onReady={flushPendingNotification}
      >
        <Stack.Navigator>
          <Stack.Screen
            name="Main"
            component={MainTabs}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="NotificationDetail"
            component={NotificationDetailScreen}
            options={{ title: 'Notification' }}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

export default App;
