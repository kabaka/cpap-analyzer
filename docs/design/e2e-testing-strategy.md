# E2E Testing Strategy — CPAP Analyzer

**Version**: 1.0  
**Last Updated**: February 10, 2026  
**Status**: Design Document  
**Audience**: E2E Tester, QA, Frontend, DevOps agents

## Executive Summary

This document defines the comprehensive end-to-end testing strategy for CPAP Analyzer. E2E tests validate complete user journeys through the browser, ensuring that all components—UI, data processing, storage, visualization—work correctly when integrated. The strategy prioritizes **real user scenarios**, **accessibility compliance**, **performance under load**, and **visual regression detection** while maintaining a **fast, reliable, parallelizable** test suite.

### Key Architectural Decisions

- **Testing Framework**: Playwright with TypeScript
- **Browser Matrix**: Chromium (primary), Firefox, WebKit
- **Test Organization**: Page Object Model (POM) with test fixtures
- **Selector Strategy**: Accessible selectors (`getByRole`, `getByLabel`) + `data-testid` for complex components
- **Test Data**: Version-controlled sample EDF files + synthetic data generators
- **CI Integration**: GitHub Actions with artifact collection and retry strategies
- **Visual Regression**: Screenshot comparison with baseline management
- **Performance Testing**: Timing assertions and memory leak detection

---

## 1. Testing Framework

### 1.1 Playwright Configuration

**File**: `playwright.config.ts`

```typescript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  
  // Test execution
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  
  // Reporting
  reporter: [
    ['html'],
    ['json', { outputFile: 'test-results/results.json' }],
    ['junit', { outputFile: 'test-results/junit.xml' }],
    process.env.CI ? ['github'] : ['list'],
  ],
  
  // Shared settings
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    
    // Permissions for file system access
    permissions: ['clipboard-read', 'clipboard-write'],
    
    // Longer timeout for large dataset operations
    actionTimeout: 10000,
    navigationTimeout: 30000,
  },

  // Projects (browser matrix)
  projects: [
    // Primary: Chromium (Chrome, Edge, Opera)
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    
    // Secondary: Firefox
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    
    // Secondary: WebKit (Safari)
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
    
    // Accessibility: Screen reader simulation
    {
      name: 'chromium-screen-reader',
      use: {
        ...devices['Desktop Chrome'],
        // Force prefers-reduced-motion for accessibility testing
        reducedMotion: 'reduce',
      },
    },
    
    // Mobile viewport (future)
    // {
    //   name: 'mobile-chrome',
    //   use: { ...devices['Pixel 5'] },
    // },
  ],

  // Dev server
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
```

**Key Configuration Choices**:

- **Parallel Execution**: `fullyParallel: true` enables maximum speed
- **Retries**: 2 retries in CI to handle flakiness (network, timing)
- **Workers**: 1 worker in CI to avoid resource contention; unlimited locally for speed
- **Trace Retention**: Capture traces/videos only on failure to save storage
- **Multiple Reporters**: HTML for local viewing, JUnit for CI integration, GitHub for inline PR comments

### 1.2 Browser Matrix Strategy

**Primary Browser**: Chromium
- Most users (Chrome, Edge, Opera, Brave)
- Run all tests on Chromium
- Must pass for merge

**Secondary Browsers**: Firefox, WebKit
- Run critical path tests only (import, dashboard, session detail)
- Failures are warnings, not blockers (investigate but don't block merge)
- Full test suite runs nightly on all browsers

**Browser-Specific Tests**:
- IndexedDB quota handling (varies by browser)
- File system access (Chrome's File System Access API vs Firefox's legacy approach)
- Canvas rendering performance differences

**Why Not Test Mobile Browsers?**
- CPAP Analyzer is data-intensive; mobile is not primary use case
- Defer mobile testing until Phase 2 (if mobile responsiveness is implemented)
- Focus resources on desktop browser quality

### 1.3 Parallel Execution Strategy

**Test Independence**:
- Each test must be fully isolated (no shared state)
- Use isolated browser contexts (Playwright default)
- Use unique test data per test (namespaced by test name)

**Storage Isolation**:
```typescript
test.beforeEach(async ({ page, context }) => {
  // Clear IndexedDB before each test
  await context.addInitScript(() => {
    indexedDB.databases().then((dbs) => {
      dbs.forEach((db) => {
        if (db.name?.startsWith('cpap-analyzer')) {
          indexedDB.deleteDatabase(db.name);
        }
      });
    });
  });
  
  // Clear localStorage
  await context.addInitScript(() => {
    localStorage.clear();
  });
});
```

**Parallelization Limits**:
- Local: Unlimited workers (developer machine)
- CI: 1 worker (GitHub Actions runner has limited CPU)
- Rationale: Large dataset tests are CPU-intensive; parallel execution causes timeouts

---

## 2. Test Organization

### 2.1 Test File Structure

```
tests/
├── e2e/                          # E2E tests
│   ├── critical-path/            # Must pass for release
│   │   ├── first-launch.spec.ts
│   │   ├── import-data.spec.ts
│   │   ├── dashboard.spec.ts
│   │   ├── session-detail.spec.ts
│   │   └── report-export.spec.ts
│   │
│   ├── analysis/                 # Advanced analysis tools
│   │   ├── statistical-analysis.spec.ts
│   │   ├── event-analysis.spec.ts
│   │   └── pressure-optimization.spec.ts
│   │
│   ├── visualization/            # Chart interactions
│   │   ├── time-series-charts.spec.ts
│   │   ├── chart-interactions.spec.ts
│   │   └── chart-export.spec.ts
│   │
│   ├── accessibility/            # WCAG AA compliance
│   │   ├── keyboard-navigation.spec.ts
│   │   ├── screen-reader.spec.ts
│   │   └── color-contrast.spec.ts
│   │
│   ├── performance/              # Performance benchmarks
│   │   ├── large-dataset-import.spec.ts
│   │   ├── chart-rendering.spec.ts
│   │   └── memory-leaks.spec.ts
│   │
│   └── edge-cases/               # Error handling and boundaries
│       ├── malformed-data.spec.ts
│       ├── storage-limits.spec.ts
│       └── network-errors.spec.ts
│
├── fixtures/                     # Test data
│   ├── edf/                      # Sample EDF files
│   │   ├── single-session.edf    # Minimal valid file
│   │   ├── multi-session.edf     # Multiple nights
│   │   ├── large-dataset.edf     # 3 months of data
│   │   ├── malformed-header.edf  # Invalid header
│   │   └── corrupted-data.edf    # Data integrity issues
│   │
│   ├── screenshots/              # Visual regression baselines
│   │   ├── dashboard-light.png
│   │   ├── dashboard-dark.png
│   │   └── session-detail.png
│   │
│   └── expected-outputs/         # Expected analysis results
│       ├── ahi-calculation.json
│       └── event-clustering.json
│
└── support/                      # Test utilities
    ├── pages/                    # Page Object Model
    │   ├── BasePage.ts
    │   ├── DashboardPage.ts
    │   ├── ImportWizardPage.ts
    │   ├── SessionDetailPage.ts
    │   ├── AnalysisPage.ts
    │   └── SettingsPage.ts
    │
    ├── fixtures/                 # Playwright fixtures
    │   ├── testData.ts           # Data generators
    │   ├── mockStorage.ts        # Storage mocks
    │   └── performance.ts        # Performance measurement utilities
    │
    └── helpers/                  # Utility functions
        ├── edf-generator.ts      # Synthetic EDF file generator
        ├── storage-helpers.ts    # IndexedDB utilities
        ├── accessibility.ts      # ARIA validation helpers
        └── performance.ts        # Timing and memory helpers
```

**Naming Conventions**:
- Test files: `{feature}.spec.ts`
- Page objects: `{PageName}Page.ts`
- Fixtures: `{purpose}.ts`
- Test suites: `describe('{Feature}', ...)`
- Tests: `test('should {action} when {condition}', ...)`

### 2.2 Page Object Model (POM)

**Architecture**: Encapsulate page interactions in reusable classes to reduce duplication and improve maintainability.

**Base Page Class**:

```typescript
// tests/support/pages/BasePage.ts
import { Page, Locator } from '@playwright/test';

export abstract class BasePage {
  constructor(protected page: Page) {}

  // Common navigation
  async goto(path: string) {
    await this.page.goto(path);
    await this.waitForLoad();
  }

  abstract waitForLoad(): Promise<void>;

  // Common interactions
  async clickByRole(role: string, name: string) {
    await this.page.getByRole(role, { name }).click();
  }

  async fillByLabel(label: string, value: string) {
    await this.page.getByLabel(label).fill(value);
  }

  // Accessibility helpers
  async getByAccessibleName(name: string): Promise<Locator> {
    return this.page.getByRole('region', { name });
  }

  // Theme utilities
  async toggleTheme() {
    await this.page.getByRole('button', { name: /theme/i }).click();
  }

  // Wait helpers
  async waitForLoadingComplete() {
    await this.page.waitForSelector('[data-testid="loading-spinner"]', {
      state: 'hidden',
      timeout: 30000,
    });
  }

  // Error handling
  async assertNoErrors() {
    const errors = await this.page.locator('[role="alert"][data-severity="error"]').count();
    expect(errors).toBe(0);
  }
}
```

**Dashboard Page Object**:

```typescript
// tests/support/pages/DashboardPage.ts
import { expect } from '@playwright/test';
import { BasePage } from './BasePage';

export class DashboardPage extends BasePage {
  // Locators
  get dateRangeSelector() {
    return this.page.getByTestId('date-range-selector');
  }

  get summaryCards() {
    return this.page.getByTestId('summary-card');
  }

  get sessionTable() {
    return this.page.getByRole('table', { name: 'Session List' });
  }

  // Navigation
  async goto() {
    await super.goto('/');
  }

  async waitForLoad() {
    await expect(this.page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await this.waitForLoadingComplete();
  }

  // Interactions
  async selectDateRange(preset: string) {
    await this.dateRangeSelector.click();
    await this.page.getByRole('menuitem', { name: preset }).click();
    await this.waitForLoadingComplete();
  }

  async openSession(date: string) {
    await this.sessionTable
      .getByRole('row', { name: new RegExp(date) })
      .click();
  }

  async getSummaryCardValue(metric: string): Promise<string> {
    const card = this.summaryCards.filter({ hasText: metric });
    const valueElement = card.getByTestId('metric-value');
    return await valueElement.textContent() || '';
  }

  // Assertions
  async assertMetricValue(metric: string, expectedValue: string) {
    const actualValue = await this.getSummaryCardValue(metric);
    expect(actualValue).toContain(expectedValue);
  }

  async assertSessionCount(count: number) {
    const rows = await this.sessionTable.getByRole('row').count();
    expect(rows - 1).toBe(count); // Subtract header row
  }
}
```

**Import Wizard Page Object**:

```typescript
// tests/support/pages/ImportWizardPage.ts
import { expect } from '@playwright/test';
import { BasePage } from './BasePage';

export class ImportWizardPage extends BasePage {
  async goto() {
    await super.goto('/import');
  }

  async waitForLoad() {
    await expect(this.page.getByRole('heading', { name: /import/i })).toBeVisible();
  }

  async uploadFile(filePath: string) {
    const fileInput = this.page.getByTestId('file-input');
    await fileInput.setInputFiles(filePath);
  }

  async waitForImportComplete(timeout = 60000) {
    await expect(
      this.page.getByRole('heading', { name: /import complete/i })
    ).toBeVisible({ timeout });
  }

  async getImportProgress(): Promise<{ current: number; total: number }> {
    const progressText = await this.page.getByTestId('import-progress').textContent();
    const match = progressText?.match(/(\d+)\/(\d+)/);
    
    if (!match) throw new Error('Could not parse progress');
    
    return {
      current: parseInt(match[1]),
      total: parseInt(match[2]),
    };
  }

  async assertImportSuccess(sessionCount: number) {
    await this.waitForImportComplete();
    const successText = await this.page.getByTestId('import-summary').textContent();
    expect(successText).toContain(`${sessionCount} sessions imported`);
  }

  async assertImportWarnings(warningCount: number) {
    const warnings = await this.page.getByTestId('import-warning').count();
    expect(warnings).toBe(warningCount);
  }
}
```

**Session Detail Page Object**:

```typescript
// tests/support/pages/SessionDetailPage.ts
import { expect } from '@playwright/test';
import { BasePage } from './BasePage';

export class SessionDetailPage extends BasePage {
  async goto(sessionId: string) {
    await super.goto(`/sessions/${sessionId}`);
  }

  async waitForLoad() {
    await expect(this.page.getByRole('heading', { name: /session detail/i })).toBeVisible();
    await this.waitForLoadingComplete();
  }

  async openSignalViewer() {
    await this.page.getByRole('button', { name: /view signal data/i }).click();
    await expect(this.page.getByTestId('signal-viewer')).toBeVisible();
  }

  async getSessionMetric(metric: string): Promise<string> {
    const row = this.page.getByRole('row', { name: new RegExp(metric) });
    const value = row.getByRole('cell').nth(1);
    return await value.textContent() || '';
  }

  async assertEventCount(eventType: string, count: number) {
    const eventMarkers = await this.page
      .getByTestId('event-marker')
      .filter({ hasText: eventType })
      .count();
    
    expect(eventMarkers).toBe(count);
  }

  async hoverEventMarker(index: number) {
    await this.page.getByTestId('event-marker').nth(index).hover();
    await expect(this.page.getByRole('tooltip')).toBeVisible();
  }
}
```

**Analysis Page Object**:

```typescript
// tests/support/pages/AnalysisPage.ts
import { expect } from '@playwright/test';
import { BasePage } from './BasePage';

export class AnalysisPage extends BasePage {
  async goto(analysisType?: string) {
    const path = analysisType ? `/analysis/${analysisType}` : '/analysis';
    await super.goto(path);
  }

  async waitForLoad() {
    await expect(this.page.getByRole('heading', { name: /analysis/i })).toBeVisible();
  }

  async selectAnalysisMethod(category: string, method: string) {
    await this.page.getByRole('tab', { name: category }).click();
    await this.page.getByRole('button', { name: method }).click();
    await this.waitForLoadingComplete();
  }

  async configureParameter(paramName: string, value: string) {
    await this.page.getByLabel(paramName).fill(value);
  }

  async runAnalysis() {
    await this.page.getByRole('button', { name: /run analysis/i }).click();
    await this.waitForLoadingComplete();
  }

  async assertResultsDisplayed() {
    await expect(this.page.getByTestId('analysis-results')).toBeVisible();
  }

  async exportResults(format: 'csv' | 'json' | 'pdf') {
    await this.page.getByRole('button', { name: /export/i }).click();
    await this.page.getByRole('menuitem', { name: format.toUpperCase() }).click();
    
    // Wait for download
    const download = await this.page.waitForEvent('download');
    expect(download.suggestedFilename()).toMatch(new RegExp(`\\.${format}$`));
  }
}
```

### 2.3 Test Data Management

**Strategy**: Version-controlled fixtures + synthetic data generators

**Sample EDF Files** (`tests/fixtures/edf/`):

| File | Purpose | Size | Sessions | Notes |
|------|---------|------|----------|-------|
| `minimal-valid.edf` | Smoke tests | 50 KB | 1 | Single night, no events |
| `typical-session.edf` | Standard scenarios | 2 MB | 1 | Realistic AHI, events, leak |
| `multi-session.edf` | Date range tests | 10 MB | 7 | One week of data |
| `large-dataset.edf` | Performance tests | 100 MB | 90 | 3 months, stress test |
| `malformed-header.edf` | Error handling | 1 KB | 0 | Invalid EDF header |
| `corrupted-data.edf` | Validation tests | 500 KB | 1 | Valid header, corrupted signals |
| `zero-events.edf` | Edge case | 1 MB | 1 | Perfect compliance, no apneas |
| `high-ahi.edf` | Edge case | 2 MB | 1 | Severe AHI (>30) |

**Synthetic Data Generator**:

```typescript
// tests/support/helpers/edf-generator.ts
export interface EDFGeneratorOptions {
  startDate: Date;
  durationHours: number;
  ahi: number; // Target AHI
  leakRate: number; // Mean leak (L/min)
  pressure: { min: number; max: number }; // cmH₂O range
  includeEvents?: boolean;
}

export async function generateSyntheticEDF(
  options: EDFGeneratorOptions
): Promise<Blob> {
  // Generate deterministic random data
  const seed = options.startDate.getTime();
  const rng = seededRandom(seed);
  
  // Calculate sample counts
  const sampleRate = 25; // Hz
  const recordDuration = 1; // second
  const totalRecords = options.durationHours * 3600;
  const samplesPerRecord = sampleRate * recordDuration;
  
  // Build EDF header
  const header = buildEDFHeader({
    startDate: options.startDate,
    recordCount: totalRecords,
    recordDuration,
    signals: [
      { label: 'Flow', unit: 'L/min', sampleRate },
      { label: 'MaskPressure', unit: 'cmH2O', sampleRate },
      { label: 'Leak', unit: 'L/min', sampleRate: 2 },
    ],
  });
  
  // Generate signal data
  const data = generateSignalData({
    duration: totalRecords,
    samplesPerRecord,
    ahi: options.ahi,
    leakRate: options.leakRate,
    pressure: options.pressure,
    rng,
  });
  
  // Add events if requested
  const events = options.includeEvents
    ? generateEvents(options.ahi, options.durationHours, rng)
    : [];
  
  // Encode to EDF format
  return encodeEDF(header, data, events);
}
```

**Test Data Versioning**:
- Fixtures committed to Git (except `large-dataset.edf` → Git LFS)
- Generate large files on-demand in CI
- Checksum validation to detect corruption

### 2.4 Fixture Patterns

**Custom Playwright Fixtures**:

```typescript
// tests/support/fixtures/testData.ts
import { test as base } from '@playwright/test';
import { DashboardPage } from '../pages/DashboardPage';
import { ImportWizardPage } from '../pages/ImportWizardPage';
import { SessionDetailPage } from '../pages/SessionDetailPage';
import { generateSyntheticEDF } from '../helpers/edf-generator';

interface TestFixtures {
  dashboardPage: DashboardPage;
  importWizardPage: ImportWizardPage;
  sessionDetailPage: SessionDetailPage;
  sampleEDFFile: string;
  importedData: void; // Side-effect fixture
}

export const test = base.extend<TestFixtures>({
  // Page object fixtures
  dashboardPage: async ({ page }, use) => {
    await use(new DashboardPage(page));
  },
  
  importWizardPage: async ({ page }, use) => {
    await use(new ImportWizardPage(page));
  },
  
  sessionDetailPage: async ({ page }, use) => {
    await use(new SessionDetailPage(page));
  },
  
  // Data fixtures
  sampleEDFFile: async ({}, use) => {
    const filePath = 'tests/fixtures/edf/typical-session.edf';
    await use(filePath);
  },
  
  // Pre-import data fixture
  importedData: async ({ page, sampleEDFFile }, use) => {
    // Navigate to import page
    await page.goto('/import');
    
    // Upload file
    await page.getByTestId('file-input').setInputFiles(sampleEDFFile);
    
    // Wait for import to complete
    await page.waitForSelector('[data-testid="import-complete"]', {
      timeout: 30000,
    });
    
    // Navigate to dashboard
    await page.goto('/');
    
    await use();
  },
});

export { expect } from '@playwright/test';
```

**Usage in Tests**:

```typescript
import { test, expect } from '../support/fixtures/testData';

test.describe('Dashboard', () => {
  test('should display summary metrics after import', async ({
    dashboardPage,
    importedData, // Auto-imports data before test
  }) => {
    await dashboardPage.goto();
    await dashboardPage.assertMetricValue('AHI', '4.2');
    await dashboardPage.assertSessionCount(1);
  });
});
```

---

## 3. User Flow Testing

### 3.1 Critical User Journeys

**Priority 1 (Must Pass for Release)**:

1. **First Launch & Data Import**
   - Welcome screen displays correctly
   - Import wizard accepts SD card folder
   - Progress bar updates accurately
   - Import completes successfully
   - Dashboard displays after import

2. **Dashboard Exploration**
   - Summary cards display correct metrics
   - Date range selector filters data
   - Session table sorts and filters
   - Clicking session navigates to detail

3. **Session Detail Viewing**
   - Session metadata displays correctly
   - Event timeline shows markers
   - Signal viewer renders waveforms
   - Zoom and pan interactions work

4. **Report Generation**
   - Report generator opens
   - Date range and content selection work
   - PDF export downloads
   - CSV export contains correct data

5. **Settings Persistence**
   - Theme changes persist across sessions
   - Analysis parameters save correctly
   - Date range persists on navigation

**Priority 2 (Important, Not Blocking)**:

6. Advanced statistical analysis
7. Event clustering analysis
8. Session comparison
9. Pressure optimization tools
10. Integration plugins

### 3.2 Import Flow Testing

**Test Suite**: `tests/e2e/critical-path/import-data.spec.ts`

```typescript
import { test, expect } from '../../support/fixtures/testData';

test.describe('Data Import', () => {
  test('should import single session successfully', async ({
    page,
    importWizardPage,
    dashboardPage,
  }) => {
    // Navigate to import page
    await importWizardPage.goto();
    
    // Upload file
    await importWizardPage.uploadFile('tests/fixtures/edf/typical-session.edf');
    
    // Wait for import completion
    await importWizardPage.assertImportSuccess(1);
    
    // Navigate to dashboard
    await page.getByRole('button', { name: /view dashboard/i }).click();
    
    // Verify data loaded
    await dashboardPage.assertMetricValue('AHI', '4.2');
    await dashboardPage.assertSessionCount(1);
  });

  test('should import multiple sessions', async ({ importWizardPage }) => {
    await importWizardPage.goto();
    await importWizardPage.uploadFile('tests/fixtures/edf/multi-session.edf');
    await importWizardPage.assertImportSuccess(7);
  });

  test('should display progress during import', async ({
    page,
    importWizardPage,
  }) => {
    await importWizardPage.goto();
    await importWizardPage.uploadFile('tests/fixtures/edf/large-dataset.edf');
    
    // Check progress updates
    await expect(page.getByTestId('import-progress')).toBeVisible();
    
    // Verify progress increases
    const progress1 = await importWizardPage.getImportProgress();
    await page.waitForTimeout(2000);
    const progress2 = await importWizardPage.getImportProgress();
    
    expect(progress2.current).toBeGreaterThan(progress1.current);
  });

  test('should handle malformed files gracefully', async ({
    page,
    importWizardPage,
  }) => {
    await importWizardPage.goto();
    await importWizardPage.uploadFile('tests/fixtures/edf/malformed-header.edf');
    
    // Should display error, not crash
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('alert')).toContainText(/invalid.*header/i);
  });

  test('should allow cancelling import', async ({ page, importWizardPage }) => {
    await importWizardPage.goto();
    await importWizardPage.uploadFile('tests/fixtures/edf/large-dataset.edf');
    
    // Click cancel during import
    await page.getByRole('button', { name: /cancel/i }).click();
    
    // Confirm cancellation dialog
    await page.getByRole('button', { name: /yes.*cancel/i }).click();
    
    // Should return to initial state
    await expect(page.getByRole('button', { name: /import/i })).toBeVisible();
  });

  test('should display warnings for corrupted files', async ({
    importWizardPage,
  }) => {
    await importWizardPage.goto();
    await importWizardPage.uploadFile('tests/fixtures/edf/corrupted-data.edf');
    
    await importWizardPage.assertImportWarnings(1);
  });

  test('should persist imported data after page reload', async ({
    page,
    importWizardPage,
    dashboardPage,
  }) => {
    // Import data
    await importWizardPage.goto();
    await importWizardPage.uploadFile('tests/fixtures/edf/typical-session.edf');
    await importWizardPage.assertImportSuccess(1);
    
    // Navigate to dashboard
    await page.goto('/');
    await dashboardPage.assertSessionCount(1);
    
    // Reload page
    await page.reload();
    
    // Data should still be present
    await dashboardPage.assertSessionCount(1);
  });
});
```

### 3.3 Analysis Workflow Testing

**Test Suite**: `tests/e2e/analysis/statistical-analysis.spec.ts`

```typescript
import { test, expect } from '../../support/fixtures/testData';

test.describe('Statistical Analysis', () => {
  test.use({ importedData: true }); // Auto-import before all tests

  test('should run time series analysis', async ({ page, analysisPage }) => {
    await analysisPage.goto('statistical');
    await analysisPage.selectAnalysisMethod('Time Series', 'Rolling Averages');
    
    // Configure parameters
    await analysisPage.configureParameter('Window Size (days)', '7');
    await analysisPage.configureParameter('Metric', 'AHI');
    
    // Run analysis
    await analysisPage.runAnalysis();
    
    // Results should display
    await analysisPage.assertResultsDisplayed();
    await expect(page.getByTestId('time-series-chart')).toBeVisible();
  });

  test('should run correlation analysis', async ({ page, analysisPage }) => {
    await analysisPage.goto('statistical');
    await analysisPage.selectAnalysisMethod('Correlation', 'Correlation Matrix');
    
    // Select metrics
    await page.getByLabel('Metrics').click();
    await page.getByRole('option', { name: 'AHI' }).click();
    await page.getByRole('option', { name: 'Leak Rate' }).click();
    await page.getByRole('option', { name: 'Usage Hours' }).click();
    
    await analysisPage.runAnalysis();
    
    // Correlation matrix should display
    await expect(page.getByTestId('correlation-matrix')).toBeVisible();
  });

  test('should export analysis results as CSV', async ({ analysisPage }) => {
    await analysisPage.goto('statistical');
    await analysisPage.selectAnalysisMethod('Descriptive Statistics', 'Summary Stats');
    await analysisPage.runAnalysis();
    
    await analysisPage.exportResults('csv');
  });

  test('should handle insufficient data gracefully', async ({
    page,
    analysisPage,
  }) => {
    await analysisPage.goto('statistical');
    await analysisPage.selectAnalysisMethod('Time Series', 'STL Decomposition');
    
    // STL requires at least 2 seasonal cycles (14 days with daily data)
    // With only 1 session, should show helpful error
    await analysisPage.runAnalysis();
    
    await expect(page.getByRole('alert')).toContainText(
      /insufficient data.*STL.*requires.*14.*days/i
    );
  });
});
```

### 3.4 Visualization Interaction Testing

**Test Suite**: `tests/e2e/visualization/chart-interactions.spec.ts`

```typescript
import { test, expect } from '../../support/fixtures/testData';

test.describe('Chart Interactions', () => {
  test.use({ importedData: true });

  test('should zoom chart with mouse wheel', async ({
    page,
    sessionDetailPage,
  }) => {
    await sessionDetailPage.goto('session-1');
    await sessionDetailPage.openSignalViewer();
    
    const chart = page.getByTestId('signal-chart');
    const boundingBox = await chart.boundingBox();
    
    if (!boundingBox) throw new Error('Chart not found');
    
    // Zoom in with mouse wheel
    await page.mouse.move(
      boundingBox.x + boundingBox.width / 2,
      boundingBox.y + boundingBox.height / 2
    );
    await page.mouse.wheel(0, -100);
    
    // Chart should update zoom level
    const zoomLevel = await page.getByTestId('zoom-level').textContent();
    expect(zoomLevel).not.toBe('100%');
  });

  test('should pan chart by dragging', async ({ page, sessionDetailPage }) => {
    await sessionDetailPage.goto('session-1');
    await sessionDetailPage.openSignalViewer();
    
    const chart = page.getByTestId('signal-chart');
    const boundingBox = await chart.boundingBox();
    
    if (!boundingBox) throw new Error('Chart not found');
    
    // Get initial viewport time
    const initialTime = await page.getByTestId('viewport-start').textContent();
    
    // Drag to pan
    await page.mouse.move(boundingBox.x + 100, boundingBox.y + 100);
    await page.mouse.down();
    await page.mouse.move(boundingBox.x + 300, boundingBox.y + 100);
    await page.mouse.up();
    
    // Viewport should have changed
    const newTime = await page.getByTestId('viewport-start').textContent();
    expect(newTime).not.toBe(initialTime);
  });

  test('should display tooltip on hover', async ({ page, sessionDetailPage }) => {
    await sessionDetailPage.goto('session-1');
    await sessionDetailPage.openSignalViewer();
    
    // Hover over chart
    const chart = page.getByTestId('signal-chart');
    await chart.hover();
    
    // Tooltip should appear
    await expect(page.getByRole('tooltip')).toBeVisible({ timeout: 1000 });
    
    // Tooltip should contain time and value
    const tooltipText = await page.getByRole('tooltip').textContent();
    expect(tooltipText).toMatch(/\d{2}:\d{2}/); // Time format
    expect(tooltipText).toMatch(/\d+\.\d+/); // Numeric value
  });

  test('should synchronize zoom across multiple charts', async ({
    page,
    sessionDetailPage,
  }) => {
    await sessionDetailPage.goto('session-1');
    await sessionDetailPage.openSignalViewer();
    
    // Enable multi-channel view
    await page.getByRole('button', { name: /channels/i }).click();
    await page.getByRole('checkbox', { name: 'Flow' }).check();
    await page.getByRole('checkbox', { name: 'Pressure' }).check();
    
    // Zoom on first chart
    const chart1 = page.getByTestId('signal-chart-flow');
    await chart1.hover();
    await page.mouse.wheel(0, -100);
    
    // Both charts should zoom together
    const zoom1 = await page.getByTestId('zoom-level-flow').textContent();
    const zoom2 = await page.getByTestId('zoom-level-pressure').textContent();
    
    expect(zoom1).toBe(zoom2);
  });

  test('should reset zoom with reset button', async ({
    page,
    sessionDetailPage,
  }) => {
    await sessionDetailPage.goto('session-1');
    await sessionDetailPage.openSignalViewer();
    
    // Zoom in
    const chart = page.getByTestId('signal-chart');
    await chart.hover();
    await page.mouse.wheel(0, -100);
    
    // Click reset
    await page.getByRole('button', { name: /reset.*zoom/i }).click();
    
    // Zoom should return to 100%
    await expect(page.getByTestId('zoom-level')).toHaveText('100%');
  });
});
```

### 3.5 Export Flow Testing

**Test Suite**: `tests/e2e/critical-path/report-export.spec.ts`

```typescript
import { test, expect } from '../../support/fixtures/testData';

test.describe('Report Export', () => {
  test.use({ importedData: true });

  test('should export report as PDF', async ({ page, dashboardPage }) => {
    await dashboardPage.goto();
    
    // Open reports
    await page.getByRole('link', { name: /reports/i }).click();
    
    // Select template
    await page.getByRole('button', { name: /physician summary/i }).click();
    
    // Configure date range
    await page.getByLabel('Date Range').selectOption('Last 30 Days');
    
    // Export
    await page.getByRole('button', { name: /export.*pdf/i }).click();
    
    // Wait for download
    const download = await page.waitForEvent('download');
    expect(download.suggestedFilename()).toMatch(/report.*\.pdf$/i);
  });

  test('should export data as CSV', async ({ page, dashboardPage }) => {
    await dashboardPage.goto();
    
    await page.getByRole('link', { name: /reports/i }).click();
    await page.getByRole('button', { name: /data export/i }).click();
    
    // Select metrics to export
    await page.getByLabel('Metrics').click();
    await page.getByRole('option', { name: 'AHI' }).click();
    await page.getByRole('option', { name: 'Usage Hours' }).click();
    
    await page.getByRole('button', { name: /export.*csv/i }).click();
    
    const download = await page.waitForEvent('download');
    const filename = download.suggestedFilename();
    expect(filename).toMatch(/\.csv$/i);
  });

  test('should include selected date range in export', async ({
    page,
    dashboardPage,
  }) => {
    await dashboardPage.goto();
    
    // Select custom date range
    await dashboardPage.selectDateRange('Last 7 Days');
    
    // Export
    await page.getByRole('link', { name: /reports/i }).click();
    await page.getByRole('button', { name: /physician summary/i }).click();
    await page.getByRole('button', { name: /export.*pdf/i }).click();
    
    // Download should complete
    const download = await page.waitForEvent('download');
    expect(download).toBeTruthy();
  });
});
```

### 3.6 Settings and Preferences Testing

**Test Suite**: `tests/e2e/critical-path/settings-persistence.spec.ts`

```typescript
import { test, expect } from '../../support/fixtures/testData';

test.describe('Settings Persistence', () => {
  test('should persist theme preference', async ({ page, dashboardPage }) => {
    await dashboardPage.goto();
    
    // Toggle to dark theme
    await dashboardPage.toggleTheme();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    
    // Reload page
    await page.reload();
    
    // Theme should persist
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('should persist date range selection', async ({
    page,
    dashboardPage,
    importedData,
  }) => {
    await dashboardPage.goto();
    await dashboardPage.selectDateRange('Last 7 Days');
    
    // Navigate away and back
    await page.getByRole('link', { name: /settings/i }).click();
    await page.getByRole('link', { name: /dashboard/i }).click();
    
    // Date range should persist
    const selectedRange = await page
      .getByTestId('date-range-selector')
      .textContent();
    expect(selectedRange).toContain('Last 7 Days');
  });

  test('should persist analysis parameters', async ({ page }) => {
    // Navigate to settings
    await page.goto('/settings');
    
    // Change AHI thresholds
    await page.getByLabel('Mild AHI Threshold').fill('5');
    await page.getByLabel('Moderate AHI Threshold').fill('15');
    await page.getByLabel('Severe AHI Threshold').fill('30');
    
    await page.getByRole('button', { name: /save/i }).click();
    
    // Navigate away and back
    await page.goto('/');
    await page.goto('/settings');
    
    // Settings should persist
    await expect(page.getByLabel('Mild AHI Threshold')).toHaveValue('5');
    await expect(page.getByLabel('Moderate AHI Threshold')).toHaveValue('15');
    await expect(page.getByLabel('Severe AHI Threshold')).toHaveValue('30');
  });

  test('should reset settings to defaults', async ({ page }) => {
    await page.goto('/settings');
    
    // Change settings
    await page.getByLabel('Mild AHI Threshold').fill('99');
    await page.getByRole('button', { name: /save/i }).click();
    
    // Reset
    await page.getByRole('button', { name: /reset to defaults/i }).click();
    await page.getByRole('button', { name: /confirm/i }).click();
    
    // Should return to default value (5)
    await expect(page.getByLabel('Mild AHI Threshold')).toHaveValue('5');
  });
});
```

---

## 4. Test Scenarios

### 4.1 Happy Path Scenarios

**Definition**: Optimal user journeys with valid inputs and expected outcomes.

| Scenario | Test File | Priority |
|----------|-----------|----------|
| First launch → Import single session → View dashboard | `first-launch.spec.ts` | P0 |
| Dashboard → Select date range → View filtered data | `dashboard.spec.ts` | P0 |
| Dashboard → Click session → View detail → View signals | `session-detail.spec.ts` | P0 |
| Analysis → Run statistical analysis → View results → Export CSV | `statistical-analysis.spec.ts` | P1 |
| Dashboard → Generate report → Export PDF | `report-export.spec.ts` | P0 |
| Settings → Change theme → Verify persistence | `settings-persistence.spec.ts` | P1 |

### 4.2 Error Handling Scenarios

**Definition**: Invalid inputs, edge cases, and system failures.

| Scenario | Test File | Expected Behavior |
|----------|-----------|-------------------|
| Upload malformed EDF file | `malformed-data.spec.ts` | Display clear error message, don't crash |
| Upload corrupted data section | `malformed-data.spec.ts` | Show warning, import remaining valid data |
| Exceed storage quota | `storage-limits.spec.ts` | Prompt user to free space or cancel import |
| Network failure during import | `network-errors.spec.ts` | Retry automatically, show status |
| Import zero-byte file | `malformed-data.spec.ts` | Reject with error: "File is empty" |
| Run analysis with insufficient data | `statistical-analysis.spec.ts` | Show helpful message explaining requirements |
| Cancel import mid-progress | `import-data.spec.ts` | Stop immediately, clean up partial data |

**Test Suite Example**: `tests/e2e/edge-cases/malformed-data.spec.ts`

```typescript
import { test, expect } from '../../support/fixtures/testData';

test.describe('Malformed Data Handling', () => {
  test('should reject file with invalid EDF header', async ({
    page,
    importWizardPage,
  }) => {
    await importWizardPage.goto();
    await importWizardPage.uploadFile('tests/fixtures/edf/malformed-header.edf');
    
    await expect(page.getByRole('alert')).toContainText(
      /invalid EDF header/i
    );
    
    // Should not crash
    await expect(page.getByRole('button', { name: /try again/i })).toBeVisible();
  });

  test('should warn about corrupted data but continue', async ({
    page,
    importWizardPage,
  }) => {
    await importWizardPage.goto();
    await importWizardPage.uploadFile('tests/fixtures/edf/corrupted-data.edf');
    
    await importWizardPage.assertImportWarnings(1);
    
    // Warning should be dismissible
    await page.getByRole('button', { name: /dismiss/i }).click();
    await expect(page.getByRole('alert')).not.toBeVisible();
  });

  test('should reject empty file', async ({ page, importWizardPage }) => {
    await importWizardPage.goto();
    
    // Create empty file dynamically
    await page.evaluate(async () => {
      const input = document.querySelector('[data-testid="file-input"]') as HTMLInputElement;
      const dataTransfer = new DataTransfer();
      const file = new File([], 'empty.edf', { type: 'application/octet-stream' });
      dataTransfer.items.add(file);
      input.files = dataTransfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    
    await expect(page.getByRole('alert')).toContainText(/file is empty/i);
  });
});
```

### 4.3 Edge Cases

**Large Files**:
```typescript
test('should handle 1+ year of data (large file)', async ({
  page,
  importWizardPage,
}) => {
  test.slow(); // Mark as slow test (3x timeout)
  
  await importWizardPage.goto();
  await importWizardPage.uploadFile('tests/fixtures/edf/large-dataset.edf');
  
  // Should complete within 2 minutes
  await importWizardPage.waitForImportComplete(120000);
  await importWizardPage.assertImportSuccess(365);
});
```

**Multi-Day Session Testing**:
```typescript
test('should correctly split multi-day sessions', async ({
  page,
  importWizardPage,
  dashboardPage,
}) => {
  // EDF file contains data spanning 2 calendar days (late night start)
  await importWizardPage.goto();
  await importWizardPage.uploadFile('tests/fixtures/edf/multi-day-session.edf');
  await importWizardPage.assertImportSuccess(1); // Should be counted as 1 session
  
  await page.goto('/');
  
  // Session should be associated with start date
  const sessionDate = await page
    .getByRole('row')
    .first()
    .getByRole('cell')
    .first()
    .textContent();
  
  expect(sessionDate).toBe('Feb 9, 2026'); // Start date, not end date
});
```

**Plugin Interactions**:
```typescript
test('should load custom analysis plugin', async ({ page }) => {
  await page.goto('/analysis');
  
  // Install plugin (simulated)
  await page.evaluate(() => {
    window.cpapAnalyzer.plugins.register({
      id: 'test-plugin',
      name: 'Test Analysis',
      version: '1.0.0',
      // ... plugin implementation
    });
  });
  
  // Plugin should appear in menu
  await expect(
    page.getByRole('button', { name: 'Test Analysis' })
  ).toBeVisible();
});
```

---

## 5. Accessibility Testing

### 5.1 Keyboard Navigation Testing

**Test Suite**: `tests/e2e/accessibility/keyboard-navigation.spec.ts`

```typescript
import { test, expect } from '../../support/fixtures/testData';

test.describe('Keyboard Navigation', () => {
  test('should navigate primary tabs with arrow keys', async ({ page }) => {
    await page.goto('/');
    
    // Focus first tab (Dashboard)
    await page.getByRole('tab', { name: /dashboard/i }).focus();
    
    // Press Right Arrow → Should move to Sessions
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: /sessions/i })).toBeFocused();
    
    // Press Right Arrow → Should move to Analysis
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: /analysis/i })).toBeFocused();
    
    // Press Right Arrow at end → Should wrap to Dashboard
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: /dashboard/i })).toBeFocused();
  });

  test('should activate tab with Enter key', async ({ page }) => {
    await page.goto('/');
    
    // Focus and activate Sessions tab
    await page.getByRole('tab', { name: /sessions/i }).focus();
    await page.keyboard.press('Enter');
    
    // Should navigate to Sessions view
    await expect(page).toHaveURL(/\/sessions/);
  });

  test('should trap focus in modal dialogs', async ({ page }) => {
    await page.goto('/');
    
    // Open settings modal
    await page.getByRole('button', { name: /settings/i }).click();
    
    // Modal should be visible
    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible();
    
    // Focus first interactive element
    const firstButton = modal.getByRole('button').first();
    await expect(firstButton).toBeFocused();
    
    // Tab through all elements
    const interactiveElements = await modal.getByRole('button').count();
    for (let i = 0; i < interactiveElements; i++) {
      await page.keyboard.press('Tab');
    }
    
    // Should cycle back to first element
    await expect(firstButton).toBeFocused();
  });

  test('should skip navigation with skip link', async ({ page }) => {
    await page.goto('/');
    
    // Press Tab → Should focus skip link
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: /skip to main/i })).toBeFocused();
    
    // Activate skip link
    await page.keyboard.press('Enter');
    
    // Should focus main content
    await expect(page.getByRole('main')).toBeFocused();
  });

  test('should close modal with Escape key', async ({ page }) => {
    await page.goto('/');
    
    await page.getByRole('button', { name: /settings/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    
    // Press Escape
    await page.keyboard.press('Escape');
    
    // Modal should close
    await expect(page.getByRole('dialog')).not.toBeVisible();
  });

  test('should navigate table with arrow keys', async ({
    page,
    dashboardPage,
    importedData,
  }) => {
    await dashboardPage.goto();
    
    // Focus first table cell
    const firstCell = page.getByRole('table').getByRole('cell').first();
    await firstCell.focus();
    
    // Press Down Arrow → Should move to next row
    await page.keyboard.press('ArrowDown');
    
    // Press Right Arrow → Should move to next cell
    await page.keyboard.press('ArrowRight');
    
    // Active cell should have focus indicator
    const focusedCell = page.locator(':focus');
    await expect(focusedCell).toHaveAttribute('role', 'cell');
  });
});
```

### 5.2 Screen Reader Compatibility

**Test Suite**: `tests/e2e/accessibility/screen-reader.spec.ts`

```typescript
import { test, expect } from '../../support/fixtures/testData';

test.describe('Screen Reader Compatibility', () => {
  test.use({
    // Use project with reduced motion
    projectName: 'chromium-screen-reader',
  });

  test('should have semantic landmarks', async ({ page }) => {
    await page.goto('/');
    
    // Check for required landmarks
    await expect(page.getByRole('banner')).toBeVisible(); // Header
    await expect(page.getByRole('navigation')).toBeVisible(); // Nav
    await expect(page.getByRole('main')).toBeVisible(); // Main content
    await expect(page.getByRole('contentinfo')).toBeVisible(); // Footer
  });

  test('should announce page title on navigation', async ({ page }) => {
    await page.goto('/');
    
    // Navigate to Sessions
    await page.getByRole('link', { name: /sessions/i }).click();
    
    // Check document title updated
    await expect(page).toHaveTitle(/sessions/i);
    
    // Check for live region announcement
    const liveRegion = page.getByRole('status', { name: /page.*changed/i });
    await expect(liveRegion).toBeInViewport();
  });

  test('should label form fields correctly', async ({ page }) => {
    await page.goto('/settings');
    
    // All inputs should have accessible labels
    const inputs = page.getByRole('textbox');
    const count = await inputs.count();
    
    for (let i = 0; i < count; i++) {
      const input = inputs.nth(i);
      const label = await input.getAttribute('aria-label') ||
                    await input.getAttribute('aria-labelledby');
      
      expect(label).toBeTruthy();
    }
  });

  test('should describe charts with accessible text', async ({
    page,
    dashboardPage,
    importedData,
  }) => {
    await dashboardPage.goto();
    
    // Chart should have role='img' and aria-label
    const chart = page.getByRole('img', { name: /ahi.*trend/i });
    await expect(chart).toBeVisible();
    
    // Detailed description should be available
    const description = await chart.getAttribute('aria-describedby');
    expect(description).toBeTruthy();
  });

  test('should announce loading states', async ({ page, importWizardPage }) => {
    await importWizardPage.goto();
    await importWizardPage.uploadFile('tests/fixtures/edf/typical-session.edf');
    
    // Loading indicator should have aria-live
    const loadingRegion = page.getByRole('status', { name: /importing/i });
    await expect(loadingRegion).toHaveAttribute('aria-live', 'polite');
    
    // Completion should announce
    await importWizardPage.waitForImportComplete();
    const completeRegion = page.getByRole('status', { name: /import complete/i });
    await expect(completeRegion).toHaveAttribute('aria-live', 'assertive');
  });

  test('should provide text alternatives for icons', async ({ page }) => {
    await page.goto('/');
    
    // Icon buttons should have accessible names
    const iconButtons = page.getByRole('button').filter({ hasNot: page.locator('text') });
    const count = await iconButtons.count();
    
    for (let i = 0; i < count; i++) {
      const button = iconButtons.nth(i);
      const name = await button.getAttribute('aria-label');
      expect(name).toBeTruthy();
    }
  });
});
```

### 5.3 ARIA Attribute Validation

**Test Suite**: `tests/e2e/accessibility/aria-validation.spec.ts`

```typescript
import { test, expect } from '../../support/fixtures/testData';
import { injectAxe, checkA11y } from 'axe-playwright';

test.describe('ARIA Validation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await injectAxe(page);
  });

  test('should pass axe accessibility scan on dashboard', async ({ page }) => {
    await checkA11y(page, null, {
      detailedReport: true,
      detailedReportOptions: {
        html: true,
      },
    });
  });

  test('should pass axe scan on session detail', async ({ page, importedData }) => {
    await page.goto('/sessions/session-1');
    await checkA11y(page);
  });

  test('should pass axe scan on analysis page', async ({ page }) => {
    await page.goto('/analysis');
    await checkA11y(page);
  });

  test('should have valid ARIA roles', async ({ page }) => {
    // Check for invalid role usage
    const invalidRoles = await page.locator('[role]:not([role="banner"],[role="navigation"],[role="main"],[role="contentinfo"],[role="complementary"],[role="search"],[role="form"],[role="dialog"],[role="alertdialog"],[role="alert"],[role="status"],[role="table"],[role="row"],[role="cell"],[role="columnheader"],[role="rowheader"],[role="button"],[role="link"],[role="tab"],[role="tablist"],[role="tabpanel"],[role="region"],[role="img"],[role="figure"])').count();
    
    expect(invalidRoles).toBe(0);
  });

  test('should not have duplicate IDs', async ({ page }) => {
    const ids = await page.$$eval('[id]', (elements) =>
      elements.map((el) => el.id)
    );
    
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });
});
```

### 5.4 Color Contrast Verification

**Test Suite**: `tests/e2e/accessibility/color-contrast.spec.ts`

```typescript
import { test, expect } from '@playwright/test';

test.describe('Color Contrast', () => {
  test('should meet WCAG AA contrast ratios in light theme', async ({ page }) => {
    await page.goto('/');
    
    // Set light theme explicitly
    await page.emulateMedia({ colorScheme: 'light' });
    
    // Check text contrast
    const bodyText = page.getByRole('main').locator('p').first();
    const color = await bodyText.evaluate((el) => {
      const style = window.getComputedStyle(el);
      return {
        foreground: style.color,
        background: style.backgroundColor,
      };
    });
    
    // Calculate contrast ratio (simplified; use library in production)
    const contrastRatio = calculateContrastRatio(
      color.foreground,
      color.background
    );
    
    expect(contrastRatio).toBeGreaterThanOrEqual(4.5); // WCAG AA normal text
  });

  test('should meet contrast ratios in dark theme', async ({ page }) => {
    await page.goto('/');
    await page.emulateMedia({ colorScheme: 'dark' });
    
    const bodyText = page.getByRole('main').locator('p').first();
    const color = await bodyText.evaluate((el) => {
      const style = window.getComputedStyle(el);
      return {
        foreground: style.color,
        background: style.backgroundColor,
      };
    });
    
    const contrastRatio = calculateContrastRatio(
      color.foreground,
      color.background
    );
    
    expect(contrastRatio).toBeGreaterThanOrEqual(4.5);
  });
});

function calculateContrastRatio(fg: string, bg: string): number {
  // Simplified implementation; use polished or color-contrast library
  const rgbFg = parseRgb(fg);
  const rgbBg = parseRgb(bg);
  
  const lFg = relativeLuminance(rgbFg);
  const lBg = relativeLuminance(rgbBg);
  
  const lighter = Math.max(lFg, lBg);
  const darker = Math.min(lFg, lBg);
  
  return (lighter + 0.05) / (darker + 0.05);
}

function parseRgb(color: string): [number, number, number] {
  const match = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (!match) return [0, 0, 0];
  return [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])];
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const [rs, gs, bs] = [r, g, b].map((c) => {
    c = c / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}
```

---

## 6. Performance Testing

### 6.1 Page Load Time Assertions

**Test Suite**: `tests/e2e/performance/page-load.spec.ts`

```typescript
import { test, expect } from '../../support/fixtures/testData';

test.describe('Page Load Performance', () => {
  test('should load dashboard within 2 seconds', async ({ page }) => {
    const startTime = Date.now();
    
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    const loadTime = Date.now() - startTime;
    expect(loadTime).toBeLessThan(2000);
  });

  test('should achieve First Contentful Paint within 1 second', async ({ page }) => {
    await page.goto('/');
    
    const fcp = await page.evaluate(() => {
      return new Promise((resolve) => {
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (entry.name === 'first-contentful-paint') {
              resolve(entry.startTime);
            }
          }
        }).observe({ type: 'paint', buffered: true });
      });
    });
    
    expect(fcp).toBeLessThan(1000);
  });

  test('should achieve Time to Interactive within 3 seconds', async ({ page }) => {
    await page.goto('/');
    
    const tti = await page.evaluate(() => {
      return performance.getEntriesByType('navigation')[0].duration;
    });
    
    expect(tti).toBeLessThan(3000);
  });
});
```

### 6.2 Interaction Responsiveness

**Test Suite**: `tests/e2e/performance/interaction-performance.spec.ts`

```typescript
import { test, expect } from '../../support/fixtures/testData';

test.describe('Interaction Responsiveness', () => {
  test.use({ importedData: true });

  test('should respond to button clicks within 100ms', async ({
    page,
    dashboardPage,
  }) => {
    await dashboardPage.goto();
    
    const button = page.getByRole('button', { name: /import/i });
    
    const startTime = Date.now();
    await button.click();
    await page.waitForURL('/import');
    const responseTime = Date.now() - startTime;
    
    expect(responseTime).toBeLessThan(100);
  });

  test('should filter session table within 200ms', async ({
    page,
    dashboardPage,
  }) => {
    await dashboardPage.goto();
    
    const searchInput = page.getByRole('textbox', { name: /search/i });
    
    const startTime = Date.now();
    await searchInput.fill('Feb 9');
    await page.waitForFunction(
      () => document.querySelectorAll('[data-testid="session-row"]').length > 0
    );
    const filterTime = Date.now() - startTime;
    
    expect(filterTime).toBeLessThan(200);
  });

  test('should sort table within 100ms', async ({ page, dashboardPage }) => {
    await dashboardPage.goto();
    
    const sortButton = page.getByRole('button', { name: /sort.*ahi/i });
    
    const startTime = Date.now();
    await sortButton.click();
    await page.waitForFunction(() => {
      // Wait for table re-render
      return true;
    });
    const sortTime = Date.now() - startTime;
    
    expect(sortTime).toBeLessThan(100);
  });
});
```

### 6.3 Large Dataset Rendering Performance

**Test Suite**: `tests/e2e/performance/large-dataset.spec.ts`

```typescript
import { test, expect } from '../../support/fixtures/testData';

test.describe('Large Dataset Performance', () => {
  test.slow(); // 3x timeout multiplier

  test('should import 1 year of data within 2 minutes', async ({
    page,
    importWizardPage,
  }) => {
    await importWizardPage.goto();
    
    const startTime = Date.now();
    await importWizardPage.uploadFile('tests/fixtures/edf/large-dataset.edf');
    await importWizardPage.waitForImportComplete(120000);
    const importTime = Date.now() - startTime;
    
    expect(importTime).toBeLessThan(120000);
  });

  test('should render chart with 1M data points within 3 seconds', async ({
    page,
    sessionDetailPage,
  }) => {
    // Import large session
    await page.goto('/import');
    await page.getByTestId('file-input').setInputFiles('tests/fixtures/edf/large-dataset.edf');
    await page.waitForSelector('[data-testid="import-complete"]', { timeout: 120000 });
    
    // Navigate to session detail
    await sessionDetailPage.goto('session-1');
    await sessionDetailPage.openSignalViewer();
    
    // Measure chart render time
    const startTime = Date.now();
    await page.waitForSelector('[data-testid="signal-chart"]', { state: 'visible' });
    const renderTime = Date.now() - startTime;
    
    expect(renderTime).toBeLessThan(3000);
  });

  test('should maintain 60fps during chart pan', async ({
    page,
    sessionDetailPage,
  }) => {
    await sessionDetailPage.goto('session-large');
    await sessionDetailPage.openSignalViewer();
    
    // Start performance measurement
    await page.evaluate(() => {
      (window as any).frameCount = 0;
      (window as any).startTime = performance.now();
      
      const countFrames = () => {
        (window as any).frameCount++;
        requestAnimationFrame(countFrames);
      };
      requestAnimationFrame(countFrames);
    });
    
    // Pan chart
    const chart = page.getByTestId('signal-chart');
    const box = await chart.boundingBox();
    if (!box) throw new Error('Chart not found');
    
    await page.mouse.move(box.x + 100, box.y + 100);
    await page.mouse.down();
    await page.mouse.move(box.x + 300, box.y + 100, { steps: 10 });
    await page.mouse.up();
    
    // Check frame rate
    const fps = await page.evaluate(() => {
      const elapsed = performance.now() - (window as any).startTime;
      const frames = (window as any).frameCount;
      return (frames / elapsed) * 1000;
    });
    
    expect(fps).toBeGreaterThanOrEqual(55); // Allow 5fps margin
  });
});
```

### 6.4 Memory Leak Detection

**Test Suite**: `tests/e2e/performance/memory-leaks.spec.ts`

```typescript
import { test, expect } from '../../support/fixtures/testData';

test.describe('Memory Leak Detection', () => {
  test('should not leak memory on repeated navigation', async ({
    page,
    importedData,
  }) => {
    await page.goto('/');
    
    // Get initial memory usage
    const initialMemory = await getMemoryUsage(page);
    
    // Navigate back and forth 10 times
    for (let i = 0; i < 10; i++) {
      await page.goto('/sessions/session-1');
      await page.waitForLoadState('networkidle');
      await page.goto('/');
      await page.waitForLoadState('networkidle');
    }
    
    // Force garbage collection (requires --expose-gc flag)
    await page.evaluate(() => {
      if ((window as any).gc) (window as any).gc();
    });
    
    // Get final memory usage
    const finalMemory = await getMemoryUsage(page);
    
    // Memory should not increase by more than 50%
    const increase = (finalMemory - initialMemory) / initialMemory;
    expect(increase).toBeLessThan(0.5);
  });

  test('should clean up chart event listeners', async ({
    page,
    sessionDetailPage,
  }) => {
    await sessionDetailPage.goto('session-1');
    await sessionDetailPage.openSignalViewer();
    
    // Count event listeners
    const initialListeners = await page.evaluate(() => {
      const element = document.querySelector('[data-testid="signal-chart"]');
      return (element as any)?._listenerCount || 0;
    });
    
    // Navigate away and back
    await page.goto('/');
    await sessionDetailPage.goto('session-1');
    await sessionDetailPage.openSignalViewer();
    
    const finalListeners = await page.evaluate(() => {
      const element = document.querySelector('[data-testid="signal-chart"]');
      return (element as any)?._listenerCount || 0;
    });
    
    // Listener count should not grow
    expect(finalListeners).toBeLessThanOrEqual(initialListeners);
  });
});

async function getMemoryUsage(page): Promise<number> {
  return await page.evaluate(() => {
    if ('memory' in performance && 'usedJSHeapSize' in (performance as any).memory) {
      return (performance as any).memory.usedJSHeapSize;
    }
    return 0;
  });
}
```

---

## 7. Visual Regression Testing

### 7.1 Screenshot Comparison Strategy

**Approach**: Capture baseline screenshots of key views, compare against new screenshots to detect unintended visual changes.

**When to Use**:
- After UI design changes (intentional updates to baselines)
- To catch accidental CSS regressions
- For cross-browser rendering differences

**Tools**:
- Playwright built-in screenshot comparison
- `expect(page).toHaveScreenshot()`

**Test Suite**: `tests/e2e/visual/screenshots.spec.ts`

```typescript
import { test, expect } from '@playwright/test';

test.describe('Visual Regression', () => {
  test('should match dashboard screenshot (light theme)', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    await expect(page).toHaveScreenshot('dashboard-light.png', {
      fullPage: true,
      animations: 'disabled',
    });
  });

  test('should match dashboard screenshot (dark theme)', async ({ page }) => {
    await page.goto('/');
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForLoadState('networkidle');
    
    await expect(page).toHaveScreenshot('dashboard-dark.png', {
      fullPage: true,
      animations: 'disabled',
    });
  });

  test('should match session detail screenshot', async ({ page, importedData }) => {
    await page.goto('/sessions/session-1');
    await page.waitForLoadState('networkidle');
    
    await expect(page).toHaveScreenshot('session-detail.png', {
      fullPage: true,
      mask: [page.getByText(/last updated/i)], // Mask timestamp
    });
  });

  test('should match chart rendering', async ({ page, sessionDetailPage }) => {
    await sessionDetailPage.goto('session-1');
    await sessionDetailPage.openSignalViewer();
    
    const chart = page.getByTestId('signal-chart');
    await expect(chart).toHaveScreenshot('signal-chart.png', {
      animations: 'disabled',
    });
  });
});
```

### 7.2 Baseline Management

**Storage**:
- Baselines committed to Git: `tests/fixtures/screenshots/`
- Separate directories per browser: `chromium/`, `firefox/`, `webkit/`
- Naming convention: `{view}-{theme}-{browser}.png`

**Update Process**:
1. Run tests to generate new screenshots:
   ```bash
   npx playwright test --update-snapshots
   ```

2. Review diffs manually:
   ```bash
   npx playwright show-report
   ```

3. Commit intentional changes:
   ```bash
   git add tests/fixtures/screenshots/
   git commit -m "chore: update visual regression baselines"
   ```

**CI Behavior**:
- Fail if screenshots don't match baselines
- Upload diff images as artifacts
- Require manual review before merging

### 7.3 Handling Minor Rendering Differences

**Tolerance Settings**:

```typescript
test('should tolerate minor anti-aliasing differences', async ({ page }) => {
  await page.goto('/');
  
  await expect(page).toHaveScreenshot('dashboard.png', {
    maxDiffPixels: 100, // Allow up to 100 pixels to differ
    threshold: 0.2, // 20% color tolerance per pixel
  });
});
```

**Masking Dynamic Content**:

```typescript
test('should mask timestamps and animations', async ({ page }) => {
  await page.goto('/');
  
  await expect(page).toHaveScreenshot('dashboard.png', {
    mask: [
      page.getByText(/last updated/i), // Timestamp
      page.locator('[data-testid="sparkline"]'), // Animated chart
      page.locator('[role="progressbar"]'), // Loading indicators
    ],
  });
});
```

**Browser-Specific Baselines**:
- Chromium, Firefox, and WebKit render fonts and anti-aliasing slightly differently
- Store separate baselines per browser
- `tests/fixtures/screenshots/{browser}/dashboard.png`

---

## 8. CI/CD Integration

### 8.1 Test Execution in GitHub Actions

**GitHub Actions Workflow** (excerpt from `.github/workflows/ci.yml`):

```yaml
test-e2e:
  name: E2E Tests (Playwright)
  runs-on: ubuntu-latest
  timeout-minutes: 30
  steps:
    - uses: actions/checkout@v4
    
    - uses: actions/setup-node@v4
      with:
        node-version: 22
        cache: npm
    
    - name: Install dependencies
      run: npm ci
    
    - name: Install Playwright browsers
      run: npx playwright install --with-deps
    
    - name: Build application
      run: npm run build
    
    - name: Run E2E tests
      run: npx playwright test
      env:
        CI: true
    
    - name: Upload test results
      if: ${{ !cancelled() }}
      uses: actions/upload-artifact@v4
      with:
        name: playwright-report
        path: playwright-report/
        retention-days: 14
    
    - name: Upload failure artifacts
      if: failure()
      uses: actions/upload-artifact@v4
      with:
        name: test-failures
        path: |
          test-results/
          playwright-report/
          screenshots/
          videos/
        retention-days: 7
```

### 8.2 Artifact Collection

**Artifacts Uploaded on Failure**:
- **Screenshots**: Last screen state when test failed
- **Videos**: Recording of test execution
- **Traces**: Full Playwright trace (network, DOM, console, etc.)
- **Test Results**: JUnit XML for integration with GitHub PR checks

**Artifact Structure**:
```
playwright-report/
├── index.html              # HTML test report
├── data/
│   └── results.json        # JSON test results
screenshots/
├── dashboard.spec.ts/      # Per-test screenshots
│   ├── should-load-test-1-retry-1.png
│   └── should-load-test-1-retry-2.png
videos/
├── dashboard.spec.ts-chromium.webm
traces/
├── dashboard.spec.ts-chromium-trace.zip
```

**Viewing Artifacts**:
- Download from GitHub Actions UI
- Extract and open `playwright-report/index.html`
- Use Playwright Trace Viewer:
  ```bash
  npx playwright show-trace traces/dashboard.spec.ts-chromium-trace.zip
  ```

### 8.3 Failure Reporting and Debugging

**GitHub PR Integration**:
- Playwright reporter annotates PR with failures
- Failed test names appear as check annotations
- Links to artifacts in PR comments

**Debugging Workflow**:

1. **Check GitHub Actions Log**:
   - View failed test output
   - Look for error messages and stack traces

2. **Download Artifacts**:
   - Screenshots show visual state at failure
   - Videos show user interaction leading to failure

3. **Analyze Trace**:
   - Open trace in Playwright Trace Viewer
   - Inspect DOM snapshots, network requests, console logs

4. **Reproduce Locally**:
   ```bash
   # Run specific test in debug mode
   npx playwright test --debug tests/e2e/dashboard.spec.ts:15
   ```

5. **Fix and Re-run**:
   ```bash
   # Re-run only failed tests
   npx playwright test --last-failed
   ```

**Failure Notifications**:
- Slack webhook on E2E test failure (optional)
- Email to on-call agent (if configured)

### 8.4 Retry Strategies

**Test Retries**:
- **CI**: 2 automatic retries per test
- **Local**: 0 retries (fail fast for developer feedback)

**When to Retry**:
- Transient failures (network timeouts, race conditions)
- Browser crashes
- Infrastructure issues (CI runner overload)

**When NOT to Retry**:
- Assertion failures (test logic errors)
- Missing elements (UI bugs)
- Data validation failures

**Retry Configuration**:
```typescript
// playwright.config.ts
export default defineConfig({
  retries: process.env.CI ? 2 : 0,
  
  // Per-test override
  use: {
    retries: 1, // Override for specific project
  },
});
```

**Flaky Test Detection**:
- If test passes after 1+ retries, mark as "flaky"
- Track flaky tests in separate report
- Prioritize fixing flaky tests (they indicate timing issues or race conditions)

---

## 9. Test Data

### 9.1 Sample EDF File Preparation

**Requirements**:
- **Minimal Valid**: 1 session, no events, ~50 KB
- **Typical Session**: 1 session, realistic AHI (~4), ~2 MB
- **Multi-Session**: 7 sessions, ~10 MB
- **Large Dataset**: 90 sessions (3 months), ~100 MB
- **Edge Cases**: Malformed header, corrupted data, zero events, high AHI

**Creation Process**:

1. **Export from Real Machine** (anonymized):
   ```bash
   # Copy from SD card, anonymize patient data
   cp /Volumes/RESMED_SD/DATALOG/*.edf tests/fixtures/edf/
   python scripts/anonymize-edf.py tests/fixtures/edf/
   ```

2. **Generate Synthetic Data**:
   ```bash
   node scripts/generate-test-edf.js --sessions 7 --ahi 4.2 --output tests/fixtures/edf/multi-session.edf
   ```

3. **Validate Files**:
   ```bash
   # Check EDF header integrity
   python scripts/validate-edf.py tests/fixtures/edf/*.edf
   ```

**Anonymization Script**:
```python
# scripts/anonymize-edf.py
import sys
from pathlib import Path

def anonymize_edf(file_path):
    with open(file_path, 'rb') as f:
        data = bytearray(f.read())
    
    # Overwrite patient identification (bytes 8-88)
    patient_id = b'Anonymous Patient' + b' ' * 63
    data[8:88] = patient_id[:80]
    
    # Overwrite recording identification (bytes 88-168)
    recording_id = b'Test Data' + b' ' * 71
    data[88:168] = recording_id[:80]
    
    with open(file_path, 'wb') as f:
        f.write(data)

if __name__ == '__main__':
    for file_path in sys.argv[1:]:
        anonymize_edf(file_path)
        print(f'Anonymized: {file_path}')
```

### 9.2 Test Data Versioning

**Git LFS for Large Files**:
```bash
# .gitattributes
tests/fixtures/edf/large-dataset.edf filter=lfs diff=lfs merge=lfs -text
tests/fixtures/edf/*.large.edf filter=lfs diff=lfs merge=lfs -text
```

**Checksums**:
```json
// tests/fixtures/checksums.json
{
  "typical-session.edf": {
    "sha256": "a1b2c3d4...",
    "size": 2048576,
    "sessions": 1,
    "ahi": 4.2
  },
  "multi-session.edf": {
    "sha256": "e5f6g7h8...",
    "size": 10485760,
    "sessions": 7,
    "ahi": 5.1
  }
}
```

**Validation Script**:
```bash
# Verify test fixtures before running tests
npm run verify-fixtures
```

```javascript
// package.json
{
  "scripts": {
    "verify-fixtures": "node scripts/verify-fixtures.js"
  }
}
```

### 9.3 Anonymized Real-World Datasets

**Sources**:
- User-contributed data (with consent)
- Synthetic data generated from statistical models
- Kaggle/research datasets (with proper licensing)

**Privacy Requirements**:
- Remove all patient identification
- Remove serial numbers (or use fake serials)
- Remove timestamps (or shift to arbitrary dates)
- No location data
- No integration data (Fitbit, etc.)

**License**:
- Test data licensed under CC0 (public domain)
- Documented in `tests/fixtures/LICENSE.md`

### 9.4 Synthetic Data Generation

**Generator**:
```typescript
// tests/support/helpers/synthetic-data.ts
export function generateSession(options: {
  date: Date;
  ahi: number;
  usageHours: number;
  leak: number;
}): SessionData {
  const { date, ahi, usageHours, leak } = options;
  
  // Calculate event count from AHI
  const totalEvents = Math.round((ahi * usageHours) / 60);
  
  // Generate events with realistic distribution
  const events = generateEvents(totalEvents, usageHours);
  
  // Generate waveform data
  const waveforms = generateWaveforms(usageHours, leak);
  
  return {
    date,
    usageHours,
    ahi,
    leak,
    events,
    waveforms,
  };
}

function generateEvents(count: number, duration: number): Event[] {
  const events: Event[] = [];
  const rnd = seededRandom(Date.now());
  
  for (let i = 0; i < count; i++) {
    const type = rnd() < 0.7 ? 'ObstructiveApnea' : 'Hypopnea';
    const onset = rnd() * duration * 3600; // Random time within session
    const eventDuration = 10 + rnd() * 50; // 10-60 seconds
    
    events.push({
      type,
      onset,
      duration: eventDuration,
    });
  }
  
  return events.sort((a, b) => a.onset - b.onset);
}

function generateWaveforms(duration: number, leak: number): Waveforms {
  const sampleRate = 25; // Hz
  const samples = Math.floor(duration * 3600 * sampleRate);
  
  // Generate realistic flow waveform with respiratory pattern
  const flow = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    const t = i / sampleRate;
    const breathRate = 15; // breaths per minute
    const breathCycle = (t * breathRate / 60) % 1;
    
    // Sinusoidal breathing
    flow[i] = 20 * Math.sin(breathCycle * Math.PI * 2);
  }
  
  return { flow, /* pressure, leak, etc. */ };
}
```

**Usage in Tests**:
```typescript
test('should handle synthetically generated session', async ({
  page,
  importWizardPage,
}) => {
  // Generate test data on-demand
  const sessionData = generateSession({
    date: new Date('2026-02-09'),
    ahi: 4.2,
    usageHours: 7.5,
    leak: 8,
  });
  
  const edfBlob = encodeAsEDF(sessionData);
  const edfFile = new File([edfBlob], 'synthetic-session.edf');
  
  // Upload to application
  await importWizardPage.goto();
  await page.setInputFiles('[data-testid="file-input"]', edfFile);
  await importWizardPage.assertImportSuccess(1);
});
```

---

## 10. Conclusion

This E2E testing strategy provides comprehensive coverage of the CPAP Analyzer application, ensuring:

- **User-centric validation** through complete journey testing
- **Accessibility compliance** with WCAG AA standards
- **Performance guarantees** for large datasets
- **Visual consistency** across browsers
- **Reliable CI/CD integration** with actionable failure reports

### Next Steps

1. **Implement Page Objects**: Start with critical paths (Dashboard, Import, Session Detail)
2. **Set Up CI**: Configure GitHub Actions E2E job
3. **Create Baseline Fixtures**: Generate or anonymize sample EDF files
4. **Write Critical Path Tests**: Priority 1 scenarios first
5. **Add Visual Regression**: Capture baseline screenshots
6. **Expand Coverage**: Accessibility, performance, edge cases
7. **Monitor Flaky Tests**: Track and fix unreliable tests

### Success Metrics

- **Coverage**: >80% of user journeys covered by E2E tests
- **Reliability**: <5% flaky test rate
- **Performance**: E2E suite completes in <15 minutes in CI
- **Maintainability**: Page Object Model reduces duplication, eases refactoring

---

**Document Status**: Ready for Implementation  
**Review Required**: QA Agent, Frontend Agent, DevOps Agent  
**Last Updated**: February 10, 2026
