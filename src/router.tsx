import { createBrowserRouter } from 'react-router-dom';
import { lazy } from 'react';
import RootLayout from '@/components/layouts/RootLayout';
import { SuspenseWrapper } from '@/components/SuspenseWrapper';

// Remove trailing slash for React Router's basename format
const basename = import.meta.env.BASE_URL.replace(/\/+$/, '') || '/';

// Lazy-loaded views
const Dashboard = lazy(() => import('@/views/Dashboard/Dashboard'));
const SessionList = lazy(() => import('@/views/Sessions/SessionList'));
const SessionDetail = lazy(() => import('@/views/Sessions/SessionDetail'));
const SignalViewer = lazy(() => import('@/views/Sessions/SignalViewer'));
const SessionComparison = lazy(() => import('@/views/Sessions/SessionComparison'));
const AnalysisHub = lazy(() => import('@/views/Analysis/AnalysisHub'));
const StatisticalAnalysis = lazy(() => import('@/views/Analysis/StatisticalAnalysis'));
const EventAnalysis = lazy(() => import('@/views/Analysis/EventAnalysis'));
const PressureOptimization = lazy(() => import('@/views/Analysis/PressureOptimization'));
const IntegrationAnalysis = lazy(() => import('@/views/Analysis/IntegrationAnalysis'));
const Reports = lazy(() => import('@/views/Reports/Reports'));
const DataManagement = lazy(() => import('@/views/DataManagement/DataManagement'));
const ImportWizard = lazy(() => import('@/views/DataManagement/ImportWizard'));
const Settings = lazy(() => import('@/views/Settings/Settings'));
const HelpHome = lazy(() => import('@/views/Help/HelpHome'));
const HelpArticle = lazy(() => import('@/views/Help/HelpArticle'));

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
          path: 'analysis',
          children: [
            {
              index: true,
              element: (
                <SuspenseWrapper>
                  <AnalysisHub />
                </SuspenseWrapper>
              ),
            },
            {
              path: 'statistical',
              element: (
                <SuspenseWrapper>
                  <StatisticalAnalysis />
                </SuspenseWrapper>
              ),
            },
            {
              path: 'events',
              element: (
                <SuspenseWrapper>
                  <EventAnalysis />
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
              path: 'integrations',
              element: (
                <SuspenseWrapper>
                  <IntegrationAnalysis />
                </SuspenseWrapper>
              ),
            },
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
