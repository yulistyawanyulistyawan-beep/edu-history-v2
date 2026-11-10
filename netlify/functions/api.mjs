// Edu-History - API terpusat (Netlify Functions v2 + Netlify Blobs)
// Rute: GET /api/config | POST /api/verify | POST /api/result | POST /api/admin
import { getStore } from "@netlify/blobs";

const MINUTES_ALLOWED = [25, 45, 60];
const DEFAULT_TOKEN = "SEJARAH45";

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}

function teacherPass() {
  // Ubah lewat Netlify > Site configuration > Environment variables > TEACHER_PASS
  return (globalThis.process && process.env && process.env.TEACHER_PASS) || "sejarah77";
}

function db() {
  return getStore({ name: "edu-history", consistency: "strong" });
}

async function readConfig(s) {
  const c = (await s.get("config", { type: "json" })) || {};
  return {
    token: typeof c.token === "string" && c.token ? c.token : DEFAULT_TOKEN,
    open: c.open !== false,
    minutes: MINUTES_ALLOWED.includes(c.minutes) ? c.minutes : 45,
    questions: Array.isArray(c.questions) && c.questions.length ? c.questions : null
  };
}

const str = (v, max) => String(v == null ? "" : v).replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);
const int = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(v) || 0)));

function cleanQuestions(list) {
  if (!Array.isArray(list) || list.length < 1 || list.length > 500) return null;
  const out = [];
  for (const it of list) {
    if (!it || typeof it.q !== "string" || !Array.isArray(it.o)) return null;
    if (it.o.length < 2 || it.o.length > 5) return null;
    const o = it.o.map(x => str(x, 300));
    const a = Number(it.a);
    if (!Number.isInteger(a) || a < 0 || a >= o.length) return null;
    out.push({ q: str(it.q, 600), o, a });
  }
  return out;
}

async function listResults(s) {
  const { blobs } = await s.list({ prefix: "results/" });
  const rows = await Promise.all(
    blobs.slice(0, 3000).map(b => s.get(b.key, { type: "json" }).catch(() => null))
  );
  return rows.filter(Boolean).sort((a, b) => (a.ts || 0) - (b.ts || 0));
}

export default async (req) => {
  const url = new URL(req.url);
  const route = url.pathname.replace(/\/+$/, "").split("/").pop();
  const s = db();

  try {
    if (route === "config" && req.method === "GET") {
      const c = await readConfig(s);
      // token TIDAK dikirim ke siswa
      return json({ ok: true, open: c.open, minutes: c.minutes, questions: c.questions });
    }

    if (req.method !== "POST") return json({ ok: false, error: "metode tidak didukung" }, 405);
    let body;
    try { body = await req.json(); } catch (e) { return json({ ok: false, error: "data tidak valid" }, 400); }

    if (route === "verify") {
      const c = await readConfig(s);
      const ok = c.open && str(body.token, 60).toUpperCase() === c.token;
      return json({ ok });
    }

    if (route === "result") {
      const c = await readConfig(s);
      if (!c.open) { /* tetap terima: siswa yang sudah mulai boleh menyelesaikan */ }
      const r = body && body.record;
      if (!r) return json({ ok: false, error: "data kosong" }, 400);
      const id = str(r.id, 40).replace(/[^A-Za-z0-9_-]/g, "") || (Date.now() + "-" + Math.random().toString(36).slice(2, 8));
      const rec = {
        id,
        absen: str(r.absen, 10),
        nama: str(r.nama, 80),
        kelas: str(r.kelas, 40),
        benar: int(r.benar, 0, 1000),
        skor: int(r.skor, 0, 100),
        curang: int(r.curang, 0, 1000),
        waktu: str(r.waktu, 30),
        ts: Date.now()
      };
      if (!rec.nama || !rec.kelas || !rec.absen) return json({ ok: false, error: "identitas kosong" }, 400);
      await s.setJSON("results/" + id, rec);
      return json({ ok: true });
    }

    if (route === "admin") {
      if (str(body.pass, 100) !== teacherPass()) return json({ ok: false, error: "sandi salah" }, 401);
      const c = await readConfig(s);
      const save = async () => s.setJSON("config", c);

      switch (body.action) {
        case "login":
          return json({ ok: true, token: c.token, open: c.open, minutes: c.minutes, qCount: c.questions ? c.questions.length : 0 });
        case "setToken": {
          const t = str(body.token, 40).toUpperCase();
          if (!t) return json({ ok: false, error: "token kosong" }, 400);
          c.token = t; await save();
          return json({ ok: true, token: c.token });
        }
        case "setOpen":
          c.open = !!body.open; await save();
          return json({ ok: true, open: c.open });
        case "setMinutes": {
          const m = Number(body.minutes);
          if (!MINUTES_ALLOWED.includes(m)) return json({ ok: false, error: "durasi tidak valid" }, 400);
          c.minutes = m; await save();
          return json({ ok: true, minutes: c.minutes });
        }
        case "setQuestions": {
          const q = cleanQuestions(body.questions);
          if (!q) return json({ ok: false, error: "format soal tidak valid" }, 400);
          c.questions = q; await save();
          return json({ ok: true, count: q.length });
        }
        case "resetQuestions":
          c.questions = null; await save();
          return json({ ok: true });
        case "results":
          return json({ ok: true, results: await listResults(s) });
        case "clearResults": {
          const { blobs } = await s.list({ prefix: "results/" });
          await Promise.all(blobs.map(b => s.delete(b.key)));
          return json({ ok: true });
        }
        default:
          return json({ ok: false, error: "aksi tidak dikenal" }, 400);
      }
    }

    return json({ ok: false, error: "rute tidak ditemukan" }, 404);
  } catch (e) {
    return json({ ok: false, error: "kesalahan server" }, 500);
  }
};

export const config = { path: "/api/*" };
