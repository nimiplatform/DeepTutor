import { resolveDevelopmentRealm } from '@nimiplatform/app-tools/development';
export const MOBILE_UI_ORIGIN = 'https://127.0.0.1:4485';
export const MOBILE_PACKAGE = 'ai.nimi.apps.deeptutor.dev';
export function readMobileAccess(selection) {
  const realm = resolveDevelopmentRealm(selection);
  if (realm.name !== 'local') throw new Error('DeepTutor Android currently supports only the local development source.');
  return {appId:'org.nimiplatform.deeptutor',clientId:'org.nimiplatform.deeptutor.android.dev',
    realmEnvironmentId:realm.environmentId,realmBaseUrl:realm.apiOrigin,officialWebBaseUrl:realm.webOrigin,
    redirectUri:`${MOBILE_PACKAGE}:/oauth/callback`};
}
