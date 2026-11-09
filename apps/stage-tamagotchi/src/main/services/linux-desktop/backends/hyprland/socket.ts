import { Buffer } from 'node:buffer'
import { createConnection } from 'node:net'

export type HyprlandFailure = 'transport-failed' | 'request-timeout' | 'reply-too-large' | 'stopped'

export class HyprlandBackendError extends Error {
  constructor(readonly bridgeFailure: HyprlandFailure) {
    // No socket error, reply, or title is included in this public error.
    super(`Hyprland IPC failed: ${bridgeFailure}`)
    this.name = 'HyprlandBackendError'
  }
}

/** Owns cancellable, read-only request sockets. Each request has an absolute deadline. */
export class HyprlandRequests {
  constructor(private readonly path: string) {}

  request(command: 'j/activewindow' | 'j/clients' | 'j/cursorpos' | 'j/monitors', signal: AbortSignal): Promise<string> {
    if (signal.aborted)
      return Promise.reject(new HyprlandBackendError('stopped'))
    return new Promise((resolve, reject) => {
      const socket = createConnection(this.path)
      const chunks: Buffer[] = []
      let bytes = 0
      let settled = false
      const cancel = () => finish('stopped')
      const deadline = setTimeout(finish, 2000, 'request-timeout')
      function finish(failure?: HyprlandFailure) {
        if (settled)
          return
        settled = true
        clearTimeout(deadline)
        signal.removeEventListener('abort', cancel)
        socket.destroy()
        if (failure)
          reject(new HyprlandBackendError(failure))
        else
          resolve(Buffer.concat(chunks, bytes).toString('utf8'))
      }
      signal.addEventListener('abort', cancel, { once: true })
      socket.once('connect', () => socket.write(command))
      socket.on('data', (chunk: Buffer) => {
        if (settled)
          return
        bytes += chunk.length
        if (bytes > 1048576)
          finish('reply-too-large')
        else
          chunks.push(chunk)
      })
      socket.once('end', () => finish())
      socket.once('error', () => finish('transport-failed'))
      socket.once('close', () => finish('transport-failed'))
    })
  }
}
