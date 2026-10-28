const TRACKING_KEYS = ["src", "sck", "utm_source", "utm_campaign", "utm_medium", "utm_content", "utm_term"];
const STORAGE_KEY = "utm_tracking";

/** Captura os parâmetros de rastreio da URL atual e guarda no dispositivo. */
export function captureUtmParams() {
  try {
    const params = new URLSearchParams(window.location.search);
    const found = {};
    TRACKING_KEYS.forEach((key) => {
      const value = params.get(key);
      if (value) found[key] = value.slice(0, 255);
    });
    if (Object.keys(found).length) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...getStoredUtm(), ...found }));
    }
  } catch {
    // armazenamento indisponível — segue sem rastreio
  }
}

/** Parâmetros de rastreio guardados neste dispositivo. */
export function getStoredUtm() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}