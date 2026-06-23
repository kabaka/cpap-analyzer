/**
 * Settings → Integrations → "AI Insights" panel (de-stubs the `llm` accordion
 * item). Built against `docs/design/ai-insights-ux.md` §3 and
 * `docs/design/ai-insights-visual.md` §2/§4.
 *
 * Lifecycle (mirrors {@link import('../weather/WeatherIntegrationPanel')}):
 * - **Gate 1** — the enable switch. Toggling on reveals config with a
 *   privacy-preferring local backend pre-selected; it does NOT egress.
 * - **Backend radiogroup** — four options, two on-device (default group) and two
 *   cloud, each with an inline privacy badge + availability status.
 * - **Per-backend config** — WebLLM (WebGPU detection + curated model picker with
 *   disclosed download sizes), Chrome built-in (availability detection), Claude
 *   (API key → credential store, model selector + cost note), and
 *   OpenAI-compatible (base URL + model + key, loopback detection).
 * - **Gate 2** — the cloud-egress {@link ConsentDialog}. Selecting a cloud
 *   backend (Claude, or a non-loopback OpenAI-compatible URL) requires passing
 *   consent before the backend is committed; on accept we persist
 *   `consentAt` + `consentContractVersion`. A stale contract version forces
 *   re-consent. Local backends need no consent.
 *
 * Security: API keys are written to {@link useLLMCredentialStore} (session-scoped,
 * never persisted) — never into the settings store (ADR 0024 §4).
 *
 * @module views/Settings/ai/AiInsightsPanel
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Input, Select, Switch } from '@/components/ui';
import { MedicalDisclaimer } from '@/components/ai';
import { ModelDownloadProgress } from '@/components/insights/ModelDownloadProgress';
import { useModelDownload } from '@/hooks/useModelDownload';
import type { DownloadProvider } from '@/hooks/useModelDownload';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { useLLMCredentialStore } from '@/stores/useLLMCredentialStore';
import { ChromeAIProvider } from '@/services/llm/providers/chromeAiProvider';
import { WebLLMProvider } from '@/services/llm/providers/webllmProvider';
import type { BackendAvailability } from '@/services/llm/types';
import { EGRESS_CONTRACT_VERSION } from '@/types/settings';
import type { LLMAnthropicModel, LLMBackendId } from '@/types/settings';
import { BackendRadioGroup } from './BackendRadioGroup';
import type { BackendDisabledMap, BackendStatusMap } from './BackendRadioGroup';
import { ConsentDialog } from './ConsentDialog';
import {
  ANTHROPIC_MODELS,
  backendById,
  backendNeedsConsent,
  DEFAULT_WEBLLM_MODEL_ID,
  isLoopbackUrl,
  WEBLLM_MODELS,
  webllmModelById,
} from './backends';
import styles from './AiInsightsPanel.module.css';

/**
 * Hosts allowed by `connect-src` for an OpenAI-compatible endpoint. A
 * non-loopback host that is not in this allowlist will be blocked by CSP at
 * request time; we surface the documented limitation note up front (UX §6 CSP).
 * `security` owns the authoritative allowlist; the OpenAI default origin is the
 * one entry currently permitted.
 */
const OPENAI_COMPAT_ALLOWED_HOSTS: readonly string[] = ['api.openai.com'];

/** Whether a configured non-loopback URL targets an allowlisted host. */
function isAllowlistedHost(rawUrl: string | null): boolean {
  if (rawUrl === null || rawUrl.trim().length === 0) return false;
  try {
    return OPENAI_COMPAT_ALLOWED_HOSTS.includes(new URL(rawUrl).hostname.toLowerCase());
  } catch {
    return false;
  }
}

/** Optional-injection hooks (tests pass deterministic providers here). */
export interface AiInsightsPanelProps {
  /** Override the WebLLM availability probe (defaults to a real provider check). */
  readonly checkWebLLM?: () => Promise<BackendAvailability>;
  /** Override the Chrome-AI availability probe. */
  readonly checkChromeAI?: () => Promise<BackendAvailability>;
  /**
   * Override the WebLLM download-provider factory used by the Settings download
   * affordance (defaults to a real {@link WebLLMProvider}); overridden in tests.
   */
  readonly downloadProviderFactory?: (modelId: string | null) => DownloadProvider;
}

export function AiInsightsPanel({
  checkWebLLM,
  checkChromeAI,
  downloadProviderFactory,
}: AiInsightsPanelProps = {}): JSX.Element {
  const llm = useSettingsStore((s) => s.integrations.llm);
  const updateIntegration = useSettingsStore((s) => s.updateIntegration);

  // Credential store (keys live here, never in persisted settings).
  const anthropicApiKey = useLLMCredentialStore((s) => s.anthropicApiKey);
  const openaiApiKey = useLLMCredentialStore((s) => s.openaiApiKey);
  const remember = useLLMCredentialStore((s) => s.remember);
  const setApiKey = useLLMCredentialStore((s) => s.setApiKey);
  const setRemember = useLLMCredentialStore((s) => s.setRemember);

  // Availability of the two local backends (feature-detection only, no egress).
  const [webllmAvail, setWebllmAvail] = useState<BackendAvailability | null>(null);
  const [chromeAvail, setChromeAvail] = useState<BackendAvailability | null>(null);

  // Pending cloud backend awaiting consent (Gate 2). `null` when no dialog open.
  const [pendingBackend, setPendingBackend] = useState<LLMBackendId | null>(null);

  // Show/hide for the two password fields.
  const [showAnthropicKey, setShowAnthropicKey] = useState(false);
  const [showOpenAiKey, setShowOpenAiKey] = useState(false);

  // Working draft for the OpenAI-compatible base URL (committed on blur so we
  // don't re-derive consent on every keystroke).
  const [baseUrlInput, setBaseUrlInput] = useState(llm.openaiCompatible.baseUrl ?? '');

  // Keep the draft in sync if the stored value changes elsewhere.
  useEffect(() => {
    setBaseUrlInput(llm.openaiCompatible.baseUrl ?? '');
  }, [llm.openaiCompatible.baseUrl]);

  // ── Local-backend availability detection (run when enabled) ──

  const probeWebLLM = useCallback(async () => {
    const check =
      checkWebLLM ??
      (() => new WebLLMProvider({ modelId: llm.webllm.modelId }).checkAvailability());
    try {
      setWebllmAvail(await check());
    } catch {
      setWebllmAvail({ state: 'unsupported', reason: 'On-device AI could not be checked' });
    }
  }, [checkWebLLM, llm.webllm.modelId]);

  const probeChrome = useCallback(async () => {
    const check = checkChromeAI ?? (() => new ChromeAIProvider().checkAvailability());
    try {
      setChromeAvail(await check());
    } catch {
      setChromeAvail({ state: 'unsupported', reason: "Chrome's built-in AI could not be checked" });
    }
  }, [checkChromeAI]);

  useEffect(() => {
    if (!llm.enabled) return;
    void probeWebLLM();
    void probeChrome();
  }, [llm.enabled, probeWebLLM, probeChrome]);

  // ── Gate 1: enable / disable ──

  const handleToggle = useCallback(
    (checked: boolean) => {
      if (checked) {
        // Enable with the privacy-preferring local backend pre-selected. Never
        // auto-select cloud. Prefer WebLLM; fall back to Chrome-AI only if WebGPU
        // is unsupported but Chrome built-in is available.
        const webllmUnsupported = webllmAvail?.state === 'unsupported';
        const chromeAvailable =
          chromeAvail?.state === 'available' || chromeAvail?.state === 'needs-download';
        const initialBackend: LLMBackendId =
          webllmUnsupported && chromeAvailable ? 'chrome-ai' : 'webllm';
        const seedModel =
          llm.webllm.modelId === null ? { modelId: DEFAULT_WEBLLM_MODEL_ID } : llm.webllm;
        updateIntegration('llm', {
          enabled: true,
          backend: initialBackend,
          webllm: seedModel,
        });
      } else {
        updateIntegration('llm', { enabled: false });
      }
    },
    [updateIntegration, webllmAvail, chromeAvail, llm.webllm],
  );

  // ── Backend selection (Gate 2 for cloud) ──

  const commitBackend = useCallback(
    (backend: LLMBackendId) => {
      updateIntegration('llm', { backend });
    },
    [updateIntegration],
  );

  // Whether prior consent is still valid for the current contract version.
  const consentValid =
    llm.consentAt !== null && llm.consentContractVersion === EGRESS_CONTRACT_VERSION;

  const handleSelectBackend = useCallback(
    (backend: LLMBackendId) => {
      const needsConsent = backendNeedsConsent(backend, llm.openaiCompatible.baseUrl);
      if (needsConsent && !consentValid) {
        // Gate 2: do not commit the backend until consent passes.
        setPendingBackend(backend);
        return;
      }
      commitBackend(backend);
    },
    [commitBackend, consentValid, llm.openaiCompatible.baseUrl],
  );

  const handleConsentEnable = useCallback(() => {
    const backend = pendingBackend;
    setPendingBackend(null);
    if (backend === null) return;
    updateIntegration('llm', {
      backend,
      consentAt: new Date().toISOString(),
      consentContractVersion: EGRESS_CONTRACT_VERSION,
    });
  }, [pendingBackend, updateIntegration]);

  const handleConsentCancel = useCallback(() => {
    // Revert: the backend is NOT committed; selection stays as it was.
    setPendingBackend(null);
  }, []);

  // ── OpenAI-compatible base URL: re-derive consent when it changes ──

  const commitBaseUrl = useCallback(() => {
    const next = baseUrlInput.trim() === '' ? null : baseUrlInput.trim();
    if (next === llm.openaiCompatible.baseUrl) return;
    updateIntegration('llm', {
      openaiCompatible: { ...llm.openaiCompatible, baseUrl: next },
    });
    // If this backend is active and the new URL now egresses without valid
    // consent, drop the backend selection back so the user must re-pass Gate 2.
    if (
      llm.backend === 'openai-compatible' &&
      backendNeedsConsent('openai-compatible', next) &&
      !consentValid
    ) {
      setPendingBackend('openai-compatible');
    }
  }, [baseUrlInput, llm.openaiCompatible, llm.backend, updateIntegration, consentValid]);

  // ── Derived UI state for the radiogroup ──

  const statusMap: BackendStatusMap = {
    webllm: webllmAvail?.reason ?? (webllmAvail?.state === 'available' ? 'Ready' : null),
    'chrome-ai': chromeAvail?.reason ?? (chromeAvail?.state === 'available' ? 'Ready' : null),
    anthropic: anthropicApiKey === null ? 'Key required' : 'Key set',
    'openai-compatible':
      llm.openaiCompatible.baseUrl === null
        ? 'Endpoint required'
        : isLoopbackUrl(llm.openaiCompatible.baseUrl)
          ? 'Local endpoint · no consent needed'
          : 'Connects online · consent required',
  };

  // Unsupported local backends stay visible but non-selectable (UX §3.4/§3.5).
  const disabledMap: BackendDisabledMap = {
    webllm: webllmAvail?.state === 'unsupported',
    'chrome-ai': chromeAvail?.state === 'unsupported',
  };

  return (
    <div className={styles.panel}>
      {/* Gate 1 — enable switch */}
      <div className={styles.switchRow}>
        <div className={styles.switchInfo}>
          <span className={styles.switchLabel}>Enable AI Insights</span>
          <span className={styles.switchDescription}>
            Turn computed metrics into plain-language summaries and explanations. The app does all
            the math; the AI only puts your existing numbers into words — it never calculates,
            diagnoses, or changes your therapy. Choose an on-device option to keep everything on
            your device, or a cloud option (your own API key) for higher-quality wording. AI output
            can be wrong; always check it against your data.
          </span>
        </div>
        <Switch checked={llm.enabled} onCheckedChange={handleToggle} />
      </div>

      {llm.enabled && (
        <div className={styles.config}>
          {/* Backend selector */}
          <BackendRadioGroup
            value={llm.backend}
            onChange={handleSelectBackend}
            status={statusMap}
            disabled={disabledMap}
          />

          {/* Per-backend config */}
          {llm.backend === 'webllm' && (
            <WebLLMConfig
              availability={webllmAvail}
              modelId={llm.webllm.modelId}
              onModelChange={(modelId) =>
                updateIntegration('llm', { webllm: { ...llm.webllm, modelId } })
              }
              onDownloaded={probeWebLLM}
              {...(downloadProviderFactory ? { downloadProviderFactory } : {})}
            />
          )}

          {llm.backend === 'chrome-ai' && <ChromeAIConfig availability={chromeAvail} />}

          {llm.backend === 'anthropic' && (
            <AnthropicConfig
              apiKey={anthropicApiKey}
              showKey={showAnthropicKey}
              onToggleShowKey={() => setShowAnthropicKey((v) => !v)}
              onKeyChange={(key) => setApiKey('anthropic', key)}
              remember={remember.anthropic}
              onRememberChange={(r) => setRemember('anthropic', r)}
              model={llm.anthropic.model}
              onModelChange={(model) =>
                updateIntegration('llm', { anthropic: { ...llm.anthropic, model } })
              }
            />
          )}

          {llm.backend === 'openai-compatible' && (
            <OpenAICompatibleConfig
              baseUrlInput={baseUrlInput}
              onBaseUrlInput={setBaseUrlInput}
              onBaseUrlBlur={commitBaseUrl}
              model={llm.openaiCompatible.model}
              onModelChange={(model) =>
                updateIntegration('llm', {
                  openaiCompatible: { ...llm.openaiCompatible, model: model || null },
                })
              }
              apiKey={openaiApiKey}
              showKey={showOpenAiKey}
              onToggleShowKey={() => setShowOpenAiKey((v) => !v)}
              onKeyChange={(key) => setApiKey('openai', key)}
              remember={remember.openai}
              onRememberChange={(r) => setRemember('openai', r)}
              loopback={isLoopbackUrl(llm.openaiCompatible.baseUrl)}
              allowlisted={isAllowlistedHost(llm.openaiCompatible.baseUrl)}
            />
          )}

          <MedicalDisclaimer className={styles.disclaimer} />
        </div>
      )}

      {/* Gate 2 — cloud-egress consent dialog */}
      <ConsentDialog
        open={pendingBackend !== null}
        backendName={pendingBackend !== null ? backendById(pendingBackend).label : ''}
        onCancel={handleConsentCancel}
        onEnable={handleConsentEnable}
      />
    </div>
  );
}

// ─── Per-backend config subcomponents ───────────────────────────────────────

interface WebLLMConfigProps {
  readonly availability: BackendAvailability | null;
  readonly modelId: string | null;
  readonly onModelChange: (modelId: string) => void;
  /** Re-probe availability after a successful download (so the picker → "Ready"). */
  readonly onDownloaded: () => void | Promise<void>;
  /** Injectable download-provider factory (tests). */
  readonly downloadProviderFactory?: (modelId: string | null) => DownloadProvider;
}

function WebLLMConfig({
  availability,
  modelId,
  onModelChange,
  onDownloaded,
  downloadProviderFactory,
}: WebLLMConfigProps): JSX.Element {
  const selectWrapRef = useRef<HTMLDivElement>(null);
  // `useModelDownload` defaults to a real provider when no factory is injected;
  // pass `undefined` straight through so the hook is called unconditionally
  // (rules of hooks) with its own default.
  const download = useModelDownload(modelId, downloadProviderFactory);

  // A new model selection resets the download lifecycle (spec §3, acceptance).
  useEffect(() => {
    download.reset();
    // `download.reset` is stable; depend on the model id only so a re-render
    // mid-download doesn't wipe progress.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelId]);

  // On a successful download, re-probe availability once so the radiogroup +
  // status flip to "Ready" / "Available" without a manual refresh (spec §3.1).
  const lastProbedDone = useRef(false);
  useEffect(() => {
    if (download.state === 'done' && !lastProbedDone.current) {
      lastProbedDone.current = true;
      void onDownloaded();
    }
    if (download.state !== 'done') lastProbedDone.current = false;
    // onDownloaded identity is stable from the parent's useCallback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [download.state]);

  // On an out-of-memory failure, move focus to the model picker so the user can
  // immediately pick a smaller model (spec §3.2 / §6). `Select` is a Radix
  // component (no native ref), so focus its trigger button via the wrapper.
  useEffect(() => {
    if (download.state === 'error' && download.error?.kind === 'model-load-failed') {
      selectWrapRef.current?.querySelector<HTMLElement>('[role="combobox"], button')?.focus();
    }
  }, [download.state, download.error]);

  if (availability?.state === 'unsupported') {
    return (
      <div className={styles.fallbackNotice} role="note">
        On-device AI (WebLLM) needs WebGPU, which this browser or device doesn&apos;t support. You
        can use Chrome&apos;s built-in AI if available, or a cloud option with your own API key.
        Nothing here changes your data or therapy.
      </div>
    );
  }

  const selected = webllmModelById(modelId);
  const sizeLabel = selected?.sizeLabel ?? '';
  // "done" reflects either a just-finished download or a model already cached.
  const downloaded = availability?.state === 'available' || download.state === 'done';

  return (
    <fieldset className={styles.group}>
      <legend className={styles.groupLegend}>On-device model</legend>
      <div ref={selectWrapRef}>
        <Select
          label="Model"
          value={modelId ?? ''}
          onValueChange={onModelChange}
          placeholder="Choose a model…"
          options={WEBLLM_MODELS.map((m) => ({
            value: m.id,
            label: `${m.label} — ${m.sizeLabel} — ${m.note}`,
          }))}
        />
      </div>
      {selected && (
        <p className={styles.storageNote}>
          This model downloads about {selected.sizeLabel} and is stored in your browser so it can
          run fully on-device. It counts toward the storage shown in Privacy &amp; Storage, and you
          can remove it any time.
        </p>
      )}

      {/* ── Download lifecycle (spec §3.1) ─────────────────────────────────── */}
      {download.isActive ? (
        <ModelDownloadProgress
          variant="settings"
          phase={download.progress?.phase ?? 'downloading'}
          fraction={download.progress?.fraction ?? null}
          statusText={download.progress?.text ?? ''}
          sizeLabel={sizeLabel}
          {...(selected ? { modelLabel: selected.label } : {})}
          onCancel={download.cancel}
        />
      ) : downloaded ? (
        <p className={styles.statusLine}>
          <span className={styles.statusReady}>
            <span aria-hidden="true">✓ </span>Downloaded — ready. Runs entirely on your device.
          </span>
        </p>
      ) : download.state === 'error' && download.error !== null ? (
        <DownloadError error={download.error} onRetry={download.start} />
      ) : (
        <>
          {download.state === 'cancelled' && (
            <p className={styles.statusLine}>
              <span className={styles.statusPending}>
                Download cancelled. The partial download is discarded.
              </span>
            </p>
          )}
          <p className={styles.statusLine}>
            <span className={styles.statusPending}>
              {selected
                ? `Needs a one-time download (${sizeLabel}).`
                : 'Choose a model to continue.'}
            </span>
          </p>
          <Button variant="primary" onClick={download.start} disabled={selected === null}>
            {selected ? `Download model (${sizeLabel})` : 'Download model'}
          </Button>
        </>
      )}
    </fieldset>
  );
}

/**
 * The Settings download-error block (spec §3.2). Maps `LLMError.kind` onto the
 * plain-language message + retry; OOM steers the user at a smaller model.
 */
function DownloadError({
  error,
  onRetry,
}: {
  readonly error: { readonly kind: string };
  readonly onRetry: () => void;
}): JSX.Element {
  let message: string;
  switch (error.kind) {
    case 'network-blocked':
      message =
        "The model download was interrupted. Check your connection and try again — it resumes from where browsers cache it, so you won't always re-download everything.";
      break;
    case 'model-load-failed':
      message =
        "This model couldn't load on this device — it may need more memory. Try a smaller model below.";
      break;
    default:
      message = 'The download ran into a problem. Try again.';
  }
  return (
    <div className={styles.fallbackNotice} role="alert">
      <p className={styles.statusLine}>{message}</p>
      <Button variant="secondary" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

interface ChromeAIConfigProps {
  readonly availability: BackendAvailability | null;
}

function ChromeAIConfig({ availability }: ChromeAIConfigProps): JSX.Element {
  if (availability?.state === 'unsupported') {
    return (
      <div className={styles.fallbackNotice} role="note">
        Chrome&apos;s built-in AI isn&apos;t available in this browser. It needs a recent Chrome
        with on-device AI support. You can use the in-browser (WebLLM) option or a cloud option
        instead.
      </div>
    );
  }

  return (
    <fieldset className={styles.group}>
      <legend className={styles.groupLegend}>Chrome built-in AI</legend>
      <p className={styles.statusLine}>
        {availability?.state === 'available' ? (
          <span className={styles.statusReady}>
            Ready — runs on-device, nothing leaves your browser.
          </span>
        ) : (
          <span className={styles.statusPending}>
            {availability?.reason ?? 'Checking availability…'}
          </span>
        )}
      </p>
    </fieldset>
  );
}

interface AnthropicConfigProps {
  readonly apiKey: string | null;
  readonly showKey: boolean;
  readonly onToggleShowKey: () => void;
  readonly onKeyChange: (key: string) => void;
  readonly remember: boolean;
  readonly onRememberChange: (remember: boolean) => void;
  readonly model: LLMAnthropicModel;
  readonly onModelChange: (model: LLMAnthropicModel) => void;
}

function AnthropicConfig({
  apiKey,
  showKey,
  onToggleShowKey,
  onKeyChange,
  remember,
  onRememberChange,
  model,
  onModelChange,
}: AnthropicConfigProps): JSX.Element {
  const selectedNote = ANTHROPIC_MODELS.find((m) => m.id === model)?.note;
  return (
    <fieldset className={styles.group}>
      <legend className={styles.groupLegend}>Claude (Anthropic)</legend>

      <div className={styles.keyRow}>
        <Input
          label="Claude API key"
          type={showKey ? 'text' : 'password'}
          autoComplete="off"
          value={apiKey ?? ''}
          onChange={(e) => onKeyChange(e.target.value)}
          placeholder="sk-ant-…"
          hint="Stored on this device only — never sent anywhere except Anthropic on requests you trigger."
        />
        <Button variant="ghost" onClick={onToggleShowKey} aria-pressed={showKey}>
          {showKey ? 'Hide' : 'Show'}
        </Button>
      </div>

      <label className={styles.checkRow}>
        <input
          type="checkbox"
          checked={remember}
          onChange={(e) => onRememberChange(e.target.checked)}
        />
        <span>Remember on this device (this session)</span>
      </label>

      <Select
        label="Model"
        value={model}
        onValueChange={(v) => onModelChange(v as LLMAnthropicModel)}
        options={ANTHROPIC_MODELS.map((m) => ({ value: m.id, label: `${m.label} — ${m.note}` }))}
      />
      {selectedNote && <p className={styles.statusLine}>{selectedNote}</p>}

      <p className={styles.costNote}>
        Each summary sends a small metric snapshot to Anthropic and uses your own API account, so it
        has a small cost per request. On-device options are free. Opus is highest quality and costs
        the most per request; Haiku is fastest and cheapest; Sonnet is a balanced default.
      </p>
    </fieldset>
  );
}

interface OpenAICompatibleConfigProps {
  readonly baseUrlInput: string;
  readonly onBaseUrlInput: (value: string) => void;
  readonly onBaseUrlBlur: () => void;
  readonly model: string | null;
  readonly onModelChange: (model: string) => void;
  readonly apiKey: string | null;
  readonly showKey: boolean;
  readonly onToggleShowKey: () => void;
  readonly onKeyChange: (key: string) => void;
  readonly remember: boolean;
  readonly onRememberChange: (remember: boolean) => void;
  readonly loopback: boolean;
  readonly allowlisted: boolean;
}

function OpenAICompatibleConfig({
  baseUrlInput,
  onBaseUrlInput,
  onBaseUrlBlur,
  model,
  onModelChange,
  apiKey,
  showKey,
  onToggleShowKey,
  onKeyChange,
  remember,
  onRememberChange,
  loopback,
  allowlisted,
}: OpenAICompatibleConfigProps): JSX.Element {
  const hasUrl = baseUrlInput.trim().length > 0;
  // A non-loopback, non-allowlisted host will be blocked by CSP (UX §6).
  const cspBlocked = hasUrl && !loopback && !allowlisted;

  return (
    <fieldset className={styles.group}>
      <legend className={styles.groupLegend}>OpenAI-compatible / Ollama</legend>

      <Input
        label="Endpoint base URL"
        type="url"
        inputMode="url"
        value={baseUrlInput}
        onChange={(e) => onBaseUrlInput(e.target.value)}
        onBlur={onBaseUrlBlur}
        placeholder="https://api.openai.com/v1"
        hint="A local URL like http://localhost:11434/v1 (Ollama) keeps data on-device."
      />

      {loopback && (
        <p className={styles.localNotice} role="note">
          This is a local endpoint — nothing leaves your device and no consent is needed.
        </p>
      )}
      {cspBlocked && (
        <p className={styles.cspNotice} role="note">
          This host is not in the app&apos;s allowed connection list, so the browser&apos;s security
          policy (CSP) will block requests to it. Use a localhost endpoint, the OpenAI API origin,
          or a cloud option.
        </p>
      )}

      <Input
        label="Model name"
        type="text"
        value={model ?? ''}
        onChange={(e) => onModelChange(e.target.value)}
        placeholder="e.g. gpt-4o-mini, llama3.1"
      />

      <div className={styles.keyRow}>
        <Input
          label="API key"
          type={showKey ? 'text' : 'password'}
          autoComplete="off"
          value={apiKey ?? ''}
          onChange={(e) => onKeyChange(e.target.value)}
          hint={
            loopback
              ? 'Leave blank for a local endpoint that needs no key.'
              : 'Stored on this device only — used as the request auth header.'
          }
        />
        <Button variant="ghost" onClick={onToggleShowKey} aria-pressed={showKey}>
          {showKey ? 'Hide' : 'Show'}
        </Button>
      </div>

      <label className={styles.checkRow}>
        <input
          type="checkbox"
          checked={remember}
          onChange={(e) => onRememberChange(e.target.checked)}
        />
        <span>Remember on this device (this session)</span>
      </label>
    </fieldset>
  );
}
