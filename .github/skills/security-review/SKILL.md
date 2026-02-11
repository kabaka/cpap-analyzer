---
name: security-review
description: Evaluate code for security vulnerabilities and privacy compliance. Use when reviewing code that handles file input, storage, external APIs, or sensitive data.
metadata:
  version: '1.0'
---

# Security Review

## Review Areas

### File Input Parsing (Critical)

EDF files from SD cards are **untrusted binary input**. Review for:

- Buffer overflow via malformed headers (check bounds before reading)
- Integer overflow in size/length fields
- Infinite loops from circular references or self-referencing structures
- Memory exhaustion from exaggerated size fields
- Path traversal if filenames are extracted from file content

### Content Rendering

- XSS via imported data rendered in the DOM (sanitize all dynamic content)
- Prototype pollution via JSON parsing of imported settings/sessions
- Template injection in user-facing strings

### Storage Security

- IndexedDB/OPFS data isolation (verify origin enforcement)
- Secure deletion (overwrite sensitive data before removing, where possible)
- Quota exceeded handling (no data corruption on storage failure)

### External Integrations

- HTTPS enforcement for all API calls
- OAuth token lifecycle (storage, refresh, revocation)
- API key exposure prevention (never log, never include in error messages)
- Response validation (never trust external API responses)

### Dependencies

- Run `npm audit --audit-level=high` — must pass
- Review new dependencies: check maintenance status, download counts, known issues
- Prefer well-maintained, widely-used packages
- Minimize dependency surface area

### Privacy

- No network calls to unexpected endpoints
- No analytics, telemetry, or tracking
- User data must be completely deletable
- PHI awareness in logging/error reporting (no health data in console or error messages)

## Content Security Policy

The app should enforce a strict CSP:

```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
connect-src 'self' https://api.fitbit.com https://*.openweathermap.org;
img-src 'self' data: blob:;
worker-src 'self' blob:;
```

Adjust `connect-src` as integrations are added. Each integration is opt-in.
