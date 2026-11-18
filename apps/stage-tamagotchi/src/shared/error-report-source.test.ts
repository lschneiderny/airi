import { describe, expect, it } from 'vitest'

import { errorReportSourceFromEnv } from './error-report-source'

const dsn = 'https://key@sentry.example.com/1'
const upload = { AIRI_SENTRY_ORG: 'fork-org', AIRI_SENTRY_PROJECT: 'fork-desktop', SENTRY_AUTH_TOKEN: 'token' }

describe('errorReportSourceFromEnv', () => {
  it.each([
    { name: 'no variables', env: {} },
    { name: 'an empty DSN', env: { AIRI_ERROR_REPORT_DSN: '' } },
    { name: 'analytics on and no DSN', env: { VITE_ENABLE_ANALYTICS: 'true' } },
    { name: 'upload credentials and no DSN', env: upload },
  ])('turns error reports and source maps off for a build with $name', ({ env }) => {
    expect(errorReportSourceFromEnv(env)).toEqual({ dsn: undefined, sourceMapUpload: undefined })
  })

  it.each([
    { name: 'no upload credentials', env: {} },
    { name: 'only a token', env: { SENTRY_AUTH_TOKEN: upload.SENTRY_AUTH_TOKEN } },
    { name: 'no project', env: { ...upload, AIRI_SENTRY_PROJECT: undefined } },
    { name: 'no organization', env: { ...upload, AIRI_SENTRY_ORG: '' } },
  ])('reports to the DSN of the build and uploads no source maps with $name', ({ env }) => {
    expect(errorReportSourceFromEnv({ AIRI_ERROR_REPORT_DSN: dsn, ...env })).toEqual({ dsn, sourceMapUpload: undefined })
  })

  it('uploads source maps to the account of a build that sets all of it', () => {
    expect(errorReportSourceFromEnv({ AIRI_ERROR_REPORT_DSN: dsn, ...upload })).toEqual({
      dsn,
      sourceMapUpload: { org: 'fork-org', project: 'fork-desktop', authToken: 'token' },
    })
  })
})
