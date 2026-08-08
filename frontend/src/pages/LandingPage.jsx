import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useTheme } from '../theme/ThemeContext';
import { useI18n, LANGUAGES } from '../i18n';
import { Logo } from '../components/ui';

/** Reveals children with a soft rise+blur when they scroll into view. */
function useReveal() {
  const ref = useRef(null);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      node?.classList.add('is-visible');
      return undefined;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            io.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
    );
    node.querySelectorAll('.reveal').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
  return ref;
}

const STORES = [
  { name: 'KFC Dhaka', emoji: '🍗' },
  { name: 'Chillox', emoji: '🍔' },
  { name: 'Pizza Hut', emoji: '🍕' },
  { name: 'Sultans Dine', emoji: '🍛' },
  { name: 'Star Kabab', emoji: '🥩' },
  { name: 'Madchef', emoji: '🍔' },
  { name: 'Tokyo House', emoji: '🍜' },
  { name: 'Gloria Jeans', emoji: '☕' },
];

const FEATURES = [
  { emoji: '🧾', title: 'Menu builder', desc: 'Categories, variants, add-ons, prices, photos and stock — one clean editor your whole team can use.' },
  { emoji: '📦', title: 'Bulk import', desc: 'Load hundreds of items from CSV or Excel with per-row validation and a friendly error report.' },
  { emoji: '🖼️', title: 'Image pipeline', desc: 'Upload once — sharp resizes to WebP, served from S3-compatible storage through a CDN.' },
  { emoji: '🛍️', title: 'Public storefront', desc: 'Every workspace gets a live, branded menu page your customers can open on any phone.' },
  { emoji: '📈', title: 'Live analytics', desc: 'Revenue trends, order volume and top sellers — updated the moment orders land.' },
  { emoji: '👥', title: 'Team & roles', desc: 'Owner, manager, cashier, kitchen, delivery — scoped access to exactly what each role needs.' },
];

const STEPS = [
  { n: '01', emoji: '🧾', titleKey: 'landing.step1Title', descKey: 'landing.step1Desc' },
  { n: '02', emoji: '🚀', titleKey: 'landing.step2Title', descKey: 'landing.step2Desc' },
  { n: '03', emoji: '🛵', titleKey: 'landing.step3Title', descKey: 'landing.step3Desc' },
];

export default function LandingPage() {
  const { theme, toggleTheme } = useTheme();
  const { t, lang, toggleLang } = useI18n();
  const revealRef = useReveal();

  return (
    <div className="landing" ref={revealRef}>
      {/* ---------- Nav ---------- */}
      <header className="landing__nav">
        <Link to="/" className="landing__brand">
          <Logo mark="O" />
          <span className="landing__brand-name">Orderly</span>
        </Link>
        <nav className="landing__links">
          <a href="#features">{t('landing.navFeatures')}</a>
          <a href="#how">{t('landing.navHow')}</a>
          <a href="#demos">{t('landing.navDemos')}</a>
        </nav>
        <div className="landing__actions">
          <button className="oms-icon-btn oms-lang-btn" onClick={toggleLang} aria-label="Toggle language" title={lang === 'en' ? 'বাংলা' : 'English'}>
            {LANGUAGES.find((l) => l.code !== lang)?.short}
          </button>
          <button className="oms-icon-btn" onClick={toggleTheme} aria-label="Toggle theme" title={theme === 'light' ? 'Dark mode' : 'Light mode'}>
            {theme === 'light' ? '🌙' : '☀️'}
          </button>
          <Link to="/login" className="landing__btn landing__btn--ghost">{t('auth.signIn')}</Link>
          <Link to="/register" className="landing__btn landing__btn--solid">{t('landing.ctaStart')}</Link>
        </div>
      </header>

      {/* ---------- Hero ---------- */}
      <section className="landing__hero">
        <div className="landing__blob landing__blob--1" />
        <div className="landing__blob landing__blob--2" />
        <div className="landing__blob landing__blob--3" />

        <div className="landing__food landing__food--1">🍔</div>
        <div className="landing__food landing__food--2">🍟</div>
        <div className="landing__food landing__food--3">🍕</div>
        <div className="landing__food landing__food--4">🧋</div>
        <div className="landing__food landing__food--5">🍗</div>

        <div className="landing__hero-inner reveal">
          <span className="landing__pill">🇧🇩 {t('landing.heroBadge')}</span>
          <h1 className="landing__title">
            {t('landing.heroTitle1')}
            <br />
            <span className="landing__gradient">{t('landing.heroTitle2')}</span>
          </h1>
          <p className="landing__sub">{t('landing.heroSub')}</p>
          <div className="landing__cta-row">
            <Link to="/register" className="landing__btn landing__btn--hero">{t('landing.ctaStart')} →</Link>
            <Link to="/m/kfc-dhaka" className="landing__btn landing__btn--hero-ghost">{t('landing.ctaDemo')}</Link>
          </div>
          <div className="landing__stats">
            <div className="landing__stat"><b>20+</b><span>{t('landing.statRestaurants')}</span></div>
            <div className="landing__stat"><b>10k+</b><span>{t('landing.statOrders')}</span></div>
            <div className="landing__stat"><b>99.9%</b><span>{t('landing.statUptime')}</span></div>
          </div>
        </div>
      </section>

      {/* ---------- Marquee ---------- */}
      <div className="landing__marquee" aria-hidden="true">
        <div className="landing__marquee-track">
          {[...STORES, ...STORES].map((s, i) => (
            <span key={i} className="landing__marquee-item">{s.emoji} {s.name} <span className="landing__marquee-dot">•</span></span>
          ))}
        </div>
      </div>

      {/* ---------- How it works ---------- */}
      <section id="how" className="landing__section">
        <h2 className="landing__h2 reveal">{t('landing.howTitle')}</h2>
        <div className="landing__steps">
          {STEPS.map((s, i) => (
            <div className="landing__step reveal" style={{ transitionDelay: `${i * 90}ms` }} key={s.n}>
              <div className="landing__step-num">{s.n}</div>
              <div className="landing__step-emoji">{s.emoji}</div>
              <h3>{t(s.titleKey)}</h3>
              <p>{t(s.descKey)}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- Features ---------- */}
      <section id="features" className="landing__section landing__section--alt">
        <h2 className="landing__h2 reveal">{t('landing.featuresTitle')}</h2>
        <p className="landing__sub reveal">{t('landing.featuresSub')}</p>
        <div className="landing__grid">
          {FEATURES.map((f, i) => (
            <div className="landing__card reveal" style={{ transitionDelay: `${(i % 3) * 80}ms` }} key={f.title}>
              <div className="landing__card-emoji">{f.emoji}</div>
              <h3>{f.title}</h3>
              <p>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- Storefront demo ---------- */}
      <section id="demos" className="landing__section">
        <div className="landing__demo reveal">
          <div className="landing__demo-copy">
            <h2 className="landing__h2">{t('landing.demoTitle')}</h2>
            <p className="landing__sub">{t('landing.demoSub')}</p>
            <div className="landing__demo-links">
              <Link to="/m/kfc-dhaka" className="landing__chip" style={{ '--chip': '#e4002b' }}>🍗 KFC Dhaka</Link>
              <Link to="/m/chillox" className="landing__chip" style={{ '--chip': '#f26522' }}>🍔 Chillox</Link>
              <Link to="/m/sultans-dine" className="landing__chip" style={{ '--chip': '#7b3f00' }}>🍛 Sultans Dine</Link>
              <Link to="/m/gloria-jeans" className="landing__chip" style={{ '--chip': '#5b1e2e' }}>☕ Gloria Jeans</Link>
            </div>
          </div>
          <div className="landing__phone">
            <div className="landing__phone-hero" style={{ '--brand': '#e4002b', '--accent': '#ffd400' }}>
              <span className="landing__phone-logo">🍗</span>
              <b>KFC Dhaka</b>
              <small>It’s finger lickin’ good — fresh in Dhaka</small>
            </div>
            <div className="landing__phone-chips">
              <span className="is-on">Chicken</span>
              <span>Burgers</span>
              <span>Sides</span>
            </div>
            {[
              { emoji: '🍗', name: 'Hot & Crispy (2 pc)', price: '৳ 320' },
              { emoji: '🍔', name: 'Zinger Burger', price: '৳ 260' },
              { emoji: '🍟', name: 'Classic Fries', price: '৳ 150' },
            ].map((it) => (
              <div className="landing__phone-item" key={it.name}>
                <span className="landing__phone-item-emoji">{it.emoji}</span>
                <span className="landing__phone-item-name">{it.name}</span>
                <span className="landing__phone-item-price">{it.price}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- CTA ---------- */}
      <section className="landing__cta reveal">
        <h2>{t('landing.ctaTitle')}</h2>
        <p>{t('landing.ctaSub')}</p>
        <Link to="/register" className="landing__btn landing__btn--hero">{t('landing.ctaStart')} →</Link>
      </section>

      {/* ---------- Footer ---------- */}
      <footer className="landing__footer">
        <span>{t('landing.footerTag')} 🇧🇩</span>
        <span className="landing__footer-links">
          <Link to="/login">{t('auth.signIn')}</Link>
          <Link to="/m/kfc-dhaka">{t('landing.navDemos')}</Link>
        </span>
      </footer>
    </div>
  );
}
