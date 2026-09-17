from typing import Optional
from urllib.parse import urlparse

from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from starlette.concurrency import run_in_threadpool
from app.services.room_classifier import classify_room
from app.services.bhk_verifier import verify_bhk
from app.services.link_verifier import MAX_SCRAPED_CHARS, scrape_listing_url, verify_listing_against_photos

router = APIRouter(prefix="/api/v1", tags=["Verification"])

MAX_LINK_VERIFY_IMAGES = 12


@router.post("/verify-property")
async def verify_property(
    claimed_bhk: int = Form(...),
    images: list[UploadFile] = File(...)
):
    if not images:
        raise HTTPException(status_code=400, detail="No images provided.")
    if len(images) > 12:
        raise HTTPException(status_code=400, detail="Maximum limit of 12 images exceeded.")

    classified_results = []

    for idx, img in enumerate(images):
        if not img.content_type or not img.content_type.startswith("image/"):
            raise HTTPException(status_code=400, detail=f"File {img.filename} is not a valid image.")

        image_bytes = await img.read()

        try:
            result = await run_in_threadpool(classify_room, image_bytes)
            # Inject bytes and index for the downstream deduplicator pipeline
            result["image_bytes"] = image_bytes
            result["photo_index"] = idx + 1
            classified_results.append(result)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Error processing image {img.filename}: {str(e)}")

    verdict = await run_in_threadpool(verify_bhk, classified_results, claimed_bhk)

    # Clear heavy image bytes from memory before returning the JSON response
    for room in verdict.get("all_detected_rooms", []):
        room.pop("image_bytes", None)

    return {
        "verdict": verdict,
        "images_analyzed": len(images)
    }


@router.post("/verify-property-link")
async def verify_property_link(
    property_url: str = Form(...),
    images: list[UploadFile] = File(...),
    pasted_description: Optional[str] = Form(None),
):
    parsed = urlparse(property_url.strip())
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise HTTPException(status_code=422, detail="Please enter a valid http(s) listing URL.")

    if not images:
        raise HTTPException(status_code=400, detail="No images provided.")
    if len(images) > MAX_LINK_VERIFY_IMAGES:
        raise HTTPException(status_code=400, detail=f"Maximum limit of {MAX_LINK_VERIFY_IMAGES} images exceeded.")

    image_payload = []
    for idx, img in enumerate(images):
        if not img.content_type or not img.content_type.startswith("image/"):
            raise HTTPException(status_code=400, detail=f"File {img.filename} is not a valid image.")
        image_bytes = await img.read()
        image_payload.append({"photo_index": idx + 1, "image_bytes": image_bytes, "mime_type": img.content_type})

    # Some listing portals (Cloudflare/WAF-protected sites in particular) hard-block
    # every automated fetcher, Tavily included. Let the user paste the listing text
    # themselves instead of failing outright, so the feature still works for those.
    pasted = (pasted_description or "").strip()
    if pasted:
        scraped_text = pasted[:MAX_SCRAPED_CHARS]
    else:
        try:
            scraped_text = await scrape_listing_url(parsed.geturl())
        except ValueError as e:
            raise HTTPException(status_code=422, detail={"error": "scrape_failed", "message": str(e)})

    try:
        result = await run_in_threadpool(verify_listing_against_photos, scraped_text, image_payload)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI comparison failed: {str(e)}")

    return {
        "property_url": parsed.geturl(),
        "images_analyzed": len(images),
        "used_pasted_description": bool(pasted),
        "result": result.model_dump(),
    }
