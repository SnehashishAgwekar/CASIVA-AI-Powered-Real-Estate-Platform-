import os
import traceback
import json
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from app.agents.graph import app as agent_app
from app.api.verification import router as verification_router
from app.api.broker import router as broker_router
from app.api.auth import router as auth_router
from app.api.properties import router as properties_router
from app.core.storage import STATIC_DIR, UPLOAD_DIR

app = FastAPI(title="Real Estate AI")

app.add_middleware(
    CORSMiddleware,
    # FRONTEND_ORIGINS: comma-separated deployed frontend URLs, e.g.
    # "https://casiva.vercel.app" (set in the hosting dashboard).
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"] + [
        o.strip().rstrip("/") for o in os.getenv("FRONTEND_ORIGINS", "").split(",") if o.strip()
    ],
    # Vite bumps to the next free port (5174, 5175, ...) whenever 5173 is
    # already taken, which silently CORS-blocked every dev machine that
    # wasn't on the exact port above. Allow any localhost port too.
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1):\d+$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Ensure backend/static/uploads exists, then serve backend/static at /static
os.makedirs(UPLOAD_DIR, exist_ok=True)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

app.include_router(auth_router, prefix="/api/v1/auth", tags=["Authentication"])
app.include_router(verification_router)
app.include_router(broker_router, prefix="/api/v1/broker", tags=["Broker Dashboard"])
app.include_router(properties_router, prefix="/api/v1/properties", tags=["Properties"])

class ChatRequest(BaseModel):
    user_query: str
    thread_id: str

@app.get("/")
async def root_health_check():
    return {
        "status": "online",
        "message": "Real Estate AI Backend is running smoothly!"
    }

@app.post("/api/v1/chat")
async def chat_endpoint(request: ChatRequest):
    try:
        config = {"configurable": {"thread_id": request.thread_id}}
        
        state = {
            "user_query": request.user_query,
            "messages": [("user", request.user_query)]
        }
        
        result = agent_app.invoke(state, config=config)
        
        messages = result.get("messages", [])
        if messages:
            last_message = messages[-1]
            ai_message = getattr(last_message, "content", str(last_message))
        else:
            ai_message = result.get("final_response", "No response generated.")
            
        intent = result.get("next_agent", result.get("intent", "unknown"))
        filters = result.get("extracted_filters", result.get("parsed_filters", {}))
        
        return {
            "final_response": ai_message,
            "intent": intent,
            "parsed_filters": filters
        }
        
    except Exception as e:
        print("\n--- AGENT CRASH TRACEBACK ---")
        traceback.print_exc()
        print("-----------------------------\n")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/v1/chat-stream")
async def chat_stream(payload: dict):
    user_query = payload.get("user_query")
    thread_id = payload.get("thread_id", "default_thread")
    
    config = {"configurable": {"thread_id": thread_id}}
    inputs = {
        "user_query": user_query,
        "messages": [("user", user_query)]
    }

    async def event_generator():
        try:
            async for event in agent_app.astream(inputs, config=config, stream_mode="updates"):
                for node_name, state_update in event.items():
                    # FIX: Sirf zaroori data extract karo taaki JSON payload chota rahe aur break na ho
                    clean_update = {}
                    if "intent" in state_update:
                        clean_update["intent"] = state_update["intent"]
                    if "parsed_filters" in state_update:
                        clean_update["parsed_filters"] = state_update["parsed_filters"]
                    if "sql_results" in state_update:
                        # Our own broker listings -> frontend renders these as
                        # interactive cards with an "Interested" button.
                        clean_update["sql_results"] = state_update["sql_results"]
                    if "final_response" in state_update:
                        clean_update["final_response"] = state_update["final_response"]

                    # Ab yeh light-weight JSON safely frontend tak jayega
                    yield f"data: {json.dumps({'node': node_name, 'update': clean_update}, default=str)}\n\n"
            
            yield f"data: {json.dumps({'status': 'completed'})}\n\n"
        except Exception as e:
            print(f"\n[STREAM ERROR] {e}\n")
            traceback.print_exc()
            yield f"data: {json.dumps({'error': str(e)}, default=str)}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")