import os
import re
from langchain_google_genai import ChatGoogleGenerativeAI
from langgraph.graph import StateGraph, END
from app.agents.state import AgentState
from app.agents.router import classify_intent_and_extract_params
from app.database.connection import SessionLocal
from app.tools.sql_tool import query_structured_properties
from app.tools.rag_tool import query_unstructured_rag
from app.tools.web_search_tool import query_web_search
from langgraph.checkpoint.memory import MemorySaver
from dotenv import load_dotenv

load_dotenv()

llm = ChatGoogleGenerativeAI(
    model="gemini-3.6-flash",
    api_key=os.getenv("GOOGLE_API_KEY")
)
memory = MemorySaver()

# ---------------------------------------------------------
def classify_intent_node(state: AgentState) -> AgentState:
    try:
        user_q = state.get("user_query") or (state["messages"][-1].content if "messages" in state else "")
        intent, filters = classify_intent_and_extract_params(user_q)
        print(f"\n--- [DEBUG] Router Intent: {intent} | Filters: {filters} ---\n")
        return {**state, "user_query": user_q, "intent": intent, "parsed_filters": filters}
    except Exception as e:
        print(f"\n[WARNING] Router LLM failed/rate limited: {e}\n")
        # Treat as a property search but don't invent filters the user never gave
        return {**state, "intent": "sql_search", "parsed_filters": {}}

def sql_execution_node(state: AgentState) -> AgentState:
    """
    Always run first for a property query: look for matching listings that
    brokers have published on our own platform (Postgres).
    """
    db = SessionLocal()
    try:
        filters = state.get("parsed_filters", {}) or {}
        results = query_structured_properties(
            db=db,
            city=filters.get("city") or None,
            location=filters.get("location") or None,
            min_price=filters.get("min_price") or None,
            max_price=filters.get("max_price") or None,
            min_bhk=filters.get("min_bhk") or None,
            bhk_or_more=bool(filters.get("bhk_or_more")),
            property_type=filters.get("property_type") or None,
            listing_type=filters.get("listing_type") or None,
            # Only surface our own broker-uploaded listings for the "Interested" flow
            on_platform_only=True,
            with_images_only=True,
        )
        results = results or []
        print(f"\n--- [DEBUG] SQL Execution (on-platform) Count: {len(results)} ---\n")
        return {**state, "sql_results": results}
    except Exception as e:
        print(f"\n[ERROR] SQL Execution Failed: {e}\n")
        return {**state, "sql_results": []}
    finally:
        db.close()

def rag_execution_node(state: AgentState) -> AgentState:
    """
    Retrieves and answers directly from indexed documents (RERA Act text,
    brochures) -- a document Q&A, not a property listing search, so it gets
    its own grounded prompt rather than flowing into the listings synthesizer.
    """
    query = state.get("user_query", "real estate")
    results = query_unstructured_rag(query_text=query, top_k=4)

    if results:
        context = "\n\n".join(f"[Source: {r['source']}]\n{r['document']}" for r in results)
        prompt = f"""You are a real estate legal/compliance assistant. Answer the user's \
question using ONLY the document excerpts below - do not invent facts, section numbers, \
or rates that aren't stated in them. If the excerpts don't fully answer the question, \
say what they do cover and note that the rest depends on the applicable state's RERA \
rules or the specific buyer agreement.

USER QUESTION: "{query}"

DOCUMENT EXCERPTS:
{context}

Write a clear, direct Markdown answer (short paragraphs and/or bullet points). Cite the \
source document by name in parentheses when you state a specific rule from it."""
        try:
            response = llm.invoke(prompt)
            content = response.content
        except Exception as e:
            print(f"\n[WARNING] RAG synthesis LLM failed: {e}\n")
            content = "I'm currently experiencing high traffic. Please wait a moment and try again."
    else:
        content = (
            "I couldn't find anything on that in our indexed documents. Try rephrasing, "
            "or ask a general real-estate question instead."
        )

    return {
        **state,
        "rag_results": results,
        "final_response": content,
        "messages": [("assistant", content)],
    }

def web_search_node(state: AgentState) -> AgentState:
    query = state.get("user_query", "real estate properties")
    # fetch extra candidates so at least 3 distinct listings survive de-duplication
    results = query_web_search(query=f"{query} property listings for sale", max_results=10)
    return {**state, "web_results": results}

def general_knowledge_node(state: AgentState) -> AgentState:
    print("\n--- [DEBUG] Executing General Knowledge LLM Node! ---\n")
    query = state.get("user_query", "")
    
    prompt = f"""You are strictly a Real Estate AI Assistant.

USER QUERY: "{query}"

INSTRUCTIONS & DOMAIN GUARDRAILS:
1. ALLOWED TOPICS: Real estate properties, pricing, locations, RERA acts, builder regulations, home loans/EMIs, stamp duty, property tax, and polite greetings.
2. FORBIDDEN TOPICS: Anything unrelated to real estate.

CRITICAL RULE:
- If the user query is about ANY forbidden or out-of-scope topic, reply ONLY with this exact sentence:
  "I am specialized strictly in real estate and property assistance. I can help you find properties, calculate EMIs, or understand RERA guidelines, but I cannot answer questions outside of real estate."

Provide your response below:"""

    try:
        response = llm.invoke(prompt)
        content = response.content
    except Exception as e:
        print(f"\n[WARNING] LLM Quota/Rate Limit hit: {e}\n")
        content = "I am experiencing high traffic right now. Please wait a few seconds and try again!"
    
    return {
        **state, 
        "final_response": content,
        "messages": [("assistant", content)]
    }

def _short_snippet(text, limit: int = 240) -> str:
    """Flatten a raw search snippet into one readable sentence-ish line."""
    text = re.sub(r"[#*|>\[\]]+", " ", text or "")
    text = re.sub(r"\s+", " ", text).strip()
    if not text:
        return "No description available."
    if len(text) <= limit:
        return text
    cut = text[:limit]
    end = cut.rfind(". ")
    return cut[: end + 1] if end > limit // 2 else cut.rsplit(" ", 1)[0] + "..."

def synthesizer_node(state: AgentState) -> AgentState:
    print("\n--- [DEBUG] Executing LLM Synthesizer Node! ---\n")
    query = state.get("user_query", "")
    sql_results = state.get("sql_results", []) or []
    web_results = state.get("web_results", []) or []

    # Our own broker listings are rendered by the frontend as interactive cards
    # (with an "Interested" button) ABOVE this text, so the text must not repeat
    # them -- it only covers the external web options.
    on_platform_names = [r.get("property_name", "") for r in sql_results]
    if sql_results:
        on_platform_note = (
            f"SEPARATELY, {len(sql_results)} verified listing(s) from our own "
            f"brokers are already shown to the user as cards above this message: "
            f"{on_platform_names}. Do NOT describe or list these again. Skip any "
            f"web result that is clearly the same property as one of those names."
        )
    else:
        on_platform_note = (
            "There are NO listings from our own brokers for this query."
        )

    if web_results:
        context_data = f"Raw web search results (title, url, snippet):\n{web_results}"
    else:
        context_data = "No external web results were found."

    prompt = f"""You are a real estate assistant. The user asked: "{query}"

{on_platform_note}

RAW WEB DATA (mine every field you can from the title + snippet of each item):
{context_data}

Write a Markdown answer covering ONLY web options. Follow this exactly:

1. First line: "## Results from Web"
2. Then, for each DISTINCT property/project, one block formatted as:

**<Real project or society name — take it from the title/snippet, not a generic label>**
- Location: <locality, city — be specific>
- Price: <price or range from the data; write "Not stated" only if truly absent — do NOT write "Price on request">
- Configuration: <e.g. 3 BHK, 1660 sq.ft.>
- Builder/Seller: <name if present, else omit this line>
- Description: <1-2 sentences describing the property from the snippet — size,
  amenities, possession status, nearby landmarks, what makes it stand out>
- 👉 [View Listing](<one exact URL from that item>)

RULES:
- DE-DUPLICATE hard: if two items are the same project, the same portal search
  page, or near-identical titles ("3 BHK Flat in X" vs "Resale 3 BHK Flat in X"),
  keep only ONE — the more detailed one.
- Prefer items about a specific named project. If a portal/search page's snippet
  names a specific project, use THAT project name as the heading (with the portal
  URL as its link). Skip anything matching an on-platform listing name above.
- Give AT LEAST 3 blocks and at most 5. If fewer than 3 named projects exist,
  fill the remaining slots with the most relevant remaining items, using a
  descriptive heading built from the snippet (e.g. "3 BHK Flats near Vijay Nagar,
  Indore — MagicBricks") rather than the raw page title.
- Every block MUST have a Description line — never output just a name and link.
- Exactly ONE link per block. Never repeat a URL. Never invent a URL, price or fact.
- Keep only properties in the location/budget the user asked for.
- Separate blocks with one blank line.
- Only if the web data is completely empty, write "## Results from Web" then one
  line saying no web listings were found and suggest broadening the search.
"""

    try:
        response = llm.invoke(prompt)
        content = response.content
    except Exception as e:
        print(f"\n[WARNING] Synthesizer LLM Quota hit: {e}\n")
        # The LLM only formats the web results -- if it's down, still show them
        # with a description pulled straight from the search snippet.
        blocks = [
            f"**{w['title']}**\n- Description: {_short_snippet(w.get('snippet'))}"
            f"\n- 👉 [View Listing]({w['url']})"
            for w in web_results
            if w.get("url") and w.get("title") and not w.get("error")
        ]
        if blocks:
            content = "## Results from Web\n\n" + "\n\n".join(blocks[:5])
        elif sql_results:
            content = (
                f"You have {len(sql_results)} verified listing(s) from our brokers "
                "shown above. No web results were found."
            )
        else:
            content = "I'm currently experiencing high traffic. Please wait a moment and try your query again."

    return {
        **state, 
        "final_response": content,
        "messages": [("assistant", content)]
    }

# ---------------------------------------------------------
def route_next_step(state: AgentState) -> str:
    intent = state.get("intent")
    # Any property search -- whether the router guessed sql_search or web_search --
    # starts by checking our own broker listings, then always adds a web search.
    if intent in ("sql_search", "web_search"):
        return "sql_execution"
    if intent == "rag_search":
        return "rag_execution"
    if intent == "general":
        return "general_knowledge"
    return "sql_execution"

builder = StateGraph(AgentState)
builder.add_node("classifier", classify_intent_node)
builder.add_node("sql_execution", sql_execution_node)
builder.add_node("rag_execution", rag_execution_node)
builder.add_node("web_search_execution", web_search_node)
builder.add_node("general_knowledge", general_knowledge_node)
builder.add_node("synthesizer", synthesizer_node)

builder.set_entry_point("classifier")

builder.add_conditional_edges(
    "classifier", route_next_step,
    {
        "sql_execution": "sql_execution",
        "rag_execution": "rag_execution",
        "general_knowledge": "general_knowledge",
    }
)

# Property flow: our broker listings first, THEN always a web search, THEN
# synthesise both (frontend renders the SQL listings as "Interested" cards).
builder.add_edge("sql_execution", "web_search_execution")
builder.add_edge("web_search_execution", "synthesizer")
builder.add_edge("rag_execution", END)

builder.add_edge("general_knowledge", END)
builder.add_edge("synthesizer", END)

app = builder.compile(checkpointer=memory)