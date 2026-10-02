import { useEffect, useState } from "react";
import {
  Sparkles, LogOut, MapPin, BedDouble, Building2, Search,
  SlidersHorizontal, Loader2, AlertTriangle, CheckCircle2, CheckCircle, X, Phone, Mail, User, UserCircle,
} from "lucide-react";
import CasivaLogo from "./CasivaLogo";
import { API_ORIGIN } from "../config";

const API_BASE = `${API_ORIGIN}/api/v1`;
const MEDIA_BASE = `${API_ORIGIN}`;

// Broker-uploaded photos are server-relative ("/static/uploads/xxx.jpg");
// seed-data photos are already-absolute URLs (e.g. Unsplash). Only prefix
// the ones that need it.
const resolveImg = (url) => (url && /^https?:\/\//i.test(url) ? url : `${MEDIA_BASE}${url}`);

const SORT_OPTIONS = [
  { value: "relevance", label: "Relevance" },
  { value: "price_asc", label: "Price: Low to High" },
  { value: "price_desc", label: "Price: High to Low" },
];

const LISTING_TYPE_OPTIONS = [
  { value: "", label: "For Sale & Rent" },
  { value: "Sale", label: "For Sale" },
  { value: "Rent", label: "For Rent" },
];

// "₹ 18,000/mo" for a rental, "₹ 95,00,000" for a sale listing.
const formatPrice = (p) => {
  const amount = `₹ ${Number(p.price_in_inr || 0).toLocaleString("en-IN")}`;
  return p.listing_type === "Rent" ? `${amount}/mo` : amount;
};

// Pull a "4bhk" / "3 bhk" / "2-bhk" token out of the free-text search box so
// it filters by exact configuration instead of being searched as a literal
// (near-never matching) substring of the project name. Whatever text is left
// over still goes to the project-name search.
const parseSearch = (raw) => {
  const q = raw.trim();
  const m = q.match(/(\d+)\s*-?\s*bhk\b/i);
  if (!m) return { bhk: null, text: q };
  const bhk = m[1];
  const text = (q.slice(0, m.index) + q.slice(m.index + m[0].length)).trim();
  return { bhk, text };
};

export default function PropertyDashboard({ token, currentUser, onAskAI, onProfile, onLogout }) {
  const [properties, setProperties] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [filterOptions, setFilterOptions] = useState({ cities: [], builders: [] });
  const [city, setCity] = useState("");
  const [builder, setBuilder] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("relevance");
  const [listingType, setListingType] = useState("");

  const [interestState, setInterestState] = useState({});
  const [lightboxSrc, setLightboxSrc] = useState(null);
  const [selectedProperty, setSelectedProperty] = useState(null);

  useEffect(() => {
    fetch(`${API_BASE}/properties/filters`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : { cities: [], builders: [] }))
      .then((data) => setFilterOptions({ cities: data.cities || [], builders: data.builders || [] }))
      .catch(() => {});
  }, [token]);

  useEffect(() => {
    const params = new URLSearchParams({ sort });
    if (city) params.set("city", city);
    if (builder) params.set("builder_name", builder);
    const { bhk, text } = parseSearch(search);
    if (bhk) params.set("bhk", bhk);
    if (text) params.set("property_name", text);
    if (listingType) params.set("listing_type", listingType);

    const t = setTimeout(() => {
      setLoading(true);
      setError("");
      fetch(`${API_BASE}/properties/?${params.toString()}`, { headers: { Authorization: `Bearer ${token}` } })
        .then(async (res) => {
          const data = await res.json();
          if (!res.ok) throw new Error(data.detail || "Failed to load properties");
          // Hide listings with no photos from the explorer.
          const withImages = (Array.isArray(data) ? data : []).filter(
            (p) => Array.isArray(p.image_urls) && p.image_urls.some((u) => typeof u === "string" && u.trim())
          );
          setProperties(withImages);
        })
        .catch((err) => {
          setError(err.message || "Unable to load properties.");
          setProperties([]);
        })
        .finally(() => setLoading(false));
    }, 300);

    return () => clearTimeout(t);
  }, [token, city, builder, search, sort, listingType]);

  const handleExpressInterest = async (propertyId, e) => {
    if (e) e.stopPropagation();
    if (interestState[propertyId]?.loading || interestState[propertyId]?.data) return;
    setInterestState((s) => ({ ...s, [propertyId]: { loading: true } }));
    try {
      const res = await fetch(`${API_BASE}/properties/${propertyId}/interest`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Could not register your interest");
      setInterestState((s) => ({ ...s, [propertyId]: { loading: false, data } }));
    } catch (err) {
      setInterestState((s) => ({ ...s, [propertyId]: { loading: false, error: err.message } }));
    }
  };

  const selectCls =
    "bg-white border border-[#E4DCC9] rounded-md py-2 px-3 text-sm text-[#2B2B2B] focus:outline-none focus:ring-2 focus:ring-[#C6A15B]/30 focus:border-[#C6A15B] transition";

  const selectedInterest = selectedProperty ? interestState[selectedProperty.id] || {} : {};

  return (
    <div className="flex-1 flex flex-col h-full relative z-10 bg-[#FAF8F4] overflow-hidden">
      <header className="h-16 border-b border-[#E4DCC9] flex items-center justify-between px-6 bg-white flex-shrink-0">
        <div className="flex items-center gap-3">
          <CasivaLogo className="w-7 h-7" />
          <span className="font-display text-sm tracking-[0.15em] text-[#2B2B2B]">CASIVA</span>
          <span className="w-px h-5 bg-[#E4DCC9] hidden sm:block" />
          <h2 className="text-sm font-semibold tracking-wide text-[#5B5B5B] font-display hidden sm:block">
            Property Explorer
          </h2>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={onAskAI}
            className="flex items-center gap-2 px-4 py-2 rounded-sm bg-[#C6A15B] hover:bg-[#D9B876] text-[#1E1E1E] font-semibold text-xs transition shadow-sm font-mono uppercase tracking-wider"
          >
            <Sparkles className="w-3.5 h-3.5" /> Ask AI Agent
          </button>
          <div className="text-[10px] font-mono bg-[#F1E9D8] text-[#8A6C34] px-3 py-1.5 rounded-sm uppercase tracking-wider hidden lg:block">
            {currentUser?.email}
          </div>
          <button
            onClick={onProfile}
            className="flex items-center gap-1.5 px-3 py-2 bg-[#F1E9D8] hover:bg-[#E9DFC8] text-[#5B5B5B] border border-[#E4DCC9] rounded-sm text-xs font-mono transition"
          >
            <UserCircle className="w-3.5 h-3.5 text-[#C6A15B]" /> My Profile
          </button>
          <button
            onClick={onLogout}
            className="flex items-center gap-1.5 px-3 py-2 bg-[#FBEAEA] hover:bg-[#F5D9D9] text-[#C24545] border border-[#C24545]/30 rounded-sm text-xs font-mono transition"
          >
            <LogOut className="w-3.5 h-3.5" /> Logout
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto w-full px-6 py-8 space-y-6">
          <div>
            <h1 className="font-display text-2xl text-[#2B2B2B]">Find your next property</h1>
            <p className="text-sm text-[#6B6B6B] mt-1">
              {properties ? `${properties.length} listing${properties.length === 1 ? "" : "s"} available` : "Loading listings..."}
            </p>
          </div>

          {/* Filter & sort bar */}
          <div className="bg-white border border-[#E4DCC9] rounded-md p-4 flex flex-wrap items-center gap-3 shadow-sm">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="w-4 h-4 text-[#8B8B8B] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by Locality,Project,Configuration..."
                className="w-full bg-[#FAF8F4] border border-[#E4DCC9] focus:border-[#C6A15B] rounded-md py-2 pl-9 pr-3 text-sm text-[#2B2B2B] placeholder-[#8B8B8B] focus:outline-none focus:ring-2 focus:ring-[#C6A15B]/30 transition"
              />
            </div>

            <select value={listingType} onChange={(e) => setListingType(e.target.value)} className={selectCls}>
              {LISTING_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>

            <select value={city} onChange={(e) => setCity(e.target.value)} className={selectCls}>
              <option value="">All Localities</option>
              {filterOptions.cities.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>

            {filterOptions.builders.length > 0 && (
              <select value={builder} onChange={(e) => setBuilder(e.target.value)} className={selectCls}>
                <option value="">All Builders</option>
                {filterOptions.builders.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            )}

            <div className="flex items-center gap-2 ml-auto">
              <SlidersHorizontal className="w-3.5 h-3.5 text-[#8A6C34] flex-shrink-0" />
              <select value={sort} onChange={(e) => setSort(e.target.value)} className={selectCls}>
                {SORT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>

          {loading && (
            <div className="flex items-center gap-2 text-xs text-[#8B8B8B] font-mono">
              <Loader2 className="w-4 h-4 animate-spin text-[#C6A15B]" /> Loading properties...
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 p-3 bg-[#FBEAEA] border border-[#C24545]/30 text-[#C24545] text-xs rounded-sm font-mono">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" /> {error}
            </div>
          )}

          {!loading && properties && properties.length === 0 && (
            <div className="p-10 bg-white border border-[#E4DCC9] rounded-md text-center text-sm text-[#6B6B6B]">
              No properties match your filters. Try broadening your search.
            </div>
          )}

          {properties && properties.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
              {properties.map((p) => {
                return (
                  <div
                    key={p.id}
                    onClick={() => setSelectedProperty(p)}
                    className="bg-white border border-[#E4DCC9] rounded-md overflow-hidden shadow-sm flex flex-col cursor-pointer hover:border-[#C6A15B] transition group"
                  >
                    {Array.isArray(p.image_urls) && p.image_urls.length > 0 ? (
                      <div className="flex gap-1 overflow-x-auto no-scrollbar h-40 flex-shrink-0">
                        {p.image_urls.map((url, i) => (
                          <img
                            key={i}
                            src={resolveImg(url)}
                            alt={`${p.property_name} photo ${i + 1}`}
                            loading="lazy"
                            onClick={(e) => {
                              e.stopPropagation();
                              setLightboxSrc(resolveImg(url));
                            }}
                            className="h-40 w-full object-cover flex-shrink-0 cursor-zoom-in hover:brightness-105 transition"
                          />
                        ))}
                      </div>
                    ) : (
                      <div className="h-40 bg-[#F1E9D8] flex items-center justify-center text-[#8A6C34] flex-shrink-0">
                        <Building2 className="w-8 h-8" />
                      </div>
                    )}

                    <div className="p-4 space-y-2.5 flex-1 flex flex-col">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="text-sm font-display text-[#2B2B2B] leading-snug group-hover:text-[#C6A15B] transition">{p.property_name}</h3>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <span className={`text-[9px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-sm ${
                            p.listing_type === "Rent"
                              ? "bg-[#F1E9D8] text-[#8A6C34] border border-[#C6A15B]/40"
                              : "bg-[#E4E9F5] text-[#3B5998] border border-[#C3CCE8]"
                          }`}>
                            {p.listing_type === "Rent" ? "For Rent" : "For Sale"}
                          </span>
                          {p.availability_status && (
                            <span className="text-[9px] font-mono uppercase tracking-wider bg-[#D9EAD3] text-[#4B7A46] border border-[#A9C9A0] px-2 py-0.5 rounded-sm">
                              {p.availability_status}
                            </span>
                          )}
                        </div>
                      </div>

                      <p className="text-[11px] text-[#6B6B6B] font-mono flex items-center gap-1">
                        <MapPin className="w-3 h-3 text-[#C6A15B]" /> {p.location}{p.city ? `, ${p.city}` : ""}
                      </p>

                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-mono text-[#5B5B5B]">
                        {p.bhk != null && (
                          <span className="flex items-center gap-1"><BedDouble className="w-3 h-3 text-[#6B9A5E]" /> {p.bhk} BHK</span>
                        )}
                        {p.area_sqft != null && <span>{p.area_sqft} {p.area_unit || "sqft"}</span>}
                        {p.property_type && <span className="text-[#8B8B8B]">{p.property_type}</span>}
                      </div>

                      {p.builder_name && (
                        <p className="text-[11px] text-[#8B8B8B]">by {p.builder_name}</p>
                      )}

                      <div className="pt-2 mt-auto border-t border-[#E4DCC9] flex items-center justify-between">
                        <span className="text-sm font-semibold text-[#2B2B2B] font-display">
                          {formatPrice(p)}
                        </span>
                        <span className="text-[10px] font-mono text-[#8A6C34] uppercase tracking-wider">View Details →</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Property Details Modal */}
      {selectedProperty && (
        <div
          onClick={() => setSelectedProperty(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 overflow-y-auto"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white border border-[#E4DCC9] rounded-md max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl relative flex flex-col"
          >
            <div className="p-4 border-b border-[#E4DCC9] flex items-center justify-between sticky top-0 bg-white z-10">
              <h2 className="text-base font-display text-[#2B2B2B]">{selectedProperty.property_name}</h2>
              <button
                onClick={() => setSelectedProperty(null)}
                aria-label="Close details"
                className="p-1.5 bg-[#FAF8F4] border border-[#E4DCC9] rounded-sm text-[#2B2B2B] hover:bg-[#E9DFC8] transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-5">
              {Array.isArray(selectedProperty.image_urls) && selectedProperty.image_urls.length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {selectedProperty.image_urls.map((url, i) => (
                    <img
                      key={i}
                      src={resolveImg(url)}
                      alt={`${selectedProperty.property_name} photo ${i + 1}`}
                      onClick={() => setLightboxSrc(resolveImg(url))}
                      className="h-28 w-full object-cover rounded-sm border border-[#E4DCC9] cursor-zoom-in hover:brightness-105 transition"
                    />
                  ))}
                </div>
              ) : (
                <div className="h-36 bg-[#F1E9D8] rounded-sm flex items-center justify-center text-[#8A6C34]">
                  <Building2 className="w-8 h-8" />
                </div>
              )}

              <div className="grid grid-cols-2 gap-4 bg-[#FAF8F4] p-4 rounded-md border border-[#E4DCC9] font-mono text-xs">
                <div>
                  <span className="text-[#8B8B8B] block">{selectedProperty.listing_type === "Rent" ? "Monthly Rent" : "Price"}</span>
                  <span className="font-semibold text-[#2B2B2B] text-sm">{formatPrice(selectedProperty)}</span>
                </div>
                {selectedProperty.listing_type === "Rent" && selectedProperty.security_deposit != null && (
                  <div>
                    <span className="text-[#8B8B8B] block">Security Deposit</span>
                    <span className="font-medium text-[#2B2B2B]">₹ {Number(selectedProperty.security_deposit).toLocaleString("en-IN")}</span>
                  </div>
                )}
                <div>
                  <span className="text-[#8B8B8B] block">Location</span>
                  <span className="font-medium text-[#2B2B2B]">{selectedProperty.location}{selectedProperty.city ? `, ${selectedProperty.city}` : ""}</span>
                </div>
                <div>
                  <span className="text-[#8B8B8B] block">Configuration</span>
                  <span className="font-medium text-[#2B2B2B]">{selectedProperty.bhk ? `${selectedProperty.bhk} BHK` : "N/A"} ({selectedProperty.property_type || "Property"})</span>
                </div>
                <div>
                  <span className="text-[#8B8B8B] block">Area</span>
                  <span className="font-medium text-[#2B2B2B]">{selectedProperty.area_sqft ? `${selectedProperty.area_sqft} ${selectedProperty.area_unit || "sqft"}` : "N/A"}</span>
                </div>
                {selectedProperty.builder_name && (
                  <div>
                    <span className="text-[#8B8B8B] block">Builder</span>
                    <span className="font-medium text-[#2B2B2B]">{selectedProperty.builder_name}</span>
                  </div>
                )}
                {selectedProperty.availability_status && (
                  <div>
                    <span className="text-[#8B8B8B] block">Status</span>
                    <span className="font-medium text-[#4B7A46]">{selectedProperty.availability_status}</span>
                  </div>
                )}
              </div>

              {selectedProperty.description && (
                <div className="space-y-1">
                  <h4 className="text-xs font-mono uppercase tracking-wider text-[#8A6C34]">Description</h4>
                  <p className="text-xs text-[#5B5B5B] leading-relaxed">{selectedProperty.description}</p>
                </div>
              )}

              {/* Interested Action Section & Broker Contact Info */}
              <div className="p-4 bg-[#FAF8F4] border border-[#E4DCC9] rounded-md space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-mono uppercase tracking-wider text-[#2B2B2B] font-semibold">Interested in this property?</h4>
                    <p className="text-[11px] text-[#6B6B6B]">Notify the broker and reveal direct contact details.</p>
                  </div>
                  {selectedInterest.data ? (
                    <span className="flex items-center gap-1 text-xs font-mono uppercase tracking-wider text-[#4B7A46] font-semibold">
                      <CheckCircle className="w-4 h-4" /> Notified
                    </span>
                  ) : (
                    <button
                      onClick={(e) => handleExpressInterest(selectedProperty.id, e)}
                      disabled={selectedInterest.loading}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-sm bg-[#C6A15B] hover:bg-[#D9B876] disabled:opacity-50 text-[#1E1E1E] text-xs font-mono font-semibold uppercase tracking-wider transition"
                    >
                      {selectedInterest.loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                      {selectedInterest.loading ? "Sending..." : "I'm Interested"}
                    </button>
                  )}
                </div>

                {selectedInterest.error && (
                  <p className="text-[11px] text-[#C24545] font-mono">{selectedInterest.error}</p>
                )}

                {selectedInterest.data && (
                  <div className="mt-3 pt-3 border-t border-[#E4DCC9] space-y-2">
                    <span className="text-xs font-mono text-[#8A6C34] uppercase tracking-wider block font-semibold">Broker Contact Information</span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-mono text-[#2B2B2B]">
                      <div className="flex items-center gap-2 bg-white p-2.5 rounded-sm border border-[#E4DCC9]">
                        <User className="w-4 h-4 text-[#C6A15B]" />
                        <span>{selectedInterest.data.broker?.name || selectedProperty.builder_name || "Assigned Broker"}</span>
                      </div>
                      
                      {selectedInterest.data.broker?.phone && (
                        <div className="flex items-center gap-2 bg-white p-2.5 rounded-sm border border-[#E4DCC9]">
                          <Phone className="w-4 h-4 text-[#C6A15B]" />
                          <span>{selectedInterest.data.broker.phone}</span>
                        </div>
                      )}

                      {selectedInterest.data.broker?.email && (
                        <div className="flex items-center gap-2 bg-white p-2.5 rounded-sm border border-[#E4DCC9] sm:col-span-2">
                          <Mail className="w-4 h-4 text-[#C6A15B]" />
                          <span>{selectedInterest.data.broker.email}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  onClick={() => setSelectedProperty(null)}
                  className="px-4 py-2 rounded-sm border border-[#E4DCC9] text-xs font-mono text-[#5B5B5B] hover:bg-[#FAF8F4] transition"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {lightboxSrc && (
        <div
          onClick={() => setLightboxSrc(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-6 cursor-zoom-out"
        >
          <button
            onClick={() => setLightboxSrc(null)}
            aria-label="Close image"
            className="absolute top-4 right-4 p-2 bg-white/80 border border-[#C6A15B]/40 text-[#2B2B2B] rounded-sm hover:bg-[#E9DFC8] transition"
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