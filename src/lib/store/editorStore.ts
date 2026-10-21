import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { Play, PlayStep, PlayerMove, PassAnimation } from '@/lib/types/play'

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
    setIsPlaying: (v) => set((s) => { s.isPlaying = v }),
    setPreviewTime: (t) => set((s) => { s.previewTime = t }),
    markSaved: () => set((s) => { s.isDirty = false }),
  }))
)
