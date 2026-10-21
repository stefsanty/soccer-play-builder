import { LibraryClient } from '@/components/library/LibraryClient'

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col gap-4 bg-[var(--bg-base)] px-5 pb-8 pt-12 text-[#e8edf2]">
      <header className="flex items-center justify-between">
        <h1 className="m-0 text-[30px] font-bold tracking-[-0.3px]">Plays</h1>
      </header>

      <LibraryClient />
    </main>
  )
}
