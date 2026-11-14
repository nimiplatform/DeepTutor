import type { CapacitorConfig } from '@capacitor/cli';
import { MOBILE_PACKAGE, MOBILE_UI_ORIGIN, readMobileAccess } from './scripts/mobile-config.mjs';
const access=readMobileAccess();
const config:CapacitorConfig={appId:MOBILE_PACKAGE,appName:'DeepTutor（本地测试）',webDir:'mobile-shell',loggingBehavior:'none',
  server:{url:MOBILE_UI_ORIGIN,androidScheme:'https',errorPath:'offline.html'},
  android:{useLegacyBridge:false,resolveServiceWorkerRequests:false,minWebViewVersion:120},
  plugins:{NimiAppAccess:{realmBaseUrl:access.realmBaseUrl,clientId:access.clientId,redirectUri:access.redirectUri}}};
export default config;
