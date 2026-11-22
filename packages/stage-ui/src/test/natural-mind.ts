import { CharacterMind } from '@proj-airi/character-mind'

/** Attaches a full performer before a conductor test sends any stimulus. */
export function naturalMind(options: ConstructorParameters<typeof CharacterMind>[0]) {
  const mind = new CharacterMind(options)
  mind.receive({ kind: 'performer', capabilities: { posture: true, face: true, gaze: true, gestures: ['nod', 'shake', 'glance', 'shrug', 'lean'], body: true } })
  return mind
}
