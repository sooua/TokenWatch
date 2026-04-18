import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { Alert, AlertDescription, AlertTitle } from './ui/alert';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
  errorInfo?: ErrorInfo;
}

interface ErrorBoundaryProps {
  children: ReactNode;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Error caught by boundary:', error, errorInfo);
    this.setState({ error, errorInfo });
  }

  handleReset = () => {
    this.setState({ hasError: false, error: undefined, errorInfo: undefined });
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="h-screen w-full flex items-center justify-center p-6"
          style={{ background: 'var(--parchment)' }}
        >
          <Card className="bg-[var(--ivory)] border-[var(--cream)] max-w-lg w-full">
            <CardContent className="text-center stagger-children p-6">
              {/* Error Icon */}
              <div className="text-6xl mb-6 floating">💥</div>

              {/* Error Title */}
              <h2 className="text-2xl font-bold mb-4" style={{ color: 'var(--claude-black)' }}>
                Something went wrong
              </h2>

              {/* Error Description */}
              <p
                className="text-base mb-6 leading-relaxed"
                style={{ color: 'var(--claude-olive)' }}
              >
                An unexpected error occurred in the application. This might be a temporary issue.
              </p>

              {/* Error Details (in development) */}
              {process.env.NODE_ENV === 'development' && this.state.error && (
                <Alert variant="destructive" className="mb-6 text-left">
                  <AlertTitle className="font-mono text-sm">
                    {this.state.error.name}: {this.state.error.message}
                  </AlertTitle>
                  {this.state.errorInfo?.componentStack && (
                    <AlertDescription className="font-mono text-xs max-h-32 overflow-y-auto mt-2">
                      {this.state.errorInfo.componentStack}
                    </AlertDescription>
                  )}
                </Alert>
              )}

              {/* Action Buttons */}
              <div className="space-y-3">
                <Button
                  type="button"
                  onClick={this.handleReset}
                  className="w-full transition-all duration-200"
                  style={{ background: 'var(--terracotta)', color: 'var(--ivory)' }}
                >
                  Try Again
                </Button>
                <Button
                  type="button"
                  onClick={this.handleReload}
                  variant="outline"
                  className="w-full transition-all duration-200"
                  style={{
                    background: 'var(--sand)',
                    borderColor: 'var(--cream)',
                    color: 'var(--claude-black)',
                  }}
                >
                  Reload Application
                </Button>
              </div>

              {/* Help Text */}
              <div className="mt-6 text-sm space-y-2" style={{ color: 'var(--claude-stone)' }}>
                <p>If this problem persists:</p>
                <div className="flex flex-col space-y-1 text-xs">
                  <span>• Try restarting the application</span>
                  <span>• Check your Claude Code configuration</span>
                  <span>• Contact support if needed</span>
                </div>
              </div>

              {/* Debug Info */}
              {process.env.NODE_ENV === 'development' && (
                <div className="mt-6 pt-4 border-t" style={{ borderColor: 'var(--cream)' }}>
                  <details className="text-left">
                    <summary
                      className="text-xs cursor-pointer"
                      style={{ color: 'var(--claude-stone)' }}
                    >
                      Show Debug Information
                    </summary>
                    <div
                      className="mt-2 p-3 rounded text-xs font-mono max-h-40 overflow-auto"
                      style={{
                        background: 'var(--sand)',
                        color: 'var(--claude-olive)',
                      }}
                    >
                      <div>User Agent: {navigator.userAgent}</div>
                      <div>Timestamp: {new Date().toISOString()}</div>
                      <div>URL: {window.location.href}</div>
                      {this.state.error?.stack && (
                        <div className="mt-2 whitespace-pre-wrap">
                          Stack: {this.state.error.stack}
                        </div>
                      )}
                    </div>
                  </details>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}
