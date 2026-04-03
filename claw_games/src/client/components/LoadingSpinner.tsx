import React from 'react';

export function LoadingSpinner(): React.JSX.Element {
  return (
    <div className="flex items-center justify-center py-20" role="status" aria-label="Loading">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-claw-700 border-t-claw-accent" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}

interface ErrorMessageProps {
  message: string;
  onRetry?: () => void;
}

export function ErrorMessage({ message, onRetry }: ErrorMessageProps): React.JSX.Element {
  return (
    <div className="flex flex-col items-center gap-4 rounded-xl border border-claw-red/30 bg-claw-red/10 px-6 py-10 text-center">
      <p className="text-lg font-semibold text-claw-red">Something went wrong</p>
      <p className="text-sm text-gray-400">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="rounded-lg bg-claw-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-claw-accent-light"
        >
          Try Again
        </button>
      )}
    </div>
  );
}
