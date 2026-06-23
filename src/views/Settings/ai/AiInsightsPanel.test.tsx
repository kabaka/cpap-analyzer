import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@test/test-utils';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { useLLMCredentialStore } from '@/stores/useLLMCredentialStore';
import { EGRESS_CONTRACT_VERSION } from '@/types/settings';
import { LLMError } from '@/services/llm/types';
import type { BackendAvailability, PrefetchOptions } from '@/services/llm/types';
import type { DownloadProvider } from '@/hooks/useModelDownload';
import { DEFAULT_WEBLLM_MODEL_ID } from './backends';
import { AiInsightsPanel } from './AiInsightsPanel';

const available: BackendAvailability = { state: 'available', reason: null };
const needsDownload: BackendAvailability = {
  state: 'needs-download',
  reason: 'Model not downloaded',
};
const webgpuUnsupported: BackendAvailability = {
  state: 'unsupported',
  reason: "WebGPU isn't supported in this browser",
};
const chromeUnsupported: BackendAvailability = {
  state: 'unsupported',
  reason: "Chrome's built-in AI isn't available in this browser",
};

/** Render the panel with deterministic, non-egressing availability probes. */
function renderPanel(
  overrides: {
    webllm?: BackendAvailability;
    chrome?: BackendAvailability;
  } = {},
) {
  return render(
    <AiInsightsPanel
      checkWebLLM={() => Promise.resolve(overrides.webllm ?? available)}
      checkChromeAI={() => Promise.resolve(overrides.chrome ?? chromeUnsupported)}
    />,
  );
}

function resetLLM() {
  useSettingsStore.getState().updateIntegration('llm', {
    enabled: false,
    backend: null,
    consentAt: null,
    consentContractVersion: null,
    webllm: { modelId: null },
    anthropic: { model: 'claude-opus-4-8' },
    openaiCompatible: { baseUrl: null, model: null },
  });
  useLLMCredentialStore.getState().forgetAll();
}

const llm = () => useSettingsStore.getState().integrations.llm;

describe('AiInsightsPanel', () => {
  beforeEach(() => {
    resetLLM();
  });

  it('enabling selects a LOCAL backend by default (never cloud, no consent)', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('switch'));
    expect(llm().enabled).toBe(true);
    expect(llm().backend).toBe('webllm');
    expect(llm().consentAt).toBeNull();
    // No consent dialog open.
    expect(screen.queryByText(/Send metric summaries/i)).not.toBeInTheDocument();
  });

  it('selecting Claude opens consent and does NOT commit the backend until acknowledged', async () => {
    useSettingsStore.getState().updateIntegration('llm', { enabled: true, backend: 'webllm' });
    renderPanel();

    fireEvent.click(screen.getByRole('radio', { name: /Claude/i }));

    // Consent dialog appears; backend stays webllm until confirmed.
    expect(await screen.findByText(/Send metric summaries to .*Claude/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enable' })).toBeDisabled();
    expect(llm().backend).toBe('webllm');
    expect(llm().consentAt).toBeNull();
  });

  it('accepting consent commits the cloud backend and writes consentAt + contract version', async () => {
    useSettingsStore.getState().updateIntegration('llm', { enabled: true, backend: 'webllm' });
    renderPanel();

    fireEvent.click(screen.getByRole('radio', { name: /Claude/i }));
    fireEvent.click(await screen.findByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Enable' }));

    await waitFor(() => expect(llm().backend).toBe('anthropic'));
    expect(llm().consentAt).not.toBeNull();
    expect(llm().consentContractVersion).toBe(EGRESS_CONTRACT_VERSION);
  });

  it('cancelling consent reverts (backend unchanged, no consentAt)', async () => {
    useSettingsStore.getState().updateIntegration('llm', { enabled: true, backend: 'webllm' });
    renderPanel();

    fireEvent.click(screen.getByRole('radio', { name: /Claude/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

    expect(llm().backend).toBe('webllm');
    expect(llm().consentAt).toBeNull();
  });

  it('a STALE contract version forces re-consent even though consentAt is set', async () => {
    // Prior consent recorded under an older contract version.
    useSettingsStore.getState().updateIntegration('llm', {
      enabled: true,
      backend: 'webllm',
      consentAt: new Date().toISOString(),
      consentContractVersion: EGRESS_CONTRACT_VERSION - 1,
    });
    renderPanel();

    fireEvent.click(screen.getByRole('radio', { name: /Claude/i }));
    // Re-consent dialog must appear; backend not yet committed.
    expect(await screen.findByText(/Send metric summaries to .*Claude/i)).toBeInTheDocument();
    expect(llm().backend).toBe('webllm');
  });

  it('valid current-contract consent skips the dialog when selecting another cloud backend', async () => {
    useSettingsStore.getState().updateIntegration('llm', {
      enabled: true,
      backend: 'anthropic',
      consentAt: new Date().toISOString(),
      consentContractVersion: EGRESS_CONTRACT_VERSION,
    });
    renderPanel();

    // Switch to anthropic again (already valid) — no dialog.
    fireEvent.click(screen.getByRole('radio', { name: /Claude/i }));
    expect(screen.queryByText(/Send metric summaries/i)).not.toBeInTheDocument();
    expect(llm().backend).toBe('anthropic');
  });

  it('Claude API key is written to the credential store, NOT to persisted settings', async () => {
    useSettingsStore.getState().updateIntegration('llm', {
      enabled: true,
      backend: 'anthropic',
      consentAt: new Date().toISOString(),
      consentContractVersion: EGRESS_CONTRACT_VERSION,
    });
    renderPanel();

    const keyInput = await screen.findByLabelText('Claude API key');
    fireEvent.change(keyInput, { target: { value: 'sk-ant-secret' } });

    expect(useLLMCredentialStore.getState().anthropicApiKey).toBe('sk-ant-secret');
    // The persisted settings blob must never carry a key.
    expect(JSON.stringify(llm())).not.toContain('sk-ant-secret');
  });

  it('a loopback OpenAI-compatible URL skips consent (local)', async () => {
    useSettingsStore.getState().updateIntegration('llm', {
      enabled: true,
      backend: 'webllm',
      openaiCompatible: { baseUrl: 'http://localhost:11434/v1', model: 'llama3.1' },
    });
    renderPanel();

    fireEvent.click(screen.getByRole('radio', { name: /OpenAI-compatible/i }));
    // No consent dialog — committed straight away.
    await waitFor(() => expect(llm().backend).toBe('openai-compatible'));
    expect(screen.queryByText(/Send metric summaries/i)).not.toBeInTheDocument();
    expect(llm().consentAt).toBeNull();
  });

  it('WebGPU-unsupported renders the inline fallback message', async () => {
    useSettingsStore.getState().updateIntegration('llm', { enabled: true, backend: 'webllm' });
    renderPanel({ webllm: webgpuUnsupported });

    expect(await screen.findByText(/needs WebGPU/i)).toBeInTheDocument();
  });

  // ── On-device model download affordance (model-download-ux spec §3) ──

  it('shows a "Download model (~N GB)" button when the model needs download', async () => {
    useSettingsStore.getState().updateIntegration('llm', {
      enabled: true,
      backend: 'webllm',
      webllm: { modelId: DEFAULT_WEBLLM_MODEL_ID },
    });
    renderPanel({ webllm: needsDownload });

    expect(await screen.findByText(/Needs a one-time download/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Download model \(~1\.9 GB\)/i }),
    ).toBeInTheDocument();
  });

  it('clicking Download starts the prefetch; on success it re-probes to Ready', async () => {
    useSettingsStore.getState().updateIntegration('llm', {
      enabled: true,
      backend: 'webllm',
      webllm: { modelId: DEFAULT_WEBLLM_MODEL_ID },
    });

    const prefetch = vi.fn(async (opts: PrefetchOptions) => {
      opts.onProgress?.({ phase: 'downloading', fraction: 0.5, text: 'Fetching' });
      // resolve → done
    });
    const factory = (): DownloadProvider => ({ prefetch });

    // First probe → needs-download; after a successful download → available.
    const checkWebLLM = vi
      .fn<() => Promise<BackendAvailability>>()
      .mockResolvedValueOnce(needsDownload)
      .mockResolvedValue(available);

    render(
      <AiInsightsPanel
        checkWebLLM={checkWebLLM}
        checkChromeAI={() => Promise.resolve(webgpuUnsupported)}
        downloadProviderFactory={factory}
      />,
    );

    const downloadButton = await screen.findByRole('button', {
      name: /Download model \(~1\.9 GB\)/i,
    });
    fireEvent.click(downloadButton);

    expect(prefetch).toHaveBeenCalledTimes(1);
    // The done state re-probes; the panel reflects the new "ready" status.
    expect(await screen.findByText(/Downloaded — ready/i)).toBeInTheDocument();
    expect(checkWebLLM.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('an OOM download failure surfaces the smaller-model hint + Try again', async () => {
    useSettingsStore.getState().updateIntegration('llm', {
      enabled: true,
      backend: 'webllm',
      webllm: { modelId: DEFAULT_WEBLLM_MODEL_ID },
    });

    const prefetch = vi.fn(async () => {
      throw new LLMError('model-load-failed', 'OOM', { backend: 'webllm' });
    });
    const factory = (): DownloadProvider => ({ prefetch });

    render(
      <AiInsightsPanel
        checkWebLLM={() => Promise.resolve(needsDownload)}
        checkChromeAI={() => Promise.resolve(webgpuUnsupported)}
        downloadProviderFactory={factory}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: /Download model \(~1\.9 GB\)/i }));

    expect(await screen.findByText(/Try a smaller model below/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Try again/i })).toBeInTheDocument();
  });

  it('disabling clears enabled (config disappears)', async () => {
    useSettingsStore.getState().updateIntegration('llm', { enabled: true, backend: 'webllm' });
    renderPanel();
    // Wait for availability probes to settle so the radiogroup is rendered.
    await screen.findByRole('radiogroup');

    fireEvent.click(screen.getByRole('switch'));
    expect(llm().enabled).toBe(false);
  });
});
