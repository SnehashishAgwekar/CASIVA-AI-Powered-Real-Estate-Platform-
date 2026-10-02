# CASIVA(EstateAgent AI): Intelligent Real Estate Ecosystem

An advanced, multi-agent real estate platform powered by Large Language Models (LLMs) and Computer Vision. This project integrates conversational AI for property discovery with an automated visual verification engine to detect fraudulent listing configurations.

##  Key Features

* **Multi-Agent Orchestration:** Utilizes LangGraph and Gemini 3.6-Flash to route user queries intelligently across different domains (SQL databases, Vector RAG, and Live Web Search).
* **Property Room & BHK Verification:** An automated computer vision pipeline that independently verifies a seller's claimed BHK (Bedroom, Hall, Kitchen) configuration using uploaded photographs.
* **Visual Fraud Detection:** Prevents users from artificially inflating room counts by having Gemini 3.6-Flash detect duplicate angles of the same physical room across uploaded photos.
* **Modern Stack:** Built on FastAPI, React, PostgreSQL, and Qdrant, orchestrated seamlessly via Docker Compose.

##  System Architecture & Tech Stack

### Frontend (Client-Side)
* **Framework:** React.js
* **Styling:** Tailwind CSS (Dark theme blueprint UI)
* **State Management:** React Hooks with local storage session caching

### Backend (Server-Side)
* **Framework:** FastAPI (Python)
* **Concurrency:** `run_in_threadpool` for non-blocking CPU-bound AI inference
* **Relational Database:** PostgreSQL (Property listings, structured data)
* **Vector Database:** Qdrant (Brochure archives, RAG)

### Artificial Intelligence & Machine Learning
* **LLM Engine:** Gemini 3.6-Flash
* **Agent Framework:** LangGraph (Node-based decision routing)
* **Web Search:** Tavily API
* **Vision Verification:** Gemini 3.6-Flash (multimodal) — room classification and duplicate-photo detection in a single call

---

##  Deep Dive: The BHK Verification Engine

A standout feature of this platform is the anti-fraud verification pipeline. When a user uploads property photos, the backend sends all of them to **Gemini 3.6-Flash** in one multimodal request, asking it to:

1. **Classify each photo's room type** (bedroom, bathroom, kitchen, living room, dining room, closet, or other).
2. **Group bedroom photos that show the same physical room** from a different angle or distance — so uploading four photos of the exact same bedroom can't be used to fake a "4 BHK" claim.

The final claimed-vs-detected BHK comparison is then computed in plain Python from Gemini's structured output, not by the model itself, so that number can never be an LLM mistake.

---

##  Local Setup & Installation

### Prerequisites
* Docker and Docker Compose
* Python 3.10+
* Node.js v18+

### 1. Environment variables
Copy the example env file at the repo root and fill in your own keys (`TAVILY_API_KEY`, `GOOGLE_API_KEY`; the rest have working local defaults):
```bash
cp .env.example .env
```

### 2. Infrastructure (Postgres + Qdrant)
```bash
docker-compose up -d
```

### 3. Backend
```bash
cd backend
python -m venv venv
# Windows: venv\Scripts\activate   |   macOS/Linux: source venv/bin/activate
pip install -r requirements.txt

# Create the tables (safe to re-run)
python scripts/init_db.py

# Populate sample users, brokers, and listings so the app isn't empty
python scripts/seed.py

# Start the API — http://localhost:8000
uvicorn app.main:app --reload
```
`seed.py` prints the demo login credentials it creates when it finishes — use those to sign in as a buyer or broker without registering a new account.

### 4. Frontend
```bash
cd frontend
npm install
npm run dev   # http://localhost:5173
```

### A note for anyone cloning this repo
Postgres data lives in a local Docker volume, not in Git — a fresh clone always starts with an empty database. `init_db.py` only creates the schema; `seed.py` is what actually gives you something to look at. Both are safe to run again later (they skip anything that already exists).
