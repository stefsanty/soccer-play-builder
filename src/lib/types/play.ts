// Play data model — the canonical schema for a saved play
export type Formation = '4-4-2' | '4-5-1' | '4-3-3' | '3-5-2' | '4-2-3-1' | 'custom'

export type TeamId = 'ours' | 'opp'

export interface PlayerPosition {
  id: string          // e.g. "RB", "CM", "oST1"
  team: TeamId
  label: string       // display label
  x: number          // meters, 0..68
  y: number          // meters, 0..105
  isContext?: boolean // dimmed player on edge of view
}

export type DefenderRuleType = 'zone' | 'mark'

export interface ZoneRule {
  type: 'zone'
  target: [number, number]  // [x, y] meters
  delay?: number
}

export interface MarkRule {
  type: 'mark'
  attacker: string    // player id to mark
  gap: number         // meters behind
  weight: number      // 0..1 interpolation to zone
  zone: [number, number]
  delay?: number
  dx?: number
}

/** Region a follower is allowed to work in. */
export type Bounds =
  | { kind: 'rect'; x0: number; y0: number; x1: number; y1: number }
  | { kind: 'circle'; c: [number, number]; r: number }

/** Close down `att` at full pressure (gain 4.0): stand `gap` m goal-side of them, `dx` m across. */
export interface PressRule {
  type: 'press'
  att: string
  delay?: number
  gap?: number   // default 1.0
  dx?: number
}

/** Shadow `att` inside `bounds`; hand them over when they leave (see engine/follow.ts). */
export interface FollowRule {
  type: 'follow'
  att: string
  zone: [number, number]
  bounds: Bounds
  delay?: number
  gap?: number   // goal-side offset, default 2.5
  w?: number     // 0..1 blend zone -> attacker, default 0.85
  dx?: number
  /** Who picks the attacker up when they leave the bounds: nearest eligible ('auto'), nobody, or a given player. */
  handoff?: 'auto' | 'none' | string
}

export type AiRole = 'auto' | 'presser' | 'cover' | 'support' | 'line' | 'wide' | 'screen' | 'mark' | 'gk'

/**
 * Hand this player to the defensive AI (engine/ai.ts) from `delay`, optionally forcing a role.
 * `x`, `y`, `gain` are filled in by the engine while the step plays.
 */
export interface AiRule {
  type: 'ai'
  delay?: number
  role?: AiRole
  x?: number
  y?: number
  gain?: number
}

export type DefenderRule = ZoneRule | MarkRule | PressRule | FollowRule | AiRule

/** Defensive AI settings for one team in a step. */
export interface AiConfig {
  on: boolean
  /** Quick-set bundle, kept for backward compatibility: maps to aggressiveness low=20, mid=50, high=80. */
  intensity?: 'low' | 'mid' | 'high'
  /** 0-100, default 50. How readily defenders break shape to press (takes precedence over `intensity`). */
  aggressiveness?: number
  /** 0-100, default 50. Explicit defensive-line height: 0 = defending the box, 100 = high press line. */
  lineHeight?: number
  /** 0-100, default 50. How wide the formation holds: 0 = compressed to the centre, 100 = wide players on the touchline. */
  width?: number
  offsideLine?: boolean                  // default true
  reaction?: number                      // seconds before the AI engages; default 0.4
  exclude?: string[]                     // player ids the AI must not touch
}

export interface PlayerMove {
  playerId: string
  toX: number
  toY: number
  startTime: number   // seconds within step
  endTime: number
  easeFraction?: number
  via?: [number, number]  // bezier control point
  hidden?: boolean        // don't draw this run's arrow (the move itself still happens)
  runningSpeed?: 'jog' | 'sprint'
}

export interface PassAnimation {
  from: string        // player id
  to: string
  startTime: number
  endTime: number
  isLob?: boolean
  passingSpeed?: 'slow' | 'medium' | 'fast'
}

export interface FaceTarget {
  playerId: string
  at: number          // seconds
  to: string | [number, number]  // player id or [x,y]
}

export interface AnnotationGap {
  playerA: string
  playerB: string
  showFrom: number
  label: string
}

export interface AnnotationRest {
  playerIds: string[]
  showFrom: number
  label: string
}

export interface AnnotationOffside {
  showFrom: number
  showTo: number
  label: string
}

/** Dotted "pass option" lines between player pairs, shown while t is in [from, to) (to: null = until the end). */
export interface OptionGroup {
  pairs: [string, string][]
  /** One per pair; `a` says which end of the line the label sits at. */
  labels?: { t: string; a: 'start' | 'end' }[]
  from: number
  to: number | null
}

export interface PlayStep {
  ai?: { ours?: AiConfig; opp?: AiConfig }   // defensive AI per team
  /** Starting ball spot in metres, authored on the setup step (steps[0]). Unset = centre pitch. */
  ballPosition?: { x: number; y: number }
  id: string
  index: number
  title: string
  duration: number    // seconds
moves: PlayerMove[]
  passes: PassAnimation[]
  defenderRules: Record<string, DefenderRule[]>  // oppPlayerId -> rules
  faceTargets: FaceTarget[]
  showConeFor?: string        // player id
  gapAnnotation?: AnnotationGap
  restAnnotation?: AnnotationRest
  offsideAnnotation?: AnnotationOffside
  options?: OptionGroup[]
  diagPass?: { pass: number; from: number }   // callout "Diagonal pass" on passes[pass] from time `from`
  hasAlt?: boolean            // an alternative branch starts after this step
  altAfter?: number           // list position: the branch is offered after this main step
  isAltBranch?: boolean       // alternate path branch
  altFrom?: number            // which main step this branches from
  altLabel?: string
  altButtonText?: string
}

export interface PlayMeta {
  formation: Formation
  viewSide: 'right' | 'left' | 'full'  // which half of pitch to show
  tags: string[]
  isPublic: boolean
  forkOf?: string   // play id this was forked from
}

export interface Play {
  id: string
  title: string
  description?: string
  authorId: string
  authorName: string
  createdAt: string
  updatedAt: string
  meta: PlayMeta
  players: PlayerPosition[]   // starting positions
  steps: PlayStep[]
}

// For the DB — plays table stores this as JSON in a jsonb column
export type PlayInsert = Omit<Play, 'id' | 'createdAt' | 'updatedAt'>
export type PlayUpdate = Partial<PlayInsert>
