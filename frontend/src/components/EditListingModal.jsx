import { useState } from "react";
import { X, Upload, Loader2, AlertTriangle, Trash2, Save, RotateCcw } from "lucide-react";
import { API_ORIGIN } from "../config";

const API_BASE = `${API_ORIGIN}/api/v1`;
const MEDIA_BASE = `${API_ORIGIN}`;

// Broker-uploaded photos are server-relative ("/static/uploads/xxx.jpg");
// Supabase Storage / seed-data photos are already-absolute URLs. Only
// prefix the ones that need it.
const resolveImg = (url) => (url && /^https?:\/\//i.test(url) ? url : `${MEDIA_BASE}${url}`);

const errDetail = (data, fallback) => {
  const d = data?.detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d) && d.length) return d[0]?.msg || fallback;
  return fallback;
};

// One place both the "for sale" and "for rent" MAX images count lives, so
// the removed-existing + newly-added counters agree with the backend's cap.
const MAX_IMAGES = 10;

export default function EditListingModal({ token, listing, onClose, onSaved, onDeleted }) {
  const [form, setForm] = useState({
    property_name: listing.property_name || "",
    city: listing.city || "",
    location: listing.location || "",
    price_in_inr: listing.price_in_inr ?? "",
    area_sqft: listing.area_sqft ?? "",
    property_type: listing.property_type || "Apartment",
    listing_type: listing.listing_type || "Sale",
    bhk: listing.bhk ?? "",
    area_unit: listing.area_unit || "sqft",
    builder_name: listing.builder_name || "",
    amenities: listing.amenities || "",
    availability_status: listing.availability_status || "Ready to Move",
    security_deposit: listing.security_deposit ?? "",
  });
  const setField = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const [existingImages, setExistingImages] = useState(listing.image_urls || []);
  const [removedUrls, setRemovedUrls] = useState([]);
  const [newImages, setNewImages] = useState([]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [deleteStep, setDeleteStep] = useState(0); // 0 = idle, 1 = confirming
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const keptCount = existingImages.length - removedUrls.length;
  const totalCount = keptCount + newImages.length;

  const markRemoved = (url) => setRemovedUrls((r) => [...r, url]);
  const undoRemoved = (url) => setRemovedUrls((r) => r.filter((u) => u !== url));

  const handleNewImageSelect = (e) => {
    const picked = Array.from(e.target.files || []);
    setNewImages((prev) => [...prev, ...picked].slice(0, Math.max(0, MAX_IMAGES - keptCount)));
    e.target.value = "";
  };
  const removeNewImage = (idx) => setNewImages((prev) => prev.filter((_, i) => i !== idx));

  const handleSave = async (e) => {
    e.preventDefault();
    if (saving) return;
    setError("");
    if (!form.property_name.trim() || !form.city.trim() || !form.location.trim() || !String(form.price_in_inr).trim() || !String(form.area_sqft).trim()) {
      setError("Property name, city, location, price and area are required.");
      return;
    }
    if (totalCount === 0) {
      setError("A listing needs at least one photo — add a replacement before removing the last one.");
      return;
    }
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append("property_name", form.property_name.trim());
      fd.append("city", form.city.trim());
      fd.append("location", form.location.trim());
      fd.append("price_in_inr", String(Number(form.price_in_inr)));
      fd.append("area_sqft", String(Number(form.area_sqft)));
      fd.append("property_type", form.property_type);
      fd.append("listing_type", form.listing_type);
      fd.append("area_unit", form.area_unit.trim() || "sqft");
      fd.append("availability_status", form.availability_status);
      if (String(form.bhk).trim() !== "") fd.append("bhk", String(Number(form.bhk)));
      if (form.builder_name.trim()) fd.append("builder_name", form.builder_name.trim());
      if (form.amenities.trim()) fd.append("amenities", form.amenities.trim());
      if (form.listing_type === "Rent" && String(form.security_deposit).trim() !== "") {
        fd.append("security_deposit", String(Number(form.security_deposit)));
      }
      if (removedUrls.length > 0) fd.append("remove_image_urls", JSON.stringify(removedUrls));
      newImages.forEach((file) => fd.append("images", file));

      const res = await fetch(`${API_BASE}/broker/listings/${listing.id}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(errDetail(data, "Could not save changes"));
      onSaved(data);
    } catch (err) {
      setError(err.message || "Could not save changes.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (deleting) return;
    setDeleteError("");
    setDeleting(true);
    try {
      const res = await fetch(`${API_BASE}/broker/listings/${listing.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(errDetail(data, "Could not delete the listing"));
      }
      onDeleted(listing.id);
    } catch (err) {
      setDeleteError(err.message || "Could not delete the listing.");
      setDeleting(false);
    }
  };

  const fieldCls =
    "w-full bg-[#FAF8F4]/90 border border-[#E4DCC9] focus:border-[#C6A15B] rounded-md py-2 px-3 text-sm text-[#2B2B2B] placeholder-[#8B8B8B] focus:outline-none focus:ring-2 focus:ring-[#C6A15B]/30 transition disabled:opacity-50";
  const labelCls = "text-[10px] font-mono uppercase tracking-wider text-[#8B8B8B]";
  const busy = saving || deleting;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl bg-white border border-[#E4DCC9] rounded-md shadow-2xl my-6"
      >
        <div className="p-4 border-b border-[#E4DCC9] flex items-center justify-between sticky top-0 bg-white z-10 rounded-t-md">
          <h2 className="text-sm font-display text-[#2B2B2B]">Edit Listing</h2>
          <button onClick={onClose} disabled={busy} aria-label="Close" className="p-1.5 bg-[#FAF8F4] border border-[#E4DCC9] rounded-sm text-[#2B2B2B] hover:bg-[#E9DFC8] transition disabled:opacity-50">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSave} className="p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="space-y-1 sm:col-span-2">
              <span className={labelCls}>Property Name *</span>
              <input className={fieldCls} value={form.property_name} onChange={setField("property_name")} disabled={busy} />
            </label>
            <label className="space-y-1">
              <span className={labelCls}>City *</span>
              <input className={fieldCls} value={form.city} onChange={setField("city")} disabled={busy} />
            </label>
            <label className="space-y-1">
              <span className={labelCls}>Location / Area *</span>
              <input className={fieldCls} value={form.location} onChange={setField("location")} disabled={busy} />
            </label>

            <label className="space-y-1">
              <span className={labelCls}>Listing For</span>
              <select className={fieldCls} value={form.listing_type} onChange={setField("listing_type")} disabled={busy}>
                <option value="Sale">For Sale</option>
                <option value="Rent">For Rent</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className={labelCls}>{form.listing_type === "Rent" ? "Monthly Rent (INR) *" : "Price (INR) *"}</span>
              <input className={fieldCls} type="number" min="0" value={form.price_in_inr} onChange={setField("price_in_inr")} disabled={busy} />
            </label>
            {form.listing_type === "Rent" && (
              <label className="space-y-1">
                <span className={labelCls}>Security Deposit (INR)</span>
                <input className={fieldCls} type="number" min="0" value={form.security_deposit} onChange={setField("security_deposit")} disabled={busy} />
              </label>
            )}

            <label className="space-y-1">
              <span className={labelCls}>BHK</span>
              <input className={fieldCls} type="number" min="0" value={form.bhk} onChange={setField("bhk")} placeholder="leave blank for plots" disabled={busy} />
            </label>
            <label className="space-y-1">
              <span className={labelCls}>Area *</span>
              <input className={fieldCls} type="number" min="0" value={form.area_sqft} onChange={setField("area_sqft")} disabled={busy} />
            </label>
            <label className="space-y-1">
              <span className={labelCls}>Area Unit</span>
              <select className={fieldCls} value={form.area_unit} onChange={setField("area_unit")} disabled={busy}>
                {["sqft", "sq_yard", "acre", "hectare"].map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </label>
            <label className="space-y-1">
              <span className={labelCls}>Property Type</span>
              <select className={fieldCls} value={form.property_type} onChange={setField("property_type")} disabled={busy}>
                {["Apartment", "Villa", "Plot", "Commercial", "Independent House"].map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label className="space-y-1">
              <span className={labelCls}>Availability</span>
              <select className={fieldCls} value={form.availability_status} onChange={setField("availability_status")} disabled={busy}>
                {["Ready to Move", "Under Construction", "New Launch"].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label className="space-y-1">
              <span className={labelCls}>Builder Name</span>
              <input className={fieldCls} value={form.builder_name} onChange={setField("builder_name")} disabled={busy} />
            </label>
            <label className="space-y-1 sm:col-span-2">
              <span className={labelCls}>Amenities</span>
              <input className={fieldCls} value={form.amenities} onChange={setField("amenities")} disabled={busy} />
            </label>
          </div>

          <div className="space-y-2">
            <span className="text-[10px] font-mono uppercase tracking-wider text-[#8B8B8B]">
              Photos ({totalCount}/{MAX_IMAGES})
            </span>
            {existingImages.length > 0 && (
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                {existingImages.map((url) => {
                  const isRemoved = removedUrls.includes(url);
                  return (
                    <div key={url} className={`relative group rounded-md overflow-hidden border h-20 ${isRemoved ? "border-[#C24545]/40 opacity-40" : "border-[#E4DCC9] bg-[#FAF8F4]"}`}>
                      <img src={resolveImg(url)} alt="Listing photo" className="w-full h-full object-cover" />
                      <button
                        type="button"
                        onClick={() => (isRemoved ? undoRemoved(url) : markRemoved(url))}
                        disabled={busy}
                        title={isRemoved ? "Keep this photo" : "Remove this photo"}
                        className={`absolute top-1 right-1 p-1 rounded-full text-white transition ${isRemoved ? "bg-[#4B7A46]/90 hover:bg-[#4B7A46]" : "bg-red-600/90 hover:bg-red-700 opacity-0 group-hover:opacity-100"}`}
                      >
                        {isRemoved ? <RotateCcw className="w-3 h-3" /> : <X className="w-3 h-3" />}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {newImages.length > 0 && (
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                {newImages.map((file, idx) => (
                  <div key={idx} className="relative group rounded-md overflow-hidden border border-[#A9C9A0]/60 bg-[#FAF8F4] h-20">
                    <img src={URL.createObjectURL(file)} alt={file.name} className="w-full h-full object-cover" />
                    <span className="absolute bottom-1 left-1 bg-[#4B7A46]/90 text-white text-[8px] font-mono px-1 py-0.5 rounded">NEW</span>
                    <button
                      type="button"
                      onClick={() => removeNewImage(idx)}
                      disabled={busy}
                      className="absolute top-1 right-1 p-1 bg-red-600/90 hover:bg-red-700 text-white rounded-full transition opacity-0 group-hover:opacity-100"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {totalCount < MAX_IMAGES && (
              <label className="flex flex-col items-center justify-center gap-1 border-2 border-dashed border-[#E4DCC9] hover:border-[#C6A15B]/50 rounded-md p-4 text-center bg-[#FAF8F4]/60 transition cursor-pointer">
                <input type="file" multiple accept="image/*" className="hidden" onChange={handleNewImageSelect} disabled={busy} />
                <Upload className="w-5 h-5 text-[#C6A15B]" />
                <span className="text-xs text-[#5B5B5B] font-medium">Add more photos</span>
              </label>
            )}
          </div>

          {error && (
            <div className="flex items-start gap-2 p-2.5 bg-[#FBEAEA]/25 border border-[#C24545]/40 rounded-sm text-xs text-[#C24545]">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" /> <span>{error}</span>
            </div>
          )}

          <div className="flex items-center gap-2 pt-1">
            <button
              type="submit"
              disabled={busy}
              className="flex items-center justify-center gap-2 px-4 py-2 rounded-sm bg-[#C6A15B] hover:bg-[#D9B876] disabled:opacity-40 text-[#1E1E1E] font-semibold text-xs transition font-mono uppercase tracking-wider"
            >
              {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</> : <><Save className="w-4 h-4" /> Save Changes</>}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="px-4 py-2 bg-[#F1E9D8] hover:bg-[#E9DFC8] text-[#5B5B5B] border border-[#E4DCC9] rounded-sm text-xs font-mono transition disabled:opacity-40"
            >
              Cancel
            </button>
          </div>
        </form>

        {/* Danger zone: delete the whole listing, e.g. once it's sold/rented */}
        <div className="p-5 pt-0">
          <div className="p-3 bg-[#FBEAEA]/20 border border-[#C24545]/30 rounded-md space-y-2">
            <p className="text-[11px] text-[#8B8B8B]">Sold, rented out, or listed by mistake? Remove it entirely.</p>
            {deleteError && (
              <div className="flex items-start gap-2 text-xs text-[#C24545]">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" /> <span>{deleteError}</span>
              </div>
            )}
            {deleteStep === 0 ? (
              <button
                type="button"
                onClick={() => setDeleteStep(1)}
                disabled={busy}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-[#FBEAEA]/40 text-[#C24545] border border-[#C24545]/40 rounded-sm text-xs font-mono transition disabled:opacity-40"
              >
                <Trash2 className="w-3.5 h-3.5" /> Delete Listing
              </button>
            ) : (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-[#C24545] font-medium">Delete "{listing.property_name}" permanently? This can't be undone.</span>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={busy}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-[#C24545] hover:bg-[#A93A3A] text-white rounded-sm text-xs font-mono font-semibold transition disabled:opacity-40"
                >
                  {deleting ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Deleting...</> : "Yes, Delete It"}
                </button>
                <button
                  type="button"
                  onClick={() => setDeleteStep(0)}
                  disabled={busy}
                  className="px-3 py-1.5 bg-[#F1E9D8] hover:bg-[#E9DFC8] text-[#5B5B5B] border border-[#E4DCC9] rounded-sm text-xs font-mono transition disabled:opacity-40"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
