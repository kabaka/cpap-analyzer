import { useMemo } from 'react';
import katex from 'katex';

export interface MathEquationProps {
  /** LaTeX string to render. */
  readonly math: string;
  /** Use display mode (block) when true, inline mode when false. */
  readonly display?: boolean;
  /** Additional CSS class name. */
  readonly className?: string;
}

/**
 * Renders a LaTeX math expression using KaTeX.
 *
 * Uses `katex.renderToString()` and injects the resulting HTML. Falls back
 * to a styled `<code>` element if KaTeX fails to parse the expression.
 */
export function MathEquation({ math, display = false, className }: MathEquationProps) {
  const rendered = useMemo(() => {
    try {
      return {
        html: katex.renderToString(math, {
          displayMode: display,
          throwOnError: false,
          output: 'html',
          strict: false,
        }),
        error: false,
      };
    } catch {
      return { html: '', error: true };
    }
  }, [math, display]);

  if (rendered.error) {
    return (
      <code className={className} aria-label={`Math: ${math}`}>
        {math}
      </code>
    );
  }

  const Tag = display ? 'div' : 'span';

  return (
    <Tag
      className={className}
      dangerouslySetInnerHTML={{ __html: rendered.html }}
      role="math"
      aria-label={math}
    />
  );
}
