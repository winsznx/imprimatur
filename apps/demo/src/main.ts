import { installDemoWallet } from "./wallet"

const VARIANTS: Record<string, string> = {
  "imprimatur-clean.vercel.app": "This copy is the release its team signed.",
  "imprimatur-tampered.vercel.app":
    "Simulation: one file on this origin was changed after release, the way Safe's bucket was in Feb 2025.",
  "imprimatur-forged.vercel.app":
    "Simulation: a changed file, plus a fake release for it published by another wallet with every field copied.",
  "imprimatur-stolen-key.vercel.app":
    "Simulation: a changed build released with the team's CI key, which an attacker holds. No second signer approved it.",
}

const banner = document.querySelector("#demo-banner")
const variant = VARIANTS[location.host]
if (banner && variant) banner.textContent = `${banner.textContent?.trim()} ${variant}`

const demoWallet = installDemoWallet()
const you = document.querySelector("#you-address")
if (you && !demoWallet) you.textContent = "your wallet"

const button = document.querySelector<HTMLButtonElement>("#sign")
const result = document.querySelector<HTMLParagraphElement>("#result")

function show(message: string, tone: "ok" | "refused"): void {
  if (!result) return
  result.textContent = message
  result.dataset.tone = tone
}

button?.addEventListener("click", async () => {
  const provider = window.ethereum
  if (!provider) return show("No wallet found.", "refused")
  button.disabled = true
  show("Waiting for the wallet…", "ok")
  try {
    const { signPending } = await import("./sign")
    const signature = await signPending(provider)
    show(`Signed. Signature ${signature.slice(0, 10)}…${signature.slice(-6)}`, "ok")
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    show(`Not signed. ${message}`, "refused")
  } finally {
    button.disabled = false
  }
})
