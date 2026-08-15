import { usePaperTheme } from '../hooks/usePaperTheme';

/**
 * Auth shell — "TICKET TO YOUR WORKSPACE"
 * ------------------------------------------------------------
 * The sign-in experience reads as the same hand-held ticket the
 * restaurant prints for its customers: a deep-green brand stub
 * with a gold-foil ORDERLY wordmark and ticket number, perforated
 * off with the scalloped tear, and the form sitting on paper
 * below. The paper follows the global paper theme (rice paper in
 * light, ink paper in dark) so the auth pages are one more
 * surface of the same ticket identity — never a detached card.
 */
const ORBS = ['🍜', '🥟', '🍢', '🍛', '🥠'];

export default function AuthTicket({ title, desc, children, footer, ticketNo = 'No. 0041' }) {
  const { effectiveDark, cyclePaper } = usePaperTheme();

  return (
    <div className={`auth-ticket${effectiveDark ? ' auth-ticket--dark' : ''}`}>
      {/* Food orbs floating behind the stub — the landing's playful motif. */}
      <div className="auth-ticket__orbs" aria-hidden="true">
        {ORBS.map((o, i) => (
          <span key={o} className={`auth-ticket__orb auth-ticket__orb--${i + 1}`}>
            {o}
          </span>
        ))}
      </div>

      <div className="auth-ticket__card">
        <header className="auth-ticket__stub">
          <div className="auth-ticket__stubTop">
            <span className="auth-ticket__brand">Orderly</span>
            <button
              type="button"
              className="auth-ticket__paper"
              onClick={cyclePaper}
              aria-label={effectiveDark ? 'Switch to light paper' : 'Switch to ink paper'}
              title={effectiveDark ? 'Light paper' : 'Ink paper'}
            >
              {effectiveDark ? '☀️' : '🌙'}
            </button>
          </div>

          <div className="auth-ticket__stubRow">
            <span className="auth-ticket__eyebrow">Ticket to your workspace</span>
            <span className="auth-ticket__no">{ticketNo}</span>
          </div>

          <p className="auth-ticket__tagline">Your restaurant's order desk.</p>

          <div className="auth-ticket__tear" />
        </header>

        <main className="auth-ticket__body">
          <h1 className="auth-ticket__title">{title}</h1>
          {desc && <p className="auth-ticket__desc">{desc}</p>}
          {children}
          {footer && <div className="auth-ticket__footer">{footer}</div>}
        </main>
      </div>
    </div>
  );
}
