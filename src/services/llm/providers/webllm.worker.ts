/**
 * Web Worker host for the WebLLM (MLC) engine.
 *
 * WebLLM runs the model on WebGPU; doing so on the UI thread would block
 * rendering during the (heavy) prefill/decode. This worker hosts the engine's
 * message handler so generation runs off the main thread, matching the
 * codebase's `new Worker(new URL(...), { type: 'module' })` convention
 * (`src/services/workers/`).
 *
 * The `@mlc-ai/web-llm` package is **dynamically imported** so it lands in its
 * own async chunk and never enters the main bundle. The main-thread side
 * connects via `CreateWebWorkerMLCEngine` (see `webllmProvider.ts`), which
 * speaks WebLLM's own worker protocol — this file only forwards messages into
 * the engine's `WebWorkerMLCEngineHandler`.
 *
 * @module services/llm/providers/webllm.worker
 */

/**
 * The handler is created lazily on the first inbound message so the dynamic
 * import (and thus the WebLLM chunk fetch) happens only when a WebLLM
 * generation is actually requested.
 */
let handlerPromise: Promise<{ onmessage: (event: MessageEvent) => void }> | null = null;

function getHandler(): Promise<{ onmessage: (event: MessageEvent) => void }> {
  if (handlerPromise === null) {
    handlerPromise = import('@mlc-ai/web-llm').then(
      (webllm) => new webllm.WebWorkerMLCEngineHandler(),
    );
  }
  return handlerPromise;
}

self.onmessage = (event: MessageEvent): void => {
  void getHandler().then((handler) => {
    handler.onmessage(event);
  });
};
