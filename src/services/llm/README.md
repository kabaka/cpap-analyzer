# `services/llm` — AI Insights (compute-then-narrate)

First-party service module for the opt-in **AI Insights** feature
([ADR 0024](../../../docs/decisions/0024-grounded-opt-in-ai-insights-multi-backend-provider.md)).
It turns **already-computed** metrics into plain-language prose. The app does
all of the math; the model only phrases the finished numbers — it never
computes, derives, diagnoses, or introduces a clinical value (**compute-then-
narrate**). This is a direct service module, not a runtime plugin (the plugin
registry was abandoned; ADR 0024 §2).

## Module layout

| Path               | Responsibility                                                                                                                                                                                                       | Status                               |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `types.ts`         | The backend-agnostic `LLMProvider` interface, request/response/stream types, `BackendAvailability`, and the discriminated `LLMError`. The contract every backend implements.                                         | **Foundation (this wave)**           |
| `context/types.ts` | The `GroundedContext` data contract — the frozen, aggregate-only snapshot that is the _only_ thing handed to a model (and the only thing that egresses for cloud backends). Shared by the builder and the providers. | **Foundation (this wave)**           |
| `context/`         | The snapshot **builder** (`buildGroundedContext`) that assembles a `GroundedContext` from existing analyses, plus the redaction-tested serializer (design reference §3).                                             | Later wave (data-science / frontend) |
| `grounding/`       | The guardrailed **prompt assembler** (system-prompt invariants, design reference §4) and the **post-generation validator** (numeral-extraction + safety lints, §5).                                                  | Later wave                           |
| `providers/`       | The four backend implementations of `LLMProvider`: `webllm`, `chrome-ai`, `anthropic`, `openai-compatible`. SDKs are dynamically imported here.                                                                      | Later wave (provider network logic)  |

## Key invariants (enforced across waves)

- **Privacy.** Only the `GroundedContext` may leave the device, and only for
  cloud backends after explicit two-gate consent. Redaction rules
  (`context/types.ts` docblock + design reference §3) are a hard contract.
- **API keys never persist to `localStorage`.** They live in the session-scoped
  [`useLLMCredentialStore`](../../stores/useLLMCredentialStore.ts) and travel
  only as the provider auth header — never in the snapshot, never logged.
- **Correctness is structural.** The model receives finished numbers; the
  numeral validator (`grounding/`) rejects any fabricated figure before it is
  shown.
- **CSP.** Cloud backend hosts are allowlisted in
  [`src/buildtime/csp.ts`](../../buildtime/csp.ts) `connect-src` — exact origins
  only, never a wildcard.

## Related

- UX spec: `docs/design/ai-insights-ux.md`
- Grounded-context contract: `docs/design/ai-insights-grounded-context.md`
- Settings shape: `src/types/settings.ts` (`LLMIntegrationConfig`)
