/*
 * Builds the JARVIS icon set from a single source mark.
 * Mark: uppercase geometric "J" (cream) on a warm-charcoal rounded tile,
 * with a copper dot as a terminating period. Brand-fixed (does not invert).
 *
 * Run: node scripts/logo/build-icons.cjs            (writes final assets to public/)
 *      node scripts/logo/build-icons.cjs --preview  (writes only /tmp previews)
 */
const fs = require('fs')
const path = require('path')
const { chromium } = require('@playwright/test')

// ---- Brand palette (hex approximations of the app's oklch tokens) ----
const BG = '#1c1916' // --background, warm near-black
const FG = '#f4f1ec' // --foreground, warm off-white
const COPPER = '#cf7e52' // --copper

// ---- The mark, parametric on tile size S (square) ----
// Geometry authored in a 180-unit grid, scaled by S/180.
function markSvg(S, { rounded = true } = {}) {
  const u = S / 180
  const k = (n) => +(n * u).toFixed(2)
  const sw = k(16) // stroke weight of the J
  const rx = rounded ? k(40) : 0
  // Capital J: top bar + stem (right) + bottom hook curving left, optically centered.
  const J = `
    <g transform="translate(${k(-6)},${k(-7)})">
    <path d="M ${k(83)} ${k(52)} H ${k(126)}"
      fill="none" stroke="${FG}" stroke-width="${sw}" stroke-linecap="round"/>
    <path d="M ${k(112)} ${k(52)} V ${k(113)}
             Q ${k(112)} ${k(142)} ${k(83)} ${k(142)}
             Q ${k(59)} ${k(142)} ${k(59)} ${k(122)}"
      fill="none" stroke="${FG}" stroke-width="${sw}"
      stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${k(131)}" cy="${k(133)}" r="${k(10)}" fill="${COPPER}"/>
    </g>`
  return `<svg width="${S}" height="${S}" viewBox="0 0 ${S} ${S}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${S}" height="${S}" rx="${rx}" fill="${BG}"/>
    ${J}
  </svg>`
}

// Scalable master for /public/icon.svg (180 grid, fixed brand colors).
const ICON_SVG = `<svg width="180" height="180" viewBox="0 0 180 180" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="180" height="180" rx="40" fill="${BG}"/>
  <g transform="translate(-6,-7)">
    <path d="M 83 52 H 126" fill="none" stroke="${FG}" stroke-width="16" stroke-linecap="round"/>
    <path d="M 112 52 V 113 Q 112 142 83 142 Q 59 142 59 122" fill="none" stroke="${FG}" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="131" cy="133" r="10" fill="${COPPER}"/>
  </g>
</svg>`

// Open Graph / link-preview card (1200x630), full-bleed dark.
function ogHtml() {
  const mark = markSvg(168)
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{width:1200px;height:630px;background:${BG};
      font-family:'Onest',ui-sans-serif,system-ui,-apple-system,sans-serif;
      display:flex;flex-direction:column;align-items:center;justify-content:center;gap:40px}
    .word{font-size:120px;font-weight:600;letter-spacing:-5px;color:${FG};display:flex;align-items:flex-end;gap:14px}
    .dot{width:22px;height:22px;border-radius:50%;background:${COPPER};margin-bottom:22px}
    .tag{font-size:30px;font-weight:500;letter-spacing:1px;color:#9b938a}
  </style></head><body>
    <div>${mark}</div>
    <div class="word">jarvis<span class="dot"></span></div>
    <div class="tag">the next thing to do, handed to you</div>
  </body></html>`
}

async function pngFromSvg(page, svg, w, h) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>*{margin:0;padding:0}html,body{background:transparent}</style></head><body>${svg}</body></html>`
  await page.setViewportSize({ width: w, height: h })
  await page.setContent(html, { waitUntil: 'networkidle' })
  return page.screenshot({ omitBackground: true })
}

async function pngFromHtml(page, html, w, h) {
  await page.setViewportSize({ width: w, height: h })
  await page.setContent(html, { waitUntil: 'networkidle' })
  return page.screenshot()
}

// Pack PNG buffers into a PNG-embedded .ico (multi-resolution). Browsers and
// Google/Vercel fetchers that request /favicon.ico directly read this.
function buildIco(pngs) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: 1 = icon
  header.writeUInt16LE(pngs.length, 4)
  let offset = 6 + pngs.length * 16
  const entries = []
  for (const { size, buf } of pngs) {
    const e = Buffer.alloc(16)
    e.writeUInt8(size >= 256 ? 0 : size, 0) // width (0 = 256)
    e.writeUInt8(size >= 256 ? 0 : size, 1) // height
    e.writeUInt8(0, 2) // palette count
    e.writeUInt8(0, 3) // reserved
    e.writeUInt16LE(1, 4) // color planes
    e.writeUInt16LE(32, 6) // bits per pixel
    e.writeUInt32LE(buf.length, 8)
    e.writeUInt32LE(offset, 12)
    entries.push(e)
    offset += buf.length
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.buf)])
}

;(async () => {
  const preview = process.argv.includes('--preview')
  const outDir = preview ? '/tmp' : path.join(__dirname, '..', '..', 'public')
  const HEADLESS_SHELL = '/Users/david/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell'
  const browser = await chromium.launch(
    fs.existsSync(HEADLESS_SHELL) ? { executablePath: HEADLESS_SHELL } : {}
  )
  const page = await browser.newPage({ deviceScaleFactor: 1 })

  const write = (name, buf) => {
    const p = path.join(outDir, name)
    fs.writeFileSync(p, buf)
    console.log('wrote', p, buf.length, 'bytes')
  }

  const writeFavicon = async () => {
    const sizes = [16, 32, 48]
    const pngs = []
    for (const s of sizes) pngs.push({ size: s, buf: await pngFromSvg(page, markSvg(s), s, s) })
    const p = path.join(__dirname, '..', '..', 'public', 'favicon.ico')
    fs.writeFileSync(p, buildIco(pngs))
    console.log('wrote', p, '(16/32/48)')
  }

  if (process.argv.includes('--ico-only')) {
    await writeFavicon()
  } else if (preview) {
    write('jarvis-preview-180.png', await pngFromSvg(page, markSvg(180), 180, 180))
    write('jarvis-preview-32.png', await pngFromSvg(page, markSvg(32), 32, 32))
    write('jarvis-preview-og.png', await pngFromHtml(page, ogHtml(), 1200, 630))
  } else {
    await writeFavicon()
    fs.writeFileSync(path.join(outDir, 'icon.svg'), ICON_SVG)
    console.log('wrote', path.join(outDir, 'icon.svg'))
    write('apple-icon.png', await pngFromSvg(page, markSvg(180), 180, 180))
    write('icon-light-32x32.png', await pngFromSvg(page, markSvg(32), 32, 32))
    write('icon-dark-32x32.png', await pngFromSvg(page, markSvg(32), 32, 32))
    // OG lives in app/ so Next.js App Router auto-wires the meta tags.
    const ogPath = path.join(__dirname, '..', '..', 'app', 'opengraph-image.png')
    fs.writeFileSync(ogPath, await pngFromHtml(page, ogHtml(), 1200, 630))
    console.log('wrote', ogPath)
    // Google OAuth consent-screen logo: 120x120, NOT a web asset — kept here for
    // manual upload in Google Cloud Console (APIs & Services > OAuth consent screen).
    const gPath = path.join(__dirname, 'google-consent-logo-120.png')
    fs.writeFileSync(gPath, await pngFromSvg(page, markSvg(120), 120, 120))
    console.log('wrote', gPath)
  }

  await browser.close()
})().catch((e) => { console.error(e); process.exit(1) })
