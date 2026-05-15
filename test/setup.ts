// Vitest setup — runs before any test file's top-level imports execute.
// Pre-populate env vars that modules check at import time (apify-client
// adapters fail eagerly if APIFY_TOKEN is missing; that's the right boot
// behavior in production but the wrong behavior in unit tests where
// apify-client itself is mocked).
process.env.APIFY_TOKEN = process.env.APIFY_TOKEN ?? 'test-token';
