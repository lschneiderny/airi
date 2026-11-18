import * as v from 'valibot'

const ObjectSchema = v.record(v.string(), v.unknown())
const asObject = (value: unknown): Record<string, unknown> => v.is(ObjectSchema, value) ? value : {}

/**
 * Answers the app's tool calls during a model run, so a model that calls a tool gets a result and continues its turn
 * as it would in the app.
 *
 * The results are fixed stand-ins, not the app's tools: memory tools keep a store for one conversation, and every other
 * tool reports success. A run measures what the model writes around the calls, not what the tools do.
 */
export class ToolStubs {
  private readonly memory = new Map<string, string>()

  /** Starts a new conversation: memory written in the last one is gone. */
  reset(): void {
    this.memory.clear()
  }

  /** The JSON text of the result for one call. Arguments that are not a JSON object count as no arguments. */
  answer(name: string, args: unknown): string {
    const input = asObject(args)
    return JSON.stringify(this.result(name, input))
  }

  private result(name: string, input: Record<string, unknown>): unknown {
    switch (name) {
      case 'builtIn_readMemory': {
        const ids = Array.isArray(input.ids) ? input.ids.filter((id): id is string => typeof id === 'string') : [...this.memory.keys()]
        return { entries: ids.filter(id => this.memory.has(id)).map(id => ({ id, text: this.memory.get(id) })) }
      }
      case 'builtIn_writeMemory': {
        const entries = Array.isArray(input.entries) ? input.entries : [input]
        const saved: string[] = []
        for (const entry of entries) {
          const fields = asObject(entry)
          const id = typeof fields.id === 'string' && fields.id ? fields.id : `m${this.memory.size + 1}`
          const text = [fields.text, fields.content].find((value): value is string => typeof value === 'string') ?? JSON.stringify(entry)
          this.memory.set(id, text)
          saved.push(id)
        }
        return { saved }
      }
      case 'builtIn_forgetMemory': {
        const ids = Array.isArray(input.ids) ? input.ids.filter((id): id is string => typeof id === 'string') : []
        for (const id of ids)
          this.memory.delete(id)
        return { forgotten: ids }
      }
      default:
        return { ok: true }
    }
  }
}
