/* ============================================================
   GANTRY LANDING PAGE — APP.JS
   ============================================================ */

/* — Sliding nav pill indicator — */
(function () {
  const linksContainer = document.querySelector('.nav-links');
  if (!linksContainer) return;

  // Create and inject the sliding pill
  const pill = document.createElement('div');
  pill.className = 'nav-indicator';
  linksContainer.appendChild(pill);

  const navHomeEl = document.querySelector('.nav-home');

  // Section-linked nav items only (href="#...")
  const navItems = Array.from(document.querySelectorAll('.nav-link[href^="#"]')).map(link => ({
    link,
    section: document.getElementById(link.getAttribute('href').slice(1))
  })).filter(item => item.section);

  const allNavLinks = Array.from(document.querySelectorAll('.nav-link'));
  let lastSectionLink = undefined; // undefined forces first render

  function pillTo(link) {
    const cRect = linksContainer.getBoundingClientRect();
    const lRect = link.getBoundingClientRect();
    pill.style.left   = (lRect.left - cRect.left) + 'px';
    pill.style.width  = lRect.width + 'px';
    pill.style.top    = (lRect.top  - cRect.top)  + 'px';
    pill.style.height = lRect.height + 'px';
    pill.style.opacity = '1';
  }

  function moveToSection(sectionLink) {
    if (sectionLink === lastSectionLink) return;
    lastSectionLink = sectionLink;

    allNavLinks.forEach(l => (l.style.color = ''));

    if (sectionLink === null) {
      // At top — hide pill, highlight the home icon
      pill.style.opacity = '0';
      if (navHomeEl) navHomeEl.classList.add('nav-home-active');
      return;
    }

    if (navHomeEl) navHomeEl.classList.remove('nav-home-active');
    pillTo(sectionLink);
    sectionLink.style.color = '#111'; // dark text on white pill
  }

  function onScroll() {
    // Activate when a section's top reaches 40% down the viewport.
    // Using a viewport-relative threshold avoids dead zones caused by
    // section bottom-padding pushing adjacent section starts further down.
    const threshold = window.scrollY + window.innerHeight * 0.4;
    let active = null;
    for (const { link, section } of navItems) {
      const top = section.getBoundingClientRect().top + window.scrollY;
      if (threshold >= top) active = link;
    }
    moveToSection(active);
  }

  // Re-measure on resize (no animation)
  window.addEventListener('resize', () => {
    pill.style.transition = 'none';
    if (lastSectionLink) pillTo(lastSectionLink);
    requestAnimationFrame(() => { pill.style.transition = ''; });
  }, { passive: true });

  // Init without animation — onScroll() below sets the true initial state
  requestAnimationFrame(() => {
    pill.style.transition = 'none';
    if (lastSectionLink) pillTo(lastSectionLink);
    requestAnimationFrame(() => { pill.style.transition = ''; });
  });

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
})();

/* — Smooth scroll with lerp inertia — */
(function () {
  // Respect reduced-motion preference
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  let target  = window.scrollY;
  let current = window.scrollY;
  let rafId   = null;
  const EASE  = 0.09; // lower = more inertia / longer glide

  function clamp(v) {
    return Math.max(0, Math.min(document.documentElement.scrollHeight - window.innerHeight, v));
  }

  function tick() {
    const diff = target - current;
    if (Math.abs(diff) < 0.15) {
      current = target;
      window.scrollTo(0, current);
      rafId = null;
      return;
    }
    current += diff * EASE;
    window.scrollTo(0, current);
    rafId = requestAnimationFrame(tick);
  }

  // Intercept wheel — prevent native scroll, drive ours instead
  window.addEventListener('wheel', (e) => {
    e.preventDefault();
    target = clamp(target + e.deltaY);
    if (!rafId) rafId = requestAnimationFrame(tick);
  }, { passive: false });

  // Keyboard / programmatic scroll sync (arrow keys, Page Up/Down, etc.)
  window.addEventListener('scroll', () => {
    if (rafId) return; // ignore events we're generating via scrollTo
    current = window.scrollY;
    target  = window.scrollY;
  }, { passive: true });

  // Expose for nav anchor clicks
  window._smoothScrollTo = function (el) {
    target = clamp(el.getBoundingClientRect().top + current);
    if (!rafId) rafId = requestAnimationFrame(tick);
  };
})();

/* — Scroll reveal — */
const revealObserver = new IntersectionObserver(entries => {
  entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible'); });
}, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });

document.querySelectorAll('.reveal').forEach(el => revealObserver.observe(el));

/* — Product demo view switcher — */
(function () {
  const shell = document.querySelector('[data-demo-shell]');
  const views = Array.from(document.querySelectorAll('[data-demo-view]'));
  const controls = Array.from(document.querySelectorAll('[data-demo-target]'));
  if (!shell || !views.length || !controls.length) return;

  const mobileBreakpoint = window.matchMedia('(max-width: 768px)');
  const mobileMenuButton = shell.querySelector('.product-mobile-menu-toggle');
  const mobileCloseButton = shell.querySelector('.product-mobile-close');
  const mobileScrim = shell.querySelector('.product-mobile-scrim');

  function setMobileMenu(open) {
    shell.classList.toggle('is-mobile-nav-open', open);
    if (mobileMenuButton) {
      mobileMenuButton.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
  }

  function setView(nextView) {
    views.forEach((view) => {
      const active = view.dataset.demoView === nextView;
      view.classList.toggle('is-active', active);
      view.hidden = !active;
    });

    controls.forEach((control) => {
      const active = control.dataset.demoTarget === nextView;
      control.classList.toggle('is-active', active);
      if (control.classList.contains('demo-switch')) {
        control.setAttribute('aria-selected', active ? 'true' : 'false');
      }
    });

    if (mobileBreakpoint.matches) {
      setMobileMenu(false);
    }
  }

  controls.forEach((control) => {
    control.addEventListener('click', () => setView(control.dataset.demoTarget));
  });

  if (mobileMenuButton) {
    mobileMenuButton.addEventListener('click', () => setMobileMenu(true));
  }

  if (mobileCloseButton) {
    mobileCloseButton.addEventListener('click', () => setMobileMenu(false));
  }

  if (mobileScrim) {
    mobileScrim.addEventListener('click', () => setMobileMenu(false));
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      setMobileMenu(false);
    }
  });

  const handleBreakpointChange = (event) => {
    if (!event.matches) {
      setMobileMenu(false);
    }
  };

  if (typeof mobileBreakpoint.addEventListener === 'function') {
    mobileBreakpoint.addEventListener('change', handleBreakpointChange);
  } else if (typeof mobileBreakpoint.addListener === 'function') {
    mobileBreakpoint.addListener(handleBreakpointChange);
  }
})();

/* — Terminal typewriter — */
const termEl = document.getElementById('terminal-content');

const LINES = [
  { cls: 't-prompt', text: '$ gantry serve --dev', pause: 400 },
  { cls: 't-dim',    text: '', pause: 180 },
  { cls: 't-dim',    text: '  → Gantry v0.1.0', pause: 100 },
  { cls: 't-ok',     text: '  ✓ Database initialized', pause: 110 },
  { cls: 't-ok',     text: '  ✓ Schema validation ready', pause: 100 },
  { cls: 't-ok',     text: '  ✓ Kubernetes plugin  (3 clusters)', pause: 150 },
  { cls: 't-ok',     text: '  ✓ GitHub plugin connected', pause: 110 },
  { cls: 't-ok',     text: '  ✓ ArgoCD plugin connected', pause: 100 },
  { cls: 't-dim',    text: '', pause: 90 },
  { cls: 't-ok',     text: '  ✓ 127 entities loaded', pause: 180 },
  { cls: 't-dim',    text: '', pause: 80 },
  { cls: 't-url',    text: '  → Listening on http://localhost:8080', pause: 0 },
];

async function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function runTerminal() {
  await wait(600);
  for (const line of LINES) {
    await wait(line.pause);
    const span = document.createElement('span');
    span.className = `t-line ${line.cls}`;
    span.textContent = line.text;
    termEl.appendChild(span);
  }
  // blinking cursor
  const cur = document.createElement('span');
  cur.className = 't-cursor';
  termEl.appendChild(cur);
}

// Only animate when terminal enters viewport
const termObserver = new IntersectionObserver(entries => {
  if (entries[0].isIntersecting) {
    runTerminal();
    termObserver.disconnect();
  }
}, { threshold: 0.25 });

if (termEl) termObserver.observe(termEl);

/* — Smooth anchor scroll — */
document.querySelectorAll('a[href^="#"]').forEach(a => {
  a.addEventListener('click', e => {
    const target = document.querySelector(a.getAttribute('href'));
    if (!target) return;
    e.preventDefault();
    if (window._smoothScrollTo) window._smoothScrollTo(target);
    else target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});
