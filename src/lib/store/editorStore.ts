import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { AiConfig, Play, PlayStep, PlayerMove, PassAnimation } from '@/lib/types/play'
import { applyFormation, type FormationKey } from '@/lib/engine/formations'

export type EditorMode =
  | 'select'        // click to select player
  | 'move'          // drag player to set end position for current step
  | 'pass'          // click source then target to draw pass
  | 'run'           // click source then target to draw run arrow
  | 'preview'       // animation playback mode

/**
 * What the editor's bottom panel is for right now. 'play' is the default — a full-play timeline and a
 * Play-all button, so somebody landing on the page can watch what the play does. 'edit' is the authoring
 * UI (step chips, runs bar, behaviour); from there a 'back to play' button returns to 'play'. Orthogonal
 * to `mode` (which is the pitch's interaction mode); `mode === 'preview'` still takes over the whole
 * pitch and overrides the bottom panel either way.
 */
export type BottomMode = 'play' | 'edit'

interface EditorState {
  play: Play | null
  currentStepIndex: number
  mode: EditorMode
  bottomMode: BottomMode
  /** Play Mode is chain-playing step animations end to end: step 1's animation, then step 2's, and so
   *  on until the last step. Separate from `isPlaying`, which is the preview-mode single-step engine. */
  isPlayingAll: boolean
  selectedPlayerId: string | null
  isDirty: boolean
  isPlaying: boolean
  previewTime: number   // current time within step during preview
  showFormation: boolean   // faint markers of the OPP starting shape on the pitch

  // Actions
  setPlay: (play: Play) => void
  setMode: (mode: EditorMode) => void
  setBottomMode: (mode: BottomMode) => void
  setPlayingAll: (v: boolean) => void
  selectPlayer: (id: string | null) => void
  setCurrentStep: (index: number) => void
  addStep: () => void
  removeStep: (index: number) => void
  updateStep: (index: number, update: Partial<PlayStep>) => void
  movePlayer: (playerId: string, toX: number, toY: number, stepIndex: number, endTime?: number) => void
  addPass: (pass: PassAnimation, stepIndex: number) => void
  removePass: (stepIndex: number, passIndex: number) => void
  updatePass: (stepIndex: number, passIndex: number, update: Partial<PassAnimation>) => void
  removeMove: (stepIndex: number, playerId: string) => void
  updateMove: (stepIndex: number, playerId: string, update: Partial<PlayerMove>) => void
  /** Add a hidden "stay in place" move that locks the player out of AI suggestions. */
  addHold: (stepIndex: number, playerId: string, x: number, y: number) => void
  updatePlayerPosition: (playerId: string, x: number, y: number) => void  // initial position
  /** Merge `patch` into a team's defensive-AI config for a step; keys set to undefined are removed. */
  updateStepAi: (stepIndex: number, team: 'ours' | 'opp', patch: Partial<AiConfig>) => void
  /** Show/hide the arrow of one move in a step (`hidden: true` on the move). */
  toggleMoveHidden: (playerId: string, stepIndex: number) => void
  /** Hide or show every move arrow of a step. */
  setStepMovesHidden: (stepIndex: number, hidden: boolean) => void
  /** Reposition all players of `team` to `formation` standard coordinates. */
  applyFormation: (team: 'ours' | 'opp', formation: FormationKey) => void
  setShowFormation: (v: boolean) => void
  setIsPlaying: (v: boolean) => void
  setPreviewTime: (t: number) => void
  markSaved: () => void
}

export const useEditorStore = create<EditorState>()(
  immer((set) => ({
    play: null,
    currentStepIndex: 0,
    mode: 'select',
    bottomMode: 'play',
    isPlayingAll: false,
    selectedPlayerId: null,
    isDirty: false,
    isPlaying: false,
    previewTime: 0,
    showFormation: true,

    setPlay: (play) => set((s) => {
      const step0 = play.steps[0]
      const hasContent = step0 && (
        step0.passes.length > 0 ||
        step0.moves.length > 0 ||
        Object.keys(step0.defenderRules).length > 0 ||
        (step0.faceTargets?.length ?? 0) > 0
      )
      if (hasContent) {
        const setupStep: PlayStep = {
          id: crypto.randomUUID(),
          index: 0,
          title: 'Setup',
          duration: 0,
          moves: [],
          passes: [],
          defenderRules: {},
          faceTargets: [],
        }
        const shifted = play.steps.map((st, i) => ({
          ...st,
          index: i + 1,
          ...(st.isAltBranch && st.altFrom !== undefined ? { altFrom: st.altFrom + 1 } : {}),
        }))
        s.play = { ...play, steps: [setupStep, ...shifted] }
        s.isDirty = true
      } else {
        s.play = play
      }
    }),
    setMode: (mode) => set((s) => { s.mode = mode }),
    setBottomMode: (bottomMode) => set((s) => { s.bottomMode = bottomMode }),
    setPlayingAll: (isPlayingAll) => set((s) => { s.isPlayingAll = isPlayingAll }),
    selectPlayer: (id) => set((s) => { s.selectedPlayerId = id }),
    setCurrentStep: (index) => set((s) => { s.currentStepIndex = index; s.isPlaying = false; s.previewTime = 0 }),
    addStep: () => set((s) => {
      if (!s.play) return
      const newStep: PlayStep = {
        id: crypto.randomUUID(),
        index: s.play.steps.length,
        title: `Step ${s.play.steps.length + 1}`,
        duration: 4,
        moves: [],
        passes: [],
        defenderRules: {},
        faceTargets: [],
      }
      s.play.steps.push(newStep)
      s.currentStepIndex = s.play.steps.length - 1
      s.isDirty = true
    }),
    removeStep: (index) => set((s) => {
      if (!s.play) return
      s.play.steps.splice(index, 1)
      s.play.steps.forEach((step, i) => { step.index = i })
      s.currentStepIndex = Math.min(s.currentStepIndex, s.play.steps.length - 1)
      s.isDirty = true
    }),
    updateStep: (index, update) => set((s) => {
      if (!s.play) return
      Object.assign(s.play.steps[index], update)
      s.isDirty = true
    }),
    movePlayer: (playerId, toX, toY, stepIndex, endTime) => set((s) => {
      if (!s.play) return
      const step = s.play.steps[stepIndex]
      const existing = step.moves.findIndex(m => m.playerId === playerId)
      const move: PlayerMove = { playerId, toX, toY, startTime: 0, endTime: endTime ?? step.duration }
      if (existing >= 0 && step.moves[existing].hidden) move.hidden = true // re-aiming a run keeps its arrow hidden
      if (existing >= 0) step.moves[existing] = move
      else step.moves.push(move)
      s.isDirty = true
    }),
    addPass: (pass, stepIndex) => set((s) => {
      if (!s.play) return
      s.play.steps[stepIndex].passes.push(pass)
      s.isDirty = true
    }),
    removePass: (stepIndex, passIndex) => set((s) => {
      if (!s.play) return
      s.play.steps[stepIndex]?.passes.splice(passIndex, 1)
      s.isDirty = true
    }),
    updatePass: (stepIndex, passIndex, update) => set((s) => {
      if (!s.play) return
      const pass = s.play.steps[stepIndex]?.passes[passIndex]
      if (pass) Object.assign(pass, update)
      s.isDirty = true
    }),
    removeMove: (stepIndex, playerId) => set((s) => {
      if (!s.play) return
      const moves = s.play.steps[stepIndex]?.moves
      if (!moves) return
      const idx = moves.findIndex((m) => m.playerId === playerId)
      if (idx >= 0) moves.splice(idx, 1)
      s.isDirty = true
    }),
    updateMove: (stepIndex, playerId, update) => set((s) => {
      if (!s.play) return
      const move = s.play.steps[stepIndex]?.moves.find(m => m.playerId === playerId)
      if (move) Object.assign(move, update)
      s.isDirty = true
    }),
    addHold: (stepIndex, playerId, x, y) => set((s) => {
      if (!s.play) return
      const step = s.play.steps[stepIndex]
      const move: PlayerMove = { playerId, toX: x, toY: y, startTime: 0, endTime: step.duration, hidden: true }
      const existing = step.moves.findIndex((m) => m.playerId === playerId)
      if (existing >= 0) step.moves[existing] = move
      else step.moves.push(move)
      s.isDirty = true
    }),
    updatePlayerPosition: (playerId, x, y) => set((s) => {
      if (!s.play) return
      const player = s.play.players.find(p => p.id === playerId)
      if (player) { player.x = x; player.y = y }
      s.isDirty = true
    }),
    updateStepAi: (stepIndex, team, patch) => set((s) => {
      const step = s.play?.steps[stepIndex]
      if (!step) return
      const next: AiConfig = { ...(step.ai?.[team] ?? { on: false }), ...patch }
      for (const k of Object.keys(patch) as (keyof AiConfig)[]) if (patch[k] === undefined) delete next[k]
      step.ai = { ...step.ai, [team]: next }
      s.isDirty = true
    }),
    toggleMoveHidden: (playerId, stepIndex) => set((s) => {
      const move = s.play?.steps[stepIndex]?.moves.find((m) => m.playerId === playerId)
      if (!move) return
      if (move.hidden) delete move.hidden
      else move.hidden = true
      s.isDirty = true
    }),
    setStepMovesHidden: (stepIndex, hidden) => set((s) => {
      const moves = s.play?.steps[stepIndex]?.moves
      if (!moves) return
      for (const m of moves) {
        if (hidden) m.hidden = true
        else delete m.hidden
      }
      s.isDirty = true
    }),
    applyFormation: (team, formation) => set((s) => {
      if (!s.play) return
      s.play.players = applyFormation(s.play.players, team, formation)
      s.isDirty = true
    }),
    setShowFormation: (v) => set((s) => { s.showFormation = v }),
    setIsPlaying: (v) => set((s) => { s.isPlaying = v }),
    setPreviewTime: (t) => set((s) => { s.previewTime = t }),
    markSaved: () => set((s) => { s.isDirty = false }),
  }))
)
