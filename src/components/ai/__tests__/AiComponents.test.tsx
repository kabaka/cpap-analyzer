/**
 * Tests for the AI-Insights atoms — {@link AiMarker}, {@link InsightCaveat}, and
 * {@link MedicalDisclaimer} (visual spec §1, §3.7; UX §4.5, §7.3, §7.8).
 *
 * Asserts the accessibility contract that color is never the sole signal: the ✨
 * glyph is `aria-hidden`, the literal "AI" text always carries the meaning, and
 * the caveat is a labelled `role="note"` region carrying the exact microcopy.
 *
 * @module components/ai/__tests__/AiComponents.test
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { AiMarker, InsightCaveat, MedicalDisclaimer, MEDICAL_DISCLAIMER_TEXT } from '../index';

describe('AiMarker', () => {
  it('renders the literal "AI" text and hides the ✨ glyph from assistive tech', () => {
    const { container } = render(<AiMarker />);
    expect(screen.getByText('AI')).toBeInTheDocument();
    const glyph = container.querySelector('[aria-hidden="true"]');
    expect(glyph).not.toBeNull();
    expect(glyph?.textContent).toBe('✨');
  });

  it('accepts a longer accessible label', () => {
    render(<AiMarker label="AI-generated" />);
    expect(screen.getByText('AI-generated')).toBeInTheDocument();
  });

  it('renders without throwing for every variant', () => {
    for (const variant of ['pill', 'tag', 'action'] as const) {
      const { unmount } = render(<AiMarker variant={variant} label="AI" />);
      expect(screen.getByText('AI')).toBeInTheDocument();
      unmount();
    }
  });
});

describe('InsightCaveat', () => {
  it('is a labelled note region with the exact primary microcopy', () => {
    render(<InsightCaveat />);
    const note = screen.getByRole('note', { name: 'AI disclaimer' });
    expect(note).toBeInTheDocument();
    expect(note).toHaveTextContent(
      'AI-generated — may be inaccurate. Verify against the numbers above.',
    );
    // The caveat carries the ✨ AI marker (text-bearing) so disclosure is inseparable.
    expect(note).toHaveTextContent('AI');
  });

  it('uses the compact microcopy in the compact variant', () => {
    render(<InsightCaveat variant="compact" />);
    expect(screen.getByRole('note', { name: 'AI disclaimer' })).toHaveTextContent(
      'AI-generated — verify against your data.',
    );
  });
});

describe('MedicalDisclaimer', () => {
  it('renders the full UX §7.8 disclaimer as a labelled note', () => {
    render(<MedicalDisclaimer />);
    const note = screen.getByRole('note', { name: 'Medical disclaimer' });
    expect(note).toHaveTextContent(MEDICAL_DISCLAIMER_TEXT);
    expect(note).toHaveTextContent(/not medical advice/i);
  });
});
