import { describe, it, expect } from 'vitest';
import type { IndexHtmlTransformHook } from 'vite';

import { CSP_VALUE, cspMetaPlugin } from '@/buildtime/csp';

/**
 * Minimal stand-in for the build context Vite passes to transformIndexHtml.
 * The CSP hook only reads `html`, so an empty context is sufficient here.
 */
const HTML_TRANSFORM_CONTEXT = {
  path: '/index.html',
  filename: 'index.html',
} as unknown as Parameters<IndexHtmlTransformHook>[1];

/**
 * Resolve the plugin's transformIndexHtml hook to a callable function.
 *
 * Vite allows the hook to be either a bare function or an
 * `{ order, handler }` object; the CSP plugin uses the bare-function form, but
 * this normalizes both so the test does not depend on that detail.
 */
function getTransformHook(): IndexHtmlTransformHook {
  const plugin = cspMetaPlugin();
  const hook = plugin.transformIndexHtml;
  if (typeof hook === 'function') return hook;
  if (hook && typeof hook === 'object' && 'handler' in hook) return hook.handler;
  throw new Error('cspMetaPlugin did not expose a transformIndexHtml hook');
}

async function transform(html: string): Promise<string> {
  const hook = getTransformHook();
  const result = await hook.call(
    {} as ThisParameterType<typeof hook>,
    html,
    HTML_TRANSFORM_CONTEXT,
  );
  expect(typeof result).toBe('string');
  return result as string;
}

const META_TAG_RE = /<meta http-equiv="Content-Security-Policy"[^>]*>/g;

describe('cspMetaPlugin', () => {
  it('only applies during build, never in dev', () => {
    expect(cspMetaPlugin().apply).toBe('build');
  });

  it('injects exactly one CSP meta tag into <head> (no double-injection)', async () => {
    const html = '<html><head><title>CPAP Analyzer</title></head><body></body></html>';
    const out = await transform(html);

    const matches = out.match(META_TAG_RE) ?? [];
    expect(matches).toHaveLength(1);
  });

  it('places the CSP meta tag immediately after <head> so it precedes other head resources', async () => {
    const html =
      '<html><head><link rel="stylesheet" href="/app.css" /><title>CPAP Analyzer</title></head><body></body></html>';
    const out = await transform(html);

    const headIndex = out.indexOf('<head>');
    const metaIndex = out.search(META_TAG_RE);
    const linkIndex = out.indexOf('<link');

    // The meta tag comes right after <head> ...
    expect(metaIndex).toBe(headIndex + '<head>'.length + '\n    '.length);
    // ... and crucially before the first other head resource.
    expect(metaIndex).toBeLessThan(linkIndex);
  });

  it('embeds the assembled CSP_VALUE policy string in the injected tag', async () => {
    const html = '<html><head></head><body></body></html>';
    const out = await transform(html);

    expect(out).toContain(`content="${CSP_VALUE}"`);
  });

  it('includes the key security directives in the policy', () => {
    for (const directive of [
      "default-src 'self'",
      "worker-src 'self' blob:",
      "object-src 'none'",
    ]) {
      expect(CSP_VALUE).toContain(directive);
    }
  });

  it('allows exactly the expected connect-src hosts (weather + AI Insights), and keeps self', () => {
    // Isolate the connect-src directive from the assembled policy.
    const directive = CSP_VALUE.split('; ').find((d) => d.startsWith('connect-src '));
    expect(directive).toBeDefined();

    const tokens = (directive as string).slice('connect-src '.length).trim().split(/\s+/);
    expect(tokens).toEqual([
      "'self'",
      // Weather (Open-Meteo, keyless)
      'https://archive-api.open-meteo.com',
      'https://api.open-meteo.com',
      'https://air-quality-api.open-meteo.com',
      'https://geocoding-api.open-meteo.com',
      // AI Insights cloud backends (ADR 0024)
      'https://api.anthropic.com',
      'https://api.openai.com',
      // AI Insights loopback (local OpenAI-compatible servers)
      'http://localhost',
      'http://127.0.0.1',
    ]);
  });

  it('includes the AI Insights cloud hosts in connect-src', () => {
    const directive = CSP_VALUE.split('; ').find((d) => d.startsWith('connect-src '));
    expect(directive).toContain('https://api.anthropic.com');
    expect(directive).toContain('https://api.openai.com');
    expect(directive).toContain('http://localhost');
    expect(directive).toContain('http://127.0.0.1');
  });

  it('never uses a wildcard source anywhere in the policy', () => {
    // No bare wildcard, no scheme-wildcards, no host-wildcards (e.g. *.foo).
    // This is the load-bearing privacy guard: an arbitrary user-typed remote
    // OpenAI-compatible host is intentionally NOT supported rather than allowed
    // via a wildcard (ADR 0024 §4).
    expect(CSP_VALUE).not.toContain('*');
    expect(CSP_VALUE).not.toMatch(/connect-src[^;]*\*/);
  });

  it('restricts http:// origins in connect-src to loopback only (no remote http hosts)', () => {
    const directive = CSP_VALUE.split('; ').find((d) => d.startsWith('connect-src ')) ?? '';
    const httpTokens = directive
      .slice('connect-src '.length)
      .trim()
      .split(/\s+/)
      .filter((t) => t.startsWith('http://'));
    // Only loopback http origins are permitted; any other http:// origin would
    // broaden the cleartext egress surface.
    expect(httpTokens).toEqual(['http://localhost', 'http://127.0.0.1']);
  });
});
