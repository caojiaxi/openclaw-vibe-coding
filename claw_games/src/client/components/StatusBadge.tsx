import React from 'react';
import type { MatchStatus } from '../types';

interface StatusBadgeProps {
  status: MatchStatus;
}

const statusConfig: Record<MatchStatus, { label: string; className: string }> = {
  in_progress: {
    label: 'Live',
    className: 'bg-claw-green/20 text-claw-green border-claw-green/30',
  },
  completed: {
    label: 'Completed',
    className: 'bg-claw-accent/20 text-claw-accent-light border-claw-accent/30',
  },
  aborted: {
    label: 'Aborted',
    className: 'bg-claw-red/20 text-claw-red border-claw-red/30',
  },
};

export function StatusBadge({ status }: StatusBadgeProps): React.JSX.Element {
  const config = statusConfig[status];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${config.className}`}
    >
      {status === 'in_progress' && (
        <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-claw-green" />
      )}
      {config.label}
    </span>
  );
}
