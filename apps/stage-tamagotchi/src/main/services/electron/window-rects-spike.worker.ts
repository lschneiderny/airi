import type { WindowRectsWorkerRequest, WindowRectsWorkerResponse } from './window-rects-spike'

import { parentPort } from 'node:worker_threads'

import { errorMessageFrom } from '@moeru/std'

import { loadWindowRectsBinding, walkWindowsSync } from './window-rects-spike'

// Worker entry of the window-rect spike's `worker` strategy (see the NOTICE in `window-rects-spike.ts`).
// koffi loads here on the first request; a load failure is answered as an error, which is the
// spike's record of whether koffi works in a worker at all.
parentPort?.on('message', (request: WindowRectsWorkerRequest) => {
  const respond = (response: WindowRectsWorkerResponse) => parentPort?.postMessage(response)
  loadWindowRectsBinding()
    .then(binding => respond({ id: request.id, walk: walkWindowsSync(binding.sync) }))
    .catch(error => respond({ id: request.id, error: `worker walk failed: ${errorMessageFrom(error) ?? 'unknown error'}` }))
})
