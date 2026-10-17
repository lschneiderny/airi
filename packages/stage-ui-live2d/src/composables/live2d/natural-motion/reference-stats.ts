import type { MetricReference, ParameterRanges } from './liveliness'

// Recorder: shuka-vts-recorder riggold.v2.
// Sessions: session-20260515T134050 (18m50s), session-20260515T140122 (2h23m).

// Exclude tracking failures and >=5 s all-head near-neutral bouts (<0.01), with 1 s margins.
// Source gaps >200 ms split spans. Resample each valid span to 30 Hz;
// speed = Euclidean head delta / elapsed seconds, in manifest model units.
// Extraction date: 2026-10-17.

// Eyelid and body SD are report-only (VTS eyelids extend to 1.9; body is head-derived).
// Talking: no reference talking segment; relative criteria only.
// Hard-failure thresholds are never widened, even when a recording exceeds them.

// VTS API head values can exceed manifest ranges (approximately +/-45 versus +/-30).
// Session occupancy remains measured; reference mode reports clipping as a warning.
// Generated output retains the 1% clipping hard limit and its gate band.

// sd:ParamAngleX: widened [5.3541880213785245,10.708376042757049] to [5.3541880213785245,13.051403889424416] to include both recorded sessions.

// sd:ParamAngleZ: widened [1.58687796768956,3.17375593537912] to [1.58687796768956,3.5953563099973973] to include both recorded sessions.

// sd:ParamEyeBallX: widened [0.06600871297505059,0.13201742595010119] to [0.06600871297505059,0.15334916024795586] to include both recorded sessions.

// sd:ParamBrowLY: widened [0.030419217588284225,0.06083843517656845] to [0.030419217588284225,0.07934660480544181] to include both recorded sessions.

// sd:ParamMouthOpenY: widened [0.017438251777509486,0.03487650355501897] to [0.017438251777509486,0.0609575370784888] to include both recorded sessions.

// sd:ParamMouthForm: widened [0.035232431621301,0.070464863242602] to [0.035232431621301,0.11388245053133991] to include both recorded sessions.

// still2: widened [0.22,0.43] to [0.22,0.44666409483792263] to include both recorded sessions.

// top10PathShare: widened [0.35,0.52] to [0.35,0.5671054972695604] to include both recorded sessions.

// jitter: widened [0.000015609601360065445,0.00004162560362684119] to [0.000015609601360065445,0.00004765999092394048] to include both recorded sessions.

// speedPeakP90P50: widened [2.0908315057810483,4.1816630115620965] to [2.0908315057810483,5.795340583372552] to include both recorded sessions.

// meanAngleY: widened [-20.4,-12.4] to [-20.4,-5.930436026990339] to include both recorded sessions.

// minuteAngleYRange: widened [8,22] to [8,29.5230326365945] to include both recorded sessions.

// angleXp5: widened [-24.1,-16.1] to [-34.18310963023878,-16.1] to include both recorded sessions.

// blinkRate: widened [1.68764926143232,4.5003980304861875] to [1.68764926143232,5.095348812962016] to include both recorded sessions.
export const referenceStats: {
  ranges: ParameterRanges
  sessions: Record<string, Record<string, number | null>>
  bands: Record<string, MetricReference>
  talking: Record<string, MetricReference>
} = {
  ranges: {
    ParamAngleX: {
      min: -30,
      max: 30,
      default: 0,
    },
    ParamAngleY: {
      min: -30,
      max: 30,
      default: 0,
    },
    ParamAngleZ: {
      min: -30,
      max: 30,
      default: 0,
    },
    ParamBodyAngleX: {
      min: -10,
      max: 10,
      default: 0,
    },
    ParamBodyAngleY: {
      min: -10,
      max: 10,
      default: 0,
    },
    ParamBodyAngleZ: {
      min: -10,
      max: 10,
      default: 0,
    },
    ParamBreath: {
      min: 0,
      max: 1,
      default: 0,
    },
    ParamBrowLY: {
      min: -1,
      max: 1,
      default: 0,
    },
    ParamEyeBallX: {
      min: -1,
      max: 1,
      default: 0,
    },
    ParamEyeBallY: {
      min: -1,
      max: 1,
      default: 0,
    },
    ParamEyeLOpen: {
      min: 0,
      max: 1,
      default: 1,
    },
    ParamEyeROpen: {
      min: 0,
      max: 1,
      default: 1,
    },
    ParamMouthForm: {
      min: -1,
      max: 1,
      default: 0,
    },
    ParamMouthOpenY: {
      min: 0,
      max: 1,
      default: 0,
    },
  },
  sessions: {
    'session-20260515T134050': {
      'sd:ParamAngleX': 7.64884003054075,
      'sd:ParamAngleY': 6.4248770478759445,
      'sd:ParamAngleZ': 2.2669685252708,
      'sd:ParamEyeBallX': 0.09429816139292942,
      'sd:ParamEyeBallY': 0.12334776343750804,
      'sd:ParamBrowLY': 0.043456025126120325,
      'sd:ParamMouthOpenY': 0.024911788253584984,
      'sd:ParamMouthForm': 0.05033204517328714,
      'sd:ParamEyeLOpen': 0.21297005499137023,
      'sd:ParamEyeROpen': 0.21433663020678684,
      'sd:ParamBodyAngleX': 2.548586398119136,
      'sd:ParamBodyAngleY': 1.426215712689859,
      'sd:ParamBodyAngleZ': 0.757997226614395,
      'still05': 0.045876699000501224,
      'still2': 0.35253707580269483,
      'top10PathShare': 0.4308186958414541,
      'velocityAcfCrossing': 0.26666666666666666,
      'loopPeak': 0.04054612070918109,
      'jitter': 0.000026016002266775742,
      'speedPeakP90P50': 2.986902151115783,
      'speedPeakLogAsymmetry': 1.501297862559501,
      'eyeHeadCorrelation': -0.8399972159845418,
      'meanAngleY': -16.422992931567315,
      'minuteAngleYRange': 17.8274605845174,
      'angleXp5': -20.056900454502493,
      'angleXp95': 8.795345774236537,
      'nearLimitOccupancy': 0.0035575997012402463,
      'blinkRate': 2.812748769053867,
      'blinkCv': 2.6529490594898304,
    },
    'session-20260515T140122': {
      'sd:ParamAngleX': 13.051403889424416,
      'sd:ParamAngleY': 7.0542483721786855,
      'sd:ParamAngleZ': 3.5953563099973973,
      'sd:ParamEyeBallX': 0.15334916024795586,
      'sd:ParamEyeBallY': 0.12690940478658735,
      'sd:ParamBrowLY': 0.07934660480544181,
      'sd:ParamMouthOpenY': 0.0609575370784888,
      'sd:ParamMouthForm': 0.11388245053133991,
      'sd:ParamEyeLOpen': 0.28904886142028763,
      'sd:ParamEyeROpen': 0.28904780884576087,
      'sd:ParamBodyAngleX': 4.349096314681653,
      'sd:ParamBodyAngleY': 1.5647307915898778,
      'sd:ParamBodyAngleZ': 1.2013838614489607,
      'still05': 0.08629875613850341,
      'still2': 0.44666409483792263,
      'top10PathShare': 0.5671054972695604,
      'velocityAcfCrossing': 0.23333333333333334,
      'loopPeak': 0.02341633229736687,
      'jitter': 0.00004765999092394048,
      'speedPeakP90P50': 5.795340583372552,
      'speedPeakLogAsymmetry': 2.010872176026868,
      'eyeHeadCorrelation': -0.7687532156581403,
      'meanAngleY': -5.930436026990339,
      'minuteAngleYRange': 29.5230326365945,
      'angleXp5': -34.18310963023878,
      'angleXp95': 5.433529292828111,
      'nearLimitOccupancy': 0.05659456172356876,
      'blinkRate': 5.095348812962016,
      'blinkCv': 1.7843811577201225,
    },
  },
  bands: {
    'sd:ParamAngleX': {
      band: [5.3541880213785245, 13.051403889424416],
      provisional: false,
    },
    'sd:ParamAngleY': {
      band: [4.497413933513161, 8.994827867026322],
      provisional: false,
    },
    'sd:ParamAngleZ': {
      band: [1.58687796768956, 3.5953563099973973],
      provisional: false,
    },
    'sd:ParamEyeBallX': {
      band: [0.06600871297505059, 0.15334916024795586],
      provisional: false,
    },
    'sd:ParamEyeBallY': {
      band: [0.08634343440625562, 0.17268686881251125],
      provisional: false,
    },
    'sd:ParamBrowLY': {
      band: [0.030419217588284225, 0.07934660480544181],
      provisional: false,
    },
    'sd:ParamMouthOpenY': {
      band: [0.017438251777509486, 0.0609575370784888],
      provisional: false,
    },
    'sd:ParamMouthForm': {
      band: [0.035232431621301, 0.11388245053133991],
      provisional: false,
    },
    'sd:ParamEyeLOpen': {
      band: null,
      provisional: false,
    },
    'sd:ParamEyeROpen': {
      band: null,
      provisional: false,
    },
    'sd:ParamBodyAngleX': {
      band: null,
      provisional: false,
    },
    'sd:ParamBodyAngleY': {
      band: null,
      provisional: false,
    },
    'sd:ParamBodyAngleZ': {
      band: null,
      provisional: false,
    },
    'still05': {
      band: [0.02, 0.1],
      provisional: false,
    },
    'still2': {
      band: [0.22, 0.44666409483792263],
      provisional: false,
    },
    'top10PathShare': {
      band: [0.35, 0.5671054972695604],
      provisional: false,
    },
    'velocityAcfCrossing': {
      band: [0.16, 0.4266666666666667],
      provisional: true,
    },
    'loopPeak': {
      band: [0, 0.299999],
      provisional: false,
    },
    'jitter': {
      band: [0.000015609601360065445, 0.00004765999092394048],
      provisional: true,
    },
    'speedPeakP90P50': {
      band: [2.0908315057810483, 5.795340583372552],
      provisional: false,
    },
    'speedPeakLogAsymmetry': {
      band: [1.0509085037916506, 2.101817007583301],
      provisional: false,
    },
    'eyeHeadCorrelation': {
      band: [-0.95, -0.65],
      provisional: false,
    },
    'meanAngleY': {
      band: [-20.4, -5.930436026990339],
      provisional: false,
    },
    'minuteAngleYRange': {
      band: [8, 29.5230326365945],
      provisional: false,
    },
    'angleXp5': {
      band: [-34.18310963023878, -16.1],
      provisional: false,
    },
    'angleXp95': {
      band: [4.8, 12.8],
      provisional: false,
    },
    'nearLimitOccupancy': {
      band: [0, 0.01],
      provisional: false,
    },
    'blinkRate': {
      band: [1.68764926143232, 5.095348812962016],
      provisional: true,
    },
    'blinkCv': {
      band: [1.5917694356938983, 4.2447184951837285],
      provisional: true,
    },
  },
  talking: {
    speedRatio: {
      band: [1.15, 1.7],
      provisional: true,
    },
    onsetEnrichment: {
      band: [1.2, 100],
      provisional: true,
    },
  },
}
