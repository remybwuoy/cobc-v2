import { useEffect, useRef, useState } from 'react';
import SectionHead from '../ui/SectionHead';
import { ArrowIcon, PauseIcon, PlayIcon } from '../ui/Icons';
import { useGsap } from '../../hooks/useGsap';
import { gsap, EXPO } from '../../lib/gsap';
import { reduceMotion } from '../../lib/env';
import { partners } from '../../data/content';
import './Partners.css';

/*
 * Every image in src/assets/partners/ is bundled automatically.
 * Keys are lower-cased file names, e.g. "acme.svg" → URL of the hashed build file, so
 * "Acme-Logo.svg" in the folder and "acme-logo.svg" in the data still match.
 */
const files = Object.fromEntries(
  Object.entries(import.meta.glob('../../assets/partners/*.{svg,png,webp,jpg,jpeg}', { eager: true, import: 'default' }))
    .map(([path, url]) => [path.split('/').pop().toLowerCase(), url]),
);
const key = (f) => f?.toLowerCase();

/** "example-health-logo.svg" → "Example Health" */
const nameFromFile = (f) => f.replace(/\.[^.]+$/, '').replace(/[-_]?logo$/i, '').replace(/[-_]+/g, ' ').trim()
  .replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * Logos only. Listed partners first (in order), then any logo in the folder that isn't listed.
 * A listed partner whose file isn't in the folder is left out rather than shown as text.
 */
const listed = new Set(partners.map((p) => key(p.logo)).filter(Boolean));
const all = [
  ...partners.filter((p) => {
    if (files[key(p.logo)]) return true;
    if (import.meta.env.DEV) console.warn(`Partners: no logo file for "${p.name}"${p.logo ? ` (looked for src/assets/partners/${p.logo})` : ''}; it is not shown.`);
    return false;
  }).map((p) => ({ ...p, src: files[key(p.logo)] })),
  ...Object.keys(files).filter((f) => !listed.has(f)).map((f) => ({ name: nameFromFile(f), src: files[f] })),
];

/** Each copy of the loop holds at least this many logos, so it's always wider than the screen. */
const MIN_PER_COPY = 10;
/** Auto-scroll speed, in px per second. */
const SPEED = 48;
/** How long auto-scroll waits after someone scrolls, swipes or drags by hand (ms). */
const IDLE = 2500;

function Logo({ p, hidden }) {
  const inner = <img src={p.src} alt={hidden ? '' : p.name} loading="lazy" draggable="false" />;
  const style = p.hoverBg ? { '--partner-hover': p.hoverBg } : undefined;
  return (
    <li className="partner" aria-hidden={hidden || undefined} style={style}>
      {p.href
        ? <a href={p.href} target="_blank" rel="noopener noreferrer" tabIndex={hidden ? -1 : undefined}
            aria-label={hidden ? undefined : `${p.name} (opens in a new tab)`}>{inner}</a>
        : <span className="partner-tile">{inner}</span>}
    </li>
  );
}

/**
 * Drives the endless rail. The track holds three identical copies and the rail is a real
 * horizontal scroller, so touch swipes and trackpads scroll it natively. When it reaches either
 * end it jumps by exactly one copy width, which looks identical, so the loop never ends.
 * Auto-scroll pauses while hovered, focused, touched, dragged, paused by the button, off screen,
 * and for a moment after any manual scroll.
 */
function useRail(railRef, perCopy, paused) {
  const api = useRef({ step: () => {} });
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    const rail = railRef.current;
    if (!rail || reduceMotion) return undefined;
    const track = rail.firstElementChild;
    const s = { pos: 0, copy: 0, vel: 0, hover: false, focus: false, touch: false, drag: null,
      moved: false, until: 0, visible: true, tween: null };

    // one copy's width = distance from the first logo of copy 1 to the first logo of copy 2
    const measure = () => {
      const items = track.children;
      s.copy = (items[perCopy]?.offsetLeft ?? 0) - (items[0]?.offsetLeft ?? 0);
    };
    const wrap = (x) => {
      const max = rail.scrollWidth - rail.clientWidth;
      if (s.copy <= 0) return x;
      while (x <= 0) x += s.copy;
      while (x >= max - 1) x -= s.copy;
      return x;
    };
    const set = (x) => { s.pos = wrap(x); rail.scrollLeft = s.pos; };
    const hold = (ms = IDLE) => { s.until = performance.now() + ms; };
    const stopMotion = () => { s.tween?.kill(); s.tween = null; s.vel = 0; };

    measure();
    set(s.copy); // start on the middle copy (the one screen readers and Tab reach)

    // ---- frame loop: momentum after a drag, otherwise auto-scroll ----
    let raf = 0;
    let last = performance.now();
    const tick = (now) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (s.drag || s.tween || !s.visible) return;
      if (Math.abs(s.vel) > 8) {
        set(s.pos + s.vel * dt);
        s.vel *= Math.exp(-dt * 5);
        return;
      }
      s.vel = 0;
      const auto = !pausedRef.current && !s.hover && !s.focus && !s.touch && now > s.until;
      if (auto) set(s.pos + SPEED * dt);
      else s.pos = rail.scrollLeft; // follow native (touch / trackpad / focus) scrolling
    };
    raf = requestAnimationFrame(tick);

    // ---- native scrolling: keep it inside the loop ----
    const onScroll = () => {
      const x = rail.scrollLeft;
      const w = wrap(x);
      if (Math.abs(w - x) > 1) { rail.scrollLeft = w; s.pos = w; }
    };

    // ---- wheel: horizontal gestures and Shift+wheel move the rail; vertical wheel scrolls the page ----
    const onWheel = (e) => {
      const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
      if (!e.shiftKey && Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      if (!dx) return;
      e.preventDefault();
      e.stopPropagation(); // keep Lenis from turning it into page scroll
      stopMotion();
      set(rail.scrollLeft + dx * (e.deltaMode === 1 ? 32 : 1));
      hold();
    };

    // ---- touch: native scrolling does the work; pause while a finger is down ----
    const onTouchStart = () => { s.touch = true; stopMotion(); };
    const onTouchEnd = () => { s.touch = false; hold(); };

    // ---- mouse drag, with a little momentum on release ----
    const onDown = (e) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      stopMotion();
      s.drag = { id: e.pointerId, x: e.clientX, start: rail.scrollLeft, lastX: e.clientX, lastT: e.timeStamp, v: 0 };
      s.moved = false;
    };
    const onMove = (e) => {
      const d = s.drag;
      if (!d || e.pointerId !== d.id) return;
      const dx = e.clientX - d.x;
      if (!s.moved) {
        if (Math.abs(dx) < 5) return;
        s.moved = true;
        rail.setPointerCapture(d.id);
        rail.classList.add('is-dragging');
      }
      const target = d.start - dx;
      set(target);
      if (Math.abs(s.pos - target) > 1) d.start += s.pos - target; // the loop jumped a copy: follow it
      const dt = Math.max(1, e.timeStamp - d.lastT);
      d.v = (-(e.clientX - d.lastX) / dt) * 1000;
      d.lastX = e.clientX;
      d.lastT = e.timeStamp;
    };
    const onUp = (e) => {
      const d = s.drag;
      if (!d || e.pointerId !== d.id) return;
      if (s.moved) {
        if (rail.hasPointerCapture(d.id)) rail.releasePointerCapture(d.id);
        rail.classList.remove('is-dragging');
        s.vel = e.timeStamp - d.lastT < 80 ? Math.max(-3000, Math.min(3000, d.v)) : 0;
        hold();
      }
      s.drag = null;
    };
    // a drag shouldn't also open the partner's link
    const onClick = (e) => {
      if (!s.moved) return;
      e.preventDefault();
      e.stopPropagation();
      s.moved = false;
    };

    const onEnter = (e) => { if (e.pointerType === 'mouse') s.hover = true; };
    const onLeave = (e) => { if (e.pointerType === 'mouse') { s.hover = false; hold(600); } };
    const onFocusIn = () => { s.focus = true; };
    const onFocusOut = (e) => { if (!rail.contains(e.relatedTarget)) s.focus = false; };

    const listeners = [
      ['scroll', onScroll, { passive: true }],
      ['wheel', onWheel, { passive: false }],
      ['touchstart', onTouchStart, { passive: true }],
      ['touchend', onTouchEnd, { passive: true }],
      ['touchcancel', onTouchEnd, { passive: true }],
      ['pointerdown', onDown],
      ['pointermove', onMove],
      ['pointerup', onUp],
      ['pointercancel', onUp],
      ['click', onClick, true],
      ['pointerenter', onEnter],
      ['pointerleave', onLeave],
      ['focusin', onFocusIn],
      ['focusout', onFocusOut],
    ];
    listeners.forEach(([type, fn, opts]) => rail.addEventListener(type, fn, opts));

    // keep the same spot in the loop when the layout changes (resize, logos loading)
    const ro = new ResizeObserver(() => {
      const offset = s.copy ? ((s.pos % s.copy) + s.copy) % s.copy : 0;
      measure();
      set(s.copy + offset);
    });
    ro.observe(rail);
    ro.observe(track);
    const io = new IntersectionObserver(([en]) => { s.visible = en.isIntersecting; last = performance.now(); });
    io.observe(rail);

    // previous / next buttons: move by one logo, eased
    api.current.step = (dir) => {
      const tile = track.children[0];
      const gap = parseFloat(getComputedStyle(track).columnGap) || 0;
      const by = (tile?.offsetWidth ?? 240) + gap;
      stopMotion();
      const proxy = { x: rail.scrollLeft };
      s.tween = gsap.to(proxy, {
        x: proxy.x + dir * by, duration: 0.7, ease: 'power3.out',
        onUpdate: () => { rail.scrollLeft = wrap(proxy.x); },
        onComplete: () => { s.pos = rail.scrollLeft; s.tween = null; hold(); },
      });
    };

    return () => {
      cancelAnimationFrame(raf);
      s.tween?.kill();
      ro.disconnect();
      io.disconnect();
      listeners.forEach(([type, fn, opts]) => rail.removeEventListener(type, fn, opts));
      api.current.step = () => {};
    };
  }, [railRef, perCopy]);

  return api;
}

/**
 * Partner logos in an endless sliding row that can also be moved by hand: swipe on touch
 * screens, drag with the mouse, use a trackpad or Shift+wheel, or the previous/next buttons.
 * It has a pause button (moving content must be stoppable). With reduced motion it's a still,
 * wrapping row.
 */
export default function Partners() {
  const ref = useRef(null);
  const railRef = useRef(null);
  const [paused, setPaused] = useState(false);

  // One copy = the list repeated until it's long enough; the track is three copies.
  const repeat = Math.max(1, Math.ceil(MIN_PER_COPY / Math.max(1, all.length)));
  const copy = Array.from({ length: repeat }, () => all).flat();
  const rail = useRail(railRef, copy.length, paused);

  useGsap(() => {
    gsap.from('.partners-rail', {
      y: 40, opacity: 0, duration: 1.1, ease: EXPO,
      scrollTrigger: { trigger: '.partners-rail', start: 'top 88%' },
    });
  }, ref);

  if (!all.length) return null;

  const track = reduceMotion ? all : [...copy, ...copy, ...copy];
  // Only the first run of partners in the middle copy is announced and focusable; the rest are visual repeats.
  const hidden = (i) => !reduceMotion && (i < copy.length || i >= copy.length + all.length);

  return (
    <section className="partners" id="partners" aria-labelledby="partnersH" ref={ref}>
      <div className="wrap">
        <SectionHead idx="07" label="Partners" id="partnersH"
          title={<>Building care<br />with <span className="t">good company.</span></>}
          lede="The organisations working with us to connect care, careers and community." />
      </div>

      <div className={`partners-rail${reduceMotion ? ' is-still' : ''}`} ref={railRef}>
        <ul className="partners-track" aria-label="Our partners">
          {track.map((p, i) => <Logo key={i} p={p} hidden={hidden(i)} />)}
        </ul>
      </div>

      {!reduceMotion && (
        <div className="wrap partners-ctrl">
          <button type="button" className="partners-btn partners-step" aria-label="Previous partners" onClick={() => rail.current.step(-1)}>
            <ArrowIcon className="flip" />
          </button>
          <button type="button" className="partners-btn partners-step" aria-label="Next partners" onClick={() => rail.current.step(1)}>
            <ArrowIcon />
          </button>
          <button type="button" className="partners-btn partners-toggle" aria-pressed={paused} onClick={() => setPaused((v) => !v)}>
            {paused ? <PlayIcon /> : <PauseIcon />}
            <span>{paused ? 'Play' : 'Pause'} slider</span>
          </button>
        </div>
      )}
    </section>
  );
}
