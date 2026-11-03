(function () {
  if (document.getElementById("screening-widget")) return;

  const widget = document.createElement("div");
  widget.id = "screening-widget";
  widget.innerHTML = `
    <div id="screening-header">
      <span>Doc Screening AI <span style="font-size:10px; opacity:0.75;">v3.3</span></span>
      <div class="screening-controls">
        <button id="btn-toggle-widget" title="Minimize/Maximize">—</button>
      </div>
    </div>
    <div id="screening-body">
      <button id="btn-screen-action">🔍 Verify Full Profile</button>
      <div id="screening-output">Ready to audit.</div>
      <div id="screening-actions-container" style="margin-top: 10px;"></div>
    </div>
  `;
  document.body.appendChild(widget);

  const header = document.getElementById("screening-header");
  const body = document.getElementById("screening-body");
  const btnToggle = document.getElementById("btn-toggle-widget");
  const btnAction = document.getElementById("btn-screen-action");
  const outputDiv = document.getElementById("screening-output");
  const actionsContainer = document.getElementById("screening-actions-container");

  btnToggle.addEventListener("click", () => {
    body.classList.toggle("minimized");
    btnToggle.textContent = body.classList.contains("minimized") ? "□" : "—";
  });

  let isDragging = false, offsetX = 0, offsetY = 0;
  header.addEventListener("mousedown", (e) => {
    if (e.target.tagName === "BUTTON") return;
    isDragging = true;
    offsetX = e.clientX - widget.getBoundingClientRect().left;
    offsetY = e.clientY - widget.getBoundingClientRect().top;
    e.preventDefault();
  });

  document.addEventListener("mousemove", (e) => {
    if (!isDragging) return;
    widget.style.left = `${Math.max(10, e.clientX - offsetX)}px`;
    widget.style.top = `${Math.max(10, e.clientY - offsetY)}px`;
    widget.style.right = "auto";
  });

  document.addEventListener("mouseup", () => { isDragging = false; });

  function getDocLinkByLabel(labelText) {
    const elements = Array.from(document.querySelectorAll("body *"));
    const labelEl = elements.find(
      (el) =>
        el.children.length === 0 &&
        el.textContent.trim().toLowerCase().includes(labelText.toLowerCase())
    );
    if (!labelEl) return null;
    const container = labelEl.closest("div") || labelEl.parentElement;
    if (container) {
      const link = container.querySelector("a");
      if (link && link.href) return link.href;
    }
    return null;
  }

  function getValueByLabel(labelPrefix) {
    const el = Array.from(document.querySelectorAll("body *")).find(
      (e) => e.children.length === 0 && e.textContent.trim().toLowerCase().startsWith(labelPrefix.toLowerCase())
    );
    if (!el || !el.parentElement) return "";
    return el.parentElement.textContent.replace(new RegExp(`^${labelPrefix}`, "i"), "").trim();
  }

  function getInputValueByNearbyLabel(labelPrefix) {
    const el = Array.from(document.querySelectorAll("body *")).find(
      (e) => e.children.length === 0 && e.textContent.trim().toLowerCase().startsWith(labelPrefix.toLowerCase())
    );
    if (!el) return "";
    const parent = el.closest("div") || el.parentElement;
    if (parent) {
      const input = parent.querySelector("input");
      if (input) return input.value.trim();
    }
    return "";
  }

  function getProfilePhotoUrl() {
    const avatarImg = document.querySelector("img[src*='partner'], .MuiAvatar-img, img[alt*='avatar' i], header img, #root main img");
    if (avatarImg && avatarImg.src && avatarImg.src.startsWith("http")) return avatarImg.src;
    return null;
  }

  function extractProfileData() {
    const url = window.location.href;
    const matchId = url.match(/\/partner\/(\d+)/);
    const workerId = matchId ? matchId[1] : (url.split("/partner/")[1]?.split("?")[0] || "");

    let rawCountry = getValueByLabel("Operating country:").toUpperCase();
    let country = "PT";
    if (rawCountry.includes("UK") || rawCountry.includes("UNITED KINGDOM")) {
      country = "UK";
    } else if (rawCountry.includes("ES") || rawCountry.includes("SPAIN") || rawCountry.includes("ESPAÑA")) {
      country = "ES";
    } else if (rawCountry.includes("PT") || rawCountry.includes("PORTUGAL")) {
      country = "PT";
    }

    let registeredName = getValueByLabel("Name:");
    if (!registeredName) {
      const h1 = document.querySelector("h1, h2");
      registeredName = h1 ? h1.textContent.trim() : "";
    }

    const email = getValueByLabel("Email:");
    const phone = getValueByLabel("Phone number:");

    const nationality = getValueByLabel("Nationality:").toLowerCase();
    const sortCode = getInputValueByNearbyLabel("Sort code:");
    const accountNumber = getInputValueByNearbyLabel("Account number:");
    const workShareCode = getInputValueByNearbyLabel("Work share code:") || getInputValueByNearbyLabel("Work status share code:");

    let registeredIban = "";
    const ibanInput =
      document.querySelector("input[name*='iban' i]") ||
      Array.from(document.querySelectorAll("input")).find((i) => {
        const v = (i.value || "").replace(/\s+/g, "").toUpperCase();
        return v.startsWith("PT50") || v.startsWith("ES");
      }) ||
      document.querySelectorAll("#outlined-basic")[0];

    if (ibanInput) {
      registeredIban = (ibanInput.value || ibanInput.innerText || "").trim();
    }

    let registeredNif = "";
    const nifLabel = Array.from(document.querySelectorAll("body *")).find((el) => el.children.length === 0 && el.textContent.trim().startsWith("NIF:"));
    if (nifLabel && nifLabel.parentElement) {
      const nifInput = nifLabel.parentElement.querySelector("input");
      registeredNif = nifInput ? nifInput.value.trim() : nifLabel.parentElement.textContent.replace("NIF:", "").trim();
    }

    let idTypeSelected = "";
    const idTypeSelect = document.querySelector("select[name*='idType' i]") ||
      Array.from(document.querySelectorAll("select")).find((s) => s.closest("div")?.textContent.includes("ID type"));
    if (idTypeSelect) {
      idTypeSelected = idTypeSelect.value || idTypeSelect.options[idTypeSelect.selectedIndex]?.text || "";
    }

    return {
      workerId: workerId,
      url: url,
      operatingCountry: country,
      nationality: nationality,
      sortCode: sortCode,
      accountNumber: accountNumber,
      workShareCode: workShareCode,
      registeredName: registeredName,
      registeredEmail: email,
      registeredPhone: phone,
      registeredIban: registeredIban,
      registeredNif: registeredNif,
      idTypeSelected: idTypeSelected,
      profilePhoto: getProfilePhotoUrl(),
      citizenCardFront: getDocLinkByLabel("Citizen card front"),
      citizenCardBack: getDocLinkByLabel("Citizen card back"),
      residencePermit: getDocLinkByLabel("Expression of interest") || getDocLinkByLabel("CPLP Certificate") || getDocLinkByLabel("Residency"),
      addressProof: getDocLinkByLabel("Address proof"),
      ibanProof: getDocLinkByLabel("IBAN proof") || getDocLinkByLabel("Bank proof") || getDocLinkByLabel("Bank statement"),
      criminalRecordPt: getDocLinkByLabel("Background check") || getDocLinkByLabel("Criminal record") || getDocLinkByLabel("Registo criminal")
    };
  }

  btnAction.addEventListener("click", () => {
    btnAction.disabled = true;
    btnAction.textContent = "Auditing in background...";
    outputDiv.innerHTML = "<em>Analyzing profile, phone and documents...</em>";
    actionsContainer.innerHTML = "";

    let payload = extractProfileData();

    chrome.runtime.sendMessage({ action: "VERIFY_DOCS", payload: payload }, (response) => {
      btnAction.disabled = false;
      btnAction.textContent = "🔍 Verify Full Profile";

      if (chrome.runtime.lastError || !response || !response.success) {
        const errorMsg = response?.error || chrome.runtime.lastError?.message || "No response from screening server";
        outputDiv.innerHTML = `<span style="color: #b91c1c;">Error: ${errorMsg}. Is 'python3 screening_api.py' running?</span>`;
        return;
      }

      const data = response.data;
      let badgeClass = "badge-review";
      if (data.status === "APPROVED") badgeClass = "badge-approved";
      if (data.status === "REJECTED") badgeClass = "badge-rejected";

      // Alerta de Teléfono Extranjero No Permitido
      let phoneAlertBanner = "";
      if (data.checks && data.checks.phone_prefix_valid === false) {
        phoneAlertBanner = `
          <div style="background-color: #fee2e2; border: 2px solid #dc2626; border-radius: 6px; padding: 8px; margin: 8px 0; color: #991b1b; font-size: 11px;">
            <div style="font-weight: 800; font-size: 12px; margin-bottom: 2px;">🚨 INVALID / FOREIGN PHONE NUMBER</div>
            <div>Registered phone: <strong>${payload.registeredPhone || 'Unknown'}</strong></div>
            <div style="margin-top: 4px; font-weight: 700; color: #b91c1c;">Only +44 (UK), +351 (PT), and +34 (ES) are accepted. DO NOT ONBOARD.</div>
          </div>
        `;
      }

      // Alerta de Registro Criminal Sucio
      let criminalAlertBanner = "";
      if (data.checks && data.checks.criminal_record_is_clean === false) {
        const crimes = data.extracted_data?.criminal_convictions_found || "Convictions/Charges detected";
        criminalAlertBanner = `
          <div style="background-color: #fee2e2; border: 2px solid #dc2626; border-radius: 6px; padding: 8px; margin: 8px 0; color: #991b1b; font-size: 11px;">
            <div style="font-weight: 800; font-size: 12px; margin-bottom: 2px;">🚨 CRIMINAL RECORD NOT CLEAN</div>
            <div><strong>Crimes detected:</strong> ${crimes}</div>
            <div style="margin-top: 4px; font-weight: 700; color: #b91c1c;">⚠️ DO NOT ONBOARD THIS TECHNICIAN.</div>
          </div>
        `;
      }

      let checksHtml = "";
      if (payload.operatingCountry === "UK") {
        checksHtml = `
          <div class="section-checks">
            <div><strong>Detected Country:</strong> 🇬🇧 United Kingdom</div>
            <div class="check-item"><strong>Phone Number:</strong> ${data.checks.phone_prefix_valid ? "✅ Allowed (+44/+351/+34)" : "❌ FOREIGN PHONE NUMBER"}</div>
            <div class="check-item"><strong>Selfie Authenticity:</strong> ${data.checks.profile_photo_is_valid_selfie ? "✅ Direct Selfie" : "❌ Screen / Photo"}</div>
            <div class="check-item"><strong>Facial Match:</strong> ${data.checks.face_match ? "✅ Match" : "❌ Mismatch"}</div>
            <div class="check-item"><strong>ID / Passport:</strong> ${data.checks.id_valid ? "✅ Valid" : "❌ Invalid / B&W / Missing back"}</div>
            <div class="check-item"><strong>Sort Code & Account:</strong> ${data.checks.bank_details_match ? "✅ Provided" : "❌ Missing / Invalid"}</div>
            <div class="check-item"><strong>Address Proof (&le;6 mos):</strong> ${data.checks.address_valid ? "✅ Valid" : "❌ Invalid / Expired"}</div>
            <div class="check-item"><strong>Background Check:</strong> ${data.checks.criminal_record_is_clean ? "✅ Clean Record" : "❌ CONVICTIONS DETECTED"}</div>
          </div>
        `;
      } else if (payload.operatingCountry === "ES") {
        checksHtml = `
          <div class="section-checks">
            <div><strong>Detected Country:</strong> 🇪🇸 Spain</div>
            <div class="check-item"><strong>Phone Number:</strong> ${data.checks.phone_prefix_valid ? "✅ Allowed (+44/+351/+34)" : "❌ FOREIGN PHONE NUMBER"}</div>
            <div class="check-item"><strong>Selfie Authenticity:</strong> ${data.checks.profile_photo_is_valid_selfie ? "✅ Direct Selfie" : "❌ Screen / Photo"}</div>
            <div class="check-item"><strong>Facial Match:</strong> ${data.checks.face_match ? "✅ Match" : "❌ Mismatch"}</div>
            <div class="check-item"><strong>ID Document:</strong> ${data.checks.id_valid ? "✅ Valid" : "❌ Invalid / B&W / Screen Photo"}</div>
            <div class="check-item"><strong>IBAN Holder:</strong> ${data.checks.iban_name_match ? "✅ Match" : "❌ Mismatch / 3rd Party"}</div>
            <div class="check-item"><strong>IBAN Number:</strong> ${data.checks.iban_number_match ? "✅ Identical" : "❌ Number Mismatch"}</div>
            <div class="check-item"><strong>Address Proof (&le;6 mos):</strong> ${data.checks.address_valid ? "✅ Valid" : "❌ Expired / Invalid"}</div>
          </div>
        `;
      } else {
        checksHtml = `
          <div class="section-checks">
            <div><strong>Detected Country:</strong> 🇵🇹 Portugal</div>
            <div class="check-item"><strong>Phone Number:</strong> ${data.checks.phone_prefix_valid ? "✅ Allowed (+44/+351/+34)" : "❌ FOREIGN PHONE NUMBER"}</div>
            <div class="check-item"><strong>Selfie Authenticity:</strong> ${data.checks.profile_photo_is_valid_selfie ? "✅ Direct Selfie" : "❌ Screen / Photo"}</div>
            <div class="check-item"><strong>Facial Match:</strong> ${data.checks.face_match ? "✅ Match" : "❌ Mismatch"}</div>
            <div class="check-item"><strong>NIF Verification:</strong> ${data.checks.nif_match ? "✅ Match" : "❌ Mismatch / Missing"}</div>
            <div class="check-item"><strong>ID Document:</strong> ${data.checks.id_valid ? "✅ Valid" : "❌ Invalid / B&W / Screen Photo"}</div>
            <div class="check-item"><strong>Permit / CPLP:</strong> ${data.checks.residence_permit_valid ? "✅ Valid / Not required" : "❌ Required with Passport"}</div>
            <div class="check-item"><strong>IBAN Holder:</strong> ${data.checks.iban_name_match ? "✅ Match" : "❌ Mismatch / 3rd Party"}</div>
            <div class="check-item"><strong>IBAN Number:</strong> ${data.checks.iban_number_match ? "✅ Identical" : "❌ Number Mismatch"}</div>
            <div class="check-item"><strong>Address Proof (&le;6 mos):</strong> ${data.checks.address_valid ? "✅ Valid" : "❌ Expired / Invalid"}</div>
            <div class="check-item"><strong>PT Criminal Record:</strong> ${data.checks.criminal_record_is_clean ? "✅ Clean (NADA CONSTA)" : "❌ DIRTY (CONVICTIONS)"}</div>
          </div>
        `;
      }

      outputDiv.innerHTML = `
        <div style="margin-bottom: 6px;">
          <strong>Status:</strong> <span class="badge-status ${badgeClass}">${data.status}</span>
        </div>
        <div><strong>Risk Level:</strong> ${data.risk_level || "N/A"}</div>
        ${phoneAlertBanner}
        ${criminalAlertBanner}
        <div style="margin-top: 5px;"><strong>Reason:</strong> ${data.reason || "None"}</div>
        <div style="margin-top: 5px;"><strong>Suggested Action:</strong> ${data.next_action || "Manual check"}</div>
        ${checksHtml}
      `;
    });
  });
})();