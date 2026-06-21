/**
 * Ambient declarations for Chrome's experimental built-in AI globals
 * (`LanguageModel`, `Summarizer`) used by {@link chromeAiProvider}.
 *
 * These are NOT in the standard DOM lib (the API is still experimental /
 * origin-trial), so we declare the minimal surface the provider actually uses.
 * Kept local to the providers directory; nothing else depends on it.
 *
 * Shape per the Prompt API / Summarizer API explainers:
 * - `LanguageModel.availability()` → an availability state.
 * - `LanguageModel.create()` → a session with `promptStreaming()`.
 *
 * @see https://developer.chrome.com/docs/ai/prompt-api
 */

/** Native availability states reported by the built-in AI APIs. */
type ChromeAIAvailability = 'unavailable' | 'downloadable' | 'downloading' | 'available';

/** Progress event surfaced during a one-time on-device model provision. */
interface ChromeAIDownloadProgressEvent extends Event {
  /** Fractional completion in `[0, 1]`. */
  readonly loaded: number;
}

interface ChromeAICreateMonitor {
  addEventListener(
    type: 'downloadprogress',
    listener: (event: ChromeAIDownloadProgressEvent) => void,
  ): void;
}

interface ChromeAICreateOptions {
  signal?: AbortSignal;
  monitor?: (monitor: ChromeAICreateMonitor) => void;
  initialPrompts?: ReadonlyArray<{ role: 'system' | 'user' | 'assistant'; content: string }>;
}

interface ChromeAILanguageModelSession {
  promptStreaming(input: string, options?: { signal?: AbortSignal }): ReadableStream<string>;
  destroy(): void;
}

interface ChromeAILanguageModelStatic {
  availability(): Promise<ChromeAIAvailability>;
  create(options?: ChromeAICreateOptions): Promise<ChromeAILanguageModelSession>;
}

// The experimental globals, present only in supporting browsers.
declare const LanguageModel: ChromeAILanguageModelStatic | undefined;
