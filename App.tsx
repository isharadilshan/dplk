import { AppRegistry } from 'react-native';
import App from './src/app';
import { name as appName } from './app.json';
import {
  registerBackgroundPushHandler,
  registerNotifeeBackgroundHandler,
} from './src/services/notifications';

// Background handlers MUST be registered here, at the top level and before
// registerComponent. When a push arrives or a notification button is pressed
// while the app is killed, the OS starts JS without mounting any UI, so code
// inside React components (useEffect, etc.) never runs in that case.
registerBackgroundPushHandler();
registerNotifeeBackgroundHandler();

AppRegistry.registerComponent(appName, () => App);
