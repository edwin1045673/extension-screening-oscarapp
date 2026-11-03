chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "VERIFY_DOCS") {
    // Substitui por isto:
      fetch("https://shrouded-starfish-unbitten.ngrok-free.dev/verify-technician", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message.payload)
    })
      .then(async (res) => {
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`Server returned ${res.status}: ${text}`);
        }
        return res.json();
      })
      .then((data) => sendResponse({ success: true, data: data }))
      .catch((err) => sendResponse({ success: false, error: err.message }));

    return true; // Mantiene el canal abierto para respuesta asíncrona
  }
});