// Dev-only gallery of the Jaya page over fake data, served at /jaya-preview.html; not in the packaged app.
// ?state=start|intake|done|dashboard&skin=midnight|daylight&lang=pt-br
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { JayaPage } from "@/components/jaya/JayaPage";
import { jayaPreviewView } from "@/components/jaya/preview-data";
import { loadLocale } from "@/lib/i18n";
import { applySkinChoice, SKIN_IDS, type SkinId } from "@/lib/skins";
import { initialState, StoreContext } from "@/state/store";
import "./styles.css";

const params = new URLSearchParams(location.search);
const state = params.get("state") ?? "intake";
const skin = params.get("skin") ?? "midnight";
applySkinChoice(SKIN_IDS.includes(skin as SkinId) ? (skin as SkinId) : "midnight");
await loadLocale(params.get("lang") ?? "en");

const view = jayaPreviewView(state, Date.now());
const reply = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } }));
window.fetch = (input) => {
  const path = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
  if (path === "/api/jaya/engagements") return reply(view ? [view.engagement] : []);
  if (path.startsWith("/api/jaya/engagements/") && view) return reply(view);
  return reply({});
};

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StoreContext.Provider value={{ state: initialState, dispatch: () => {} } as never}>
      <div className="flex h-dvh bg-app"><JayaPage /></div>
    </StoreContext.Provider>
  </StrictMode>,
);
