import React, { StrictMode } from 'react';
import { render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const { create, start, dispose } = vi.hoisted(() => ({ create: vi.fn(), start: vi.fn(async () => {}), dispose: vi.fn() }));
vi.mock('@nimiplatform/kit/auth/app/web', () => ({ createWebNimiAppSession: create }));
vi.mock('@nimiplatform/kit/auth/app', () => ({
  NimiAccountControl: () => null,
  NimiAppAccessGate: () => <div>Official gate</div>,
  NimiAppSessionProvider: ({ children }: { children: React.ReactNode }) => children,
  useNimiAppSession: () => ({ snapshot: { identity: { status: 'signed-out' }, runtime: { status: 'disconnected' } } }),
}));
vi.mock('@nimiplatform/kit/ui', () => ({ NimiThemeProvider: ({ children }: { children: React.ReactNode }) => children, TooltipProvider: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('@/lib/nimi/web-connection', () => ({ bindWebWorkspace: vi.fn() }));
vi.mock('@/shared/storage/web-workspace', () => ({ bindBrowserWorkspaceStorage: vi.fn() }));
vi.mock('@/lib/nimi/web-business-transport', () => ({ installBusinessFetch: vi.fn() }));
beforeEach(() => { vi.resetModules(); create.mockReturnValue({ start, dispose }); vi.stubEnv('NEXT_PUBLIC_NIMI_WEB_CONFIG', '{}'); });
afterEach(() => { vi.unstubAllEnvs(); });

it('React development effect replay uses one document identity and does not dispose it', async () => {
  const { default: WebBoundary } = await import('../components/nimi/WebBoundary');
  render(<StrictMode><WebBoundary>Business page</WebBoundary></StrictMode>);
  expect(create).toHaveBeenCalledTimes(1);
  expect(dispose).not.toHaveBeenCalled();
});

it('the iframe advertises its one MessagePort binding only once under StrictMode', async () => {
  const frame = document.createElement('iframe'); document.body.appendChild(frame);
  const parentWindow = frame.contentWindow!;
  const descriptor = Object.getOwnPropertyDescriptor(window, 'parent');
  Object.defineProperty(window, 'parent', { configurable: true, value: parentWindow });
  const advertised = vi.spyOn(parentWindow, 'postMessage');
  try {
    const { default: WebBoundary } = await import('../components/nimi/WebBoundary');
    render(<StrictMode><WebBoundary>Business page</WebBoundary></StrictMode>);
    expect(advertised).toHaveBeenCalledTimes(1);
    expect(advertised).toHaveBeenCalledWith('deeptutor-workspace-ready', location.origin);
  } finally {
    if (descriptor) Object.defineProperty(window, 'parent', descriptor);
    frame.remove();
  }
});
