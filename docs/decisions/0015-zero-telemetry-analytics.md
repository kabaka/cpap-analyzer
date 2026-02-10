# 0015 — Zero Telemetry and Analytics

## Status

Accepted

## Context

CPAP Analyzer processes Protected Health Information (PHI) under HIPAA. The application must decide whether to collect usage analytics, error telemetry, or performance monitoring data to inform development decisions versus maintaining strict privacy.

Typical web application telemetry includes:

- **Usage analytics**: page views, button clicks, feature adoption, user flows
- **Error tracking**: exception reports, stack traces, error rates
- **Performance monitoring**: page load times, API latency, render performance
- **Session replay**: video recordings of user sessions
- **A/B testing**: experiment tracking and variant assignment

Potential benefits of telemetry:

- Identify most-used features to prioritize development
- Detect errors in production before users report them
- Measure performance degradation in real-world conditions
- Understand user flows to improve UX
- Justify development decisions with data

Privacy concerns:

- Session timing data (when user accesses app) reveals sleep schedule patterns
- Feature usage patterns are behavioral biometrics
- Error reports may contain sensitive data in stack traces or context objects
- Performance metrics may correlate with health events (slow import = unusual data)
- Even "anonymized" data can be de-anonymized via behavioral fingerprinting
- Third-party analytics services (Google Analytics, Mixpanel) involve data transmission to external servers

Regulatory context:

- HIPAA requires safeguards for PHI
- GDPR requires explicit consent and purpose limitation
- CCPA grants California users right to opt-out
- Medical device regulations (if applicable) restrict data sharing

Alternatives evaluated:

- **Full telemetry (third-party)**: Google Analytics, Sentry, LogRocket—rich insights but sends data to external servers, privacy concerns, violates zero-trust architecture
- **Self-hosted telemetry**: Plausible (privacy-focused), Matomo—requires hosting infrastructure, still collects data, still privacy risk
- **Anonymized telemetry**: Strip PII before collection—still behavioral data, difficult to truly anonymize, user trust erosion
- **Opt-in telemetry**: User consent required—reduces sample size, consent fatigue, trust erosion even with opt-in
- **Zero telemetry**: No data collection—lose development insights but maximum privacy

## Decision

Implement **zero telemetry, zero analytics, zero error tracking**.

No network requests except user-configured integrations:

- No Google Analytics, Mixpanel, Segment, or similar
- No Sentry, Bugsnag, Rollbar, or similar
- No LogRocket, FullStory, Hotjar, or similar
- No FirstParty data scripts, tracking pixels, or beacons
- No auto-update checks that transmit device/user information
- No social media widgets or share buttons with tracking

Network request policy enforcement:

```typescript
// src/core/network-policy.ts
const ALLOWED_DOMAINS = new Set<string>();

export function registerAllowedDomain(domain: string, reason: string): void {
  console.info(`[Network Policy] Allowing ${domain}: ${reason}`);
  ALLOWED_DOMAINS.add(domain);
}

// Monkey-patch fetch to enforce policy
const originalFetch = window.fetch;
window.fetch = function (input, init) {
  const url = typeof input === 'string' ? input : input.url;
  const domain = new URL(url).hostname;
  if (!ALLOWED_DOMAINS.has(domain)) {
    throw new SecurityError(`Blocked unauthorized request to ${domain}`);
  }
  return originalFetch(input, init);
};
```

User-permitted network requests only:

- **Fitbit OAuth**: User explicitly authenticates, registers `api.fitbit.com`
- **Weather APIs**: User configures API key, registers API domain
- **LLM endpoints**: User configures endpoint, registers domain

Alternative feedback mechanisms:

- **Client-side error log**: Browser console only, users can export for support
- **Manual feedback form**: Local-only, generates file user can email
- **GitHub Issues**: Users report bugs/features via public issue tracker
- **Community forum**: Users share experiences without data collection

Performance validation:

- Automated synthetic testing in CI (Lighthouse, Playwright timing assertions)
- Manual dogfooding by developers
- User-reported performance issues via GitHub

## Consequences

### Positive

- Maximum privacy: no behavioral data leakage, no de-anonymization risk
- User trust: explicit privacy guarantee builds confidence in handling medical data
- Security: no third-party JavaScript that could be compromised (supply chain attack surface reduced)
- Compliance: HIPAA, GDPR, CCPA concerns eliminated by not collecting data
- Simplicity: no analytics integration complexity, no cookie banners, no consent flows
- Performance: no analytics script overhead (typically 20-50 KB + processing time)
- Zero cost: no analytics service subscription fees
- Aligns with core values: privacy-first architecture is consistent, not compromised

### Negative

- No production error visibility: bugs discovered only through user reports (delayed fixes)
- No feature usage data: development prioritization based on intuition and user feedback, not metrics
- No A/B testing capability: UX decisions based on principles and user research, not experiments
- No performance monitoring: real-world performance issues detected only via user reports
- Slower feedback loop: no real-time dashboards showing adoption, errors, or usage patterns
- Harder to justify features: no quantitative data to validate development decisions
- Missing context for bug reports: users must manually provide reproduction steps, no automatic session context

### Neutral

- Dogfooding required: developers must actively use application to discover issues
- Community feedback critical: open communication channels (GitHub, forums) become primary feedback mechanism
- High-quality manual testing essential: cannot rely on production telemetry to catch issues
- Synthetic testing in CI becomes more important: must validate performance without production data
