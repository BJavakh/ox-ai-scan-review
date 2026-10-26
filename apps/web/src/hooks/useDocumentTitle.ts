import { useEffect } from 'react';

const APP = 'Scan Review';

/** `null` resets to the app name; `undefined` leaves the title to a child screen. */
export function useDocumentTitle(title: string | null | undefined): void {
  useEffect(() => {
    if (title === undefined) return;
    document.title = title === null ? APP : `${title} · ${APP}`;
  }, [title]);
}
