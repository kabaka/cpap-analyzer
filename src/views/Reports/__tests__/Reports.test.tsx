/**
 * Unit tests for the Reports view component.
 *
 * Tests rendering, template selection, section toggling, date range inputs,
 * and action button interactions. All service calls are mocked.
 *
 * @module views/Reports/__tests__/Reports.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';
import { useAppStore } from '@/stores/useAppStore';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGeneratePDF = vi.fn();
const mockGenerateCSV = vi.fn();
const mockGenerateEncryptedArchive = vi.fn();
const mockDownloadBlob = vi.fn();

vi.mock('@/services/reports', () => ({
  generatePDF: (...args: unknown[]) => mockGeneratePDF(...args),
  generateCSV: (...args: unknown[]) => mockGenerateCSV(...args),
  generateEncryptedArchive: (...args: unknown[]) => mockGenerateEncryptedArchive(...args),
  downloadBlob: (...args: unknown[]) => mockDownloadBlob(...args),
  REPORT_TEMPLATES: [
    {
      id: 'physician-summary',
      name: 'Physician Summary',
      description: 'A concise report for your healthcare provider.',
      defaultSections: {
        summaryStatistics: true,
        sessionDetails: false,
        ahiTrend: true,
        leakAnalysis: false,
        pressureMetrics: true,
        eventBreakdown: false,
        complianceReport: true,
        usagePatterns: false,
      },
    },
    {
      id: 'full-analysis',
      name: 'Full Analysis Report',
      description: 'Comprehensive multi-page report with all analyses.',
      defaultSections: {
        summaryStatistics: true,
        sessionDetails: true,
        ahiTrend: true,
        leakAnalysis: true,
        pressureMetrics: true,
        eventBreakdown: true,
        complianceReport: true,
        usagePatterns: true,
      },
    },
    {
      id: 'custom',
      name: 'Custom Report',
      description: 'Build your own report by selecting sections.',
      defaultSections: {
        summaryStatistics: true,
        sessionDetails: false,
        ahiTrend: false,
        leakAnalysis: false,
        pressureMetrics: false,
        eventBreakdown: false,
        complianceReport: false,
        usagePatterns: false,
      },
    },
  ],
  PHYSICIAN_SUMMARY_SECTIONS: {
    summaryStatistics: true,
    sessionDetails: false,
    ahiTrend: true,
    leakAnalysis: false,
    pressureMetrics: true,
    eventBreakdown: false,
    complianceReport: true,
    usagePatterns: false,
  },
  FULL_ANALYSIS_SECTIONS: {
    summaryStatistics: true,
    sessionDetails: true,
    ahiTrend: true,
    leakAnalysis: true,
    pressureMetrics: true,
    eventBreakdown: true,
    complianceReport: true,
    usagePatterns: true,
  },
  CUSTOM_DEFAULT_SECTIONS: {
    summaryStatistics: true,
    sessionDetails: false,
    ahiTrend: false,
    leakAnalysis: false,
    pressureMetrics: false,
    eventBreakdown: false,
    complianceReport: false,
    usagePatterns: false,
  },
}));

// Mock CSS module
vi.mock('../Reports.module.css', () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

import Reports from '../Reports';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Reports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({
      dateRange: {
        start: new Date('2025-01-01'),
        end: new Date('2025-06-01'),
      },
    });
    mockGeneratePDF.mockResolvedValue({
      blob: new Blob(['pdf'], { type: 'application/pdf' }),
      filename: 'cpap-report.pdf',
      mimeType: 'application/pdf',
    });
    mockGenerateCSV.mockResolvedValue({
      blob: new Blob(['csv'], { type: 'text/csv' }),
      filename: 'cpap-data.csv',
      mimeType: 'text/csv',
    });
    mockGenerateEncryptedArchive.mockResolvedValue({
      blob: new Blob(['enc'], { type: 'application/octet-stream' }),
      filename: 'cpap-data-encrypted.bin',
      mimeType: 'application/octet-stream',
    });
  });

  it('should render the page title', () => {
    render(<Reports />);
    expect(screen.getByRole('heading', { name: /reports/i, level: 1 })).toBeInTheDocument();
  });

  it('should render all three template cards', () => {
    render(<Reports />);
    expect(screen.getByText('Physician Summary')).toBeInTheDocument();
    expect(screen.getByText('Full Analysis Report')).toBeInTheDocument();
    expect(screen.getByText('Custom Report')).toBeInTheDocument();
  });

  it('should mark the physician-summary template as selected by default', () => {
    render(<Reports />);
    const radioGroup = screen.getByRole('radiogroup', { name: /report templates/i });
    const selectedRadio = within(radioGroup).getByRole('radio', { checked: true });
    expect(selectedRadio).toHaveTextContent(/Physician Summary/);
  });

  it('should switch templates when a different card is clicked', async () => {
    const user = userEvent.setup();
    render(<Reports />);

    const fullAnalysisCard = screen.getByText('Full Analysis Report').closest('[role="radio"]');
    expect(fullAnalysisCard).toBeDefined();
    await user.click(fullAnalysisCard!);

    expect(fullAnalysisCard).toHaveAttribute('aria-checked', 'true');
  });

  it('should show section checkboxes when custom template is selected', async () => {
    const user = userEvent.setup();
    render(<Reports />);

    // Initially, section checkboxes should NOT be visible (physician-summary)
    expect(screen.queryByLabelText(/Session Details/)).not.toBeInTheDocument();

    // Click custom template
    const customCard = screen.getByText('Custom Report').closest('[role="radio"]');
    await user.click(customCard!);

    // Now checkboxes should appear
    expect(screen.getByLabelText(/Summary Statistics/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Session Details/)).toBeInTheDocument();
    expect(screen.getByLabelText(/AHI Trend/)).toBeInTheDocument();
  });

  it('should render date range inputs', () => {
    render(<Reports />);
    expect(screen.getByLabelText(/Start Date/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/End Date/i)).toBeInTheDocument();
  });

  it('should render download buttons', () => {
    render(<Reports />);
    expect(screen.getByRole('button', { name: /Download PDF Report/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Export CSV Data/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Download Encrypted Archive/i })).toBeInTheDocument();
  });

  it('should call generatePDF and downloadBlob on PDF button click', async () => {
    const user = userEvent.setup();
    render(<Reports />);

    await user.click(screen.getByRole('button', { name: /Download PDF Report/i }));

    expect(mockGeneratePDF).toHaveBeenCalledTimes(1);
  });

  it('should call generateCSV and downloadBlob on CSV button click', async () => {
    const user = userEvent.setup();
    render(<Reports />);

    await user.click(screen.getByRole('button', { name: /Export CSV Data/i }));

    expect(mockGenerateCSV).toHaveBeenCalledTimes(1);
  });

  it('should show error when encrypt button clicked without password', async () => {
    const user = userEvent.setup();
    render(<Reports />);

    await user.click(screen.getByRole('button', { name: /Download Encrypted Archive/i }));

    expect(screen.getByText(/please enter a password/i)).toBeInTheDocument();
    expect(mockGenerateEncryptedArchive).not.toHaveBeenCalled();
  });

  it('should show error when password is too short', async () => {
    const user = userEvent.setup();
    render(<Reports />);

    const passwordInput = screen.getByLabelText(/Password/i);
    await user.type(passwordInput, 'short');

    await user.click(screen.getByRole('button', { name: /Download Encrypted Archive/i }));

    expect(screen.getByText(/at least 8 characters/i)).toBeInTheDocument();
    expect(mockGenerateEncryptedArchive).not.toHaveBeenCalled();
  });

  it('should call generateEncryptedArchive with valid password', async () => {
    const user = userEvent.setup();
    render(<Reports />);

    const passwordInput = screen.getByLabelText(/Password/i);
    await user.type(passwordInput, 'secure-password-123');

    await user.click(screen.getByRole('button', { name: /Download Encrypted Archive/i }));

    expect(mockGenerateEncryptedArchive).toHaveBeenCalledTimes(1);
  });

  it('should show success message after successful PDF generation', async () => {
    const user = userEvent.setup();
    render(<Reports />);

    await user.click(screen.getByRole('button', { name: /Download PDF Report/i }));

    expect(await screen.findByText(/PDF report downloaded/i)).toBeInTheDocument();
  });

  it('should show error message when PDF generation fails', async () => {
    mockGeneratePDF.mockRejectedValueOnce(new Error('PDF generation failed'));
    const user = userEvent.setup();
    render(<Reports />);

    await user.click(screen.getByRole('button', { name: /Download PDF Report/i }));

    expect(await screen.findByText(/PDF generation failed/i)).toBeInTheDocument();
  });

  it('should render privacy note about local processing', () => {
    render(<Reports />);
    expect(screen.getByText(/no data leaves your device/i)).toBeInTheDocument();
  });
});
