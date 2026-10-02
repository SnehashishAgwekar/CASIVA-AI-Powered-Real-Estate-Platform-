import { useEffect, useRef, useState } from "react";
import { MessageCircle, X, Send, Loader2, User, Phone, Mail, Sparkles } from "lucide-react";
import { API_ORIGIN } from "../config";

const API_ASSISTANT_URL = `${API_ORIGIN}/api/v1/broker/assistant`;

const WELCOME = {
  role: "bot",
  text: "Ask me about buyer interest — e.g. \"how many buyers are interested in Skyline Residences?\" or \"which listing has the most interest?\"",
  buyers: [],
};

// A small, deterministic Q&A widget over the broker's own leads data (see
// POST /broker/assistant) — not a general chatbot, just buyer-interest counts.
export default function BrokerAssistant({ token }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([WELCOME]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const endRef = useRef(null);

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open, loading]);

  const send = async (e) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text }]);
    setLoading(true);
    try {
      const res = await fetch(API_ASSISTANT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ message: text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || "Something went wrong.");
      setMessages((m) => [...m, { role: "bot", text: data.reply, buyers: data.buyers || [] }]);
    } catch (err) {
      setMessages((m) => [...m, { role: "bot", text: err.message || "Something went wrong.", buyers: [], error: true }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed bottom-6 right-6 z-40 flex flex-col items-end gap-3 font-body">
      {open && (
        <div className="w-[340px] sm:w-[380px] h-[480px] bg-white border border-[#E4DCC9] rounded-md shadow-2xl flex flex-col overflow-hidden">
          <div className="h-12 px-4 flex items-center justify-between bg-[#2B2B2B] flex-shrink-0">
            <div className="flex items-center gap-2 text-[#F1E9D8]">
              <Sparkles className="w-4 h-4 text-[#C6A15B]" />
              <span className="text-xs font-mono uppercase tracking-wider font-semibold">Buyer Interest Assistant</span>
            </div>
            <button onClick={() => setOpen(false)} aria-label="Close" className="p-1 text-[#F1E9D8]/70 hover:text-[#F1E9D8] transition">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-3 bg-[#FAF8F4]">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] space-y-2`}>
                  <div
                    className={`px-3 py-2 rounded-md text-xs leading-relaxed ${
                      m.role === "user"
                        ? "bg-[#C6A15B] text-[#1E1E1E] font-medium"
                        : m.error
                        ? "bg-[#FBEAEA] border border-[#C24545]/30 text-[#C24545]"
                        : "bg-white border border-[#E4DCC9] text-[#2B2B2B]"
                    }`}
                  >
                    {m.text}
                  </div>
                  {Array.isArray(m.buyers) && m.buyers.length > 0 && (
                    <div className="space-y-1.5">
                      {m.buyers.map((b, bi) => (
                        <div key={bi} className="bg-white border border-[#E4DCC9] rounded-sm p-2 text-[11px] font-mono text-[#5B5B5B] space-y-0.5">
                          <p className="flex items-center gap-1.5 text-[#2B2B2B] font-semibold"><User className="w-3 h-3 text-[#C6A15B]" /> {b.name}</p>
                          {b.phone && <p className="flex items-center gap-1.5"><Phone className="w-3 h-3 text-[#C6A15B]" /> {b.phone}</p>}
                          {b.email && <p className="flex items-center gap-1.5"><Mail className="w-3 h-3 text-[#C6A15B]" /> {b.email}</p>}
                          {b.message && <p className="italic text-[#8B8B8B] border-l-2 border-[#C6A15B]/40 pl-1.5">{`“${b.message}”`}</p>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex items-center gap-2 text-[11px] text-[#8B8B8B] font-mono">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-[#C6A15B]" /> Checking your leads...
              </div>
            )}
            <div ref={endRef} />
          </div>

          <form onSubmit={send} className="p-2.5 border-t border-[#E4DCC9] flex items-center gap-2 bg-white flex-shrink-0">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about a listing's buyer interest..."
              disabled={loading}
              className="flex-1 bg-[#FAF8F4] border border-[#E4DCC9] focus:border-[#C6A15B] rounded-md py-2 px-3 text-xs text-[#2B2B2B] placeholder-[#8B8B8B] focus:outline-none focus:ring-2 focus:ring-[#C6A15B]/30 transition disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              aria-label="Send"
              className="p-2 rounded-md bg-[#C6A15B] hover:bg-[#D9B876] disabled:opacity-40 text-[#1E1E1E] transition flex-shrink-0"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      )}

      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 px-4 py-3 rounded-full bg-[#C6A15B] hover:bg-[#D9B876] text-[#1E1E1E] shadow-xl transition font-mono text-xs font-semibold uppercase tracking-wider"
      >
        {open ? <X className="w-4 h-4" /> : <MessageCircle className="w-4 h-4" />}
        {!open && "Ask About Buyers"}
      </button>
    </div>
  );
}
