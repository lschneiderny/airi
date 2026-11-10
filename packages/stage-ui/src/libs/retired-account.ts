// NOTICE:
// Profiles created before the account-free fork can still hold tokens for the retired AIRI account service.
// Root cause: a291588c0 removed the hosted account client, which owned these keys and their sign-out cleanup.
// Source: docs/ai/audits/2026-10-31-architecture-boundaries.md, H3; called from both `App.vue` entry points.
// Removal condition: profiles from hosted-account versions are no longer supported, together with `retiredProviderIds`
// in packages/stage-ui/src/stores/modules/default.ts.
/** Removes only credentials and unfinished sign-in flows for the retired AIRI account service. */
export function removeRetiredAccountCredentials(): void {
  for (const key of [
    'auth/v1/token',
    'auth/v1/refresh-token',
    'auth/v1/oidc-id-token',
    'auth/v1/oidc-client-id',
    'auth/v1/oidc-token-expiry',
    'auth/v1/oidc-flow-state',
    'auth/v1/oidc-flow-params',
  ]) {
    localStorage.removeItem(key)
  }
}
