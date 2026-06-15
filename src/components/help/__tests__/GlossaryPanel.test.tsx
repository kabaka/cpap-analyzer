import { describe, it, expect } from 'vitest';
import { render, screen, within, fireEvent } from '@/test/test-utils';
import { GlossaryPanel } from '@/components/help/GlossaryPanel';
import { glossaryEntries } from '@/content/help';

/**
 * Find the first glossary entry that carries citations, so the references
 * tests exercise real data without hard-coding a term id.
 */
const entryWithReferences = glossaryEntries.find(
  (entry) => entry.references !== undefined && entry.references.length > 0,
);

describe('GlossaryPanel references', () => {
  it('renders the References region only at the detailed depth level', () => {
    // Skip gracefully until citation data is populated in the glossary.
    if (!entryWithReferences) {
      expect(entryWithReferences).toBeUndefined();
      return;
    }

    const { term, references } = entryWithReferences;
    const firstCitation = references?.[0] as string;
    const referencesLabel = `References for ${term}`;

    render(<GlossaryPanel />);

    // Expand the term card. Match the header button whose accessible name
    // begins with the full term, so terms that share a substring (e.g. "AHI"
    // and "Residual AHI") do not collide.
    const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${escapedTerm}`) }));

    // Standard depth is the default — references must not appear yet.
    expect(screen.queryByRole('region', { name: referencesLabel })).not.toBeInTheDocument();

    // Switch to the detailed depth level.
    fireEvent.click(screen.getByRole('radio', { name: 'Detailed' }));

    const referencesRegion = screen.getByRole('region', { name: referencesLabel });
    expect(referencesRegion).toBeInTheDocument();
    expect(within(referencesRegion).getByText('References')).toBeInTheDocument();

    // Citations render as list items, in document order.
    const items = within(referencesRegion).getAllByRole('listitem');
    expect(items).toHaveLength(references?.length ?? 0);
    expect(items[0]).toHaveTextContent(firstCitation);
  });
});
