// ============================================================
// App.jsx — Keuangan Pribadi Full-Stack
// Fitur: Grafik (Recharts) + AI (Gemini 3.1 Flash-Lite) + Hybrid ARIMA-LSTM
// ============================================================

import { useState, useEffect, useMemo, useRef, createContext, useContext } from "react";
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";

// ── Kredensial (dari .env) ───────────────────────────────────
const SUPABASE_URL      = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const GEMINI_API_KEY    = import.meta.env.VITE_GEMINI_API_KEY;
const BACKEND_URL       = import.meta.env.VITE_BACKEND_URL || "http://localhost:8000";

// ── Supabase helper ──────────────────────────────────────────
// ── Helper: Ambil user_id dari JWT token (payload tengah base64) ──
// Supabase TIDAK otomatis mengisi user_id saat insert lewat REST API;
// harus dikirim manual, kalau tidak RLS akan menolak (return kosong tanpa error).
function getUserIdFromToken(token) {
  try {
    const payload = token.split(".")[1];
    const decoded = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return decoded.sub; // "sub" adalah user_id di Supabase JWT
  } catch {
    return null;
  }
}

const sb = {
  h: (token) => ({
    "Content-Type": "application/json",
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${token || SUPABASE_ANON_KEY}`,
    Prefer: "return=representation",
  }),
  async signUp(e, p) {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/signup`, { method: "POST", headers: this.h(), body: JSON.stringify({ email: e, password: p }) });
    return r.json();
  },
  async signIn(e, p) {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: "POST", headers: this.h(), body: JSON.stringify({ email: e, password: p }) });
    return r.json();
  },
  async signOut(t) { await fetch(`${SUPABASE_URL}/auth/v1/logout`, { method: "POST", headers: this.h(t) }); },
  async fetchTransaksi(t) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/transaksi?order=tanggal.desc`, { headers: this.h(t) });
    return r.ok ? r.json() : [];
  },
  async insert(t, d) {
    const payload = { ...d, user_id: getUserIdFromToken(t) };
    const r = await fetch(`${SUPABASE_URL}/rest/v1/transaksi`, { method: "POST", headers: this.h(t), body: JSON.stringify(payload) });
    if (!r.ok) { console.error("Insert transaksi gagal:", await r.text()); return null; }
    return r.json();
  },
  async update(t, id, d) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/transaksi?id=eq.${id}`, { method: "PATCH", headers: this.h(t), body: JSON.stringify(d) });
    return r.ok ? r.json() : null;
  },
  async remove(t, id) { await fetch(`${SUPABASE_URL}/rest/v1/transaksi?id=eq.${id}`, { method: "DELETE", headers: this.h(t) }); },

  // ── Budget ──
  async fetchBudget(t, bulan, tahun) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/budget?bulan=eq.${bulan}&tahun=eq.${tahun}`, { headers: this.h(t) });
    return r.ok ? r.json() : [];
  },
  async upsertBudget(t, d) {
    const payload = { ...d, user_id: getUserIdFromToken(t) };
    const r = await fetch(`${SUPABASE_URL}/rest/v1/budget?on_conflict=user_id,kategori,bulan,tahun`, {
      method: "POST",
      headers: { ...this.h(t), Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(payload),
    });
    if (!r.ok) { console.error("Upsert budget gagal:", await r.text()); return null; }
    return r.json();
  },
  async removeBudget(t, id) { await fetch(`${SUPABASE_URL}/rest/v1/budget?id=eq.${id}`, { method: "DELETE", headers: this.h(t) }); },

  // ── Dompet ──
  async fetchDompet(t) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/dompet?aktif=eq.true&order=urutan.asc`, { headers: this.h(t) });
    return r.ok ? r.json() : [];
  },
  async insertDompet(t, d) {
    const payload = { ...d, user_id: getUserIdFromToken(t) };
    const r = await fetch(`${SUPABASE_URL}/rest/v1/dompet`, {
      method: "POST", headers: this.h(t), body: JSON.stringify(payload),
    });
    if (!r.ok) { console.error("Insert dompet gagal:", await r.text()); return null; }
    return r.json();
  },
  async updateDompet(t, id, d) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/dompet?id=eq.${id}`, {
      method: "PATCH", headers: this.h(t), body: JSON.stringify(d),
    });
    return r.ok ? r.json() : null;
  },
  async removeDompet(t, id) {
    // Soft delete — set aktif = false
    await fetch(`${SUPABASE_URL}/rest/v1/dompet?id=eq.${id}`, {
      method: "PATCH", headers: this.h(t), body: JSON.stringify({ aktif: false }),
    });
  },
  async fetchTransaksiByDompet(t, dompetId) {
    const url = dompetId
      ? `${SUPABASE_URL}/rest/v1/transaksi?dompet_id=eq.${dompetId}&order=tanggal.desc`
      : `${SUPABASE_URL}/rest/v1/transaksi?order=tanggal.desc`;
    const r = await fetch(url, { headers: this.h(t) });
    return r.ok ? r.json() : [];
  },
};

// ── Konstanta ────────────────────────────────────────────────
const CATS = {
  pemasukan:   ["Gaji", "Freelance", "Bisnis", "Investasi", "Lainnya"],
  pengeluaran: ["Makan & Minum", "Transport", "Belanja", "Tagihan", "Kesehatan", "Hiburan", "Pendidikan", "Lainnya"],
};
const ICONS = { "Gaji":"💼","Freelance":"💻","Bisnis":"🏪","Investasi":"📈","Makan & Minum":"🍜","Transport":"🚗","Belanja":"🛍️","Tagihan":"📄","Kesehatan":"🏥","Hiburan":"🎮","Pendidikan":"📚","Lainnya":"📦" };
const BULAN_ID = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"];

// ── Helper: Konversi File → base64 ─────────────────────────────
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]); // buang prefix "data:image/...;base64,"
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ── Helper: Kirim gambar struk ke Gemini Vision, minta ekstrak data ──
async function scanStrukDenganGemini(file) {
  const base64 = await fileToBase64(file);
  const mimeType = file.type || "image/jpeg";

  const prompt = `Kamu adalah OCR khusus struk belanja Indonesia. Analisis gambar struk ini dan ekstrak informasinya.

Balas HANYA dengan JSON murni (tanpa markdown, tanpa backtick, tanpa penjelasan tambahan), format persis seperti ini:
{
  "merchant": "nama toko/merchant jika terlihat",
  "total": angka_total_belanja_tanpa_titik_atau_koma,
  "tanggal": "YYYY-MM-DD jika terlihat di struk, kalau tidak ada pakai null",
  "kategori": "salah satu dari: Makan & Minum, Transport, Belanja, Tagihan, Kesehatan, Hiburan, Pendidikan, Lainnya",
  "catatan": "ringkasan singkat isi belanja, misal '3 item: kopi, roti, air mineral'"
}

Jika gambar bukan struk atau tidak terbaca, balas: {"error": "Gambar tidak dapat dibaca sebagai struk"}`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [
            { text: prompt },
            { inline_data: { mime_type: mimeType, data: base64 } },
          ],
        }],
        generationConfig: { maxOutputTokens: 500 },
      }),
    }
  );

  const data = await res.json();
  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  // Bersihkan kemungkinan markdown code fence yang terselip
  const cleaned = rawText.replace(/```json|```/g, "").trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error("AI tidak mengembalikan format yang valid. Coba foto ulang dengan pencahayaan lebih jelas.");
  }
}

// ── Helper: Parse ucapan (teks) → data transaksi via Gemini ────
async function parseUcapanDenganGemini(teks) {
  const prompt = `Kamu adalah parser transaksi keuangan Bahasa Indonesia dari ucapan lisan (voice input).
Ucapan user: "${teks}"

Ekstrak jadi transaksi. Balas HANYA dengan JSON murni (tanpa markdown/backtick), format persis:
{
  "tipe": "pemasukan" atau "pengeluaran",
  "kategori": "salah satu dari: Gaji, Freelance, Bisnis, Investasi, Makan & Minum, Transport, Belanja, Tagihan, Kesehatan, Hiburan, Pendidikan, Lainnya",
  "jumlah": angka_saja_tanpa_titik_atau_koma_atau_teks,
  "catatan": "ringkasan singkat dari ucapan"
}

Aturan konversi angka:
- "dua puluh lima ribu" atau "25rb" atau "25ribu" → 25000
- "seratus ribu" atau "100rb" → 100000
- "satu juta dua ratus" → 1200000
- Kata seperti "beli", "bayar", "belanja", "jajan" → tipe pengeluaran
- Kata seperti "dapat", "terima", "gajian", "masuk" → tipe pemasukan

Jika ucapan tidak mengandung informasi transaksi yang jelas (tidak ada angka/jumlah), balas:
{"error": "Tidak dapat mengenali jumlah atau jenis transaksi dari ucapan"}`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 300 },
      }),
    }
  );

  const data = await res.json();
  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  const cleaned = rawText.replace(/```json|```/g, "").trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error("AI tidak dapat memahami ucapan. Coba ucapkan lebih jelas, misal: 'beli kopi dua puluh lima ribu'.");
  }
}

const formatRp  = (n) => "Rp " + Math.abs(Number(n)).toLocaleString("id-ID");
const today     = () => new Date().toISOString().split("T")[0];

// ── Helper: Export data ke file CSV (bisa dibuka Excel/Sheets) ──
function exportKeCSV(transaksi, dompetList, namaFile) {
  const header = ["Tanggal", "Tipe", "Kategori", "Jumlah", "Catatan", "Dompet"];

  const rows = transaksi.map(t => {
    const namaDompet = dompetList.find(d => d.id === t.dompet_id)?.nama || "";
    // Escape koma & kutip supaya CSV tidak rusak
    const esc = (val) => {
      const s = String(val ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return [
      t.tanggal,
      t.tipe === "pemasukan" ? "Pemasukan" : "Pengeluaran",
      esc(t.kategori),
      t.jumlah,
      esc(t.catatan || ""),
      esc(namaDompet),
    ].join(",");
  });

  // \uFEFF (BOM) supaya Excel baca karakter Indonesia (é, spasi, dst) dengan benar
  const csvContent = "\uFEFF" + [header.join(","), ...rows].join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = namaFile;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// ── Helper: Export ke Excel asli (.xls, dibaca native oleh Excel) ──
function exportKeExcel(transaksi, dompetList, namaFile) {
  const header = ["Tanggal", "Tipe", "Kategori", "Jumlah", "Catatan", "Dompet"];

  const rows = transaksi.map(t => {
    const namaDompet = dompetList.find(d => d.id === t.dompet_id)?.nama || "";
    return [
      t.tanggal,
      t.tipe === "pemasukan" ? "Pemasukan" : "Pengeluaran",
      t.kategori,
      t.jumlah,
      t.catatan || "",
      namaDompet,
    ];
  });

  // Format HTML table — trik ini membuat Excel membaca file sebagai spreadsheet asli
  const escHtml = (s) => String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  const tableRows = rows.map(r =>
    `<tr>${r.map((cell,i) => `<td${i===3 ? ' style="mso-number-format:\\@"' : ''}>${escHtml(cell)}</td>`).join("")}</tr>`
  ).join("");

  const html = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
    <head><meta charset="utf-8"></head>
    <body>
      <table border="1">
        <thead><tr>${header.map(h => `<th>${escHtml(h)}</th>`).join("")}</tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
    </body>
    </html>`;

  const blob = new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = namaFile;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// ── Theme Context ─────────────────────────────────────────────
const ThemeCtx = createContext({ dark: false });
const useTheme = () => useContext(ThemeCtx);

// ── Design Tokens: "Buku Kas" — identitas ledger/buku besar ─────
// Aksen: hijau tinta (pemasukan), merah tinta (pengeluaran), emas (highlight/aktif)
// Bukan gradient biru generik — terinspirasi kertas ledger & mesin kasir
const ACCENT_GOLD   = "#B8860B";
const ACCENT_GOLD_L = "#D4A017";
const INK_GREEN     = "#1B5E42";
const INK_GREEN_L   = "#2D8A63";
const INK_RED       = "#8C2F2F";
const INK_RED_L     = "#B84545";

const tokens = (dark) => ({
  // Latar & permukaan
  bg:          dark ? "#14141c" : "#F7F5EF",
  bgPaper:     dark ? "#1a1a24" : "#FDFCF8",
  surface:     dark ? "#1e1e2a" : "#FFFFFF",
  surface2:    dark ? "#26262f" : "#F1EEE4",
  border:      dark ? "#33333f" : "#E4DFD0",
  borderSoft:  dark ? "#2a2a35" : "#EBE7DA",

  // Sidebar — selalu gelap (tinta), tidak berubah walau dark/light mode konten
  sidebarBg:   "#181820",
  sidebarBg2:  "#1f1f29",
  sidebarText: "#B8B5C4",
  sidebarTextActive: "#FDFCF8",

  // Teks
  text:        dark ? "#EEEAE0" : "#20201C",
  textSub:     dark ? "#A19E93" : "#5C584E",
  textMuted:   dark ? "#6E6B62" : "#8C8879",

  // Aksen semantik
  gold:        dark ? ACCENT_GOLD_L : ACCENT_GOLD,
  green:       dark ? INK_GREEN_L : INK_GREEN,
  red:         dark ? INK_RED_L : INK_RED,

  cardShadow:  dark ? "0 2px 12px rgba(0,0,0,0.35)" : "0 1px 3px rgba(32,32,28,0.06), 0 8px 24px rgba(32,32,28,0.04)",
  skeleton:    dark ? "linear-gradient(90deg,#1e1e2a 25%,#26262f 50%,#1e1e2a 75%)"
                    : "linear-gradient(90deg,#F1EEE4 25%,#FDFCF8 50%,#F1EEE4 75%)",
  inputBg:     dark ? "#1e1e2a" : "#FFFFFF",
  inputBorder: dark ? "#33333f" : "#DDD7C4",

  // Font
  fontDisplay: "'Fraunces', 'Georgia', serif",
  fontMono:    "'JetBrains Mono', 'SF Mono', Consolas, monospace",
  fontBody:    "'Inter', system-ui, sans-serif",
});

// Helper buat style input yang theme-aware
const mkInp = (t) => ({
  width:"100%", padding:"11px 14px", borderRadius:8,
  border:`1.5px solid ${t.inputBorder}`, fontSize:14, outline:"none",
  background:t.inputBg, color:t.text, boxSizing:"border-box",
  fontFamily:t.fontBody, transition:"border-color 0.15s, box-shadow 0.15s",
});

// ── Google Fonts loader ──────────────────────────────────────
function FontLoader() {
  return (
    <link
      rel="stylesheet"
      href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap"
    />
  );
}

// ── Global Animation Styles ──────────────────────────────────
function GlobalStyles({ dark }) {
  return (
    <style>{`
      @media (max-width: 640px) {
        .desktop-sidebar { display: none !important; }
        .mobile-bottomnav { display: flex !important; }
        .main-content-area { padding-bottom: 84px !important; margin-left: 0 !important; }
      }
      @media (min-width: 641px) {
        .mobile-bottomnav { display: none !important; }
      }
      * { -webkit-tap-highlight-color: transparent; }
      body { transition: background 0.3s, color 0.3s; }

      @keyframes fadeSlideIn {
        from { opacity: 0; transform: translateY(8px); }
        to   { opacity: 1; transform: translateY(0); }
      }
      @keyframes fadeIn {
        from { opacity: 0; }
        to   { opacity: 1; }
      }
      @keyframes shimmer {
        0%   { background-position: -200px 0; }
        100% { background-position: 200px 0; }
      }
      @keyframes popIn {
        0%   { transform: scale(0.9); opacity: 0; }
        60%  { transform: scale(1.03); }
        100% { transform: scale(1); opacity: 1; }
      }
      @keyframes bounce {
        0%, 80%, 100% { transform: translateY(0); }
        40% { transform: translateY(-6px); }
      }
      @keyframes slideOutLeft {
        from { transform: translateX(0); opacity: 1; max-height: 200px; margin-bottom: 10px; }
        to   { transform: translateX(-100%); opacity: 0; max-height: 0; margin-bottom: 0; }
      }
      @keyframes toggleSlide {
        from { transform: translateX(0); }
        to   { transform: translateX(20px); }
      }
      @keyframes pulseRing {
        0%   { box-shadow: 0 0 0 0 rgba(59,130,246,0.4); }
        70%  { box-shadow: 0 0 0 8px rgba(59,130,246,0); }
        100% { box-shadow: 0 0 0 0 rgba(59,130,246,0); }
      }

      .tab-content { animation: fadeSlideIn 0.3s ease-out; }
      .card-enter  { animation: popIn 0.35s cubic-bezier(0.34,1.56,0.64,1); }
      .list-item   { animation: fadeSlideIn 0.3s ease-out; transition: transform 0.15s, box-shadow 0.15s; }
      .list-item:active { transform: scale(0.98); }
      .list-item.removing { animation: slideOutLeft 0.3s ease-in forwards; }

      .btn-press { transition: transform 0.1s, opacity 0.1s, box-shadow 0.15s; }
      .btn-press:active { transform: scale(0.96); opacity: 0.85; }

      .skeleton {
        background: ${dark
          ? "linear-gradient(90deg,#1e1e2a 25%,#26262f 50%,#1e1e2a 75%)"
          : "linear-gradient(90deg,#F1EEE4 25%,#FDFCF8 50%,#F1EEE4 75%)"};
        background-size: 400px 100%;
        animation: shimmer 1.4s infinite linear;
        border-radius: 8px;
      }

      .theme-transition * {
        transition: background 0.25s, color 0.25s, border-color 0.25s, box-shadow 0.25s !important;
      }

      input, select, textarea, button {
        transition: border-color 0.15s, box-shadow 0.15s, background 0.2s, color 0.2s;
        font-family: 'Inter', system-ui, sans-serif;
      }
      input:focus, select:focus {
        border-color: ${dark ? ACCENT_GOLD_L : ACCENT_GOLD} !important;
        box-shadow: 0 0 0 3px ${dark ? "rgba(212,160,23,0.18)" : "rgba(184,134,11,0.12)"};
      }

      .sidebar-item {
        transition: background 0.15s, color 0.15s, border-color 0.15s;
        position: relative;
      }
      .sidebar-item.active::before {
        content: '';
        position: absolute; left: 0; top: 8px; bottom: 8px; width: 3px;
        background: ${ACCENT_GOLD_L}; border-radius: 0 3px 3px 0;
      }

      .num-tabular { font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }

      /* Scrollbar */
      ::-webkit-scrollbar { width: 6px; height: 6px; }
      ::-webkit-scrollbar-track { background: transparent; }
      ::-webkit-scrollbar-thumb { background: ${dark ? "#33333f" : "#DDD7C4"}; border-radius: 99px; }
    `}</style>
  );
}

// ── Angka dengan animasi count-up ────────────────────────────
function AnimatedNumber({ value, format = formatRp }) {
  const [display, setDisplay] = useState(value);

  useEffect(() => {
    const start = display;
    const end = value;
    const duration = 500;
    const startTime = performance.now();

    const tick = (now) => {
      const progress = Math.min((now - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      const current = start + (end - start) * eased;
      setDisplay(current);
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    // eslint-disable-next-line
  }, [value]);

  return <span>{format(display)}</span>;
}

// ── Modal: Scan Struk (OCR via Gemini Vision) ──────────────────
function ScanStrukModal({ onClose, onHasil }) {
  const { dark } = useTheme();
  const t = tokens(dark);
  const [preview, setPreview] = useState(null);
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState("idle"); // idle | scanning | error
  const [errMsg, setErrMsg] = useState("");
  const fileInputRef = useRef(null);

  const handleFile = (f) => {
    if (!f) return;
    if (!f.type.startsWith("image/")) { setErrMsg("File harus berupa gambar (JPG/PNG)"); setStatus("error"); return; }
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setStatus("idle");
    setErrMsg("");
  };

  const prosesScan = async () => {
    if (!file) return;
    setStatus("scanning"); setErrMsg("");
    try {
      const hasil = await scanStrukDenganGemini(file);
      if (hasil.error) { setErrMsg(hasil.error); setStatus("error"); return; }
      onHasil(hasil);
    } catch (e) {
      setErrMsg(e.message || "Gagal memindai struk. Coba lagi.");
      setStatus("error");
    }
  };

  return (
    <div style={{
      position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", zIndex:1000,
      display:"flex", alignItems:"flex-end", justifyContent:"center",
      animation:"fadeIn 0.2s ease-out",
    }} onClick={onClose}>
      <div className="card-enter" onClick={e=>e.stopPropagation()} style={{
        background:t.surface, borderRadius:"20px 20px 0 0", padding:20,
        width:"100%", maxWidth:480, maxHeight:"85vh", overflowY:"auto",
      }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
          <div style={{ fontWeight:700, fontSize:16, color:t.text }}>📸 Scan Struk</div>
          <button className="btn-press" onClick={onClose} style={{ background:t.surface2, border:"none", borderRadius:8, width:28, height:28, cursor:"pointer", color:t.textSub, fontSize:16 }}>✕</button>
        </div>

        {!preview ? (
          <div style={{
            border:`2px dashed ${t.border}`, borderRadius:12, padding:"40px 20px",
            textAlign:"center", cursor:"pointer",
          }} onClick={()=>fileInputRef.current?.click()}>
            <div style={{ fontSize:40, marginBottom:10 }}>📷</div>
            <div style={{ fontWeight:600, fontSize:14, color:t.text, marginBottom:4 }}>Tap untuk foto atau upload struk</div>
            <div style={{ fontSize:12, color:t.textMuted }}>JPG atau PNG, pastikan tulisan terbaca jelas</div>
            <input
              ref={fileInputRef} type="file" accept="image/*" capture="environment"
              onChange={e=>handleFile(e.target.files?.[0])}
              style={{ display:"none" }}
            />
          </div>
        ) : (
          <>
            <div style={{ borderRadius:12, overflow:"hidden", marginBottom:14, background:t.surface2 }}>
              <img src={preview} alt="Preview struk" style={{ width:"100%", maxHeight:320, objectFit:"contain", display:"block" }} />
            </div>

            {status === "error" && (
              <div style={{ background: dark?"rgba(184,69,69,0.12)":"rgba(140,47,47,0.06)", color:t.red, padding:"10px 14px", borderRadius:10, fontSize:13, marginBottom:12 }}>
                ⚠️ {errMsg}
              </div>
            )}

            {status === "scanning" ? (
              <div style={{ textAlign:"center", padding:"16px 0" }}>
                <div style={{ display:"inline-flex", gap:4 }}>
                  {[0,1,2].map(i => <div key={i} style={{ width:8, height:8, borderRadius:"50%", background:t.gold, animation:`bounce 1.2s ${i*0.2}s infinite` }} />)}
                </div>
                <div style={{ fontSize:13, color:t.textMuted, marginTop:10 }}>AI sedang membaca struk...</div>
              </div>
            ) : (
              <div style={{ display:"flex", gap:8 }}>
                <button className="btn-press" onClick={()=>{ setPreview(null); setFile(null); setStatus("idle"); }} style={{
                  flex:1, padding:12, borderRadius:10, border:`1.5px solid ${t.border}`,
                  background:t.surface2, color:t.textSub, fontWeight:600, cursor:"pointer", fontSize:14,
                }}>🔄 Foto Ulang</button>
                <button className="btn-press" onClick={prosesScan} style={{
                  flex:2, padding:12, borderRadius:10, border:"none",
                  background:"linear-gradient(135deg, #D4A017, #B8860B)", color:"#181820",
                  fontWeight:700, cursor:"pointer", fontSize:14,
                }}>✨ Baca Struk dengan AI</button>
              </div>
            )}
          </>
        )}

        <div style={{ fontSize:11, color:t.textMuted, textAlign:"center", marginTop:14 }}>
          Powered by Gemini Vision · Hasil bisa diedit sebelum disimpan
        </div>
      </div>
    </div>
  );
}

// ── Modal: Voice Input (Web Speech API + Gemini parsing) ───────
function VoiceInputModal({ onClose, onHasil }) {
  const { dark } = useTheme();
  const t = tokens(dark);
  const [status, setStatus] = useState("idle"); // idle | listening | processing | error | notSupported
  const [transcript, setTranscript] = useState("");
  const [errMsg, setErrMsg] = useState("");
  const recognitionRef = useRef(null);

  // Cek dukungan browser saat modal dibuka
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setStatus("notSupported");
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = "id-ID";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      let text = "";
      for (let i = 0; i < event.results.length; i++) text += event.results[i][0].transcript;
      setTranscript(text);
    };
    recognition.onerror = (event) => {
      setStatus("error");
      setErrMsg(
        event.error === "not-allowed" ? "Izin mikrofon ditolak. Aktifkan di pengaturan browser."
        : event.error === "no-speech" ? "Tidak ada suara terdeteksi. Coba lagi."
        : "Terjadi kesalahan saat merekam suara."
      );
    };
    recognition.onend = () => {
      setStatus(prev => prev === "listening" ? "idle" : prev);
    };

    recognitionRef.current = recognition;
    return () => { try { recognition.stop(); } catch {} };
  }, []);

  const mulaiRekam = () => {
    setTranscript(""); setErrMsg(""); setStatus("listening");
    try { recognitionRef.current?.start(); } catch {}
  };

  const berhentiRekam = () => {
    try { recognitionRef.current?.stop(); } catch {}
    setStatus("idle");
  };

  const prosesUcapan = async () => {
    if (!transcript.trim()) return;
    setStatus("processing"); setErrMsg("");
    try {
      const hasil = await parseUcapanDenganGemini(transcript);
      if (hasil.error) { setErrMsg(hasil.error); setStatus("error"); return; }
      onHasil(hasil);
    } catch (e) {
      setErrMsg(e.message || "Gagal memproses ucapan.");
      setStatus("error");
    }
  };

  return (
    <div style={{
      position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", zIndex:1000,
      display:"flex", alignItems:"flex-end", justifyContent:"center",
      animation:"fadeIn 0.2s ease-out",
    }} onClick={onClose}>
      <div className="card-enter" onClick={e=>e.stopPropagation()} style={{
        background:t.surface, borderRadius:"20px 20px 0 0", padding:24,
        width:"100%", maxWidth:480, textAlign:"center",
      }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
          <div style={{ fontWeight:700, fontSize:16, color:t.text }}>🎙️ Catat dengan Suara</div>
          <button className="btn-press" onClick={onClose} style={{ background:t.surface2, border:"none", borderRadius:8, width:28, height:28, cursor:"pointer", color:t.textSub, fontSize:16 }}>✕</button>
        </div>

        {status === "notSupported" ? (
          <div style={{ padding:"20px 0" }}>
            <div style={{ fontSize:36, marginBottom:10 }}>😕</div>
            <div style={{ fontSize:13, color:t.textMuted, lineHeight:1.6 }}>
              Browser kamu belum mendukung voice input.<br/>
              Coba pakai Chrome atau Safari terbaru.
            </div>
          </div>
        ) : (
          <>
            {/* Tombol mic besar */}
            <button
              className="btn-press"
              onClick={status === "listening" ? berhentiRekam : mulaiRekam}
              disabled={status === "processing"}
              style={{
                width:100, height:100, borderRadius:"50%", border:"none",
                background: status === "listening"
                  ? "linear-gradient(135deg,#ef4444,#dc2626)"
                  : "linear-gradient(135deg, #D4A017, #B8860B)",
                color:"#fff", fontSize:36, cursor:"pointer",
                margin:"10px auto 20px", display:"flex", alignItems:"center", justifyContent:"center",
                boxShadow: status === "listening" ? "0 0 0 8px rgba(239,68,68,0.15)" : "none",
                animation: status === "listening" ? "pulseRing 1.5s infinite" : "none",
                transition:"box-shadow 0.3s",
              }}
            >
              {status === "listening" ? "⏹️" : "🎤"}
            </button>

            <div style={{ fontSize:13, color:t.textMuted, marginBottom:16, minHeight:20 }}>
              {status === "idle" && !transcript && "Tap mic, lalu ucapkan transaksi kamu"}
              {status === "listening" && "Mendengarkan... tap lagi untuk berhenti"}
              {status === "processing" && "AI sedang memproses..."}
            </div>

            {/* Contoh ucapan */}
            {status === "idle" && !transcript && (
              <div style={{ background:t.surface2, borderRadius:12, padding:14, marginBottom:16, textAlign:"left" }}>
                <div style={{ fontSize:11, color:t.textMuted, marginBottom:6, fontWeight:600 }}>💡 Contoh ucapan:</div>
                <div style={{ fontSize:12, color:t.text, lineHeight:1.8 }}>
                  "Beli kopi dua puluh lima ribu"<br/>
                  "Bayar listrik seratus lima puluh ribu"<br/>
                  "Gajian bulan ini lima juta"
                </div>
              </div>
            )}

            {/* Transcript hasil */}
            {transcript && (
              <div style={{ background: dark?"rgba(212,160,23,0.1)":"rgba(184,134,11,0.06)", border:`1.5px solid ${t.gold}`, borderRadius:10, padding:14, marginBottom:16, textAlign:"left" }}>
                <div style={{ fontSize:11, color:t.gold, marginBottom:4, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.03em" }}>Yang terdengar</div>
                <div style={{ fontSize:14, color:t.text, fontWeight:500 }}>{transcript}</div>
              </div>
            )}

            {errMsg && (
              <div style={{ background: dark?"rgba(184,69,69,0.12)":"rgba(140,47,47,0.06)", color:t.red, padding:"10px 14px", borderRadius:9, fontSize:13, marginBottom:16, textAlign:"left" }}>
                {errMsg}
              </div>
            )}

            {status === "processing" ? (
              <div style={{ display:"inline-flex", gap:4 }}>
                {[0,1,2].map(i => <div key={i} style={{ width:8, height:8, borderRadius:"50%", background:t.gold, animation:`bounce 1.2s ${i*0.2}s infinite` }} />)}
              </div>
            ) : transcript && status !== "listening" && (
              <div style={{ display:"flex", gap:8 }}>
                <button className="btn-press" onClick={()=>{ setTranscript(""); setErrMsg(""); }} style={{
                  flex:1, padding:12, borderRadius:10, border:`1.5px solid ${t.border}`,
                  background:t.surface2, color:t.textSub, fontWeight:600, cursor:"pointer", fontSize:14,
                }}>🔄 Ulangi</button>
                <button className="btn-press" onClick={prosesUcapan} style={{
                  flex:2, padding:12, borderRadius:10, border:"none",
                  background:"linear-gradient(135deg, #D4A017, #B8860B)", color:"#181820",
                  fontWeight:700, cursor:"pointer", fontSize:14,
                }}>✨ Proses dengan AI</button>
              </div>
            )}
          </>
        )}

        <div style={{ fontSize:11, color:t.textMuted, marginTop:16 }}>
          Voice recognition browser · Parsing oleh Gemini
        </div>
      </div>
    </div>
  );
}

// ── Modal: Export Data (CSV / Excel) ────────────────────────────
function ExportModal({ transaksi, dompet, onClose, showToast }) {
  const { dark } = useTheme();
  const t = tokens(dark);
  const inp = mkInp(t);

  const now = new Date();
  const [rentang, setRentang] = useState("semua"); // semua | bulan_ini | custom
  const [dariTgl, setDariTgl] = useState(new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0]);
  const [sampaiTgl, setSampaiTgl] = useState(today());
  const [tipeFilter, setTipeFilter] = useState("semua"); // semua | pemasukan | pengeluaran

  const dataTerfilter = useMemo(() => {
    let data = [...transaksi];
    if (rentang === "bulan_ini") {
      data = data.filter(tx => {
        const d = new Date(tx.tanggal);
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      });
    } else if (rentang === "custom") {
      data = data.filter(tx => tx.tanggal >= dariTgl && tx.tanggal <= sampaiTgl);
    }
    if (tipeFilter !== "semua") data = data.filter(tx => tx.tipe === tipeFilter);
    return data.sort((a,b) => new Date(a.tanggal) - new Date(b.tanggal));
  }, [transaksi, rentang, dariTgl, sampaiTgl, tipeFilter]);

  const ringkasan = useMemo(() => {
    const masuk = dataTerfilter.filter(t=>t.tipe==="pemasukan").reduce((s,t)=>s+t.jumlah,0);
    const keluar = dataTerfilter.filter(t=>t.tipe==="pengeluaran").reduce((s,t)=>s+t.jumlah,0);
    return { masuk, keluar, jumlah: dataTerfilter.length };
  }, [dataTerfilter]);

  const namaFileDasar = () => {
    const tgl = new Date().toISOString().split("T")[0];
    return `keuangan-pribadi_${tgl}`;
  };

  const handleExport = (format) => {
    if (dataTerfilter.length === 0) { showToast("Tidak ada data untuk diexport", "error"); return; }
    if (format === "csv") {
      exportKeCSV(dataTerfilter, dompet, `${namaFileDasar()}.csv`);
    } else {
      exportKeExcel(dataTerfilter, dompet, `${namaFileDasar()}.xls`);
    }
    showToast(`✓ ${dataTerfilter.length} transaksi berhasil diexport`);
    onClose();
  };

  return (
    <div style={{
      position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", zIndex:1000,
      display:"flex", alignItems:"flex-end", justifyContent:"center",
      animation:"fadeIn 0.2s ease-out",
    }} onClick={onClose}>
      <div className="card-enter" onClick={e=>e.stopPropagation()} style={{
        background:t.surface, borderRadius:"20px 20px 0 0", padding:20,
        width:"100%", maxWidth:480, maxHeight:"85vh", overflowY:"auto",
      }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:18 }}>
          <div style={{ fontWeight:700, fontSize:16, color:t.text }}>📤 Export Data</div>
          <button className="btn-press" onClick={onClose} style={{ background:t.surface2, border:"none", borderRadius:8, width:28, height:28, cursor:"pointer", color:t.textSub, fontSize:16 }}>✕</button>
        </div>

        {/* Rentang tanggal */}
        <div style={{ fontSize:12, fontWeight:600, color:t.textSub, marginBottom:8 }}>📅 Rentang Waktu</div>
        <div style={{ display:"flex", gap:6, marginBottom:12 }}>
          {[
            { id:"semua", label:"Semua" },
            { id:"bulan_ini", label:"Bulan Ini" },
            { id:"custom", label:"Kustom" },
          ].map(opt => (
            <button key={opt.id} className="btn-press" onClick={()=>setRentang(opt.id)} style={{
              flex:1, padding:"8px", borderRadius:10, border:`1.5px solid`,
              borderColor: rentang===opt.id ? t.gold : t.border,
              background: rentang===opt.id ? (dark?"#1e3a5f":"#eff6ff") : t.surface2,
              color: rentang===opt.id ? t.gold : t.textSub,
              fontWeight:600, fontSize:12, cursor:"pointer",
            }}>{opt.label}</button>
          ))}
        </div>

        {rentang === "custom" && (
          <div style={{ display:"flex", gap:8, marginBottom:14, alignItems:"center" }}>
            <input type="date" value={dariTgl} onChange={e=>setDariTgl(e.target.value)} style={{ ...inp, flex:1, colorScheme: dark?"dark":"light" }} />
            <span style={{ color:t.textMuted, fontSize:12 }}>—</span>
            <input type="date" value={sampaiTgl} onChange={e=>setSampaiTgl(e.target.value)} style={{ ...inp, flex:1, colorScheme: dark?"dark":"light" }} />
          </div>
        )}

        {/* Filter tipe */}
        <div style={{ fontSize:12, fontWeight:600, color:t.textSub, marginBottom:8, marginTop:4 }}>🏷️ Jenis Transaksi</div>
        <div style={{ display:"flex", gap:6, marginBottom:16 }}>
          {[
            { id:"semua", label:"Semua" },
            { id:"pemasukan", label:"⬆ Pemasukan" },
            { id:"pengeluaran", label:"⬇ Pengeluaran" },
          ].map(opt => (
            <button key={opt.id} className="btn-press" onClick={()=>setTipeFilter(opt.id)} style={{
              flex:1, padding:"8px", borderRadius:10, border:`1.5px solid`,
              borderColor: tipeFilter===opt.id ? t.gold : t.border,
              background: tipeFilter===opt.id ? (dark?"#2e1065":"#f5f3ff") : t.surface2,
              color: tipeFilter===opt.id ? t.gold : t.textSub,
              fontWeight:600, fontSize:11, cursor:"pointer",
            }}>{opt.label}</button>
          ))}
        </div>

        {/* Ringkasan preview */}
        <div style={{ background:t.surface2, borderRadius:12, padding:14, marginBottom:18 }}>
          <div style={{ fontSize:12, color:t.textMuted, marginBottom:8 }}>Preview data yang akan diexport:</div>
          <div style={{ display:"flex", justifyContent:"space-between", fontSize:13 }}>
            <span style={{ color:t.text, fontWeight:600 }}>{ringkasan.jumlah} transaksi</span>
          </div>
          <div style={{ display:"flex", gap:16, marginTop:8 }}>
            <div><span style={{ fontSize:11, color:t.textMuted }}>Masuk: </span><span style={{ fontSize:12, fontWeight:700, color:t.green }}>{formatRp(ringkasan.masuk)}</span></div>
            <div><span style={{ fontSize:11, color:t.textMuted }}>Keluar: </span><span style={{ fontSize:12, fontWeight:700, color:t.red }}>{formatRp(ringkasan.keluar)}</span></div>
          </div>
        </div>

        {ringkasan.jumlah === 0 && (
          <div style={{ background: dark?"rgba(184,69,69,0.12)":"rgba(140,47,47,0.06)", color:t.red, padding:"10px 14px", borderRadius:10, fontSize:12, marginBottom:16, textAlign:"center" }}>
            ⚠️ Tidak ada transaksi pada rentang ini
          </div>
        )}

        {/* Tombol export */}
        <div style={{ display:"flex", gap:8 }}>
          <button className="btn-press" onClick={()=>handleExport("csv")} disabled={ringkasan.jumlah===0} style={{
            flex:1, padding:"14px 10px", borderRadius:12, border:`1.5px solid ${t.border}`,
            background:t.surface2, color:t.text, fontWeight:700, fontSize:13,
            cursor: ringkasan.jumlah===0 ? "not-allowed" : "pointer", opacity: ringkasan.jumlah===0 ? 0.5 : 1,
            display:"flex", flexDirection:"column", alignItems:"center", gap:4,
          }}>
            <span style={{ fontSize:22 }}>📄</span> CSV
          </button>
          <button className="btn-press" onClick={()=>handleExport("excel")} disabled={ringkasan.jumlah===0} style={{
            flex:1, padding:"14px 10px", borderRadius:12, border:"none",
            background: ringkasan.jumlah===0 ? "#C4BFA8" : "linear-gradient(135deg,#16a34a,#22c55e)",
            color:"#fff", fontWeight:700, fontSize:13,
            cursor: ringkasan.jumlah===0 ? "not-allowed" : "pointer",
            display:"flex", flexDirection:"column", alignItems:"center", gap:4,
          }}>
            <span style={{ fontSize:22 }}>📊</span> Excel
          </button>
        </div>

        <div style={{ fontSize:11, color:t.textMuted, textAlign:"center", marginTop:14 }}>
          File tersimpan langsung ke perangkat kamu
        </div>
      </div>
    </div>
  );
}

// ── Toggle Dark Mode ─────────────────────────────────────────
function DarkToggle({ dark, onToggle }) {
  return (
    <button onClick={onToggle} className="btn-press" title={dark ? "Mode Terang" : "Mode Gelap"} style={{
      background: "rgba(255,255,255,0.08)",
      border: "1px solid rgba(255,255,255,0.1)", borderRadius: 7, width:30, height:30,
      cursor: "pointer", display: "flex", alignItems: "center", justifyContent:"center",
      color: "#fff", fontSize: 13, flexShrink:0,
    }}>
      <span style={{ fontSize: 14 }}>{dark ? "☀" : "☾"}</span>
    </button>
  );
}

// ── Skeleton placeholders ────────────────────────────────────
function SkeletonCard({ height = 70 }) {
  return <div className="skeleton" style={{ height, borderRadius: 14, marginBottom: 10 }} />;
}
function SkeletonChart() {
  const { dark } = useTheme();
  const t = tokens(dark);
  return (
    <div style={{ background: t.surface, borderRadius: 12, padding: 16, marginBottom: 16, boxShadow: t.cardShadow }}>
      <div className="skeleton" style={{ height: 14, width: "50%", marginBottom: 16, borderRadius: 6 }} />
      <div className="skeleton" style={{ height: 160, borderRadius: 10 }} />
    </div>
  );
}

// ── Empty state dengan ilustrasi ─────────────────────────────
function EmptyState({ icon, title, subtitle }) {
  const { dark } = useTheme();
  const t = tokens(dark);
  return (
    <div style={{ textAlign: "center", padding: "52px 20px", animation: "fadeIn 0.4s ease-out" }}>
      <div style={{
        fontSize: 26, marginBottom: 16, display: "inline-flex", width:56, height:56,
        alignItems:"center", justifyContent:"center", borderRadius:14,
        background: t.surface2, color: t.textMuted, border:`1px solid ${t.borderSoft}`,
        animation: "popIn 0.5s cubic-bezier(0.34,1.56,0.64,1)",
      }}>{icon}</div>
      <div style={{ fontFamily:t.fontDisplay, fontSize: 15.5, color: t.text, fontWeight: 600 }}>{title}</div>
      {subtitle && <div style={{ fontSize: 12.5, color: t.textMuted, marginTop: 5 }}>{subtitle}</div>}
    </div>
  );
}

// ── Toast ────────────────────────────────────────────────────
function Toast({ msg, type }) {
  const { dark } = useTheme();
  const t = tokens(dark);
  if (!msg) return null;
  return <div style={{ position:"fixed", bottom:24, left:"50%", transform:"translateX(-50%)", background: type==="error"?t.red:t.green, color:"#fff", padding:"11px 22px", borderRadius:9, fontWeight:600, fontSize:13, zIndex:999, boxShadow:"0 8px 24px rgba(0,0,0,0.25)", whiteSpace:"nowrap", animation:"popIn 0.25s cubic-bezier(0.34,1.56,0.64,1)", fontFamily:t.fontBody }}>{msg}</div>;
}

// ── Auth Screen ──────────────────────────────────────────────
function AuthScreen({ onAuth }) {
  const { dark } = useTheme();
  const t = tokens(dark);
  const inp = mkInp(t);
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const handle = async () => {
    setErr(""); setLoading(true);
    try {
      const res = mode === "login" ? await sb.signIn(email, pw) : await sb.signUp(email, pw);
      if (res.access_token) { localStorage.setItem("sb_token", res.access_token); localStorage.setItem("sb_email", email); onAuth(res.access_token, email); }
      else setErr(res.error_description || "Email atau password salah");
    } catch { setErr("Tidak dapat terhubung ke Supabase"); }
    setLoading(false);
  };

  return (
    <div style={{ minHeight:"100vh", display:"flex", flexWrap:"wrap", background:t.bg }}>
      {/* Panel kiri — branding (desktop only) */}
      <div className="desktop-sidebar" style={{
        flex:1, background:`linear-gradient(165deg, ${t.sidebarBg} 0%, ${t.sidebarBg2} 100%)`,
        display:"flex", flexDirection:"column", justifyContent:"space-between",
        padding:"56px 56px", position:"relative", overflow:"hidden", minHeight:"100vh",
      }}>
        {/* Garis ledger dekoratif ambient */}
        <div style={{ position:"absolute", inset:0, opacity:0.05, backgroundImage:`repeating-linear-gradient(180deg, transparent, transparent 39px, ${ACCENT_GOLD_L} 40px)` }} />

        <div style={{ position:"relative" }}>
          <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:64 }}>
            <div style={{
              width:40, height:40, borderRadius:9, background:`linear-gradient(135deg, ${ACCENT_GOLD_L}, ${ACCENT_GOLD})`,
              display:"flex", alignItems:"center", justifyContent:"center",
              fontFamily:t.fontDisplay, fontWeight:700, fontSize:20, color:"#181820",
            }}>D</div>
            <div style={{ fontFamily:t.fontDisplay, fontWeight:600, fontSize:19, color:"#FDFCF8" }}>Dompet Saya</div>
          </div>

          <div style={{ fontFamily:t.fontDisplay, fontWeight:500, fontSize:38, lineHeight:1.25, color:"#FDFCF8", maxWidth:420 }}>
            Catatan keuangan yang <span style={{ color:ACCENT_GOLD_L, fontStyle:"italic" }}>rapi</span>, disertai kecerdasan yang membantu.
          </div>
          <div style={{ fontSize:14, color:"#8C8879", marginTop:20, maxWidth:380, lineHeight:1.7 }}>
            Grafik, anggaran per kategori, proyeksi Hybrid ARIMA-LSTM, dan penasihat AI — semua dalam satu buku kas digital.
          </div>
        </div>

        <div style={{ position:"relative", display:"flex", gap:32, fontSize:12.5, color:"#8C8879" }}>
          <div><span style={{ color:ACCENT_GOLD_L, fontFamily:t.fontMono, fontWeight:700 }}>ARIMA</span>–LSTM</div>
          <div>Multi-Dompet</div>
          <div>Scan Struk AI</div>
        </div>
      </div>

      {/* Panel kanan — form */}
      <div style={{ flex:"0 0 460px", display:"flex", alignItems:"center", justifyContent:"center", padding:32, width:"100%" }}>
        <div className="card-enter" style={{ width:"100%", maxWidth:360 }}>
          <div style={{ marginBottom:8 }}>
            <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:28 }}>
              <div style={{
                width:34, height:34, borderRadius:8, background:`linear-gradient(135deg, ${t.gold}, ${ACCENT_GOLD})`,
                display:"flex", alignItems:"center", justifyContent:"center",
                fontFamily:t.fontDisplay, fontWeight:700, fontSize:17, color:"#181820",
              }}>D</div>
              <div style={{ fontFamily:t.fontDisplay, fontWeight:600, fontSize:17, color:t.text }}>Dompet Saya</div>
            </div>
            <div style={{ fontFamily:t.fontDisplay, fontWeight:600, fontSize:24, color:t.text, marginBottom:6 }}>
              {mode === "login" ? "Selamat datang kembali" : "Buat akun baru"}
            </div>
            <div style={{ fontSize:13.5, color:t.textMuted, marginBottom:26 }}>
              {mode === "login" ? "Masuk untuk melanjutkan pencatatan" : "Mulai catat keuangan kamu hari ini"}
            </div>
          </div>

          <div style={{ display:"flex", background:t.surface2, borderRadius:9, padding:4, marginBottom:22 }}>
            {["login","register"].map(m => <button key={m} className="btn-press" onClick={()=>{setMode(m);setErr("");}} style={{ flex:1, padding:"9px", borderRadius:6, border:"none", background:mode===m?t.surface:"transparent", color:mode===m?t.text:t.textMuted, fontWeight:600, fontSize:13, cursor:"pointer", boxShadow: mode===m ? t.cardShadow : "none" }}>{m==="login"?"Masuk":"Daftar"}</button>)}
          </div>

          {err && <div style={{ background: dark?"rgba(184,69,69,0.12)":"rgba(140,47,47,0.06)", color:t.red, padding:"10px 14px", borderRadius:9, fontSize:13, marginBottom:14, border:`1px solid ${dark?"rgba(184,69,69,0.25)":"rgba(140,47,47,0.15)"}` }}>{err}</div>}

          <div style={{ marginBottom:12 }}>
            <label style={{ fontSize:12, fontWeight:600, color:t.textSub, marginBottom:6, display:"block" }}>Email</label>
            <input type="email" placeholder="nama@email.com" value={email} onChange={e=>setEmail(e.target.value)} style={inp} />
          </div>
          <div style={{ marginBottom:22 }}>
            <label style={{ fontSize:12, fontWeight:600, color:t.textSub, marginBottom:6, display:"block" }}>Kata sandi</label>
            <input type="password" placeholder="••••••••" value={pw} onChange={e=>setPw(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handle()} style={inp} />
          </div>
          <button className="btn-press" onClick={handle} disabled={loading} style={{
            width:"100%", padding:13, borderRadius:9, border:"none",
            background: loading ? t.textMuted : `linear-gradient(135deg, ${ACCENT_GOLD_L}, ${ACCENT_GOLD})`,
            color:"#181820", fontWeight:700, fontSize:14.5, cursor:loading?"not-allowed":"pointer",
          }}>
            {loading?"Memproses...":mode==="login"?"Masuk":"Buat Akun"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Konstanta Dompet ─────────────────────────────────────────
// Catatan: ini konstanta level-modul, dievaluasi sebelum komponen render,
// jadi HARUS pakai hex literal, bukan token tema (t.gold dsb belum ada di sini).
const DOMPET_PRESETS = [
  { nama:"Dompet Cash",   ikon:"💵", warna:"#1B5E42" },
  { nama:"Bank BCA",      ikon:"🏦", warna:"#B8860B" },
  { nama:"Bank Mandiri",  ikon:"🏛️", warna:"#8C6408" },
  { nama:"GoPay",         ikon:"💚", warna:"#2D8A63" },
  { nama:"OVO",           ikon:"💜", warna:"#6B4C8A" },
  { nama:"Dana",          ikon:"💙", warna:"#3D6E96" },
  { nama:"ShopeePay",     ikon:"🧡", warna:"#B85C2E" },
  { nama:"Tabungan",      ikon:"🐷", warna:"#A5486B" },
  { nama:"Investasi",     ikon:"📈", warna:"#B8860B" },
];

const DOMPET_IKONS = ["💰","💵","💴","💶","💷","🏦","🏛️","💳","💚","💜","💙","🧡","❤️","🐷","📈","💎"];
const DOMPET_WARNAS = ["#B8860B","#1B5E42","#8C2F2F","#3D6E96","#6B4C8A","#A5486B","#B85C2E","#2D8A63","#8C6408","#5C584E"];

// ── Tab Dompet ───────────────────────────────────────────────
function TabDompet({ dompet, transaksi, token, showToast, onDompetChange, aktivDompetId, setAktivDompetId }) {
  const { dark } = useTheme();
  const t = tokens(dark);
  const inp = mkInp(t);
  const [showForm, setShowForm] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ nama:"", ikon:"💰", warna:t.gold, saldo_awal:0 });
  const [transfer, setTransfer] = useState({ dari:"", ke:"", jumlah:"", catatan:"" });

  // Hitung saldo aktual per dompet dari transaksi
  const saldoPerDompet = useMemo(() => {
    const map = {};
    dompet.forEach(d => { map[d.id] = d.saldo_awal || 0; });
    transaksi.forEach(tx => {
      if (!tx.dompet_id || !map.hasOwnProperty(tx.dompet_id)) return;
      map[tx.dompet_id] += tx.tipe === "pemasukan" ? tx.jumlah : -tx.jumlah;
    });
    return map;
  }, [dompet, transaksi]);

  const totalSaldo = Object.values(saldoPerDompet).reduce((s,v)=>s+v, 0);

  const handleSimpan = async () => {
    if (!form.nama) { showToast("Nama dompet wajib diisi!", "error"); return; }
    setLoading(true);
    try {
      const payload = { nama: form.nama, ikon: form.ikon, warna: form.warna, saldo_awal: Number(form.saldo_awal) || 0, urutan: dompet.length };
      if (editItem) {
        await sb.updateDompet(token, editItem.id, payload);
        showToast("Dompet diperbarui ✓");
      } else {
        await sb.insertDompet(token, payload);
        showToast("Dompet dibuat ✓");
      }
      setShowForm(false); setEditItem(null);
      setForm({ nama:"", ikon:"💰", warna:t.gold, saldo_awal:0 });
      onDompetChange();
    } catch { showToast("Gagal menyimpan", "error"); }
    setLoading(false);
  };

  const handleHapus = async (id) => {
    if (!confirm("Hapus dompet ini? Transaksinya tetap tersimpan.")) return;
    await sb.removeDompet(token, id);
    showToast("Dompet dihapus");
    if (aktivDompetId === id) setAktivDompetId(null);
    onDompetChange();
  };

  const handleTransfer = async () => {
    if (!transfer.dari || !transfer.ke || !transfer.jumlah) { showToast("Lengkapi semua field!", "error"); return; }
    if (transfer.dari === transfer.ke) { showToast("Dompet asal & tujuan tidak boleh sama!", "error"); return; }
    setLoading(true);
    const tgl = new Date().toISOString().split("T")[0];
    const catatan = transfer.catatan || `Transfer ke ${dompet.find(d=>d.id===transfer.ke)?.nama}`;
    try {
      // Catat sebagai pengeluaran di dompet asal
      await sb.insert(token, { tipe:"pengeluaran", kategori:"Transfer", jumlah:Number(transfer.jumlah), catatan, tanggal:tgl, dompet_id:transfer.dari });
      // Catat sebagai pemasukan di dompet tujuan
      await sb.insert(token, { tipe:"pemasukan", kategori:"Transfer", jumlah:Number(transfer.jumlah), catatan:`Transfer dari ${dompet.find(d=>d.id===transfer.dari)?.nama}`, tanggal:tgl, dompet_id:transfer.ke });
      showToast("Transfer berhasil ✓");
      setShowTransfer(false);
      setTransfer({ dari:"", ke:"", jumlah:"", catatan:"" });
      onDompetChange();
    } catch { showToast("Transfer gagal", "error"); }
    setLoading(false);
  };

  const applyPreset = (p) => setForm(f => ({ ...f, nama:p.nama, ikon:p.ikon, warna:p.warna }));

  return (
    <div style={{ paddingTop:20 }}>
      {/* Total Saldo Gabungan */}
      <div style={{ background:`linear-gradient(135deg, #1B5E42, #14141c)`, borderRadius:12, padding:20, marginBottom:16, color:"#fff", position:"relative", overflow:"hidden" }}>
        <div style={{ position:"absolute", top:-20, right:-20, width:100, height:100, borderRadius:"50%", background:"rgba(255,255,255,0.08)" }} />
        <div style={{ fontSize:12, opacity:0.8, marginBottom:4 }}>💼 Total Semua Dompet</div>
        <div style={{ fontSize:28, fontWeight:800, letterSpacing:-1 }}><AnimatedNumber value={totalSaldo} /></div>
        <div style={{ fontSize:12, opacity:0.7, marginTop:6 }}>{dompet.length} dompet aktif</div>
      </div>

      {/* Tombol aksi */}
      <div style={{ display:"flex", gap:8, marginBottom:16 }}>
        <button className="btn-press" onClick={()=>{ setShowForm(!showForm); setEditItem(null); setForm({ nama:"", ikon:"💰", warna:t.gold, saldo_awal:0 }); setShowTransfer(false); }}
          style={{ flex:1, padding:"10px", borderRadius:12, border:"none", background:"linear-gradient(135deg, #D4A017, #B8860B)", color:"#181820", fontWeight:700, fontSize:13, cursor:"pointer" }}>
          ➕ Dompet Baru
        </button>
        <button className="btn-press" onClick={()=>{ setShowTransfer(!showTransfer); setShowForm(false); }}
          style={{ flex:1, padding:"10px", borderRadius:12, border:`1.5px solid ${t.border}`, background:t.surface, color:t.text, fontWeight:700, fontSize:13, cursor:"pointer" }}>
          ↔️ Transfer
        </button>
      </div>

      {/* Form Dompet Baru */}
      {showForm && (
        <div className="card-enter" style={{ background:t.surface, borderRadius:12, padding:18, marginBottom:16, boxShadow:t.cardShadow }}>
          <div style={{ fontWeight:700, fontSize:14, color:t.gold, marginBottom:14 }}>{editItem?"✏️ Edit Dompet":"➕ Buat Dompet Baru"}</div>

          {/* Preset */}
          {!editItem && (
            <>
              <div style={{ fontSize:12, color:t.textMuted, marginBottom:8 }}>Pilih preset cepat:</div>
              <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:14 }}>
                {DOMPET_PRESETS.map((p,i) => (
                  <button key={i} className="btn-press" onClick={()=>applyPreset(p)} style={{
                    padding:"5px 10px", borderRadius:10, border:`1.5px solid ${t.border}`,
                    background: form.nama===p.nama ? p.warna : t.surface2,
                    color: form.nama===p.nama ? "#fff" : t.text,
                    fontSize:12, cursor:"pointer", fontWeight:500,
                  }}>{p.ikon} {p.nama}</button>
                ))}
              </div>
            </>
          )}

          {/* Pilih ikon */}
          <div style={{ fontSize:12, color:t.textMuted, marginBottom:8 }}>Ikon:</div>
          <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:12 }}>
            {DOMPET_IKONS.map(ik => (
              <button key={ik} className="btn-press" onClick={()=>setForm(f=>({...f,ikon:ik}))} style={{
                width:36, height:36, borderRadius:10, border:`2px solid`,
                borderColor: form.ikon===ik ? form.warna : t.border,
                background: form.ikon===ik ? form.warna+"22" : t.surface2,
                fontSize:18, cursor:"pointer",
              }}>{ik}</button>
            ))}
          </div>

          {/* Pilih warna */}
          <div style={{ fontSize:12, color:t.textMuted, marginBottom:8 }}>Warna:</div>
          <div style={{ display:"flex", gap:6, marginBottom:12, flexWrap:"wrap" }}>
            {DOMPET_WARNAS.map(w => (
              <button key={w} className="btn-press" onClick={()=>setForm(f=>({...f,warna:w}))} style={{
                width:28, height:28, borderRadius:"50%", border:`3px solid`,
                borderColor: form.warna===w ? "#fff" : "transparent",
                background:w, cursor:"pointer",
                boxShadow: form.warna===w ? `0 0 0 2px ${w}` : "none",
              }} />
            ))}
          </div>

          <input placeholder="Nama dompet" value={form.nama} onChange={e=>setForm(f=>({...f,nama:e.target.value}))} style={{ ...inp, marginBottom:10 }} />
          <input type="number" placeholder="Saldo awal (Rp)" value={form.saldo_awal} onChange={e=>setForm(f=>({...f,saldo_awal:e.target.value}))} style={{ ...inp, marginBottom:14 }} />

          {/* Preview */}
          <div style={{ background:t.surface2, borderRadius:12, padding:12, marginBottom:14, display:"flex", alignItems:"center", gap:12 }}>
            <div style={{ width:44, height:44, borderRadius:12, background:form.warna, display:"flex", alignItems:"center", justifyContent:"center", fontSize:22 }}>{form.ikon}</div>
            <div>
              <div style={{ fontWeight:700, fontSize:14, color:t.text }}>{form.nama||"Nama Dompet"}</div>
              <div style={{ fontSize:12, color:t.textMuted }}>Saldo awal: {formatRp(Number(form.saldo_awal)||0)}</div>
            </div>
          </div>

          <div style={{ display:"flex", gap:8 }}>
            <button className="btn-press" onClick={()=>{ setShowForm(false); setEditItem(null); }} style={{ flex:1, padding:11, borderRadius:10, border:`1.5px solid ${t.border}`, background:t.surface2, color:t.textSub, fontWeight:600, cursor:"pointer", fontSize:13 }}>Batal</button>
            <button className="btn-press" onClick={handleSimpan} disabled={loading} style={{ flex:2, padding:11, borderRadius:10, border:"none", background:loading?"#C4BFA8":"linear-gradient(135deg, #D4A017, #B8860B)", color:"#181820", fontWeight:700, cursor:"pointer", fontSize:13 }}>
              {loading?"Menyimpan...":editItem?"Simpan Perubahan":"Buat Dompet"}
            </button>
          </div>
        </div>
      )}

      {/* Form Transfer */}
      {showTransfer && (
        <div className="card-enter" style={{ background:t.surface, borderRadius:12, padding:18, marginBottom:16, boxShadow:t.cardShadow }}>
          <div style={{ fontWeight:700, fontSize:14, color:t.gold, marginBottom:14 }}>↔️ Transfer Antar Dompet</div>
          <div style={{ display:"flex", gap:8, alignItems:"center", marginBottom:10 }}>
            <select value={transfer.dari} onChange={e=>setTransfer(f=>({...f,dari:e.target.value}))} style={{ ...inp, flex:1 }}>
              <option value="">Dari...</option>
              {dompet.map(d=><option key={d.id} value={d.id}>{d.ikon} {d.nama}</option>)}
            </select>
            <span style={{ fontSize:20, color:t.textMuted }}>→</span>
            <select value={transfer.ke} onChange={e=>setTransfer(f=>({...f,ke:e.target.value}))} style={{ ...inp, flex:1 }}>
              <option value="">Ke...</option>
              {dompet.filter(d=>d.id!==transfer.dari).map(d=><option key={d.id} value={d.id}>{d.ikon} {d.nama}</option>)}
            </select>
          </div>
          <input type="number" placeholder="Jumlah (Rp)" value={transfer.jumlah} onChange={e=>setTransfer(f=>({...f,jumlah:e.target.value}))} style={{ ...inp, marginBottom:10 }} />
          <input placeholder="Catatan (opsional)" value={transfer.catatan} onChange={e=>setTransfer(f=>({...f,catatan:e.target.value}))} style={{ ...inp, marginBottom:14 }} />
          <div style={{ display:"flex", gap:8 }}>
            <button className="btn-press" onClick={()=>setShowTransfer(false)} style={{ flex:1, padding:11, borderRadius:10, border:`1.5px solid ${t.border}`, background:t.surface2, color:t.textSub, fontWeight:600, cursor:"pointer", fontSize:13 }}>Batal</button>
            <button className="btn-press" onClick={handleTransfer} disabled={loading} style={{ flex:2, padding:11, borderRadius:9, border:"none", background:loading?t.surface2:"linear-gradient(135deg, #D4A017, #8C6408)", color:loading?t.textMuted:"#181820", fontWeight:700, cursor:"pointer", fontSize:13 }}>
              {loading?"Memproses...":"↔️ Transfer Sekarang"}
            </button>
          </div>
        </div>
      )}

      {/* Filter Dompet */}
      {dompet.length > 0 && (
        <div style={{ display:"flex", gap:8, marginBottom:12, overflowX:"auto", paddingBottom:4 }}>
          <button className="btn-press" onClick={()=>setAktivDompetId(null)} style={{
            padding:"6px 14px", borderRadius:10, border:`1.5px solid`, flexShrink:0,
            borderColor: !aktivDompetId ? t.gold : t.border,
            background: !aktivDompetId ? (dark?"#1e3a5f":"#eff6ff") : t.surface,
            color: !aktivDompetId ? t.gold : t.textSub, fontWeight:600, fontSize:12, cursor:"pointer",
          }}>Semua</button>
          {dompet.map(d => (
            <button key={d.id} className="btn-press" onClick={()=>setAktivDompetId(d.id)} style={{
              padding:"6px 14px", borderRadius:10, border:`1.5px solid`, flexShrink:0,
              borderColor: aktivDompetId===d.id ? d.warna : t.border,
              background: aktivDompetId===d.id ? d.warna+"22" : t.surface,
              color: aktivDompetId===d.id ? d.warna : t.textSub, fontWeight:600, fontSize:12, cursor:"pointer",
            }}>{d.ikon} {d.nama}</button>
          ))}
        </div>
      )}

      {/* Kartu per Dompet */}
      {dompet.length === 0 ? (
        <EmptyState icon="◈" title="Belum ada dompet" subtitle="Buat dompet untuk mulai memisahkan saldo" />
      ) : dompet.map((d,i) => {
        const saldo = saldoPerDompet[d.id] || 0;
        const txCount = transaksi.filter(tx=>tx.dompet_id===d.id).length;
        return (
          <div key={d.id} className="list-item" style={{
            animationDelay:`${i*0.05}s`, animationFillMode:"backwards",
            background:t.surface, borderRadius:12, padding:18, marginBottom:12,
            boxShadow:t.cardShadow, border:`1px solid ${aktivDompetId===d.id ? d.warna : t.border}`,
            transition:"border-color 0.2s",
          }}>
            <div style={{ display:"flex", alignItems:"center", gap:14 }}>
              {/* Ikon */}
              <div style={{ width:50, height:50, borderRadius:14, background:d.warna+"22", border:`2px solid ${d.warna}33`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:26, flexShrink:0 }}>
                {d.ikon}
              </div>
              {/* Info */}
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontWeight:700, fontSize:15, color:t.text }}>{d.nama}</div>
                <div style={{ fontSize:12, color:t.textMuted, marginTop:2 }}>{txCount} transaksi</div>
              </div>
              {/* Saldo */}
              <div style={{ textAlign:"right" }}>
                <div style={{ fontWeight:800, fontSize:16, color: saldo >= 0 ? d.warna : t.red }}>
                  <AnimatedNumber value={saldo} />
                </div>
                <div style={{ fontSize:11, color:t.textMuted, marginTop:2 }}>
                  Awal: {formatRp(d.saldo_awal)}
                </div>
              </div>
            </div>

            {/* Actions */}
            <div style={{ display:"flex", gap:8, marginTop:14, paddingTop:12, borderTop:`1px solid ${t.border}` }}>
              <button className="btn-press" onClick={()=>setAktivDompetId(aktivDompetId===d.id?null:d.id)} style={{
                flex:1, padding:"7px", borderRadius:8, border:`1.5px solid ${t.border}`,
                background: aktivDompetId===d.id ? d.warna+"22" : t.surface2,
                color: aktivDompetId===d.id ? d.warna : t.textSub, fontWeight:600, fontSize:12, cursor:"pointer",
              }}>{aktivDompetId===d.id ? "✓ Dipilih" : "Lihat Transaksi"}</button>
              <button className="btn-press" onClick={()=>{ setEditItem(d); setForm({ nama:d.nama, ikon:d.ikon, warna:d.warna, saldo_awal:d.saldo_awal }); setShowForm(true); setShowTransfer(false); }} style={{
                flex:1, padding:"7px", borderRadius:8, border:`1.5px solid ${t.border}`,
                background:t.surface2, color:t.textSub, fontWeight:600, fontSize:12, cursor:"pointer",
              }}>✏️ Edit</button>
              <button className="btn-press" onClick={()=>handleHapus(d.id)} style={{
                padding:"7px 12px", borderRadius:8, border:"none",
                background:dark?"rgba(184,69,69,0.12)":"rgba(140,47,47,0.06)", color:t.red, fontWeight:600, fontSize:12, cursor:"pointer",
              }}>🗑️</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Tab Grafik ───────────────────────────────────────────────
function TabGrafik({ transaksi }) {
  const { dark } = useTheme();
  const t = tokens(dark);

  const dataPerBulan = useMemo(() => {
    const map = {};
    transaksi.forEach(tx => {
      const d = new Date(tx.tanggal);
      const key = `${BULAN_ID[d.getMonth()]} ${d.getFullYear()}`;
      if (!map[key]) map[key] = { bulan: key, pemasukan: 0, pengeluaran: 0 };
      map[key][tx.tipe] += tx.jumlah;
    });
    return Object.values(map).slice(-6);
  }, [transaksi]);

  const dataKategori = useMemo(() => {
    const map = {};
    transaksi.filter(tx => tx.tipe === "pengeluaran").forEach(tx => {
      map[tx.kategori] = (map[tx.kategori] || 0) + tx.jumlah;
    });
    return Object.entries(map).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([k,v])=>({ name: k, nilai: v }));
  }, [transaksi]);

  const customTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    return (
      <div style={{ background:t.surface, border:`1px solid ${t.border}`, borderRadius:10, padding:"10px 14px", fontSize:12, color:t.text }}>
        <div style={{ fontWeight:700, marginBottom:4 }}>{label}</div>
        {payload.map((p,i) => <div key={i} style={{ color:p.color }}>● {p.name}: {formatRp(p.value)}</div>)}
      </div>
    );
  };

  const gridColor = dark ? "#2a2a35" : "#EBE7DA";
  const axisColor = dark ? "#6E6B62" : "#8C8879";

  const cardTitle = { fontFamily:t.fontDisplay, fontWeight:600, fontSize:15.5, color:t.text, marginBottom:18 };

  return (
    <div>
      <div style={{ background:t.surface, borderRadius:14, padding:"20px 20px 10px", marginBottom:16, boxShadow:t.cardShadow, border:`1px solid ${t.borderSoft}` }}>
        <div style={cardTitle}>Pemasukan vs Pengeluaran <span style={{ fontFamily:t.fontBody, fontWeight:400, fontSize:12.5, color:t.textMuted }}>· 6 bulan terakhir</span></div>
        {dataPerBulan.length === 0
          ? <EmptyState icon="◧" title="Belum ada data" />
          : <ResponsiveContainer width="100%" height={200}>
              <BarChart data={dataPerBulan} margin={{ left:0, right:0 }} barGap={4}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
                <XAxis dataKey="bulan" tick={{ fontSize:11, fill:axisColor, fontFamily:t.fontBody }} axisLine={{ stroke:gridColor }} tickLine={false} />
                <YAxis tickFormatter={v=>`${(v/1000000).toFixed(1)}jt`} tick={{ fontSize:10, fill:axisColor, fontFamily:t.fontMono }} axisLine={false} tickLine={false} />
                <Tooltip content={customTooltip} cursor={{ fill: dark?"rgba(255,255,255,0.03)":"rgba(0,0,0,0.02)" }} />
                <Legend wrapperStyle={{ fontSize:12, color:t.text, paddingTop:8 }} iconType="circle" iconSize={8} />
                <Bar dataKey="pemasukan" name="Pemasukan" fill={t.green} radius={[3,3,0,0]} maxBarSize={28} />
                <Bar dataKey="pengeluaran" name="Pengeluaran" fill={t.red} radius={[3,3,0,0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
        }
      </div>

      <div style={{ background:t.surface, borderRadius:14, padding:"20px 20px 10px", marginBottom:16, boxShadow:t.cardShadow, border:`1px solid ${t.borderSoft}` }}>
        <div style={cardTitle}>Tren Pengeluaran</div>
        {dataPerBulan.length === 0
          ? <EmptyState icon="◆" title="Belum ada data" />
          : <ResponsiveContainer width="100%" height={160}>
              <AreaChart data={dataPerBulan}>
                <defs>
                  <linearGradient id="gradPengeluaran" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={t.gold} stopOpacity={dark?0.45:0.28}/>
                    <stop offset="95%" stopColor={t.gold} stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
                <XAxis dataKey="bulan" tick={{ fontSize:11, fill:axisColor, fontFamily:t.fontBody }} axisLine={{ stroke:gridColor }} tickLine={false} />
                <YAxis tickFormatter={v=>`${(v/1000000).toFixed(1)}jt`} tick={{ fontSize:10, fill:axisColor, fontFamily:t.fontMono }} axisLine={false} tickLine={false} />
                <Tooltip content={customTooltip} />
                <Area type="monotone" dataKey="pengeluaran" name="Pengeluaran" stroke={t.gold} fill="url(#gradPengeluaran)" strokeWidth={2.2} />
              </AreaChart>
            </ResponsiveContainer>
        }
      </div>

      <div style={{ background:t.surface, borderRadius:14, padding:20, boxShadow:t.cardShadow, border:`1px solid ${t.borderSoft}` }}>
        <div style={cardTitle}>Kategori Pengeluaran Teratas</div>
        {dataKategori.length === 0
          ? <EmptyState icon="◎" title="Belum ada data" />
          : <ResponsiveContainer width="100%" height={210}>
              <BarChart data={dataKategori} layout="vertical" margin={{ left:20 }}>
                <XAxis type="number" tickFormatter={v=>`${(v/1000).toFixed(0)}rb`} tick={{ fontSize:10, fill:axisColor, fontFamily:t.fontMono }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" tick={{ fontSize:11.5, fill:t.text, fontFamily:t.fontBody }} width={90} axisLine={false} tickLine={false} />
                <Tooltip content={customTooltip} cursor={{ fill: dark?"rgba(255,255,255,0.03)":"rgba(0,0,0,0.02)" }} />
                <Bar dataKey="nilai" name="Jumlah" fill={t.red} radius={[0,3,3,0]} maxBarSize={18} />
              </BarChart>
            </ResponsiveContainer>
        }
      </div>
    </div>
  );
}

// ── Tab Budget ───────────────────────────────────────────────
function TabBudget({ transaksi, token, showToast }) {
  const { dark } = useTheme();
  const t = tokens(dark);
  const inp = mkInp(t);
  const now = new Date();
  const [bulan, setBulan] = useState(now.getMonth() + 1);
  const [tahun, setTahun] = useState(now.getFullYear());
  const [budgets, setBudgets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ kategori: "", limit_bulanan: "" });

  const loadBudgets = () => {
    setLoading(true);
    sb.fetchBudget(token, bulan, tahun)
      .then(d => setBudgets(Array.isArray(d) ? d : []))
      .catch(() => showToast("Gagal memuat budget", "error"))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadBudgets(); }, [bulan, tahun]);

  // Hitung pengeluaran aktual per kategori untuk bulan/tahun terpilih
  const pengeluaranAktual = useMemo(() => {
    const map = {};
    transaksi.filter(t => {
      const d = new Date(t.tanggal);
      return t.tipe === "pengeluaran" && (d.getMonth() + 1) === bulan && d.getFullYear() === tahun;
    }).forEach(t => { map[t.kategori] = (map[t.kategori] || 0) + t.jumlah; });
    return map;
  }, [transaksi, bulan, tahun]);

  const handleSubmit = async () => {
    if (!form.kategori || !form.limit_bulanan) { showToast("Lengkapi semua field!", "error"); return; }
    setLoading(true);
    try {
      await sb.upsertBudget(token, {
        kategori: form.kategori,
        limit_bulanan: Number(form.limit_bulanan),
        bulan, tahun,
      });
      showToast("Budget disimpan ✓");
      setForm({ kategori: "", limit_bulanan: "" });
      setShowForm(false);
      loadBudgets();
    } catch { showToast("Gagal menyimpan budget", "error"); }
    setLoading(false);
  };

  const handleDelete = async (id) => {
    if (!confirm("Hapus budget ini?")) return;
    await sb.removeBudget(token, id);
    showToast("Budget dihapus");
    loadBudgets();
  };

  const kategoriTersedia = CATS.pengeluaran.filter(k => !budgets.some(b => b.kategori === k));
  const totalLimit = budgets.reduce((s, b) => s + b.limit_bulanan, 0);
  const totalAktual = budgets.reduce((s, b) => s + (pengeluaranAktual[b.kategori] || 0), 0);

  const warnaProgress = (persen) => {
    if (persen >= 100) return t.red;
    if (persen >= 80) return t.gold;
    return t.green;
  };

  return (
    <div>
      {/* Selector Bulan/Tahun */}
      <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
        <select value={bulan} onChange={e => setBulan(Number(e.target.value))} style={{ ...inp, flex: 2 }}>
          {BULAN_ID.map((b, i) => <option key={i} value={i + 1}>{b}</option>)}
        </select>
        <select value={tahun} onChange={e => setTahun(Number(e.target.value))} style={{ ...inp, flex: 1 }}>
          {[now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <button className="btn-press" onClick={() => setShowForm(!showForm)} style={{
          padding: "10px 18px", borderRadius: 9, border: "none",
          background: `linear-gradient(135deg, ${ACCENT_GOLD_L}, ${ACCENT_GOLD})`, color: "#181820",
          fontWeight: 700, fontSize: 17, cursor: "pointer",
        }}>+</button>
      </div>

      {/* Form Tambah Budget */}
      {showForm && (
        <div className="card-enter" style={{ background: t.surface, borderRadius: 12, padding: 20, marginBottom: 16, boxShadow: t.cardShadow, border:`1px solid ${t.borderSoft}` }}>
          <div style={{ fontFamily:t.fontDisplay, fontWeight: 600, fontSize: 15.5, marginBottom: 14, color: t.text }}>Atur Anggaran Kategori</div>
          {kategoriTersedia.length === 0 ? (
            <div style={{ fontSize: 13, color: t.textMuted, textAlign: "center", padding: 12 }}>
              Semua kategori sudah punya anggaran bulan ini
            </div>
          ) : (
            <>
              <select value={form.kategori} onChange={e => setForm(f => ({ ...f, kategori: e.target.value }))} style={{ ...inp, marginBottom: 10 }}>
                <option value="">Pilih Kategori</option>
                {kategoriTersedia.map(k => <option key={k}>{k}</option>)}
              </select>
              <input type="number" placeholder="Limit per bulan (Rp)" value={form.limit_bulanan}
                onChange={e => setForm(f => ({ ...f, limit_bulanan: e.target.value }))}
                style={{ ...inp, marginBottom: 14, fontFamily:t.fontMono }} />
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn-press" onClick={() => { setShowForm(false); setForm({ kategori: "", limit_bulanan: "" }); }} style={{
                  flex: 1, padding: 11, borderRadius: 9, border: `1.5px solid ${t.border}`,
                  background: t.surface2, color: t.textSub, fontWeight: 600, cursor: "pointer", fontSize: 13,
                }}>Batal</button>
                <button className="btn-press" onClick={handleSubmit} disabled={loading} style={{
                  flex: 2, padding: 11, borderRadius: 9, border: "none",
                  background: loading ? t.surface2 : `linear-gradient(135deg, ${ACCENT_GOLD_L}, ${ACCENT_GOLD})`,
                  color: loading ? t.textMuted : "#181820", fontWeight: 700, cursor: "pointer", fontSize: 13,
                }}>{loading ? "Menyimpan..." : "Simpan Anggaran"}</button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Ringkasan Total */}
      {budgets.length > 0 && (
        <div style={{ background: "linear-gradient(135deg, #D4A017, #B8860B)", borderRadius: 12, padding: 20, marginBottom: 16, color: "#181820" }}>
          <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 4, textTransform:"uppercase", letterSpacing:"0.04em", fontWeight:600 }}>Total Anggaran {BULAN_ID[bulan - 1]} {tahun}</div>
          <div className="num-tabular" style={{ fontFamily:t.fontMono, fontSize: 25, fontWeight: 800 }}>{formatRp(totalAktual)} <span style={{ fontSize: 14, opacity: 0.65, fontWeight: 500 }}>/ {formatRp(totalLimit)}</span></div>
          <div style={{ height: 7, background: "rgba(24,24,32,0.18)", borderRadius: 99, marginTop: 12, overflow: "hidden" }}>
            <div style={{
              height: 7, borderRadius: 99,
              background: totalAktual > totalLimit ? "#8C2F2F" : "#181820",
              width: `${Math.min((totalAktual / (totalLimit || 1)) * 100, 100)}%`,
              transition: "width 0.4s",
            }} />
          </div>
        </div>
      )}

      {/* List Budget per Kategori */}
      {loading ? (
        <div style={{ textAlign: "center", padding: 40, color: t.textMuted }}>Memuat...</div>
      ) : budgets.length === 0 ? (
        <EmptyState icon="◎" title={`Belum ada anggaran untuk ${BULAN_ID[bulan - 1]} ${tahun}`} subtitle="Klik + untuk mengatur limit pengeluaran" />
      ) : budgets.map(b => {
        const aktual = pengeluaranAktual[b.kategori] || 0;
        const persen = Math.min((aktual / b.limit_bulanan) * 100, 999);
        const sisa = b.limit_bulanan - aktual;
        const warna = warnaProgress(persen);

        return (
          <div key={b.id} style={{ background: t.surface, borderRadius: 12, padding: 17, marginBottom: 10, boxShadow: t.cardShadow, border:`1px solid ${t.borderSoft}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 9 }}>
              <span style={{ fontWeight: 600, fontSize: 14, color:t.text }}>{ICONS[b.kategori] || "📦"} {b.kategori}</span>
              <button className="btn-press" onClick={() => handleDelete(b.id)} style={{ fontSize: 11, background: dark?"rgba(184,69,69,0.12)":"rgba(140,47,47,0.06)", border: "none", borderRadius: 6, padding: "3px 8px", cursor: "pointer", color: t.red, fontWeight:600 }}>Hapus</button>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 6 }}>
              <span className="num-tabular" style={{ fontFamily:t.fontMono, fontWeight: 700, color: warna }}>{formatRp(aktual)}</span>
              <span style={{ color: t.textMuted }}>dari {formatRp(b.limit_bulanan)}</span>
            </div>
            <div style={{ height: 7, background: t.surface2, borderRadius: 99, overflow: "hidden" }}>
              <div style={{ height: 7, borderRadius: 99, background: warna, width: `${Math.min(persen, 100)}%`, transition: "width 0.4s" }} />
            </div>
            <div style={{ fontSize: 11, color: sisa < 0 ? t.red : t.textMuted, marginTop: 6, fontWeight: sisa < 0 ? 700 : 400 }}>
              {sisa < 0
                ? `Melebihi anggaran ${formatRp(Math.abs(sisa))}`
                : `Sisa ${formatRp(sisa)} (${(100 - persen).toFixed(0)}%)`}
            </div>
          </div>
        );
      })}
    </div>
  );
}


function TabPrediksi({ transaksi }) {
  const { dark } = useTheme();
  const t = tokens(dark);
  const inp = mkInp(t);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [nBulan, setNBulan] = useState(3);

  const jalankanPrediksi = async () => {
    setLoading(true); setErr(""); setResult(null);
    try {
      const res = await fetch(`${BACKEND_URL}/prediksi`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transaksi, bulan_prediksi: nBulan }),
      });
      if (!res.ok) {
        const e = await res.json();
        throw new Error(e.detail || "Gagal menjalankan prediksi");
      }
      setResult(await res.json());
    } catch (e) { setErr(e.message); }
    setLoading(false);
  };

  const dataGrafik = result
    ? result.bulan.map((b, i) => ({
        bulan: b,
        ARIMA: result.prediksi_arima[i],
        LSTM: result.prediksi_lstm[i],
        Hybrid: result.prediksi_hybrid[i],
      }))
    : [];

  const customTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    return (
      <div style={{ background:t.surface, border:`1px solid ${t.border}`, borderRadius:9, padding:"10px 14px", fontSize:12, color:t.text }}>
        <div style={{ fontWeight:700, marginBottom:4 }}>{label}</div>
        {payload.map((p,i) => <div key={i} style={{ color:p.color }}>● {p.name}: {formatRp(p.value)}</div>)}
      </div>
    );
  };

  const gridColor = dark ? "#2a2a35" : "#EBE7DA";
  const axisColor = dark ? "#6E6B62" : "#8C8879";
  const cardTitle = { fontFamily:t.fontDisplay, fontWeight:600, fontSize:15.5, color:t.text, marginBottom:14 };

  return (
    <div>
      {/* Panel Kontrol */}
      <div style={{ background:t.surface, borderRadius:12, padding:22, marginBottom:16, boxShadow:t.cardShadow, border:`1px solid ${t.borderSoft}` }}>
        <div style={cardTitle}>Proyeksi Hybrid ARIMA-LSTM</div>
        <div style={{ fontSize:12.5, color:t.textMuted, marginBottom:18, lineHeight:1.65 }}>
          Model ARIMA menangkap pola linear, lalu residualnya diproses LSTM untuk pola non-linear.
          Hasilnya digabungkan menjadi proyeksi yang lebih akurat.
        </div>
        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
          <select value={nBulan} onChange={e=>setNBulan(Number(e.target.value))} style={{ ...inp, flex:1 }}>
            <option value={1}>1 bulan ke depan</option>
            <option value={3}>3 bulan ke depan</option>
            <option value={6}>6 bulan ke depan</option>
          </select>
          <button className="btn-press" onClick={jalankanPrediksi} disabled={loading || transaksi.length < 3} style={{
            padding:"11px 22px", borderRadius:9, border:"none",
            background: (loading||transaksi.length<3) ? t.surface2 : `linear-gradient(135deg, ${ACCENT_GOLD_L}, ${ACCENT_GOLD})`,
            color:(loading||transaksi.length<3) ? t.textMuted : "#181820", fontWeight:700, fontSize:13, cursor:(loading||transaksi.length<3)?"not-allowed":"pointer", whiteSpace:"nowrap",
          }}>
            {loading ? "Memproses..." : "Jalankan"}
          </button>
        </div>
        {transaksi.length < 3 && (
          <div style={{ fontSize:12, color:t.gold, marginTop:10 }}>Butuh minimal 3 transaksi untuk menjalankan proyeksi</div>
        )}
      </div>

      {/* Error */}
      {err && (
        <div style={{ background: dark?"rgba(184,69,69,0.12)":"rgba(140,47,47,0.06)", color:t.red, padding:"13px 16px", borderRadius:10, fontSize:13, marginBottom:16, border:`1px solid ${dark?"rgba(184,69,69,0.25)":"rgba(140,47,47,0.15)"}` }}>
          {err}<br/>
          <span style={{ fontSize:11.5, opacity:0.75 }}>Pastikan backend Python sudah berjalan di {BACKEND_URL}</span>
        </div>
      )}

      {/* Hasil Prediksi */}
      {result && (
        <>
          {/* Akurasi */}
          <div style={{ display:"flex", gap:12, marginBottom:16 }}>
            {[
              { label:"Akurasi ARIMA", val:`${result.akurasi_arima}%` },
              { label:"Akurasi Hybrid", val:`${result.akurasi_hybrid}%` },
            ].map((item, i) => (
              <div key={i} style={{ flex:1, background:t.surface, borderRadius:12, padding:"16px 18px", boxShadow:t.cardShadow, border:`1px solid ${t.borderSoft}` }}>
                <div className="num-tabular" style={{ fontFamily:t.fontMono, fontSize:25, fontWeight:800, color:t.gold }}>{item.val}</div>
                <div style={{ fontSize:11.5, color:t.textMuted, marginTop:3 }}>{item.label}</div>
              </div>
            ))}
          </div>

          {/* Grafik Prediksi */}
          <div style={{ background:t.surface, borderRadius:12, padding:"20px 20px 8px", marginBottom:16, boxShadow:t.cardShadow, border:`1px solid ${t.borderSoft}` }}>
            <div style={cardTitle}>Perbandingan Model</div>
            <ResponsiveContainer width="100%" height={210}>
              <LineChart data={dataGrafik}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
                <XAxis dataKey="bulan" tick={{ fontSize:11, fill:axisColor, fontFamily:t.fontBody }} axisLine={{ stroke:gridColor }} tickLine={false} />
                <YAxis tickFormatter={v=>`${(v/1000000).toFixed(1)}jt`} tick={{ fontSize:10, fill:axisColor, fontFamily:t.fontMono }} axisLine={false} tickLine={false} />
                <Tooltip content={customTooltip} />
                <Legend wrapperStyle={{ fontSize:12, color:t.text, paddingTop:8 }} iconType="circle" iconSize={8} />
                <Line type="monotone" dataKey="ARIMA" stroke={dark?"#6E6B62":"#A19E93"} strokeWidth={1.75} dot={{ r:3.5 }} />
                <Line type="monotone" dataKey="LSTM" stroke={t.green} strokeWidth={1.75} dot={{ r:3.5 }} />
                <Line type="monotone" dataKey="Hybrid" stroke={t.gold} strokeWidth={3} dot={{ r:5 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Tabel Prediksi */}
          <div style={{ background:t.surface, borderRadius:12, padding:20, marginBottom:16, boxShadow:t.cardShadow, border:`1px solid ${t.borderSoft}` }}>
            <div style={cardTitle}>Rincian Proyeksi</div>
            <div style={{ overflowX:"auto" }}>
              <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12.5 }}>
                <thead>
                  <tr style={{ background:t.surface2 }}>
                    {["Bulan","ARIMA","LSTM","Hybrid*"].map(h => (
                      <th key={h} style={{ padding:"9px 11px", textAlign:"left", fontWeight:700, color:t.textSub, borderBottom:`1px solid ${t.border}`, fontFamily:t.fontBody }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.bulan.map((b, i) => (
                    <tr key={i} style={{ borderBottom:`1px solid ${t.borderSoft}` }}>
                      <td style={{ padding:"9px 11px", fontWeight:600, color:t.text }}>{b}</td>
                      <td className="num-tabular" style={{ padding:"9px 11px", color:t.textSub, fontFamily:t.fontMono }}>{formatRp(result.prediksi_arima[i])}</td>
                      <td className="num-tabular" style={{ padding:"9px 11px", color:t.green, fontFamily:t.fontMono }}>{formatRp(result.prediksi_lstm[i])}</td>
                      <td className="num-tabular" style={{ padding:"9px 11px", color:t.gold, fontWeight:700, fontFamily:t.fontMono }}>{formatRp(result.prediksi_hybrid[i])}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ fontSize:11, color:t.textMuted, marginTop:10 }}>* Hybrid = ARIMA + residual LSTM (rekomendasi)</div>
            </div>
          </div>

          {/* Insight */}
          <div style={{ background: dark?"rgba(212,160,23,0.08)":"rgba(184,134,11,0.05)", borderRadius:12, padding:20, border:`1px solid ${dark?"rgba(212,160,23,0.2)":"rgba(184,134,11,0.15)"}` }}>
            <div style={{ fontFamily:t.fontDisplay, fontWeight:600, fontSize:14, color:t.gold, marginBottom:8 }}>Wawasan Otomatis</div>
            <div style={{ fontSize:13, color:t.text, lineHeight:1.75 }}>{result.insight}</div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Tab AI Advisor ───────────────────────────────────────────
function TabAI({ transaksi }) {
  const { dark } = useTheme();
  const t = tokens(dark);
  const inp = mkInp(t);
  const [pertanyaan, setPertanyaan] = useState("");
  const [chat, setChat] = useState([]);
  const [loading, setLoading] = useState(false);

  const summary = useMemo(() => {
    const masuk = transaksi.filter(t=>t.tipe==="pemasukan").reduce((s,t)=>s+t.jumlah,0);
    const keluar = transaksi.filter(t=>t.tipe==="pengeluaran").reduce((s,t)=>s+t.jumlah,0);
    const byKat = {};
    transaksi.filter(t=>t.tipe==="pengeluaran").forEach(t=>{ byKat[t.kategori]=(byKat[t.kategori]||0)+t.jumlah; });
    return { masuk, keluar, saldo: masuk-keluar, byKat };
  }, [transaksi]);

  const tanya = async (pertanyaanCustom) => {
    const q = pertanyaanCustom || pertanyaan;
    if (!q.trim()) return;

    const newChat = [...chat, { role:"user", content: q }];
    setChat(newChat);
    setPertanyaan("");
    setLoading(true);

    try {
      const kontekKeuangan = `
Data keuangan pengguna:
- Total Pemasukan: ${formatRp(summary.masuk)}
- Total Pengeluaran: ${formatRp(summary.keluar)}
- Saldo: ${formatRp(summary.saldo)}
- Pengeluaran per kategori: ${JSON.stringify(summary.byKat)}
- Jumlah transaksi: ${transaksi.length}
`;
      const systemPrompt = `Kamu adalah AI Financial Advisor yang membantu analisis keuangan pribadi dalam Bahasa Indonesia.
Kamu ramah, praktis, dan memberi saran yang spesifik berdasarkan data nyata pengguna.
Gunakan format yang mudah dibaca dengan poin-poin singkat.
${kontekKeuangan}`;

      // Gemini pakai format "contents" dengan role user/model (bukan assistant)
      const geminiContents = newChat.map(m => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));

      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents: geminiContents,
            generationConfig: { maxOutputTokens: 1000 },
          }),
        }
      );

      const data = await res.json();
      const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "Maaf, tidak dapat merespons saat ini.";
      setChat(prev => [...prev, { role:"assistant", content: reply }]);
    } catch {
      setChat(prev => [...prev, { role:"assistant", content: "Gagal terhubung ke AI. Cek VITE_GEMINI_API_KEY di file .env kamu." }]);
    }
    setLoading(false);
  };

  const contohPertanyaan = [
    "Analisis pengeluaran saya bulan ini",
    "Bagaimana cara hemat berdasarkan data saya?",
    "Kategori mana yang paling boros?",
    "Berapa target tabungan yang realistis?",
  ];

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"calc(100vh - 220px)", minHeight:400 }}>
      {/* Header */}
      <div style={{ background:`linear-gradient(135deg, ${t.sidebarBg2}, ${t.sidebarBg})`, borderRadius:12, padding:"16px 20px", marginBottom:18, color:"#FDFCF8", flexShrink:0 }}>
        <div style={{ fontFamily:t.fontDisplay, fontWeight:600, fontSize:16 }}>Penasihat Keuangan AI</div>
        <div style={{ fontSize:12, opacity:0.65, marginTop:2 }}>Gemini 3.1 Flash-Lite · Menganalisis data keuangan kamu secara langsung</div>
      </div>

      {/* Chat history */}
      <div style={{ flex:1, overflowY:"auto", marginBottom:14 }}>
        {chat.length === 0 ? (
          <>
            <div style={{ fontSize:12.5, color:t.textMuted, marginBottom:12, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.03em" }}>Coba tanyakan</div>
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              {contohPertanyaan.map((q,i) => (
                <button key={i} className="btn-press" onClick={()=>tanya(q)} style={{
                  textAlign:"left", padding:"12px 16px", borderRadius:9,
                  border:`1.5px solid ${t.borderSoft}`, background:t.surface, color:t.text,
                  fontSize:13.5, cursor:"pointer", fontWeight:500,
                }}>{q}</button>
              ))}
            </div>
          </>
        ) : (
          chat.map((m, i) => (
            <div key={i} style={{
              marginBottom:12,
              display:"flex",
              justifyContent: m.role==="user" ? "flex-end" : "flex-start",
            }}>
              <div style={{
                maxWidth:"85%", padding:"11px 15px", borderRadius:12,
                background: m.role==="user" ? t.sidebarBg : t.surface,
                color: m.role==="user" ? "#FDFCF8" : t.text,
                fontSize:13.5, lineHeight:1.65,
                boxShadow: m.role==="assistant" ? t.cardShadow : "none",
                border: m.role==="assistant" ? `1px solid ${t.borderSoft}` : "none",
                borderBottomRightRadius: m.role==="user" ? 3 : 12,
                borderBottomLeftRadius: m.role==="assistant" ? 3 : 12,
                whiteSpace:"pre-wrap",
              }}>
                {m.content}
              </div>
            </div>
          ))
        )}
        {loading && (
          <div style={{ display:"flex", gap:4, padding:"12px 14px" }}>
            {[0,1,2].map(i => (
              <div key={i} style={{ width:7, height:7, borderRadius:"50%", background:t.gold,
                animation:`bounce 1.2s ${i*0.2}s infinite` }} />
            ))}
          </div>
        )}
      </div>

      {/* Input */}
      <div style={{ display:"flex", gap:8, flexShrink:0 }}>
        <input
          placeholder="Tanya soal keuangan kamu..."
          value={pertanyaan}
          onChange={e=>setPertanyaan(e.target.value)}
          onKeyDown={e=>e.key==="Enter"&&tanya()}
          style={{ ...inp, flex:1 }}
        />
        <button className="btn-press" onClick={()=>tanya()} disabled={loading||!pertanyaan.trim()} style={{
          padding:"11px 18px", borderRadius:9, border:"none",
          background:(loading||!pertanyaan.trim())?t.surface2:`linear-gradient(135deg, ${ACCENT_GOLD_L}, ${ACCENT_GOLD})`,
          color:(loading||!pertanyaan.trim())?t.textMuted:"#181820", fontWeight:700, cursor:(loading||!pertanyaan.trim())?"not-allowed":"pointer", fontSize:15,
        }}>↑</button>
      </div>

      <style>{`@keyframes bounce { 0%,80%,100%{transform:translateY(0)} 40%{transform:translateY(-6px)} }`}</style>
    </div>
  );
}

// ── Main App ─────────────────────────────────────────────────
export default function App() {
  const [dark, setDark]         = useState(()=>localStorage.getItem("theme")==="dark");
  const [token, setToken]       = useState(()=>localStorage.getItem("sb_token"));
  const [email, setEmail]       = useState(()=>localStorage.getItem("sb_email")||"");
  const [transaksi, setTx]      = useState([]);
  const [dompet, setDompet]     = useState([]);
  const [aktivDompetId, setAktivDompetId] = useState(null);
  const [loading, setLoading]   = useState(false);
  const [toast, setToast]       = useState({ msg:"", type:"ok" });
  const [showForm, setShowForm] = useState(false);
  const [tab, setTab]           = useState("dashboard");
  const [filterTipe, setFilter] = useState("semua");
  const [editId, setEditId]     = useState(null);
  const [form, setForm]         = useState({ tipe:"pengeluaran", kategori:"", jumlah:"", catatan:"", tanggal:today(), dompet_id:"" });
  const [showScan, setShowScan] = useState(false);
  const [showVoice, setShowVoice] = useState(false);
  const [showExport, setShowExport] = useState(false);

  const th = tokens(dark);
  const inp = mkInp(th);

  const toggleDark = () => {
    const next = !dark;
    setDark(next);
    localStorage.setItem("theme", next ? "dark" : "light");
  };

  const showToast = (msg, type="ok") => { setToast({ msg, type }); setTimeout(()=>setToast({ msg:"", type:"ok" }), 2500); };

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    Promise.all([
      sb.fetchTransaksi(token),
      sb.fetchDompet(token),
    ]).then(([tx, dm]) => {
      setTx(Array.isArray(tx) ? tx : []);
      setDompet(Array.isArray(dm) ? dm : []);
    }).catch(()=>showToast("Gagal memuat","error")).finally(()=>setLoading(false));
  }, [token]);

  const reloadDompet = () => {
    sb.fetchDompet(token).then(d=>setDompet(Array.isArray(d)?d:[]));
    sb.fetchTransaksi(token).then(d=>setTx(Array.isArray(d)?d:[]));
  };

  const handleAuth   = (t,e) => { setToken(t); setEmail(e); };
  const handleLogout = async () => { await sb.signOut(token); localStorage.clear(); setToken(null); setEmail(""); setTx([]); };
  const resetForm    = () => { setForm({ tipe:"pengeluaran", kategori:"", jumlah:"", catatan:"", tanggal:today(), dompet_id: aktivDompetId||"" }); setEditId(null); setShowForm(false); };

  const handleHasilScan = (hasil) => {
    // Validasi kategori dari AI cocok dengan daftar kategori yang ada
    const kategoriValid = CATS.pengeluaran.includes(hasil.kategori) ? hasil.kategori : "Belanja";
    setForm(f => ({
      ...f,
      tipe: "pengeluaran",
      kategori: kategoriValid,
      jumlah: hasil.total ? String(hasil.total) : "",
      catatan: [hasil.merchant, hasil.catatan].filter(Boolean).join(" — "),
      tanggal: hasil.tanggal || today(),
    }));
    setShowScan(false);
    setShowForm(true);
    setTab("transaksi");
    showToast("✨ Struk berhasil dibaca! Cek & simpan.");
  };

  const handleHasilVoice = (hasil) => {
    const kategoriValid = CATS[hasil.tipe]?.includes(hasil.kategori) ? hasil.kategori : (hasil.tipe === "pemasukan" ? "Lainnya" : "Belanja");
    setForm(f => ({
      ...f,
      tipe: hasil.tipe === "pemasukan" ? "pemasukan" : "pengeluaran",
      kategori: kategoriValid,
      jumlah: hasil.jumlah ? String(hasil.jumlah) : "",
      catatan: hasil.catatan || "",
      tanggal: today(),
    }));
    setShowVoice(false);
    setShowForm(true);
    setTab("transaksi");
    showToast("✨ Ucapan berhasil dicatat! Cek & simpan.");
  };

  const handleSubmit = async () => {
    if (!form.kategori||!form.jumlah||!form.tanggal) { showToast("Lengkapi semua field!","error"); return; }
    const payload = { ...form, jumlah:Number(form.jumlah) };
    setLoading(true);
    try {
      if (editId) { await sb.update(token,editId,payload); setTx(prev=>prev.map(t=>t.id===editId?{...t,...payload}:t)); showToast("Transaksi diperbarui ✓"); }
      else { const r = await sb.insert(token,payload); if (r?.[0]) setTx(prev=>[r[0],...prev]); showToast("Transaksi disimpan ✓"); }
      resetForm();
    } catch { showToast("Gagal menyimpan","error"); }
    setLoading(false);
  };

  const handleDelete = async (id) => { if (!confirm("Hapus?")) return; await sb.remove(token,id); setTx(prev=>prev.filter(t=>t.id!==id)); showToast("Dihapus"); };
  const handleEdit   = (t) => { setForm({ tipe:t.tipe, kategori:t.kategori, jumlah:t.jumlah, catatan:t.catatan||"", tanggal:t.tanggal, dompet_id:t.dompet_id||"" }); setEditId(t.id); setShowForm(true); setTab("transaksi"); };

  const summary = useMemo(() => {
    const masuk = transaksi.filter(t=>t.tipe==="pemasukan").reduce((s,t)=>s+t.jumlah,0);
    const keluar = transaksi.filter(t=>t.tipe==="pengeluaran").reduce((s,t)=>s+t.jumlah,0);
    return { masuk, keluar, saldo:masuk-keluar };
  }, [transaksi]);

  const filtered = transaksi
    .filter(t=>filterTipe==="semua"||t.tipe===filterTipe)
    .filter(t=>!aktivDompetId||t.dompet_id===aktivDompetId);
  const TABS = [
    { id:"dashboard", label:"Ringkasan", icon:"◧" },
    { id:"dompet",    label:"Dompet",    icon:"◈" },
    { id:"budget",    label:"Anggaran",  icon:"◎" },
    { id:"prediksi",  label:"Proyeksi",  icon:"◆" },
    { id:"ai",        label:"Penasihat AI", icon:"✦" },
    { id:"transaksi", label:"Transaksi", icon:"☰" },
  ];

  if (!token) return (
    <ThemeCtx.Provider value={{ dark }}>
      <FontLoader />
      <GlobalStyles dark={dark} />
      <AuthScreen onAuth={handleAuth} />
    </ThemeCtx.Provider>
  );

  return (
    <ThemeCtx.Provider value={{ dark }}>
      <FontLoader />
      <GlobalStyles dark={dark} />
      <div className="theme-transition" style={{ minHeight:"100vh", background:th.bg, fontFamily:th.fontBody, color:th.text }}>
        <Toast msg={toast.msg} type={toast.type} />

        {/* ══════════ SIDEBAR (Desktop) ══════════ */}
        <div className="desktop-sidebar" style={{
          position:"fixed", left:0, top:0, bottom:0, width:236,
          background:`linear-gradient(180deg, ${th.sidebarBg} 0%, ${th.sidebarBg2} 100%)`,
          display:"flex", flexDirection:"column", zIndex:40,
          borderRight:`1px solid rgba(255,255,255,0.06)`,
        }}>
          {/* Brand mark */}
          <div style={{ padding:"28px 24px 20px", borderBottom:"1px solid rgba(255,255,255,0.07)" }}>
            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              <div style={{
                width:34, height:34, borderRadius:8, flexShrink:0,
                background:`linear-gradient(135deg, ${ACCENT_GOLD_L}, ${ACCENT_GOLD})`,
                display:"flex", alignItems:"center", justifyContent:"center",
                fontFamily:th.fontDisplay, fontWeight:700, fontSize:17, color:"#181820",
              }}>D</div>
              <div>
                <div style={{ fontFamily:th.fontDisplay, fontWeight:600, fontSize:16.5, color:th.sidebarTextActive, letterSpacing:"-0.01em" }}>Dompet Saya</div>
                <div style={{ fontSize:10.5, color:th.sidebarText, letterSpacing:"0.04em", textTransform:"uppercase", marginTop:1 }}>Buku Kas Digital</div>
              </div>
            </div>
          </div>

          {/* Nav items */}
          <nav style={{ flex:1, padding:"16px 12px", overflowY:"auto" }}>
            {TABS.map(tb => (
              <button key={tb.id} className={`sidebar-item ${tab===tb.id ? "active" : ""}`} onClick={()=>setTab(tb.id)} style={{
                width:"100%", display:"flex", alignItems:"center", gap:12,
                padding:"10px 14px", marginBottom:2, borderRadius:8, border:"none",
                background: tab===tb.id ? "rgba(255,255,255,0.06)" : "transparent",
                color: tab===tb.id ? th.sidebarTextActive : th.sidebarText,
                fontWeight: tab===tb.id ? 600 : 500, fontSize:13.5, cursor:"pointer",
                textAlign:"left", fontFamily:th.fontBody,
              }}>
                <span style={{ fontSize:15, opacity: tab===tb.id ? 1 : 0.6, width:18, textAlign:"center", color: tab===tb.id ? ACCENT_GOLD_L : "inherit" }}>{tb.icon}</span>
                {tb.label}
              </button>
            ))}
          </nav>

          {/* Bottom: user + dark toggle + logout */}
          <div style={{ padding:"14px 16px 18px", borderTop:"1px solid rgba(255,255,255,0.07)" }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12 }}>
              <div style={{ minWidth:0, flex:1 }}>
                <div style={{ fontSize:10, color:th.sidebarText, opacity:0.6, textTransform:"uppercase", letterSpacing:"0.04em" }}>Masuk sebagai</div>
                <div style={{ fontSize:12, color:th.sidebarTextActive, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", marginTop:1 }}>{email}</div>
              </div>
              <DarkToggle dark={dark} onToggle={toggleDark} />
            </div>
            <button className="btn-press" onClick={handleLogout} style={{
              width:"100%", padding:"8px", borderRadius:7, border:"1px solid rgba(255,255,255,0.1)",
              background:"transparent", color:th.sidebarText, fontWeight:600, fontSize:12, cursor:"pointer",
            }}>Keluar</button>
          </div>
        </div>

        {/* ══════════ MAIN CONTENT ══════════ */}
        <div className="main-content-area" style={{ marginLeft:236, minHeight:"100vh" }}>

          {/* Top bar: saldo ledger-style + tombol tambah */}
          <div style={{ background:th.bgPaper, borderBottom:`1px solid ${th.border}`, padding:"22px 32px" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-end", flexWrap:"wrap", gap:16 }}>
              <div style={{ display:"flex", gap:36, flexWrap:"wrap" }}>
                <div>
                  <div style={{ fontSize:11, color:th.textMuted, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:4 }}>Total Saldo</div>
                  <div className="num-tabular" style={{ fontFamily:th.fontMono, fontSize:30, fontWeight:700, color:th.text, lineHeight:1 }}>
                    {loading && transaksi.length===0 ? (
                      <div className="skeleton" style={{ height:30, width:150, borderRadius:6 }} />
                    ) : (
                      <AnimatedNumber value={summary.saldo} />
                    )}
                  </div>
                </div>
                <div style={{ borderLeft:`1px solid ${th.border}`, paddingLeft:36 }}>
                  <div style={{ fontSize:11, color:th.textMuted, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:4 }}>Pemasukan</div>
                  <div className="num-tabular" style={{ fontFamily:th.fontMono, fontSize:18, fontWeight:600, color:th.green }}><AnimatedNumber value={summary.masuk} /></div>
                </div>
                <div>
                  <div style={{ fontSize:11, color:th.textMuted, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:4 }}>Pengeluaran</div>
                  <div className="num-tabular" style={{ fontFamily:th.fontMono, fontSize:18, fontWeight:600, color:th.red }}><AnimatedNumber value={summary.keluar} /></div>
                </div>
              </div>

              <button className="btn-press" onClick={()=>{ setShowForm(!showForm); setEditId(null); setForm({ tipe:"pengeluaran", kategori:"", jumlah:"", catatan:"", tanggal:today(), dompet_id: aktivDompetId||"" }); setTab("transaksi"); }}
                style={{
                  background:`linear-gradient(135deg, ${ACCENT_GOLD_L}, ${ACCENT_GOLD})`, border:"none", color:"#181820",
                  borderRadius:8, padding:"11px 20px", fontSize:13.5, cursor:"pointer", fontWeight:700,
                  display:"flex", alignItems:"center", gap:7, boxShadow:`0 2px 8px ${dark?"rgba(212,160,23,0.25)":"rgba(184,134,11,0.2)"}`,
                }}>
                <span style={{ fontSize:16, lineHeight:1 }}>+</span> Catat Transaksi
              </button>
            </div>

            {/* Mobile-only page title (sidebar hidden) */}
            <div className="mobile-bottomnav" style={{ display:"none" }} />
          </div>

          {/* Content body */}
          <div style={{ padding:"28px 32px 100px", maxWidth:920 }}>

            {/* Form */}
            {showForm && (
              <div className="card-enter" style={{ background:th.surface, borderRadius:14, padding:22, marginBottom:22, boxShadow:th.cardShadow, border:`1px solid ${th.borderSoft}` }}>
                <div style={{ fontFamily:th.fontDisplay, fontWeight:600, fontSize:17, marginBottom:16, color:th.text }}>{editId?"Ubah Transaksi":"Transaksi Baru"}</div>

                {!editId && (
                  <div style={{ display:"flex", gap:8, marginBottom:16 }}>
                    <button className="btn-press" onClick={()=>setShowScan(true)} style={{
                      flex:1, padding:"11px 8px", borderRadius:9, border:`1.5px dashed ${dark?"#3a4a5c":"#B8C4D4"}`,
                      background: dark ? "#16222e" : "#F0F5FA", color: dark ? "#7FB0DD" : "#3D6E96",
                      fontWeight:600, fontSize:12.5, cursor:"pointer",
                      display:"flex", alignItems:"center", justifyContent:"center", gap:6,
                    }}>
                      📸 Scan Struk
                    </button>
                    <button className="btn-press" onClick={()=>setShowVoice(true)} style={{
                      flex:1, padding:"11px 8px", borderRadius:9, border:`1.5px dashed ${dark?"#4a3a5c":"#D4C4E8"}`,
                      background: dark ? "#241a2e" : "#F7F0FA", color: dark ? "#C79FE8" : "#7A4E9E",
                      fontWeight:600, fontSize:12.5, cursor:"pointer",
                      display:"flex", alignItems:"center", justifyContent:"center", gap:6,
                    }}>
                      🎙️ Catat Suara
                    </button>
                  </div>
                )}

                <div style={{ display:"flex", gap:8, marginBottom:12 }}>
                  {["pengeluaran","pemasukan"].map(tp=>(
                    <button key={tp} className="btn-press" onClick={()=>setForm(f=>({...f,tipe:tp,kategori:""}))} style={{
                      flex:1, padding:"10px", borderRadius:9, border:"1.5px solid",
                      borderColor: form.tipe===tp ? (tp==="pemasukan"?th.green:th.red) : th.border,
                      background: form.tipe===tp ? (tp==="pemasukan" ? (dark?"#0d2b1e":"#EDF7F1") : (dark?"#301414":"#FBEEEE")) : th.surface2,
                      color: form.tipe===tp ? (tp==="pemasukan"?th.green:th.red) : th.textMuted,
                      fontWeight:600, fontSize:13, cursor:"pointer",
                    }}>
                      {tp==="pemasukan"?"↑ Pemasukan":"↓ Pengeluaran"}
                    </button>
                  ))}
                </div>
                <select value={form.kategori} onChange={e=>setForm(f=>({...f,kategori:e.target.value}))} style={{ ...inp, marginBottom:10, appearance:"none" }}>
                  <option value="">Pilih Kategori</option>
                  {CATS[form.tipe].map(k=><option key={k}>{k}</option>)}
                </select>
                <input type="number" placeholder="Jumlah (Rp)" value={form.jumlah} onChange={e=>setForm(f=>({...f,jumlah:e.target.value}))} style={{ ...inp, marginBottom:10, fontFamily:th.fontMono }} />
                <input type="text" placeholder="Catatan (opsional)" value={form.catatan} onChange={e=>setForm(f=>({...f,catatan:e.target.value}))} style={{ ...inp, marginBottom:10 }} />
                {dompet.length > 0 && (
                  <select value={form.dompet_id} onChange={e=>setForm(f=>({...f,dompet_id:e.target.value}))} style={{ ...inp, marginBottom:10, appearance:"none" }}>
                    <option value="">Pilih Dompet (opsional)</option>
                    {dompet.map(d=><option key={d.id} value={d.id}>{d.ikon} {d.nama}</option>)}
                  </select>
                )}
                <input type="date" value={form.tanggal} onChange={e=>setForm(f=>({...f,tanggal:e.target.value}))} style={{ ...inp, marginBottom:18, colorScheme: dark?"dark":"light" }} />
                <div style={{ display:"flex", gap:8 }}>
                  <button className="btn-press" onClick={resetForm} style={{ flex:1, padding:12, borderRadius:9, border:`1.5px solid ${th.border}`, background:th.surface2, color:th.textSub, fontWeight:600, cursor:"pointer", fontSize:14 }}>Batal</button>
                  <button className="btn-press" onClick={handleSubmit} disabled={loading} style={{
                    flex:2, padding:12, borderRadius:9, border:"none",
                    background: loading ? th.textMuted : `linear-gradient(135deg, ${ACCENT_GOLD_L}, ${ACCENT_GOLD})`,
                    color:"#181820", fontWeight:700, cursor:"pointer", fontSize:14,
                  }}>
                    {loading?"Menyimpan...":editId?"Simpan Perubahan":"Simpan"}
                  </button>
                </div>
              </div>
            )}

            <div key={tab} className="tab-content">
              {/* Tab: Grafik */}
              {tab==="dashboard" && (loading && transaksi.length===0 ? (
                <div><SkeletonChart /><SkeletonChart /><SkeletonChart /></div>
              ) : <TabGrafik transaksi={transaksi} />)}

              {/* Tab: Dompet */}
              {tab==="dompet" && <TabDompet dompet={dompet} transaksi={transaksi} token={token} showToast={showToast} onDompetChange={reloadDompet} aktivDompetId={aktivDompetId} setAktivDompetId={setAktivDompetId} />}

              {/* Tab: Budget */}
              {tab==="budget" && <TabBudget transaksi={transaksi} token={token} showToast={showToast} />}

              {/* Tab: Prediksi */}
              {tab==="prediksi" && <TabPrediksi transaksi={transaksi} />}

              {/* Tab: AI */}
              {tab==="ai" && <TabAI transaksi={transaksi} />}

              {/* Tab: Transaksi */}
              {tab==="transaksi" && (
                <div>
                  <div style={{ display:"flex", gap:8, marginBottom:18, alignItems:"center" }}>
                    <div style={{ display:"flex", gap:8, flex:1, overflowX:"auto" }}>
                      {["semua","pemasukan","pengeluaran"].map(f=>(
                        <button key={f} className="btn-press" onClick={()=>setFilter(f)} style={{
                          padding:"7px 14px", borderRadius:7, border:"1.5px solid", flexShrink:0,
                          borderColor: filterTipe===f ? ACCENT_GOLD : th.border,
                          background: filterTipe===f ? (dark?"rgba(212,160,23,0.12)":"rgba(184,134,11,0.08)") : th.surface,
                          color: filterTipe===f ? th.gold : th.textSub,
                          fontWeight:600, fontSize:12, cursor:"pointer",
                        }}>
                          {f==="semua"?"Semua":f==="pemasukan"?"↑ Masuk":"↓ Keluar"}
                        </button>
                      ))}
                    </div>
                    <button className="btn-press" onClick={()=>setShowExport(true)} style={{
                      padding:"7px 14px", borderRadius:7, border:`1.5px solid ${th.green}`, flexShrink:0,
                      background: dark ? "rgba(45,138,99,0.12)" : "rgba(27,94,66,0.06)", color:th.green,
                      fontWeight:600, fontSize:12, cursor:"pointer",
                      display:"flex", alignItems:"center", gap:5,
                    }}>⇩ Export</button>
                  </div>
                  {loading && transaksi.length===0 ? (
                    <><SkeletonCard /><SkeletonCard /><SkeletonCard /></>
                  ) : filtered.length===0 ? (
                    <EmptyState icon="☰" title="Belum ada transaksi" subtitle="Klik 'Catat Transaksi' di atas untuk menambahkan" />
                  ) : filtered.map((tx,i)=>(
                    <div key={tx.id} className="list-item" style={{
                      animationDelay:`${Math.min(i*0.04,0.3)}s`, animationFillMode:"backwards",
                      background:th.surface, borderRadius:11, padding:"14px 16px", marginBottom:8,
                      boxShadow:th.cardShadow, display:"flex", alignItems:"center", gap:12,
                      border:`1px solid ${th.borderSoft}`,
                    }}>
                      <div style={{ fontSize:22 }}>{ICONS[tx.kategori]||"📦"}</div>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontWeight:600, fontSize:14, color:th.text }}>{tx.kategori}</div>
                        <div style={{ fontSize:12, color:th.textMuted, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                          {tx.catatan||"—"} · {new Date(tx.tanggal).toLocaleDateString("id-ID",{day:"numeric",month:"short",year:"numeric"})}
                        </div>
                        {tx.dompet_id && (() => {
                          const d = dompet.find(d=>d.id===tx.dompet_id);
                          return d ? <span style={{ fontSize:10, background:d.warna+"1c", color:d.warna, padding:"2px 7px", borderRadius:5, fontWeight:600, display:"inline-block", marginTop:4 }}>{d.ikon} {d.nama}</span> : null;
                        })()}
                      </div>
                      <div style={{ textAlign:"right" }}>
                        <div className="num-tabular" style={{ fontFamily:th.fontMono, fontWeight:700, fontSize:14, color:tx.tipe==="pemasukan"?th.green:th.red }}>
                          {tx.tipe==="pemasukan"?"+":"−"}{formatRp(tx.jumlah)}
                        </div>
                        <div style={{ display:"flex", gap:6, marginTop:6, justifyContent:"flex-end" }}>
                          <button className="btn-press" onClick={()=>handleEdit(tx)} style={{ fontSize:11.5, background:th.surface2, border:"none", borderRadius:5, padding:"3px 8px", cursor:"pointer", color:th.textSub, fontWeight:600 }}>Edit</button>
                          <button className="btn-press" onClick={()=>handleDelete(tx.id)} style={{ fontSize:11.5, background: dark?"rgba(184,69,69,0.12)":"rgba(140,47,47,0.08)", border:"none", borderRadius:5, padding:"3px 8px", cursor:"pointer", color:th.red, fontWeight:600 }}>Hapus</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ══════════ BOTTOM NAV (Mobile only) ══════════ */}
        <div className="mobile-bottomnav" style={{
          display:"none", position:"fixed", left:0, right:0, bottom:0, zIndex:40,
          background:th.sidebarBg, borderTop:"1px solid rgba(255,255,255,0.08)",
          padding:"8px 4px calc(8px + env(safe-area-inset-bottom))",
          justifyContent:"space-around", alignItems:"center",
        }}>
          {TABS.map(tb => (
            <button key={tb.id} className="btn-press" onClick={()=>setTab(tb.id)} style={{
              display:"flex", flexDirection:"column", alignItems:"center", gap:2,
              background:"transparent", border:"none", cursor:"pointer",
              color: tab===tb.id ? ACCENT_GOLD_L : th.sidebarText, padding:"4px 6px", flex:1,
            }}>
              <span style={{ fontSize:17 }}>{tb.icon}</span>
              <span style={{ fontSize:9.5, fontWeight:600 }}>{tb.label}</span>
            </button>
          ))}
        </div>

        {showScan && <ScanStrukModal onClose={()=>setShowScan(false)} onHasil={handleHasilScan} />}
        {showVoice && <VoiceInputModal onClose={()=>setShowVoice(false)} onHasil={handleHasilVoice} />}
        {showExport && <ExportModal transaksi={transaksi} dompet={dompet} onClose={()=>setShowExport(false)} showToast={showToast} />}
      </div>
    </ThemeCtx.Provider>
  );
}
