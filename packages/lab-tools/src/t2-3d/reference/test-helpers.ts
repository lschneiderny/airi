import { Euler, Quaternion } from 'three'

/** Independent line-oriented oracle for the two real source formats. */
export function inspectSource(text: string) {
  const [header, motion] = text.split('MOTION')
  const names: string[] = []
  const parents: number[] = []
  const offsets: number[][] = []
  const channels: string[][] = []
  const stack: number[] = []
  let pending = -1
  for (const raw of header.split(/\r?\n/)) {
    const line = raw.trim()
    const joint = /^(?:ROOT|JOINT)\s+(\S+)/.exec(line)
    if (joint) {
      pending = names.length
      names.push(joint[1])
      parents.push(stack.at(-1) ?? -1)
    }
    else if (line === 'End Site') {
      pending = -1
    }
    else if (line === '{') {
      stack.push(pending)
    }
    else if (line === '}') {
      stack.pop()
    }
    else if (line.startsWith('OFFSET') && stack.at(-1) !== -1) {
      offsets.push(line.split(/\s+/).slice(1).map(Number))
    }
    else if (line.startsWith('CHANNELS')) {
      channels.push(line.split(/\s+/).slice(2))
    }
  }
  const lines = motion.trim().split(/\r?\n/)
  const frames = Number(lines[0].split(':')[1])
  const frameTime = Number(lines[1].split(':')[1])
  const rotations = lines.slice(2, 4).map((row) => {
    const values = row.trim().split(/\s+/).map(Number)
    let cursor = 0
    return channels.map((order) => {
      const angles = { Xrotation: 0, Yrotation: 0, Zrotation: 0 }
      const rotations = order.filter(channel => channel.endsWith('rotation')).join(' ')
      for (const channel of order) {
        const value = values[cursor++] * Math.PI / 180
        if (channel === 'Xrotation' || channel === 'Yrotation' || channel === 'Zrotation')
          angles[channel] = value
      }
      if (rotations !== 'Zrotation Yrotation Xrotation' && rotations !== 'Yrotation Xrotation Zrotation')
        throw new Error(`Oracle does not support ${rotations}`)
      // Euler's closed form is independent of the reader's quaternion products.
      return new Quaternion().setFromEuler(new Euler(
        angles.Xrotation,
        angles.Yrotation,
        angles.Zrotation,
        rotations.startsWith('Z') ? 'ZYX' : 'YXZ',
      )).toArray()
    })
  })
  return { names, parents, offsets, channels, frames, frameTime, rotations }
}
