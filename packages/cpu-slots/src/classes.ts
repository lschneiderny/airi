export const classes = {
  test: { min: 2, max: 6, exclusive: false },
  browser: { min: 2, max: 4, exclusive: false },
  typecheck: { min: 2, max: 6, exclusive: false },
  build: { min: 2, max: 6, exclusive: false },
  lint: { min: 1, max: 1, exclusive: false },
  install: { min: 4, max: 4, exclusive: false },
  gate: { min: 4, max: 10, exclusive: false },
  exclusive: { min: Infinity, max: Infinity, exclusive: true },
} as const

export type CpuClass = keyof typeof classes
