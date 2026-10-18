const out = document.querySelector("#out")

// Signed code that runs text fetched at runtime: the case Imprimatur can't cover.
fetch("/remote.txt")
  .then((response) => response.text())
  .then((text) => new Function(text)())
  .catch((error) => console.warn("remote config failed", error))

document.querySelector("#pay").addEventListener("click", async () => {
  const { buildPayment } = await import("/lazy.js")
  out.textContent = JSON.stringify(buildPayment(window.APP_CONFIG))
})
