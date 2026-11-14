'use client';
import { AppShellProvider } from '@/context/AppShellContext';
import { I18nClientBridge } from '@/i18n/I18nClientBridge';
import ToastViewport from '@/components/common/ToastViewport';
export default function BusinessShell({children}:{children:React.ReactNode}) {
  return <AppShellProvider><I18nClientBridge>{children}</I18nClientBridge><ToastViewport/></AppShellProvider>;
}
