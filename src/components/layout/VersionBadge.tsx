/**
 * The build's version, pinned to the bottom-left of every page.
 *
 * It is there so a screenshot or a bug report carries the version with it — without it there is no way to tell
 * whether what you are looking at includes a given change. Deliberately tiny, dim and `pointer-events-none`,
 * so it can sit over the toolbar without ever swallowing a tap.
 */
export function VersionBadge() {
  const version = process.env.NEXT_PUBLIC_APP_VERSION
  if (!version) return null
  return (
    <span
      data-testid="version-badge"
      aria-hidden
      className="pointer-events-none fixed bottom-0 left-0 z-50 select-none rounded-tr bg-black/55 px-1 pt-[2px] font-mono text-[9px] leading-none text-[#e8edf2] opacity-60"
      style={{ paddingBottom: 'max(2px, env(safe-area-inset-bottom))' }}
    >
      v{version}
    </span>
  )
}
