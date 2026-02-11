import { Suspense, type ReactNode } from 'react';

function LoadingFallback() {
  return <div className="loading">Loading…</div>;
}

export function SuspenseWrapper({ children }: { children: ReactNode }) {
  return <Suspense fallback={<LoadingFallback />}>{children}</Suspense>;
}
