// Brutus's companions: nine small animated characters drawn as inline SVG, one of which the
// user picks in Settings → Assistant. UMD like the other lib/ models: window.CSMPets in the
// renderer, require() in jest. Pure, no DOM. The drawings were chosen on a design page
// (2026-09-29); each keeps its own colours whatever the theme. The state class on the svg
// drives the animations in style.css (.pe-rest / .pe-think / .pe-happy / .pe-wait / .pe-sleep).
(function (root, factory) {
  const api = factory()
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  else root.CSMPets = api
})(typeof self !== 'undefined' ? self : this, function () {
  const NAMES = ['blob', 'ghost', 'bunny', 'cloud', 'star', 'cat', 'crab', 'robot', 'devil']
  const LABELS = { blob: 'Blob', ghost: 'Ghost', bunny: 'Mochi bunny', cloud: 'Cloud', star: 'Star', cat: 'Cat', crab: 'Crab', robot: 'Robot', devil: 'Little devil' }
  const STATES = ['rest', 'think', 'happy', 'wait', 'sleep']
  let seq = 0
  let BADGE = ''
const EYES = (lx, rx, y, r) => `
  <g class="pe-eyes"><circle cx="${lx}" cy="${y}" r="${r}" fill="#fdfcff"/><circle cx="${rx}" cy="${y}" r="${r}" fill="#fdfcff"/>
    <g class="pe-pupils"><circle cx="${lx + .6}" cy="${y + .8}" r="${r * .62}" fill="#231c33"/><circle cx="${rx + .6}" cy="${y + .8}" r="${r * .62}" fill="#231c33"/>
    <circle cx="${lx + r * .32}" cy="${y - r * .22}" r="${r * .26}" fill="#fff"/><circle cx="${rx + r * .32}" cy="${y - r * .22}" r="${r * .26}" fill="#fff"/>
    <circle cx="${lx - r * .22}" cy="${y + r * .34}" r="${r * .11}" fill="#fff"/><circle cx="${rx - r * .22}" cy="${y + r * .34}" r="${r * .11}" fill="#fff"/></g></g>
  <g class="pe-happy-eyes" fill="none" stroke="#231c33" stroke-width="3" stroke-linecap="round">
    <path d="M${lx - r * .8} ${y + 1} Q${lx} ${y - r} ${lx + r * .8} ${y + 1}"/><path d="M${rx - r * .8} ${y + 1} Q${rx} ${y - r} ${rx + r * .8} ${y + 1}"/></g>
  <g class="pe-closed-eyes" fill="none" stroke="#231c33" stroke-width="3" stroke-linecap="round">
    <path d="M${lx - r * .8} ${y} Q${lx} ${y + r * .8} ${lx + r * .8} ${y}"/><path d="M${rx - r * .8} ${y} Q${rx} ${y + r * .8} ${rx + r * .8} ${y}"/></g>`
// Cheeks, a glossy highlight and a small smile: the details that make a face cute.
const CHEEKS = (lx, rx, y) => `<ellipse cx="${lx}" cy="${y}" rx="5.5" ry="3.2" fill="#ff7fae" opacity=".5"/><ellipse cx="${rx}" cy="${y}" rx="5.5" ry="3.2" fill="#ff7fae" opacity=".5"/>`
const SHINE = (x, y, rx, ry) => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="#fff" opacity=".32" transform="rotate(-25 ${x} ${y})"/>`
const SMILE = (x, y) => `<path d="M${x - 4} ${y} Q${x - 2} ${y + 3} ${x} ${y} Q${x + 2} ${y + 3} ${x + 4} ${y}" fill="none" stroke="#231c33" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`
const extras = () => `
  <g class="pe-dots" fill="var(--text-tertiary, #9a96a8)"><circle cx="78" cy="14" r="3"/><circle cx="87" cy="10" r="3"/><circle cx="96" cy="6" r="3"/></g>
  <g class="pe-waves" fill="none" stroke="var(--text-tertiary, #9a96a8)" stroke-width="3.5" stroke-linecap="round"><path d="M86 40 q7 10 0 20"/><path d="M93 34 q11 16 0 32"/></g>
  ${BADGE ? `<g class="pe-alert"><circle cx="82" cy="18" r="10" fill="#ff453a"/><text x="82" y="22.5" text-anchor="middle" font-family="Figtree, system-ui" font-weight="700" font-size="13" fill="#fff">${BADGE}</text></g>` : ''}
  <g class="pe-zzz" fill="var(--text-tertiary, #9a96a8)" font-family="Figtree, system-ui" font-weight="700"><text x="74" y="22" font-size="13">z</text><text x="83" y="12" font-size="10">z</text></g>`
const COLORS = { blob: ['#ffb3d9', '#8fb4ff'], ghost: ['#f7f4ff', '#cfc6f5'], bunny: ['#fff4f7', '#ffc2d4'], cloud: ['#eef8ff', '#9ccfff'], star: ['#ffe68f', '#ffb020'], cat: ['#ffc27a', '#ff8a5c'], crab: ['#ffa98a', '#ff6f61'], robot: ['#a9c3e6', '#5f86c2'], devil: ['#c7a4ff', '#8656ec'] }
const GRAD = (id, pet) => `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${COLORS[pet][0]}"/><stop offset="1" stop-color="${COLORS[pet][1]}"/></linearGradient></defs>`

const PETS = {
  blob: () => { const g = 'pe-g' + (seq++); return GRAD(g, 'blob') + `<g class="pe-body">
    <path d="M47 19 C61 15 75 23 81 34 C89 46 92 59 85 71 C79 82 66 89 52 88 C44 87.5 40 91 32 88 C21 84 12 76 12 64 C12 55 18 50 20 42 C23 31 33 22 47 19Z" fill="url(#${g})"/>
    ${SHINE(33, 35, 9, 5)}
    ${CHEEKS(29, 71, 66)}
    ${EYES(38, 62, 55, 9)}
    ${SMILE(50, 68)}</g>` + extras() },
  ghost: () => { const g = 'pe-g' + (seq++); return GRAD(g, 'ghost') + `<g class="pe-body pe-float">
    <path d="M22 52 C22 31 34 18 50 18 C66 18 78 31 78 52 L78 82 Q73 76 67 82 Q61 88 56 82 Q50 76 44 82 Q39 88 33 82 Q27 76 22 82 Z" fill="url(#${g})"/>
    ${SHINE(35, 32, 8, 4.5)}
    <path d="M22 58 Q14 60 16 66" fill="none" stroke="${COLORS.ghost[1]}" stroke-width="4" stroke-linecap="round"/><path d="M78 58 Q86 60 84 66" fill="none" stroke="${COLORS.ghost[1]}" stroke-width="4" stroke-linecap="round"/>
    ${CHEEKS(33, 67, 58)}
    ${EYES(40, 60, 47, 8)}
    <ellipse cx="50" cy="62" rx="3" ry="3.6" fill="#231c33"/></g>` + extras() },
  bunny: () => { const g = 'pe-g' + (seq++); return GRAD(g, 'bunny') + `<g class="pe-body">
    <g class="pe-ear pe-ear-l"><ellipse cx="37" cy="26" rx="8" ry="18" fill="${COLORS.bunny[1]}"/><ellipse cx="37" cy="27" rx="4" ry="12" fill="#ff9ab8" opacity=".55"/></g>
    <g class="pe-ear pe-ear-r"><ellipse cx="63" cy="26" rx="8" ry="18" fill="${COLORS.bunny[1]}"/><ellipse cx="63" cy="27" rx="4" ry="12" fill="#ff9ab8" opacity=".55"/></g>
    <ellipse cx="50" cy="64" rx="33" ry="25" fill="url(#${g})"/>
    ${SHINE(34, 50, 8, 4)}
    ${CHEEKS(29, 71, 69)}
    ${EYES(39, 61, 60, 7.5)}
    <path d="M48 67.5 L52 67.5 L50 69.8 Z" fill="#ff7fa3"/>
    ${SMILE(50, 71)}</g>` + extras() },
  cloud: () => { const g = 'pe-g' + (seq++); return GRAD(g, 'cloud') + `<g class="pe-body pe-puff">
    <path d="M27 80 C14 80 9 67 18 60 C14 47 27 38 38 43 C42 29 62 27 68 41 C80 38 91 49 86 61 C94 67 90 81 77 80 Z" fill="url(#${g})"/>
    ${SHINE(37, 48, 8, 4)}
    ${CHEEKS(33, 69, 69)}
    ${EYES(41, 61, 60, 7.5)}
    ${SMILE(51, 71)}</g>` + extras() },
  star: () => { const g = 'pe-g' + (seq++); return GRAD(g, 'star') + `<g class="pe-body pe-twinkle">
    <path d="M50.0 22.0 L62.3 38.0 L81.4 44.8 L70.0 61.5 L69.4 81.7 L50.0 76.0 L30.6 81.7 L30.0 61.5 L18.6 44.8 L37.7 38.0 Z" fill="url(#${g})" stroke="url(#${g})" stroke-width="16" stroke-linejoin="round"/>
    ${SHINE(39, 38, 6.5, 3.4)}
    ${CHEEKS(35, 65, 63)}
    ${EYES(42, 58, 54, 7.2)}
    ${SMILE(50, 64)}</g>` + extras() },
  cat: () => { const g = 'pe-g' + (seq++); return GRAD(g, 'cat') + `
    <path class="pe-tail" d="M74 80 C92 78 95 60 86 52" fill="none" stroke="${COLORS.cat[1]}" stroke-width="7" stroke-linecap="round"/>
    <g class="pe-body">
    <path d="M22 38 C22 24 26 16 30 14 C34 18 40 24 44 28 Z M78 38 C78 24 74 16 70 14 C66 18 60 24 56 28 Z" fill="${COLORS.cat[1]}" stroke="${COLORS.cat[1]}" stroke-width="4" stroke-linejoin="round"/>
    <path d="M28 22 L31 30 L37 26 Z M72 22 L69 30 L63 26 Z" fill="#ffd9c7"/>
    <ellipse cx="50" cy="58" rx="33" ry="29" fill="url(#${g})"/>
    ${SHINE(34, 40, 8, 4.5)}
    ${CHEEKS(29, 71, 66)}
    ${EYES(38, 62, 54, 8.5)}
    <path d="M47.5 63 L52.5 63 L50 65.8 Z" fill="#ff6f91"/>
    ${SMILE(50, 67)}
    <g stroke="#fff" stroke-width="1.4" stroke-linecap="round" opacity=".8"><path d="M19 63 L30 65"/><path d="M20 70 L30 68"/><path d="M81 63 L70 65"/><path d="M80 70 L70 68"/></g></g>` + extras() },
  crab: () => { const g = 'pe-g' + (seq++); const [c0, c1] = COLORS.crab; return GRAD(g, 'crab') + `<g class="pe-body">
    <g class="pe-claw pe-claw-l"><circle cx="17" cy="36" r="10" fill="${c1}"/><path d="M11 29 L17 36 L9 38 Z" fill="var(--bg, #1c1c1e)"/></g>
    <g class="pe-claw pe-claw-r"><circle cx="83" cy="36" r="10" fill="${c1}"/><path d="M89 29 L83 36 L91 38 Z" fill="var(--bg, #1c1c1e)"/></g>
    <g stroke="${c1}" stroke-width="5" stroke-linecap="round" fill="none"><path d="M22 45 Q26 52 30 54"/><path d="M78 45 Q74 52 70 54"/>
      <path d="M30 78 L25 86"/><path d="M40 82 L38 89"/><path d="M60 82 L62 89"/><path d="M70 78 L75 86"/></g>
    <g stroke="${c1}" stroke-width="3.5" stroke-linecap="round"><path d="M40 46 L38 36"/><path d="M60 46 L62 36"/></g>
    <ellipse cx="50" cy="64" rx="29" ry="20" fill="url(#${g})"/>
    ${SHINE(38, 54, 8, 3.8)}
    ${CHEEKS(31, 69, 70)}
    ${EYES(38, 62, 32, 7.5)}
    ${SMILE(50, 69)}</g>` + extras() },
  robot: () => { const g = 'pe-g' + (seq++); return GRAD(g, 'robot') + `<g class="pe-body">
    <line x1="50" y1="21" x2="50" y2="12" stroke="${COLORS.robot[1]}" stroke-width="3" stroke-linecap="round"/>
    <circle class="pe-antenna" cx="50" cy="9" r="5" fill="#ffd166"/><circle cx="48.4" cy="7.4" r="1.6" fill="#fff" opacity=".8"/>
    <rect x="12" y="42" width="8" height="18" rx="4" fill="${COLORS.robot[1]}"/><rect x="80" y="42" width="8" height="18" rx="4" fill="${COLORS.robot[1]}"/>
    <rect x="18" y="21" width="64" height="60" rx="22" fill="url(#${g})"/>
    ${SHINE(30, 30, 7, 3.5)}
    <rect x="26" y="32" width="48" height="36" rx="14" fill="#1f2a3d"/>
    <g class="pe-eyes"><g class="pe-pupils"><rect x="34" y="40" width="10" height="12" rx="5" fill="#7cf2d4"/><rect x="56" y="40" width="10" height="12" rx="5" fill="#7cf2d4"/>
      <circle cx="41" cy="43" r="1.8" fill="#fff"/><circle cx="63" cy="43" r="1.8" fill="#fff"/></g></g>
    <g class="pe-happy-eyes" fill="none" stroke="#7cf2d4" stroke-width="3" stroke-linecap="round"><path d="M33 49 Q39 41 45 49"/><path d="M55 49 Q61 41 67 49"/></g>
    <g class="pe-closed-eyes" stroke="#7cf2d4" stroke-width="3" stroke-linecap="round"><path d="M34 47 L44 47"/><path d="M56 47 L66 47"/></g>
    <ellipse cx="31" cy="59" rx="4.5" ry="2.6" fill="#ff7fae" opacity=".6"/><ellipse cx="69" cy="59" rx="4.5" ry="2.6" fill="#ff7fae" opacity=".6"/>
    <path d="M45 59 L55 59" stroke="#7cf2d4" stroke-width="2.5" stroke-linecap="round"/>
    <rect x="36" y="82" width="28" height="7" rx="3.5" fill="${COLORS.robot[1]}"/></g>` + extras() },
  devil: () => { const g = 'pe-g' + (seq++); return GRAD(g, 'devil') + `
    <path class="pe-tail" d="M72 80 C88 82 92 68 86 62" fill="none" stroke="${COLORS.devil[1]}" stroke-width="4" stroke-linecap="round"/>
    <path class="pe-tail" d="M84 64 L93 57 L86 55 Z" fill="${COLORS.devil[1]}"/>
    <g class="pe-body">
    <path d="M30 34 C27 24 30 16 35 14 C35 21 37 26 41 30 Z M70 34 C73 24 70 16 65 14 C65 21 63 26 59 30 Z" fill="${COLORS.devil[1]}" stroke="${COLORS.devil[1]}" stroke-width="2" stroke-linejoin="round"/>
    <path d="M50 24 C71 24 84 40 84 60 C84 78 70 87 50 87 C30 87 16 78 16 60 C16 40 29 24 50 24Z" fill="url(#${g})"/>
    ${SHINE(34, 38, 8, 4.5)}
    <path d="M30 45 L42 48 M70 45 L58 48" stroke="#3f2475" stroke-width="2.6" stroke-linecap="round"/>
    ${CHEEKS(29, 71, 67)}
    ${EYES(38, 62, 56, 8.5)}
    <path d="M42 69 Q50 75 58 69" fill="none" stroke="#231c33" stroke-width="2.3" stroke-linecap="round"/>
    <path d="M46.5 70.8 L48.3 74.2 L50 71.2 Z" fill="#fff"/></g>` + extras() },
}

  /** The companion `pet` in `state`, as an svg string. `count`: the number on the waiting
   *  badge; `still`: no animation (the small avatars beside each answer). */
  function svg(pet, state = 'rest', opts = {}) {
    const p = NAMES.includes(pet) ? pet : NAMES[0]
    const st = STATES.includes(state) ? state : 'rest'
    const n = Number(opts.count)
    BADGE = Number.isFinite(n) && n > 0 ? (n > 9 ? '9+' : String(Math.floor(n))) : ''
    const body = PETS[p]()
    return `<svg class="pet-svg pe-${st}${opts.still ? ' pe-still' : ''}" viewBox="0 0 100 100" aria-hidden="true" focusable="false">${body}</svg>`
  }
  return { NAMES, LABELS, STATES, svg }
})
