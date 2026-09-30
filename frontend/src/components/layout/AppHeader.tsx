import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useProjectStore } from '../../store/useProjectStore';
import { ShareModal } from './ShareModal';
import { LanguageSwitcher } from './LanguageSwitcher';
import { ThemeToggle } from './ThemeToggle';
import { useLocalizedHref } from '../../i18n/useLocalizedNavigate';
import { applyStripLayout, STRIP_BELOW_CLASS } from './headerStripFit';
import './LanguageSwitcher.css';

interface AppHeaderProps {
  /** Editor variant: a File/Edit menu bar rendered next to the logo. When
   *  set, the marketing nav links (Home / Docs / Pricing / …) are hidden —
   *  inside the editor they are noise that costs exactly the width the
   *  toolbar is starved of on small screens; the logo still links home.
   *  Same mechanism the Tauri desktop build uses (VITE_DESKTOP). */
  editorMenu?: React.ReactNode;
  /** Editor variant: the unified toolbar strip rendered in the header's
   *  middle — the space the marketing nav used to occupy. One row instead
   *  of header + toolbar stacked; the strip wraps internally when narrow
   *  and the header grows to fit (height: auto on the modifier class). */
  editorToolbar?: React.ReactNode;
}

export const AppHeader: React.FC<AppHeaderProps> = ({ editorMenu, editorToolbar }) => {
  const location = useLocation();
  const currentProject = useProjectStore((s) => s.currentProject);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const { t } = useTranslation();
  const localize = useLocalizedHref();

  // Close mobile menu on route change
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  // Editor variant: where does the toolbar strip go — on the brand row or
  // on its own bar below, labelled or icon-only? Measured, not guessed —
  // see headerStripFit.ts, which sets `app-header--strip-below` on the
  // header and `unified-toolbar--compact` on the strip. Re-measured
  // whenever the strip host, the brand block or a strip zone resizes
  // (window, docked chat, board controls mounting). The first measure runs
  // before paint; later ones are deferred a frame so toggling the classes
  // never re-enters ResizeObserver delivery.
  const headerRef = useRef<HTMLElement>(null);
  const hasStrip = !!editorToolbar;
  useLayoutEffect(() => {
    const header = headerRef.current;
    if (!header || !hasStrip) return;
    const apply = () => {
      applyStripLayout(header);
    };
    apply();
    if (typeof ResizeObserver === 'undefined') return;
    let raf = 0;
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        apply();
      });
    };
    const ro = new ResizeObserver(schedule);
    const content = header.querySelector<HTMLElement>(':scope > .header-content');
    const left = content?.querySelector<HTMLElement>(':scope > .header-left');
    const host = content?.querySelector<HTMLElement>(':scope > .header-editor-toolbar');
    const strip = host?.firstElementChild;
    for (const el of [left, host, ...(strip ? Array.from(strip.children) : [])]) {
      if (el) ro.observe(el);
    }
    // Zones mount their controls later (the canvas side is a portal) —
    // pick up children that appear after mount.
    const mo = strip
      ? new MutationObserver(() => {
          for (const z of Array.from(strip.children)) ro.observe(z);
          schedule();
        })
      : null;
    if (strip && mo) mo.observe(strip, { childList: true });
    return () => {
      ro.disconnect();
      mo?.disconnect();
      if (raf) cancelAnimationFrame(raf);
      header.classList.remove(STRIP_BELOW_CLASS);
    };
  }, [hasStrip]);

  // Tauri desktop: no brand row. Brand/auto-save/share/auth-slot all live
  // elsewhere in desktop: the title bar shows "Velxio Desktop", the native
  // menubar has File/Edit/View/Help, auto-save is a Pro cloud feature
  // (desktop saves to .vlx), share generates a velxio.dev URL that doesn't
  // apply to a desktop session, and the license flow owns its own
  // DesktopWelcomePage.
  //
  // This used to `return null` outright, back when the strip below the
  // header was empty in desktop and painted a black bar. Since the editor
  // toolbar strip (Compile / Run / Libraries, board + canvas controls)
  // moved INSIDE this header (`editorToolbar`, 2026-08), that early return
  // dropped the whole strip from the desktop app: 0.4.7 shipped with no
  // Compile, Run or Libraries button. Render the strip alone, in the same
  // .header-content > .header-editor-toolbar structure headerStripFit.ts
  // measures, with an empty .header-left so the whole row is toolbar.
  if (import.meta.env.VITE_DESKTOP) {
    if (!editorToolbar) return null;
    return (
      <header ref={headerRef} className="app-header app-header--with-toolbar app-header--desktop">
        <div className="header-content">
          <div className="header-left" />
          <div className="header-editor-toolbar">{editorToolbar}</div>
        </div>
      </header>
    );
  }

  // Compare with the trailing slash ignored: /editor is served (and
  // canonicalized) as /editor/ since it is prerendered, while client-side
  // navigation still lands on /editor.
  const samePath = (a: string, b: string) => a.replace(/\/+$/, '') === b.replace(/\/+$/, '');
  const isActive = (path: string) =>
    samePath(location.pathname, localize(path)) ? ' header-nav-link-active' : '';

  return (
    <header ref={headerRef} className={"app-header" + (editorToolbar ? ' app-header--with-toolbar' : '')}>
      <div className="header-content">
        <div className="header-left">
          {/* Brand */}
          <div className="header-brand">
            <img src="/favicon.svg" width="24" height="24" alt="" aria-hidden="true" />
            <Link to={localize('/')} style={{ textDecoration: 'none', color: 'inherit' }}>
              <span className="header-title">Wireup</span>
            </Link>
          </div>

          {/* Main nav links (web only). The Tauri desktop build hides
              this nav and surfaces the equivalent actions via the
              native menubar (see pro/desktop/src-tauri/src/menu.rs in
              velxio-prod). VITE_DESKTOP is the env flag the Tauri
              build sets — main.tsx already uses it to gate the @pro
              overlay, same pattern here. */}
          {editorMenu}
          {!import.meta.env.VITE_DESKTOP && !editorMenu && (
          <nav className={'header-nav-links' + (menuOpen ? ' header-nav-open' : '')}>
            <Link to={localize('/examples')} className={'header-nav-link' + isActive('/examples')}>
              {t('header.nav.examples')}
            </Link>
            <Link to={localize('/editor/')} className={'header-nav-link' + isActive('/editor')}>
              {t('header.nav.editor')}
            </Link>
            <a href="/about.html" className="header-nav-link">
              {t('header.nav.about')}
            </a>
          </nav>
          )}
        </div>

        {/* Editor toolbar strip — fills the middle the nav vacated. */}
        {editorToolbar && <div className="header-editor-toolbar">{editorToolbar}</div>}

        {/* Right: language + share + auth + mobile hamburger. In the
            desktop-editor variant this block does not render at all: the
            language switcher and the account button move to the corner box
            below (bottom-left), Share lives in File > Share/Embed, and the
            autosave dot rides next to the menus — every pixel of the row
            goes to the toolbar, which is what lets 1440px-with-chat keep
            the single-row layout. */}
        {!editorToolbar && (
        <div className="header-right">
          {/* Hidden on the marketing pages, which pin themselves to dark
              (pro DarkSurface) — offering a switch that visibly does nothing
              would be worse than not offering one. */}
          <ThemeToggle className="header-theme-toggle" />
          <LanguageSwitcher />

          {/* Share button — visible when a project is loaded */}
          {currentProject && samePath(location.pathname, localize('/editor')) && (
            <button
              onClick={() => setShowShareModal(true)}
              style={{
                background: 'transparent',
                border: '1px solid #555',
                borderRadius: 4,
                padding: '4px 10px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                color: '#ccc',
                fontSize: 13,
              }}
              title={t('header.shareProject', 'Share project')}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="18" cy="5" r="3" />
                <circle cx="6" cy="12" r="3" />
                <circle cx="18" cy="19" r="3" />
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
              </svg>
              Share
            </button>
          )}

          {/* Auth UI lives in the pro overlay — sign-in/sign-up buttons
              when anonymous, user dropdown when logged in. The overlay's
              mountPro() portals its HeaderAuth component into this slot
              via mountIntoSlot('header-auth'). In OSS without the
              overlay this slot stays empty, which is correct because the
              OSS image has no auth backend either. */}
          <div data-velxio-slot="header-auth" style={{ display: 'contents' }} />

          {/* Mobile hamburger — useless in desktop where the nav it
              would expand is itself hidden, and in the editor variant,
              where there is no nav to expand at all. */}
          {!import.meta.env.VITE_DESKTOP && !editorMenu && (
            <button
              className="header-hamburger"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="Toggle menu"
            >
              <span />
              <span />
              <span />
            </button>
          )}
        </div>
        )}
      </div>

      {/* The account + language block lives in the file-explorer footer now
          (EditorPage renders it) — fused so a long file tree never scrolls
          underneath a floating box. */}

      {showShareModal && <ShareModal onClose={() => setShowShareModal(false)} />}
    </header>
  );
};
