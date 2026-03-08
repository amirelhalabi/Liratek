import React from "react";
import logger from "@/utils/logger";

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

/**
 * Top-level React Error Boundary.
 * Catches any unhandled render error and shows a friendly recovery screen
 * instead of a blank white page.
 */
export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo) {
    logger.error(
      `React render crash: ${error?.message}. Stack: ${info.componentStack ?? ""}`,
    );
  }

  handleReload = () => {
    // Reset boundary state so React re-attempts rendering
    this.setState({ hasError: false, error: null });
  };

  override render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-900 flex items-center justify-center p-8">
          <div className="max-w-md w-full bg-slate-800 border border-red-800/50 rounded-2xl p-8 text-center">
            <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
              <svg
                className="w-8 h-8 text-red-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
                />
              </svg>
            </div>

            <h1 className="text-xl font-semibold text-white mb-2">
              Something went wrong
            </h1>
            <p className="text-slate-400 text-sm mb-6">
              An unexpected error occurred in the application. You can try
              reloading the current page, or restart the app if the problem
              persists.
            </p>

            {this.state.error && (
              <details className="text-left mb-6 bg-slate-900 rounded-lg p-3 text-xs text-red-300 font-mono">
                <summary className="cursor-pointer text-slate-500 mb-2">
                  Error details
                </summary>
                {this.state.error.message}
              </details>
            )}

            <div className="flex gap-3 justify-center">
              <button
                onClick={this.handleReload}
                className="px-5 py-2.5 bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium rounded-lg transition-colors"
              >
                Reload Page
              </button>
              <button
                onClick={() => window.location.reload()}
                className="px-5 py-2.5 bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm font-medium rounded-lg transition-colors"
              >
                Full Restart
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
