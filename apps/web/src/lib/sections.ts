import { navigate } from '../hooks/useHashRoute';

/** Start-page sections reachable from the nav and footer. */
export const START_SECTIONS = [
  { id: 'features', label: 'Features' },
  { id: 'how-it-works', label: 'How it works' },
  { id: 'examples', label: 'Examples' },
  { id: 'faq', label: 'FAQ' },
] as const;

let pendingSection: string | null = null;

/** Called by the route-change effect: where to land after navigating, if not the top. */
export function consumePendingSection(): string | null {
  const id = pendingSection;
  pendingSection = null;
  return id;
}

/**
 * Scroll to a start-page section from anywhere. Hash routing owns the URL
 * hash, so sections are reached by script rather than by `#id` links.
 */
export function goToStartSection(id: string): void {
  const target = document.getElementById(id);
  if (target) {
    target.scrollIntoView({ behavior: 'instant', block: 'start' });
    return;
  }
  pendingSection = id;
  navigate({ name: 'start' });
}
