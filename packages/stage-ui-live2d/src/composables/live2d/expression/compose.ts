/** Parsed expression values; fade times are seconds and fall back to the composer's default fade when invalid. */
export interface ExpressionDefinition {
  id: string
  parameters: { id: string, value: number, blend: 'Add' | 'Multiply' | 'Overwrite' }[]
  fadeIn?: number
  fadeOut?: number
}

/** A transition retains its activation order when reversed before release. */
export interface ExpressionInstance {
  id: string
  activationSequence: number
  fromWeight: number
  targetWeight: 0 | 1
  transitionAt: number
  duration: number
}

/**
 * Owns expression transitions and clean frame bases without owning a model or clock.
 * Each frame must call restoreBases before animation writers, then compose after them.
 * This removes the previous expression output even when the SDK saved it for reuse.
 */
export class ExpressionComposer {
  private definitions = new Map<string, ExpressionDefinition>()
  private instances = new Map<string, ExpressionInstance>()
  private capturedBase = new Map<string, number>()
  private sequence = 0
  private defaultFadeSeconds = 1

  /** Sets the fade for definitions without a valid file fade (`slots.defaultFadeSeconds`); running fades keep their duration. */
  setDefaultFadeSeconds(seconds: number): void {
    this.defaultFadeSeconds = seconds
  }

  private fadeDuration(value: number | undefined): number {
    return value !== undefined && Number.isFinite(value) && value >= 0 ? value : this.defaultFadeSeconds
  }

  /** Replaces definitions and activations; pending bases remain for the next restore. */
  define(defs: ExpressionDefinition[]): void {
    this.definitions = new Map(defs.map(def => [def.id, def]))
    this.instances.clear()
    this.sequence = 0
  }

  activate(id: string, now: number): void {
    const definition = this.definitions.get(id)
    if (!definition)
      return

    const fromWeight = this.weightOf(id, now)
    const previous = this.instances.get(id)
    if (previous?.targetWeight === 1)
      return

    this.instances.set(id, {
      id,
      activationSequence: previous?.activationSequence ?? this.sequence++,
      fromWeight,
      targetWeight: 1,
      transitionAt: now,
      duration: this.fadeDuration(definition.fadeIn),
    })
  }

  deactivate(id: string, now: number): void {
    const fromWeight = this.weightOf(id, now)
    const instance = this.instances.get(id)
    if (!instance || instance.targetWeight === 0)
      return

    instance.fromWeight = fromWeight
    instance.targetWeight = 0
    instance.transitionAt = now
    instance.duration = this.fadeDuration(this.definitions.get(id)!.fadeOut)
    this.weightOf(id, now)
  }

  setActiveSet(ids: string[], now: number): void {
    const desired = new Set(ids)
    for (const id of this.instances.keys()) {
      if (!desired.has(id))
        this.deactivate(id, now)
    }
    for (const id of desired)
      this.activate(id, now)
  }

  /** Samples a transition and retires completed releases, but not newly started fades. */
  weightOf(id: string, now: number): number {
    const instance = this.instances.get(id)
    if (!instance)
      return 0
    const u = instance.duration === 0 ? 1 : Math.min(1, Math.max(0, (now - instance.transitionAt) / instance.duration))
    const weight = instance.fromWeight + (instance.targetWeight - instance.fromWeight) * (1 - Math.cos(Math.PI * u)) / 2
    if (instance.targetWeight === 0 && weight === 0)
      this.instances.delete(id)
    return weight
  }

  /** Includes fading-out instances until a time-bearing operation retires them. */
  activeIds(): string[] {
    return [...this.instances.keys()]
  }

  /** Restores last frame's clean values once, before motion or blink writes. */
  restoreBases(write: (paramId: string, value: number) => void): void {
    for (const [id, value] of this.capturedBase)
      write(id, value)
    this.capturedBase.clear()
  }

  /** Captures this frame's animated base and clamps only the final sequential blend. */
  compose(
    now: number,
    read: (paramId: string) => number,
    write: (paramId: string, value: number) => void,
    clampOf: (paramId: string) => [number, number],
  ): void {
    const values = new Map<string, number>()
    const ordered = [...this.instances.values()].sort((a, b) => a.activationSequence - b.activationSequence)
    for (const instance of ordered) {
      const weight = this.weightOf(instance.id, now)
      if (weight === 0)
        continue
      for (const parameter of this.definitions.get(instance.id)!.parameters) {
        const { id, value, blend } = parameter
        if ((blend === 'Add' && value === 0) || (blend === 'Multiply' && value === 1))
          continue
        if (!values.has(id)) {
          const base = read(id)
          this.capturedBase.set(id, base)
          values.set(id, base)
        }
        const current = values.get(id)!
        switch (blend) {
          case 'Add':
            values.set(id, current + value * weight)
            break
          case 'Multiply':
            values.set(id, current * (1 + (value - 1) * weight))
            break
          case 'Overwrite':
            values.set(id, current + (value - current) * weight)
            break
        }
      }
    }
    for (const [id, value] of values) {
      const [min, max] = clampOf(id)
      write(id, Math.max(min, Math.min(max, value)))
    }
  }
}
