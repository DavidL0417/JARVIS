"use client"

import { useEffect, useRef } from "react"

/**
 * Signal Streams — the landing-page background.
 *
 * A single WebGL2 canvas, fixed behind the whole page, renders a GPU particle
 * flow-field with additive copper light-trails: rivers of light that flow across
 * the page and converge, bending and accelerating as you scroll. The whole effect
 * is one GPU draw pass per frame (fade previous → draw segments → present), so
 * there is NO CSS gradient/blend/blur stack to repaint — which is what made the
 * previous version cost ~25% CPU on scroll. One passive scroll listener feeds a
 * smoothed progress value into the sim and writes --sp for the progress bar.
 *
 * Falls back to the CSS gradient painted on `.scroll-ambient-canvas` when WebGL2
 * is unavailable or the user prefers reduced motion.
 */

const MAX_PARTICLES = 14000
const PARTICLE_DENSITY = 0.008 // particles per CSS px² (keeps visual density ~constant)
// Off-screen staging margin (fraction of viewport): respawned particles are born this far
// past the upstream (left/top) edges so their fade-in happens off-screen — they cross INTO
// view already lit, giving the left/top real volume instead of a dim fresh-spawn dead zone.
const UPSTREAM_MARGIN = 0.1
const TRAIL_FADE = 0.93 // persistence → streaks smear into continuous rivers of light
const BASE_ALPHA = 0.5 // bright per-streak; accumulation + bloom build glowing rivers
const MAX_DPR = 1.25 // cap backing resolution; softer (glowier) + far cheaper than retina

// Copper light added over the base; overlaps + bloom go toward hot copper.
const STREAM: [number, number, number] = [1.0, 0.58, 0.32]
// The field's base, matched by the landing --background so load/fallback don't flash a
// different tone. Uniform everywhere → no darker "frame"; the streaks add light on top.
const GRAPHITE: [number, number, number] = [0.03, 0.024, 0.019]

// --- Intro: on load most of the signal field gathers into a copper UNDERLINE that draws itself
// (left→right) beneath the "in your head" keyword, holds a beat, then dissolves back into the
// ambient flow. Driven by the INTRO_* phases + introT below. The underline span is read from the
// DOM ([data-intro-underline]) so it tracks the real keyword; falls back to a centred segment.
const FOCAL_X = 0.5 // fallback segment centre, as a fraction of the viewport
const FOCAL_Y = 0.5
const BOND_FRACTION = 0.5 // fraction of particles that gather into the underline (the rest keep flowing,
// so the field never empties out and there's little to re-populate when the line evaporates)
// Brightness of the gathered streaks forming the underline (per-particle, additive). Spread along a
// LINE rather than a point, so the light never concentrates enough to clip / blow out.
const BOND_BRIGHT = 0.5
// Soft width (in draw-progress units) of the underline's left→right "drawing" leading edge.
const DRAW_SOFT = 0.2

const smoothstep01 = (x: number) => {
  const c = Math.max(0, Math.min(1, x))
  return c * c * (3 - 2 * c)
}
// smoothstep(e0,e1,x): 0 below e0, 1 above e1, smooth between. Used for the per-particle
// spatial edge envelope (taper-in on the upstream edges, taper-out/despawn on the downstream).
const sstep = (e0: number, e1: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}
// Intro phase boundaries (seconds): delay → draw → hold → evaporate → done. The field flows plainly
// for ~0.5s, then the lines gather into the underline (drawing left→right), hold it lit, then it
// fades to nothing IN PLACE (each particle recycles into the flow once invisible — it never falls).
const INTRO_GATHER = 0.5 // ~0.5s of plain ambient field before the underline starts drawing
const INTRO_HOLD = 1.6 // underline fully drawn by here
const INTRO_RELEASE = 2.1 // begins evaporating in place
const INTRO_END = 3.0
const QUAD_VS = `#version 300 es
layout(location=0) in vec2 a_quad;
out vec2 v_uv;
void main(){ v_uv = a_quad * 0.5 + 0.5; gl_Position = vec4(a_quad, 0.0, 1.0); }`

const FADE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_fade;
out vec4 o;
void main(){ o = texture(u_tex, v_uv) * u_fade; }`

const PRESENT_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec3 u_bg;
uniform vec2 u_res;
uniform float u_seed;
out vec4 o;
const vec2 OFF[8] = vec2[8](
  vec2(1.0, 0.0), vec2(-1.0, 0.0), vec2(0.0, 1.0), vec2(0.0, -1.0),
  vec2(0.7, 0.7), vec2(-0.7, 0.7), vec2(0.7, -0.7), vec2(-0.7, -0.7));
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main(){
  vec3 core = texture(u_tex, v_uv).rgb;
  vec2 r1 = 5.0 / u_res;
  vec2 r2 = 13.0 / u_res;
  vec3 g1 = vec3(0.0);
  vec3 g2 = vec3(0.0);
  for (int i = 0; i < 8; i++) {
    g1 += texture(u_tex, v_uv + OFF[i] * r1).rgb;
    g2 += texture(u_tex, v_uv + OFF[i] * r2).rgb;
  }
  vec3 light = core + g1 * (0.34 / 8.0) + g2 * (0.22 / 8.0); // two-ring bloom (trimmed → less haze)
  // NO edge feather/vignette. The base (u_bg) is uniform across the whole canvas and the
  // streaks run at full density right to all four edges (they just flow off-screen), so
  // there is no darker rim/"frame" — the field reads edge-to-edge, the same tone all over.
  vec3 col = u_bg + light;
  col += (hash(v_uv * u_res + u_seed) - 0.5) * (1.0 / 255.0); // dither
  o = vec4(col, 1.0);
}`

const SEG_VS = `#version 300 es
layout(location=0) in vec2 a_pos;
layout(location=1) in float a_alpha;
uniform vec2 u_res;
out float v_a;
void main(){
  vec2 c = a_pos / u_res * 2.0 - 1.0;
  c.y = -c.y;
  gl_Position = vec4(c, 0.0, 1.0);
  v_a = a_alpha;
}`

const SEG_FS = `#version 300 es
precision highp float;
in float v_a;
uniform vec3 u_color;
out vec4 o;
void main(){ o = vec4(u_color * v_a, v_a); }`

export function ScrollAmbient() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const root = document.documentElement
    const disposers: Array<() => void> = []

    // --- scroll progress (runs even in fallback) -> --sp + sim input ---
    let scrollMax = 1
    let spTarget = 0
    const measureScroll = () => {
      scrollMax = Math.max(1, root.scrollHeight - window.innerHeight)
    }
    const onScroll = () => {
      spTarget = Math.min(1, Math.max(0, window.scrollY / scrollMax))
      root.style.setProperty("--sp", spTarget.toFixed(4))
    }
    measureScroll()
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    disposers.push(() => window.removeEventListener("scroll", onScroll))

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const gl = reduced
      ? null
      : canvas.getContext("webgl2", {
          alpha: true,
          antialias: false,
          premultipliedAlpha: false,
          powerPreference: "high-performance",
        })

    if (!gl) {
      // Reduced motion or no WebGL2: keep --sp synced; CSS gradient is the bg.
      const onResize = () => {
        measureScroll()
        onScroll()
      }
      window.addEventListener("resize", onResize)
      disposers.push(() => window.removeEventListener("resize", onResize))
      return () => disposers.forEach((d) => d())
    }

    // ---- GL program helpers ----
    const compile = (type: number, srcText: string) => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, srcText)
      gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.error("ambient shader:", gl.getShaderInfoLog(s))
      }
      return s
    }
    const link = (vs: string, fs: string) => {
      const p = gl.createProgram()!
      gl.attachShader(p, compile(gl.VERTEX_SHADER, vs))
      gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs))
      gl.linkProgram(p)
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        console.error("ambient program:", gl.getProgramInfoLog(p))
      }
      return p
    }

    const fadeProg = link(QUAD_VS, FADE_FS)
    const presentProg = link(QUAD_VS, PRESENT_FS)
    const segProg = link(SEG_VS, SEG_FS)

    const u = (p: WebGLProgram, n: string) => gl.getUniformLocation(p, n)
    const fadeTex = u(fadeProg, "u_tex")
    const fadeAmt = u(fadeProg, "u_fade")
    const presentTex = u(presentProg, "u_tex")
    const presentBg = u(presentProg, "u_bg")
    const presentRes = u(presentProg, "u_res")
    const presentSeed = u(presentProg, "u_seed")
    const segRes = u(segProg, "u_res")
    const segColor = u(segProg, "u_color")

    // ---- geometry ----
    const quadVAO = gl.createVertexArray()!
    gl.bindVertexArray(quadVAO)
    const quadBuf = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)

    const segData = new Float32Array(MAX_PARTICLES * 2 * 3) // 2 verts * (x, y, a)
    const segVAO = gl.createVertexArray()!
    gl.bindVertexArray(segVAO)
    const segBuf = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, segBuf)
    gl.bufferData(gl.ARRAY_BUFFER, segData.byteLength, gl.DYNAMIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 12, 0)
    gl.enableVertexAttribArray(1)
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 12, 8)
    gl.bindVertexArray(null)

    // ---- ping-pong trail buffers ----
    let bw = 2
    let bh = 2
    type Target = { tex: WebGLTexture; fb: WebGLFramebuffer }
    const makeTarget = (w: number, h: number): Target => {
      const tex = gl.createTexture()!
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      const fb = gl.createFramebuffer()!
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      return { tex, fb }
    }
    let srcTarget = makeTarget(bw, bh)
    let dstTarget = makeTarget(bw, bh)

    // ---- particles ----
    const px = new Float32Array(MAX_PARTICLES)
    const py = new Float32Array(MAX_PARTICLES)
    const ppx = new Float32Array(MAX_PARTICLES)
    const ppy = new Float32Array(MAX_PARTICLES)
    const life = new Float32Array(MAX_PARTICLES)
    const maxLife = new Float32Array(MAX_PARTICLES)
    const weight = new Float32Array(MAX_PARTICLES)
    // Per-particle underline targets: position along the segment (0→1, left→right) + a small
    // vertical jitter so the bar has a little thickness. Rebuilt on resize.
    const uline = new Float32Array(MAX_PARTICLES)
    const vjit = new Float32Array(MAX_PARTICLES)
    const freed = new Uint8Array(MAX_PARTICLES) // set once a line particle has evaporated → pure ambient
    let count = MAX_PARTICLES // active particles, set by area in resize()
    let curX = -1 // smoothed light source the streaks radiate from (backing px)
    let curY = -1
    let tgtX = 0
    let tgtY = 0
    let lastNX = 0.5 // last pointer position, normalized to the viewport
    let lastNY = 0.5
    let hasPointer = false

    // Underline segment (backing px): spans the width of the "in your head" keyword, just below it.
    // Read from the DOM so it tracks the real keyword; falls back to a centred segment if absent.
    let ulX0 = bw * (FOCAL_X - 0.12)
    let ulX1 = bw * (FOCAL_X + 0.12)
    let ulY = bh * FOCAL_Y
    const markEl = document.querySelector<HTMLElement>("[data-intro-underline]")
    const computeUnderline = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR)
      const r = markEl?.getBoundingClientRect()
      if (r && r.width > 0) {
        ulX0 = r.left * dpr
        ulX1 = r.right * dpr
        ulY = (r.bottom + 6) * dpr // a few px below the keyword box
      } else {
        ulX0 = bw * (FOCAL_X - 0.12)
        ulX1 = bw * (FOCAL_X + 0.12)
        ulY = bh * FOCAL_Y
      }
    }

    const spawn = (i: number, stagger: boolean) => {
      maxLife[i] = 5 + Math.random() * 8
      if (stagger) {
        // Initial seeding / reseed: uniform on-screen at random life phases, so the field
        // starts full and evenly lit with no directional bias.
        px[i] = Math.random() * bw
        py[i] = Math.random() * bh
        life[i] = Math.random() * maxLife[i]
      } else {
        // Steady-state recycle: the flow runs right+down, so re-enter from the UPSTREAM
        // edges (left ~60% / top ~40%, matching the flow's right:down ratio), born just
        // OFF-screen. The fade-in then happens off-screen and the particle crosses into
        // view already lit → the left/top carry real volume instead of dim fresh spawns.
        // Born most of the way through fade-in so it's bright by the time it's on-screen.
        if (Math.random() < 0.6) {
          px[i] = -Math.random() * bw * UPSTREAM_MARGIN
          py[i] = Math.random() * bh
        } else {
          px[i] = Math.random() * bw
          py[i] = -Math.random() * bh * UPSTREAM_MARGIN
        }
        life[i] = (0.82 + 0.12 * Math.random()) * maxLife[i]
      }
      ppx[i] = px[i]
      ppy[i] = py[i]
      weight[i] = 0.55 + Math.random() * 0.9
    }

    // Per-particle underline targets: spread uniformly along the segment (0→1) with a small vertical
    // jitter so the bar has a little thickness. Rebuilt on resize.
    const buildTargets = () => {
      const md = Math.min(bw, bh)
      for (let i = 0; i < count; i++) {
        uline[i] = Math.random()
        vjit[i] = (Math.random() - 0.5) * md * 0.006
      }
    }

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR)
      bw = Math.max(2, Math.round(window.innerWidth * dpr))
      bh = Math.max(2, Math.round(window.innerHeight * dpr))
      canvas.width = bw
      canvas.height = bh
      gl.deleteTexture(srcTarget.tex)
      gl.deleteFramebuffer(srcTarget.fb)
      gl.deleteTexture(dstTarget.tex)
      gl.deleteFramebuffer(dstTarget.fb)
      srcTarget = makeTarget(bw, bh)
      dstTarget = makeTarget(bw, bh)
      count = Math.max(
        1500,
        Math.min(MAX_PARTICLES, Math.round(window.innerWidth * window.innerHeight * PARTICLE_DENSITY)),
      )
      if (hasPointer) {
        tgtX = lastNX * bw
        tgtY = lastNY * bh
      } else {
        tgtX = bw * 0.5
        tgtY = bh * 0.5
      }
      // Re-anchor the source on (re)size so a transient mount viewport can't strand it.
      curX = tgtX
      curY = tgtY
      for (let i = 0; i < count; i++) spawn(i, true)
      freed.fill(0)
      buildTargets()
      computeUnderline()
      measureScroll()
      onScroll()
    }
    resize()

    const onResize = () => resize()
    window.addEventListener("resize", onResize)
    disposers.push(() => window.removeEventListener("resize", onResize))

    const onPointerMove = (e: PointerEvent) => {
      hasPointer = true
      lastNX = e.clientX / Math.max(1, window.innerWidth)
      lastNY = e.clientY / Math.max(1, window.innerHeight)
      tgtX = lastNX * bw
      tgtY = lastNY * bh
    }
    window.addEventListener("pointermove", onPointerMove, { passive: true })
    disposers.push(() => window.removeEventListener("pointermove", onPointerMove))

    // ---- simulation ----
    let sp = 0
    let t = 0
    let introT = 0 // seconds since the live loop started (drives the convergence intro)
    let last = 0
    let raf = 0

    const step = (dt: number) => {
      const speed = (2.0 + sp * 2.2) * (dt * 60)
      // Lift the streaks a touch at the very top of the page (the hero); eases back to
      // normal as you scroll down, so the first impression reads a little brighter.
      const topBoost = 1 + (1 - sp) * 0.25
      const md = Math.max(bw, bh)
      // Centered nearer horizontal so the field reads side-to-side, not just top-to-bottom.
      // Sweeps fast enough that the overall lean visibly drifts (not a frozen dead side).
      const baseAng = 0.5 + 0.4 * Math.sin(t * 0.16)
      // Intro phases. drawProg sweeps 0→1 across the draw window — it's the left→right "draw"
      // position of the underline. On release each bonded particle evaporates in place (see below).
      const drawProg =
        introT < INTRO_GATHER
          ? 0
          : introT < INTRO_HOLD
            ? smoothstep01((introT - INTRO_GATHER) / (INTRO_HOLD - INTRO_GATHER))
            : 1
      const intro = introT < INTRO_END
      const releasing = introT >= INTRO_RELEASE && introT < INTRO_END
      const relProg = (introT - INTRO_RELEASE) / (INTRO_END - INTRO_RELEASE)
      const pull = 0.18 * (dt * 60)
      const jit = md * 0.003
      for (let i = 0; i < count; i++) {
        // Bond into the underline: 1 = settled on the line, 0 = free in the flow. Only a fraction
        // participates (the rest keep flowing). The bond switches on left→right as the draw sweeps
        // past this particle's spot. On release the particle fades to nothing IN PLACE (evapFade),
        // then recycles into the flow once invisible — so the line evaporates where it is, never falls.
        let mark = 0
        let evapFade = 1
        if (intro && !freed[i] && (i * 0.7548776662 + 0.123) % 1 < BOND_FRACTION) {
          const g = smoothstep01((drawProg * (1 + DRAW_SOFT) - uline[i]) / DRAW_SOFT)
          if (releasing) {
            const ev = 0.55 + 0.4 * ((i * 0.61803398875) % 1) // per-particle evaporate point (relProg)
            if (relProg >= ev) {
              freed[i] = 1
              // Recycle scattered across the screen and INVISIBLE (life at max → env starts at 0), so the
              // field re-populates as a gradual, dispersed fade-up — never a batch of lines arriving from
              // the upstream edge at once.
              px[i] = Math.random() * bw
              py[i] = Math.random() * bh
              ppx[i] = px[i]
              ppy[i] = py[i]
              maxLife[i] = 5 + Math.random() * 8
              life[i] = maxLife[i]
              weight[i] = 0.55 + Math.random() * 0.9
            } else {
              mark = g
              evapFade = 1 - smoothstep01((relProg - (ev - 0.4)) / 0.4) // fade in place before recycling
            }
          } else {
            mark = g
          }
        }
        life[i] -= dt * (1 - mark) // freeze ageing while bonded to the mark
        if (life[i] <= 0) spawn(i, false)
        const x = px[i]
        const y = py[i]
        // A few layered currents weave into bright THREADS (where the flow converges), separated
        // by darker LANES (where it diverges) — the whole pattern drifts so a lane is never a
        // fixed dead spot. Net drift stays right+down (streams enter from the upstream edges).
        const flowAng =
          baseAng +
          0.55 * Math.sin(x * 0.0016 + t * 0.23) +
          0.42 * Math.sin(y * 0.0019 - t * 0.19) +
          0.3 * Math.sin((x - y) * 0.0013 + t * 0.3)
        let nx = x + Math.cos(flowAng) * speed
        let ny = y + Math.sin(flowAng) * speed
        if (mark > 0.001) {
          // Steer onto this particle's spot along the underline segment, with a tiny shimmer so the
          // line stays alive. As mark fades on release, it eases back into the flow.
          const ttx = ulX0 + (ulX1 - ulX0) * uline[i] + Math.sin(t * 3.1 + i * 0.7) * jit
          const tty = ulY + vjit[i] + Math.cos(t * 2.6 + i * 0.9) * jit
          nx = nx * (1 - mark) + (x + (ttx - x) * pull) * mark
          ny = ny * (1 - mark) + (y + (tty - y) * pull) * mark
        }
        // Recycle once a particle leaves the edges.
        if (
          nx > bw + 20 ||
          ny > bh + 20 ||
          nx < -bw * (UPSTREAM_MARGIN + 0.04) ||
          ny < -bh * (UPSTREAM_MARGIN + 0.04)
        ) {
          spawn(i, false)
        } else {
          ppx[i] = x
          ppy[i] = y
          px[i] = nx
          py[i] = ny
        }
        // A soft round spotlight centered on the pointer: brightest directly under the
        // cursor and fading out smoothly in every direction, so it reads as a lit spot.
        const dxc = x - curX
        const dyc = y - curY
        const r = md * 0.16 // spotlight radius — broad + soft so the field stays even
        // High floor, gentle lift: near-uniform brightness everywhere (balanced field),
        // with only a subtle warm rise under the cursor — no tight bright blob to clump.
        const fall = 0.88 + 0.2 * Math.exp(-(dxc * dxc + dyc * dyc) / (r * r))
        const lp = life[i] / maxLife[i]
        // While bonded to the mark, override the life-fade so it reads as one bright shape.
        const env = Math.sin(Math.max(0, Math.min(1, lp)) * Math.PI) * (1 - mark) + mark
        // Thread/lane contrast: gather the streaks into brighter THREADS separated by darker LANES.
        // The band runs roughly ALONG the flow and its phase drifts in time, so the lanes sweep and
        // morph with the currents — a lane is a moving gap, never a fixed dead spot.
        const band = 0.5 + 0.5 * Math.sin(y * 0.0024 - x * 0.0014 + t * 0.22)
        const lane = 0.06 + 1.04 * band * band // deep dark lanes ↔ brighter-than-full thread cores
        const thread = lane + (1 - lane) * mark // → 1 while bonded to the line (the underline reads solid)
        const alpha =
          env * BASE_ALPHA * weight[i] * fall * thread * topBoost * (1 - mark * (1 - BOND_BRIGHT)) * evapFade
        const o = i * 6
        segData[o] = ppx[i]
        segData[o + 1] = ppy[i]
        segData[o + 2] = alpha
        segData[o + 3] = px[i]
        segData[o + 4] = py[i]
        segData[o + 5] = alpha
      }
    }

    const renderOnce = () => {
      gl.bindBuffer(gl.ARRAY_BUFFER, segBuf)
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, segData, 0, count * 6)

      // 1 — fade the previous frame into dstTarget
      gl.bindFramebuffer(gl.FRAMEBUFFER, dstTarget.fb)
      gl.viewport(0, 0, bw, bh)
      gl.disable(gl.BLEND)
      gl.useProgram(fadeProg)
      gl.bindVertexArray(quadVAO)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, srcTarget.tex)
      gl.uniform1i(fadeTex, 0)
      gl.uniform1f(fadeAmt, TRAIL_FADE)
      gl.drawArrays(gl.TRIANGLES, 0, 3)

      // 2 — draw the new segments additively on top
      gl.enable(gl.BLEND)
      gl.blendFunc(gl.ONE, gl.ONE)
      gl.useProgram(segProg)
      gl.bindVertexArray(segVAO)
      gl.uniform2f(segRes, bw, bh)
      gl.uniform3f(segColor, STREAM[0], STREAM[1], STREAM[2])
      gl.drawArrays(gl.LINES, 0, count * 2)

      // 3 — present to the screen (graphite + glow + vignette + dither)
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.viewport(0, 0, bw, bh)
      gl.disable(gl.BLEND)
      gl.useProgram(presentProg)
      gl.bindVertexArray(quadVAO)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, dstTarget.tex)
      gl.uniform1i(presentTex, 0)
      gl.uniform3f(presentBg, GRAPHITE[0], GRAPHITE[1], GRAPHITE[2])
      gl.uniform2f(presentRes, bw, bh)
      gl.uniform1f(presentSeed, (t * 60) % 1000)
      gl.drawArrays(gl.TRIANGLES, 0, 3)

      const tmp = srcTarget
      srcTarget = dstTarget
      dstTarget = tmp
    }

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016
      last = now
      t += dt
      introT += dt
      // Track the keyword through the draw + hold: the hero headline reveals/settles on load and can
      // scroll, so re-read the underline span until the dissolve (cheap — one element, ~2s only).
      if (introT < INTRO_RELEASE) computeUnderline()
      sp += (spTarget - sp) * Math.min(1, dt * 4)
      // Source follows the pointer; with no pointer (touch / idle) it gently roams
      // so the field still breathes.
      if (!hasPointer) {
        // Stay near center with a small idle drift — never wander into a corner.
        tgtX = bw * (0.5 + 0.16 * Math.sin(t * 0.07))
        tgtY = bh * (0.5 + 0.13 * Math.cos(t * 0.053))
      }
      curX += (tgtX - curX) * Math.min(1, dt * 5)
      curY += (tgtY - curY) * Math.min(1, dt * 5)
      step(dt)
      renderOnce()
    }

    // Pre-warm the trail so the field is already flowing on the first painted
    // frame instead of fading up from black.
    for (let i = 0; i < 90; i++) {
      t += 1 / 60
      step(1 / 60)
      renderOnce()
    }

    const start = () => {
      if (!raf) {
        last = 0
        raf = requestAnimationFrame(frame)
      }
    }
    const stop = () => {
      if (raf) {
        cancelAnimationFrame(raf)
        raf = 0
      }
    }
    start()

    const onVisibility = () => (document.hidden ? stop() : start())
    document.addEventListener("visibilitychange", onVisibility)
    disposers.push(() => document.removeEventListener("visibilitychange", onVisibility))

    const onLost = (e: Event) => {
      e.preventDefault()
      stop()
    }
    canvas.addEventListener("webglcontextlost", onLost)
    disposers.push(() => canvas.removeEventListener("webglcontextlost", onLost))

    disposers.push(() => {
      stop()
      root.style.removeProperty("--sp")
      gl.getExtension("WEBGL_lose_context")?.loseContext()
    })

    return () => disposers.forEach((d) => d())
  }, [])

  return (
    <>
      <canvas ref={canvasRef} aria-hidden="true" className="scroll-ambient-canvas" />
      <div aria-hidden="true" className="scroll-progress" />
    </>
  )
}
