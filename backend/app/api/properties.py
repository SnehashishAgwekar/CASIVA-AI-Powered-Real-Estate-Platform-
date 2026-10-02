from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database.connection import get_db
from app.database.models import PropertyModel, PropertyInterest, UserModel
from app.core.security import get_current_user
from app.core.new_sender import notify_broker

router = APIRouter()


@router.get("")
@router.get("/")
def list_properties(
    city: Optional[str] = None,
    builder_name: Optional[str] = None,
    property_name: Optional[str] = None,
    bhk: Optional[int] = Query(None, ge=0, le=50),
    listing_type: Optional[str] = Query(None, pattern="^(Sale|Rent)$"),
    sort: str = Query("relevance", pattern="^(relevance|price_asc|price_desc)$"),
    current_user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Every property in the catalog, for the buyer-facing Property Explorer
    dashboard. Supports locality/project/builder/BHK/listing-type filtering
    and price sorting; 'relevance' falls back to newest-first.
    """
    query = db.query(PropertyModel)
    if city:
        query = query.filter(PropertyModel.city.ilike(f"%{city}%"))
    if builder_name:
        query = query.filter(PropertyModel.builder_name.ilike(f"%{builder_name}%"))
    if property_name:
        query = query.filter(PropertyModel.property_name.ilike(f"%{property_name}%"))
    if bhk is not None:
        query = query.filter(PropertyModel.bhk == bhk)
    if listing_type:
        query = query.filter(PropertyModel.listing_type == listing_type)

    if sort == "price_asc":
        query = query.order_by(PropertyModel.price_in_inr.asc())
    elif sort == "price_desc":
        query = query.order_by(PropertyModel.price_in_inr.desc())
    else:
        query = query.order_by(PropertyModel.created_at.desc())

    return query.all()


@router.get("/filters")
def list_property_filters(
    current_user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Distinct localities/builders currently in the catalog, for filter dropdowns."""
    cities = [
        row[0] for row in db.query(PropertyModel.city).distinct().order_by(PropertyModel.city).all()
        if row[0]
    ]
    builders = [
        row[0] for row in db.query(PropertyModel.builder_name).distinct().order_by(PropertyModel.builder_name).all()
        if row[0]
    ]
    return {"cities": cities, "builders": builders}


def require_end_user(current_user: UserModel = Depends(get_current_user)) -> UserModel:
    if current_user.role != "user":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only user accounts can express interest in a listing",
        )
    return current_user


class InterestRequest(BaseModel):
    message: Optional[str] = Field(default=None, max_length=1000)


def _contact(u: Optional[UserModel]) -> dict:
    if u is None:
        return {"name": None, "email": None, "phone": None}
    return {"name": u.name, "email": u.email, "phone": u.phone_number}


@router.post("/{property_id}/interest", status_code=status.HTTP_201_CREATED)
def express_interest(
    property_id: int,
    payload: InterestRequest,
    background_tasks: BackgroundTasks,
    current_user: UserModel = Depends(require_end_user),
    db: Session = Depends(get_db),
):
    """
    A user taps "Interested" on a broker's listing. Records the interest (once
    per user+property) and hands the user the broker's contact details. The
    broker picks the same record up from GET /api/v1/broker/leads.
    """
    prop = db.query(PropertyModel).filter(PropertyModel.id == property_id).first()
    if prop is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Property not found")
    if not prop.broker_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This listing is not linked to a broker, so there is no one to contact.",
        )

    broker = db.query(UserModel).filter(UserModel.id == prop.broker_id).first()
    if not broker:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="The assigned broker could not be found.",
        )

    existing = (
        db.query(PropertyInterest)
        .filter(
            PropertyInterest.property_id == property_id,
            PropertyInterest.user_id == current_user.id,
        )
        .first()
    )
    if existing is None:
        interest = PropertyInterest(
            property_id=property_id,
            user_id=current_user.id,
            broker_id=prop.broker_id,
            message=(payload.message or None),
        )
        db.add(interest)
        db.commit()
    elif payload.message:
        existing.message = payload.message
        db.commit()

        # Notify the broker (SMS + WhatsApp + email; fire-and-forget) on the
        # broker's own registered contact details only. Only on a NEW
        # interest, not on repeat taps.
        background_tasks.add_task(
            notify_broker,
            broker_phone=broker.phone_number if broker else None,
            broker_email=broker.email if broker else None,
            user_name=current_user.name,
            property_name=prop.property_name,
            user_phone=current_user.phone_number,
            user_email=current_user.email,
        )
    # Notify the broker (SMS + WhatsApp + email; fire-and-forget) on the
    # broker's own registered contact details whenever a user clicks "I'm interested".
    background_tasks.add_task(
        notify_broker,
        broker_phone=broker.phone_number if broker else None,
        broker_email=broker.email if broker else None,
        user_name=current_user.name,
        property_name=prop.property_name,
        user_phone=current_user.phone_number,
        user_email=current_user.email,
    )

    return {
        "property_id": prop.id,
        "property_name": prop.property_name,
        "already_registered": existing is not None,
        # The user's half of the exchange: the broker's contact details.
        "broker": _contact(broker),
        "notice": (
            f"The broker has been notified that you're interested in "
            f"\"{prop.property_name}\" and now has your contact details. "
            "You can also reach out to them directly using the details above."
        ),
    }


@router.get("/my-interests")
def my_interests(
    current_user: UserModel = Depends(require_end_user),
    db: Session = Depends(get_db),
):
    """Listings this user has tapped 'Interested' on, with the broker contact."""
    rows = (
        db.query(PropertyInterest, PropertyModel, UserModel)
        .join(PropertyModel, PropertyInterest.property_id == PropertyModel.id)
        .join(UserModel, PropertyInterest.broker_id == UserModel.id)
        .filter(PropertyInterest.user_id == current_user.id)
        .order_by(PropertyInterest.created_at.desc())
        .all()
    )
    return [
        {
            "interest_id": interest.id,
            "created_at": interest.created_at,
            "property_id": prop.id,
            "property_name": prop.property_name,
            "city": prop.city,
            "location": prop.location,
            "price_in_inr": prop.price_in_inr,
            "listing_type": prop.listing_type,
            "bhk": prop.bhk,
            "area_sqft": prop.area_sqft,
            "area_unit": prop.area_unit,
            "property_type": prop.property_type,
            "availability_status": prop.availability_status,
            "image_urls": prop.image_urls or [],
            "broker": _contact(broker),
        }
        for (interest, prop, broker) in rows
    ]
