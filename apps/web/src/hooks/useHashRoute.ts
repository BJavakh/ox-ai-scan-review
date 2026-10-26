import { useSyncExternalStore } from 'react';

export type Route = { name: 'start' } | { name: 'scan'; id: string };

const SCAN_ROUTE = /^#\/scans\/([0-9a-f-]{36})$/i;

export function parseRoute(hash: string): Route {
  const match = SCAN_ROUTE.exec(hash);
  return match?.[1] ? { name: 'scan', id: match[1] } : { name: 'start' };
}

function subscribe(callback: () => void): () => void {
  window.addEventListener('hashchange', callback);
  return () => {
    window.removeEventListener('hashchange', callback);
  };
}

export function useHashRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash);
  return parseRoute(hash);
}

export function navigate(route: Route): void {
  window.location.hash = route.name === 'scan' ? `#/scans/${route.id}` : '#/';
}
