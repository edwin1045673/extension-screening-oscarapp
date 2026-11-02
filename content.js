(function () {
  if (document.getElementById("screening-widget")) return;

  const widget = document.createElement("div");
  widget.id = "screening-widget";
  widget.innerHTML = `
    <div id="screening-header">
      <span>Doc Screening AI <span style="font-size:10px; opacity:0.75;">v3.1 (Multi-Country)</span></span>
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

    // Detección robusta de País
    let rawCountry = getValueByLabel("Operating country:").toUpperCase();
    let country = "PT";
    if (rawCountry.includes("UK") || rawCountry.includes("UNITED KINGDOM")) {
      country = "UK";
    } else if (rawCountry.includes("ES") || rawCountry.includes("SPAIN") || rawCountry.includes("ESPAÑA")) {
      country = "ES";
    } else if (rawCountry.includes("PT") || rawCountry.includes("PORTUGAL")) {
      country = "PT";
    } else {
      // Detección de respaldo por teléfono o IBAN
      const phoneText = getValueByLabel("Phone number:");
      if (phoneText.startsWith("+44") || phoneText.startsWith("44")) country = "UK";
      else if (phoneText.startsWith("+34") || phoneText.startsWith("34")) country = "ES";
    }

    let registeredName = getValueByLabel("Name:");
    if (!registeredName) {
      const h1 = document.querySelector("h1, h2");
      registeredName = h1 ? h1.textContent.trim() : "";
    }

    const email = getValueByLabel("Email:");
    const phone = getValueByLabel("Phone number:");

    // UK
    const nationality = getValueByLabel("Nationality:").toLowerCase();
    const sortCode = getInputValueByNearbyLabel("Sort code:");
    const accountNumber = getInputValueByNearbyLabel("Account number:");
    const workShareCode = getInputValueByNearbyLabel("Work share code:") || getInputValueByNearbyLabel("Work status share code:");

    // ES / PT (IBAN y NIF)
    // Extracción mejorada de IBAN en el dashboard
    let registeredIban = "";
    const ibanInput =
      document.querySelector("input[name*='iban' i]") ||
      Array.from(document.querySelectorAll("input")).find((i) => {
        const v = (i.value || "").replace(/\s+/g, "").toUpperCase();
        return v.startsWith("PT50") || v.startsWith("ES");
      }) ||
      document.querySelectorAll("#outlined-basic")[0]; // En Oscar, el primer #outlined-basic suele ser el IBAN

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

  async function requestMissingDocuments(workerId, flags = {}) {
    const ENDPOINT = "https://api.oscar-app.com/graphql/";
    const variables = {
      workerId: String(workerId),
      obStatus: "missing_documents",
      churnedReason: null,
      additionalInfo: false,
      addressProof: Boolean(flags.addressProof),
      backgroundCheck: Boolean(flags.backgroundCheck),
      bankDetails: Boolean(flags.bankDetails),
      criminalRecord: Boolean(flags.criminalRecord),
      ibanProof: Boolean(flags.ibanProof),
      identification: Boolean(flags.identification),
      originalCriminalRecord: false,
      profilePicture: Boolean(flags.profilePicture),
      residenceTitle: Boolean(flags.residenceTitle),
      taxRegistration: false
    };

    const mutation = `
      mutation SetObStatus(
        $workerId: ID!
        $obStatus: String!
        $churnedReason: String
        $addressProof: Boolean
        $criminalRecord: Boolean
        $ibanProof: Boolean
        $identification: Boolean
        $profilePicture: Boolean
        $residenceTitle: Boolean
        $originalCriminalRecord: Boolean
        $backgroundCheck: Boolean
        $bankDetails: Boolean
        $taxRegistration: Boolean
        $additionalInfo: Boolean
      ) {
        setObStatus(
          workerId: $workerId
          obStatus: $obStatus
          churnedReason: $churnedReason
          addressProof: $addressProof
          criminalRecord: $criminalRecord
          ibanProof: $ibanProof
          identification: $identification
          profilePicture: $profilePicture
          residenceTitle: $residenceTitle
          originalCriminalRecord: $originalCriminalRecord
          backgroundCheck: $backgroundCheck
          bankDetails: $bankDetails
          taxRegistration: $taxRegistration
          additionalInfo: $additionalInfo
        ) {
          worker { isOnline isWaitingForActivation }
        }
      }
    `;

    try {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ operationName: "SetObStatus", query: mutation, variables: variables })
      });
      const resJson = await response.json();
      return { success: !resJson.errors, data: resJson.data, errors: resJson.errors };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  btnAction.addEventListener("click", () => {
    btnAction.disabled = true;
    btnAction.textContent = "Auditing in background...";
    outputDiv.innerHTML = "<em>Analyzing documents with Gemini...</em>";
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

      const missingFlags = {};
      if (data.checks) {
        if (!data.checks.id_valid || data.checks.id_is_screen_photo) missingFlags.identification = true;
        if (data.checks.face_match === false || data.checks.profile_photo_is_valid_selfie === false) missingFlags.profilePicture = true;
        if (!data.checks.address_valid) missingFlags.addressProof = true;
        
        if (payload.operatingCountry === "UK") {
          if (!data.checks.criminal_record_valid) missingFlags.backgroundCheck = true;
          if (data.checks.work_rights_valid === false) missingFlags.residenceTitle = true;
        } else {
          if (!data.checks.iban_name_match || !data.checks.iban_number_match || !data.checks.iban_is_official) missingFlags.ibanProof = true;
          if (payload.operatingCountry === "PT") {
            if (!data.checks.criminal_record_valid) missingFlags.criminalRecord = true;
            if (!data.checks.residence_permit_valid) missingFlags.residenceTitle = true;
          }
        }
      }

      const hasMissingDocs = Object.keys(missingFlags).length > 0;
      let checksHtml = "";

      if (payload.operatingCountry === "UK") {
        checksHtml = `
          <div class="section-checks">
            <div><strong>Detected Country:</strong> 🇬🇧 United Kingdom (${payload.nationality || 'UK/Non-UK'})</div>
            <div class="check-item"><strong>Selfie Authenticity:</strong> ${data.checks.profile_photo_is_valid_selfie ? "✅ Direct Selfie" : "❌ Screen / Photo"}</div>
            <div class="check-item"><strong>Facial Match:</strong> ${data.checks.face_match ? "✅ Match" : "❌ Mismatch"}</div>
            <div class="check-item"><strong>ID / Passport (Color/Legible):</strong> ${data.checks.id_valid && data.checks.id_is_legible !== false ? "✅ Valid & Clear" : "❌ Blurry / B&W / Back missing"}</div>
            <div class="check-item"><strong>Sort Code & Account:</strong> ${data.checks.bank_details_match ? "✅ Provided" : "❌ Missing / Invalid"}</div>
            <div class="check-item"><strong>Address Proof (&le;6 mos):</strong> ${data.checks.address_valid ? "✅ Valid" : "❌ Invalid / Expired"}</div>
            <div class="check-item"><strong>Background Check (&le;12 mos):</strong> ${data.checks.criminal_record_valid ? "✅ Valid" : "❌ Expired / Invalid"}</div>
            ${data.checks.manual_share_code_check ? `<div class="check-item" style="color: #b45309;"><strong>⚠️ Right to Work:</strong> Manual Share Code check required</div>` : ""}
            ${data.checks.manual_criminal_code_check ? `<div class="check-item" style="color: #b45309;"><strong>⚠️ Background Code:</strong> Online verification code detected</div>` : ""}
          </div>
        `;
      } else if (payload.operatingCountry === "ES") {
        checksHtml = `
          <div class="section-checks">
            <div><strong>Detected Country:</strong> 🇪🇸 Spain</div>
            <div class="check-item"><strong>Selfie Authenticity:</strong> ${data.checks.profile_photo_is_valid_selfie ? "✅ Direct Selfie" : "❌ Screen / Photo"}</div>
            <div class="check-item"><strong>Facial Match:</strong> ${data.checks.face_match ? "✅ Match" : "❌ Mismatch"}</div>
            <div class="check-item"><strong>ID Document (Color/Legible):</strong> ${data.checks.id_valid && data.checks.id_is_legible !== false ? "✅ Valid & Clear" : "❌ Blurry / B&W / Screen Photo"}</div>
            <div class="check-item"><strong>IBAN Holder:</strong> ${data.checks.iban_name_match ? "✅ Match" : "❌ Mismatch / 3rd Party"}</div>
            <div class="check-item"><strong>IBAN Number:</strong> ${data.checks.iban_number_match ? "✅ Identical" : "❌ Number Mismatch"}</div>
            <div class="check-item"><strong>Address Proof (&le;6 mos):</strong> ${data.checks.address_valid ? "✅ Valid" : "❌ Expired / Invalid"}</div>
          </div>
        `;
      } else {
        checksHtml = `
          <div class="section-checks">
            <div><strong>Detected Country:</strong> 🇵🇹 Portugal</div>
            <div class="check-item"><strong>Selfie Authenticity:</strong> ${data.checks.profile_photo_is_valid_selfie ? "✅ Direct Selfie" : "❌ Screen / Photo"}</div>
            <div class="check-item"><strong>Facial Match:</strong> ${data.checks.face_match ? "✅ Match" : "❌ Mismatch"}</div>
            <div class="check-item"><strong>NIF Verification:</strong> ${data.checks.nif_match ? "✅ Match" : "❌ Mismatch / Missing"}</div>
            <div class="check-item"><strong>ID Document (Color/Legible):</strong> ${data.checks.id_valid && data.checks.id_is_legible !== false ? "✅ Valid & Clear" : "❌ Blurry / B&W / Screen Photo"}</div>
            <div class="check-item"><strong>Permit / CPLP:</strong> ${data.checks.residence_permit_valid ? "✅ Valid / Not required" : "❌ Required with Passport"}</div>
            <div class="check-item"><strong>IBAN Holder:</strong> ${data.checks.iban_name_match ? "✅ Match" : "❌ Mismatch / 3rd Party"}</div>
            <div class="check-item"><strong>IBAN Number:</strong> ${data.checks.iban_number_match ? "✅ Identical" : "❌ Number Mismatch"}</div>
            <div class="check-item"><strong>Address Proof (&le;6 mos):</strong> ${data.checks.address_valid ? "✅ Valid" : "❌ Expired / Invalid"}</div>
            <div class="check-item"><strong>PT Criminal Record:</strong> ${data.checks.criminal_record_valid ? "✅ Valid" : "❌ Non-PT / Expired"}</div>
          </div>
        `;
      }

      outputDiv.innerHTML = `
        <div style="margin-bottom: 6px;">
          <strong>Status:</strong> <span class="badge-status ${badgeClass}">${data.status}</span>
        </div>
        <div><strong>Risk Level:</strong> ${data.risk_level || "N/A"}</div>
        <div style="margin-top: 5px;"><strong>Reason:</strong> ${data.reason || "None"}</div>
        <div style="margin-top: 5px;"><strong>Suggested Action:</strong> ${data.next_action || "Manual check"}</div>
        ${checksHtml}
      `;

      if (hasMissingDocs && payload.workerId) {
        const btnRequest = document.createElement("button");
        btnRequest.id = "btn-request-docs";
        btnRequest.style.cssText = `
          width: 100%; padding: 8px 10px; background-color: #ea580c; color: white;
          border: none; border-radius: 6px; font-size: 11px; font-weight: 700; cursor: pointer;
        `;
        btnRequest.textContent = `📩 Request Missing Docs (${Object.keys(missingFlags).length})`;

        btnRequest.addEventListener("click", async () => {
          btnRequest.disabled = true;
          btnRequest.textContent = "Requesting via GraphQL...";
          const reqResult = await requestMissingDocuments(payload.workerId, missingFlags);
          if (reqResult.success) {
            btnRequest.style.backgroundColor = "#16a34a";
            btnRequest.textContent = "✓ Status updated to Missing Documents!";
            setTimeout(() => { window.location.reload(); }, 1200);
          } else {
            btnRequest.style.backgroundColor = "#dc2626";
            btnRequest.textContent = "❌ Failed to request docs";
          }
        });
        actionsContainer.appendChild(btnRequest);
      }
    });
  });
})();