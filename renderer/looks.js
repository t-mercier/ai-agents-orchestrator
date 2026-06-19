// Curated "looks" (Settings → Appearance). A look = a brand `accent` + a faint
// surface `tint` (rgb triplet) washed over the window background at `tintA` opacity —
// a subtle warm/cool ambiance, not a recolour of the whole UI. Category chips keep
// their own configured colours. A "Custom" card (added by the UI) drops the tint and
// opens the accent picker.
//
// Palette: soft, poetic, Pantone-leaning tones (powdery pastels, muted jewels). The
// accents are light pastels — perfectly legible on the near-black dark UI, and the
// CTA text auto-flips to dark on them (luminance, --on-accent). Inspired by the
// restrained-colour school (Things 3 · Arc · Bear): an atmosphere, not a rainbow.
window.CSM_LOOKS = [
  { id: 'ardoise',     name: 'Ardoise',     accent: '#7E93B8', tint: '0,0,0',       tintA: 0 },     // slate — neutral default
  { id: 'lavande',     name: 'Lavande',     accent: '#A88FD0', tint: '178,155,212', tintA: 0.05 },  // lavender
  { id: 'rose-poudre', name: 'Rose Poudré', accent: '#D9A2AE', tint: '222,172,182', tintA: 0.05 },  // powder rose
  { id: 'brume',       name: 'Brume',       accent: '#88AEC4', tint: '150,180,200', tintA: 0.045 }, // misty blue-grey
  { id: 'sauge',       name: 'Sauge',       accent: '#9DB389', tint: '165,185,150', tintA: 0.045 }, // sage
  { id: 'peche',       name: 'Pêche',       accent: '#F0A988', tint: '245,200,175', tintA: 0.05 },  // Peach Fuzz (Pantone 2024)
  { id: 'celadon',     name: 'Céladon',     accent: '#8FC9B9', tint: '150,205,185', tintA: 0.045 }, // celadon seafoam
]
