import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ChartContainer from '@/components/charts/ChartContainer';
import type { TableData } from '@/components/charts/ChartContainer';

describe('ChartContainer', () => {
  describe('rendering children', () => {
    it('should render children when not loading and no error', () => {
      render(
        <ChartContainer title="Test Chart">
          <div data-testid="chart-content">Chart goes here</div>
        </ChartContainer>,
      );

      expect(screen.getByTestId('chart-content')).toBeInTheDocument();
    });

    it('should not render children when loading', () => {
      render(
        <ChartContainer title="Test Chart" loading>
          <div data-testid="chart-content">Chart goes here</div>
        </ChartContainer>,
      );

      expect(screen.queryByTestId('chart-content')).not.toBeInTheDocument();
    });

    it('should not render children when error is set', () => {
      render(
        <ChartContainer title="Test Chart" error="Something broke">
          <div data-testid="chart-content">Chart goes here</div>
        </ChartContainer>,
      );

      expect(screen.queryByTestId('chart-content')).not.toBeInTheDocument();
    });
  });

  describe('loading skeleton', () => {
    it('should show loading skeleton when loading=true', () => {
      render(
        <ChartContainer title="Test Chart" loading>
          <div>content</div>
        </ChartContainer>,
      );

      expect(screen.getByRole('figure')).toBeInTheDocument();
      // aria-busy indicates loading state
      const busyEl = document.querySelector('[aria-busy="true"]');
      expect(busyEl).toBeInTheDocument();
    });

    it('should not show loading skeleton when loading=false', () => {
      render(
        <ChartContainer title="Test Chart" loading={false}>
          <div>content</div>
        </ChartContainer>,
      );

      const busyEl = document.querySelector('[aria-busy="true"]');
      expect(busyEl).not.toBeInTheDocument();
    });
  });

  describe('error display', () => {
    it('should show error message when error is set', () => {
      render(
        <ChartContainer title="Test Chart" error="Data load failed">
          <div>content</div>
        </ChartContainer>,
      );

      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText('Data load failed')).toBeInTheDocument();
    });

    it('should not show error when error is null', () => {
      render(
        <ChartContainer title="Test Chart" error={null}>
          <div>content</div>
        </ChartContainer>,
      );

      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('should show error icon alongside the message', () => {
      render(
        <ChartContainer title="Test Chart" error="Something broke">
          <div>content</div>
        </ChartContainer>,
      );

      expect(screen.getByText('⚠')).toBeInTheDocument();
    });
  });

  describe('title and aria-label', () => {
    it('should display the title text', () => {
      render(
        <ChartContainer title="AHI Over Time">
          <div>chart</div>
        </ChartContainer>,
      );

      expect(screen.getByText('AHI Over Time')).toBeInTheDocument();
    });

    it('should use title as aria-label when no description is provided', () => {
      render(
        <ChartContainer title="AHI Over Time">
          <div>chart</div>
        </ChartContainer>,
      );

      expect(screen.getByRole('figure')).toHaveAttribute('aria-label', 'AHI Over Time');
    });

    it('should use description as aria-label when provided', () => {
      render(
        <ChartContainer title="AHI" description="AHI trend over the last 30 days">
          <div>chart</div>
        </ChartContainer>,
      );

      expect(screen.getByRole('figure')).toHaveAttribute(
        'aria-label',
        'AHI trend over the last 30 days',
      );
    });
  });

  describe('View as Table toggle', () => {
    const tableData: TableData = {
      headers: ['Date', 'AHI'],
      rows: [
        ['2025-01-01', 3.2],
        ['2025-01-02', 2.8],
      ],
    };

    it('should not show toggle when tableData is not provided', () => {
      render(
        <ChartContainer title="Chart">
          <div>chart</div>
        </ChartContainer>,
      );

      expect(screen.queryByLabelText('View as table')).not.toBeInTheDocument();
    });

    it('should show toggle when tableData is provided', () => {
      render(
        <ChartContainer title="Chart" tableData={tableData}>
          <div data-testid="chart-content">chart</div>
        </ChartContainer>,
      );

      expect(screen.getByLabelText('View as table')).toBeInTheDocument();
    });

    it('should switch between chart and table views on toggle click', async () => {
      const user = userEvent.setup();

      render(
        <ChartContainer title="Chart" tableData={tableData}>
          <div data-testid="chart-content">chart</div>
        </ChartContainer>,
      );

      // Initially shows chart
      expect(screen.getByTestId('chart-content')).toBeInTheDocument();
      expect(screen.queryByRole('table')).not.toBeInTheDocument();

      // Click toggle → shows table
      await user.click(screen.getByLabelText('View as table'));
      expect(screen.queryByTestId('chart-content')).not.toBeInTheDocument();
      expect(screen.getByRole('table')).toBeInTheDocument();

      // Verify table headers
      expect(screen.getByText('Date')).toBeInTheDocument();
      expect(screen.getByText('AHI')).toBeInTheDocument();

      // Verify table data
      expect(screen.getByText('2025-01-01')).toBeInTheDocument();
      expect(screen.getByText('3.2')).toBeInTheDocument();

      // Click toggle again → back to chart
      await user.click(screen.getByLabelText('View as chart'));
      expect(screen.getByTestId('chart-content')).toBeInTheDocument();
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
    });

    it('should update toggle label based on current view', async () => {
      const user = userEvent.setup();

      render(
        <ChartContainer title="Chart" tableData={tableData}>
          <div>chart</div>
        </ChartContainer>,
      );

      // Initial state: shows "View as table"
      expect(screen.getByLabelText('View as table')).toBeInTheDocument();

      await user.click(screen.getByLabelText('View as table'));

      // After toggle: shows "View as chart"
      expect(screen.getByLabelText('View as chart')).toBeInTheDocument();
    });
  });

  describe('export button', () => {
    it('should render export button', () => {
      render(
        <ChartContainer title="Chart">
          <div>chart</div>
        </ChartContainer>,
      );

      expect(screen.getByLabelText('Export chart as PNG')).toBeInTheDocument();
    });

    it('should disable export button when loading', () => {
      render(
        <ChartContainer title="Chart" loading>
          <div>chart</div>
        </ChartContainer>,
      );

      expect(screen.getByLabelText('Export chart as PNG')).toBeDisabled();
    });

    it('should disable export button when error is set', () => {
      render(
        <ChartContainer title="Chart" error="Error occurred">
          <div>chart</div>
        </ChartContainer>,
      );

      expect(screen.getByLabelText('Export chart as PNG')).toBeDisabled();
    });

    it('should disable export button when showing table view', async () => {
      const user = userEvent.setup();
      const tableData: TableData = {
        headers: ['X'],
        rows: [[1]],
      };

      render(
        <ChartContainer title="Chart" tableData={tableData}>
          <div>chart</div>
        </ChartContainer>,
      );

      await user.click(screen.getByLabelText('View as table'));

      expect(screen.getByLabelText('Export chart as PNG')).toBeDisabled();
    });

    it('should be enabled when chart is displayed with no error or loading', () => {
      render(
        <ChartContainer title="Chart">
          <div>chart</div>
        </ChartContainer>,
      );

      expect(screen.getByLabelText('Export chart as PNG')).not.toBeDisabled();
    });
  });

  describe('height prop', () => {
    it('should apply custom chart height as CSS variable', () => {
      const { container } = render(
        <ChartContainer title="Chart" height={600}>
          <div>chart</div>
        </ChartContainer>,
      );

      const body = container.querySelector('[style*="--chart-height"]');
      expect(body).toBeInTheDocument();
    });
  });
});
