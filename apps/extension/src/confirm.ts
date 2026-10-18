import type { ConfirmDetails } from "./protocol"

const origin = document.querySelector("#origin")
const strip = document.querySelector("#strip")
const method = document.querySelector("#method")

chrome.runtime
  .sendMessage({ type: "confirm:get" })
  .then((details: ConfirmDetails | undefined) => {
    if (!details) return window.close()
    if (origin) origin.textContent = details.origin
    if (strip) strip.textContent = details.strip
    if (method) method.textContent = details.method
  })
  .catch((error: unknown) => {
    if (strip) strip.textContent = `Couldn't load the request: ${error instanceof Error ? error.message : String(error)}`
  })

for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>("button[data-answer]"))) {
  button.addEventListener("click", () => {
    chrome.runtime
      .sendMessage({ type: "confirm:answer", approved: button.dataset.answer === "sign" })
      .catch((error: unknown) => console.warn("Imprimatur: answer failed", error))
  })
}
