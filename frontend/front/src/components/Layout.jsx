import { useState } from 'react'
import { Menu, ShieldCheck, X } from 'lucide-react'
import { Logo } from './ui'

const LINKS = [
  { href: '/', label: 'Map', key: 'home' },
  { href: '/data/', label: 'Data', key: 'data' },
  { href: '/contribute/', label: 'Contribute', key: 'contribute' },
  { href: '/check/', label: 'Check an Address', key: 'check' },
  { href: '/about/', label: 'About', key: 'about' },
]

export function Nav({ active }) {
  const [open, setOpen] = useState(false)
  return (
    <header className="relative z-40 shrink-0 border-b border-ink-500 bg-ink-800">
      <div className="flex h-16 items-center justify-between gap-4 px-4 sm:px-8">
        <a href="/" className="flex items-center gap-3" aria-label="StreetVision home">
          <Logo />
          <span className="flex flex-col leading-none">
            <span className="font-display text-lg font-bold text-fg">StreetVision</span>
            <span className="mt-1 text-[10px] uppercase tracking-[0.06em] text-fg-faint">Grid Coordination Finder</span>
          </span>
        </a>

        <nav aria-label="Main" className="hidden items-center gap-7 md:flex">
          {LINKS.map((l) => (
            <a
              key={l.key}
              href={l.href}
              aria-current={active === l.key ? 'page' : undefined}
              className={`text-[13px] transition-colors ${
                active === l.key ? 'font-bold text-fg' : 'font-semibold text-fg-dim hover:text-fg'
              }`}
            >
              {l.label}
            </a>
          ))}
          <span className="flex items-center gap-1.5 rounded-full border border-ink-500 bg-ink-700 px-3 py-1.5" title="Every page is public. No accounts, no sign-in.">
            <ShieldCheck className="h-3.5 w-3.5 text-brand-teal" aria-hidden="true" />
            <span className="text-[11px] text-fg-dim">Public data · no login</span>
          </span>
        </nav>

        <button
          type="button"
          className="rounded-lg p-2 text-fg-dim hover:bg-ink-700 md:hidden"
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>
      {open && (
        <nav aria-label="Main" className="flex flex-col gap-1 border-t border-ink-500 px-4 py-3 md:hidden">
          {LINKS.map((l) => (
            <a
              key={l.key}
              href={l.href}
              aria-current={active === l.key ? 'page' : undefined}
              className={`rounded-lg px-3 py-2.5 text-sm ${active === l.key ? 'bg-ink-700 font-bold text-fg' : 'text-fg-dim'}`}
            >
              {l.label}
            </a>
          ))}
        </nav>
      )}
    </header>
  )
}

/** Page shell. `fill` pages (maps) take the full viewport height with no page scroll. */
export function Layout({ active, fill = false, children }) {
  return (
    <div className={fill ? 'flex h-full flex-col overflow-hidden' : 'flex min-h-full flex-col'}>
      <Nav active={active} />
      <main className={fill ? 'relative flex min-h-0 flex-1' : 'flex-1'}>{children}</main>
      {!fill && (
        <footer className="border-t border-ink-500 px-4 py-6 text-center text-[11.5px] text-fg-faint sm:px-8">
          StreetVision · Built for the Sperry Tech ShellHacks 2026 “Gridlock” Challenge · Public filings only, no CEII
        </footer>
      )}
    </div>
  )
}
