import { useEffect, useState } from "react";
import {
  ArrowLeft, LogOut, User, KeyRound, Lock, Heart, Loader2, AlertTriangle,
  CheckCircle2, MapPin, BedDouble, Building2, Phone, Mail, Shield,
} from "lucide-react";
import CasivaLogo from "./CasivaLogo";
import { API_ORIGIN } from "../config";

const API_BASE = `${API_ORIGIN}/api/v1`;
const MEDIA_BASE = `${API_ORIGIN}`;

// Broker-uploaded photos are server-relative ("/static/uploads/xxx.jpg");
// seed-data photos are already-absolute URLs (e.g. Unsplash). Only prefix
// the ones that need it.
const resolveImg = (url) => (url && /^https?:\/\//i.test(url) ? url : `${MEDIA_BASE}${url}`);

// "₹ 18,000/mo" for a rental, "₹ 95,00,000" for a sale listing.
const formatPrice = (p) => {
  const amount = `₹ ${Number(p.price_in_inr || 0).toLocaleString("en-IN")}`;
  return p.listing_type === "Rent" ? `${amount}/mo` : amount;
};

const errDetail = (data, fallback) => {
  const d = data?.detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d) && d.length) return d[0]?.msg || fallback;
  return fallback;
};

const TABS = [
  { key: "details", label: "Profile Details", icon: User },
  { key: "login", label: "Edit Login Details", icon: Shield },
  { key: "password", label: "Change Password", icon: KeyRound },
  { key: "bucket", label: "Bucket List", icon: Heart },
];

export default function MyProfile({ token, currentUser, onBack, onLogout, onUserUpdated }) {
  // Buyers only: /properties/my-interests (the bucket list) 403s for a broker
  // account, so brokers don't get that tab at all.
  const isBroker = currentUser?.role === "broker";
  const tabs = TABS.filter((t) => t.key !== "bucket" || !isBroker);

  const [activeTab, setActiveTab] = useState("details");

  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState("");

  const [loginForm, setLoginForm] = useState({ name: "", phone_number: "" });
  const [loginSaving, setLoginSaving] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [loginSuccess, setLoginSuccess] = useState("");

  const [pwForm, setPwForm] = useState({ current_password: "", new_password: "", confirm_password: "" });
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState("");
  const [pwSuccess, setPwSuccess] = useState("");

  const [bucket, setBucket] = useState(null);
  const [bucketLoading, setBucketLoading] = useState(false);
  const [bucketError, setBucketError] = useState("");
  const [lightboxSrc, setLightboxSrc] = useState(null);

  const authHeaders = { Authorization: `Bearer ${token}` };

  const fetchProfile = () => {
    setProfileLoading(true);
    setProfileError("");
    fetch(`${API_BASE}/auth/me`, { headers: authHeaders })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(errDetail(data, "Could not load your profile"));
        setProfile(data);
        setLoginForm({ name: data.name || "", phone_number: data.phone_number || "" });
        onUserUpdated?.({ name: data.name, email: data.email, phone_number: data.phone_number, role: data.role });
      })
      .catch((err) => setProfileError(err.message || "Could not load your profile."))
      .finally(() => setProfileLoading(false));
  };

  useEffect(() => {
    fetchProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (activeTab !== "bucket" || bucket !== null || isBroker) return;
    setBucketLoading(true);
    setBucketError("");
    fetch(`${API_BASE}/properties/my-interests`, { headers: authHeaders })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(errDetail(data, "Could not load your bucket list"));
        setBucket(Array.isArray(data) ? data : []);
      })
      .catch((err) => {
        setBucketError(err.message || "Could not load your bucket list.");
        setBucket([]);
      })
      .finally(() => setBucketLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const handleSaveLoginDetails = async (e) => {
    e.preventDefault();
    if (loginSaving) return;
    setLoginError("");
    setLoginSuccess("");
    if (!loginForm.name.trim()) {
      setLoginError("Name cannot be empty.");
      return;
    }
    setLoginSaving(true);
    try {
      const res = await fetch(`${API_BASE}/auth/me`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ name: loginForm.name.trim(), phone_number: loginForm.phone_number.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(errDetail(data, "Could not update your details"));
      setProfile(data);
      onUserUpdated?.({ name: data.name, phone_number: data.phone_number });
      setLoginSuccess("Your login details have been updated.");
    } catch (err) {
      setLoginError(err.message || "Could not update your details.");
    } finally {
      setLoginSaving(false);
    }
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    if (pwSaving) return;
    setPwError("");
    setPwSuccess("");
    if (!pwForm.current_password || !pwForm.new_password) {
      setPwError("Please fill in both password fields.");
      return;
    }
    if (pwForm.new_password.length < 6) {
      setPwError("New password must be at least 6 characters.");
      return;
    }
    if (pwForm.new_password !== pwForm.confirm_password) {
      setPwError("New password and confirmation do not match.");
      return;
    }
    setPwSaving(true);
    try {
      const res = await fetch(`${API_BASE}/auth/change-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({
          current_password: pwForm.current_password,
          new_password: pwForm.new_password,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(errDetail(data, "Could not change your password"));
      setPwSuccess("Password changed successfully.");
      setPwForm({ current_password: "", new_password: "", confirm_password: "" });
    } catch (err) {
      setPwError(err.message || "Could not change your password.");
    } finally {
      setPwSaving(false);
    }
  };

  const fieldCls =
    "w-full bg-[#FAF8F4]/90 border border-[#E4DCC9] focus:border-[#C6A15B] rounded-md py-2 px-3 text-sm text-[#2B2B2B] placeholder-[#8B8B8B] focus:outline-none focus:ring-2 focus:ring-[#C6A15B]/30 transition disabled:opacity-50";
  const labelCls = "text-[10px] font-mono uppercase tracking-wider text-[#8B8B8B]";

  return (
    <div className="flex-1 flex flex-col h-full relative z-10 bg-[#FAF8F4] overflow-hidden">
      <header className="h-16 border-b border-[#E4DCC9] flex items-center justify-between px-6 bg-white flex-shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            aria-label="Back"
            className="p-1.5 -ml-1.5 rounded-sm text-[#5B5B5B] hover:bg-[#F1E9D8] transition"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <CasivaLogo className="w-7 h-7" />
          <span className="font-display text-sm tracking-[0.15em] text-[#2B2B2B]">CASIVA</span>
          <span className="w-px h-5 bg-[#E4DCC9] hidden sm:block" />
          <h2 className="text-sm font-semibold tracking-wide text-[#5B5B5B] font-display hidden sm:block">My Profile</h2>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-[10px] font-mono bg-[#F1E9D8] text-[#8A6C34] px-3 py-1.5 rounded-sm uppercase tracking-wider hidden lg:block">
            {currentUser?.email}
          </div>
          <button
            onClick={onLogout}
            className="flex items-center gap-1.5 px-3 py-2 bg-[#FBEAEA] hover:bg-[#F5D9D9] text-[#C24545] border border-[#C24545]/30 rounded-sm text-xs font-mono transition"
          >
            <LogOut className="w-3.5 h-3.5" /> Logout
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto w-full px-6 py-8">
          <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-6">
            {/* Sidebar tabs */}
            <nav className="bg-white border border-[#E4DCC9] rounded-md p-2 h-fit space-y-1">
              {tabs.map((t) => {
                const Icon = t.icon;
                const active = activeTab === t.key;
                return (
                  <button
                    key={t.key}
                    onClick={() => setActiveTab(t.key)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-sm text-xs font-mono font-semibold transition text-left ${
                      active
                        ? "bg-[#C6A15B] text-[#1E1E1E]"
                        : "text-[#5B5B5B] hover:bg-[#F1E9D8]"
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5 flex-shrink-0" /> {t.label}
                  </button>
                );
              })}
            </nav>

            {/* Content */}
            <div className="bg-white border border-[#E4DCC9] rounded-md p-6 shadow-sm min-h-[320px]">
              {profileLoading && activeTab !== "bucket" ? (
                <div className="flex items-center gap-2 text-xs text-[#8B8B8B] font-mono">
                  <Loader2 className="w-4 h-4 animate-spin text-[#C6A15B]" /> Loading your profile...
                </div>
              ) : profileError && activeTab !== "bucket" ? (
                <div className="flex items-start gap-2 p-3 bg-[#FBEAEA]/25 border border-[#C24545]/40 text-[#C24545] text-xs rounded-sm font-mono">
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" /> {profileError}
                </div>
              ) : (
                <>
                  {activeTab === "details" && profile && (
                    <div className="space-y-5">
                      <h3 className="font-display text-lg text-[#2B2B2B]">Profile Details</h3>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                        <div className="space-y-1">
                          <span className={labelCls}>Name</span>
                          <p className="text-[#2B2B2B] font-medium">{profile.name}</p>
                        </div>
                        <div className="space-y-1">
                          <span className={labelCls}>Registered As</span>
                          <p className="text-[#2B2B2B] font-medium capitalize">{profile.role}</p>
                        </div>
                        <div className="space-y-1">
                          <span className={labelCls}>Email</span>
                          <p className="text-[#2B2B2B] font-medium flex items-center gap-1.5"><Mail className="w-3.5 h-3.5 text-[#C6A15B]" /> {profile.email}</p>
                        </div>
                        <div className="space-y-1">
                          <span className={labelCls}>Mobile</span>
                          <p className="text-[#2B2B2B] font-medium flex items-center gap-1.5">
                            <Phone className="w-3.5 h-3.5 text-[#C6A15B]" /> {profile.phone_number || "Not added"}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setActiveTab("login")}
                        className="text-xs font-mono text-[#8A6C34] hover:text-[#C6A15B] underline underline-offset-2 transition"
                      >
                        Edit name or mobile number →
                      </button>
                    </div>
                  )}

                  {activeTab === "login" && (
                    <form onSubmit={handleSaveLoginDetails} className="space-y-4 max-w-sm">
                      <h3 className="font-display text-lg text-[#2B2B2B]">Edit Login Details</h3>
                      <label className="space-y-1 block">
                        <span className={labelCls}>Name *</span>
                        <input
                          className={fieldCls}
                          value={loginForm.name}
                          onChange={(e) => setLoginForm((f) => ({ ...f, name: e.target.value }))}
                          disabled={loginSaving}
                        />
                      </label>
                      <label className="space-y-1 block">
                        <span className={labelCls}>Mobile</span>
                        <input
                          className={fieldCls}
                          type="tel"
                          value={loginForm.phone_number}
                          onChange={(e) => setLoginForm((f) => ({ ...f, phone_number: e.target.value }))}
                          placeholder="9876543210"
                          disabled={loginSaving}
                        />
                      </label>
                      <label className="space-y-1 block">
                        <span className={labelCls}>Email</span>
                        <input className={`${fieldCls} opacity-60 cursor-not-allowed`} value={profile?.email || ""} disabled />
                        <span className="text-[10px] text-[#8B8B8B]">Email is your login ID and can't be changed here.</span>
                      </label>

                      {loginError && (
                        <div className="flex items-start gap-2 p-2.5 bg-[#FBEAEA]/25 border border-[#C24545]/40 rounded-sm text-xs text-[#C24545]">
                          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" /> {loginError}
                        </div>
                      )}
                      {loginSuccess && (
                        <div className="flex items-start gap-2 p-2.5 bg-[#D9EAD3]/40 border border-[#A9C9A0]/40 rounded-sm text-xs text-[#4B7A46]">
                          <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" /> {loginSuccess}
                        </div>
                      )}

                      <button
                        type="submit"
                        disabled={loginSaving}
                        className="flex items-center justify-center gap-2 px-4 py-2 rounded-sm bg-[#C6A15B] hover:bg-[#D9B876] disabled:opacity-40 text-[#1E1E1E] font-semibold text-xs transition font-mono uppercase tracking-wider"
                      >
                        {loginSaving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</> : "Save Changes"}
                      </button>
                    </form>
                  )}

                  {activeTab === "password" && (
                    <form onSubmit={handleChangePassword} className="space-y-4 max-w-sm">
                      <h3 className="font-display text-lg text-[#2B2B2B]">Change Password</h3>
                      <label className="space-y-1 block">
                        <span className={labelCls}>Current Password *</span>
                        <input
                          className={fieldCls}
                          type="password"
                          value={pwForm.current_password}
                          onChange={(e) => setPwForm((f) => ({ ...f, current_password: e.target.value }))}
                          disabled={pwSaving}
                          autoComplete="current-password"
                        />
                      </label>
                      <label className="space-y-1 block">
                        <span className={labelCls}>New Password *</span>
                        <input
                          className={fieldCls}
                          type="password"
                          value={pwForm.new_password}
                          onChange={(e) => setPwForm((f) => ({ ...f, new_password: e.target.value }))}
                          disabled={pwSaving}
                          autoComplete="new-password"
                        />
                      </label>
                      <label className="space-y-1 block">
                        <span className={labelCls}>Confirm New Password *</span>
                        <input
                          className={fieldCls}
                          type="password"
                          value={pwForm.confirm_password}
                          onChange={(e) => setPwForm((f) => ({ ...f, confirm_password: e.target.value }))}
                          disabled={pwSaving}
                          autoComplete="new-password"
                        />
                      </label>

                      {pwError && (
                        <div className="flex items-start gap-2 p-2.5 bg-[#FBEAEA]/25 border border-[#C24545]/40 rounded-sm text-xs text-[#C24545]">
                          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" /> {pwError}
                        </div>
                      )}
                      {pwSuccess && (
                        <div className="flex items-start gap-2 p-2.5 bg-[#D9EAD3]/40 border border-[#A9C9A0]/40 rounded-sm text-xs text-[#4B7A46]">
                          <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" /> {pwSuccess}
                        </div>
                      )}

                      <button
                        type="submit"
                        disabled={pwSaving}
                        className="flex items-center justify-center gap-2 px-4 py-2 rounded-sm bg-[#C6A15B] hover:bg-[#D9B876] disabled:opacity-40 text-[#1E1E1E] font-semibold text-xs transition font-mono uppercase tracking-wider"
                      >
                        {pwSaving ? <><Loader2 className="w-4 h-4 animate-spin" /> Updating...</> : <><Lock className="w-3.5 h-3.5" /> Update Password</>}
                      </button>
                    </form>
                  )}

                  {activeTab === "bucket" && (
                    <div className="space-y-4">
                      <div className="flex items-center gap-2">
                        <h3 className="font-display text-lg text-[#2B2B2B] flex items-center gap-2">
                          <Heart className="w-4 h-4 text-[#C24545]" /> Bucket List
                        </h3>
                        {bucket && bucket.length > 0 && (
                          <span className="text-[10px] font-mono bg-[#C6A15B] text-[#1E1E1E] px-2 py-0.5 rounded-sm font-semibold">
                            {bucket.length}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[#8B8B8B] -mt-2">Properties you've marked "Interested" in.</p>

                      {bucketLoading && (
                        <div className="flex items-center gap-2 text-xs text-[#8B8B8B] font-mono">
                          <Loader2 className="w-4 h-4 animate-spin text-[#C6A15B]" /> Loading your bucket list...
                        </div>
                      )}

                      {bucketError && (
                        <div className="flex items-start gap-2 p-3 bg-[#FBEAEA]/25 border border-[#C24545]/40 text-[#C24545] text-xs rounded-sm font-mono">
                          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" /> {bucketError}
                        </div>
                      )}

                      {!bucketLoading && bucket && bucket.length === 0 && (
                        <div className="p-8 bg-[#FAF8F4] border border-[#E4DCC9] rounded-md text-center text-xs text-[#8B8B8B]">
                          You haven't shown interest in any property yet. Tap "I'm Interested" on a listing to add it here.
                        </div>
                      )}

                      {bucket && bucket.length > 0 && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          {bucket.map((item) => (
                            <div key={item.interest_id} className="border border-[#E4DCC9] rounded-md overflow-hidden bg-[#FAF8F4]/60">
                              {Array.isArray(item.image_urls) && item.image_urls.length > 0 ? (
                                <img
                                  src={resolveImg(item.image_urls[0])}
                                  alt={item.property_name}
                                  onClick={() => setLightboxSrc(resolveImg(item.image_urls[0]))}
                                  className="h-32 w-full object-cover cursor-zoom-in hover:brightness-105 transition"
                                />
                              ) : (
                                <div className="h-32 bg-[#F1E9D8] flex items-center justify-center text-[#8A6C34]">
                                  <Building2 className="w-7 h-7" />
                                </div>
                              )}
                              <div className="p-3 space-y-1.5">
                                <div className="flex items-start justify-between gap-2">
                                  <h4 className="text-sm font-display text-[#2B2B2B]">{item.property_name}</h4>
                                  {item.listing_type && (
                                    <span className={`text-[9px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-sm flex-shrink-0 ${
                                      item.listing_type === "Rent"
                                        ? "bg-[#F1E9D8] text-[#8A6C34] border border-[#C6A15B]/40"
                                        : "bg-[#E4E9F5] text-[#3B5998] border border-[#C3CCE8]"
                                    }`}>
                                      {item.listing_type === "Rent" ? "For Rent" : "For Sale"}
                                    </span>
                                  )}
                                </div>
                                <p className="text-[11px] text-[#8B8B8B] font-mono flex items-center gap-1">
                                  <MapPin className="w-3 h-3 text-[#C6A15B]" /> {item.location}{item.city ? `, ${item.city}` : ""}
                                </p>
                                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-mono text-[#6B6B6B]">
                                  <span className="text-[#2B2B2B] font-semibold">{formatPrice(item)}</span>
                                  {item.bhk != null && <span className="flex items-center gap-1"><BedDouble className="w-3 h-3 text-[#6B9A5E]" /> {item.bhk} BHK</span>}
                                  {item.property_type && <span className="text-[#8B8B8B]">{item.property_type}</span>}
                                </div>
                                {(item.broker?.name || item.broker?.phone) && (
                                  <div className="pt-2 mt-1 border-t border-[#E4DCC9]/60 text-[10px] font-mono text-[#5B5B5B] space-y-0.5">
                                    {item.broker?.name && <p className="flex items-center gap-1"><User className="w-3 h-3 text-[#C6A15B]" /> {item.broker.name}</p>}
                                    {item.broker?.phone && <p className="flex items-center gap-1"><Phone className="w-3 h-3 text-[#C6A15B]" /> {item.broker.phone}</p>}
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {lightboxSrc && (
        <div
          onClick={() => setLightboxSrc(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-6 cursor-zoom-out"
        >
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
