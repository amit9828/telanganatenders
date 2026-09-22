'use client';

import WinningBidsBoard from '@/components/workflow/WinningBidsBoard';
import { CLIENT_TRACKING_ORDER, clientTrackingStage } from '@/lib/tracking-status';

export default function ClientWinningBoard({ jobs = [] }) {
  return (
    <WinningBidsBoard
      jobs={jobs}
      showClientName={false}
      barStages={CLIENT_TRACKING_ORDER}
      activeLabelFor={clientTrackingStage}
    />
  );
}