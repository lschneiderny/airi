const FALLBACK = 'http://localhost'

function getRedirectOrigin(): string {
  if (import.meta.env.VITE_OIDC_REDIRECT_URI)
    return import.meta.env.VITE_OIDC_REDIRECT_URI

  // Browser builds return to the origin that started the authorization flow.
  if (typeof window !== 'undefined')
    return window.location?.origin ?? FALLBACK

  // Non-browser imports need a stable origin while no deployment override exists.
  return FALLBACK
}

const origin = getRedirectOrigin()

export const OIDC_CLIENT_ID = import.meta.env.VITE_OIDC_CLIENT_ID
  || 'airi-stage-web'

export const OIDC_REDIRECT_URI = `${origin}/auth/callback`
