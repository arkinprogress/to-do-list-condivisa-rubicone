import { useState, useEffect, useRef, useCallback } from "react";

// ─── Config ─────────────────────────────────────────────────────────
const SUPABASE_URL = "https://hetlweyvkpefqyxoazwh.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhldGx3ZXl2a3BlZnF5eG9hendoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDQxMTA1MjksImV4cCI6MjA1OTY4NjUyOX0.kWbIKA-SWbJHLObtfJcRPSuOtPbZwVzrxEZIOJ6SLUQ";
const TABLE = "checklist_items";
const APP_TITLE = "Lista condivisa";

// ─── Safe localStorage ───────────────────────────────────────────────
const ls = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};

// ─── Supabase helpers ────────────────────────────────────────────────
async function sbFetch(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) { const t = await res.text(); throw new Error(t); }
  const t = await res.text();
  return t ? JSON.parse(t) : null;
}

const fetchItems = () => sbFetch(`/${TABLE}?order=created_at.asc`);
const addItem = (text, image_url) =>
  sbFetch(`/${TABLE}`, { method: "POST", body: JSON.stringify({ text, completed: false, image_url: image_url || null }) });
const toggleItem = (id, completed) =>
  sbFetch(`/${TABLE}?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ completed, updated_at: new Date().toISOString() }) });
const deleteItem = (id) => sbFetch(`/${TABLE}?id=eq.${id}`, { method: "DELETE" });
const clearCompleted = () => sbFetch(`/${TABLE}?completed=eq.true`, { method: "DELETE" });

// ─── PDF export ─────────────────────────────────────────────────────
function exportPDF(items) {
  const now = new Date().toLocaleString("it-IT", { dateStyle: "long", timeStyle: "short" });
  const todo = items.filter(i => !i.completed);
  const done = items.filter(i => i.completed);

  const row = (item, checked) => `
    <tr>
      <td style="width:22px;padding:8px 6px 8px 0;vertical-align:top;">
        <div style="width:16px;height:16px;border:2px solid ${checked ? "#3DAA72" : "#999"};
          border-radius:4px;background:${checked ? "#3DAA72" : "#fff"};display:flex;
          align-items:center;justify-content:center;flex-shrink:0;">
          ${checked ? '<span style="color:#fff;font-size:11px;font-weight:800;line-height:1;">✓</span>' : ""}
        </div>
      </td>
      <td style="padding:8px 0;font-size:13px;color:${checked ? "#888" : "#1A1A2E"};
        text-decoration:${checked ? "line-through" : "none"};vertical-align:top;line-height:1.5;">
        ${item.text}
      </td>
    </tr>`;

  const section = (title, list, color) => list.length === 0 ? "" : `
    <div style="margin-bottom:24px;">
      <div style="font-size:11px;font-weight:700;letter-spacing:1.2px;color:${color};
        text-transform:uppercase;margin-bottom:10px;padding-bottom:6px;
        border-bottom:2px solid ${color}22;">${title} (${list.length})</div>
      <table style="width:100%;border-collapse:collapse;">
        ${list.map(i => row(i, i.completed)).join("")}
      </table>
    </div>`;

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
  <title>Lista condivisa — Report</title>
  <style>
    @media print {
      body { margin: 0; }
      @page { margin: 20mm 18mm; size: A4; }
    }
    body { font-family: 'Segoe UI', system-ui, sans-serif; color: #1A1A2E; background: #fff; }
  </style>
  </head><body>
  <div style="max-width:600px;margin:0 auto;padding:32px 0;">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px;">
      <span style="font-size:22px;">📋</span>
      <h1 style="margin:0;font-size:20px;font-weight:700;letter-spacing:-0.4px;">Lista condivisa</h1>
    </div>
    <p style="margin:0 0 28px;font-size:12px;color:#888;">Report generato il ${now}</p>
    <div style="background:#F0F4FF;border-radius:10px;padding:14px 18px;margin-bottom:28px;
      display:flex;gap:32px;">
      <div><span style="font-size:22px;font-weight:700;color:#5B5FEF;">${todo.length}</span>
        <div style="font-size:11px;color:#666;margin-top:2px;">Da fare</div></div>
      <div><span style="font-size:22px;font-weight:700;color:#3DAA72;">${done.length}</span>
        <div style="font-size:11px;color:#666;margin-top:2px;">Completati</div></div>
      <div><span style="font-size:22px;font-weight:700;color:#1A1A2E;">${items.length}</span>
        <div style="font-size:11px;color:#666;margin-top:2px;">Totale</div></div>
    </div>
    ${section("Da fare", todo, "#5B5FEF")}
    ${section("Completati", done, "#3DAA72")}
  </div>
  <script>window.onload = () => { window.print(); }<\/script>
  </body></html>`;

  const win = window.open("", "_blank");
  if (!win) { alert("Abilita i popup per scaricare il PDF"); return; }
  win.document.write(html);
  win.document.close();
}

// ─── DB setup via Anthropic API + Supabase MCP ───────────────────────
async function ensureSetup() {
  try {
    await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1000,
        mcp_servers: [{ type: "url", url: "https://mcp.supabase.com/mcp", name: "supabase" }],
        messages: [{
          role: "user",
          content: `Run this SQL on the Supabase project:

CREATE TABLE IF NOT EXISTS checklist_items (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  text text NOT NULL,
  completed boolean DEFAULT false,
  image_url text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_policies WHERE tablename='checklist_items' AND policyname='Allow all') THEN
    ALTER TABLE checklist_items ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "Allow all" ON checklist_items FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

ALTER TABLE checklist_items ADD COLUMN IF NOT EXISTS image_url text;

Reply "done".`
        }]
      })
    });
  } catch { /* silent */ }
}

// ─── ntfy.sh push notification ───────────────────────────────────────
async function sendNtfy(topic, text) {
  if (!topic) return;
  try {
    await fetch(`https://ntfy.sh/${topic}`, {
      method: "POST",
      body: `📋 Nuova voce: "${text}"`,
      headers: { Title: APP_TITLE, Priority: "default", Tags: "memo,it" },
    });
  } catch { /* silent */ }
}

// ─── Image compression ───────────────────────────────────────────────
function compressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const MAX = 900;
        let { width, height } = img;
        if (width > MAX || height > MAX) {
          if (width > height) { height = Math.round(height * MAX / width); width = MAX; }
          else { width = Math.round(width * MAX / height); height = MAX; }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.72));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ─── Tab badge hook ──────────────────────────────────────────────────
function useTabBadge(count) {
  useEffect(() => {
    document.title = count > 0 ? `(${count}) ${APP_TITLE}` : APP_TITLE;
  }, [count]);
}

// ─── Soft chime ──────────────────────────────────────────────────────
function playChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = "sine"; osc.frequency.value = 880;
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.18, ctx.currentTime + 0.05);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.45);
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.5);
  } catch { /* silent */ }
}

// ─── Realtime sync hook ──────────────────────────────────────────────
function useRealtimeSync(onInsert, onAny) {
  const wsRef = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => {
    let alive = true;

    function connect() {
      if (!alive) return;
      const url = SUPABASE_URL.replace("https://", "wss://")
        + `/realtime/v1/websocket?apikey=${SUPABASE_ANON_KEY}&vsn=1.0.0`;
      const ws = new WebSocket(url);
      wsRef.current = ws;
      ws.onopen = () => {
        ws.send(JSON.stringify({
          topic: `realtime:public:${TABLE}`,
          event: "phx_join", payload: {}, ref: "1"
        }));
      };
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        const type = msg?.payload?.type;
        if (type === "INSERT") { onInsert(); onAny(); }
        else if (type === "UPDATE" || type === "DELETE") { onAny(); }
      };
      ws.onclose = () => { if (alive) timerRef.current = setTimeout(connect, 4000); };
    }

    connect();
    const poll = setInterval(onAny, 6000);
    return () => {
      alive = false;
      clearTimeout(timerRef.current);
      clearInterval(poll);
      wsRef.current?.close();
    };
  }, [onInsert, onAny]);
}

// ─── NtfySetup component ─────────────────────────────────────────────
function NtfySetup({ onSave }) {
  const [val, setVal] = useState("");
  const [suggested] = useState("lista-" + Math.random().toString(36).slice(2, 8));

  return (
    <div style={{
      margin: "14px 16px 0", padding: "16px", borderRadius: 14,
      background: "#FFF8E7", border: "1.5px solid #FFD966",
      maxWidth: 540, boxSizing: "border-box",
    }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: "#7A5C00", marginBottom: 6 }}>
        🔔 Configura le notifiche push
      </div>
      <div style={{ fontSize: 13, color: "#7A5C00", marginBottom: 10, lineHeight: 1.5 }}>
        Scegli un nome segreto per il canale. Tutte le colleghe devono usare lo stesso nome
        e installare l'app <strong>ntfy</strong> sul telefono.
      </div>
      <div style={{ fontSize: 12, color: "#9A7A20", marginBottom: 10 }}>
        Suggerito: <code style={{ background: "#FFF3CC", padding: "1px 5px", borderRadius: 4 }}>{suggested}</code>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={val}
          onChange={e => setVal(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
          placeholder={suggested}
          style={{
            flex: 1, padding: "9px 12px", borderRadius: 9,
            border: "1.5px solid #FFD966", fontSize: 14, outline: "none", background: "#fff",
          }}
        />
        <button
          onClick={() => onSave(val || suggested)}
          style={{
            padding: "9px 14px", borderRadius: 9, border: "none",
            background: "#F4B400", color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer",
          }}
        >Salva</button>
      </div>
      <div style={{ fontSize: 11, color: "#9A7A20", marginTop: 8 }}>
        📱 Dopo: installa <strong>ntfy</strong> sul telefono → abbonati al canale → ricevi notifiche anche con app chiusa!
      </div>
    </div>
  );
}

// ─── ItemCard component ───────────────────────────────────────────────
function ItemCard({ item, onToggle, onDelete, onImageClick }) {
  return (
    <div style={{
      background: "#fff", borderRadius: 13,
      border: item.completed ? "1.5px solid #C8EDD8" : "1.5px solid #ECEAE6",
      boxShadow: "0 1px 4px rgba(0,0,0,0.055)",
      overflow: "hidden",
      opacity: item.completed ? 0.72 : 1,
      transition: "opacity 0.2s",
    }}>
      {item.image_url && (
        <div
          onClick={() => onImageClick(item.image_url)}
          style={{ width: "100%", height: 170, overflow: "hidden", cursor: "zoom-in", background: "#F0EEEB" }}
        >
          <img src={item.image_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 13px" }}>
        <button
          onClick={() => onToggle(item.id, item.completed)}
          style={{
            width: 26, height: 26, borderRadius: 8, flexShrink: 0,
            border: item.completed ? "none" : "2px solid #C5C1BC",
            background: item.completed ? "#3DAA72" : "transparent",
            cursor: "pointer", display: "flex", alignItems: "center",
            justifyContent: "center", padding: 0, transition: "all 0.18s",
          }}
        >
          {item.completed && <span style={{ color: "#fff", fontSize: 13, fontWeight: 800 }}>✓</span>}
        </button>
        <span style={{
          flex: 1, fontSize: 16, color: item.completed ? "#999" : "#1A1A2E",
          textDecoration: item.completed ? "line-through" : "none",
          wordBreak: "break-word", lineHeight: 1.4,
        }}>
          {item.text}
        </span>
        <button
          onClick={() => onDelete(item.id)}
          style={{
            width: 28, height: 28, borderRadius: 8, border: "none",
            background: "transparent", color: "#C5C1BC", cursor: "pointer",
            fontSize: 16, display: "flex", alignItems: "center",
            justifyContent: "center", padding: 0, flexShrink: 0,
          }}
          onMouseEnter={e => e.currentTarget.style.color = "#E05252"}
          onMouseLeave={e => e.currentTarget.style.color = "#C5C1BC"}
        >✕</button>
      </div>
    </div>
  );
}

// ─── Lightbox ────────────────────────────────────────────────────────
function Lightbox({ src, onClose }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 1000, cursor: "zoom-out",
      }}
    >
      <img
        src={src} alt=""
        style={{ maxWidth: "95vw", maxHeight: "90vh", borderRadius: 10, objectFit: "contain" }}
        onClick={e => e.stopPropagation()}
      />
      <button
        onClick={onClose}
        style={{
          position: "absolute", top: 18, right: 18, background: "rgba(255,255,255,0.15)",
          border: "none", color: "#fff", fontSize: 22, width: 40, height: 40,
          borderRadius: "50%", cursor: "pointer", display: "flex",
          alignItems: "center", justifyContent: "center",
        }}
      >✕</button>
    </div>
  );
}

// ─── Main App ────────────────────────────────────────────────────────
export default function App() {
  const [items, setItems] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState(null);
  const [imageData, setImageData] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [newCount, setNewCount] = useState(0);
  const [ntfyTopic, setNtfyTopic] = useState(null);
  const [showNtfySetup, setShowNtfySetup] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState(null);
  const [setupDone, setSetupDone] = useState(false);
  const inputRef = useRef(null);
  const isFirstLoad = useRef(true);

  useTabBadge(newCount);

  useEffect(() => {
    const saved = ls.get("ntfy_topic");
    if (saved) setNtfyTopic(saved);
    else setShowNtfySetup(true);
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await ensureSetup();
      setSetupDone(true);
      await load();
    })();
  }, []);

  useEffect(() => {
    const clear = () => setNewCount(0);
    window.addEventListener("focus", clear);
    return () => window.removeEventListener("focus", clear);
  }, []);

  const load = async () => {
    try {
      const data = await fetchItems();
      setItems(data || []);
      setError(null);
    } catch { setError("Errore di connessione"); }
    finally { setLoading(false); }
  };

  const onInsert = useCallback(() => {
    if (isFirstLoad.current) return;
    setNewCount(n => n + 1);
    playChime();
  }, []);

  const onAny = useCallback(() => {
    if (!isFirstLoad.current) load();
  }, [setupDone]);

  useEffect(() => {
    if (!loading) isFirstLoad.current = false;
  }, [loading]);

  useRealtimeSync(onInsert, onAny);

  const handleImageSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await compressImage(file);
      setImageData(compressed);
      setImagePreview(compressed);
    } catch { setError("Errore immagine"); }
    e.target.value = "";
  };

  const clearImage = () => { setImageData(null); setImagePreview(null); };

  const handleAdd = async () => {
    const text = input.trim();
    if (!text) return;
    setInput(""); clearImage();
    setSyncing(true);
    try {
      await addItem(text, imageData);
      await sendNtfy(ntfyTopic, text);
      await load();
    } catch { setError("Errore aggiunta"); }
    setSyncing(false);
    inputRef.current?.focus();
  };

  const handleToggle = async (id, completed) => {
    setSyncing(true);
    try { await toggleItem(id, !completed); await load(); }
    catch { setError("Errore aggiornamento"); }
    setSyncing(false);
  };

  const handleDelete = async (id) => {
    setSyncing(true);
    try { await deleteItem(id); await load(); }
    catch { setError("Errore eliminazione"); }
    setSyncing(false);
  };

  const handleClearCompleted = async () => {
    setSyncing(true);
    try { await clearCompleted(); await load(); }
    catch { setError("Errore pulizia"); }
    setSyncing(false);
  };

  const saveNtfyTopic = (topic) => {
    setNtfyTopic(topic);
    ls.set("ntfy_topic", topic);
    setShowNtfySetup(false);
  };

  const done = items.filter(i => i.completed).length;
  const total = items.length;

  return (
    <div style={{
      minHeight: "100vh", background: "#F5F3F0",
      fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
      paddingBottom: 60,
    }}>
      {/* Header */}
      <div style={{
        background: "#1A1A2E", padding: "24px 20px 18px",
        display: "flex", flexDirection: "column", alignItems: "center",
        boxShadow: "0 2px 16px rgba(0,0,0,0.2)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <span style={{ fontSize: 24 }}>📋</span>
          <h1 style={{ color: "#fff", margin: 0, fontSize: 21, fontWeight: 700, letterSpacing: "-0.4px" }}>
            {APP_TITLE}
          </h1>
          {newCount > 0 && (
            <div
              onClick={() => setNewCount(0)}
              style={{
                background: "#EF4444", color: "#fff", borderRadius: "50%",
                width: 22, height: 22, fontSize: 12, fontWeight: 700,
                display: "flex", alignItems: "center", justifyContent: "center",
                cursor: "pointer", flexShrink: 0,
              }}
            >{newCount}</div>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{
            width: 7, height: 7, borderRadius: "50%",
            background: syncing ? "#F4B400" : "#3DAA72",
            transition: "background 0.3s",
          }} />
          <p style={{ color: "#9AA0B8", margin: 0, fontSize: 13 }}>
            {syncing ? "Sincronizzazione…" : `${done}/${total} completati`}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap", justifyContent: "center" }}>
          {ntfyTopic && (
            <button
              onClick={() => setShowNtfySetup(s => !s)}
              style={{
                background: "transparent", border: "1px solid #3A3A5C",
                borderRadius: 8, padding: "4px 10px", color: "#7A80A0",
                fontSize: 11, cursor: "pointer",
              }}
            >🔔 {ntfyTopic} · modifica</button>
          )}
          {items.length > 0 && (
            <button
              onClick={() => exportPDF(items)}
              style={{
                background: "transparent", border: "1px solid #3A3A5C",
                borderRadius: 8, padding: "4px 10px", color: "#7A80A0",
                fontSize: 11, cursor: "pointer",
              }}
            >📄 Scarica PDF</button>
          )}
        </div>
      </div>

      {/* Ntfy setup */}
      {showNtfySetup && (
        <div style={{ maxWidth: 540, margin: "0 auto" }}>
          <NtfySetup onSave={saveNtfyTopic} />
        </div>
      )}

      {/* Input */}
      <div style={{ padding: "16px 16px 0", maxWidth: 540, margin: "0 auto", boxSizing: "border-box" }}>
        {/* Text input full width */}
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && handleAdd()}
          placeholder="Aggiungi voce…"
          style={{
            width: "100%", padding: "13px 15px", borderRadius: 12,
            border: "2px solid #E2DDD8", fontSize: 16, outline: "none",
            background: "#fff", color: "#1A1A2E", transition: "border-color 0.2s",
            boxSizing: "border-box", marginBottom: 8, display: "block",
          }}
          onFocus={e => e.target.style.borderColor = "#5B5FEF"}
          onBlur={e => e.target.style.borderColor = "#E2DDD8"}
        />
        {/* Camera + Add button row */}
        <div style={{ display: "flex", gap: 8 }}>
          <label style={{
            flex: 1, padding: "13px 14px", borderRadius: 12, border: "2px solid #E2DDD8",
            background: imageData ? "#E8F5E9" : "#fff", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 15, gap: 6, color: imageData ? "#3DAA72" : "#666",
            transition: "all 0.2s",
          }}>
            📷 <span>{imageData ? "Foto allegata" : "Foto"}</span>
            <input type="file" accept="image/*" capture="environment"
              onChange={handleImageSelect} style={{ display: "none" }} />
          </label>
          <button
            onClick={handleAdd}
            disabled={!input.trim()}
            style={{
              flex: 2, padding: "13px 17px", borderRadius: 12, border: "none",
              background: input.trim() ? "#5B5FEF" : "#C8CAEE", color: "#fff",
              fontSize: 16, fontWeight: 700, cursor: input.trim() ? "pointer" : "default",
              transition: "background 0.2s", lineHeight: 1,
            }}
          >＋ Aggiungi</button>
        </div>

        {imagePreview && (
          <div style={{
            marginTop: 10, position: "relative", display: "inline-block",
            borderRadius: 10, overflow: "hidden", border: "2px solid #5B5FEF",
          }}>
            <img src={imagePreview} alt="" style={{ height: 90, display: "block", objectFit: "cover" }} />
            <button
              onClick={clearImage}
              style={{
                position: "absolute", top: 4, right: 4, background: "rgba(0,0,0,0.55)",
                border: "none", color: "#fff", borderRadius: "50%", width: 22, height: 22,
                fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >✕</button>
          </div>
        )}

        {error && (
          <div style={{ color: "#E05252", fontSize: 13, marginTop: 10, textAlign: "center" }}>
            {error}
          </div>
        )}
      </div>

      {/* List */}
      <div style={{ padding: "14px 16px 0", maxWidth: 540, margin: "0 auto", boxSizing: "border-box" }}>
        {loading ? (
          <div style={{ textAlign: "center", color: "#AAA6A0", padding: 48, fontSize: 15 }}>
            Caricamento…
          </div>
        ) : items.length === 0 ? (
          <div style={{ textAlign: "center", color: "#B0ACA6", padding: "48px 0", fontSize: 15 }}>
            <div style={{ fontSize: 44, marginBottom: 12 }}>✏️</div>
            Nessuna voce ancora.<br />Aggiungi la prima!
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            {items.map(item => (
              <ItemCard
                key={item.id}
                item={item}
                onToggle={handleToggle}
                onDelete={handleDelete}
                onImageClick={setLightboxSrc}
              />
            ))}
          </div>
        )}

        {done > 0 && (
          <button
            onClick={handleClearCompleted}
            style={{
              width: "100%", marginTop: 16, padding: "11px",
              borderRadius: 10, border: "1.5px solid #E0DDD8",
              background: "transparent", color: "#9A9690", fontSize: 14, cursor: "pointer",
            }}
          >
            Rimuovi completati ({done})
          </button>
        )}
      </div>

      {lightboxSrc && <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />}
    </div>
  );
}
