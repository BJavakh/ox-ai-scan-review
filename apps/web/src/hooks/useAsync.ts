import { useEffect, useState } from 'react';
import { ApiRequestError } from '../api/client';

export type AsyncState<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'error'; error: ApiRequestError };

/** Run an async loader when `key` changes. Mount with `key` to reset between resources. */
export function useAsync<T>(load: () => Promise<T>, key: string): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({ status: 'loading' });
  useEffect(() => {
    let active = true;
    load().then(
      (data) => {
        if (active) setState({ status: 'ready', data });
      },
      (error: unknown) => {
        if (active) {
          setState({
            status: 'error',
            error:
              error instanceof ApiRequestError
                ? error
                : new ApiRequestError(0, 'UNKNOWN', 'Unexpected error.'),
          });
        }
      },
    );
    return () => {
      active = false;
    };
    // `load` is intentionally keyed by `key` so callers can pass inline closures.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}
