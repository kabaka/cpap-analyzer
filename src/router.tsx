import { createBrowserRouter, Navigate } from 'react-router-dom';
import { lazy } from 'react';
import RootLayout from '@/components/layouts/RootLayout';
import { SuspenseWrapper } from '@/components/SuspenseWrapper';

// Remove trailing slash for React Router's basename format
const basename = import.meta.env.BASE_URL.replace(/\/+$/, '') || '/';

// Lazy-loaded views
const Dashboard = lazy(() => import('@/views/Dashboard/Dashboard'));
const SessionList = lazy(() => import('@/views/Sessions/SessionList'));
const SessionDetail = lazy(() => import('@/views/Sessions/SessionDetail'));
// Keyed wrapper around SignalViewer — forces a remount per `:sessionId` so
// per-session state does not leak between sessions. See KeyedSignalViewer.
const SignalViewer = lazy(() => import('@/views/Sessions/KeyedSignalViewer'));
const SessionComparison = lazy(() => import('@/views/Sessions/SessionComparison'));
const Trends = lazy(() => import('@/views/Trends/Trends'));
const ExploreHub = lazy(() => import('@/views/Explore/ExploreHub'));
const Correlations = lazy(() => import('@/views/Explore/Correlations'));
const EventExplorer = lazy(() => import('@/views/Explore/EventExplorer/EventExplorer'));
const PressureOptimization = lazy(() => import('@/views/Explore/PressureOptimization'));
const Breathing = lazy(() => import('@/views/Explore/Breathing/Breathing'));
const Configurations = lazy(() => import('@/views/Explore/Configurations/Configurations'));
const Reports = lazy(() => import('@/views/Reports/Reports'));
const DataManagement = lazy(() => import('@/views/DataManagement/DataManagement'));
const ImportWizard = lazy(() => import('@/views/DataManagement/ImportWizard'));
const Settings = lazy(() => import('@/views/Settings/Settings'));
const HelpHome = lazy(() => import('@/views/Help/HelpHome'));
const HelpArticle = lazy(() => import('@/views/Help/HelpArticle'));
const KeyboardShortcutsPage = lazy(() => import('@/views/Help/KeyboardShortcutsPage'));

export const router = createBrowserRouter(
  [
    {
      path: '/',
      element: <RootLayout />,
      children: [
        {
          index: true,
          element: (
            <SuspenseWrapper>
              <Dashboard />
            </SuspenseWrapper>
          ),
        },
        {
          path: 'sessions',
          children: [
            {
              index: true,
              element: (
                <SuspenseWrapper>
                  <SessionList />
                </SuspenseWrapper>
              ),
            },
            {
              path: ':sessionId',
              element: (
                <SuspenseWrapper>
                  <SessionDetail />
                </SuspenseWrapper>
              ),
              children: [
                {
                  path: 'signals',
                  element: (
                    <SuspenseWrapper>
                      <SignalViewer />
                    </SuspenseWrapper>
                  ),
                },
              ],
            },
            {
              path: 'compare',
              element: (
                <SuspenseWrapper>
                  <SessionComparison />
                </SuspenseWrapper>
              ),
            },
          ],
        },
        {
          path: 'trends',
          element: (
            <SuspenseWrapper>
              <Trends />
            </SuspenseWrapper>
          ),
        },
        {
          path: 'explore',
          children: [
            {
              index: true,
              element: (
                <SuspenseWrapper>
                  <ExploreHub />
                </SuspenseWrapper>
              ),
            },
            {
              path: 'events',
              element: (
                <SuspenseWrapper>
                  <EventExplorer />
                </SuspenseWrapper>
              ),
            },
            {
              path: 'correlations',
              element: (
                <SuspenseWrapper>
                  <Correlations />
                </SuspenseWrapper>
              ),
            },
            {
              path: 'pressure',
              element: (
                <SuspenseWrapper>
                  <PressureOptimization />
                </SuspenseWrapper>
              ),
            },
            {
              path: 'breathing',
              element: (
                <SuspenseWrapper>
                  <Breathing />
                </SuspenseWrapper>
              ),
            },
            {
              path: 'configs',
              element: (
                <SuspenseWrapper>
                  <Configurations />
                </SuspenseWrapper>
              ),
            },
          ],
        },
        // Legacy redirects: the old "Analysis" routes were reorganized into the
        // "Explore" hub. Preserve existing bookmarks and deep links. `replace`
        // avoids polluting browser history with the deprecated path.
        {
          path: 'analysis',
          children: [
            { index: true, element: <Navigate to="/explore" replace /> },
            { path: 'statistical', element: <Navigate to="/explore/correlations" replace /> },
            {
              path: 'integrations',
              element: <Navigate to="/explore/correlations?tab=cross-source" replace />,
            },
            { path: 'events', element: <Navigate to="/explore/events" replace /> },
            { path: 'pressure', element: <Navigate to="/explore/pressure" replace /> },
          ],
        },
        {
          path: 'reports',
          element: (
            <SuspenseWrapper>
              <Reports />
            </SuspenseWrapper>
          ),
        },
        {
          path: 'data',
          children: [
            {
              index: true,
              element: (
                <SuspenseWrapper>
                  <DataManagement />
                </SuspenseWrapper>
              ),
            },
            {
              path: 'import',
              element: (
                <SuspenseWrapper>
                  <ImportWizard />
                </SuspenseWrapper>
              ),
            },
          ],
        },
        {
          path: 'settings',
          element: (
            <SuspenseWrapper>
              <Settings />
            </SuspenseWrapper>
          ),
        },
        {
          path: 'help',
          children: [
            {
              index: true,
              element: (
                <SuspenseWrapper>
                  <HelpHome />
                </SuspenseWrapper>
              ),
            },
            {
              path: 'keyboard-shortcuts',
              element: (
                <SuspenseWrapper>
                  <KeyboardShortcutsPage />
                </SuspenseWrapper>
              ),
            },
            {
              path: ':topic',
              element: (
                <SuspenseWrapper>
                  <HelpArticle />
                </SuspenseWrapper>
              ),
            },
          ],
        },
      ],
    },
  ],
  { basename },
);
