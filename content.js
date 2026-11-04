/**
 * CONTENT SCRIPT: DOC SCREENING AI + REQUEST MISSING DOCS + DRAGGABLE PANEL
 * Oscar App Technician Onboarding Compliance
 */

// =========================================================================
// 1. DICCIONARIO Y FUNCIÓN GRAPHQL PARA SOLICITAR DOCUMENTOS
// =========================================================================
const GRAPHQL_ENDPOINT = "https://api.oscar-app.com/graphql/";

const DOCUMENT_MAP = {
  id_valid: "identification",
  criminal_record_valid: "criminalRecord",
  address_valid: "addressProof",
  iban_number_match: "ibanProof",
  iban_name_match: "ibanProof",
  profile_photo_is_valid_selfie: "profilePicture",
  residence_permit_valid: "residenceTitle",
  work_rights_valid: "identification",
  identification: "identification",
  criminalRecord: "criminalRecord",
  addressProof: "addressProof",
  ibanProof: "ibanProof",
  profilePicture: "profilePicture",
  residenceTitle: "residenceTitle"
};

async function requestMissingDocuments(workerId, missingKeys = []) {
  const variables = {
    workerId: String(workerId),
    obStatus: "missing_documents",
    churnedReason: null,
    additionalInfo: false,
    addressProof: false,
    backgroundCheck: false,
    bankDetails: false,
    criminalRecord: false,
    ibanProof: false,
    identification: false,
    originalCriminalRecord: false,
    profilePicture: false,
    residenceTitle: false,
    taxRegistration: false
  };

  missingKeys.forEach((key) => {
    const mapped = DOCUMENT_MAP[key] || key;
    if (mapped in variables) {
      variables[mapped] = true;
    }
  });

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
        worker {
          isOnline
          isWaitingForActivation
        }
      }
    }
  `;

  try {
    const response = await fetch(GRAPHQL_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        operationName: "SetObStatus",
        query: mutation,
        variables: variables
      })
    });

    const resJson = await response.json();
    if (resJson.errors) {
      console.error("GraphQL Errors:", resJson.errors);
      return { success: false, errors: resJson.errors };
    }
    return { success: true, data: resJson.data };
  } catch (error) {
    console.error("Network error on GraphQL:", error);
    return { success: false, error: error.message };
  }
}

// =========================================================================
// 2. EXTRACCIÓN DE DATOS DEL PERFIL DEL TÉCNICO EN EL DOM
// =========================================================================
function extractProfileData() {
  const findValueByLabels = (labels) => {
    const els = document.querySelectorAll("h6, p, span, label, div, li, dd");
    for (const el of els) {
      const text = el.innerText?.trim() || "";
      for (const label of labels) {
        if (text.toLowerCase().startsWith(label.toLowerCase())) {
          const parts = text.split(":");
          if (parts.length > 1) return parts.slice(1).join(":").trim();
        }
      }
    }
    return "";
  };

  const findDocumentLink = (patterns) => {
    const links = Array.from(document.querySelectorAll("a[href]"));
    for (const link of links) {
      const href = link.href.toLowerCase();
      const text = link.innerText?.toLowerCase() || "";
      for (const p of patterns) {
        if (href.includes(p.toLowerCase()) || text.includes(p.toLowerCase())) {
          return link.href;
        }
      }
    }
    return null;
  };

  const urlMatches = window.location.pathname.match(/\/workers?\/(\d+)/i) || window.location.pathname.match(/\/partner\/(\d+)/i);
  const breadcrumbId = document.querySelector("#root > div > div > header > div > div > div:nth-child(1) > nav > ol > li:nth-child(3) > a")?.innerText?.trim();
  const workerId = urlMatches ? urlMatches[1] : (breadcrumbId || window.location.pathname.split("/").filter(Boolean).pop());

  const registeredName = findValueByLabels(["Name:", "Nome:", "Nombre:"]) ||
    document.querySelector("#root main h5")?.innerText?.trim() ||
    document.querySelector("h5")?.innerText?.trim() || "";

  const registeredPhone = findValueByLabels(["Phone number:", "Phone:", "Telefone:", "Telemóvel:", "Mobile:", "Teléfono:"]) ||
    document.querySelector("input[type='tel']")?.value || "";

  const basicInputs = document.querySelectorAll("#outlined-basic");
  let registeredIban = "";
  let registeredNif = "";
  if (basicInputs.length >= 2) {
    registeredIban = basicInputs[0]?.value?.trim() || "";
    registeredNif = basicInputs[1]?.value?.trim() || "";
  } else {
    registeredIban = document.querySelector("input[name*='iban']")?.value || findValueByLabels(["IBAN:"]);
    registeredNif = document.querySelector("input[name*='nif']")?.value || findValueByLabels(["NIF:", "VAT:"]);
  }

  let operatingCountry = "PT";
  const bodyText = document.body.innerText;
  if (bodyText.includes("United Kingdom") || bodyText.includes("+44") || window.location.href.includes("/uk/")) {
    operatingCountry = "UK";
  } else if (bodyText.includes("Spain") || bodyText.includes("España") || registeredPhone.includes("+34") || registeredPhone.startsWith("34")) {
    operatingCountry = "ES";
  }

  const profilePhoto = document.querySelector("img[src*='profile'], img[src*='avatar']")?.src || findDocumentLink(["profile_photo", "avatar", "profile_picture"]);
  const citizenCardFront = findDocumentLink(["citizen_card_front", "id_front", "passport", "dni_front"]);
  const citizenCardBack = findDocumentLink(["citizen_card_back", "id_back", "dni_back"]);
  const residencePermit = findDocumentLink(["residence_permit", "cplp", "manifestacao", "residence_title"]);
  const addressProof = findDocumentLink(["address_proof", "comprovativo_morada", "morada"]);
  const ibanProof = findDocumentLink(["iban_proof", "bank_proof", "comprovativo_iban"]);
  const criminalRecordPt = findDocumentLink(["criminal_record", "registo_criminal", "antecedentes_penales"]);

  const sortCode = findValueByLabels(["Sort code:", "Sort Code:"]);
  const accountNumber = findValueByLabels(["Account number:", "Account Number:"]);
  const workShareCode = findValueByLabels(["Share code:", "Work share code:", "Right to work:"]);
  const nationality = findValueByLabels(["Nationality:", "Nacionalidade:", "Nacionalidad:"]).toLowerCase();

  return {
    workerId,
    operatingCountry,
    registeredName,
    registeredPhone,
    registeredIban,
    registeredNif,
    idTypeSelected: "",
    nationality,
    sortCode,
    accountNumber,
    workShareCode,
    profilePhoto,
    citizenCardFront,
    citizenCardBack,
    residencePermit,
    addressProof,
    ibanProof,
    criminalRecordPt
  };
}

// =========================================================================
// 3. INYECCIÓN DEL PANEL FLOTANTE Y MOVIBLE (DRAGGABLE)
// =========================================================================
let currentWorkerId = "";
let currentRejectedDocs = [];

function makeElementDraggable(panel, handle) {
  let isDragging = false;
  let startX = 0, startY = 0;
  let initialLeft = 0, initialTop = 0;

  handle.addEventListener("mousedown", (e) => {
    // Si hace clic en el botón de minimizar, no iniciar el arrastre
    if (e.target.id === "screening-minimize-btn") return;

    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;

    const rect = panel.getBoundingClientRect();
    initialLeft = rect.left;
    initialTop = rect.top;

    // Desactivar temporalmente transiciones y estilos de 'right' para usar 'left' absoluto
    panel.style.right = "auto";
    panel.style.bottom = "auto";
    panel.style.left = `${initialLeft}px`;
    panel.style.top = `${initialTop}px`;

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    e.preventDefault();
  });

  function onMouseMove(e) {
    if (!isDragging) return;
    const deltaX = e.clientX - startX;
    const deltaY = e.clientY - startY;

    let newLeft = initialLeft + deltaX;
    let newTop = initialTop + deltaY;

    // Evitar que se salga fuera de los bordes de la pantalla
    const maxLeft = window.innerWidth - panel.offsetWidth - 10;
    const maxTop = window.innerHeight - panel.offsetHeight - 10;

    newLeft = Math.max(10, Math.min(newLeft, maxLeft));
    newTop = Math.max(10, Math.min(newTop, maxTop));

    panel.style.left = `${newLeft}px`;
    panel.style.top = `${newTop}px`;
  }

  function onMouseUp() {
    isDragging = false;
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);
  }
}

function createFloatingWidget() {
  if (document.getElementById("doc-screening-panel")) return;

  const panel = document.createElement("div");
  panel.id = "doc-screening-panel";
  panel.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    width: 330px;
    background: #111827;
    color: #f3f4f6;
    border-radius: 10px;
    box-shadow: 0 10px 30px rgba(0,0,0,0.5);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    z-index: 999999;
    padding: 14px;
    box-sizing: border-box;
    font-size: 13px;
    border: 1px solid #374151;
    user-select: none;
  `;

  panel.innerHTML = `
    <div id="screening-drag-header" style="
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
      padding-bottom: 6px;
      border-bottom: 1px solid #374151;
      cursor: move;
    ">
      <span style="font-weight: 700; font-size: 13px; color: #ffffff; display: flex; align-items: center; gap: 6px;">
        <span>✥</span> Doc Screening AI <span style="font-size: 10px; color: #9ca3af; background: #1f2937; padding: 1px 5px; border-radius: 4px;">v3.4</span>
      </span>
      <button id="screening-minimize-btn" style="
        background: none;
        border: none;
        color: #9ca3af;
        cursor: pointer;
        font-size: 16px;
        line-height: 1;
        padding: 0 4px;
      ">—</button>
    </div>

    <div id="screening-content">
      <button id="screening-verify-btn" style="
        width: 100%;
        background-color: #2563eb;
        color: white;
        border: none;
        padding: 9px;
        border-radius: 6px;
        cursor: pointer;
        font-weight: 600;
        margin-bottom: 10px;
        transition: background 0.2s;
      ">🔍 Verify Full Profile</button>

      <button id="screening-request-btn" style="
        width: 100%;
        background-color: #dc2626;
        color: white;
        border: none;
        padding: 9px;
        border-radius: 6px;
        cursor: pointer;
        font-weight: 600;
        margin-bottom: 10px;
        display: none;
        transition: background 0.2s;
      ">📩 Request Missing Docs</button>

      <div id="screening-status-area" style="font-size: 12px; line-height: 1.4;">
        <span style="color: #9ca3af;">Click "Verify Full Profile" to audit current technician.</span>
      </div>
    </div>
  `;

  document.body.appendChild(panel);

  // Hacer el panel arrastrable desde la cabecera
  const dragHeader = document.getElementById("screening-drag-header");
  makeElementDraggable(panel, dragHeader);

  // Botón minimizar
  let minimized = false;
  document.getElementById("screening-minimize-btn").addEventListener("click", () => {
    minimized = !minimized;
    document.getElementById("screening-content").style.display = minimized ? "none" : "block";
  });

  // Botón Verificar
  document.getElementById("screening-verify-btn").addEventListener("click", runVerification);

  // Botón Solicitar Documentos Faltantes
  document.getElementById("screening-request-btn").addEventListener("click", sendMissingDocsRequest);
}

// =========================================================================
// 4. LÓGICA DE AUDITORÍA CON GEMINI (VÍA BACKGROUND.JS)
// =========================================================================
async function runVerification() {
  const verifyBtn = document.getElementById("screening-verify-btn");
  const requestBtn = document.getElementById("screening-request-btn");
  const statusArea = document.getElementById("screening-status-area");

  verifyBtn.disabled = true;
  verifyBtn.innerText = "Auditing Documents...";
  requestBtn.style.display = "none";
  statusArea.innerHTML = `<span style="color:#60a5fa;">Extracting profile & sending to AI server...</span>`;

  const profilePayload = extractProfileData();
  currentWorkerId = profilePayload.workerId;
  currentRejectedDocs = [];

  chrome.runtime.sendMessage({ action: "VERIFY_DOCS", payload: profilePayload }, (response) => {
    verifyBtn.disabled = false;
    verifyBtn.innerText = "🔍 Verify Full Profile";

    if (!response || !response.success) {
      statusArea.innerHTML = `
        <div style="background:#451a1a; padding:8px; border-radius:6px; color:#fca5a5;">
          <strong>Error:</strong> ${response?.error || "Failed to fetch. Check if server is running."}
        </div>
      `;
      return;
    }

    renderAuditResult(response.data);
  });
}

function renderAuditResult(data) {
  const statusArea = document.getElementById("screening-status-area");
  const requestBtn = document.getElementById("screening-request-btn");

  const status = data.status || "MANUAL_REVIEW";
  const checks = data.checks || {};
  const reason = data.reason || "No detail provided.";
  const nextAction = data.next_action || "";

  currentRejectedDocs = [];
  if (checks.id_valid === false) currentRejectedDocs.push("identification");
  if (checks.criminal_record_valid === false) currentRejectedDocs.push("criminalRecord");
  if (checks.address_valid === false) currentRejectedDocs.push("addressProof");
  if (checks.iban_number_match === false || checks.bank_details_match === false) currentRejectedDocs.push("ibanProof");
  if (checks.profile_photo_is_valid_selfie === false) currentRejectedDocs.push("profilePicture");
  if (checks.residence_permit_valid === false) currentRejectedDocs.push("residenceTitle");

  if (currentRejectedDocs.length > 0) {
    requestBtn.style.display = "block";
    requestBtn.innerText = `📩 Request ${currentRejectedDocs.length} Missing Docs`;
    requestBtn.style.backgroundColor = "#dc2626";
    requestBtn.disabled = false;
  } else {
    requestBtn.style.display = "none";
  }

  const badgeColor = status === "APPROVED" ? "#15803d" : (status === "REJECTED" ? "#b91c1c" : "#b45309");

  const checkItem = (label, val) => {
    if (val === undefined || val === null) return "";
    const icon = val ? "<span style='color:#4ade80;'>✓</span>" : "<span style='color:#f87171;'>✕</span>";
    return `<div style="display:flex; justify-content:space-between; margin-bottom:3px;">
      <span>${label}:</span><span>${icon}</span>
    </div>`;
  };

  statusArea.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
      <span style="font-weight:600;">Status:</span>
      <span style="background:${badgeColor}; padding:2px 8px; border-radius:4px; font-weight:bold;">${status}</span>
    </div>

    <div style="background:#1f2937; padding:8px; border-radius:6px; margin-bottom:8px;">
      <div style="font-size:11px; color:#d1d5db; margin-bottom:4px;"><strong>Reason:</strong> ${reason}</div>
      ${nextAction ? `<div style="font-size:11px; color:#93c5fd;"><strong>Action:</strong> ${nextAction}</div>` : ""}
    </div>

    <div style="border-top:1px solid #374151; padding-top:6px; font-size:11px;">
      ${checkItem("Selfie Authentic", checks.profile_photo_is_valid_selfie)}
      ${checkItem("Face Match", checks.face_match)}
      ${checkItem("ID / Passport Valid", checks.id_valid)}
      ${checkItem("ID Color & Legible", checks.id_is_legible)}
      ${checkItem("NIF Match (PT)", checks.nif_match)}
      ${checkItem("Proof of Address", checks.address_valid)}
      ${checkItem("Bank / IBAN Match", checks.iban_number_match ?? checks.bank_details_match)}
      ${checkItem("Background Check Clean", checks.criminal_record_is_clean)}
    </div>
  `;
}

// =========================================================================
// 5. ACCIÓN DEL BOTÓN: DISPARAR GRAPHQL DIRECTO AL DASHBOARD
// =========================================================================
async function sendMissingDocsRequest() {
  const requestBtn = document.getElementById("screening-request-btn");

  if (!currentWorkerId) {
    alert("Worker ID not found. Ensure you are on a technician profile page.");
    return;
  }

  requestBtn.disabled = true;
  requestBtn.innerText = "Sending request to Oscar...";
  requestBtn.style.backgroundColor = "#6b7280";

  const result = await requestMissingDocuments(currentWorkerId, currentRejectedDocs);

  if (result.success) {
    requestBtn.innerText = "✓ Requested Successfully!";
    requestBtn.style.backgroundColor = "#16a34a";
  } else {
    requestBtn.innerText = "✕ Error Requesting";
    requestBtn.style.backgroundColor = "#991b1b";
    requestBtn.disabled = false;
    alert(`Could not update status: ${JSON.stringify(result.errors || result.error)}`);
  }
}

// Iniciar widget al cargar la página
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", createFloatingWidget);
} else {
  createFloatingWidget();
}