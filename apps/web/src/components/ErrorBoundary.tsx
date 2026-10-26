import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Band, SectionHead } from './Layout';

interface State {
  failed: boolean;
}

/**
 * Last line of defence for rendering bugs: one broken component shows a recoverable message
 * instead of a blank page. API and scan failures are handled in the screens, not here.
 * Give it a `key` per route so navigating away clears the error.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // No telemetry backend in this version; the console keeps the stack for debugging.
    // eslint-disable-next-line no-console -- the only place the web app logs, by design
    console.error('Rendering failed', error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <Band tone="paper" labelledBy="render-error-title">
        <div role="alert">
          <SectionHead
            label="Something went wrong"
            titleId="render-error-title"
            title="This page could not be displayed"
            lead="Your scans are not affected. Try again, or go back to the start page."
          />
          <div className="error-actions">
            <button
              type="button"
              className="btn btn-ink"
              onClick={() => {
                this.setState({ failed: false });
              }}
            >
              Try again
            </button>
            <a href="#/" className="btn">
              Back to start
            </a>
          </div>
        </div>
      </Band>
    );
  }
}
