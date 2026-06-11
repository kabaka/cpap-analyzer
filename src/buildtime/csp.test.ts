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
  if (hook && typeof hook === 'object') {
    if ('handler' in hook) return hook.handler;
    if ('transform' in hook) return hook.transform;
  }
  throw new Error('cspMetaPlugin did not expose a transformIndexHtml hook');
}

async function transform(html: string): Promise<string> {
  const result = await getTransformHook()(html, HTML_TRANSFORM_CONTEXT);
  // The hook returns the rewritten HTML string for this plugin.
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
      "connect-src 'self'",
      "object-src 'none'",
    ]) {
      expect(CSP_VALUE).toContain(directive);
    }
  });
});
