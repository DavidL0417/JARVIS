import {
  appHostPermissionPattern,
  normalizeJarvisAppBaseUrl,
} from "./jarvis-app-url.js"

const appUrlInput = document.querySelector("#app-url")
const pairingCodeInput = document.querySelector("#pairing-code")
const pairButton = document.querySelector("#pair-button")
const pairSection = document.querySelector("#pair-section")
const statusSection = document.querySelector("#status-section")
const statusPill = document.querySelector("#status-pill")
const appUrlDisplay = document.querySelector("#app-url-display")
const commandStatus = document.querySelector("#command-status")
const lastError = document.querySelector("#last-error")
const openControlButton = document.querySelector("#open-control-button")
const pollButton = document.querySelector("#poll-button")
const message = document.querySelector("#message")
const version = document.querySelector("#version")

version.textContent = `v${chrome.runtime.getManifest().version}`

const DRAFT_KEYS = {
  appBaseUrl: "jarvisDraftAppBaseUrl",
  pairingCode: "jarvisDraftPairingCode",
}

function setMessage(text) {
  message.textContent = text
}

function sendMessage(payload) {
  return chrome.runtime.sendMessage(payload)
}

async function requestAppPermission(appBaseUrl) {
  const pattern = appHostPermissionPattern(appBaseUrl)
  const hasPermission = await chrome.permissions.contains({ origins: [pattern] })
  if (hasPermission) return

  const granted = await chrome.permissions.request({ origins: [pattern] })
  if (!granted) throw new Error("JARVIS app permission was not granted.")
}

async function saveDrafts() {
  await chrome.storage.local.set({
    [DRAFT_KEYS.appBaseUrl]: appUrlInput.value.trim(),
    [DRAFT_KEYS.pairingCode]: pairingCodeInput.value.trim(),
  })
}

async function loadStatus() {
  const state = await sendMessage({ type: "GET_STATUS" })
  const drafts = await chrome.storage.local.get([DRAFT_KEYS.appBaseUrl, DRAFT_KEYS.pairingCode])

  appUrlInput.value = state?.appBaseUrl || drafts[DRAFT_KEYS.appBaseUrl] || appUrlInput.value
  pairingCodeInput.value = drafts[DRAFT_KEYS.pairingCode] || pairingCodeInput.value
  statusPill.textContent = state?.paired ? state?.busy ? "working" : "paired" : "not paired"
  pairSection.hidden = Boolean(state?.paired)
  statusSection.hidden = !state?.paired
  appUrlDisplay.textContent = state?.appBaseUrl ? `Connected to ${state.appBaseUrl}` : ""
  commandStatus.textContent = state?.lastCommand
    ? `Last command: ${state.lastCommand.type} · ${state.lastCommand.status}`
    : "Waiting for commands from JARVIS."
  lastError.hidden = !state?.lastError
  lastError.textContent = state?.lastError ? `Last error: ${state.lastError.message}` : ""
}

appUrlInput.addEventListener("input", () => {
  saveDrafts().catch(() => {})
})

pairingCodeInput.addEventListener("input", () => {
  saveDrafts().catch(() => {})
})

pairButton.addEventListener("click", async () => {
  pairButton.disabled = true
  setMessage("Pairing...")

  try {
    const appBaseUrl = normalizeJarvisAppBaseUrl(appUrlInput.value.trim())
    const code = pairingCodeInput.value.trim()
    if (!code) throw new Error("Enter the pairing code from JARVIS.")

    appUrlInput.value = appBaseUrl
    await saveDrafts()
    await requestAppPermission(appBaseUrl)
    const result = await sendMessage({ type: "PAIR_EXTENSION", appBaseUrl, code })
    if (!result?.success) throw new Error(result?.error || "Pairing failed.")
    pairingCodeInput.value = ""
    await chrome.storage.local.set({ [DRAFT_KEYS.appBaseUrl]: appBaseUrl, [DRAFT_KEYS.pairingCode]: "" })
    setMessage("Paired. Use the JARVIS page to control scans.")
    await loadStatus()
  } catch (error) {
    setMessage(error instanceof Error ? error.message : "Pairing failed.")
  } finally {
    pairButton.disabled = false
  }
})

openControlButton.addEventListener("click", async () => {
  await sendMessage({ type: "OPEN_CONTROL_PAGE" })
})

pollButton.addEventListener("click", async () => {
  pollButton.disabled = true
  setMessage("Checking for commands...")
  try {
    await sendMessage({ type: "POLL_NOW" })
    await loadStatus()
    setMessage("")
  } catch (error) {
    setMessage(error instanceof Error ? error.message : "Command check failed.")
  } finally {
    pollButton.disabled = false
  }
})

loadStatus().catch((error) => {
  statusPill.textContent = "error"
  setMessage(error instanceof Error ? error.message : "Failed to load status.")
})
