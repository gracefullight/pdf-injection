import { Component, type ErrorInfo, type ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export interface ErrorBoundaryProps {
  /** Short, user-facing name for the section this boundary guards (e.g. "this tab"). Used in the fallback copy. */
  label?: string;
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Catches render-time exceptions in its subtree and shows a friendly fallback
 * instead of letting React unmount the whole app to a blank white page.
 *
 * Fixes CRITICAL C-01 from the r11 UX review: a raw `Date` object rendered as
 * a React child (or any other render-time throw) previously had no boundary
 * anywhere in the tree, so a single bad row could destroy all in-progress
 * wizard state with zero on-screen feedback. Used both at the app root
 * (`main.tsx`) and around each validation tab panel (`validation-screen.tsx`)
 * so a failure in one tab doesn't take down the whole screen.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surfaced to the console for local debugging; no telemetry in this PoC.
    console.error("[ErrorBoundary]", this.props.label ?? "app", error, info.componentStack);
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  private handleReset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    if (this.state.error) {
      const label = this.props.label ?? "this section";
      return (
        <Alert variant="destructive" data-testid="error-boundary-fallback">
          <AlertTitle>Something went wrong</AlertTitle>
          <AlertDescription className="flex flex-col gap-3">
            <span>
              An unexpected error occurred while rendering {label}. Your data on the server is
              unaffected. Reloading the page usually resolves this.
            </span>
            <span className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={this.handleReset}
                data-testid="error-boundary-retry"
              >
                Try again
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={this.handleReload}
                data-testid="error-boundary-reload"
              >
                Reload
              </Button>
            </span>
          </AlertDescription>
        </Alert>
      );
    }
    return this.props.children;
  }
}
