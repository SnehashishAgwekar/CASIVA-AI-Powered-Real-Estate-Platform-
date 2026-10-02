from typing import Optional
from urllib.parse import urlparse

from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from starlette.concurrency import run_in_threadpool
from app.services.gemini_verifier import verify_property_with_gemini
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

    image_payload = []
    for idx, img in enumerate(images):
        if not img.content_type or not img.content_type.startswith("image/"):
            raise HTTPException(status_code=400, detail=f"File {img.filename} is not a valid image.")
        image_bytes = await img.read()
        image_payload.append({"photo_index": idx + 1, "image_bytes": image_bytes, "mime_type": img.content_type})

    try:
        verdict = await run_in_threadpool(verify_property_with_gemini, image_payload, claimed_bhk)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI verification failed: {str(e)}")

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
