"""
"Verify via Link": scrape an external listing URL with Tavily (falling back to
Crawl4AI, direct then proxied through ScraperAPI), then run ONE Gemini
multimodal call against the scraped text + uploaded photos to produce a
structured claims-vs-photos comparison. Mirrors gemini_verifier.py's
single-call pattern but compares free-text listing claims against photos
instead of just counting bedrooms.
"""
import asyncio
import base64
import os
from typing import Dict, List, Optional

from crawl4ai import AsyncWebCrawler, BrowserConfig, CacheMode, CrawlerRunConfig
from crawl4ai.async_configs import ProxyConfig
from dotenv import load_dotenv
from langchain_core.messages import HumanMessage
from langchain_google_genai import ChatGoogleGenerativeAI
from pydantic import BaseModel, Field
from tavily import TavilyClient

load_dotenv()

TAVILY_API_KEY = os.getenv("TAVILY_API_KEY")
SCRAPERAPI_KEY = os.getenv("SCRAPERAPI_KEY")

# Tavily/Crawl4AI's markdown can run to tens of thousands of characters for a
# listing page full of nav/footer/related-listings boilerplate. Truncate
# before it reaches the prompt so token cost/latency stay bounded and a
# pathological page can't crowd out the photo tokens sharing the same call.
MAX_SCRAPED_CHARS = 12000


class ScrapedClaims(BaseModel):
    claimed_bhk: Optional[int] = Field(default=None, description="BHK/bedroom count claimed on the page, null if not stated")
    claimed_price: Optional[str] = Field(default=None, description="Listed price exactly as written on the page (with currency/unit), null if not stated")
    claimed_area: Optional[str] = Field(default=None, description="Listed carpet/built-up area with unit, null if not stated")
    claimed_property_type: Optional[str] = Field(default=None, description="e.g. 'Apartment', 'Villa', 'Independent House', null if not stated")
    claimed_amenities: List[str] = Field(default_factory=list, description="Amenities/features explicitly claimed on the page, e.g. 'modular kitchen', 'swimming pool', 'gym'")
    claimed_condition: Optional[str] = Field(default=None, description="Condition/luxury language used, e.g. 'newly renovated', 'premium fittings', 'ready to move', null if not stated")


class PhotoFinding(BaseModel):
    photo_index: int = Field(description="1-based index of the uploaded photo, matching the order it was given in")
    visible_room_or_area: str = Field(description="Short 3-6 word description of what's shown, e.g. 'modular kitchen with island'")
    supports_claims: List[str] = Field(default_factory=list, description="Which claimed amenities/condition items this specific photo visually confirms")
    contradicts_claims: List[str] = Field(default_factory=list, description="Which claimed amenities/condition items this specific photo visually contradicts")


class AmenityCheck(BaseModel):
    amenity: str = Field(description="The claimed feature exactly as it appears in claimed_amenities (or claimed_condition), e.g. 'private garden', 'kids play area', 'puja ghar', 'modular kitchen'")
    status: str = Field(description="Exactly one of: 'confirmed' (clearly visible in at least one photo), 'not_visible' (never appears in any uploaded photo), 'contradicted' (a photo shows something visibly inconsistent with this specific claim, e.g. an old kitchen when 'modular kitchen' is claimed)")
    note: Optional[str] = Field(default=None, description="Which photo # confirmed/contradicted it, or a brief reason. Null if status is 'confirmed' with nothing further to add.")


class LinkVerificationResult(BaseModel):
    visible_bedroom_count: Optional[int] = Field(
        default=None,
        description="Count of DISTINCT bedrooms actually visible across all photos combined — multiple "
        "photos of the SAME bedroom from different angles count as ONE, not several. Null only if none "
        "of the photos show a bedroom at all.",
    )
    photos_match_listing: bool = Field(
        description="False if the photos appear to be from a COMPLETELY DIFFERENT property than the one "
        "described in the listing text — not just missing an amenity, but wrong entirely: a visible "
        "watermark/logo from a different listing portal than implied by the URL or text, an architectural "
        "style/interior design language inconsistent with the claimed country or region, or any other clear "
        "sign the photos were not actually taken of this property. True otherwise, even if some individual "
        "claims can't be confirmed."
    )
    identity_mismatch_reason: Optional[str] = Field(
        default=None,
        description="If photos_match_listing is False, explain specifically what gave it away (e.g. 'Photos "
        "carry a MagicBricks watermark and show Indian interior styling with wall-mounted split ACs, "
        "inconsistent with a claimed New York high-rise rental'). Null if photos_match_listing is True.",
    )
    claims: ScrapedClaims
    visual_findings: List[PhotoFinding]
    amenity_verification: List[AmenityCheck] = Field(
        default_factory=list,
        description="ONE entry for EVERY item in claimed_amenities, plus claimed_condition if it describes "
        "a checkable visual state — no skipping any, and no fixed list of 'important' amenity types to "
        "check: whatever the listing itself claims (balcony, garden, gym, modular kitchen, puja ghar, kids "
        "play area, clubhouse, swimming pool, or anything else), check that specific thing against the photos.",
    )
    discrepancies: List[str] = Field(default_factory=list, description="Plain-language list of claim-vs-photo mismatches across ALL photos combined")
    matches: bool = Field(description="Overall verdict: True if photos are broadly consistent with the claims, False if there are material discrepancies OR photos_match_listing is False")
    confidence: float = Field(ge=0, le=1, description="Confidence in the overall verdict, 0.0 to 1.0")
    summary: str = Field(description="2-3 sentence plain-language summary of the comparison for a buyer to read")
    low_confidence_note: Optional[str] = Field(default=None, description="If any part of the comparison was genuinely uncertain, name why in one sentence. Null if nothing was uncertain.")


PROMPT_TEMPLATE = """You are a real-estate listing auditor. Below is the scraped text content of an \
external property listing page, followed by {n} photograph(s) the user says they personally took of that \
same property, labeled #1 through #{n}.

STEP 1 — IDENTITY CHECK (do this first, before any detail-level comparison): look for hard evidence that \
the photos are NOT actually of this property at all — a watermark or logo from a different listing portal \
than the one this text came from, an architectural or interior style clearly inconsistent with the claimed \
country/region (e.g. wall-mounted split AC units and regional decor when the listing claims a modern US \
high-rise, or vice versa), or any other unmistakable sign the photos belong to an unrelated listing. This \
is a coarse sanity check, not nitpicking — only flag it when the mismatch is obvious and structural, not \
because a single amenity happens to be missing from the photos. Set photos_match_listing accordingly and, \
if False, explain exactly what gave it away in identity_mismatch_reason, and set matches to False.

STEP 2 — extract the claims actually stated in the listing text: BHK/bedroom count, price, area, property \
type, amenities, and any condition/luxury language (e.g. "newly renovated", "premium fittings"). Only \
report a claim if it is actually present in the text — leave fields null rather than guessing.

STEP 3 — BEDROOM COUNT (do this as its own explicit check, separate from the general photo-by-photo pass \
below): look at every photo classified as a bedroom and identify how many DISTINCT physical bedrooms they \
show. Two or more photos of the same bed/window/furniture layout from different angles are the SAME \
bedroom — count it once. Set visible_bedroom_count to that number. If the listing claims a BHK/bedroom \
count (claimed_bhk) and visible_bedroom_count is clearly lower, THIS IS A MATERIAL DISCREPANCY — bedroom \
count is one of the most important, easily-verifiable claims in a listing, so always state it explicitly \
in discrepancies (e.g. "Listing claims 4 BHK but only 2 distinct bedrooms are visible across the uploaded \
photos") and factor it into matches. Do not stay silent about a bedroom-count shortfall just because the \
user might simply not have photographed every room — say so, and let low_confidence_note note that \
uncertainty instead of dropping the discrepancy entirely.

STEP 4 — for EACH photo, note what room/area it shows and which specific claimed items (if any) it visually \
supports or contradicts.

STEP 5 — AMENITY-BY-AMENITY VERIFICATION (do this systematically, not just as a side effect of STEP 4): go \
through claimed_amenities ONE ITEM AT A TIME — every single one, whatever the listing happens to claim \
(balcony, garden, gym, modular kitchen, puja ghar, kids play area, clubhouse, swimming pool, servant room, \
whatever it is — there is no fixed checklist, check exactly what THIS listing claims and nothing you assume \
should be there). Also include claimed_condition if it describes a checkable visual state (e.g. "newly \
renovated"). For each one, add an entry to amenity_verification with status:
  - "confirmed" — clearly visible in at least one photo
  - "contradicted" — a photo shows something visibly inconsistent with this specific claim (e.g. an old \
tiled kitchen when "modular kitchen" is claimed, or a visibly older/unrenovated space when "newly renovated" \
is claimed) — always report this regardless of how complete the photo set is
  - "not_visible" — never appears in any uploaded photo. Judge how much this matters by looking at the \
photo set AS A WHOLE: if the uploaded photos are a reasonably complete walkthrough (multiple different \
rooms/areas, not just one or two cherry-picked shots) and this feature never shows up anywhere in it, that's \
a real, reportable gap. If the photo set is clearly partial (e.g. only 2-3 indoor photos, where an outdoor \
garden was simply never going to be in scope), still mark it "not_visible" but treat it as low-stakes — \
note the uncertainty in low_confidence_note rather than a hard discrepancy.
Do not skip any claimed amenity. If photos_match_listing is False, still describe what each photo actually \
shows, but don't force amenity-level matching against an unrelated listing.

STEP 6 — produce an overall list of discrepancies across all photos combined: the bedroom-count check from \
STEP 3, every "contradicted" entry from STEP 5 (always), and every "not_visible" entry from STEP 5 where the \
photo set was reasonably complete (per the judgment call above). Then give an overall matches verdict (True \
only if photos_match_listing is True AND there are no material contradictions — a bedroom-count shortfall or \
any "contradicted" amenity always counts as material), a confidence score, and a short buyer-facing summary. \
If you're genuinely unsure about anything, say so in low_confidence_note.

--- LISTING PAGE TEXT ---
{scraped_text}
--- END LISTING PAGE TEXT ---"""


def _model() -> ChatGoogleGenerativeAI:
    return ChatGoogleGenerativeAI(model="gemini-3.6-flash", api_key=os.getenv("GOOGLE_API_KEY"), temperature=0)


def _image_part(image_bytes: bytes, mime_type: str) -> dict:
    b64 = base64.b64encode(image_bytes).decode("utf-8")
    return {"type": "image_url", "image_url": f"data:{mime_type};base64,{b64}"}


def _scrape_with_tavily(url: str) -> str:
    """Fast, cheap first attempt. Raises ValueError on any failure."""
    if not TAVILY_API_KEY or TAVILY_API_KEY == "your_tavily_api_key_here":
        raise ValueError("Tavily is not configured (missing TAVILY_API_KEY).")

    client = TavilyClient(api_key=TAVILY_API_KEY)
    try:
        response = client.extract(urls=[url])
    except Exception as e:
        raise ValueError(f"Could not fetch that listing page: {str(e)}")

    results = response.get("results", [])
    if not results:
        failed = response.get("failed_results", [])
        reason = failed[0].get("error") if failed else "the page could not be reached or is blocking automated access"
        raise ValueError(reason)

    raw_content = (results[0].get("raw_content") or "").strip()
    if not raw_content:
        raise ValueError("the page loaded but no readable content was found (JS-only or paywalled)")

    return raw_content


async def _scrape_with_crawl4ai(url: str, proxy_config: Optional[ProxyConfig] = None) -> str:
    """
    Fetch via a real headless Chromium browser (Crawl4AI's AsyncWebCrawler),
    returning clean markdown rather than raw HTML. Without proxy_config this
    is free but still the same server IP as a plain fetch, so it won't get
    past IP-reputation based blocking like Akamai on apartments.com/99acres
    (confirmed by direct testing) — it does get past JS-rendering
    requirements and basic bot checks, confirmed working against real
    MagicBricks listing pages that block plain requests/Tavily. Passing a
    ScraperAPI proxy_config routes the same browser through their residential
    proxy pool for sites that need it. Raises ValueError on failure.
    """
    browser_conf = BrowserConfig(headless=True, proxy_config=proxy_config)
    run_conf = CrawlerRunConfig(cache_mode=CacheMode.BYPASS)

    try:
        async with AsyncWebCrawler(config=browser_conf) as crawler:
            result = await crawler.arun(url=url, config=run_conf)
    except Exception as e:
        # Some exceptions (asyncio.TimeoutError chief among them) have an
        # empty str(e) — always include the type name so the message is
        # never silently blank.
        detail = str(e) or "no further detail"
        raise ValueError(f"headless browser fetch failed: {type(e).__name__}: {detail}")

    if not result.success:
        raise ValueError(result.error_message or "the page could not be crawled (likely blocked)")

    raw_markdown = (result.markdown.raw_markdown or "").strip() if result.markdown else ""
    if not raw_markdown:
        raise ValueError("page loaded but no readable content was found")

    return raw_markdown


def _scraperapi_proxy_config() -> ProxyConfig:
    """
    ScraperAPI's proxy-port mode (as opposed to their REST endpoint) lets
    Crawl4AI's own browser route through their residential proxy pool.
    ultra_premium=true is required, not just premium=true — testing against
    a real blocked listing (apartments.com) confirmed the basic and premium
    tiers both fail on hard anti-bot sites; only ultra_premium's residential
    pool gets through, and that's a paid-plan feature (a free-trial key gets
    rejected here until the ScraperAPI account is upgraded).
    """
    return ProxyConfig.from_string(
        f"http://scraperapi.render=true.ultra_premium=true:{SCRAPERAPI_KEY}@proxy-server.scraperapi.com:8001"
    )


# Some sites (Housing.com among them) return a normal 200 for their own bot
# interstitial instead of hard-failing the request — a "soft" block that
# Crawl4AI's own success check can't catch, since the fetch genuinely did
# succeed, just not with real content. Real listing pages we've seen run
# 40K-90K+ characters; these interstitials are only a few hundred, so a
# short page plus one of these phrases is a reliable signal it's a block
# page, not a short/thin real listing.
_BLOCK_PAGE_MAX_CHARS = 3000
_BLOCK_PAGE_MARKERS = (
    "request blocked", "access denied", "suspicious activity",
    "verify you are human", "unusual traffic", "are you a robot",
    "block reference id", "security check", "captcha",
)


def _looks_like_block_page(text: str) -> bool:
    if len(text) > _BLOCK_PAGE_MAX_CHARS:
        return False
    lowered = text.lower()
    return any(marker in lowered for marker in _BLOCK_PAGE_MARKERS)


async def scrape_listing_url(url: str) -> str:
    """
    Returns cleaned page text, truncated to MAX_SCRAPED_CHARS. Tries, in order:
    1. Tavily (fast, cheap, works for open sites)
    2. Crawl4AI direct (free, works for JS-heavy/lightly-protected sites like
       MagicBricks that block plain requests but not a real browser)
    3. Crawl4AI routed through ScraperAPI's residential proxies, only if
       SCRAPERAPI_KEY is set (needed for IP-reputation-blocked sites like
       apartments.com/99acres)
    Raises ValueError with a combined, user-facing message only if every
    available path fails — the caller turns that into an HTTP 422, never a
    raw 500.
    """
    errors = {}

    try:
        text = await asyncio.to_thread(_scrape_with_tavily, url)
        if _looks_like_block_page(text):
            raise ValueError("the site returned a bot-block page instead of the listing")
        return text[:MAX_SCRAPED_CHARS]
    except ValueError as e:
        errors["Tavily"] = str(e)

    try:
        text = await _scrape_with_crawl4ai(url)
        if _looks_like_block_page(text):
            raise ValueError("the site returned a bot-block page instead of the listing")
        return text[:MAX_SCRAPED_CHARS]
    except ValueError as e:
        errors["headless browser"] = str(e)

    if SCRAPERAPI_KEY:
        try:
            text = await _scrape_with_crawl4ai(url, proxy_config=_scraperapi_proxy_config())
            if _looks_like_block_page(text):
                raise ValueError("the site returned a bot-block page instead of the listing")
            return text[:MAX_SCRAPED_CHARS]
        except ValueError as e:
            errors["fallback scraper"] = str(e)

    detail = "; ".join(f"{source} said: {msg}" for source, msg in errors.items())
    raise ValueError(f"Could not extract content from that URL ({detail}). Try a different listing link.")


def verify_listing_against_photos(scraped_text: str, images: List[Dict]) -> LinkVerificationResult:
    """images: [{"photo_index": int, "image_bytes": bytes, "mime_type": str}, ...]"""
    n = len(images)
    content = [{"type": "text", "text": PROMPT_TEMPLATE.format(n=n, scraped_text=scraped_text)}]
    for img in images:
        content.append({"type": "text", "text": f"Photo #{img['photo_index']}:"})
        content.append(_image_part(img["image_bytes"], img["mime_type"]))

    structured_llm = _model().with_structured_output(LinkVerificationResult)
    return structured_llm.invoke([HumanMessage(content=content)])
