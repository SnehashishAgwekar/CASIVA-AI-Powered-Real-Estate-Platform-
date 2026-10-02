import React, { useState, useEffect, useRef } from "react";
import {
  Send, Bot, User, Database, FileText, Globe, Sparkles,
  RotateCcw, Loader2, SlidersHorizontal, ChevronRight, Home, ShieldCheck,
  CheckCircle2, Plus, MessageSquare, Trash2, Upload, X, CheckCircle, AlertTriangle,
  LogOut, LogIn, UserPlus, Mail, Lock, Phone, Briefcase, MapPin, BedDouble,
  Tag, KeyRound, UserCircle, Pencil
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { BrowserRouter, Routes, Route, useNavigate, useLocation } from "react-router-dom";
import LandingPage from "./components/LandingPage";
import CasivaLogo from "./components/CasivaLogo";
import PropertyDashboard from "./components/PropertyDashboard";
import MyProfile from "./components/MyProfile";
import BrokerAssistant from "./components/BrokerAssistant";
import EditListingModal from "./components/EditListingModal";

const API_STREAM_URL = "http://localhost:8000/api/v1/chat-stream";
const API_VERIFY_URL = "http://localhost:8000/api/v1/verify-property";
const API_VERIFY_LINK_URL = "http://localhost:8000/api/v1/verify-property-link";
const API_SIGNUP_URL = "http://localhost:8000/api/v1/auth/signup";
const API_LOGIN_URL = "http://localhost:8000/api/v1/auth/login";
const API_BROKER_LISTINGS_URL = "http://localhost:8000/api/v1/broker/my-listings";
const API_BROKER_CREATE_URL = "http://localhost:8000/api/v1/broker/listings";
const API_BROKER_LEADS_URL = "http://localhost:8000/api/v1/broker/leads";
const API_INTEREST_URL = (id) => `http://localhost:8000/api/v1/properties/${id}/interest`;
// Origin that serves uploaded media at /static/uploads/... (see backend main.py mount)
const MEDIA_BASE = "http://localhost:8000";

// Broker-uploaded photos are server-relative ("/static/uploads/xxx.jpg");
// seed-data photos are already-absolute URLs (e.g. Unsplash). Only prefix
// the ones that need it.
const resolveImg = (url) => (url && /^https?:\/\//i.test(url) ? url : `${MEDIA_BASE}${url}`);

const EMPTY_LISTING = {
  property_name: "", city: "", location: "", price_in_inr: "", area_sqft: "",
  property_type: "Apartment", listing_type: "Sale", security_deposit: "",
  bhk: "", area_unit: "sqft", builder_name: "",
  amenities: "", availability_status: "Ready to Move",
};

// FastAPI errors: `detail` is a string for our raised HTTPExceptions, or an
// array of {msg, loc} for request-validation (422) errors.
const errDetail = (data, fallback) => {
  const d = data?.detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d) && d.length) return d[0]?.msg || fallback;
  return fallback;
};

// "₹ 18,000/mo" for a rental, "₹ 95,00,000" for a sale listing.
const formatPrice = (p) => {
  const amount = `₹ ${Number(p.price_in_inr || 0).toLocaleString("en-IN")}`;
  return p.listing_type === "Rent" ? `${amount}/mo` : amount;
};

// Decode a JWT payload without verifying the signature (used only as a role fallback).
const parseJwt = (t) => {
  try {
    const base = t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(decodeURIComponent(escape(atob(base))));
  } catch {
    return {};
  }
};

// Chat history is stored per user id so accounts sharing a browser never mix.
const sessionsStorageKey = (uid) => `estate_chat_sessions_${uid || "anon"}`;

// Same photo the landing page hero uses, so Get Started -> Login feels like
// one continuous scene rather than a jump cut.
const AUTH_BG_IMAGE =
  "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=2400&q=80";

const WELCOME_MESSAGE = {
  role: "assistant",
  content: "Welcome to **CASIVA**! How can I assist you with your property search today?",
  intent: null, filters: null, steps: [], properties: [],
};

const newSessionObject = () => ({
  id: "session_" + Math.random().toString(36).substring(2, 9),
  title: "New Conversation",
  messages: [{ ...WELCOME_MESSAGE }],
});

// A session is only "real" once the user has actually said something in it —
// otherwise it's just the auto-created placeholder every visit to Chat starts
// with, and shouldn't survive in history once the tab closes.
const hasRealContent = (session) =>
  Array.isArray(session?.messages) && session.messages.some((m) => m.role === "user");

const loadUserSessions = (uid) => {
  try {
    const saved = localStorage.getItem(sessionsStorageKey(uid));
    const parsed = saved ? JSON.parse(saved) : null;
    if (Array.isArray(parsed) && parsed.length > 0) {
      const nonEmpty = parsed.filter(hasRealContent);
      // Sweep out any empty placeholders left over from before this fix so
      // they don't keep reappearing on every future load.
      try { localStorage.setItem(sessionsStorageKey(uid), JSON.stringify(nonEmpty)); } catch { /* storage may be blocked */ }
      if (nonEmpty.length > 0) return nonEmpty;
    }
  } catch { /* ignore corrupt/blocked storage */ }
  return [newSessionObject()];
};

// One real URL per view so browser back/forward walks the app like a normal
// breadcrumb trail: / (landing) -> /login|/signup -> /dashboard (or
// /broker/dashboard for brokers) -> /chat -> /verify.
const VIEW_PATHS = {
  login: "/login",
  signup: "/signup",
  "property-dashboard": "/dashboard",
  chat: "/chat",
  verify: "/verify",
  "broker-dashboard": "/broker/dashboard",
  profile: "/profile",
};
const pathToView = (pathname) =>
  Object.keys(VIEW_PATHS).find((view) => VIEW_PATHS[view] === pathname) || null;

function AppShell() {
  // The active "view" is derived from the URL (see VIEW_PATHS) rather than
  // held as its own state, so browser back/forward walks these exactly like
  // any other page: "login" | "signup" | "property-dashboard" | "chat" | "verify" | "broker-dashboard"
  const location = useLocation();
  const navigate = useNavigate();
  const activeView = pathToView(location.pathname) || "login";

  // --- Auth state (JWT kept in memory only, never persisted) ---
  const [token, setToken] = useState(null);
  const [currentUser, setCurrentUser] = useState(null); // { name, email, role, phone_number }
  const [authForm, setAuthForm] = useState({ name: "", email: "", password: "", phone_number: "", role: "user" });
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");

  // --- Broker dashboard state ---
  const [brokerListings, setBrokerListings] = useState(null);
  const [brokerLoading, setBrokerLoading] = useState(false);
  const [brokerError, setBrokerError] = useState("");
  const [editingListing, setEditingListing] = useState(null);
  const [showListingForm, setShowListingForm] = useState(false);
  const [listingForm, setListingForm] = useState(EMPTY_LISTING);
  const [listingImages, setListingImages] = useState([]);
  const [listingSubmitting, setListingSubmitting] = useState(false);
  const [listingError, setListingError] = useState("");
  const [brokerLeads, setBrokerLeads] = useState(null);

  // "Interested" state per property id: { loading, error, data }
  const [interestState, setInterestState] = useState({});

  // Full-screen image viewer (click any listing photo to enlarge)
  const [lightboxSrc, setLightboxSrc] = useState(null);

  useEffect(() => {
    if (!lightboxSrc) return;
    const onKey = (e) => { if (e.key === "Escape") setLightboxSrc(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxSrc]);

  const isAuthed = !!token && !!currentUser;
  const isBroker = isAuthed && currentUser.role === "broker";

  // Route guard: corrects the URL when it doesn't match auth/role state
  // (direct visits to a protected path while logged out, wrong-role paths,
  // unknown paths). These are corrections, not user-chosen steps, so they
  // replace the current history entry instead of pushing a new one.
  //
  // /login and /signup are deliberately NOT bounced away from when the user
  // is already authenticated: browser back-navigation from the dashboard
  // lands there by design (see VIEW_PATHS/pathToView), and redirecting
  // forward again would make the back button look broken.
  useEffect(() => {
    const knownView = pathToView(location.pathname);
    const homePath = isBroker ? VIEW_PATHS["broker-dashboard"] : VIEW_PATHS["property-dashboard"];

    if (!isAuthed) {
      if (knownView !== "login" && knownView !== "signup") {
        navigate(VIEW_PATHS.login, { replace: true });
      }
      return;
    }
    if (knownView === "login" || knownView === "signup" || knownView === "profile") return;
    if (knownView === null) {
      navigate(homePath, { replace: true });
      return;
    }
    if (isBroker && knownView !== "broker-dashboard") {
      navigate(homePath, { replace: true });
    } else if (!isBroker && knownView === "broker-dashboard") {
      navigate(homePath, { replace: true });
    }
  }, [location.pathname, isAuthed, isBroker, navigate]);

  const [selectedBhk, setSelectedBhk] = useState(2);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [verifyResult, setVerifyResult] = useState(null);

  const [verifyMode, setVerifyMode] = useState("photos"); // "photos" | "link"
  const [propertyUrl, setPropertyUrl] = useState("");
  const [linkFiles, setLinkFiles] = useState([]);
  const [linkVerifyLoading, setLinkVerifyLoading] = useState(false);
  const [linkVerifyResult, setLinkVerifyResult] = useState(null);
  const [linkScrapeFailed, setLinkScrapeFailed] = useState(false);
  const [linkScrapeFailMessage, setLinkScrapeFailMessage] = useState("");
  const [pastedDescription, setPastedDescription] = useState("");

  // Consume a prefill dropped into sessionStorage by the Casiva browser
  // extension (browser-extension/background.js). Runs whenever the user
  // actually reaches the Verify view -- not on mount -- because a direct
  // visit to /verify can bounce through /login first (see the route-guard
  // effect above), so the prefill must survive that redirect and be applied
  // once /verify is truly showing, not assumed present at initial load.
  useEffect(() => {
    if (activeView !== "verify") return;
    const raw = sessionStorage.getItem("verify_link_prefill");
    if (!raw) return;
    sessionStorage.removeItem("verify_link_prefill"); // consume once; avoid reuse on a later visit
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return;
      setVerifyMode("link");
      if (typeof parsed.url === "string") setPropertyUrl(parsed.url);
      if (typeof parsed.description === "string") setPastedDescription(parsed.description);
    } catch (err) {
      console.warn("Ignoring malformed verify_link_prefill payload:", err);
    }
  }, [activeView]);

  // Chat state stays empty until a user logs in; applyAuthSuccess loads the
  // signed-in user's own history, handleLogout wipes it.
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState("");
  const [messages, setMessages] = useState([{ ...WELCOME_MESSAGE }]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef(null);

  // Persist the active user's chat history under their own storage key.
  // Empty sessions (no user message yet) are kept in memory so the sidebar
  // can show the conversation you're currently composing, but are never
  // written to storage -- so closing the tab without saying anything leaves
  // no trace next time you log in.
  useEffect(() => {
    if (!currentUser || !activeSessionId || sessions.length === 0) return;
    const updated = sessions.map((s) =>
      s.id === activeSessionId ? { ...s, messages } : s
    );
    setSessions(updated);
    try {
      localStorage.setItem(sessionsStorageKey(currentUser.id), JSON.stringify(updated.filter(hasRealContent)));
    } catch { /* storage may be blocked */ }
  }, [messages]);

  const createNewChat = () => {
    // Reuse the current session if it's already blank instead of piling up
    // multiple empty "New Conversation" placeholders side by side.
    const active = sessions.find((s) => s.id === activeSessionId);
    if (active && !hasRealContent(active)) {
      setMessages(active.messages);
      return;
    }
    const newSession = newSessionObject();
    setSessions((prev) => [newSession, ...prev]);
    setActiveSessionId(newSession.id);
    setMessages(newSession.messages);
  };

  const switchSession = (id) => {
    const found = sessions.find((s) => s.id === id);
    if (found) {
      setActiveSessionId(found.id);
      setMessages(found.messages);
    }
  };

  const deleteSession = (e, id) => {
    e.stopPropagation();
    const filtered = sessions.filter((s) => s.id !== id);
    setSessions(filtered);
    try {
      localStorage.setItem(sessionsStorageKey(currentUser?.id), JSON.stringify(filtered.filter(hasRealContent)));
    } catch { /* storage may be blocked */ }

    if (activeSessionId === id) {
      if (filtered.length > 0) {
        setActiveSessionId(filtered[0].id);
        setMessages(filtered[0].messages);
      } else {
        createNewChat();
      }
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    if (activeView === "chat") scrollToBottom();
  }, [messages, loading, activeView]);

  const handleSend = async (queryTextOverride) => {
    const textToSend = queryTextOverride || input;
    if (!textToSend.trim() || loading) return;

    const userText = textToSend.trim();
    if (!queryTextOverride) setInput("");

    setSessions((prev) =>
      prev.map((s) => {
        if (s.id === activeSessionId && s.title === "New Conversation") {
          return { ...s, title: userText.length > 25 ? userText.substring(0, 25) + "..." : userText };
        }
        return s;
      })
    );

    setMessages((prev) => [
      ...prev,
      { role: "user", content: userText },
      { role: "assistant", content: "", intent: null, filters: null, steps: [], properties: [] }
    ]);
    setLoading(true);

    let currentSteps = [];
    let finalContent = "";
    let detectedIntent = null;
    let detectedFilters = null;
    let detectedProperties = [];

    try {
      const response = await fetch(API_STREAM_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // namespace the LangGraph thread by user so conversation memory can't bleed across accounts
        body: JSON.stringify({
          user_query: userText,
          thread_id: `${currentUser?.id || "anon"}:${activeSessionId}`,
        }),
      });

      if (!response.body) throw new Error("Streaming not supported by server");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop();

        for (const line of parts) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.replace("data: ", ""));
              if (data.node) {
                let nodeLabel = data.node;
                if (["router", "classify_intent_node", "classifier"].includes(data.node)) nodeLabel = "🧠 Classifying intent & extracting filters";
                else if (["sql_execution_node", "sql_execution"].includes(data.node)) nodeLabel = "🏠 Searching CASIVA broker listings";
                else if (["rag_execution_node", "rag_execution"].includes(data.node)) nodeLabel = "📄 Scanning Qdrant vector documents";
                else if (["web_search_node", "web_search_execution"].includes(data.node)) nodeLabel = "🌐 Fetching live web insights";
                else if (["synthesizer_node", "synthesizer"].includes(data.node)) nodeLabel = "✨ Synthesizing final response";
                else if (["general_knowledge_node", "general_knowledge"].includes(data.node)) nodeLabel = "💬 Answering from general knowledge";

                currentSteps.push(nodeLabel);
                setMessages((prev) => {
                  const newPrev = [...prev];
                  const lastMsg = newPrev[newPrev.length - 1];
                  lastMsg.steps = [...currentSteps];
                  return newPrev;
                });
              }

              if (data.update) {
                if (data.update.intent) detectedIntent = data.update.intent;
                if (data.update.parsed_filters) detectedFilters = data.update.parsed_filters;
                if (Array.isArray(data.update.sql_results)) {
                  detectedProperties = data.update.sql_results;
                  setMessages((prev) => {
                    const newPrev = [...prev];
                    newPrev[newPrev.length - 1].properties = detectedProperties;
                    return newPrev;
                  });
                }
                if (data.update.final_response) finalContent = data.update.final_response;
              }

              if (data.error) finalContent = `⚠️ **Error:** ${data.error}`;
            } catch (e) {
               console.error("Incomplete JSON chunk skipped temporarily:", e);
            }
          }
        }
      }

      setMessages((prev) => {
        const newPrev = [...prev];
        const lastMsg = newPrev[newPrev.length - 1];
        lastMsg.content = finalContent || "No response generated.";
        lastMsg.intent = detectedIntent;
        lastMsg.filters = detectedFilters;
        lastMsg.properties = detectedProperties;
        return newPrev;
      });
    } catch (err) {
      setMessages((prev) => {
        const newPrev = [...prev];
        const lastMsg = newPrev[newPrev.length - 1];
        lastMsg.content = `⚠️ **Error:** Unable to connect to backend agent stream. (${err.message})`;
        lastMsg.intent = "error";
        return newPrev;
      });
    } finally {
      setLoading(false);
    }
  };

  const handleFileDrop = (e) => {
    e.preventDefault();
    if (e.dataTransfer.files) {
      const filesArray = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith("image/"));
      setSelectedFiles(prev => [...prev, ...filesArray].slice(0, 12));
    }
  };

  const handleFileSelect = (e) => {
    if (e.target.files) {
      const filesArray = Array.from(e.target.files).filter(f => f.type.startsWith("image/"));
      setSelectedFiles(prev => [...prev, ...filesArray].slice(0, 12));
    }
  };

  const removeFile = (index) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleVerifySubmit = async () => {
    if (selectedFiles.length === 0 || verifyLoading) return;
    setVerifyLoading(true);
    setVerifyResult(null);

    const formData = new FormData();
    formData.append("claimed_bhk", selectedBhk);
    selectedFiles.forEach((file) => formData.append("images", file));

    try {
      const res = await fetch(API_VERIFY_URL, { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Verification failed");
      setVerifyResult(data);
    } catch (err) {
      alert(`Verification Error: ${err.message}`);
    } finally {
      setVerifyLoading(false);
    }
  };

  const handleLinkFileDrop = (e) => {
    e.preventDefault();
    if (e.dataTransfer.files) {
      const filesArray = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith("image/"));
      setLinkFiles(prev => [...prev, ...filesArray].slice(0, 12));
    }
  };

  const handleLinkFileSelect = (e) => {
    if (e.target.files) {
      const filesArray = Array.from(e.target.files).filter(f => f.type.startsWith("image/"));
      setLinkFiles(prev => [...prev, ...filesArray].slice(0, 12));
    }
  };

  const removeLinkFile = (index) => {
    setLinkFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleVerifyLinkSubmit = async () => {
    if (!propertyUrl.trim() || linkFiles.length === 0 || linkVerifyLoading) return;
    setLinkVerifyLoading(true);
    setLinkVerifyResult(null);
    setLinkScrapeFailed(false);

    const formData = new FormData();
    formData.append("property_url", propertyUrl.trim());
    linkFiles.forEach((file) => formData.append("images", file));
    if (pastedDescription.trim()) formData.append("pasted_description", pastedDescription.trim());

    try {
      const res = await fetch(API_VERIFY_LINK_URL, { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) {
        // The backend can't scrape some listing sites (bot-protected pages) — offer
        // a paste-in fallback instead of just failing outright.
        if (data?.detail?.error === "scrape_failed") {
          setLinkScrapeFailed(true);
          setLinkScrapeFailMessage(data.detail.message || "Could not read that listing page automatically.");
          return;
        }
        throw new Error(errDetail(data, "Verification failed"));
      }
      setLinkVerifyResult(data);
    } catch (err) {
      alert(`Verification Error: ${err.message}`);
    } finally {
      setLinkVerifyLoading(false);
    }
  };

  // --- Auth handlers ---------------------------------------------------------
  const applyAuthSuccess = (data, fallbackRole, fallbackName, fallbackEmail, fallbackPhone) => {
    const jwt = data.access_token || data.token || data.jwt;
    if (!jwt) throw new Error("No token returned by server.");
    const claims = parseJwt(jwt);
    const role = data.role || data.user?.role || claims.role || fallbackRole || "user";
    const uid = data.id ?? data.user?.id ?? claims.sub ?? null;

    setToken(jwt);
    setCurrentUser({
      id: uid,
      name: data.name || data.user?.name || fallbackName || "",
      email: data.email || data.user?.email || fallbackEmail || "",
      role,
      phone_number: data.phone_number || data.user?.phone_number || fallbackPhone || "",
    });
    setAuthForm({ name: "", email: "", password: "", phone_number: "", role: "user" });

    // Reset every piece of per-user state so nothing leaks from a prior session.
    const userSessions = loadUserSessions(uid);
    setSessions(userSessions);
    setActiveSessionId(userSessions[0].id);
    setMessages(userSessions[0].messages);
    setInput("");
    setBrokerListings(null);
    setBrokerLeads(null);
    setBrokerError("");
    setShowListingForm(false);
    setListingForm(EMPTY_LISTING);
    setListingImages([]);
    setListingError("");
    setInterestState({});
    setVerifyResult(null);
    setSelectedFiles([]);

    navigate(role === "broker" ? VIEW_PATHS["broker-dashboard"] : VIEW_PATHS["property-dashboard"]);
  };

  const handleSignup = async (e) => {
    e.preventDefault();
    if (authLoading) return;
    setAuthError("");
    const { name, email, password, phone_number, role } = authForm;
    if (!name.trim() || !email.trim() || !password.trim()) {
      setAuthError("Name, email and password are required.");
      return;
    }
    setAuthLoading(true);
    try {
      const res = await fetch(API_SIGNUP_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), password, phone_number: phone_number.trim(), role }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(errDetail(data, "Signup failed"));
      applyAuthSuccess(data, role, name.trim(), email.trim(), phone_number.trim());
    } catch (err) {
      setAuthError(err.message || "Unable to reach the authentication service.");
    } finally {
      setAuthLoading(false);
    }
  };
  
  async function requestNotificationPermission(userId) {
    if ('serviceWorker' in navigator && 'PushManager' in window) {
        try {
            const registration = await navigator.serviceWorker.register('/sw.js');
            const permission = await window.Notification.requestPermission();
            
            if (permission === 'granted') {
                const subscription = await registration.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDkJrxZJezsTu...' 
                });
                
                await fetch('http://localhost:8000/api/v1/subscribe', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ user_id: userId, ...subscription })
                });
            }
        } catch (err) {
            console.error("Push subscription failed:", err);
        }
    }
}

  const handleLogin = async (e) => {
    e.preventDefault();
    if (authLoading) return;
    setAuthError("");
    const { email, password } = authForm;
    if (!email.trim() || !password.trim()) {
      setAuthError("Email and password are required.");
      return;
    }
    setAuthLoading(true);
    try {
      // Backend /auth/login uses FastAPI's OAuth2PasswordRequestForm:
      // form-encoded body with `username` (our email) and `password`.
      const body = new URLSearchParams();
      body.append("username", email.trim());
      body.append("password", password);
      const res = await fetch(API_LOGIN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(errDetail(data, "Invalid credentials"));
      applyAuthSuccess(data, null, null, email.trim(), null);
    } catch (err) {
      setAuthError(err.message || "Unable to reach the authentication service.");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = () => {
    setToken(null);
    setCurrentUser(null);
    setAuthForm({ name: "", email: "", password: "", phone_number: "", role: "user" });
    setAuthError("");
    // Wipe chat state from memory (the user's history stays under their own
    // localStorage key and reloads when they sign back in).
    setSessions([]);
    setActiveSessionId("");
    setMessages([{ ...WELCOME_MESSAGE }]);
    setInput("");
    setBrokerListings(null);
    setBrokerError("");
    setBrokerLeads(null);
    setShowListingForm(false);
    setListingForm(EMPTY_LISTING);
    setListingImages([]);
    setListingError("");
    setInterestState({});
    setVerifyResult(null);
    setSelectedFiles([]);
    navigate(VIEW_PATHS.login);
  };

  // Login <-> Signup is a lateral toggle within the same step of the auth
  // flow, not a forward step, so it replaces rather than pushes history.
  const switchAuthMode = (mode) => {
    navigate(VIEW_PATHS[mode], { replace: true });
    setAuthError("");
  };

  // --- Broker dashboard data ----------------------------------------------
  const fetchBrokerListings = async () => {
    if (!token) return;
    setBrokerLoading(true);
    setBrokerError("");
    try {
      const res = await fetch(API_BROKER_LISTINGS_URL, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Failed to load listings");
      setBrokerListings(Array.isArray(data) ? data : []);
    } catch (err) {
      setBrokerError(err.message || "Unable to load your listings.");
      setBrokerListings([]);
    } finally {
      setBrokerLoading(false);
    }
  };

  const fetchBrokerLeads = async () => {
    if (!token) return;
    try {
      const res = await fetch(API_BROKER_LEADS_URL, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      setBrokerLeads(res.ok && Array.isArray(data) ? data : []);
    } catch {
      setBrokerLeads([]);
    }
  };

  useEffect(() => {
    if (isBroker && activeView === "broker-dashboard" && brokerListings === null && !brokerLoading) {
      fetchBrokerListings();
      fetchBrokerLeads();
    }
  }, [isBroker, activeView]);

  // A user taps "Interested" on one of our broker listings shown in chat.
  const handleExpressInterest = async (propertyId) => {
    if (interestState[propertyId]?.loading || interestState[propertyId]?.data) return;
    setInterestState((s) => ({ ...s, [propertyId]: { loading: true } }));
    try {
      const res = await fetch(API_INTEREST_URL(propertyId), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(errDetail(data, "Could not register your interest"));
      setInterestState((s) => ({ ...s, [propertyId]: { loading: false, data } }));
    } catch (err) {
      setInterestState((s) => ({ ...s, [propertyId]: { loading: false, error: err.message } }));
    }
  };

  const setListingField = (k) => (e) => setListingForm((f) => ({ ...f, [k]: e.target.value }));

  const handleListingImageSelect = (e) => {
    if (!e.target.files) return;
    const picked = Array.from(e.target.files).filter((file) => file.type.startsWith("image/"));
    setListingImages((prev) => [...prev, ...picked].slice(0, 10));
    e.target.value = ""; // allow re-selecting the same file
  };

  const removeListingImage = (index) => {
    setListingImages((prev) => prev.filter((_, i) => i !== index));
  };

  const handleCreateListing = async (e) => {
    e.preventDefault();
    if (listingSubmitting) return;
    setListingError("");
    const f = listingForm;
    if (!f.property_name.trim() || !f.city.trim() || !f.location.trim() || !String(f.price_in_inr).trim() || !String(f.area_sqft).trim()) {
      setListingError("Property name, city, location, price and area are required.");
      return;
    }
    if (listingImages.length === 0) {
      setListingError("Please attach at least one property image.");
      return;
    }
    setListingSubmitting(true);
    try {
      const fd = new FormData();
      fd.append("property_name", f.property_name.trim());
      fd.append("city", f.city.trim());
      fd.append("location", f.location.trim());
      fd.append("price_in_inr", String(Number(f.price_in_inr)));
      fd.append("area_sqft", String(Number(f.area_sqft)));
      fd.append("property_type", f.property_type);
      fd.append("listing_type", f.listing_type);
      fd.append("area_unit", f.area_unit.trim() || "sqft");
      fd.append("availability_status", f.availability_status);
      if (f.listing_type === "Rent" && String(f.security_deposit).trim() !== "") {
        fd.append("security_deposit", String(Number(f.security_deposit)));
      }
      if (String(f.bhk).trim() !== "") fd.append("bhk", String(Number(f.bhk)));
      if (f.builder_name.trim()) fd.append("builder_name", f.builder_name.trim());
      if (f.amenities.trim()) fd.append("amenities", f.amenities.trim());
      listingImages.forEach((file) => fd.append("images", file));

      // No Content-Type header — the browser sets the multipart boundary itself.
      const res = await fetch(API_BROKER_CREATE_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(errDetail(data, "Could not create listing"));
      setBrokerListings((prev) => [data, ...(prev || [])]);
      setListingForm(EMPTY_LISTING);
      setListingImages([]);
      setShowListingForm(false);
    } catch (err) {
      setListingError(err.message || "Could not create listing.");
    } finally {
      setListingSubmitting(false);
    }
  };

  const renderIntentBadge = (intent, filters) => {
    switch (intent) {
      case "sql_search":
        return (
          <div className="flex flex-wrap items-center gap-2 mb-2.5">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-sm text-[10px] font-semibold uppercase tracking-wider bg-[#D9EAD3]/40 text-[#4B7A46] border border-[#A9C9A0]/40 font-mono">
              <Database className="w-3 h-3" /> Property Registry Query
            </span>
            {filters && Object.keys(filters).length > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm text-[10px] font-mono bg-[#1E1E1E]/80 text-[#6B6B6B] border border-[#EDE6D4]">
                <SlidersHorizontal className="w-3 h-3 text-[#C6A15B]" />
                {Object.entries(filters).map(([k, v]) => `${k}: ${v}`).join("  ·  ")}
              </span>
            )}
          </div>
        );
      case "rag_search":
        return (
          <div className="mb-2.5">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-sm text-[10px] font-semibold uppercase tracking-wider bg-[#ECE3F5]/40 text-[#8A5FAE] border border-[#C9AEDD]/40 font-mono">
              <FileText className="w-3 h-3" /> Brochure Archive
            </span>
          </div>
        );
      case "web_search":
        return (
          <div className="mb-2.5">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-sm text-[10px] font-semibold uppercase tracking-wider bg-[#E1EFF7]/40 text-[#3E7CA6] border border-[#B9D9EC]/40 font-mono">
              <Globe className="w-3 h-3" /> Live Market Insight
            </span>
          </div>
        );
      default:
        return null;
    }
  };

  // --- Auth screen (login / signup) --------------------------------------
  const renderAuthScreen = () => {
    const isSignup = activeView === "signup";
    const inputCls =
      "w-full bg-[#FAF8F4] border border-[#E4DCC9] focus:border-[#C6A15B] rounded-md py-2.5 pl-9 pr-3 text-sm text-[#2B2B2B] placeholder-[#8B8B8B] focus:outline-none focus:ring-2 focus:ring-[#C6A15B]/30 transition disabled:opacity-50";
    const setField = (k) => (e) => setAuthForm((f) => ({ ...f, [k]: e.target.value }));

    return (
      <div
        className="flex-1 relative flex items-center justify-center z-10 p-6 font-body overflow-y-auto"
        style={{
          backgroundImage: `linear-gradient(160deg, rgba(30,26,20,0.85) 0%, rgba(30,26,20,0.62) 45%, rgba(20,20,20,0.5) 100%), url(${AUTH_BG_IMAGE})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      >
        {/* Editorial corner copy, echoing the landing page hero — hidden on
            small screens so it never competes with the card for space. */}
        <div className="hidden lg:block absolute bottom-10 left-10 max-w-xs">
          <p className="text-[10px] font-mono uppercase tracking-[0.3em] text-[#C6A15B] font-semibold mb-2">
            Private Client Real Estate
          </p>
          <p className="font-display text-xl leading-snug text-[#F3EEE1]">
            Find a home that matches how you actually live.
          </p>
        </div>

        <div className="w-full max-w-md bg-white/95 backdrop-blur-md border border-[#E4DCC9] rounded-md shadow-2xl p-8 space-y-6 my-6">
          <div className="flex items-center gap-3">
            <CasivaLogo className="w-10 h-10" />
            <div>
              <h1 className="font-display text-xl text-[#2B2B2B] leading-none tracking-[0.15em]">CASIVA</h1>
              <p className="text-[9px] font-mono uppercase tracking-[0.15em] text-[#8A6C34] mt-1">Private Client Advisory</p>
            </div>
          </div>

          <div className="flex gap-1 p-1 bg-[#FAF8F4]/80 border border-[#E4DCC9] rounded-sm font-mono">
            {[["login", "Login"], ["signup", "Sign Up"]].map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                onClick={() => switchAuthMode(mode)}
                className={`flex-1 py-2 rounded-sm text-[11px] font-semibold uppercase tracking-wider transition ${
                  activeView === mode ? "bg-[#C6A15B] text-[#1E1E1E]" : "text-[#5B5B5B] hover:bg-[#F1E9D8]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <form onSubmit={isSignup ? handleSignup : handleLogin} className="space-y-3.5">
            {isSignup && (
              <div className="relative">
                <User className="w-4 h-4 text-[#8B8B8B] absolute left-3 top-1/2 -translate-y-1/2" />
                <input id="auth-name" name="name" className={inputCls} type="text" placeholder="Full name" value={authForm.name}
                  onChange={setField("name")} autoComplete="name" disabled={authLoading} />
              </div>
            )}

            <div className="relative">
              <Mail className="w-4 h-4 text-[#8B8B8B] absolute left-3 top-1/2 -translate-y-1/2" />
              <input id="auth-email" name="email" className={inputCls} type="email" placeholder="Email address" value={authForm.email}
                onChange={setField("email")} autoComplete="email" disabled={authLoading} />
            </div>

            <div className="relative">
              <Lock className="w-4 h-4 text-[#8B8B8B] absolute left-3 top-1/2 -translate-y-1/2" />
              <input id="auth-password" name="password" className={inputCls} type="password" placeholder="Password" value={authForm.password}
                onChange={setField("password")} autoComplete={isSignup ? "new-password" : "current-password"} disabled={authLoading} />
            </div>

            {isSignup && (
              <div className="relative">
                <Phone className="w-4 h-4 text-[#8B8B8B] absolute left-3 top-1/2 -translate-y-1/2" />
                <input id="auth-phone_number" name="phone_number" className={inputCls} type="tel" placeholder="Phone number" value={authForm.phone_number}
                  onChange={setField("phone_number")} autoComplete="tel" disabled={authLoading} />
              </div>
            )}

            {isSignup && (
              <div className="space-y-1.5 pt-0.5">
                <label className="text-[10px] font-mono uppercase tracking-wider text-[#C6A15B] font-semibold">Account Type</label>
                <div className="grid grid-cols-2 gap-2">
                  {[["user", "Sign up as User", User], ["broker", "Sign up as Broker", Briefcase]].map(([val, label, Icon]) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => setAuthForm((f) => ({ ...f, role: val }))}
                      className={`flex items-center justify-center gap-1.5 px-2 py-2 rounded-sm text-[11px] font-mono font-semibold border transition ${
                        authForm.role === val
                          ? "bg-[#C6A15B] text-[#1E1E1E] border-[#C6A15B]"
                          : "bg-[#F1E9D8] text-[#5B5B5B] border-[#E4DCC9] hover:border-[#C6A15B]/40"
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" /> {label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {authError && (
              <div className="flex items-start gap-2 p-2.5 bg-[#FBEAEA]/25 border border-[#C24545]/40 rounded-sm text-xs text-[#C24545] font-body">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                <span>{authError}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={authLoading}
              className="flex items-center justify-center gap-2 w-full py-2.5 px-4 rounded-sm bg-[#C6A15B] hover:bg-[#D9B876] disabled:opacity-40 text-[#1E1E1E] font-semibold text-xs transition shadow-lg font-mono uppercase tracking-wider"
            >
              {authLoading ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Please wait...</>
              ) : isSignup ? (
                <><UserPlus className="w-4 h-4" /> Create Account</>
              ) : (
                <><LogIn className="w-4 h-4" /> Sign In</>
              )}
            </button>
          </form>

          <p className="text-center text-[11px] text-[#8B8B8B] font-body">
            {isSignup ? "Already registered? " : "New to CASIVA? "}
            <button
              type="button"
              onClick={() => switchAuthMode(isSignup ? "login" : "signup")}
              className="text-[#C6A15B] hover:underline font-medium"
            >
              {isSignup ? "Log in" : "Create an account"}
            </button>
          </p>
        </div>
      </div>
    );
  };

  // --- Broker dashboard --------------------------------------------------
  const renderBrokerDashboard = () => (
    <main className="flex-1 flex flex-col h-full relative z-10">
      <header className="h-16 border-b border-[#E4DCC9] flex items-center justify-between px-6 bg-white font-body">
        <div className="flex items-center gap-3">
          <CasivaLogo className="w-7 h-7" />
          <span className="font-display text-sm tracking-[0.15em] text-[#2B2B2B]">CASIVA</span>
          <span className="w-px h-5 bg-[#E4DCC9]" />
          <div className="flex items-center gap-1.5 text-[#8A6C34]">
            <Briefcase className="w-4 h-4" />
          </div>
          <h2 className="text-sm font-semibold tracking-wide text-[#5B5B5B] font-display">Broker Dashboard</h2>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-[10px] font-mono bg-[#F1E9D8] text-[#C6A15B] border border-[#C6A15B]/25 px-3 py-1 rounded-sm uppercase tracking-wider hidden sm:block">
            {currentUser?.email}
          </div>
          <button
            onClick={() => navigate(VIEW_PATHS.profile)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#F1E9D8] hover:bg-[#E9DFC8] text-[#5B5B5B] border border-[#E4DCC9] rounded-sm text-xs font-mono transition"
          >
            <UserCircle className="w-3.5 h-3.5 text-[#C6A15B]" /> My Profile
          </button>
          <button
            onClick={handleLogout}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#F1E9D8] hover:bg-[#E9DFC8] text-[#5B5B5B] border border-[#E4DCC9] rounded-sm text-xs font-mono transition"
          >
            <LogOut className="w-3.5 h-3.5" /> Logout
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-8 font-body space-y-6 max-w-5xl mx-auto w-full">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h3 className="text-lg font-display text-[#2B2B2B]">Welcome back, {currentUser?.name || "Broker"}</h3>
            <p className="text-xs text-[#8B8B8B] mt-1">Property listings linked to your broker account.</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => { setListingError(""); setShowListingForm((v) => !v); }}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-sm text-xs font-mono transition border ${
                showListingForm
                  ? "bg-[#F1E9D8] text-[#5B5B5B] border-[#E4DCC9] hover:bg-[#E9DFC8]"
                  : "bg-[#C6A15B] text-[#1E1E1E] border-[#C6A15B] hover:bg-[#D9B876] font-semibold uppercase tracking-wider"
              }`}
            >
              {showListingForm ? <><X className="w-3.5 h-3.5" /> Cancel</> : <><Plus className="w-3.5 h-3.5" /> Add Listing</>}
            </button>
            <button
              onClick={fetchBrokerListings}
              disabled={brokerLoading}
              className="flex items-center gap-2 px-3 py-1.5 bg-[#F1E9D8] hover:bg-[#E9DFC8] text-[#5B5B5B] border border-[#E4DCC9] rounded-sm text-xs font-mono transition disabled:opacity-50"
            >
              <RotateCcw className={`w-3 h-3 text-[#C6A15B] ${brokerLoading ? "animate-spin" : ""}`} /> Refresh
            </button>
          </div>
        </div>

        {showListingForm && (
          <form
            onSubmit={handleCreateListing}
            className="bg-[#FFFFFF]/80 border border-[#C6A15B]/30 rounded-md p-5 space-y-4 shadow-2xl"
          >
            <h4 className="text-xs font-mono uppercase tracking-wider text-[#C6A15B] font-semibold">New Property Listing</h4>

            <div className="space-y-1.5">
              <span className="text-[10px] font-mono uppercase tracking-wider text-[#8B8B8B]">Listing For *</span>
              <div className="grid grid-cols-2 gap-2">
                {[["Sale", "For Sale", Tag], ["Rent", "For Rent", KeyRound]].map(([val, label, Icon]) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setListingForm((f) => ({ ...f, listing_type: val }))}
                    disabled={listingSubmitting}
                    className={`flex items-center justify-center gap-1.5 px-2 py-2 rounded-sm text-[11px] font-mono font-semibold border transition disabled:opacity-50 ${
                      listingForm.listing_type === val
                        ? "bg-[#C6A15B] text-[#1E1E1E] border-[#C6A15B]"
                        : "bg-[#FAF8F4] text-[#5B5B5B] border-[#E4DCC9] hover:border-[#C6A15B]/40"
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" /> {label}
                  </button>
                ))}
              </div>
            </div>

            {(() => {
              const fieldCls =
                "w-full bg-[#FAF8F4]/90 border border-[#E4DCC9] focus:border-[#C6A15B] rounded-md py-2 px-3 text-sm text-[#2B2B2B] placeholder-[#8B8B8B] focus:outline-none focus:ring-2 focus:ring-[#C6A15B]/30 transition disabled:opacity-50";
              const labelCls = "text-[10px] font-mono uppercase tracking-wider text-[#8B8B8B]";
              const isRent = listingForm.listing_type === "Rent";
              return (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="space-y-1 sm:col-span-2">
                    <span className={labelCls}>Property Name *</span>
                    <input className={fieldCls} value={listingForm.property_name} onChange={setListingField("property_name")} placeholder="Skyline Residences" disabled={listingSubmitting} />
                  </label>
                  <label className="space-y-1">
                    <span className={labelCls}>City *</span>
                    <input className={fieldCls} value={listingForm.city} onChange={setListingField("city")} placeholder="Indore" disabled={listingSubmitting} />
                  </label>
                  <label className="space-y-1">
                    <span className={labelCls}>Location / Area *</span>
                    <input className={fieldCls} value={listingForm.location} onChange={setListingField("location")} placeholder="Vijay Nagar" disabled={listingSubmitting} />
                  </label>
                  <label className="space-y-1">
                    <span className={labelCls}>{isRent ? "Monthly Rent (INR) *" : "Price (INR) *"}</span>
                    <input className={fieldCls} type="number" min="0" value={listingForm.price_in_inr} onChange={setListingField("price_in_inr")} placeholder={isRent ? "18000" : "9500000"} disabled={listingSubmitting} />
                  </label>
                  {isRent && (
                    <label className="space-y-1">
                      <span className={labelCls}>Security Deposit (INR)</span>
                      <input className={fieldCls} type="number" min="0" value={listingForm.security_deposit} onChange={setListingField("security_deposit")} placeholder="50000" disabled={listingSubmitting} />
                    </label>
                  )}
                  <label className="space-y-1">
                    <span className={labelCls}>BHK</span>
                    <input className={fieldCls} type="number" min="0" value={listingForm.bhk} onChange={setListingField("bhk")} placeholder="3 (leave blank for plots)" disabled={listingSubmitting} />
                  </label>
                  <label className="space-y-1">
                    <span className={labelCls}>Area *</span>
                    <input className={fieldCls} type="number" min="0" value={listingForm.area_sqft} onChange={setListingField("area_sqft")} placeholder="1450" disabled={listingSubmitting} />
                  </label>
                  <label className="space-y-1">
                    <span className={labelCls}>Area Unit</span>
                    <select className={fieldCls} value={listingForm.area_unit} onChange={setListingField("area_unit")} disabled={listingSubmitting}>
                      {["sqft", "sq_yard", "acre", "hectare"].map((u) => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className={labelCls}>Property Type</span>
                    <select className={fieldCls} value={listingForm.property_type} onChange={setListingField("property_type")} disabled={listingSubmitting}>
                      {["Apartment", "Villa", "Plot", "Commercial", "Independent House"].map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className={labelCls}>Availability</span>
                    <select className={fieldCls} value={listingForm.availability_status} onChange={setListingField("availability_status")} disabled={listingSubmitting}>
                      {["Ready to Move", "Under Construction", "New Launch"].map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className={labelCls}>Builder Name</span>
                    <input className={fieldCls} value={listingForm.builder_name} onChange={setListingField("builder_name")} placeholder="ABC Group" disabled={listingSubmitting} />
                  </label>
                  <label className="space-y-1 sm:col-span-2">
                    <span className={labelCls}>Amenities</span>
                    <input className={fieldCls} value={listingForm.amenities} onChange={setListingField("amenities")} placeholder="Pool, Gym, Clubhouse" disabled={listingSubmitting} />
                  </label>
                </div>
              );
            })()}

            <div className="space-y-2">
              <span className="text-[10px] font-mono uppercase tracking-wider text-[#8B8B8B]">
                Property Images * ({listingImages.length}/10)
              </span>
              <label className="flex flex-col items-center justify-center gap-1 border-2 border-dashed border-[#E4DCC9] hover:border-[#C6A15B]/50 rounded-md p-5 text-center bg-[#FAF8F4]/60 transition cursor-pointer">
                <input type="file" multiple accept="image/*" className="hidden" onChange={handleListingImageSelect} disabled={listingSubmitting} />
                <Upload className="w-6 h-6 text-[#C6A15B]" />
                <span className="text-xs text-[#5B5B5B] font-medium">Click to add photos (JPG, PNG, WebP, GIF)</span>
              </label>
              {listingImages.length > 0 && (
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                  {listingImages.map((file, idx) => (
                    <div key={idx} className="relative group rounded-md overflow-hidden border border-[#E4DCC9] bg-[#FAF8F4] h-20">
                      <img src={URL.createObjectURL(file)} alt={file.name} className="w-full h-full object-cover" />
                      <button
                        type="button"
                        onClick={() => removeListingImage(idx)}
                        disabled={listingSubmitting}
                        className="absolute top-1 right-1 p-1 bg-red-600/90 hover:bg-red-700 text-white rounded-full transition opacity-0 group-hover:opacity-100"
                        title="Remove image"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {listingError && (
              <div className="flex items-start gap-2 p-2.5 bg-[#FBEAEA]/25 border border-[#C24545]/40 rounded-sm text-xs text-[#C24545] font-body">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                <span>{listingError}</span>
              </div>
            )}

            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={listingSubmitting}
                className="flex items-center justify-center gap-2 px-4 py-2 rounded-sm bg-[#C6A15B] hover:bg-[#D9B876] disabled:opacity-40 text-[#1E1E1E] font-semibold text-xs transition font-mono uppercase tracking-wider"
              >
                {listingSubmitting ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</> : <><Plus className="w-4 h-4" /> Create Listing</>}
              </button>
              <button
                type="button"
                onClick={() => { setShowListingForm(false); setListingError(""); }}
                disabled={listingSubmitting}
                className="px-4 py-2 rounded-sm bg-[#F1E9D8] hover:bg-[#E9DFC8] text-[#5B5B5B] border border-[#E4DCC9] text-xs font-mono transition disabled:opacity-40"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {brokerLoading && (
          <div className="flex items-center gap-2 text-xs text-[#8B8B8B] font-mono">
            <Loader2 className="w-4 h-4 animate-spin text-[#C6A15B]" /> Loading your listings...
          </div>
        )}

        {brokerError && (
          <div className="flex items-start gap-2 p-3 bg-[#FBEAEA]/25 border border-[#C24545]/40 text-[#C24545] text-xs rounded-sm font-mono">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" /> {brokerError}
          </div>
        )}

        {!brokerLoading && brokerListings && brokerListings.length === 0 && (
          <div className="p-8 bg-[#FFFFFF]/80 border border-[#E4DCC9] rounded-md text-center text-xs text-[#8B8B8B] font-body">
            No property listings are linked to your account yet.
          </div>
        )}

        {brokerListings && brokerListings.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {brokerListings.map((p) => (
              <div key={p.id} className="bg-[#FFFFFF]/80 border border-[#E4DCC9] rounded-md p-4 space-y-2 shadow-xl">
                {Array.isArray(p.image_urls) && p.image_urls.length > 0 && (
                  <div className="flex gap-1.5 overflow-x-auto no-scrollbar -mx-1 px-1 pb-1">
                    {p.image_urls.map((url, i) => (
                      <img
                        key={i}
                        src={resolveImg(url)}
                        alt={`${p.property_name} photo ${i + 1}`}
                        loading="lazy"
                        onClick={() => setLightboxSrc(resolveImg(url))}
                        className="h-24 w-32 flex-shrink-0 object-cover rounded-sm border border-[#E4DCC9] bg-[#FAF8F4] cursor-zoom-in hover:brightness-110 transition"
                      />
                    ))}
                  </div>
                )}
                <div className="flex items-start justify-between gap-2">
                  <h4 className="text-sm font-display text-[#2B2B2B]">{p.property_name}</h4>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <span className={`text-[9px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-sm ${
                      p.listing_type === "Rent"
                        ? "bg-[#F1E9D8] text-[#8A6C34] border border-[#C6A15B]/40"
                        : "bg-[#E4E9F5]/60 text-[#3B5998] border border-[#C3CCE8]"
                    }`}>
                      {p.listing_type === "Rent" ? "For Rent" : "For Sale"}
                    </span>
                    {p.availability_status && (
                      <span className="text-[9px] font-mono uppercase tracking-wider bg-[#D9EAD3]/40 text-[#4B7A46] border border-[#A9C9A0]/40 px-2 py-0.5 rounded-sm">
                        {p.availability_status}
                      </span>
                    )}
                  </div>
                </div>
                <p className="text-[11px] text-[#8B8B8B] font-mono flex items-center gap-1.5">
                  <MapPin className="w-3 h-3 text-[#C6A15B]" /> {p.location}{p.city ? `, ${p.city}` : ""}
                </p>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-mono text-[#6B6B6B] pt-2 border-t border-[#E4DCC9]/60">
                  <span className="text-[#2B2B2B] font-semibold">{formatPrice(p)}</span>
                  {p.bhk != null && (
                    <span className="flex items-center gap-1"><BedDouble className="w-3 h-3 text-[#6B9A5E]" /> {p.bhk} BHK</span>
                  )}
                  {p.area_sqft != null && <span>{p.area_sqft} {p.area_unit || "sqft"}</span>}
                  {p.property_type && <span className="text-[#8B8B8B]">{p.property_type}</span>}
                </div>
                <div className="pt-1 flex justify-end">
                  <button
                    type="button"
                    onClick={() => setEditingListing(p)}
                    className="flex items-center gap-1.5 px-2.5 py-1 bg-[#F1E9D8] hover:bg-[#E9DFC8] text-[#5B5B5B] border border-[#E4DCC9] rounded-sm text-[10px] font-mono uppercase tracking-wider transition"
                  >
                    <Pencil className="w-3 h-3 text-[#C6A15B]" /> Edit Listing
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Enquiries: users who tapped "Interested" on this broker's listings */}
        <div className="space-y-3 pt-2">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-display text-[#2B2B2B] flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-[#C6A15B]" /> Enquiries
            </h3>
            {brokerLeads && brokerLeads.length > 0 && (
              <span className="text-[10px] font-mono bg-[#C6A15B] text-[#1E1E1E] px-2 py-0.5 rounded-sm font-semibold">
                {brokerLeads.length}
              </span>
            )}
            <button
              onClick={fetchBrokerLeads}
              className="ml-auto flex items-center gap-1.5 px-2.5 py-1 bg-[#F1E9D8] hover:bg-[#E9DFC8] text-[#5B5B5B] border border-[#E4DCC9] rounded-sm text-[10px] font-mono transition"
            >
              <RotateCcw className="w-3 h-3 text-[#C6A15B]" /> Refresh
            </button>
          </div>

          {brokerLeads === null ? (
            <p className="text-xs text-[#8B8B8B] font-mono">Loading enquiries...</p>
          ) : brokerLeads.length === 0 ? (
            <div className="p-6 bg-[#FFFFFF]/80 border border-[#E4DCC9] rounded-md text-center text-xs text-[#8B8B8B] font-body">
              No one has expressed interest in your listings yet.
            </div>
          ) : (
            <div className="space-y-2">
              {brokerLeads.map((lead) => (
                <div key={lead.interest_id} className="bg-[#FFFFFF]/80 border border-[#E4DCC9] rounded-md p-3.5 space-y-1.5 shadow-lg">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm text-[#2B2B2B] font-medium">
                      {lead.user?.name || "A user"} <span className="text-[#8B8B8B] font-normal">is interested in</span> {lead.property_name}
                    </p>
                    <span className="text-[9px] font-mono text-[#8B8B8B] flex-shrink-0">
                      {lead.created_at ? new Date(lead.created_at).toLocaleDateString() : ""}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-mono text-[#6B6B6B]">
                    {lead.user?.phone && <span>📞 {lead.user.phone}</span>}
                    {lead.user?.email && <span>✉️ {lead.user.email}</span>}
                    <span className="text-[#8B8B8B]">{lead.location}{lead.city ? `, ${lead.city}` : ""}</span>
                  </div>
                  {lead.message && <p className="text-[11px] text-[#6B6B6B] italic border-l-2 border-[#C6A15B]/40 pl-2">{`“${lead.message}”`}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <BrokerAssistant token={token} />

      {editingListing && (
        <EditListingModal
          token={token}
          listing={editingListing}
          onClose={() => setEditingListing(null)}
          onSaved={(updated) => {
            setBrokerListings((prev) => (prev || []).map((p) => (p.id === updated.id ? updated : p)));
            setEditingListing(null);
          }}
          onDeleted={(id) => {
            setBrokerListings((prev) => (prev || []).filter((p) => p.id !== id));
            setEditingListing(null);
          }}
        />
      )}
    </main>
  );

  return (
    <div className="flex h-screen w-full bg-[#FAF8F4] text-[#2B2B2B] antialiased overflow-hidden font-sans relative">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');
        .font-display { font-family: 'Fraunces', serif; font-optical-sizing: auto; }
        .font-body { font-family: 'Inter', sans-serif; }
        .font-mono { font-family: 'IBM Plex Mono', monospace; }
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>

      {/*
        Rendered purely off the URL (activeView), not off auth state, so that
        browser back/forward landing on /login or /signup after the user is
        already authenticated (per the required history breadcrumb) still
        shows something coherent instead of a blank screen. Unauthenticated
        access to a protected path is handled by the route-guard effect
        above, which redirects to /login before this ever renders.
      */}
      {(activeView === "login" || activeView === "signup") && renderAuthScreen()}

      {isBroker && activeView === "broker-dashboard" && renderBrokerDashboard()}

      {isAuthed && !isBroker && activeView === "property-dashboard" && (
        <PropertyDashboard
          token={token}
          currentUser={currentUser}
          onAskAI={() => { navigate(VIEW_PATHS.chat); createNewChat(); }}
          onProfile={() => navigate(VIEW_PATHS.profile)}
          onLogout={handleLogout}
        />
      )}

      {isAuthed && activeView === "profile" && (
        <MyProfile
          token={token}
          currentUser={currentUser}
          onBack={() => navigate(isBroker ? VIEW_PATHS["broker-dashboard"] : VIEW_PATHS["property-dashboard"])}
          onLogout={handleLogout}
          onUserUpdated={(patch) => setCurrentUser((u) => (u ? { ...u, ...patch } : u))}
        />
      )}

      {isAuthed && !isBroker && (activeView === "chat" || activeView === "verify") && (
      <>
      {/* SIDEBAR WITH CHAT HISTORY & NEW CHAT */}
      <aside className="w-80 bg-white border-r border-[#E4DCC9] flex flex-col justify-between p-5 hidden md:flex z-10 shadow-sm font-body">
        <div className="space-y-5 flex-1 flex flex-col min-h-0">
          <div className="flex items-center gap-2.5 pb-4 border-b border-[#E4DCC9] flex-shrink-0">
            <CasivaLogo className="w-8 h-8" />
            <div>
              <h1 className="font-display text-base leading-none tracking-[0.15em] text-[#2B2B2B]">CASIVA</h1>
              <p className="text-[9px] font-mono uppercase tracking-[0.15em] text-[#8A6C34] mt-1">Private Client Advisory</p>
            </div>
          </div>

          <button
            onClick={() => { navigate(VIEW_PATHS.chat); createNewChat(); }}
            className="flex items-center justify-center gap-2 w-full py-2.5 px-4 rounded-sm bg-[#C6A15B] hover:bg-[#D9B876] text-[#1E1E1E] font-semibold text-xs transition shadow-lg font-mono uppercase tracking-wider flex-shrink-0"
          >
            <Plus className="w-4 h-4" /> New Chat
          </button>

          <button
            onClick={() => navigate(VIEW_PATHS["property-dashboard"])}
            className="flex items-center justify-center gap-2 w-full py-2 px-3 rounded-sm bg-[#F1E9D8] hover:bg-[#E9DFC8] text-[#5B5B5B] font-medium text-xs transition border border-[#E4DCC9] font-mono uppercase tracking-wider flex-shrink-0"
          >
            <Home className="w-3.5 h-3.5 text-[#8A6C34]" /> Browse Properties
          </button>

          {/* Chat History List */}
          <div className="flex-1 overflow-y-auto space-y-1.5 no-scrollbar pr-1">
            <p className="text-[10px] font-mono font-semibold uppercase tracking-[0.15em] text-[#8B8B8B] px-1 pt-1 pb-1">Chat History</p>
            {sessions.map((sess) => (
              <div
                key={sess.id}
                onClick={() => { navigate(VIEW_PATHS.chat); switchSession(sess.id); }}
                className={`w-full text-left p-2.5 rounded-sm border transition text-xs flex items-center justify-between group cursor-pointer ${
                  activeView === "chat" && activeSessionId === sess.id
                    ? "bg-[#E9DFC8] border-[#C6A15B]/50 text-[#2B2B2B]"
                    : "bg-[#F1E9D8]/50 hover:bg-[#E9DFC8]/80 border-[#E4DCC9] text-[#5B5B5B]"
                }`}
              >
                <div className="flex items-center gap-2 overflow-hidden">
                  <MessageSquare className="w-3.5 h-3.5 text-[#C6A15B] flex-shrink-0" />
                  <span className="truncate">{sess.title}</span>
                </div>
                {sessions.length > 1 && (
                  <button onClick={(e) => deleteSession(e, sess.id)} className="opacity-0 group-hover:opacity-100 hover:text-red-400 text-[#8B8B8B] transition p-1" title="Delete Chat">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="pt-3 border-t border-[#C6A15B]/15 flex-shrink-0 space-y-2">
          <div className="flex items-center gap-2 px-1 text-[10px] font-mono text-[#8B8B8B] truncate">
            <User className="w-3 h-3 text-[#C6A15B] flex-shrink-0" />
            <span className="truncate">Signed in as {currentUser?.email || currentUser?.name}</span>
          </div>
          <button
            onClick={() => { navigate(VIEW_PATHS.chat); createNewChat(); }}
            className="flex items-center justify-center gap-2 w-full py-2 px-3 rounded-sm bg-[#F1E9D8]/90 hover:bg-[#E9DFC8] text-[#5B5B5B] font-medium text-xs transition border border-[#E4DCC9] hover:border-[#C6A15B]/40 font-mono uppercase tracking-wider"
          >
            <RotateCcw className="w-3 h-3 text-[#C6A15B]" /> Clear Session
          </button>
          <button
            onClick={handleLogout}
            className="flex items-center justify-center gap-2 w-full py-2 px-3 rounded-sm bg-[#FBEAEA]/30 hover:bg-[#FBEAEA]/50 text-[#C24545] font-medium text-xs transition border border-[#C24545]/30 hover:border-[#C24545]/50 font-mono uppercase tracking-wider"
          >
            <LogOut className="w-3 h-3" /> Logout
          </button>
        </div>
      </aside>

      {/* MAIN WORKSPACE VIEW CONTAINER */}
      <main className="flex-1 flex flex-col h-full relative z-10">
        <header className="h-16 border-b border-[#E4DCC9] flex items-center justify-between px-6 bg-white font-body">
          <div className="flex items-center gap-3">
            <CasivaLogo className="w-7 h-7 hidden md:block" />
            <span className="font-display text-sm tracking-[0.15em] text-[#2B2B2B] hidden md:block">CASIVA</span>
            <span className="w-px h-5 bg-[#E4DCC9] hidden md:block" />
            <span className="w-2 h-2 rounded-full bg-[#6B9A5E] animate-pulse"></span>
            <h2 className="text-sm font-semibold tracking-wide text-[#5B5B5B] font-display">
              {activeView === "chat" ? "AI Real Estate Workspace" : "Property Room Verification Engine"}
            </h2>
          </div>
          <div className="flex items-center gap-3">
            {activeView === "chat" ? (
              <button
                onClick={() => navigate(VIEW_PATHS.verify)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-[#C6A15B]/20 hover:bg-[#C6A15B]/30 text-[#C6A15B] border border-[#C6A15B]/50 rounded-sm text-xs font-mono transition"
              >
                <Sparkles className="w-3.5 h-3.5" /> 🏠 Verify Property
              </button>
            ) : (
              <button
                onClick={() => navigate(VIEW_PATHS.chat)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-[#F1E9D8] hover:bg-[#E9DFC8] text-[#5B5B5B] border border-[#E4DCC9] rounded-sm text-xs font-mono transition"
              >
                <ChevronRight className="w-3.5 h-3.5 rotate-180" /> Back to Chat
              </button>
            )}
            <button
              onClick={handleLogout}
              title="Logout"
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#FBEAEA]/30 hover:bg-[#FBEAEA]/50 text-[#C24545] border border-[#C24545]/30 hover:border-[#C24545]/50 rounded-sm text-xs font-mono transition"
            >
              <LogOut className="w-3.5 h-3.5" /> Logout
            </button>
          </div>
        </header>

        {activeView === "chat" ? (
          <>
            <div className="flex-1 overflow-y-auto p-6 space-y-6 font-body">
              {messages.map((msg, idx) => (
                <div key={idx} className={`flex items-start gap-3.5 max-w-3xl ${msg.role === "user" ? "ml-auto flex-row-reverse" : "mr-auto"}`}>
                  <div className={`p-2 rounded-full flex-shrink-0 shadow-lg border ${msg.role === "user" ? "bg-[#C6A15B] text-[#1E1E1E] border-[#C6A15B]" : "bg-[#FFFFFF] text-[#C6A15B] border-[#C6A15B]/40"}`}>
                    {msg.role === "user" ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                  </div>

                  <div className={`relative rounded-md px-5 py-3.5 shadow-xl text-sm leading-relaxed space-y-2.5 ${msg.role === "user" ? "bg-[#C6A15B] text-[#1E1E1E] rounded-tr-none shadow-black/30" : "bg-[#FFFFFF]/90 border border-[#E4DCC9] text-[#5B5B5B] rounded-tl-none shadow-black/40 pl-6"}`}>
                    {msg.role === "assistant" && <span className="absolute left-0 top-0 bottom-0 w-1.5 bg-gradient-to-b from-[#C6A15B] to-[#6B9A5E] rounded-l-md" />}

                    {msg.role === "assistant" && loading && idx === messages.length - 1 && !msg.content && (
                      <div className="flex items-center gap-2 text-xs text-[#8B8B8B] font-mono">
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-[#C6A15B]" />
                        <span>Searching...</span>
                      </div>
                    )}

                    {msg.intent && msg.role === "assistant" && renderIntentBadge(msg.intent, msg.filters)}

                    {msg.role === "assistant" && Array.isArray(msg.properties) && msg.properties.length > 0 && (
                      <div className="mb-3 space-y-2">
                        <div className="flex items-center gap-1.5 text-[11px] text-[#4B7A46] uppercase tracking-wider font-mono font-semibold pb-1 border-b border-[#D9EAD3]/40">
                          <ShieldCheck className="w-3.5 h-3.5" /> CASIVA Listings ({msg.properties.length})
                        </div>
                        {msg.properties.map((p) => {
                          const st = interestState[p.id] || {};
                          return (
                            <div key={p.id} className="rounded-sm border border-[#D9EAD3]/50 bg-[#F1F7EF]/70 p-3 space-y-2">
                              {Array.isArray(p.image_urls) && p.image_urls.length > 0 && (
                                <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
                                  {p.image_urls.map((url, i) => (
                                    <img key={i} src={resolveImg(url)} alt={`${p.property_name} ${i + 1}`} loading="lazy"
                                      onClick={() => setLightboxSrc(resolveImg(url))}
                                      className="h-20 w-28 flex-shrink-0 object-cover rounded-sm border border-[#E4DCC9] bg-[#FAF8F4] cursor-zoom-in hover:brightness-110 transition" />
                                  ))}
                                </div>
                              )}
                              <div className="flex items-start justify-between gap-2">
                                <div>
                                  <p className="text-sm font-display text-[#2B2B2B]">{p.property_name}</p>
                                  <p className="text-[11px] text-[#8B8B8B] font-mono flex items-center gap-1"><MapPin className="w-3 h-3 text-[#C6A15B]" /> {p.location}{p.city ? `, ${p.city}` : ""}</p>
                                </div>
                                <div className="flex items-center gap-1.5 flex-shrink-0">
                                  <span className={`text-[9px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-sm ${
                                    p.listing_type === "Rent"
                                      ? "bg-[#F1E9D8] text-[#8A6C34] border border-[#C6A15B]/40"
                                      : "bg-[#E4E9F5]/60 text-[#3B5998] border border-[#C3CCE8]"
                                  }`}>
                                    {p.listing_type === "Rent" ? "For Rent" : "For Sale"}
                                  </span>
                                  {p.availability_status && (
                                    <span className="text-[9px] font-mono uppercase tracking-wider bg-[#D9EAD3]/40 text-[#4B7A46] border border-[#A9C9A0]/40 px-2 py-0.5 rounded-sm">{p.availability_status}</span>
                                  )}
                                </div>
                              </div>
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-mono text-[#6B6B6B]">
                                <span className="text-[#2B2B2B] font-semibold">{formatPrice(p)}</span>
                                {p.bhk != null && <span className="flex items-center gap-1"><BedDouble className="w-3 h-3 text-[#6B9A5E]" /> {p.bhk} BHK</span>}
                                {p.area_sqft != null && <span>{p.area_sqft} {p.area_unit || "sqft"}</span>}
                                {p.property_type && <span className="text-[#8B8B8B]">{p.property_type}</span>}
                              </div>

                              {st.data ? (
                                <div className="mt-1 p-2.5 rounded-sm bg-[#FFFFFF] border border-[#A9C9A0]/40 text-[11px] space-y-1">
                                  <div className="flex items-center gap-1.5 text-[#4B7A46] font-mono uppercase tracking-wider text-[10px] font-semibold">
                                    <CheckCircle className="w-3 h-3" /> Interest sent — broker contact
                                  </div>
                                  <p className="text-[#2B2B2B]">{st.data.broker?.name || "Broker"}</p>
                                  {st.data.broker?.phone && <p className="text-[#6B6B6B] font-mono">📞 {st.data.broker.phone}</p>}
                                  {st.data.broker?.email && <p className="text-[#6B6B6B] font-mono">✉️ {st.data.broker.email}</p>}
                                  <p className="text-[10px] text-[#8B8B8B] pt-1">{st.data.notice}</p>
                                </div>
                              ) : (
                                <button
                                  onClick={() => handleExpressInterest(p.id)}
                                  disabled={st.loading}
                                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm bg-[#C6A15B] hover:bg-[#D9B876] disabled:opacity-50 text-[#1E1E1E] text-[11px] font-mono font-semibold uppercase tracking-wider transition"
                                >
                                  {st.loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                                  {st.loading ? "Sending..." : "Interested"}
                                </button>
                              )}
                              {st.error && <p className="text-[10px] text-[#C24545] font-mono">{st.error}</p>}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    <div className={`prose prose-sm max-w-none ${msg.role === "user" ? "prose-p:text-[#1E1E1E] prose-strong:text-[#1E1E1E]" : "prose-invert prose-p:text-[#5B5B5B] prose-strong:text-[#2B2B2B] prose-a:text-[#C6A15B]"}`}>
                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ node, ...props }) => (<a {...props} target="_blank" rel="noopener noreferrer" className="text-[#C6A15B] underline hover:text-[#D9B876] font-medium inline-flex items-center gap-1" />) }}>
                        {msg.content}
                      </ReactMarkdown>
                    </div>
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            <div className="px-6 py-2.5 bg-[#FFFFFF]/70 backdrop-blur-md border-t border-[#C6A15B]/15 flex items-center gap-2 overflow-x-auto no-scrollbar font-mono">
              <span className="text-[10px] font-semibold text-[#8B8B8B] uppercase tracking-[0.15em] flex-shrink-0">Quick Queries:</span>
              <button onClick={() => handleSend("Find 3 BHK flats in Indore under 3 Cr")} disabled={loading} className="text-xs bg-[#F1E9D8]/80 hover:bg-[#E9DFC8] text-[#5B5B5B] px-3 py-1.5 rounded-sm border border-[#E4DCC9] hover:border-[#C6A15B]/40 transition flex items-center gap-1.5 flex-shrink-0 disabled:opacity-50 shadow-sm">
                <Home className="w-3 h-3 text-[#6B9A5E]" />
                <span>3 BHK in Indore &lt; 3 Cr</span>
                <ChevronRight className="w-3 h-3 text-[#8B8B8B]" />
              </button>
              <button onClick={() => navigate(VIEW_PATHS.verify)} className="text-xs bg-[#C6A15B]/15 hover:bg-[#C6A15B]/25 text-[#C6A15B] px-3 py-1.5 rounded-sm border border-[#C6A15B]/40 transition flex items-center gap-1.5 flex-shrink-0 shadow-sm">
                <Sparkles className="w-3 h-3 text-[#C6A15B]" />
                <span>🏠 Verify Property Photos</span>
                <ChevronRight className="w-3 h-3 text-[#C6A15B]" />
              </button>
            </div>

            <div className="p-4 bg-[#FFFFFF]/80 backdrop-blur-xl border-t border-[#C6A15B]/15 shadow-2xl font-body">
              <form onSubmit={(e) => { e.preventDefault(); handleSend(); }} className="max-w-4xl mx-auto relative flex items-center">
                <input type="text" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Search properties, BHK sizes, live listings, or locations..." disabled={loading} className="w-full bg-[#FAF8F4]/90 border border-[#E4DCC9] focus:border-[#C6A15B] rounded-md py-4 pl-5 pr-14 text-sm text-[#2B2B2B] placeholder-[#8B8B8B] focus:outline-none focus:ring-2 focus:ring-[#C6A15B]/30 transition shadow-inner disabled:opacity-50" />
                <button type="submit" disabled={loading || !input.trim()} aria-label="Send message" className="absolute right-2.5 p-2.5 bg-[#C6A15B] hover:bg-[#D9B876] disabled:opacity-40 disabled:hover:bg-[#C6A15B] text-[#1E1E1E] rounded-sm transition shadow-lg">
                  <Send className="w-4 h-4" />
                </button>
              </form>
            </div>
          </>
        ) : (
          <div className="flex-1 overflow-y-auto p-8 font-body space-y-8 max-w-5xl mx-auto w-full">
            <div className="bg-[#FFFFFF]/80 border border-[#C6A15B]/30 p-6 rounded-md shadow-2xl space-y-6">
              <div className="flex gap-2 border-b border-[#E4DCC9] pb-4">
                <button onClick={() => setVerifyMode("photos")} className={`px-4 py-2 rounded-sm text-xs font-mono font-semibold uppercase tracking-wider transition border ${verifyMode === "photos" ? "bg-[#C6A15B] text-[#1E1E1E] border-[#C6A15B]" : "bg-[#F1E9D8] text-[#5B5B5B] border-[#E4DCC9] hover:border-[#C6A15B]/40"}`}>
                  Verify Listing
                </button>
                <button onClick={() => setVerifyMode("link")} className={`px-4 py-2 rounded-sm text-xs font-mono font-semibold uppercase tracking-wider transition border ${verifyMode === "link" ? "bg-[#C6A15B] text-[#1E1E1E] border-[#C6A15B]" : "bg-[#F1E9D8] text-[#5B5B5B] border-[#E4DCC9] hover:border-[#C6A15B]/40"}`}>
                  Verify via Link
                </button>
              </div>

              {verifyMode === "photos" && (
                <>
                  <div>
                    <h3 className="text-lg font-display text-[#2B2B2B] flex items-center gap-2"><Sparkles className="w-5 h-5 text-[#C6A15B]" /> Property Room &amp; BHK Verification</h3>
                    <p className="text-xs text-[#8B8B8B] mt-1">Upload listing photographs to independently verify declared BHK configurations using AI vision.</p>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-mono uppercase tracking-wider text-[#C6A15B] font-semibold">Select Claimed Configuration:</label>
                    <div className="flex gap-3">
                      {[1, 2, 3, 4, 5].map((bhk) => (
                        <button key={bhk} onClick={() => setSelectedBhk(bhk)} className={`px-4 py-2 rounded-sm text-xs font-mono font-semibold transition border ${selectedBhk === bhk ? "bg-[#C6A15B] text-[#1E1E1E] border-[#C6A15B]" : "bg-[#F1E9D8] text-[#5B5B5B] border-[#E4DCC9] hover:border-[#C6A15B]/40"}`}>
                          {bhk} BHK
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-mono uppercase tracking-wider text-[#C6A15B] font-semibold">Upload Room Photos (Max 12):</label>
                    <div onDragOver={(e) => e.preventDefault()} onDrop={handleFileDrop} className="border-2 border-dashed border-[#E4DCC9] hover:border-[#C6A15B]/50 rounded-md p-8 text-center bg-[#FAF8F4]/60 transition flex flex-col items-center justify-center cursor-pointer relative" onClick={() => document.getElementById("hiddenFileInput").click()}>
                      <input id="hiddenFileInput" type="file" multiple accept="image/*" className="hidden" onChange={handleFileSelect} />
                      <Upload className="w-8 h-8 text-[#C6A15B] mb-2" />
                      <p className="text-sm text-[#5B5B5B] font-medium">Drag and drop apartment photos here, or click to browse</p>
                      <p className="text-[11px] text-[#8B8B8B] mt-1">Supports PNG, JPG, JPEG (Analyzes distinct bedrooms)</p>
                    </div>
                  </div>

                  {selectedFiles.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-mono text-[#8B8B8B]">Selected Photos ({selectedFiles.length}/12):</p>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        {selectedFiles.map((file, idx) => (
                          <div key={idx} className="relative group rounded-md overflow-hidden border border-[#E4DCC9] bg-[#FAF8F4] h-28">
                            <img src={URL.createObjectURL(file)} alt={file.name} className="w-full h-full object-cover" />
                            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
                              <button onClick={(e) => { e.stopPropagation(); removeFile(idx); }} className="p-1.5 bg-red-600 hover:bg-red-700 text-white rounded-full transition" title="Remove Image"><X className="w-3.5 h-3.5" /></button>
                            </div>
                            <span className="absolute bottom-1 left-1 bg-black/70 text-[9px] font-mono px-1.5 py-0.5 rounded text-white">#{idx + 1}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <button onClick={handleVerifySubmit} disabled={selectedFiles.length === 0 || verifyLoading} className="w-full py-3 bg-[#C6A15B] hover:bg-[#D9B876] disabled:opacity-40 text-[#1E1E1E] font-semibold text-xs rounded-sm transition font-mono uppercase tracking-wider flex items-center justify-center gap-2 shadow-lg">
                    {verifyLoading ? (<><Loader2 className="w-4 h-4 animate-spin" /> Verifying...</>) : (<><Sparkles className="w-4 h-4" /> Verify BHK Configuration Now</>)}
                  </button>
                </>
              )}

              {verifyMode === "link" && (
                <>
                  <div>
                    <h3 className="text-lg font-display text-[#2B2B2B] flex items-center gap-2"><Sparkles className="w-5 h-5 text-[#C6A15B]" /> Verify Listing via Link</h3>
                    <p className="text-xs text-[#8B8B8B] mt-1">Paste a listing link and upload your own photos to verify the claims against what&apos;s actually shown.</p>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-mono uppercase tracking-wider text-[#C6A15B] font-semibold">Listing URL:</label>
                    <input
                      type="url"
                      value={propertyUrl}
                      onChange={(e) => {
                        setPropertyUrl(e.target.value);
                        // A new URL should always trigger a fresh scrape, not silently
                        // reuse pasted text left over from a previous failed attempt.
                        if (pastedDescription || linkScrapeFailed) {
                          setPastedDescription("");
                          setLinkScrapeFailed(false);
                          setLinkScrapeFailMessage("");
                        }
                      }}
                      placeholder="https://www.magicbricks.com/... or 99acres.com/..."
                      className="w-full bg-[#FAF8F4]/90 border border-[#E4DCC9] focus:border-[#C6A15B] rounded-md py-3 px-4 text-sm text-[#2B2B2B] placeholder-[#8B8B8B] focus:outline-none focus:ring-2 focus:ring-[#C6A15B]/30 transition shadow-inner"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-mono uppercase tracking-wider text-[#C6A15B] font-semibold">Upload Your Own Photos of This Property (Max 12):</label>
                    <div onDragOver={(e) => e.preventDefault()} onDrop={handleLinkFileDrop} className="border-2 border-dashed border-[#E4DCC9] hover:border-[#C6A15B]/50 rounded-md p-8 text-center bg-[#FAF8F4]/60 transition flex flex-col items-center justify-center cursor-pointer relative" onClick={() => document.getElementById("hiddenLinkFileInput").click()}>
                      <input id="hiddenLinkFileInput" type="file" multiple accept="image/*" className="hidden" onChange={handleLinkFileSelect} />
                      <Upload className="w-8 h-8 text-[#C6A15B] mb-2" />
                      <p className="text-sm text-[#5B5B5B] font-medium">Drag and drop your own photos here, or click to browse</p>
                      <p className="text-[11px] text-[#8B8B8B] mt-1">Supports PNG, JPG, JPEG</p>
                    </div>
                  </div>

                  {linkFiles.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-mono text-[#8B8B8B]">Selected Photos ({linkFiles.length}/12):</p>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        {linkFiles.map((file, idx) => (
                          <div key={idx} className="relative group rounded-md overflow-hidden border border-[#E4DCC9] bg-[#FAF8F4] h-28">
                            <img src={URL.createObjectURL(file)} alt={file.name} className="w-full h-full object-cover" />
                            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
                              <button onClick={(e) => { e.stopPropagation(); removeLinkFile(idx); }} className="p-1.5 bg-red-600 hover:bg-red-700 text-white rounded-full transition" title="Remove Image"><X className="w-3.5 h-3.5" /></button>
                            </div>
                            <span className="absolute bottom-1 left-1 bg-black/70 text-[9px] font-mono px-1.5 py-0.5 rounded text-white">#{idx + 1}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {linkScrapeFailed && (
                    <div className="p-3 bg-[#FBEAEA]/30 border border-[#C24545]/30 rounded-sm">
                      <div className="flex items-start gap-1.5 text-xs text-[#6B6B6B] font-body">
                        <AlertTriangle className="w-3.5 h-3.5 text-[#C24545] flex-shrink-0 mt-0.5" />
                        <span>{linkScrapeFailMessage} Use the paste-in box below instead &mdash; it works for any listing, blocked or not.</span>
                      </div>
                    </div>
                  )}

                  <div className="space-y-2">
                    <label className="text-xs font-mono uppercase tracking-wider text-[#C6A15B] font-semibold">Or Paste the Listing Description (Optional):</label>
                    <p className="text-[11px] text-[#8B8B8B]">Many real estate portals (MagicBricks, 99acres, apartments.com, etc.) block automated reading entirely. If left blank we&apos;ll try to read the URL automatically &mdash; if that fails or you&apos;d rather skip the wait, paste the listing&apos;s title, price, BHK, amenities, and description here and we&apos;ll compare that instead.</p>
                    <textarea
                      value={pastedDescription}
                      onChange={(e) => setPastedDescription(e.target.value)}
                      placeholder="Paste the listing title, price, BHK, amenities, and description here..."
                      rows={4}
                      className="w-full bg-[#FAF8F4]/90 border border-[#E4DCC9] focus:border-[#C6A15B] rounded-md py-3 px-4 text-sm text-[#2B2B2B] placeholder-[#8B8B8B] focus:outline-none focus:ring-2 focus:ring-[#C6A15B]/30 transition shadow-inner resize-y"
                    />
                  </div>

                  <button onClick={handleVerifyLinkSubmit} disabled={!propertyUrl.trim() || linkFiles.length === 0 || linkVerifyLoading} className="w-full py-3 bg-[#C6A15B] hover:bg-[#D9B876] disabled:opacity-40 text-[#1E1E1E] font-semibold text-xs rounded-sm transition font-mono uppercase tracking-wider flex items-center justify-center gap-2 shadow-lg">
                    {linkVerifyLoading ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> Verifying...</>
                    ) : (
                      <><Sparkles className="w-4 h-4" /> {pastedDescription.trim() ? "Compare Pasted Description to Photos" : "Compare Listing to Photos"}</>
                    )}
                  </button>
                </>
              )}
            </div>

            {verifyMode === "photos" && verifyResult && (
              <div className="bg-[#FFFFFF]/90 border border-[#E4DCC9] p-6 rounded-md shadow-2xl space-y-6">
                <div className="flex items-center justify-between border-b border-[#E4DCC9] pb-4">
                  <div>
                    <h4 className="text-sm font-mono uppercase tracking-wider text-[#C6A15B]">Verification Audit Report</h4>
                    <p className="text-xs text-[#8B8B8B] mt-0.5">Analyzed {verifyResult.images_analyzed} uploaded photographs</p>
                  </div>
                  <div className={`px-3 py-1 rounded-sm text-xs font-mono uppercase tracking-wider flex items-center gap-1.5 border ${verifyResult.verdict.matches ? "bg-[#D9EAD3]/40 text-[#4B7A46] border-[#A9C9A0]/40" : "bg-[#FBEAEA]/40 text-[#C24545] border-[#C24545]/40"}`}>
                    {verifyResult.verdict.matches ? <CheckCircle className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
                    {verifyResult.verdict.matches ? "Config Verified Match" : "Mismatch Warning"}
                  </div>
                </div>

               {/* Aggregate Verdict Summary Card */}
                <div className="p-4 bg-[#FAF8F4] rounded-sm border border-[#E4DCC9] space-y-2">
                  <div className="flex justify-between text-xs font-mono">
                    <span className="text-[#8B8B8B]">Claimed BHK:</span>
                    <span className="text-[#2B2B2B] font-semibold">{verifyResult.verdict.claimed_bhk} BHK</span>
                  </div>
                  <div className="flex justify-between text-xs font-mono">
                    <span className="text-[#8B8B8B]">Unique Bedrooms Detected:</span>
                    <span className="text-[#2B2B2B] font-semibold">{verifyResult.verdict.unique_bedrooms_detected} Found (from {verifyResult.verdict.raw_bedroom_photos} photos)</span>
                  </div>
                  
                  {verifyResult.verdict.duplicate_groups?.length > 0 && (
                    <div className="mt-3 p-2.5 bg-[#FBEAEA]/20 border border-[#C24545]/30 rounded-sm space-y-1.5">
                      <div className="flex items-center gap-1.5 text-[10px] text-[#C24545] font-mono uppercase tracking-wider font-semibold">
                        <AlertTriangle className="w-3 h-3" /> Duplicate Photos Detected
                      </div>
                      {verifyResult.verdict.duplicate_groups.map((group, gIdx) => (
                         <p key={gIdx} className="text-xs text-[#6B6B6B] font-body">
                           ⚠️ Photos #{group.photo_indices.join(" and #")} look like the same room ({(group.similarity * 100).toFixed(1)}% match).
                         </p>
                      ))}
                    </div>
                  )}
                  {verifyResult.verdict.low_confidence_warning && (
    <div className="mt-3 p-2.5 bg-[#FBF0DC]/20 border border-[#C6A15B]/30 rounded-sm space-y-1.5">
      <div className="flex items-center gap-1.5 text-[10px] text-[#C6A15B] font-mono uppercase tracking-wider font-semibold">
        <AlertTriangle className="w-3 h-3" /> Low Confidence — Manual Check Suggested
      </div>
      <p className="text-xs text-[#6B6B6B] font-body">
        {verifyResult.verdict.low_confidence_warning}
      </p>
    </div>
  )}

                  <p className="text-xs text-[#6B6B6B] pt-2 border-t border-[#E4DCC9]/60 leading-relaxed font-body">
                    {verifyResult.verdict.confidence_note}
                  </p>
                </div>

                {/* Per-image breakdown */}
                <div className="space-y-3">
                  <p className="text-xs font-mono uppercase tracking-wider text-[#8B8B8B]">Per-Image Scene Classification Details:</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {verifyResult.verdict.all_detected_rooms.map((room, rIdx) => {
                      const isDuplicate = verifyResult.verdict.duplicate_groups?.some(g => g.photo_indices.includes(room.image_index));
                      return (
                        <div key={rIdx} className={`p-3 bg-[#FAF8F4]/80 border ${isDuplicate ? "border-[#C24545]/40 bg-[#FBEAEA]/10" : "border-[#E4DCC9]"} rounded-sm flex items-center justify-between text-xs transition-colors`}>
                          <div className="space-y-1">
                            <span className="font-mono text-[#C6A15B] font-semibold">
                              Photo #{room.image_index}
                              {isDuplicate && <span className="ml-2 bg-[#FBEAEA]/60 text-[#C24545] px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wider border border-[#C24545]/40">Duplicate</span>}
                            </span>
                            <p className="text-[#2B2B2B] capitalize font-medium">Mapped: {room.room_type.replace("_", " ")}</p>
                            <p className="text-[10px] text-[#8B8B8B] font-mono">Raw Scene: {room.raw_category}</p>
                          </div>
                          <div className="text-right font-mono">
                            <span className={`px-2 py-0.5 rounded text-[10px] ${room.room_type === "bedroom" ? "bg-[#D9EAD3]/40 text-[#4B7A46]" : "bg-[#F1E9D8] text-[#8B8B8B]"}`}>
                              {(room.confidence * 100).toFixed(1)}% conf
                            </span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                <div className="pt-2 flex justify-end">
                  <button onClick={() => navigate(VIEW_PATHS.chat)} className="px-4 py-2 bg-[#F1E9D8] hover:bg-[#E9DFC8] text-[#5B5B5B] border border-[#E4DCC9] rounded-sm text-xs font-mono transition">
                    Return to Active Chat
                  </button>
                </div>
              </div>
            )}

            {verifyMode === "link" && linkVerifyResult && (
              <div className="bg-[#FFFFFF]/90 border border-[#E4DCC9] p-6 rounded-md shadow-2xl space-y-6">
                <div className="flex items-center justify-between border-b border-[#E4DCC9] pb-4">
                  <div>
                    <h4 className="text-sm font-mono uppercase tracking-wider text-[#C6A15B]">Listing Comparison Report</h4>
                    <p className="text-xs text-[#8B8B8B] mt-0.5">
                      Compared {linkVerifyResult.images_analyzed} photo(s) against{" "}
                      <a href={linkVerifyResult.property_url} target="_blank" rel="noreferrer" className="underline hover:text-[#C6A15B]">the listing page</a>
                    </p>
                  </div>
                  <div className={`px-3 py-1 rounded-sm text-xs font-mono uppercase tracking-wider flex items-center gap-1.5 border ${linkVerifyResult.result.matches ? "bg-[#D9EAD3]/40 text-[#4B7A46] border-[#A9C9A0]/40" : "bg-[#FBEAEA]/40 text-[#C24545] border-[#C24545]/40"}`}>
                    {linkVerifyResult.result.matches ? <CheckCircle className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
                    {linkVerifyResult.result.matches ? "Claims Match Photos" : linkVerifyResult.result.photos_match_listing === false ? "Different Property Detected" : "Discrepancies Found"}
                  </div>
                </div>

                {linkVerifyResult.result.photos_match_listing === false && (
                  <div className="p-4 bg-[#FBEAEA]/50 border-2 border-[#C24545]/50 rounded-sm space-y-1.5">
                    <div className="flex items-center gap-1.5 text-xs text-[#C24545] font-mono uppercase tracking-wider font-bold">
                      <AlertTriangle className="w-4 h-4" /> Possible Photo Mismatch
                    </div>
                    <p className="text-xs text-[#6B6B6B] font-body leading-relaxed">
                      These photos may not be from this listing at all. {linkVerifyResult.result.identity_mismatch_reason}
                    </p>
                  </div>
                )}

                <div className="p-4 bg-[#FAF8F4] rounded-sm border border-[#E4DCC9] space-y-2">
                  <p className="text-xs text-[#6B6B6B] leading-relaxed font-body">{linkVerifyResult.result.summary}</p>
                  <div className="grid grid-cols-2 gap-2 pt-2 text-xs font-mono">
                    <div><span className="text-[#8B8B8B]">Claimed BHK: </span><span className="text-[#2B2B2B] font-semibold">{linkVerifyResult.result.claims.claimed_bhk ?? "Not stated"}</span></div>
                    <div>
                      <span className="text-[#8B8B8B]">Bedrooms Visible in Photos: </span>
                      <span className={`font-semibold ${linkVerifyResult.result.claims.claimed_bhk != null && linkVerifyResult.result.visible_bedroom_count != null && linkVerifyResult.result.visible_bedroom_count < linkVerifyResult.result.claims.claimed_bhk ? "text-[#C24545]" : "text-[#2B2B2B]"}`}>
                        {linkVerifyResult.result.visible_bedroom_count ?? "None visible"}
                      </span>
                    </div>
                    <div><span className="text-[#8B8B8B]">Claimed Price: </span><span className="text-[#2B2B2B] font-semibold">{linkVerifyResult.result.claims.claimed_price ?? "Not stated"}</span></div>
                    <div><span className="text-[#8B8B8B]">Claimed Area: </span><span className="text-[#2B2B2B] font-semibold">{linkVerifyResult.result.claims.claimed_area ?? "Not stated"}</span></div>
                    <div><span className="text-[#8B8B8B]">Confidence: </span><span className="text-[#2B2B2B] font-semibold">{(linkVerifyResult.result.confidence * 100).toFixed(0)}%</span></div>
                  </div>
                  {linkVerifyResult.result.claims.claimed_amenities?.length > 0 && (
                    <p className="text-xs text-[#6B6B6B] pt-1"><span className="text-[#8B8B8B] font-mono">Claimed amenities: </span>{linkVerifyResult.result.claims.claimed_amenities.join(", ")}</p>
                  )}
                </div>

                {linkVerifyResult.result.discrepancies.length > 0 && (
                  <div className="p-2.5 bg-[#FBEAEA]/20 border border-[#C24545]/30 rounded-sm space-y-1.5">
                    <div className="flex items-center gap-1.5 text-[10px] text-[#C24545] font-mono uppercase tracking-wider font-semibold">
                      <AlertTriangle className="w-3 h-3" /> Discrepancies
                    </div>
                    {linkVerifyResult.result.discrepancies.map((d, i) => (
                      <p key={i} className="text-xs text-[#6B6B6B] font-body">⚠️ {d}</p>
                    ))}
                  </div>
                )}

                {linkVerifyResult.result.low_confidence_note && (
                  <div className="p-2.5 bg-[#FBF0DC]/20 border border-[#C6A15B]/30 rounded-sm space-y-1.5">
                    <div className="flex items-center gap-1.5 text-[10px] text-[#C6A15B] font-mono uppercase tracking-wider font-semibold">
                      <AlertTriangle className="w-3 h-3" /> Low Confidence — Manual Check Suggested
                    </div>
                    <p className="text-xs text-[#6B6B6B] font-body">{linkVerifyResult.result.low_confidence_note}</p>
                  </div>
                )}

                {linkVerifyResult.result.amenity_verification?.length > 0 && (
                  <div className="space-y-3">
                    <p className="text-xs font-mono uppercase tracking-wider text-[#8B8B8B]">Claimed Amenities — Checked Against Photos:</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {linkVerifyResult.result.amenity_verification.map((a, i) => {
                        const cfg = {
                          confirmed: { icon: CheckCircle, color: "text-[#4B7A46]", bg: "bg-[#D9EAD3]/30 border-[#A9C9A0]/40" },
                          contradicted: { icon: AlertTriangle, color: "text-[#C24545]", bg: "bg-[#FBEAEA]/30 border-[#C24545]/30" },
                          not_visible: { icon: AlertTriangle, color: "text-[#C6A15B]", bg: "bg-[#FBF0DC]/30 border-[#C6A15B]/30" },
                        }[a.status] || { icon: AlertTriangle, color: "text-[#8B8B8B]", bg: "bg-[#F1E9D8]/50 border-[#E4DCC9]" };
                        const Icon = cfg.icon;
                        return (
                          <div key={i} className={`p-2.5 rounded-sm border text-xs flex items-start gap-2 ${cfg.bg}`}>
                            <Icon className={`w-3.5 h-3.5 flex-shrink-0 mt-0.5 ${cfg.color}`} />
                            <div>
                              <p className="text-[#2B2B2B] font-medium capitalize">{a.amenity}</p>
                              <p className={`text-[10px] font-mono uppercase tracking-wider ${cfg.color}`}>
                                {a.status === "confirmed" ? "Confirmed in photos" : a.status === "contradicted" ? "Contradicted by photos" : "Not seen in photos"}
                              </p>
                              {a.note && <p className="text-[10px] text-[#8B8B8B] mt-0.5">{a.note}</p>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="space-y-3">
                  <p className="text-xs font-mono uppercase tracking-wider text-[#8B8B8B]">Per-Photo Visual Findings:</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {linkVerifyResult.result.visual_findings.map((f, i) => (
                      <div key={i} className="p-3 bg-[#FAF8F4]/80 border border-[#E4DCC9] rounded-sm text-xs space-y-1">
                        <span className="font-mono text-[#C6A15B] font-semibold">Photo #{f.photo_index}</span>
                        <p className="text-[#2B2B2B] font-medium">{f.visible_room_or_area}</p>
                        {f.supports_claims.length > 0 && <p className="text-[10px] text-[#4B7A46]">✓ Confirms: {f.supports_claims.join(", ")}</p>}
                        {f.contradicts_claims.length > 0 && <p className="text-[10px] text-[#C24545]">✗ Contradicts: {f.contradicts_claims.join(", ")}</p>}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="pt-2 flex justify-end">
                  <button onClick={() => navigate(VIEW_PATHS.chat)} className="px-4 py-2 bg-[#F1E9D8] hover:bg-[#E9DFC8] text-[#5B5B5B] border border-[#E4DCC9] rounded-sm text-xs font-mono transition">
                    Return to Active Chat
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
      </>
      )}

      {lightboxSrc && (
        <div
          onClick={() => setLightboxSrc(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-6 cursor-zoom-out"
        >
          <button
            onClick={() => setLightboxSrc(null)}
            aria-label="Close image"
            className="absolute top-4 right-4 p-2 bg-[#FFFFFF]/80 border border-[#C6A15B]/40 text-[#2B2B2B] rounded-sm hover:bg-[#E9DFC8] transition"
          >
            <X className="w-5 h-5" />
          </button>
          <img
            src={lightboxSrc}
            alt="Property photo enlarged"
            onClick={(e) => e.stopPropagation()}
            className="max-w-full max-h-full object-contain rounded-md shadow-2xl border border-[#E4DCC9] cursor-default"
          />
        </div>
      )}
    </div>
  );
}

function LandingPageRoute() {
  const navigate = useNavigate();
  return <LandingPage onGetStarted={() => navigate(VIEW_PATHS.login)} />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPageRoute />} />
        {/* Everything past landing is one persistent AppShell instance so
            in-app state (chat sessions, broker listings, etc.) survives
            across view changes; AppShell itself reads the URL to decide
            which view to render and to guard access. */}
        <Route path="/*" element={<AppShell />} />
      </Routes>
    </BrowserRouter>
  );
}