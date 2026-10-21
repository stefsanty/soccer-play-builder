import Link from 'next/link'
import { AuthButton } from '@/components/layout/AuthButton'

export function Header() {
  return (
    <header className="flex items-center justify-between px-6 py-3 border-b border-slate-800">
      <Link href="/" className="font-bold text-lg">
        Soccer Play Builder
      </Link>
      <nav className="flex items-center gap-4 text-sm">
        <Link href="/library" className="text-slate-400 hover:text-white transition-colors">
          Library
        </Link>
        <Link href="/editor" className="text-slate-400 hover:text-white transition-colors">
          Editor
        </Link>
        <AuthButton />
      </nav>
    </header>
  )
}
