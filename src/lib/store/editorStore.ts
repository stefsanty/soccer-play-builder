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

interface EditorState {
  play: Play | null
  currentStepIndex: number
  mode: EditorMode
  selectedPlayerId: string | null
  isDirty: boolean
  isPlaying: boolean
  previewTime: number   // current time within step during preview
  showFormation: boolean   // faint markers of the OPP starting shape on the pitch

  // Actions
  setPlay: (play: Play) => void
  setMode: (mode: EditorMode) => void
  selectPlayer: (id: string | null) => void
  setCurrentStep: (index: number) => void
  addStep: () => void
  removeStep: (index: number) => void
  updateStep: (index: number, update: Partial<PlayStep>) => void
  movePlayer: (playerId: string, toX: number, toY: number, stepIndex: number) => void
  addPass: (pass: PassAnimation, stepIndex: number) => void
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
    selectedPlayerId: null,
    isDirty: false,
    isPlaying: false,
    previewTime: 0,
    showFormation: true,

    setPlay: (play) => set((s) => { s.play = play }),
    setMode: (mode) => set((s) => { s.mode = mode }),
    selectPlayer: (id) => set((s) => { s.selectedPlayerId = id }),
    setCurrentStep: (index) => set((s) => { s.currentStepIndex = index; s.isPlaying = false; s.previewTime = 0 }),
    addStep: () => set((s) => {
      if (!s.play) return
      const newStep: PlayStep = {
        id: crypto.randomUUID(),
        index: s.play.steps.length,
        title: `Step ${s.play.steps.length + 1}`,
        duration: 4,
        narrativeOurs: [],
        narrativeOpp: [],
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
    movePlayer: (playerId, toX, toY, stepIndex) => set((s) => {
      if (!s.play) return
      const step = s.play.steps[stepIndex]
      const existing = step.moves.findIndex(m => m.playerId === playerId)
      const move: PlayerMove = { playerId, toX, toY, startTime: 0, endTime: step.duration }
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
