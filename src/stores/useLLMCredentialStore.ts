/**
 * Session-scoped credential store for AI Insights cloud backends (ADR 0024 §4).
 *
 * ## Why this store exists (security rationale)
 *
 * BYO provider API keys (Anthropic, OpenAI-compatible) are a high-value
 * exfiltration target: a stored credential is more dangerous than anything the
 * app held before AI Insights existed. ADR 0024 §4 mandates that keys are
 * **NOT persisted to `localStorage` by default**, because the realistic threat
 * is XSS / local-storage exfiltration. The app's strict CSP and
 * no-third-party-script posture (ADR 0015) make injection hard, but a key in
 * `localStorage` is readable by any script that does run.
 *
 * Therefore:
 * - Keys live **in memory** by default (this zustand store is NOT wrapped in
 *   `persist`), so they are gone when the tab closes — the smallest exposure
 *   window.
 * - A user may *explicitly opt in* to "remember on this device", which mirrors
 *   the key into **`sessionStorage`** (cleared when the tab/session ends) — and
 *   **never `localStorage`**. This is a deliberate, per-key user choice, not the
 *   default, exactly as the ADR recommends.
 * - Keys are never logged, never placed in the grounded snapshot, and only ever
 *   travel as the provider auth header on a request the user triggered.
 *
 * This store is intentionally separate from {@link useSettingsStore} (which IS
 * persisted) so that the persisted settings blob can never carry a key.
 *
 * @module stores/useLLMCredentialStore
 */

import { create } from 'zustand';

/** Which provider a credential belongs to. */
export type LLMCredentialProvider = 'anthropic' | 'openai';

/**
 * Keys under which a remembered credential is mirrored into `sessionStorage`.
 * `sessionStorage` only — never `localStorage`.
 */
const SESSION_STORAGE_KEYS: Record<LLMCredentialProvider, string> = {
  anthropic: 'cpap-llm-cred-anthropic',
  openai: 'cpap-llm-cred-openai',
};

/**
 * Safe `sessionStorage` accessor. Guards against environments where
 * `sessionStorage` is unavailable (SSR, privacy modes, quota errors) so the
 * credential flow never throws.
 */
function safeSessionStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function readRemembered(provider: LLMCredentialProvider): string | null {
  const storage = safeSessionStorage();
  if (!storage) return null;
  try {
    return storage.getItem(SESSION_STORAGE_KEYS[provider]);
  } catch {
    return null;
  }
}

function writeRemembered(provider: LLMCredentialProvider, key: string | null): void {
  const storage = safeSessionStorage();
  if (!storage) return;
  try {
    if (key === null) {
      storage.removeItem(SESSION_STORAGE_KEYS[provider]);
    } else {
      storage.setItem(SESSION_STORAGE_KEYS[provider], key);
    }
  } catch {
    // Best-effort: if sessionStorage write fails, the key still lives in memory
    // for this session. We never fall back to localStorage.
  }
}

export interface LLMCredentialState {
  /** Anthropic (Claude) API key for the current session, or `null`. */
  readonly anthropicApiKey: string | null;
  /** OpenAI-compatible API key for the current session, or `null`. */
  readonly openaiApiKey: string | null;
  /**
   * Whether each key is being mirrored into `sessionStorage` ("remember on this
   * device"). Off by default; in-memory-only until the user opts in.
   */
  readonly remember: Readonly<Record<LLMCredentialProvider, boolean>>;

  /** Set (or clear, with `null`) a provider's key for this session. */
  setApiKey: (provider: LLMCredentialProvider, key: string | null) => void;
  /**
   * Toggle "remember on this device" for a provider. When enabling, the current
   * in-memory key (if any) is mirrored into `sessionStorage`; when disabling,
   * the mirrored copy is removed (the in-memory key is retained for the
   * session).
   */
  setRemember: (provider: LLMCredentialProvider, remember: boolean) => void;
  /** Forget a single provider's key (memory + any sessionStorage mirror). */
  forget: (provider: LLMCredentialProvider) => void;
  /** Forget all credentials (memory + all sessionStorage mirrors). */
  forgetAll: () => void;
}

/**
 * Hydrate the initial in-memory state from any remembered (sessionStorage)
 * credentials, so a page reload within the same tab session keeps a
 * deliberately-remembered key working without re-entry.
 */
function initialState(): Pick<LLMCredentialState, 'anthropicApiKey' | 'openaiApiKey' | 'remember'> {
  const anthropic = readRemembered('anthropic');
  const openai = readRemembered('openai');
  return {
    anthropicApiKey: anthropic,
    openaiApiKey: openai,
    remember: {
      anthropic: anthropic !== null,
      openai: openai !== null,
    },
  };
}

const KEY_FIELD: Record<LLMCredentialProvider, 'anthropicApiKey' | 'openaiApiKey'> = {
  anthropic: 'anthropicApiKey',
  openai: 'openaiApiKey',
};

/**
 * In-memory (session-scoped) credential store. Intentionally NOT persisted —
 * see the module docblock for the security rationale.
 */
export const useLLMCredentialStore = create<LLMCredentialState>((set, get) => ({
  ...initialState(),

  setApiKey: (provider, key) => {
    const normalized = key && key.length > 0 ? key : null;
    if (get().remember[provider]) {
      writeRemembered(provider, normalized);
    }
    set({ [KEY_FIELD[provider]]: normalized });
  },

  setRemember: (provider, remember) => {
    const currentKey = get()[KEY_FIELD[provider]];
    if (remember) {
      writeRemembered(provider, currentKey);
    } else {
      writeRemembered(provider, null);
    }
    set((state) => ({ remember: { ...state.remember, [provider]: remember } }));
  },

  forget: (provider) => {
    writeRemembered(provider, null);
    set((state) => ({
      [KEY_FIELD[provider]]: null,
      remember: { ...state.remember, [provider]: false },
    }));
  },

  forgetAll: () => {
    writeRemembered('anthropic', null);
    writeRemembered('openai', null);
    set({
      anthropicApiKey: null,
      openaiApiKey: null,
      remember: { anthropic: false, openai: false },
    });
  },
}));
