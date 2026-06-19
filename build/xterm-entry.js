export { Terminal } from 'xterm'
export { FitAddon } from '@xterm/addon-fit'
export { WebLinksAddon } from '@xterm/addon-web-links'
// WebGL renderer: crisp, native-like glyphs (closest to iTerm) and handles HiDPI
// correctly. Canvas is kept as a fallback when WebGL is unavailable (the DOM
// renderer mispositions fractional cell widths on HiDPI in WKWebView).
export { WebglAddon } from 'xterm-addon-webgl'
export { CanvasAddon } from 'xterm-addon-canvas'
