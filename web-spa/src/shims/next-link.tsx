import React, { forwardRef } from 'react';
import { navigateClient } from './next-navigation';

type HrefObject = {
  pathname?: string | null;
  search?: string | null;
  hash?: string | null;
  query?: Record<string, string | number | boolean | undefined | null>;
};

export type LinkProps = Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  href: string | HrefObject;
  replace?: boolean;
  scroll?: boolean;
  prefetch?: boolean;
};

function formatHref(href: string | HrefObject): string {
  if (typeof href === 'string') return href;
  const pathname = href.pathname ?? '/';
  let search = href.search ?? '';
  if (!search && href.query) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(href.query)) {
      if (value !== undefined && value !== null) params.set(key, String(value));
    }
    const qs = params.toString();
    if (qs) search = `?${qs}`;
  }
  const hash = href.hash ?? '';
  return `${pathname}${search}${hash}`;
}

const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link(
  { href, replace = false, scroll = true, prefetch: _prefetch, onClick, target, ...rest },
  ref,
) {
  const resolvedHref = formatHref(href);

  const handleClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      (target && target !== '_self') ||
      rest.download !== undefined
    ) {
      return;
    }
    let parsed: URL;
    try {
      parsed = new URL(resolvedHref, window.location.origin);
    } catch {
      return;
    }
    if (parsed.origin !== window.location.origin) return;
    event.preventDefault();
    navigateClient(resolvedHref, replace ? 'replace' : 'push', { scroll });
  };

  return <a ref={ref} href={resolvedHref} target={target} onClick={handleClick} {...rest} />;
});

export default Link;
