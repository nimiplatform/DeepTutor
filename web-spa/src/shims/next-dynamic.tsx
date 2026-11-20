import React, { lazy, Suspense, type ComponentType } from 'react';

export interface DynamicOptions<P = Record<string, unknown>> {
  loading?: ComponentType<{ error?: Error | null; isLoading?: boolean; pastDelay?: boolean }>;
  ssr?: boolean;
}

type LoaderResult<P> = ComponentType<P> | { default: ComponentType<P> };

export default function dynamic<P extends object = Record<string, unknown>>(
  loader: () => Promise<LoaderResult<P>>,
  options?: DynamicOptions<P>,
): ComponentType<P> {
  const LazyComponent = lazy(async () => {
    const loaded = await loader();
    if (typeof loaded === 'function' || (loaded && typeof loaded === 'object' && '$$typeof' in loaded && !('default' in loaded))) {
      return { default: loaded as ComponentType<P> };
    }
    return loaded as { default: ComponentType<P> };
  });
  const Loading = options?.loading;

  function DynamicWrapper(props: P) {
    return (
      <Suspense fallback={Loading ? <Loading isLoading /> : null}>
        <LazyComponent {...props} />
      </Suspense>
    );
  }

  return DynamicWrapper;
}
