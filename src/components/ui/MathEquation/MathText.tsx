import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { MathEquation } from './MathEquation';

export interface MathTextProps {
  /** Text containing optional LaTeX delimiters (`$...$` for inline, `$$...$$` for display). */
  readonly text: string;
  /** Additional CSS class name for the wrapper. */
  readonly className?: string;
}

/**
 * Segment produced by splitting text on LaTeX delimiters.
 */
interface Segment {
  readonly type: 'text' | 'inline-math' | 'display-math';
  readonly content: string;
}

/**
 * Parse a string into segments of plain text and LaTeX math.
 *
 * Recognises `$$...$$` (display mode) and `$...$` (inline mode).
 * Avoids matching escaped dollar signs (`\$`).
 */
function parseSegments(text: string): Segment[] {
  const segments: Segment[] = [];

  // Match $$...$$ (display) and $...$ (inline), non-greedy.
  // The regex uses negative lookbehind for backslash to skip \$.
  const regex = /(?<!\\)\$\$(.+?)(?<!\\)\$\$|(?<!\\)\$(.+?)(?<!\\)\$/gs;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    // Push preceding plain text
    if (match.index > lastIndex) {
      segments.push({ type: 'text', content: text.slice(lastIndex, match.index) });
    }

    if (match[1] !== undefined) {
      // Display math ($$...$$)
      segments.push({ type: 'display-math', content: match[1] });
    } else if (match[2] !== undefined) {
      // Inline math ($...$)
      segments.push({ type: 'inline-math', content: match[2] });
    }

    lastIndex = match.index + match[0].length;
  }

  // Trailing text
  if (lastIndex < text.length) {
    segments.push({ type: 'text', content: text.slice(lastIndex) });
  }

  return segments;
}

/**
 * Renders a string that may contain LaTeX math delimiters.
 *
 * Plain text is rendered as-is. Inline math (`$...$`) is rendered with
 * KaTeX in inline mode. Display math (`$$...$$`) is rendered in block mode.
 *
 * If the text contains no math delimiters, it is rendered as a plain string
 * (no unnecessary wrapper elements).
 */
export function MathText({ text, className }: MathTextProps) {
  const segments = useMemo(() => parseSegments(text), [text]);

  // Fast path: no math found — return plain text.
  if (segments.length === 1 && segments[0]?.type === 'text') {
    return <>{text}</>;
  }

  const children: ReactNode[] = segments.map((seg, i) => {
    switch (seg.type) {
      case 'text':
        return <span key={i}>{seg.content}</span>;
      case 'inline-math':
        return <MathEquation key={i} math={seg.content} display={false} />;
      case 'display-math':
        return <MathEquation key={i} math={seg.content} display={true} />;
    }
  });

  return <span className={className}>{children}</span>;
}
