// Editor-specific types (not persisted with the play)

export type EditorMode =
  | 'select'        // click to select player
  | 'move'          // drag player to set end position for current step
  | 'pass'          // click source then target to draw pass
  | 'run'           // click source then target to draw run arrow
  | 'preview'       // animation playback mode

export interface DragState {
  playerId: string
  originX: number   // meters
  originY: number
  pointerId: number
}

export interface PendingLink {
  // first endpoint already picked while drawing a pass/run
  fromPlayerId: string
  kind: 'pass' | 'run'
}

export interface EditorSelection {
  playerId: string | null
  passIndex: number | null
  moveIndex: number | null
}
