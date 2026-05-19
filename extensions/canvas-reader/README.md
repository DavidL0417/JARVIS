# JARVIS Canvas Academic Reader

Internal Manifest V3 Chrome extension for reading visible Canvas course pages and importing sanitized academic context into JARVIS.

## Build

```bash
pnpm build:canvas-extension
```

The build creates `public/downloads/jarvis-canvas-reader.zip` and replaces the unpacked extension at `~/Downloads/jarvis-canvas-reader` for manual Chrome reloads.

## Install

1. Run `pnpm build:canvas-extension`.
2. Open `chrome://extensions`, enable Developer Mode, and choose Load Unpacked.
3. Select `~/Downloads/jarvis-canvas-reader`.
4. After future builds, press the extension reload button in Chrome.
5. Pair with a fresh code from the JARVIS setup page.
