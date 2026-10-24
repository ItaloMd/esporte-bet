import { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";

const DEFAULT_SETTINGS = {
  brand_name: "Placar",
  tagline: "Odds informativas e simulações esportivas",
  accent_color: "#FF2222",
  demo_mode: true,
  support_email: "",
  deposits_enabled: true,
  withdrawals_enabled: true,
  min_deposit: 10,
  min_withdrawal: 30,
  rollover_multiplier: 1,
  withdrawal_fee: 3,
};

let cached = null;
let inflight = null;
const listeners = new Set();

function hexToHsl(hex) {
  const clean = String(hex || "").replace("#", "");
  if (clean.length !== 6) return null;
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  const l = (max + min) / 2;
  const d = max - min;
  let s = 0;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return `${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

export function applyAccent(hex) {
  const hsl = hexToHsl(hex);
  if (!hsl) return;
  const root = document.documentElement;
  root.style.setProperty("--primary", hsl);
  root.style.setProperty("--ring", hsl);
  root.style.setProperty("--sidebar-primary", hsl);
}

function setFavicon(settings) {
  const url = settings.favicon_url;
  if (!url) return;
  let link = document.querySelector("link[rel='icon']");
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  link.href = url;
}

function publish(settings) {
  cached = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  applyAccent(cached.accent_color);
  setFavicon(cached);
  listeners.forEach((fn) => fn(cached));
}

export function setLocalSettings(partial) {
  publish({ ...(cached || DEFAULT_SETTINGS), ...partial });
}

export function loadAppSettings() {
  if (cached) return Promise.resolve(cached);
  if (!inflight) {
    inflight = base44.entities.AppSettings.list({ limit: 1 })
      .then((page) => {
        publish(page.items?.[0] || null);
        return cached;
      })
      .catch(() => {
        publish(null);
        return cached;
      });
  }
  return inflight;
}

export function useAppSettings() {
  const [settings, setSettings] = useState(cached || DEFAULT_SETTINGS);
  useEffect(() => {
    listeners.add(setSettings);
    loadAppSettings().then((value) => value && setSettings(value));
    return () => listeners.delete(setSettings);
  }, []);
  return settings;
}