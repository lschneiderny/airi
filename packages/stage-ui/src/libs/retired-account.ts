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
