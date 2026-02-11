import { describe, it, expect } from 'vitest';
import { render, screen } from '@test/test-utils';
import { Input } from '@/components/ui/Input';

describe('Input', () => {
  it('should render with label', () => {
    render(<Input label="Email" />);
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
  });

  it('should show error message when error prop provided', () => {
    render(<Input label="Name" error="Name is required" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Name is required');
  });

  it('should set aria-invalid when error is present', () => {
    render(<Input label="Name" error="Required" />);
    expect(screen.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true');
  });

  it('should show hint when hint prop provided', () => {
    render(<Input label="Password" hint="At least 8 characters" />);
    expect(screen.getByText('At least 8 characters')).toBeInTheDocument();
  });

  it('should not show hint when error is present', () => {
    render(<Input label="Password" hint="At least 8 chars" error="Too short" />);
    expect(screen.queryByText('At least 8 chars')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Too short');
  });

  it('should forward input props like placeholder and type', () => {
    render(<Input label="Age" type="number" placeholder="Enter age" />);
    const input = screen.getByLabelText('Age');
    expect(input).toHaveAttribute('type', 'number');
    expect(input).toHaveAttribute('placeholder', 'Enter age');
  });

  it('should render an input element', () => {
    render(<Input label="Test" />);
    expect(screen.getByLabelText('Test').tagName).toBe('INPUT');
  });
});
