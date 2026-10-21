import { create } from 'zustand'
import type { Play } from '@/lib/types/play'

// Library / viewer state: the list of plays the user is browsing
// and the play currently loaded in the viewer.
interface PlayState {
  plays: Play[]
  currentPlay: Play | null
  isLoading: boolean
  error: string | null

  setPlays: (plays: Play[]) => void
  setCurrentPlay: (play: Play | null) => void
  setLoading: (v: boolean) => void
  setError: (message: string | null) => void
}

export const usePlayStore = create<PlayState>()((set) => ({
  plays: [],
  currentPlay: null,
  isLoading: false,
  error: null,

  setPlays: (plays) => set({ plays }),
  setCurrentPlay: (play) => set({ currentPlay: play }),
  setLoading: (v) => set({ isLoading: v }),
  setError: (message) => set({ error: message }),
}))
