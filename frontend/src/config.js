// Backend origin. Set VITE_API_URL in the hosting dashboard (Render static site) to
// the deployed backend, e.g. https://casiva-api.onrender.com — no trailing slash.
export const API_ORIGIN = (import.meta.env.VITE_API_URL || "http://localhost:8000").replace(/\/+$/, "");
