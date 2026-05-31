// Vitest setup — runs before any test file's top-level imports execute.
// Pre-populate env vars that modules check at import time (apify-client
// adapters fail eagerly if APIFY_TOKEN is missing; that's the right boot
// behavior in production but the wrong behavior in unit tests where
// apify-client itself is mocked).
process.env.APIFY_TOKEN = process.env.APIFY_TOKEN ?? 'test-token';

// M12 dm-sender/meta.ts also eagerly checks tokens at module load
process.env.META_PAGE_ACCESS_TOKEN = process.env.META_PAGE_ACCESS_TOKEN ?? 'test-token';
process.env.META_IG_BUSINESS_ACCOUNT_ID = process.env.META_IG_BUSINESS_ACCOUNT_ID ?? 'test-account-id';
