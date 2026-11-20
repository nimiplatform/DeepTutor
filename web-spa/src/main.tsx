import React from 'react';
import { createRoot } from 'react-dom/client';
import '../../web/app/globals.css';
import '../../web/features/ui-layout/classic/classic.css';
import '../../web/features/ui-layout/modern/modern.css';
import '../../web/public/nimi-ui.css';
import {
  DEFAULT_UI_LAYOUT,
  UI_LAYOUT_ATTRIBUTE,
  UI_LAYOUT_STORAGE_KEY,
} from '@/lib/ui-layout';
import WebBoundary from '@/components/nimi/WebBoundary';
import AppRouter from './AppRouter';
import { NavigationProvider } from './shims/next-navigation';

function applyInitialTheme() {
  try {
    const stored = window.localStorage.getItem('deeptutor-theme');
    document.documentElement.classList.remove('dark', 'theme-glass', 'theme-snow');
    if (stored === 'dark') {
      document.documentElement.classList.add('dark');
    } else if (stored === 'glass') {
      document.documentElement.classList.add('dark', 'theme-glass');
    } else if (stored === 'snow') {
      document.documentElement.classList.add('theme-snow');
    } else if (stored === 'light') {
      // keep default light tokens
    } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.add('theme-snow');
    }
  } catch {
    /* localStorage unavailable */
  }
  try {
    const layout = window.localStorage.getItem(UI_LAYOUT_STORAGE_KEY);
    document.documentElement.setAttribute(
      UI_LAYOUT_ATTRIBUTE,
      layout === 'classic' || layout === 'modern' ? layout : DEFAULT_UI_LAYOUT,
    );
  } catch {
    document.documentElement.setAttribute(UI_LAYOUT_ATTRIBUTE, DEFAULT_UI_LAYOUT);
  }
}

applyInitialTheme();

const container = document.getElementById('root');
if (!container) {
  throw new Error('Missing DeepTutor root element.');
}

createRoot(container).render(
  <NavigationProvider>
    <WebBoundary>
      <AppRouter />
    </WebBoundary>
  </NavigationProvider>,
);
