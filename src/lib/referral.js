import { base44 } from "@/api/base44Client";

const REF_KEY = "pl_ref_code";
const SESSION_KEY = "pl_ref_clicked";
const SESSION_ID_KEY = "pl_session_id";

function safeGet(storage, key) {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(storage, key, value) {
  try {
    storage.setItem(key, value);
  } catch {
    /* storage indisponível */
  }
}

export function captureReferral() {
  const params = new URLSearchParams(window.location.search);
  const code = (params.get("ref") || "").trim().toUpperCase();
  if (!code) return;
  safeSet(localStorage, REF_KEY, code);
  if (safeGet(sessionStorage, SESSION_KEY) === code) return;
  let sessionId = safeGet(sessionStorage, SESSION_ID_KEY);
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    safeSet(sessionStorage, SESSION_ID_KEY, sessionId);
  }
  safeSet(sessionStorage, SESSION_KEY, code);
  base44.functions
    .invoke("trackAffiliateClick", {
      code,
      path: window.location.pathname,
      session_id: sessionId,
      origin: window.location.origin,
    })
    .catch(() => {
      /* contagem de cliques é auxiliar: não deve interromper a navegação */
    });
}

export function storedReferralCode() {
  return safeGet(localStorage, REF_KEY) || "";
}

export function clearReferralCode() {
  try {
    localStorage.removeItem(REF_KEY);
  } catch {
    /* storage indisponível */
  }
}