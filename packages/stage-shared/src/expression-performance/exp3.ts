import type { InferOutput } from 'valibot'

import { array, fallback, finite, minLength, number, object, optional, parse, pipe, string } from 'valibot'

const exp3Schema = object({
  // Invalid fades fall back to the composer's default fade instead of rejecting the file.
  FadeInTime: fallback(optional(number()), undefined),
  FadeOutTime: fallback(optional(number()), undefined),
  Parameters: array(object({
    Id: pipe(string(), minLength(1)),
    Value: pipe(number(), finite()),
    Blend: optional(string()),
  })),
})

export type Exp3Expression = InferOutput<typeof exp3Schema>

/** Parses untrusted exp3 JSON; throws when an id or parameter value cannot reach the core model safely. */
export function parseExp3Expression(input: unknown): Exp3Expression {
  return parse(exp3Schema, input)
}
