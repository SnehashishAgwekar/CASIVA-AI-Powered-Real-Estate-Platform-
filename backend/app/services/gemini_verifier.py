"""
Property room & BHK verification, powered by Gemini 3.6 Flash.

Replaces the old two-stage local pipeline (Places365 ResNet18 for room
classification + CLIP ViT-L-14 for same-room photo deduplication) with a
single multimodal Gemini call: it looks at every uploaded photo at once,
labels each one's room type, and groups together bedroom photos that show
the same physical room from a different angle. The final claimed-vs-detected
BHK comparison still happens in plain Python, not the model, so that number
is never something the LLM could get wrong.
"""
import base64
import os
from typing import Dict, List, Optional

from dotenv import load_dotenv
from langchain_core.messages import HumanMessage
from langchain_google_genai import ChatGoogleGenerativeAI
from pydantic import BaseModel, Field

from app.services.image_utils import compress_for_llm

load_dotenv()

ROOM_TYPES = ["bedroom", "bathroom", "kitchen", "living_room", "dining_room", "closet", "other"]


class RoomClassification(BaseModel):
    photo_index: int = Field(description="1-based index of the photo, matching the order it was given in")
    room_type: str = Field(description=f"Exactly one of: {', '.join(ROOM_TYPES)}")
    raw_scene: str = Field(description="A short 3-6 word description of what's actually visible, e.g. 'master bedroom with attached balcony'")
    confidence: float = Field(ge=0, le=1, description="Confidence in this room_type classification, 0.0 to 1.0")


class BedroomGroup(BaseModel):
    photo_indices: List[int] = Field(
        description="2+ photo indices (only ones classified as bedroom) that show the SAME physical "
        "bedroom photographed from a different angle or distance. Do not include a bedroom that only "
        "appears once — those simply aren't part of any group."
    )
    similarity: float = Field(ge=0, le=1, description="Confidence these photos are the same physical room, 0.0 to 1.0")


class PropertyVerification(BaseModel):
    rooms: List[RoomClassification]
    bedroom_groups: List[BedroomGroup] = Field(
        default_factory=list,
        description="Groups of bedroom photos depicting the same physical room. Omit bedrooms seen only once.",
    )
    low_confidence_note: Optional[str] = Field(
        default=None,
        description="If any room classification or duplicate-grouping call was genuinely uncertain, name "
        "the photo(s) and why in one sentence. Null if nothing was uncertain.",
    )


PROMPT_TEMPLATE = """You are a real-estate photo auditor. You are given {n} interior photograph(s) from one \
property listing, labeled #1 through #{n} in the order shown below.

For EACH photo, classify which type of room it shows, using exactly one of: {room_types}.

Then, among only the photos you classified as "bedroom", group together any photos that show the SAME \
physical bedroom photographed from a different angle, distance, or lighting (e.g. same bed, same window, \
same furniture layout). Only group when you are genuinely confident it's the same physical room — two \
different bedrooms that simply share a similar style or color scheme must NOT be grouped together. A \
bedroom that appears in only one photo should not be placed in any group.

Be conservative: only report high confidence when a classification or a duplicate grouping is visually \
obvious from the photo. If you're unsure about any photo or grouping decision, say so in low_confidence_note."""


def _model() -> ChatGoogleGenerativeAI:
    return ChatGoogleGenerativeAI(model="gemini-3.6-flash", api_key=os.getenv("GOOGLE_API_KEY"), temperature=0)


def _image_part(image_bytes: bytes, mime_type: str) -> dict:
    image_bytes, mime_type = compress_for_llm(image_bytes, mime_type)
    b64 = base64.b64encode(image_bytes).decode("utf-8")
    return {"type": "image_url", "image_url": f"data:{mime_type};base64,{b64}"}


def verify_property_with_gemini(images: List[Dict], claimed_bhk: int) -> dict:
    """
    images: [{"photo_index": int, "image_bytes": bytes, "mime_type": str}, ...]

    Returns the same verdict shape the app has always returned (claimed_bhk,
    raw_bedroom_photos, unique_bedrooms_detected, duplicate_groups, matches,
    confidence_note, low_confidence_warning, all_detected_rooms) so nothing
    downstream (the frontend audit report) needs to change.
    """
    n = len(images)
    content = [{"type": "text", "text": PROMPT_TEMPLATE.format(n=n, room_types=", ".join(ROOM_TYPES))}]
    for img in images:
        content.append({"type": "text", "text": f"Photo #{img['photo_index']}:"})
        content.append(_image_part(img["image_bytes"], img["mime_type"]))

    structured_llm = _model().with_structured_output(PropertyVerification)
    result: PropertyVerification = structured_llm.invoke([HumanMessage(content=content)])

    valid_indices = {img["photo_index"] for img in images}
    room_by_index = {r.photo_index: r for r in result.rooms if r.photo_index in valid_indices}

    all_detected_rooms = []
    for img in images:
        idx = img["photo_index"]
        r = room_by_index.get(idx)
        if r is not None:
            all_detected_rooms.append({
                "image_index": idx,
                "room_type": r.room_type if r.room_type in ROOM_TYPES else "other",
                "confidence": round(max(0.0, min(1.0, r.confidence)), 4),
                "raw_category": r.raw_scene,
            })
        else:
            # Defensive: Gemini skipped a photo — don't silently drop it from the audit.
            all_detected_rooms.append({
                "image_index": idx, "room_type": "other", "confidence": 0.0, "raw_category": "not classified",
            })

    bedroom_indices = {room["image_index"] for room in all_detected_rooms if room["room_type"] == "bedroom"}

    # Keep only groups whose members are photos we actually detected as
    # bedrooms — defends against the model naming a non-bedroom photo index.
    duplicate_groups = []
    grouped_indices = set()
    for g in result.bedroom_groups:
        members = sorted({i for i in g.photo_indices if i in bedroom_indices})
        if len(members) < 2:
            continue
        duplicate_groups.append({
            "photo_indices": members,
            "similarity": round(max(0.0, min(1.0, g.similarity)), 4),
        })
        grouped_indices.update(members)

    raw_bedrooms = len(bedroom_indices)
    # Each duplicate group of same-room photos counts as exactly one bedroom.
    unique_bedrooms = (raw_bedrooms - len(grouped_indices)) + len(duplicate_groups)

    matches = unique_bedrooms >= claimed_bhk
    confidence_note = (
        f"Detected {raw_bedrooms} total bedroom photo(s). After grouping same-room photos, "
        f"found {unique_bedrooms} distinct bedroom(s)."
    )

    return {
        "claimed_bhk": claimed_bhk,
        "raw_bedroom_photos": raw_bedrooms,
        "unique_bedrooms_detected": unique_bedrooms,
        "duplicate_groups": duplicate_groups,
        "matches": matches,
        "confidence_note": confidence_note,
        "low_confidence_warning": result.low_confidence_note or "",
        "all_detected_rooms": all_detected_rooms,
    }
