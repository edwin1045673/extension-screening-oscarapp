from flask import Flask, request, jsonify
from flask_cors import CORS
from google import genai
from google.genai import types
from datetime import datetime
import requests
import json
import time
import os

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "AQ.Ab8RN6IFPmg27aH5_rdM6iPfa7qO6iPMLtRWw0EtWQEwvCvLCA")
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
        data = request.json or {}
        # Garantir que todos os campos têm valor por omissão em string
        country = str(data.get("operatingCountry") or "PT").upper().strip()
        if "UK" in country or "UNITED KINGDOM" in country:
            country = "UK"
        elif "ES" in country or "SPAIN" in country:
            country = "ES"
        else:
            country = "PT"

        registered_name = str(data.get("registeredName") or "Not specified")
        registered_phone = str(data.get("registeredPhone") or "").strip()
        registered_iban = str(data.get("registeredIban") or "").strip().replace(" ", "").upper()
        registered_nif = str(data.get("registeredNif") or "").strip().replace(" ", "").replace("/", "")
        id_type_selected = str(data.get("idTypeSelected") or "").upper()
        
        nationality = str(data.get("nationality") or "").lower()
        sort_code = str(data.get("sortCode") or "").strip().replace(" ", "").replace("-", "")
        account_number = str(data.get("accountNumber") or "").strip().replace(" ", "")
        work_share_code = str(data.get("workShareCode") or "").strip()

        # ... (Restante código da validação e chamada Gemini) ...

    except Exception as e:
        import traceback
        traceback.print_exc()  # Imprime o erro completo na tua consola Python
        return jsonify({
            "status": "MANUAL_REVIEW",
            "risk_level": "HIGH",
            "reason": f"Server processing error: {str(e)}",
            "next_action": "Check Python terminal traceback",
            "checks": {}
        }), 200  # Devolvemos 200 com o detalhe para a extensão não crashar

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
        })

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
    # REGLAS REINO UNIDO (UK)
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
           - A) LEGIBILITY & FOCUS: Must be sharp, clear, and completely legible. If blurry, unreadable or obstructed by glare: set id_is_legible = false, id_valid = false, status = REJECTED, reason = "Identity document is blurry or unreadable".
           - B) PHYSICAL COLOR PHOTO ONLY: Direct photo of physical document. Strictly REJECT digital screen photos and B&W copies.
           - C) British or Irish ({is_british_or_irish} = True): Must submit valid British/Irish PASSPORT.
           - D) Foreigner ({is_british_or_irish} = False): Can submit Passport, National ID or Driving Licence. If National ID or Driving Licence submitted (NOT passport), the BACK [citizen_card_back] is STRICTLY MANDATORY.
           - Must be unexpired relative to {today_str}.

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

    # =========================================================================
    # REGLAS ESPAÑA (ES)
    # =========================================================================
    elif country == "ES":
        prompt = f"""
        You are a legal compliance screening officer for the Oscar platform onboarding in SPAIN.
        Audit Date: {today_str}.
        Registered Name: "{registered_name}".
        Registered IBAN in dashboard: "{registered_iban}".

        NAME MATCHING POLICY:
        - If at least 2 primary names/surnames match between document and "{registered_name}", consider it a VALID NAME MATCH.

        COMPLIANCE RULES (SPAIN):
        1. PROFILE PHOTO: Direct, authentic selfie required. Reject photos of paper photos or screen captures.
        2. IDENTITY DOCUMENT: Sharp, legible, physical color photo of DNI/NIE/Passport. Unexpired. Name must match "{registered_name}".
        3. BANK PROOF (iban_proof): Official banking document. Name and IBAN must match "{registered_iban}".
        4. PROOF OF ADDRESS: Utility bill or Empadronamiento <= 6 months old.
        5. Criminal record, CPLP, and Portuguese NIF not required.

        DECISION:
        - "status": "APPROVED|REJECTED|MANUAL_REVIEW".
        - "reason": Explanation in ENGLISH.
        - "next_action": Recommendation in ENGLISH.

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
            "address_valid": true|false,
            "iban_name_match": true|false,
            "iban_number_match": true|false,
            "iban_is_official": true|false,
            "residence_permit_valid": true,
            "criminal_record_valid": true,
            "criminal_record_is_clean": true,
            "nif_match": true
          }},
          "extracted_data": {{
            "detected_id_type": "DNI|NIE|PASSPORT|UNKNOWN",
            "name_on_address_proof": "...",
            "iban_holder_name": "...",
            "extracted_iban": "...",
            "address_doc_date": "YYYY-MM-DD or null",
            "id_expiry_date": "YYYY-MM-DD or null"
          }}
        }}
        """

    # =========================================================================
    # REGLAS PORTUGAL (PT)
    # =========================================================================
    else:
        prompt = f"""
        You are a legal compliance screening officer for the Oscar platform onboarding in PORTUGAL.
        Audit Date: {today_str}.
        Registered Name: "{registered_name}".
        Registered IBAN in dashboard: "{registered_iban}".
        Registered NIF: "{registered_nif}".
        Selected ID Type: "{id_type_selected}".

        NAME MATCHING POLICY:
        - If at least 2 primary names/surnames match between document and "{registered_name}", consider it a VALID NAME MATCH.

        COMPLIANCE RULES (PORTUGAL):
        1. PROFILE PHOTO: Direct authentic selfie required. Reject screen captures or physical photos.
        2. IDENTITY DOCUMENT: Physical color photo, completely legible. Unexpired. Name must match "{registered_name}".
        3. CONDITIONAL PERMIT: Valid CPLP or Manifestação mandatory if Passport submitted.
        4. BANK PROOF: Official bank document. Name and IBAN must match "{registered_iban}".
        5. PORTUGUESE NIF (9 digits): Must match "{registered_nif}".
        6. CRIMINAL RECORD (PT) - ZERO-CONVICTION RULE:
           - Official Portuguese DGAJ <= 90 days old.
           - MUST state "NADA CONSTA". If ANY convictions/crimes detected: set criminal_record_is_clean = false, criminal_record_valid = false, status = REJECTED, risk_level = HIGH.
        7. ADDRESS PROOF: <= 6 months old.

        DECISION:
        - "status": "APPROVED|REJECTED|MANUAL_REVIEW".
        - "reason": Explanation in ENGLISH.
        - "next_action": Recommendation in ENGLISH.

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
            "criminal_record_is_clean": true|false
          }},
          "extracted_data": {{
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
        })

    try:
        response = None
        last_err = None
        max_retries = 3

        for attempt in range(max_retries):
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
                    wait_time = (attempt + 1) * 2
                    print(f"Demanda alta (503). Reintentando en {wait_time}s...")
                    time.sleep(wait_time)
                    continue
                else:
                    raise e

        if not response:
            raise last_err

        clean_json = response.text.replace("```json", "").replace("```", "").strip()
        result = json.loads(clean_json)

        # Inyectar el check de teléfono válido
        result["checks"]["phone_prefix_valid"] = True

        # -------------------------------------------------------------
        # Comprobación de existencia del documento criminal
        # -------------------------------------------------------------
        has_criminal_record_doc = bool(docs.get("criminal_record"))

        # Regla estricta en Python: Antecedentes penales sucios (Zero Tolerance)
        # SOLO se considera "sucio" si el documento realmente existe y se detectaron cargos.
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
            # Si NO subió el documento: NO es un registro criminal sucio, simplemente falta el documento.
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

        # Doble validación en Python para UK
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
                    result["reason"] = f"IBAN number mismatch: Document shows {iban_doc} but dashboard has {iban_dashboard}."
                    result["next_action"] = "Reject or request updated IBAN proof matching the dashboard number."

        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5005, debug=True)