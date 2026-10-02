import os
import re
from typing import Tuple, Dict, Any, Optional
from langchain_google_genai import ChatGoogleGenerativeAI
from pydantic import BaseModel, Field
from dotenv import load_dotenv

load_dotenv()


class QueryExtraction(BaseModel):
    intent: str = Field(
        description="One of: 'sql_search' (looking for properties/flats/plots), "
        "'rag_search' (asking about a brochure/document, OR a RERA/legal/regulatory "
        "question -- possession delays, refunds, penalty interest, builder "
        "obligations, allottee rights, registration -- answerable from the indexed "
        "RERA Act text), 'web_search' (explicitly wants live web/market info), "
        "'general' (greeting, or a real-estate question not covered by any indexed "
        "document, e.g. EMI/loan basics or market trends)."
    )
    city: Optional[str] = Field(
        default=None, description="City name if mentioned, else null"
    )
    location: Optional[str] = Field(
        default=None,
        description="Specific locality / area / sector / road within the city "
        "if mentioned (e.g. 'Super Corridor', 'Vijay Nagar', 'Rau'), else null",
    )
    min_price: Optional[float] = Field(
        default=None, description="Minimum price in absolute INR rupees, else null"
    )
    max_price: Optional[float] = Field(
        default=None,
        description="Maximum price in absolute INR rupees. Convert units: "
        "'1.25 cr' or '1.25 crore' = 12500000; '80 lakh' = 8000000. Null if none.",
    )
    min_bhk: Optional[int] = Field(
        default=None, description="Number of bedrooms (BHK) if mentioned, else null"
    )
    bhk_or_more: bool = Field(
        default=False,
        description="True ONLY if the user explicitly wants that many bedrooms OR MORE "
        "(e.g. '3+ BHK', 'at least 3 BHK', '3 BHK or bigger'). A plain '3 BHK' is False.",
    )
    property_type: Optional[str] = Field(
        default=None,
        description="One of Apartment/Villa/Plot/Commercial/Independent House if "
        "clearly implied, else null",
    )
    listing_type: Optional[str] = Field(
        default=None,
        description="'Rent' if the user is looking to rent/lease, 'Sale' if they "
        "want to buy/purchase, else null if not stated.",
    )


llm = ChatGoogleGenerativeAI(model="gemini-3.6-flash", api_key=os.getenv("GOOGLE_API_KEY"))

# crude "1.25 cr" / "80 lakh" -> rupees, used only in the offline fallback
_UNIT = {"cr": 1_00_00_000, "crore": 1_00_00_000, "lakh": 1_00_000, "lac": 1_00_000}

_BHK_RE = re.compile(r"\b\d+(\.\d+)?\s*bhk\b", re.IGNORECASE)
_BUDGET_RE = re.compile(r"\b\d+(\.\d+)?\s*(crore|cr|lakh|lac)\b", re.IGNORECASE)
_SEARCH_VERB_RE = re.compile(
    r"\b(find|show|looking for|search for|suggest|list|browse|any\s+(?:new\s+)?"
    r"(?:flats?|apartments?|villas?|plots?|houses?|properties|listings?))\b",
    re.IGNORECASE,
)
_PROPERTY_NOUN_RE = re.compile(
    r"\b(flats?|apartments?|villas?|plots?|houses?|propert(?:y|ies)|listings?)\b",
    re.IGNORECASE,
)


def _looks_like_property_search(query: str) -> bool:
    """
    True only when the query is actually asking to FIND listings - a BHK
    count, a budget figure, or a search verb next to a property noun - not
    just any sentence that happens to mention "flat"/"property" in passing,
    like a RERA/legal/finance question ("what if the builder delays
    possession of the flat?"). Those must stay general/rag, not get forced
    into a database search.
    """
    if _BHK_RE.search(query) or _BUDGET_RE.search(query):
        return True
    return bool(_SEARCH_VERB_RE.search(query) and _PROPERTY_NOUN_RE.search(query))


_LEGAL_KEYWORDS_RE = re.compile(
    r"\brera\b|penalty interest|possession delay|delayed? possession|"
    r"builder liable|compensation|refund|\ballottee\b|registration authority|"
    r"builder[- ]buyer agreement|carpet area rule",
    re.IGNORECASE,
)


def _looks_like_legal_question(query: str) -> bool:
    """
    Catches RERA/legal/regulatory questions so they route to rag_search
    (grounded in the indexed RERA Act text) even if the router LLM labels
    them 'general' by default.
    """
    return bool(_LEGAL_KEYWORDS_RE.search(query))


_BHK_OR_MORE_RE = re.compile(
    r"\d+\s*\+\s*bhk|at\s*least\s*\d+|minimum\s*\d+|\d+\s*bhk\s*(or|and)\s*(more|above|bigger|larger)",
    re.IGNORECASE,
)


def _fallback_extract(query: str) -> Tuple[str, Dict[str, Any]]:
    """No-LLM heuristic: keep it minimal, never invent a city or budget."""
    q = query.lower()
    filters: Dict[str, Any] = {}

    m = re.search(r"(\d+)\s*(\+)?\s*bhk", q)
    if m:
        filters["min_bhk"] = int(m.group(1))
        if m.group(2) or _BHK_OR_MORE_RE.search(q):
            filters["bhk_or_more"] = True

    m = re.search(r"(\d+(?:\.\d+)?)\s*(crore|cr|lakh|lac)\b", q)
    if m:
        filters["max_price"] = float(m.group(1)) * _UNIT[m.group(2)]

    if re.search(r"\b(rent|rental|lease|to let)\b", q):
        filters["listing_type"] = "Rent"
    elif re.search(r"\b(buy|purchase|for sale)\b", q):
        filters["listing_type"] = "Sale"

    if _looks_like_property_search(query):
        intent = "sql_search"
    elif _looks_like_legal_question(query):
        intent = "rag_search"
    else:
        intent = "general"
    return intent, filters


def classify_intent_and_extract_params(query: str) -> Tuple[str, Dict[str, Any]]:
    structured_llm = llm.with_structured_output(QueryExtraction)
    prompt = (
        "You are a routing + extraction engine for a real-estate assistant. "
        "Classify the intent and extract ONLY what the user actually stated. "
        "Do NOT guess a city, locality or budget that the user did not mention.\n\n"
        f"User query: {query}"
    )

    try:
        result: QueryExtraction = structured_llm.invoke(prompt)
        filters = {
            "city": result.city,
            "location": result.location,
            "min_price": result.min_price,
            "max_price": result.max_price,
            "min_bhk": result.min_bhk,
            # trust the regex too, in case the model misses a "3+ BHK"
            "bhk_or_more": bool(result.bhk_or_more or _BHK_OR_MORE_RE.search(query)),
            "property_type": result.property_type,
            "listing_type": result.listing_type,
        }
        filters = {k: v for k, v in filters.items() if v not in (None, "", 0, False)}

        intent = result.intent
        # A concrete property search must go through our DB first, even if the
        # model labelled it web_search / general.
        if _looks_like_property_search(query) and intent in ("web_search", "general"):
            intent = "sql_search"
        # A RERA/legal question should be grounded in the indexed Act text,
        # even if the model defaulted to a plain 'general' answer.
        elif intent == "general" and _looks_like_legal_question(query):
            intent = "rag_search"

        print(f"\n--- [DEBUG] Router: {intent} | Filters: {filters} ---\n")
        return intent, filters

    except Exception as e:
        print(f"\n--- [DEBUG] Router LLM failed, using fallback: {e} ---\n")
        return _fallback_extract(query)
