# ============================================================
# new_sender.py
# ============================================================
# Handles:
#
#   SMS       -> TextBee
#   WhatsApp  -> WaSender
#   Email     -> Resend
#
# ============================================================
import logging
import os
from pathlib import Path
import re
import requests
import resend
from dotenv import load_dotenv

from app.core.template import (
    broker_interest_sms,
    broker_interest_whatsapp,
    broker_property_whatsapp,
    broker_interest_email,
)

logger = logging.getLogger("estateagent.sender")

# ============================================================
# LOAD .ENV
# ============================================================
load_dotenv()
_ROOT_DIR = Path(__file__).resolve().parent.parent.parent.parent
_env_file = _ROOT_DIR / ".env"
if _env_file.exists():
    load_dotenv(dotenv_path=_env_file)
else:
    load_dotenv()

# ============================================================
# CONFIGURATION
# ============================================================
TEXTBEE_API_URL = "https://api.textbee.dev/api/v1/gateway/send-bulk-sms"
TEXTBEE_SEND_SMS_URL = "https://api.textbee.dev/api/v1/gateway/send-sms"
TEXTBEE_BULK_SMS_URL = "https://api.textbee.dev/api/v1/gateway/send-bulk-sms"
TEXTBEE_DEVICE_ID = os.getenv("TEXTBEE_DEVICE_ID", "6aa25227ccb6c72709ca8558")
WASENDER_API_URL = "https://www.wasenderapi.com/api/send-message"
RESEND_FROM_EMAIL = os.getenv("RESEND_FROM_EMAIL", "onboarding@resend.dev")
DEFAULT_COUNTRY_CODE = os.getenv("SMS_DEFAULT_COUNTRY_CODE", "+91")


def normalize_phone(raw: str | None) -> str | None:
    """Best-effort E.164 phone formatting."""
    if not raw:
        return None
    s = re.sub(r"[^\d+]", "", raw.strip())
    s = re.sub(r"[^\d+]", "", str(raw).strip())
    if not s:
        return None
    if s.startswith("+"):
        return s
    if s.startswith("00"):
        return "+" + s[2:]
    # Strip single leading zero if 11 digits (e.g. 09876543210 -> 9876543210)
    if s.startswith("0") and len(s) == 11:
        s = s[1:]
    if len(s) == 10:
        return f"{DEFAULT_COUNTRY_CODE}{s}"
    if s.startswith("91") and len(s) == 12:
        return f"+{s}"
    return f"+{s}"


# ============================================================
# ENVIRONMENT VARIABLE HELPER
# ============================================================
def get_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise ValueError(f"{name} is not set in the .env file.")
    return value


# ============================================================
# SMS
# ============================================================
def send_sms(
    phone: str,
    user_name: str,
    property_name: str,
    user_phone: str,
):
    api_key = get_env("TEXTBEE_API_KEY")
    target_phone = normalize_phone(phone) or phone
    message = broker_interest_sms(
        user_name=user_name,
        property_name=property_name,
        user_phone=user_phone,
    )
    device_id = os.getenv("TEXTBEE_DEVICE_ID", TEXTBEE_DEVICE_ID)
    headers = {
        "x-api-key": api_key,
        "Content-Type": "application/json",
    }
    
    # Primary: direct send-sms endpoint
    payload = {
        "deviceId": device_id,
        "messages": [
            {
                "recipients": [target_phone],
                "message": message,
            }
        ],
        "recipients": [target_phone],
        "message": message,
    }
    response = requests.post(
        TEXTBEE_API_URL,
        headers=headers,
        json=payload,
        timeout=30,
    )
    response.raise_for_status()
    return response.json()
    if device_id:
        payload["deviceId"] = device_id

    try:
        response = requests.post(
            TEXTBEE_SEND_SMS_URL,
            headers=headers,
            json=payload,
            timeout=30,
        )
        response.raise_for_status()
        return response.json()
    except Exception as exc:
        logger.warning("Primary TextBee send-sms failed (%s), attempting bulk-sms fallback", exc)
        bulk_payload = {
            "deviceId": device_id,
            "messages": [
                {
                    "recipients": [target_phone],
                    "message": message,
                }
            ],
        }
        fallback_resp = requests.post(
            TEXTBEE_BULK_SMS_URL,
            headers=headers,
            json=bulk_payload,
            timeout=30,
        )
        fallback_resp.raise_for_status()
        return fallback_resp.json()


# ============================================================
# WHATSAPP - GENERIC
# ============================================================
def send_whatsapp(
    phone: str,
    message: str,
):
    api_key = get_env("WASENDER_API_KEY")
    target_phone = normalize_phone(phone) or phone
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "to": target_phone,
        "text": message,
    }
    response = requests.post(
        WASENDER_API_URL,
        headers=headers,
        json=payload,
        timeout=30,
    )
    response.raise_for_status()
    return response.json()


# ============================================================
# WHATSAPP - PROPERTY ALERT
# ============================================================
def send_property_whatsapp(
    phone: str,
    property_name: str,
    location: str,
    price: str,
    area: str,
):
    message = broker_property_whatsapp(
        property_name=property_name,
        location=location,
        price=price,
        area=area,
    )
    return send_whatsapp(
        phone=phone,
        message=message,
    )


# ============================================================
# WHATSAPP - BROKER NOTIFICATION
# ============================================================
def send_broker_whatsapp(
    phone: str,
    user_name: str,
    property_name: str,
    user_phone: str,
):
    message = broker_interest_whatsapp(
        user_name=user_name,
        property_name=property_name,
        user_phone=user_phone,
    )
    return send_whatsapp(
        phone=phone,
        message=message,
    )


# ============================================================
# EMAIL
# ============================================================
def send_email(
    email: str,
    user_name: str,
    property_name: str,
    user_phone: str,
):
    api_key = get_env("RESEND_API_KEY")
    resend.api_key = api_key
    from_email = os.getenv("RESEND_FROM_EMAIL", RESEND_FROM_EMAIL)
    html_message = broker_interest_email(
        user_name=user_name,
        property_name=property_name,
        user_phone=user_phone,
    )
    response = resend.Emails.send(
        {
            "from": from_email,
            "to": [email],
            "subject": f"New Property Interest - {property_name}",
            "html": html_message,
        }
    )
    return response


# ============================================================
# NOTIFY BROKER
# ============================================================
def notify_broker(
    broker_phone: str | None,
    broker_email: str | None,
    user_name: str | None = None,
    property_name: str = "Property",
    user_phone: str | None = None,
    user_email: str | None = None,
):
    result = {
        "sms": None,
        "whatsapp": None,
        "email": None,
    }

    display_user_name = (user_name or "").strip() or "Interested Customer"
    contact_parts = []
    if user_phone and str(user_phone).strip():
        contact_parts.append(str(user_phone).strip())
    if user_email and str(user_email).strip() and (not user_phone or str(user_email).strip() not in str(user_phone)):
        contact_parts.append(str(user_email).strip())
    display_contact = " / ".join(contact_parts) if contact_parts else "Not provided"
    target_property_name = property_name or "Property"

    # --------------------------------------------------------
    # SMS (TextBee)
    # --------------------------------------------------------
    if broker_phone and str(broker_phone).strip():
        try:
            sms_resp = send_sms(
                phone=str(broker_phone).strip(),
                user_name=display_user_name,
                property_name=target_property_name,
                user_phone=display_contact,
            )
            result["sms"] = {
                "success": True,
                "response": sms_resp,
            }
            logger.info("SMS delivered to broker %s for %s", broker_phone, target_property_name)
            print(f"[SMS NOTIFICATION] Dispatched SMS to broker {broker_phone} for '{target_property_name}'")
        except Exception as e:
            logger.error("SMS notification to %s failed: %s", broker_phone, e)
            print(f"[SMS NOTIFICATION ERROR] Failed to send SMS to broker {broker_phone}: {e}")
            result["sms"] = {
                "success": False,
                "error": str(e),
            }
    else:
        print(f"[SMS NOTIFICATION] Skipped: No broker phone number provided ({broker_phone})")
        result["sms"] = {
            "success": False,
            "skipped": True,
            "reason": "Broker phone not provided",
        }

    # --------------------------------------------------------
    # WHATSAPP (WaSender)
    # --------------------------------------------------------
    if broker_phone and str(broker_phone).strip():
        try:
            wa_resp = send_broker_whatsapp(
                phone=str(broker_phone).strip(),
                user_name=display_user_name,
                property_name=target_property_name,
                user_phone=display_contact,
            )
            result["whatsapp"] = {
                "success": True,
                "response": wa_resp,
            }
            logger.info("WhatsApp delivered to broker %s for %s", broker_phone, target_property_name)
        except Exception as e:
            logger.error("WhatsApp notification to %s failed: %s", broker_phone, e)
            result["whatsapp"] = {
                "success": False,
                "error": str(e),
            }
    else:
        result["whatsapp"] = {
            "success": False,
            "skipped": True,
            "reason": "Broker phone not provided",
        }

    # --------------------------------------------------------
    # EMAIL (Resend)
    # --------------------------------------------------------
    if broker_email and str(broker_email).strip():
        try:
            email_resp = send_email(
                email=str(broker_email).strip(),
                user_name=display_user_name,
                property_name=target_property_name,
                user_phone=display_contact,
            )
            result["email"] = {
                "success": True,
                "response": email_resp,
            }
            logger.info("Email delivered to broker %s for %s", broker_email, target_property_name)
        except Exception as e:
            logger.error("Email notification to %s failed: %s", broker_email, e)
            result["email"] = {
                "success": False,
                "error": str(e),
            }
    else:
        result["email"] = {
            "success": False,
            "skipped": True,
            "reason": "Broker email not provided",
        }

    return result
