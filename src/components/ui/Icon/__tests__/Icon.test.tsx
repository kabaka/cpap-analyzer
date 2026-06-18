import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Icon, type IconName, type IconSize } from '@/components/ui/Icon/Icon';

/**
 * The Icon component is an inline-SVG glyph set used throughout the app chrome.
 * These tests validate its rendering contract and accessibility semantics
 * without coupling to the exact path geometry of any individual glyph.
 */
describe('Icon', () => {
  const ALL_NAMES: IconName[] = [
    'dashboard',
    'sessions',
    'trends',
    'explore',
    'reports',
    'data',
    'settings',
    'help',
    'theme-light',
    'theme-dark',
    'theme-system',
    'menu',
    'close',
    'storage',
    'calendar',
    'clock',
    'brand',
  ];

  describe('rendering', () => {
    it('renders an <svg> element for a given name', () => {
      const { container } = render(<Icon name="dashboard" />);
      const svg = container.querySelector('svg');
      expect(svg).not.toBeNull();
    });

    it('renders an svg with a 24x24 viewBox for every supported name', () => {
      for (const name of ALL_NAMES) {
        const { container } = render(<Icon name={name} />);
        const svg = container.querySelector('svg');
        expect(svg, `expected an svg for icon "${name}"`).not.toBeNull();
        expect(svg?.getAttribute('viewBox')).toBe('0 0 24 24');
      }
    });

    it('renders inner geometry (at least one child node) for each name', () => {
      for (const name of ALL_NAMES) {
        const { container } = render(<Icon name={name} />);
        const svg = container.querySelector('svg');
        // Decorative svgs should still contain glyph geometry; we assert
        // presence of children rather than the exact path `d` data so the
        // test survives geometry tweaks.
        expect(svg?.childNodes.length ?? 0).toBeGreaterThan(0);
      }
    });

    it('applies a provided className to the svg', () => {
      const { container } = render(<Icon name="settings" className="custom-class" />);
      expect(container.querySelector('svg')?.getAttribute('class')).toContain('custom-class');
    });

    it('marks the svg non-focusable', () => {
      const { container } = render(<Icon name="menu" />);
      expect(container.querySelector('svg')?.getAttribute('focusable')).toBe('false');
    });
  });

  describe('decorative (no title) behaviour', () => {
    it('is aria-hidden by default', () => {
      const { container } = render(<Icon name="storage" />);
      const svg = container.querySelector('svg');
      expect(svg?.getAttribute('aria-hidden')).toBe('true');
    });

    it('has no role and no accessible name when decorative', () => {
      const { container } = render(<Icon name="storage" />);
      const svg = container.querySelector('svg');
      expect(svg?.getAttribute('role')).toBeNull();
      expect(svg?.getAttribute('aria-label')).toBeNull();
    });

    it('renders no <title> element when decorative', () => {
      const { container } = render(<Icon name="storage" />);
      expect(container.querySelector('svg title')).toBeNull();
    });

    it('treats an empty-string title as decorative', () => {
      const { container } = render(<Icon name="storage" title="" />);
      const svg = container.querySelector('svg');
      expect(svg?.getAttribute('aria-hidden')).toBe('true');
      expect(svg?.getAttribute('role')).toBeNull();
      expect(container.querySelector('svg title')).toBeNull();
    });
  });

  describe('labelled (title provided) behaviour', () => {
    it('becomes role="img" with an accessible name', () => {
      const { container } = render(<Icon name="settings" title="Settings" />);
      const svg = container.querySelector('svg');
      expect(svg?.getAttribute('role')).toBe('img');
      expect(svg?.getAttribute('aria-label')).toBe('Settings');
    });

    it('is not aria-hidden when labelled', () => {
      const { container } = render(<Icon name="settings" title="Settings" />);
      expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBeNull();
    });

    it('renders a <title> element carrying the label text', () => {
      const { container } = render(<Icon name="help" title="Help" />);
      expect(container.querySelector('svg title')?.textContent).toBe('Help');
    });
  });

  describe('size token mapping', () => {
    const cases: Array<[IconSize, string]> = [
      ['sm', 'var(--icon-size-sm)'],
      ['md', 'var(--icon-size-md)'],
      ['lg', 'var(--icon-size-lg)'],
    ];

    it.each(cases)('maps size "%s" to width/height %s', (size, expected) => {
      const { container } = render(<Icon name="brand" size={size} />);
      const svg = container.querySelector('svg');
      expect(svg?.getAttribute('width')).toBe(expected);
      expect(svg?.getAttribute('height')).toBe(expected);
    });

    it('defaults to the md size token when size is omitted', () => {
      const { container } = render(<Icon name="brand" />);
      const svg = container.querySelector('svg');
      expect(svg?.getAttribute('width')).toBe('var(--icon-size-md)');
      expect(svg?.getAttribute('height')).toBe('var(--icon-size-md)');
    });

    it('always sets matching width and height', () => {
      for (const size of ['sm', 'md', 'lg'] as IconSize[]) {
        const { container } = render(<Icon name="clock" size={size} />);
        const svg = container.querySelector('svg');
        expect(svg?.getAttribute('width')).toBe(svg?.getAttribute('height'));
      }
    });
  });
});
