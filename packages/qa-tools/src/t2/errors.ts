/** A T2 input problem the operator can fix: a missing or empty rig, or a missing core. The CLI exits with `exitCode`. */
export class T2SetupError extends Error {
  readonly exitCode = 2

  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'T2SetupError'
  }
}
