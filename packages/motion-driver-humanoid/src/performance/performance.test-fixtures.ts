import type { BodyPerformanceInput, BodyRigTraits } from './contracts'

import { BODY_CHANNELS, BODY_TICK } from './channels'

const v = (x: number, y: number, z: number) => ({ x, y, z })
const sub = (a: readonly number[], b: readonly number[]) => v(a[0] - b[0], a[1] - b[1], a[2] - b[2])
const point = (a: readonly number[]) => v(a[0], a[1], a[2])

// Bone coordinates copied from stage-ui-mmd/rig/rig-profile.fixtures.ts.
// Colliders there have no shapes: an empty list deliberately requests proportional proxies.
const positions = [
  {
    name: 'ellen',
    hips: [0, 10.99719, 0.214187],
    spine: [[0.000001, 11.066169, 0.224214], [0.000002, 12.1247, 0.280079], [0.000004, 13.24655, 0.283629]],
    neck: [0.000007, 15.513482, -0.289193],
    head: [0.000008, 16.29199, -0.247852],
    clavicle: [0.186376, 15.20196, -0.332033],
    shoulder: [1.139817, 14.92106, -0.345341],
    elbow: [3.205818, 13.212358, -0.437295],
    wrist: [5.07338, 11.66749, -0.347598],
    hip: [0.946545, 10.459811, 0.092205],
    knee: [1.183816, 5.959278, 0.223915],
    ankle: [1.433686, 1.117993, 0.095487],
    toe: [1.245769, 0.134129, 1.474807],
  },
  {
    name: 'vivian',
    hips: [0, 12.1047, 0.219595],
    spine: [[0, 12.218507, 0.236221], [0, 13.317407, 0.343839], [0, 14.485437, 0.378692]],
    neck: [0, 16.851685, -0.290057],
    head: [-0.000001, 17.621067, -0.248198],
    clavicle: [0.194136, 16.493168, -0.345873],
    shoulder: [1.216519, 16.192066, -0.36006],
    elbow: [3.317174, 14.478002, -0.385362],
    wrist: [5.274381, 12.880883, -0.347635],
    hip: [0.957114, 11.537188, 0.096047],
    knee: [1.214155, 6.912066, 0.314693],
    ankle: [1.473505, 2.119492, -0.109185],
    toe: [1.327857, 0.648321, 0.866444],
  },
  {
    name: 'carlotta',
    hips: [0, 12.20473, -0.057265],
    spine: [[0, 12.20914, -0.057328], [0, 12.96513, 0.020909], [0, 13.94085, -0.009157]],
    neck: [-0.000002, 16.281469, -0.74143],
    head: [-0.000001, 17.14304, -0.477071],
    clavicle: [0.09715, 16.039289, -0.722677],
    shoulder: [1.347342, 15.76635, -0.731197],
    elbow: [3.353861, 14.357593, -0.750942],
    wrist: [5.545052, 12.840482, -0.846495],
    hip: [1.016935, 11.305481, -0.351482],
    knee: [0.915597, 6.364398, -0.331517],
    ankle: [0.794391, 1.398647, -0.965596],
    toe: [0.766998, 0.101888, 0.557604],
  },
] as const

export const fixtureRigs: readonly { readonly name: string, readonly traits: BodyRigTraits }[] = positions.map((p) => {
  const mirror = (a: readonly number[]) => v(-a[0], a[1], a[2])
  const upperArm = sub(p.elbow, p.shoulder)
  const forearm = sub(p.wrist, p.elbow)
  const arm = {
    shoulder: point(p.shoulder),
    clavicle: point(p.clavicle),
    upperArm,
    forearm,
    handLength: 0.65 * Math.hypot(forearm.x, forearm.y, forearm.z),
    fingers: 'full',
    twist: false,
  } as const
  const foot = { ankle: point(p.ankle), toe: point(p.toe), heelBack: 0.28 * (p.toe[2] - p.ankle[2]), toeBend: false, toeIk: true }
  const thigh = sub(p.knee, p.hip)
  const shin = sub(p.ankle, p.knee)
  return {
    name: p.name,
    traits: {
      legLength: Math.hypot(thigh.x, thigh.y, thigh.z) + Math.hypot(shin.x, shin.y, shin.z),
      hips: point(p.hips),
      spineChain: p.spine.map(point),
      spineParent: 'root',
      neck: point(p.neck),
      head: point(p.head),
      arms: {
        left: arm,
        right: { ...arm, shoulder: mirror(p.shoulder), clavicle: mirror(p.clavicle), upperArm: v(-upperArm.x, upperArm.y, upperArm.z), forearm: v(-forearm.x, forearm.y, forearm.z) },
      },
      feet: { left: foot, right: { ...foot, ankle: mirror(p.ankle), toe: mirror(p.toe) } },
      legIk: true,
      eyeYawLimit: 20 * Math.PI / 180,
      eyePitchLimit: 14.3 * Math.PI / 180,
      colliders: [],
    },
  }
})

export function idleInput(time = 0): BodyPerformanceInput {
  const zero = { yaw: 0, pitch: 0, roll: 0 }
  return {
    head: { attitude: zero, slow: zero, terms: { emphasis: zero, impulse: zero, pet: zero, held: zero, gesture: zero, cue: zero } },
    posture: { amplitude: 1, shiftRate: 1, support: null },
    gaze: { yaw: 0, pitch: 0, kind: 'sustained', saccadeSeq: 0, blinkFactor: 1, micro: { yaw: 0, pitch: 0 } },
    breath: { phase: time * 2 * Math.PI / 4, period: 4, scale: 1 },
    voice: { speaking: false, level: 0, slow: 0, onsetSeq: 0, emphasis: null },
    mood: { valence: 0, arousal: 0, tension: 0.4 },
    energy: { level: 0.5, mode: 'idle', away: false, reactingUntil: 0 },
    held: { emotion: 'neutral', strength: 0, level: 0, side: 1 },
    events: { impulse: null, gesture: null, cue: null, poke: null, pet: { level: 0, active: false, x: 0, y: 0 }, react: null },
    directive: { stance: 'stand', rest: 'none', act: null },
    facingYaw: 0,
    allowTurn: false,
    dragging: false,
    attention: { approach: 0, cursorShare: 0 },
    rootVelocity: v(0, 0, 0),
    owned: { root: 0, lowerBody: 0, leftLegIk: 0, rightLegIk: 0, upperBody: 0, head: 0, leftArm: 0, rightArm: 0, leftFingers: 0, rightFingers: 0 },
    gait: null,
    armLift: { left: 0, right: 0 },
  }
}

export function quietInput(time = 0): BodyPerformanceInput {
  const input = idleInput(time)
  return { ...input, posture: { amplitude: 0, shiftRate: 0, support: 0 }, breath: { ...input.breath, scale: 0 } }
}

export function channelTrace(performer: { step: (input: BodyPerformanceInput) => { readonly channels: Float32Array } }, seconds: number, script: (time: number) => BodyPerformanceInput = idleInput) {
  const traces = BODY_CHANNELS.map(() => [] as number[])
  for (let tick = 0; tick < seconds / BODY_TICK; tick++) {
    const frame = performer.step(script(tick * BODY_TICK))
    for (let c = 0; c < traces.length; c++)
      traces[c].push(frame.channels[c])
  }
  return traces
}

export function peakSpeed(values: readonly number[]): number {
  let peak = 0
  let at = 0
  for (let i = 1; i < values.length; i++) {
    const speed = Math.abs(values[i] - values[i - 1])
    if (speed > peak) {
      peak = speed
      at = i
    }
  }
  return at
}

export function lagOf(a: readonly number[], b: readonly number[], maxLag = 120): number {
  let best = -Infinity
  let lag = 0
  for (let shift = -maxLag; shift <= maxLag; shift++) {
    let dot = 0
    let aa = 0
    let bb = 0
    for (let t = maxLag + 1; t < a.length - maxLag; t++) {
      const x = a[t] - a[t - 1]
      const y = b[t + shift] - b[t + shift - 1]
      dot += x * y
      aa += x * x
      bb += y * y
    }
    const corr = dot / Math.sqrt(aa * bb)
    if (corr > best) {
      best = corr
      lag = shift
    }
  }
  return lag
}

/**
 * The body rig traits the product builds for a real model (WuWa Chisa v1.03: `buildBodyRigTraits` with its arm-test
 * and head colliders), dumped to 6 decimals by lane A3's `probe-dump-traits.ts`: bone positions and collider shapes
 * only. Her bust colliders put the chest surface 0.435 A in front of the shoulder joints, where the proportional
 * proxies of the fixture rigs have none.
 */
export const chisaTraits: BodyRigTraits = { legLength: 9.710485, hips: { x: 0, y: 11.932435, z: 0.039803 }, spineChain: [{ x: 0, y: 11.940549, z: 0.045357 }, { x: 0, y: 13.288589, z: 0.183622 }, { x: 0, y: 14.433882, z: 0.142733 }], spineParent: 'root', neck: { x: -1e-06, y: 16.601179, z: -0.627962 }, head: { x: 0, y: 17.541916, z: -0.333024 }, arms: { left: { shoulder: { x: 1.245695, y: 16.110481, z: -0.83562 }, clavicle: { x: 0.158564, y: 16.157488, z: -0.695713 }, upperArm: { x: 2.038559, y: -1.575064, z: 0.505181 }, forearm: { x: 2.053492, y: -1.644486, z: 0.380407 }, handLength: 1.46617, fingers: 'full', twist: true }, right: { shoulder: { x: -1.245697, y: 16.110481, z: -0.835617 }, clavicle: { x: -0.158566, y: 16.157488, z: -0.695712 }, upperArm: { x: -2.038552, y: -1.575071, z: 0.505188 }, forearm: { x: -2.053485, y: -1.644487, z: 0.380424 }, handLength: 1.46617, fingers: 'full', twist: true } }, feet: { left: { ankle: { x: 1.160372, y: 1.43837, z: -0.990197 }, toe: { x: 1.120359, y: 0.105169, z: 0.835086 }, heelBack: 0, toeBend: true, toeIk: true }, right: { ankle: { x: -1.160383, y: 1.43837, z: -0.990191 }, toe: { x: -1.120347, y: 0.105169, z: 0.835091 }, heelBack: 0, toeBend: true, toeIk: true } }, legIk: true, eyeYawLimit: 0.35, eyePitchLimit: 0.25, colliders: [{ bone: 'hips', centre: { x: 0, y: -0.504094, z: -0.492839 }, rotation: { yaw: 0, pitch: 0.008999, roll: 1.570796 }, shape: 'capsule', radius: 0.825758, length: 0.825758 }, { bone: 'hips', centre: { x: 0.665158, y: -2.903378, z: -0.213923 }, rotation: { yaw: 0.000223, pitch: 0.007934, roll: 0.087266 }, shape: 'capsule', radius: 1.032198, length: 4.83276 }, { bone: 'hips', centre: { x: 1.099748, y: -8.081381, z: -0.678814 }, rotation: { yaw: 0.003655, pitch: 0.144452, roll: 0.025386 }, shape: 'capsule', radius: 0.975545, length: 4.877724 }, { bone: 'hips', centre: { x: 1.140365, y: -11.160665, z: -0.117358 }, rotation: { yaw: 0.04103, pitch: -0.939123, roll: -0.050825 }, shape: 'capsule', radius: 0.452136, length: 2.260682 }, { bone: 'hips', centre: { x: -0.66516, y: -2.903378, z: -0.213916 }, rotation: { yaw: -0.000223, pitch: 0.007934, roll: -0.087266 }, shape: 'capsule', radius: 1.032198, length: 4.83276 }, { bone: 'hips', centre: { x: -1.099755, y: -8.081381, z: -0.678808 }, rotation: { yaw: -0.003655, pitch: 0.144453, roll: -0.025388 }, shape: 'capsule', radius: 0.975545, length: 4.877725 }, { bone: 'hips', centre: { x: -1.140365, y: -11.160666, z: -0.117353 }, rotation: { yaw: -0.041054, pitch: -0.939121, roll: 0.050855 }, shape: 'capsule', radius: 0.452137, length: 2.260683 }, { bone: 'spine0', centre: { x: 0, y: 0.674025, z: -0.034203 }, rotation: { yaw: 0, pitch: 0.10221, roll: 1.570796 }, shape: 'capsule', radius: 0.825758, length: 0.825758 }, { bone: 'spine1', centre: { x: 0, y: 0.572642, z: -0.268933 }, rotation: { yaw: 0, pitch: -0.035687, roll: 1.570796 }, shape: 'capsule', radius: 1.032198, length: 0.10322 }, { bone: 'spine2', centre: { x: 0, y: 0.962057, z: -0.495778 }, rotation: { yaw: 0, pitch: -0.341657, roll: 1.570796 }, shape: 'capsule', radius: 1.032198, length: 0.516099 }, { bone: 'spine2', centre: { x: 0, y: 0.58316, z: 0.059292 }, rotation: { yaw: 0, pitch: -0.341657, roll: 1.570796 }, shape: 'capsule', radius: 0.825758, length: 0.928978 }, { bone: 'spine2', centre: { x: 0, y: 0.655566, z: 0.207009 }, rotation: { yaw: 0, pitch: 0, roll: 1.570451 }, shape: 'capsule', radius: 0.697031, length: 0.929375 }, { bone: 'spine2', centre: { x: 0, y: 0.039051, z: 0.445972 }, rotation: { yaw: 0, pitch: -0.341657, roll: 1.570796 }, shape: 'capsule', radius: 0.46005, length: 1.548297 }, { bone: 'hips', centre: { x: -0.72821, y: -2.391068, z: -0.289261 }, rotation: { yaw: 0, pitch: 0, roll: 0 }, shape: 'sphere', radius: 1.1 }, { bone: 'hips', centre: { x: 0.728209, y: -2.391068, z: -0.289269 }, rotation: { yaw: 0, pitch: 0, roll: 0 }, shape: 'sphere', radius: 1.1 }, { bone: 'neck', centre: { x: 0, y: 0.470364, z: 0.037781 }, rotation: { yaw: 0, pitch: 0.080151, roll: 0 }, shape: 'capsule', radius: 0.412879, length: 0.943767 }, { bone: 'head', centre: { x: 0, y: 0.860243, z: 0.022943 }, rotation: { yaw: 0, pitch: 0, roll: 0 }, shape: 'sphere', radius: 0.825758 }, { bone: 'head', centre: { x: 0, y: 0.104893, z: 0.414975 }, rotation: { yaw: 0, pitch: 0, roll: 1.570796 }, shape: 'capsule', radius: 0.464489, length: 0.309659 }, { bone: 'head', centre: { x: 0, y: 0.956125, z: -0.487721 }, rotation: { yaw: 0, pitch: 0, roll: 0 }, shape: 'sphere', radius: 1.04252 }, { bone: 'head', centre: { x: -0.452586, y: 1.128378, z: 0.824064 }, rotation: { yaw: 0, pitch: 0, roll: 0 }, shape: 'capsule', radius: 0.10322, length: 0.253954 }, { bone: 'head', centre: { x: -0.348281, y: 1.120623, z: 0.926298 }, rotation: { yaw: 0, pitch: 0, roll: 0 }, shape: 'capsule', radius: 0.10322, length: 0.259839 }, { bone: 'head', centre: { x: -0.126136, y: 1.128433, z: 0.988087 }, rotation: { yaw: 0, pitch: 0, roll: 0 }, shape: 'capsule', radius: 0.10322, length: 0.260983 }, { bone: 'head', centre: { x: 0.166144, y: 1.128582, z: 0.944818 }, rotation: { yaw: 0, pitch: 0, roll: 0 }, shape: 'capsule', radius: 0.10322, length: 0.260833 }, { bone: 'head', centre: { x: 0.445177, y: 1.125486, z: 0.829195 }, rotation: { yaw: 0, pitch: 0, roll: 0 }, shape: 'capsule', radius: 0.10322, length: 0.255016 }, { bone: 'head', centre: { x: 0.757472, y: 1.138391, z: 0.699048 }, rotation: { yaw: 0, pitch: 0, roll: 0 }, shape: 'capsule', radius: 0.05161, length: 0.332658 }] }
