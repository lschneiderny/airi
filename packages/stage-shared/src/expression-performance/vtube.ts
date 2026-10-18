import { array, object, safeParse, string, unknown } from 'valibot'

const documentSchema = object({ Hotkeys: array(unknown()) })
const hotkeySchema = object({ Action: string(), File: string(), Name: string() })

/** Accepts vendor extensions and discards malformed individual hotkeys. */
export function parseVtubeHotkeys(input: unknown) {
  const document = safeParse(documentSchema, input)
  if (!document.success)
    return []
  return document.output.Hotkeys.flatMap((entry) => {
    const result = safeParse(hotkeySchema, entry)
    return result.success ? [result.output] : []
  })
}
