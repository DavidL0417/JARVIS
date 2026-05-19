const REQUEST_TYPE = "JARVIS_CANVAS_EXTENSION_REQUEST"
const RESPONSE_TYPE = "JARVIS_CANVAS_EXTENSION_RESPONSE"
const READY_TYPE = "JARVIS_CANVAS_EXTENSION_READY"
const ALLOWED_ACTIONS = new Set(["GET_STATUS", "POLL_NOW"])

window.postMessage({ type: READY_TYPE }, window.location.origin)

window.addEventListener("message", (event) => {
  if (event.source !== window || event.origin !== window.location.origin) return
  const message = event.data
  if (!message || message.type !== REQUEST_TYPE || typeof message.id !== "string") return
  if (!ALLOWED_ACTIONS.has(message.action)) return

  chrome.runtime.sendMessage({ type: message.action })
    .then((result) => {
      window.postMessage({
        type: RESPONSE_TYPE,
        id: message.id,
        ok: true,
        result,
      }, window.location.origin)
    })
    .catch((error) => {
      window.postMessage({
        type: RESPONSE_TYPE,
        id: message.id,
        ok: false,
        error: error instanceof Error ? error.message : "Canvas extension request failed.",
      }, window.location.origin)
    })
})
