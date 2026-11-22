import type { ErrorReportingAdapter, ErrorReportingAdapterOptions } from '@proj-airi/stage-ui/libs/product-signals/error-reporting'

import { sharedSentryOptions } from '@proj-airi/stage-shared/analytics/sentry'
import { captureException, init, setUser } from '@sentry/electron/renderer'

/**
 * Starts `@sentry/electron/renderer` in one window.
 *
 * The renderer SDK forwards each report to main, and main sends it only while the switch is on. The DSN is set in
 * main. The consent bridge owns main's saved switch independently of this SDK.
 */
export function createSentryAdapter({ beforeSend }: ErrorReportingAdapterOptions): ErrorReportingAdapter {
  init({ ...sharedSentryOptions, beforeSend })

  return {
    captureException,
    setUser,
  }
}
