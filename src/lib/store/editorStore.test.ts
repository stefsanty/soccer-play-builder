import { beforeEach, describe, expect, it } from 'vitest'
import type { Play, PlayStep } from '@/lib/types/play'
import { createDefaultPlay } from '@/lib/engine/defaultPlay'
import { useEditorStore } from '@/lib/store/editorStore'

const step = (index: number, extra: Partial<PlayStep> = {}): PlayStep => ({
  id: `s${index}`,
  index,
  title: `Step ${index + 1}`,
  duration: 0,
  moves: [],
  passes: [],
  defenderRules: {},
  faceTargets: [],
  ...extra,
})

const pass = (from: string, to: string) => ({ from, to, startTime: 0, endTime: 1.2 })

function load(steps: PlayStep[]): Play {
  const play = { ...createDefaultPlay(), steps }
  useEditorStore.getState().setPlay(play)
  return useEditorStore.getState().play!
}

beforeEach(() => {
  useEditorStore.setState({ play: null, currentStepIndex: 0, isDirty: false })
})

describe('addPass: one pass per step', () => {
  it('a first pass lands in the step itself', () => {
    load([step(0), step(1)])
    const res = useEditorStore.getState().addPass(pass('o-GK', 'o-RCB'), 1)
    expect(res).toEqual({ stepIndex: 1, created: false })
    expect(useEditorStore.getState().play!.steps[1].passes).toHaveLength(1)
  })

  it('a second pass starts a new step right after, and selects it', () => {
    load([step(0), step(1, { passes: [pass('o-GK', 'o-RCB')] }), step(2, { title: 'Finish' })])
    const res = useEditorStore.getState().addPass(pass('o-RCB', 'o-RB'), 1)
    expect(res).toEqual({ stepIndex: 2, created: true })

    const s = useEditorStore.getState()
    const steps = s.play!.steps
    expect(steps).toHaveLength(4)
    expect(steps[1].passes).toHaveLength(1) // untouched
    expect(steps[2].passes[0]).toMatchObject({ from: 'o-RCB', to: 'o-RB' })
    expect(steps[2].duration).toBe(0) // derived
    expect(steps[3].title).toBe('Finish') // shifted down intact
    expect(steps.map((st) => st.index)).toEqual([0, 1, 2, 3])
    expect(s.currentStepIndex).toBe(2)
  })

  it('branch pointers at or past the insertion shift with their steps', () => {
    load([
      step(0),
      step(1, { passes: [pass('o-GK', 'o-RCB')] }),
      step(2),
      step(3, { isAltBranch: true, altFrom: 2, altAfter: 2 }),
    ])
    useEditorStore.getState().addPass(pass('o-RCB', 'o-RB'), 1)
    const steps = useEditorStore.getState().play!.steps
    const branch = steps.find((st) => st.isAltBranch)!
    expect(branch.altFrom).toBe(3) // still points at the same (shifted) step
    expect(branch.altAfter).toBe(3)
  })

  it('a branch pointer before the insertion stays put', () => {
    load([
      step(0),
      step(1),
      step(2, { isAltBranch: true, altFrom: 1, passes: [pass('o-GK', 'o-RCB')] }),
    ])
    useEditorStore.getState().addPass(pass('o-RCB', 'o-RB'), 2)
    const steps = useEditorStore.getState().play!.steps
    expect(steps[2].altFrom).toBe(1)
  })

  it('a second pass on an alt-branch step continues the branch', () => {
    load([
      step(0),
      step(1),
      step(2, { isAltBranch: true, altFrom: 1, altAfter: 1, altLabel: '1a', passes: [pass('o-GK', 'o-RCB')] }),
    ])
    const res = useEditorStore.getState().addPass(pass('o-RCB', 'o-RB'), 2)
    const created = useEditorStore.getState().play!.steps[res.stepIndex]
    expect(created.isAltBranch).toBe(true)
    expect(created.altFrom).toBe(2) // chains from the branch step it continues
    expect(created.altAfter).toBe(1)
  })
})
