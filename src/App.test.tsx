import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from './App';

describe('App', () => {
  it('renders CPAP Analyzer heading', () => {
    render(<App />);

    const elements = screen.getAllByText(/cpap analyzer/i);
    expect(elements.length).toBeGreaterThan(0);
  });

  it('renders without crashing', () => {
    const { container } = render(<App />);

    expect(container).toBeTruthy();
    expect(container.innerHTML.length).toBeGreaterThan(0);
  });
});
