'use client';
import MotionProvider from '@/components/common/MotionProvider';
import ToastViewport from '@/components/common/ToastViewport';
import SettingsReturnTracker from '@/components/settings/SettingsReturnTracker';
import { WorkspaceNavigation } from '@/components/workspaces/WorkspaceNavigation';
import { AppShellProvider } from '@/context/AppShellContext';
import { I18nClientBridge } from '@/i18n/I18nClientBridge';

export default function BusinessShell({ children }: { children: React.ReactNode }) {
  return (
    <AppShellProvider>
      <SettingsReturnTracker />
      <WorkspaceNavigation />
      <MotionProvider>
        <I18nClientBridge>{children}</I18nClientBridge>
      </MotionProvider>
      <ToastViewport />
    </AppShellProvider>
  );
}
