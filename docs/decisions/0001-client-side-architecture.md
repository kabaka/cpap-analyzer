# Client-Side Architecture

- Status: Proposed
- Date: 2025-07-18
- Decision-makers: Orchestrator Agent, Frontend Agent, Security Agent, Performance Agent, Database Agent
- Consulted: Data Science Agent, UX Agent, DevOps Agent

## Context and Problem Statement

CPAP Analyzer needs to process, store, and visualize years of high-resolution CPAP therapy data (25–50 Hz signal data). The data is medical in nature (Protected Health Information under HIPAA) and users are patients who want full control over their data. We need to choose an application architecture that serves the privacy, performance, and accessibility requirements of the project.

## Decision Drivers

- **Privacy**: CPAP data is sensitive health information. Users have expressed strong preferences for data sovereignty in the sleep apnea community.
- **Performance**: Must handle years of full-resolution data (estimated 11 GB for 5 years) with responsive interactions (< 100 ms queries, 60 fps chart rendering).
- **Accessibility**: Must work on any modern device with a browser. No installation barriers.
- **Cost**: The project has no funding. Hosting and infrastructure must be free or extremely low cost.
- **Simplicity**: Developed entirely by AI agents. Fewer moving parts reduce the surface area for errors.
- **Offline**: Users should not need an internet connection to use the app after initial load.

## Considered Options

1. **Client-side only (browser)** — Static SPA on GitHub Pages; all processing in the browser.
2. **Server-rendered web app** — Traditional server with database (e.g., Node.js + PostgreSQL).
3. **Desktop application (Electron/Tauri)** — Installable application with native file system access.
4. **Hybrid** — Client-side app with optional server for sync/sharing.

## Decision Outcome

**Chosen option: "Client-side only (browser)"**, because it is the only option that simultaneously guarantees data never leaves the user's device, costs nothing to host, requires no installation, and is simple enough for a fully-automated AI development team to build and maintain.

### Consequences

#### Positive

- **Zero data exfiltration risk** — No server means no server-side data breaches. The attack surface is limited to the user's browser.
- **Zero hosting cost** — GitHub Pages is free for public repositories.
- **Zero operational burden** — No servers to monitor, patch, or scale.
- **Instant deployment** — Push to `main` deploys via GitHub Actions.
- **Offline by default** — Service worker caches the app; all data is local.
- **No accounts required** — No user authentication, no session management, no password resets.
- **Works everywhere** — Any device with a modern browser can run the app.

#### Negative

- **Storage limitations** — Browser storage (IndexedDB + OPFS) has quotas that vary by browser. Users with many years of data may hit limits. Firefox is particularly restrictive with OPFS in private browsing.
- **No cross-device sync** — Data exists only on the device where it was imported. Users must re-import on a new device.
- **Performance ceiling** — JavaScript in the browser is slower than native code. Web Workers help but don't eliminate the gap. Very complex analyses may be slow.
- **No server-side API keys** — Third-party API integrations (Fitbit, weather) require the user to provide their own API keys, which is a UX friction point.
- **SharedArrayBuffer restrictions** — Requires COOP/COEP headers for shared memory between workers. GitHub Pages does not support custom HTTP headers; workarounds via service worker or meta tags are fragile.
- **Data persistence risk** — Browser storage can be cleared by the user (accidentally or via "Clear browsing data"), by the browser itself (storage pressure eviction), or by private browsing mode restrictions.

#### Neutral

- **No SEO needed** — This is a tool, not a content site. Client-side rendering is fine.
- **Framework choice is independent** — Any SPA framework (or none) works with this architecture.

## Validation

This decision is validated when:

- [ ] Import of 1 year of ResMed data completes in < 60 seconds on a mid-range laptop.
- [ ] All imported data persists across browser restarts (non-private mode).
- [ ] The application loads and functions fully offline after first visit.
- [ ] No network requests are made during normal usage (excluding optional API integrations initiated by the user).

## Pros and Cons of the Options

### Client-side only (browser)

- Good, because data never leaves the device.
- Good, because hosting is free (GitHub Pages).
- Good, because no server maintenance.
- Good, because works offline.
- Bad, because storage quotas vary by browser.
- Bad, because no cross-device sync.
- Bad, because JavaScript performance ceiling.

### Server-rendered web app

- Good, because unlimited storage and compute.
- Good, because cross-device sync is trivial.
- Good, because server-side API key management.
- Bad, because data is stored on a server (privacy violation for our use case).
- Bad, because requires hosting infrastructure and ongoing costs.
- Bad, because requires user accounts and authentication.
- Bad, because requires HIPAA compliance measures.
- Bad, because single point of failure.

### Desktop application (Electron/Tauri)

- Good, because native file system access (no storage quotas).
- Good, because data stays on device.
- Good, because native performance.
- Good, because no browser compatibility concerns.
- Bad, because requires installation (barrier to entry).
- Bad, because multiple platforms to build and test.
- Bad, because Electron bundles Chromium (large download).
- Bad, because auto-update mechanism needed.
- Bad, because app store distribution adds complexity.

### Hybrid (client + optional server)

- Good, because best of both worlds in theory.
- Bad, because doubles the development surface area.
- Bad, because "optional" server features tend to become required.
- Bad, because users may not trust that data is truly optional to share.
- Bad, because maintaining two data paths (local and remote) is complex.

## Server Re-Evaluation Triggers

This decision should be revisited if any of the following conditions are met:

1. **LLM integration requires server-side compute** — If a compelling LLM feature cannot be implemented client-side (e.g., local models are too slow or inaccurate, and API key management in the client is untenable).
2. **Cross-device sync becomes a top user priority** — If there is clear demand from users for accessing their data from multiple devices.
3. **Browser storage proves unreliable** — If users consistently lose data due to browser eviction, quotas, or bugs.
4. **Performance requirements exceed browser capabilities** — If planned analysis features (large-scale ML, multi-year statistical models) cannot run acceptably in Web Workers.
5. **Medical device regulation** — If the project pursues any form of medical device certification that requires server-side audit trails.

## More Information

- [OPFS (Origin Private File System) specification](https://fs.spec.whatwg.org/)
- [IndexedDB specification](https://w3c.github.io/IndexedDB/)
- [Service Workers specification](https://w3c.github.io/ServiceWorker/)
- [GitHub Pages documentation](https://docs.github.com/en/pages)
- [OSCAR (Open Source CPAP Analysis Reporter)](https://www.sleepfiles.com/OSCAR/) — the most popular open-source CPAP analysis tool (desktop, Qt/C++), serves as the primary feature reference.
