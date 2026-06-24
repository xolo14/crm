import React from "react";

type AppErrorBoundaryState = {
  hasError: boolean;
  errorMessage: string;
};

export class AppErrorBoundary extends React.Component<React.PropsWithChildren, AppErrorBoundaryState> {
  constructor(props: React.PropsWithChildren) {
    super(props);
    this.state = { hasError: false, errorMessage: "" };
  }

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error?.message || "Unknown error",
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("Unhandled app error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen w-full bg-background text-foreground flex items-center justify-center px-6">
          <div className="max-w-2xl rounded-xl border border-border bg-card p-6 shadow-sm">
            <h1 className="text-xl font-semibold">Application failed to load</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              A runtime error occurred while rendering the app. Reload the page. If this continues, share the error below.
            </p>
            <pre className="mt-4 max-h-72 overflow-auto rounded-md bg-muted p-3 text-xs">
              {this.state.errorMessage}
            </pre>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
