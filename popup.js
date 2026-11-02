document.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("btn-verify");
  const resultDiv = document.getElementById("result");

  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.textContent = "Auditing documents...";
    resultDiv.innerHTML = "<em>Extracting documents and evaluating rules with Gemini...</em>";

    try {
      // 1. Obtener la pestaña activa
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.url || !tab.url.includes("admin.oscar-app.com/partner/")) {
        throw new Error("Please open an active partner profile in Oscar Admin.");
      }

      // 2. Pedir datos extraídos a content.js
      const payload = await new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tab.id, { action: "GET_PROFILE_DATA" }, (res) => {
          if (chrome.runtime.lastError) {
            reject(new Error("Please refresh the partner page (Cmd + R) and try again."));
          } else {
            resolve(res);
          }
        });
      });

      // 3. Enviar al servidor local Flask
      const apiResponse = await fetch("http://127.0.0.1:5000/verify-technician", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!apiResponse.ok) {
        const errorText = await apiResponse.text();
        throw new Error(`Server Error (${apiResponse.status}): ${errorText}`);
      }

      const data = await apiResponse.json();

      let badgeClass = "badge-review";
      if (data.status === "APPROVED") badgeClass = "badge-approved";
      if (data.status === "REJECTED") badgeClass = "badge-rejected";

      let checksHtml = "";
      if (data.checks) {
        if (payload.operatingCountry === "ES") {
          checksHtml = `
            <div class="section-checks">
              <div><strong>Detected Country:</strong> 🇪🇸 Spain</div>
              <div class="check-row"><strong>ID Document (Color):</strong> ${data.checks.id_valid ? "✅ Valid" : "❌ Invalid / B&W"}</div>
              <div class="check-row"><strong>IBAN Account Holder:</strong> ${data.checks.iban_name_match ? "✅ Match" : "❌ Mismatch / 3rd Party"}</div>
              <div class="check-row"><strong>Address Proof (&le;6 mos):</strong> ${data.checks.address_valid ? "✅ Valid" : "❌ Expired / Invalid"}</div>
            </div>
          `;
        } else {
          checksHtml = `
            <div class="section-checks">
              <div><strong>Detected Country:</strong> 🇵🇹 Portugal</div>
              <div class="check-row"><strong>NIF Verification:</strong> ${data.checks.nif_match ? "✅ Match" : "❌ Mismatch / Missing"}</div>
              <div class="check-row"><strong>ID Document (Color):</strong> ${data.checks.id_valid ? "✅ Valid" : "❌ Invalid / B&W"}</div>
              <div class="check-row"><strong>Permit / CPLP:</strong> ${data.checks.residence_permit_valid ? "✅ Valid / Not required" : "❌ Required with Passport"}</div>
              <div class="check-row"><strong>IBAN Account Holder:</strong> ${data.checks.iban_name_match ? "✅ Match" : "❌ Mismatch / 3rd Party"}</div>
              <div class="check-row"><strong>Address Proof (&le;6 mos):</strong> ${data.checks.address_valid ? "✅ Valid" : "❌ Expired / Invalid"}</div>
              <div class="check-row"><strong>PT Criminal Record:</strong> ${data.checks.criminal_record_valid ? "✅ Valid" : "❌ Non-PT or Expired"}</div>
            </div>
          `;
        }
      }

      resultDiv.innerHTML = `
        <div style="margin-bottom: 8px;">
          <strong>Status:</strong> <span class="badge ${badgeClass}">${data.status}</span>
        </div>
        <div><strong>Risk Level:</strong> ${data.risk_level || "N/A"}</div>
        <div style="margin-top: 6px;"><strong>Reason:</strong> ${data.reason || "None"}</div>
        <div style="margin-top: 6px;"><strong>Suggested Action:</strong> ${data.next_action || "Manual check"}</div>
        ${checksHtml}
      `;
    } catch (err) {
      resultDiv.innerHTML = `<span style="color: #b91c1c;"><strong>Error:</strong> ${err.message}</span>`;
    } finally {
      btn.disabled = false;
      btn.textContent = "🔍 Verify Full Profile";
    }
  });
});