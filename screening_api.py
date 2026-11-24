from flask import Flask, request, jsonify
from flask_cors import CORS
from google import genai
from google.genai import types
from datetime import datetime
import requests
import json
import time
import os
import traceback

app = Flask(__name__)
# Permitir conexiones CORS desde cualquier origen (incluyendo ngrok y extensiones de Chrome)
CORS(app, resources={r"/*": {"origins": "*"}})

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()
client = genai.Client(api_key=GEMINI_API_KEY)

ALLOWED_PHONE_PREFIXES = ["+44", "+351", "+34"]

def validar_telefono_permitido(telefono_raw):
    if not telefono_raw:
        return False, "Not provided"
    
    # Limpiar espacios, guiones o paréntesis pero conservar el signo '+'
    limpio = "".join(c for c in str(telefono_raw).strip() if c.isdigit() or c == '+')
    
    # Normalizar si no colocaron el signo '+' inicial
    if limpio.startswith("44") and len(limpio) >= 11:
        limpio = "+" + limpio
    elif limpio.startswith("351") and len(limpio) >= 12:
        limpio = "+" + limpio
    elif limpio.startswith("34") and len(limpio) >= 11:
        limpio = "+" + limpio
    elif not limpio.startswith("+") and len(limpio) == 9:
        # Número local de 9 dígitos sin prefijo (PT o ES)
        return True, limpio

    for prefix in ALLOWED_PHONE_PREFIXES:
        if limpio.startswith(prefix):
            return True, limpio
            
    return False, limpio

@app.route("/verify-technician", methods=["POST"])
def verify():
    try:
        # 1. Definición obligatoria de la fecha actual (evita errores de Pylance)
        today_str = datetime.now().strftime("%Y-%m-%d")

        data = request.get_json() or {}
        # Priorizar el país forzado por cada extensión (PT, ES o UK)
        country = (data.get("forced_country") or data.get("country") or "PT").upper().strip()
        print(f"Auditando perfil bajo reglas estrictas de: {country}")

        registered_name = str(data.get("registeredName") or "Not specified")
        registered_phone = str(data.get("registeredPhone") or "").strip()
        registered_iban = str(data.get("registeredIban") or "").strip().replace(" ", "").upper()
        registered_nif = str(data.get("registeredNif") or "").strip().replace(" ", "").replace("/", "")
        id_type_selected = str(data.get("idTypeSelected") or "").upper()
        
        nationality = str(data.get("nationality") or "").lower()
        sort_code = str(data.get("sortCode") or "").strip().replace(" ", "").replace("-", "")
        account_number = str(data.get("accountNumber") or "").strip().replace(" ", "")
        work_share_code = str(data.get("workShareCode") or "").strip()

        # =========================================================================
        # REGLA OBLIGATORIA: PREFIJO TELEFÓNICO PERMITIDO (+44, +351, +34)
        # =========================================================================
        phone_is_allowed, phone_formatted = validar_telefono_permitido(registered_phone)
        if not phone_is_allowed:
            return jsonify({
                "status": "REJECTED",
                "risk_level": "HIGH",
                "reason": f"CRITICAL: Foreign phone number detected ({registered_phone}). Only UK (+44), Portugal (+351), and Spain (+34) phone numbers are allowed. Do NOT onboard.",
                "next_action": "REJECT TECHNICIAN - Foreign phone number not permitted.",
                "checks": {
                    "profile_photo_is_valid_selfie": False,
                    "face_match": False,
                    "id_valid": False,
                    "address_valid": False,
                    "criminal_record_valid": False,
                    "phone_prefix_valid": False
                },
                "extracted_data": {
                    "rejected_phone": registered_phone
                }
            }), 200

        docs = {
            "profile_photo": data.get("profilePhoto"),
            "citizen_card_front": data.get("citizenCardFront"),
            "citizen_card_back": data.get("citizenCardBack"),
            "residence_permit": data.get("residencePermit"),
            "address_proof": data.get("addressProof"),
            "iban_proof": data.get("ibanProof"),
            "criminal_record": data.get("criminalRecordPt"),
        }

        # =========================================================================
        # PROMPTS DE COMPLIANCE POR PAÍS
        # =========================================================================
        if country == "UK":
            is_british_or_irish = "british" in nationality or "irish" in nationality

            prompt = f"""
            You are a legal compliance screening officer for the Oscar platform onboarding in the UNITED KINGDOM (UK).
            Audit Date: {today_str}.
            Registered Name: "{registered_name}".
            Nationality Type: "{nationality}" (Is British/Irish: {is_british_or_irish}).
            Selected ID Type: "{id_type_selected}".
            Registered Sort Code: "{sort_code}".
            Registered Account Number: "{account_number}".
            Registered Work Share Code: "{work_share_code}".

            NAME MATCHING POLICY:
            - If at least 2 primary names/surnames match between document and "{registered_name}", consider it a VALID NAME MATCH.

            COMPLIANCE RULES (UNITED KINGDOM):
            1. PROFILE PHOTO (AUTHENTIC SELFIE):
               - Must be a direct, genuine selfie. Reject photos of paper photos or screen captures (profile_photo_is_valid_selfie = false).
               - Facial match against identity document required (face_match = true|false).

            2. IDENTITY DOCUMENT (STRICT STRIPE LEGIBILITY & PHYSICAL PHOTO RULES):
               - A) LEGIBILITY & FOCUS: Must be sharp, clear, and completely legible. If blurry, unreadable or obstructed by glare: set id_is_legible = false, id_valid = false, status = REJECTED.
               - B) PHYSICAL COLOR PHOTO ONLY: Direct photo of physical document. Strictly REJECT digital screen photos and B&W copies.
               - C) British or Irish ({is_british_or_irish} = True): Must submit valid British/Irish PASSPORT.
               - D) Foreigner ({is_british_or_irish} = False): Can submit Passport, National ID or Driving Licence. If National ID or Driving Licence submitted (NOT passport), the BACK [citizen_card_back] is STRICTLY MANDATORY.
               - Must be unexpired relative to {today_str}.
            
            2.5 MIRROR / FLIPPED EFFECT POLICY (STRICT):
                - Check the text orientation on all identity documents (DNI, NIE, Passport, Citizen Card, Residence Permit).
                - The document MUST NOT be mirrored, flipped horizontally, or written backwards (text reading right-to-left like a mirror selfie).
                - If the document is mirrored / flipped:
                    * Set "id_valid": false.
                    * Set "id_is_legible": false.
                    * Force status to "REJECTED" or "MANUAL_REVIEW".
                    * "reason" MUST state: "Identification document is mirrored / flipped horizontally (mirror selfie effect). Text must be readable normally from left to right."
                    * "next_action" MUST state: "Request new identification document (must not be mirrored or reversed)".

            3. RIGHT TO WORK SHARE CODE (UK):
               - Only applies to foreigners submitting a PASSPORT:
                 * British or Irish: Work share code NOT required (work_rights_valid = true, manual_share_code_check = false).
                 * Foreigner with Passport: Work Share Code is MANDATORY. If empty: set work_rights_valid = false, status = REJECTED. If provided: set work_rights_valid = true, manual_share_code_check = true, status = MANUAL_REVIEW.
                 * Foreigner without Passport (National ID/Licence + back): work_rights_valid = true.

            4. UK BANK DETAILS:
               - Sort Code: "{sort_code}", Account Number: "{account_number}".
               - As long as both fields are not empty: set bank_details_match = true.

            5. PROOF OF ADDRESS (UK):
               - Utility bill, Bank letter, insurance, tenancy agreement, or UK Driving Licence. Max 6 months old. Name must match "{registered_name}".

            6. BACKGROUND CHECK (CRIMINAL RECORD - UK) - STRICT ZERO-CONVICTION RULE:
               - Must be issued within 12 MONTHS relative to {today_str} and name must match "{registered_name}".
               - If ANY convictions, cautions or reprimands recorded: set criminal_record_is_clean = false, criminal_record_valid = false, status = REJECTED, risk_level = HIGH.
               - If clean: set criminal_record_is_clean = true, criminal_record_valid = true.

            DECISION:
            - "status": "APPROVED|REJECTED|MANUAL_REVIEW".
            - "reason": Explanation in ENGLISH.
            - "next_action": Operator recommendation in ENGLISH.

            Return ONLY a JSON matching this exact structure:
            {{
              "status": "APPROVED|REJECTED|MANUAL_REVIEW",
              "risk_level": "LOW|MEDIUM|HIGH",
              "reason": "...",
              "next_action": "...",
              "checks": {{
                "profile_photo_is_valid_selfie": true|false,
                "face_match": true|false,
                "id_valid": true|false,
                "id_is_legible": true|false,
                "id_is_color_original": true|false,
                "id_is_screen_photo": true|false,
                "bank_details_match": true|false,
                "address_valid": true|false,
                "criminal_record_valid": true|false,
                "criminal_record_is_clean": true|false,
                "work_rights_valid": true|false,
                "manual_share_code_check": true|false,
                "manual_criminal_code_check": true|false
              }},
              "extracted_data": {{
                "detected_id_type": "PASSPORT|DRIVING_LICENCE|NATIONAL_ID|UNKNOWN",
                "name_on_address_proof": "...",
                "background_check_date": "YYYY-MM-DD or null",
                "criminal_convictions_found": "None or details",
                "id_expiry_date": "YYYY-MM-DD or null"
              }}
            }}
            """

        elif country == "ES":
            prompt = f"""
        You are a senior compliance auditor for Oscar app in SPAIN (ES).
        Target worker: "{registered_name}", IBAN: "{registered_iban}". Current date: {today_str}.

        MANDATORY DOCUMENTS REQUIRED FOR SPAIN (ES) - ONLY THESE 4:
        1. PROFILE PICTURE:
        - Must be a genuine, authentic selfie (front-facing face, natural angle).
        - Reject full-body photos, cropped photos of another screen, or photos of physical document cards.
        - Must match the person shown in the identity document.

        2. IDENTITY DOCUMENT (COLOR PHOTO MANDATORY):
        - Accepted types: DNI, NIE, or Passport.
        - MUST be an authentic physical color photograph.
        - REJECT: Black & white photos, photocopies, scans, digital screenshots, or PDF prints.
        - NO MIRROR / FLIPPED DOCUMENTS: The text must NOT be flipped horizontally or mirrored.
        - Must be unexpired relative to {today_str}.
        - Name must match "{registered_name}".

        3. PROOF OF ADDRESS (EMPADRONAMIENTO OR UTILITY BILL):
        - Accepted: Certificado de Empadronamiento in Spain OR Utility Bills (electricity, water, gas).
        - Name must match "{registered_name}".
        - Issue date MUST be within the last 6 months from {today_str} (or within the validity period stated on the document).

        4. BANK / IBAN PROOF:
        - Must clearly show the account holder name matching "{registered_name}".
        - Must clearly show the complete IBAN matching "{registered_iban}".
        - ATM receipts or documents without the holder's name are strictly INVALID.

        CRITICAL POLICY FOR SPAIN (ES):
        - CRIMINAL RECORD IS NOT REQUIRED IN SPAIN. Do NOT request or expect a criminal record. Always set "criminal_record_valid": true and "criminal_record_is_clean": true for Spain.
        - RESIDENCE PERMIT / CPLP IS NOT REQUIRED IN SPAIN. Always set "residence_permit_valid": true.

        LANGUAGE & NATIONALITY CHECK (SPANISH OR PORTUGUESE ACCEPTED):
        - Spanish-speaking countries include: Spain, Argentina, Colombia, Venezuela, Peru, Chile, Ecuador, Cuba, Dominican Republic, Mexico, Uruguay, Bolivia, Paraguay, Guatemala, Honduras, El Salvador, Nicaragua, Costa Rica, Panama, Equatorial Guinea.
        - Portuguese-speaking countries (CPLP) include: Portugal, Brazil, Angola, Mozambique, Cape Verde, Guinea-Bissau, São Tomé and Príncipe, East Timor.
        - Both Spanish and Portuguese speakers are accepted in Spain without needing a phone call.
        - Detect the technician's nationality from declared nationality or identity document.
        - If technician is from a country where NEITHER Spanish NOR Portuguese is an official/native language (e.g., Pakistan, India, Nepal, Morocco, Bangladesh, etc.):
        - Set "language_check_required": true.
        - If there are no blocking document rejections (status would otherwise be APPROVED), force status to "MANUAL_REVIEW".
        - "next_action" MUST explicitly be: "Need to call this technician to check if they speak ES or PT".
        - If technician is from a native Spanish OR Portuguese speaking country:
        - Set "language_check_required": false.

        Return JSON adhering to the required schema:
        {{
        "status": "APPROVED" | "REJECTED" | "MANUAL_REVIEW",
        "reason": "English explanation of decisions",
        "next_action": "English action for operations team",
        "checks": {{
            "profile_photo_is_valid_selfie": true|false,
            "face_matches_id": true|false,
            "id_valid": true|false,
            "id_is_color_photo": true|false,
            "id_is_legible": true|false,
            "address_valid": true|false,
            "iban_number_match": true|false,
            "bank_details_match": true|false,
            "criminal_record_valid": true,
            "criminal_record_is_clean": true,
            "residence_permit_valid": true,
            "documents_upright_orientation": true|false
        }}
        }}
        """

        else:  # PORTUGAL (PT)
            prompt = f"""
            You are a legal compliance screening officer for the Oscar platform onboarding in PORTUGAL.
            Audit Date: {today_str}.
            Registered Name: "{registered_name}".
            Registered IBAN in dashboard: "{registered_iban}".
            Registered NIF: "{registered_nif}".
            Declared Nationality: "{nationality}".
            Selected ID Type: "{id_type_selected}".

            LANGUAGE RULE:
            - ALL explanations, reasons, and actions MUST be written strictly in ENGLISH.

            NAME MATCHING POLICY:
            - If at least 2 primary names/surnames match between document and "{registered_name}", consider it a VALID NAME MATCH.

            COMPLIANCE RULES (PORTUGAL):
            1. LANGUAGE & NATIONALITY CHECK (PORTUGUESE OR SPANISH ACCEPTED):
               - Portuguese-speaking countries (CPLP) include: Portugal, Brazil, Angola, Mozambique, Cape Verde, Guinea-Bissau, São Tomé and Príncipe, East Timor.
               - Spanish-speaking countries include: Spain, Argentina, Colombia, Venezuela, Peru, Chile, Ecuador, Cuba, Dominican Republic, Mexico, Uruguay, Bolivia, Paraguay, Guatemala, Honduras, El Salvador, Nicaragua, Costa Rica, Panama, Equatorial Guinea.
               - Both Portuguese and Spanish speakers are accepted in Portugal without needing a phone call.
               - Detect the technician's nationality from declared nationality or identity document.
               - If technician is from a country where NEITHER Portuguese NOR Spanish is an official/native language (e.g., Pakistan, India, Nepal, Morocco, Bangladesh, etc.):
                 * Set "language_check_required": true.
                 * If there are no blocking document rejections (status would otherwise be APPROVED), force status to "MANUAL_REVIEW".
                 * "next_action" MUST explicitly be: "Need to call this technician to check if they speak PT or ES".
               - If technician is from a native Portuguese OR Spanish speaking country:
                 * Set "language_check_required": false.

            2. PROFILE PHOTO: Direct authentic selfie required. Reject screen captures or physical photos.
            3. IDENTITY DOCUMENT: Physical color photo, completely legible. Unexpired relative to {today_str}. Name must match "{registered_name}".
            3.5 MIRROR / FLIPPED EFFECT POLICY (STRICT):
                - Check the text orientation on all identity documents (DNI, NIE, Passport, Citizen Card, Residence Permit).
                - The document MUST NOT be mirrored, flipped horizontally, or written backwards (text reading right-to-left like a mirror selfie).
                - If the document is mirrored / flipped:
                    * Set "id_valid": false.
                    * Set "id_is_legible": false.
                    * Force status to "REJECTED" or "MANUAL_REVIEW".
                    * "reason" MUST state: "Identification document is mirrored / flipped horizontally (mirror selfie effect). Text must be readable normally from left to right."
                    * "next_action" MUST state: "Request new identification document (must not be mirrored or reversed)".
            4. CONDITIONAL PERMIT / RIGHT TO WORK (MANDATORY IF PASSPORT SUBMITTED):
               - IMPORTANT: Visas ("VISTO / VISA PORTUGAL PRT") are frequently stamped directly inside the passport booklet. Always inspect both the identification document pages and the residence permit document for a valid Portuguese visa sticker or AIMA receipt.
               - If an identity document other than a Portuguese Citizen Card (e.g., Passport) is submitted, the technician MUST provide at least ONE of the following valid permits:
                 a) CPLP Residence Certificate (Autorização de Residência CPLP) with valid date.
                 b) Manifestação de Interesse with valid date.
                 c) AIMA Receipt ("RECIBO COMPROVATIVO DE PEDIDO" from Agência para a Integração, Migrações e Asilo):
                    - Valid for Concessão or Renovação de Autorização de Residência (Arts. 78, 88, 89, 91, 98 or similar).
                    - Must clearly show AIMA header/logo, Process number ("Processo n.º"), applicant name matching "{registered_name}", and request date.
                 d) Portuguese Visa Sticker in Passport ("VISTO / VISA PORTUGAL PRT"):
                    - Check validity dates ("VÁLIDO PARA / FROM ... UNTIL ...").
                    - Must be unexpired relative to {today_str}.
                    - Name on the visa must match "{registered_name}".
               - If any of these 4 documents is present, valid, and unexpired:
                 * Set "residence_permit_valid": true.
               - If none of these documents is provided, or if the permit/visa is expired:
                 * Set "residence_permit_valid": false.
                 * Force status to "REJECTED" or "MANUAL_REVIEW".
                 * "reason" must explicitly state in English: "Foreign passport requires a valid CPLP certificate, Manifestação de Interesse, AIMA receipt, or unexpired Portuguese visa."
                 * "next_action" must state: "Request valid AIMA receipt, CPLP certificate, or unexpired visa".
            5. BANK / IBAN PROOF POLICY (STRICT):
                - The bank document (bank certificate, app screenshot, statement) MUST clearly display BOTH:
                1. The full account holder name (must match "{registered_name}").
                2. The complete IBAN number (must match the registered IBAN "{registered_iban}").
                - CRITICAL ATM / MULTIBANCO RECEIPT RULE:
                * ATM receipts ("talão Multibanco / comprovativo de multibanco") that only show the IBAN without the technician's name are INVALID.
                - IF the document lacks the holder's name, or the name does NOT match "{registered_name}", OR the IBAN numbers do not match:
                * Force "bank_details_match": false.
                * Force "iban_number_match": false.
                * Force status to "REJECTED".
                * Set "reason" explicitly stating if the name is missing/mismatched or if the IBAN digits differ.
                * Set "next_action" to: "Request valid bank document with account holder name and IBAN".
            6. PORTUGUESE NIF (9 digits): Must match "{registered_nif}".
            7. CRIMINAL RECORD (PT) - EVALUATION RULES:
               - First, inspect what document was actually submitted for "criminal_record":
                 a) If the document is NOT a Portuguese Criminal Record certificate (e.g., technician uploaded a utility bill, proof of address, ID photo, blank page, or wrong document):
                    * Set "criminal_record_valid": false.
                    * Set "criminal_record_is_clean": true (DO NOT accuse the technician of having convictions/crimes).
                    * "reason" must simply state: "Submitted document is not a Portuguese Criminal Record certificate (uploaded wrong document)".
                    * "next_action": "Request valid Portuguese Criminal Record".
                 b) If the document IS an official Portuguese DGAJ Criminal Record:
                    * Check expiration: Must be <= 90 days old from {today_str}. If older: set "criminal_record_valid": false, "criminal_record_is_clean": true, reason: "Criminal record expired".
                    * Check contents:
                      - If it clearly states "NADA CONSTA": set "criminal_record_valid": true, "criminal_record_is_clean": true.
                      - ONLY IF IT EXPLICITLY LISTS CHARGES, CRIMES, OR ACTIVE CONVICTIONS: set "criminal_record_valid": false, "criminal_record_is_clean": false, "status": "REJECTED", "risk_level": "HIGH", and state the exact convictions in "reason".
                 c) If no document was uploaded at all:
                    * Set "criminal_record_valid": false, "criminal_record_is_clean": true.
            8. ADDRESS PROOF: <= 6 months old relative to {today_str}.

            DECISION:
            - "status": "APPROVED|REJECTED|MANUAL_REVIEW".
            - "reason": Explanation strictly in ENGLISH.
            - "next_action": Recommendation strictly in ENGLISH (Must include "Need to call this technician to check if they speak PT or ES" if non-native speaker of both languages).

            Return ONLY a JSON matching this exact structure:
            {{
              "status": "APPROVED|REJECTED|MANUAL_REVIEW",
              "risk_level": "LOW|MEDIUM|HIGH",
              "reason": "...",
              "next_action": "...",
              "checks": {{
                "profile_photo_is_valid_selfie": true|false,
                "face_match": true|false,
                "nif_match": true|false,
                "id_valid": true|false,
                "id_is_legible": true|false,
                "id_is_color_original": true|false,
                "id_is_screen_photo": true|false,
                "residence_permit_valid": true|false,
                "iban_name_match": true|false,
                "iban_number_match": true|false,
                "iban_is_official": true|false,
                "address_valid": true|false,
                "criminal_record_valid": true|false,
                "criminal_record_is_clean": true|false,
                "language_check_required": true|false
              }},
              "extracted_data": {{
                "detected_nationality": "...",
                "detected_id_type": "PASSPORT|CITIZEN_CARD|RESIDENCE_CARD|UNKNOWN",
                "name_on_address_proof": "...",
                "name_on_criminal_record": "...",
                "criminal_convictions_found": "None or specify crimes",
                "extracted_nif": "...",
                "iban_holder_name": "...",
                "extracted_iban": "...",
                "id_expiry_date": "YYYY-MM-DD or null",
                "address_doc_date": "YYYY-MM-DD or null",
                "criminal_record_date": "YYYY-MM-DD or null"
              }}
            }}
            """

        contents = [prompt]
        docs_attached = 0
        headers = {"User-Agent": "Mozilla/5.0"}

        for name, url in docs.items():
            if url and str(url).startswith("http"):
                try:
                    r = requests.get(url, headers=headers, timeout=20)
                    if r.status_code == 200:
                        mime = r.headers.get("Content-Type", "").split(";")[0]
                        if not mime or mime == "application/octet-stream":
                            mime = "application/pdf" if str(url).lower().endswith(".pdf") else "image/jpeg"
                        contents.append(f"Attached Document [{name}]:")
                        contents.append(types.Part.from_bytes(data=r.content, mime_type=mime))
                        docs_attached += 1
                except Exception as e:
                    print(f"Error fetching {name}: {e}")

        if docs_attached == 0:
            return jsonify({
                "status": "MANUAL_REVIEW",
                "risk_level": "HIGH",
                "reason": "No valid document links found in technician profile.",
                "next_action": "Review documents manually",
                "checks": {
                    "profile_photo_is_valid_selfie": False,
                    "face_match": False,
                    "id_valid": False,
                    "id_is_legible": False,
                    "address_valid": False,
                    "criminal_record_valid": False,
                    "phone_prefix_valid": True
                }
            }), 200

        # LLAMADA A GEMINI
        response = None
        last_err = None
        for attempt in range(3):
            try:
                response = client.models.generate_content(
                    model="gemini-3.8-flash",
                    contents=contents,
                    config=types.GenerateContentConfig(
                        response_mime_type="application/json",
                        temperature=0.0
                    )
                )
                if response and response.text:
                    break
            except Exception as e:
                last_err = e
                err_str = str(e)
                if any(k in err_str for k in ["503", "UNAVAILABLE", "high demand", "overloaded"]):
                    time.sleep((attempt + 1) * 2)
                    continue
                else:
                    raise e

        if not response:
            raise last_err

        clean_json = response.text.replace("```json", "").replace("```", "").strip()
        result = json.loads(clean_json)

        # Inyectar el check de teléfono válido
        if "checks" not in result:
            result["checks"] = {}
        result["checks"]["phone_prefix_valid"] = True

        # =========================================================================
        # REGLA ANTECEDENTES PENALES (DISTINCIÓN: FALTA DOC VS REGISTRO SUCIO)
        # =========================================================================
        has_criminal_record_doc = bool(docs.get("criminal_record"))
        if has_criminal_record_doc:
            crime_found = result.get("extracted_data", {}).get("criminal_convictions_found", "")
            crimes_detected = crime_found and crime_found.lower() not in ["none", "null", "undefined", "clean", "nada consta", "no convictions"]

            if result.get("checks", {}).get("criminal_record_is_clean") is False or crimes_detected:
                result["status"] = "REJECTED"
                result["risk_level"] = "HIGH"
                result["checks"]["criminal_record_valid"] = False
                result["checks"]["criminal_record_is_clean"] = False
                result["reason"] = f"CRITICAL: Criminal record contains convictions/charges: {crime_found or 'Active charges'}. Zero-tolerance policy."
                result["next_action"] = "REJECT TECHNICIAN - Criminal record contains convictions."
            else:
                result["checks"]["criminal_record_is_clean"] = True
        else:
            result["checks"]["criminal_record_is_clean"] = None
            result["checks"]["criminal_record_valid"] = False
            if country in ["PT", "UK"]:
                result["status"] = "REJECTED"
                result["reason"] = "Background check / Criminal record is missing."
                result["next_action"] = "Request background check document."

        # Regla de legibilidad Stripe
        if result.get("checks", {}).get("id_is_legible") is False:
            result["status"] = "REJECTED"
            result["risk_level"] = "HIGH"
            result["checks"]["id_valid"] = False

        # Reglas UK: Share Code
        if country == "UK":
            is_british_or_irish = "british" in nationality or "irish" in nationality
            detected_id = str(result.get("extracted_data", {}).get("detected_id_type", "")).upper()
            is_passport = ("PASSPORT" in id_type_selected) or ("PASSPORT" in detected_id)

            if not is_british_or_irish and is_passport:
                if not work_share_code:
                    result["status"] = "REJECTED"
                    result["risk_level"] = "HIGH"
                    result["checks"]["work_rights_valid"] = False
                    result["reason"] = "Foreign technician submitted passport but is missing mandatory UK Work Share Code."
                    result["next_action"] = "Request UK Work Share Code"
                else:
                    result["checks"]["work_rights_valid"] = True
                    result["checks"]["manual_share_code_check"] = True
                    if result["status"] == "APPROVED":
                        result["status"] = "MANUAL_REVIEW"
                        result["reason"] = f"Foreign passport with Work Share Code ({work_share_code}). Manual check required."
            elif not is_british_or_irish and not is_passport:
                result["checks"]["work_rights_valid"] = True
                if work_share_code:
                    result["checks"]["manual_share_code_check"] = True

        # Validación tolerante de IBAN para ES y PT
        if country in ["ES", "PT"]:
            def limpiar_iban(cadena):
                if not cadena: return ""
                s = "".join(c for c in str(cadena).upper() if c.isalnum())
                if len(s) > 2:
                    prefijo = s[:2]
                    cuerpo = s[2:].replace("O", "0").replace("I", "1").replace("L", "1")
                    s = prefijo + cuerpo
                return s

            def extraer_digitos(cadena):
                return "".join(c for c in cadena if c.isdigit())

            iban_dashboard = limpiar_iban(registered_iban)
            iban_doc = limpiar_iban(result.get("extracted_data", {}).get("extracted_iban", ""))

            num_dash = extraer_digitos(iban_dashboard)
            num_doc = extraer_digitos(iban_doc)

            es_match = False
            if iban_doc and iban_dashboard:
                if iban_doc == iban_dashboard:
                    es_match = True
                elif len(num_dash) >= 15 and len(num_doc) >= 15:
                    if num_dash == num_doc or num_dash in num_doc or num_doc in num_dash:
                        es_match = True

            if es_match:
                result["checks"]["iban_number_match"] = True
                result["checks"]["iban_is_official"] = True
            else:
                if iban_doc and iban_dashboard and len(iban_dashboard) >= 10:
                    result["status"] = "REJECTED"
                    result["risk_level"] = "HIGH"
                    result["checks"]["iban_number_match"] = False
                    result["reason"] = f"IBAN mismatch: Document shows {iban_doc} but dashboard has {iban_dashboard}."
                    result["next_action"] = "Reject or request updated IBAN proof matching the dashboard number."

        return jsonify(result), 200

    except Exception as e:
        traceback.print_exc()
        return jsonify({
            "status": "MANUAL_REVIEW",
            "risk_level": "HIGH",
            "reason": f"Server processing error: {str(e)}",
            "next_action": "Check Python terminal traceback",
            "checks": {}
        }), 200

if __name__ == "__main__":
    print("Screening Server running on http://0.0.0.0:5005")
    app.run(host="0.0.0.0", port=5005, debug=True)