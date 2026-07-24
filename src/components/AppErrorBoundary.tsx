import React from "react";
import { isChunkLoadError } from "@/lib/lazyWithRetry";

type AppErrorBoundaryState = {
  hasError: boolean;
  errorMessage: string;
  isChunkError: boolean;
  reloading: boolean;
};

const CHUNK_RELOAD_KEY = "crm_chunk_reload_v1";

export class AppErrorBoundary extends React.Component<React.PropsWithChildren, AppErrorBoundaryState> {
  constructor(props: React.PropsWithChildren) {
    super(props);
    this.state = { hasError: false, errorMessage: "", isChunkError: false, reloading: false };
  }

  static getDerivedStateFromError(error: Error): Partial<AppErrorBoundaryState> {
    return {
      hasError: true,
      errorMessage: error?.message || "Unknown error",
      isChunkError: isChunkLoadError(error),
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("Unhandled app error:", error, errorInfo);
    if (!isChunkLoadError(error)) return;
    try {
      const already = sessionStorage.getItem(CHUNK_RELOAD_KEY);
      if (!already) {
        sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
        this.setState({ reloading: true });
        window.setTimeout(() => window.location.reload(), 150);
      }
    } catch {
      window.location.reload();
    }
  }

  private handleReload = () => {
    try {
      sessionStorage.removeItem(CHUNK_RELOAD_KEY);
    } catch {
      /* ignore */
    }
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    if (this.state.reloading) {
      return (
        <div className="min-h-screen w-full bg-background text-foreground flex items-center justify-center px-6">
          <div className="max-w-md rounded-xl border border-border bg-card p-6 shadow-sm text-center">
            <h1 className="text-lg font-semibold">Updating app…</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              A new version was deployed. Reloading to load the latest pages.
            </p>
          </div>
        </div>
      );
    }

    return (
      <div className="min-h-screen w-full bg-background text-foreground flex items-center justify-center px-6">
        <div className="max-w-2xl rounded-xl border border-border bg-card p-6 shadow-sm">
          <h1 className="text-xl font-semibold">
            {this.state.isChunkError ? "Page failed to load" : "Application failed to load"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {this.state.isChunkError
              ? "This usually happens after an update. Reload to fetch the latest version of this page."
              : "A runtime error occurred while rendering the app. Reload the page. If this continues, share the error below."}
          </p>
          <button
            type="button"
            onClick={this.handleReload}
            className="mt-4 inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Reload page
          </button>
          <pre className="mt-4 max-h-72 overflow-auto rounded-md bg-muted p-3 text-xs">
            {this.state.errorMessage}
          </pre>
        </div>
      </div>
    );
  }
}
