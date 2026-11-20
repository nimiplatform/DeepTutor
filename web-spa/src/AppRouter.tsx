import React, {
  Component,
  lazy,
  Suspense,
  use,
  useEffect,
  useMemo,
  type ComponentType,
  type ReactNode,
} from 'react';
import {
  navigateClient,
  NotFoundError,
  RedirectError,
  RouteParamsContext,
  usePathname,
  useSearchParams,
  type RouteParams,
} from './shims/next-navigation';

type LayoutComponent = ComponentType<{ children: ReactNode }>;
type PageProps = {
  params: Promise<RouteParams>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};
type AnyPageComponent = ComponentType<PageProps> | ((props: PageProps) => Promise<ReactNode>);

const eagerLayouts = import.meta.glob<{ default: LayoutComponent }>(
  ['../../web/app/**/layout.tsx', '!../../web/app/layout.tsx'],
  { eager: true },
);

const lazyPages = import.meta.glob<{ default: AnyPageComponent }>(
  '../../web/app/**/page.tsx',
);

type SegmentToken =
  | { kind: 'static'; value: string }
  | { kind: 'param'; name: string }
  | { kind: 'catchAll'; name: string };

type CompiledRoute = {
  fileKey: string;
  dirParts: string[];
  tokens: SegmentToken[];
  score: number;
  Component: ComponentType<{
    routeCacheKey: string;
    params: RouteParams;
    searchObject: Record<string, string | string[] | undefined>;
  }>;
  layouts: LayoutComponent[];
};

function wrapPageLoader(loader: () => Promise<{ default: AnyPageComponent }>) {
  return lazy(async () => {
    const mod = await loader();
    const RawPage = mod.default;
    const isAsync = RawPage?.constructor?.name === 'AsyncFunction';

    function WrappedRoutePage({
      routeCacheKey,
      params,
      searchObject,
    }: {
      routeCacheKey: string;
      params: RouteParams;
      searchObject: Record<string, string | string[] | undefined>;
    }) {
      const paramsPromise = useMemo(() => Promise.resolve(params), [routeCacheKey]);
      const searchPromise = useMemo(() => Promise.resolve(searchObject), [routeCacheKey]);
      if (isAsync) {
        const asyncElement = useMemo(
          () => (RawPage as (props: PageProps) => Promise<ReactNode>)({
            params: paramsPromise,
            searchParams: searchPromise,
          }),
          [paramsPromise, searchPromise],
        );
        return <>{use(asyncElement)}</>;
      }
      const SyncPage = RawPage as ComponentType<PageProps>;
      return <SyncPage params={paramsPromise} searchParams={searchPromise} />;
    }

    return { default: WrappedRoutePage };
  });
}

function compileRoutes(): CompiledRoute[] {
  const prefix = '../../web/app/';
  const layoutMap = new Map<string, LayoutComponent>();
  for (const [key, mod] of Object.entries(eagerLayouts)) {
    if (key === '../../web/app/layout.tsx') continue;
    if (mod?.default) {
      const relDir = key.slice(prefix.length, -'/layout.tsx'.length);
      layoutMap.set(relDir, mod.default);
    }
  }

  const routes: CompiledRoute[] = [];
  for (const [fileKey, loader] of Object.entries(lazyPages)) {
    const rel = fileKey.slice(prefix.length);
    const dirRel = rel === 'page.tsx' ? '' : rel.slice(0, -'/page.tsx'.length);
    const dirParts = dirRel ? dirRel.split('/') : [];

    const tokens: SegmentToken[] = [];
    let score = 0;
    for (const seg of dirParts) {
      if (seg.startsWith('(') && seg.endsWith(')')) continue;
      if (seg.startsWith('[...') && seg.endsWith(']')) {
        tokens.push({ kind: 'catchAll', name: seg.slice(4, -1) });
        score += 1;
      } else if (seg.startsWith('[') && seg.endsWith(']')) {
        tokens.push({ kind: 'param', name: seg.slice(1, -1) });
        score += 10;
      } else {
        tokens.push({ kind: 'static', value: seg });
        score += 100;
      }
    }

    const layouts: LayoutComponent[] = [];
    for (let i = 1; i <= dirParts.length; i += 1) {
      const candidate = dirParts.slice(0, i).join('/');
      const layout = layoutMap.get(candidate);
      if (layout) layouts.push(layout);
    }

    routes.push({
      fileKey,
      dirParts,
      tokens,
      score,
      Component: wrapPageLoader(loader),
      layouts,
    });
  }

  routes.sort((a, b) => b.score - a.score || b.tokens.length - a.tokens.length);
  return routes;
}

const ROUTES = compileRoutes();

function matchPathname(pathname: string): { route: CompiledRoute; params: RouteParams } | null {
  const clean = pathname === '/' ? [] : pathname.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);

  for (const route of ROUTES) {
    const params: RouteParams = {};
    let matched = true;
    let segIdx = 0;

    for (let tokIdx = 0; tokIdx < route.tokens.length; tokIdx += 1) {
      const token = route.tokens[tokIdx];
      if (token.kind === 'catchAll') {
        if (segIdx >= clean.length) {
          matched = false;
          break;
        }
        params[token.name] = clean.slice(segIdx).map((part) => decodeURIComponent(part));
        segIdx = clean.length;
        break;
      }
      if (segIdx >= clean.length) {
        matched = false;
        break;
      }
      const actual = decodeURIComponent(clean[segIdx]);
      if (token.kind === 'static') {
        if (actual !== token.value) {
          matched = false;
          break;
        }
      } else {
        params[token.name] = actual;
      }
      segIdx += 1;
    }

    if (matched && segIdx === clean.length) {
      return { route, params };
    }
  }
  return null;
}

function RedirectTrigger({ destination }: { destination: string }) {
  useEffect(() => {
    navigateClient(destination, 'replace');
  }, [destination]);
  return null;
}

class RouteErrorBoundary extends Component<
  { routeKey: string; children: ReactNode },
  { redirectTo: string | null; notFound: boolean; error: Error | null }
> {
  state = {
    redirectTo: null as string | null,
    notFound: false,
    error: null as Error | null,
  };

  static getDerivedStateFromError(error: unknown) {
    if (error instanceof RedirectError) {
      return { redirectTo: error.destination, notFound: false, error: null };
    }
    if (error instanceof NotFoundError) {
      return { redirectTo: null, notFound: true, error: null };
    }
    return {
      redirectTo: null,
      notFound: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }

  componentDidUpdate(prevProps: { routeKey: string }) {
    if (
      prevProps.routeKey !== this.props.routeKey &&
      (this.state.redirectTo || this.state.notFound || this.state.error)
    ) {
      this.setState({ redirectTo: null, notFound: false, error: null });
    }
  }

  render() {
    if (this.state.redirectTo) {
      return <RedirectTrigger destination={this.state.redirectTo} />;
    }
    if (this.state.notFound) {
      return (
        <div className="flex min-h-dvh items-center justify-center p-6 text-sm text-[var(--muted-foreground)]">
          Page not found.
        </div>
      );
    }
    if (this.state.error) {
      return (
        <div role="alert" className="flex min-h-dvh items-center justify-center p-6 text-sm text-[var(--destructive)]">
          {this.state.error.message}
        </div>
      );
    }
    return this.props.children;
  }
}

function buildSearchObject(searchParams: URLSearchParams): Record<string, string | string[] | undefined> {
  const result: Record<string, string | string[] | undefined> = {};
  for (const key of new Set(searchParams.keys())) {
    const all = searchParams.getAll(key);
    result[key] = all.length > 1 ? all : all[0];
  }
  return result;
}

export default function AppRouter() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const matched = useMemo(() => matchPathname(pathname), [pathname]);
  const searchStr = searchParams.toString();
  const searchObject = useMemo(() => buildSearchObject(searchParams), [searchStr]);
  const routeCacheKey = `${pathname}?${searchStr}`;

  if (!matched) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-6 text-sm text-[var(--muted-foreground)]">
        Page not found.
      </div>
    );
  }

  const { route, params } = matched;
  const PageComponent = route.Component;

  let content: ReactNode = (
    <Suspense fallback={<div className="min-h-dvh bg-[var(--background)]" aria-busy="true" />}>
      <PageComponent
        key={route.fileKey}
        routeCacheKey={routeCacheKey}
        params={params}
        searchObject={searchObject}
      />
    </Suspense>
  );

  for (let i = route.layouts.length - 1; i >= 0; i -= 1) {
    const Layout = route.layouts[i];
    content = <Layout>{content}</Layout>;
  }

  return (
    <RouteParamsContext.Provider value={params}>
      <RouteErrorBoundary routeKey={routeCacheKey}>{content}</RouteErrorBoundary>
    </RouteParamsContext.Provider>
  );
}
