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

export type DefenderRule = ZoneRule | MarkRule

export interface PlayerMove {
  playerId: string
  toX: number
  toY: number
  startTime: number   // seconds within step
  endTime: number
  easeFraction?: number
  via?: [number, number]  // bezier control point
  hidden?: boolean        // don't draw this run's arrow (the move itself still happens)
}

export interface PassAnimation {
  from: string        // player id
  to: string
  startTime: number
  endTime: number
  isLob?: boolean
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
  id: string
  index: number
  title: string
  duration: number    // seconds
  narrativeOurs: string[]    // bullet points for "our team"
  narrativeOpp: string[]     // bullet points for "opponent"
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
