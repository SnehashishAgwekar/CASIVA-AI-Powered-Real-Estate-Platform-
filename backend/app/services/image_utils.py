import io

from PIL import Image

MAX_DIMENSION = 1024
JPEG_QUALITY = 85


def compress_for_llm(image_bytes: bytes, mime_type: str) -> tuple[bytes, str]:
    """
    Downscales and re-encodes an uploaded photo before sending it to a
    multimodal LLM call. Gemini tiles any image above ~768px per side into
    multiple tiles for tokenization, so a full-resolution phone photo (often
    3000-4000px) burns far more image tokens - and wall-clock latency per
    request - than a 1024px version the model classifies identically.
    Falls back to the original bytes if the file can't be decoded, so one
    unusual photo format never blocks the whole verification call.
    """
    try:
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    except Exception:
        return image_bytes, mime_type

    width, height = image.size
    scale = MAX_DIMENSION / max(width, height)
    if scale < 1:
        image = image.resize(
            (max(1, round(width * scale)), max(1, round(height * scale))),
            Image.LANCZOS,
        )

    buf = io.BytesIO()
    image.save(buf, format="JPEG", quality=JPEG_QUALITY)
    return buf.getvalue(), "image/jpeg"
