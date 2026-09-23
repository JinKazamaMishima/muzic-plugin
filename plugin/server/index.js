#!/usr/bin/env node
// muzic — MCP server (stdio). Dependency-free: Node 18+ only.
//
// Tools:
//   analyze_song  — upload a track to the Muzic API and return its profile
//                   (tempo, key, chords with timing, energy, mood, genre,
//                   melody, loudness) plus a bar-by-bar chord chart.
//   muzic_health  — is the API reachable, and is the password accepted?
//
// Settings, first match wins:
//   env MUZIC_API_URL / MUZIC_API_PASSWORD
//   ~/.muzic.json   {"url": "...", "password": "..."}
//   built-in default URL, no password
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const VERSION = "1.0.0";
const DEFAULT_URL = "https://muzic-production.up.railway.app";   // the hosted API; override with MUZIC_API_URL
const MAX_UPLOAD_MB_DEFAULT = 50;      // the API's own default cap
const ANALYSIS_TIMEOUT_MS = 10 * 60 * 1000;
const AUDIO_EXT = new Set([".mp3", ".wav", ".flac", ".ogg", ".m4a", ".aac", ".wma"]);

// ---------------------------------------------------------------- settings
function readSettings() {
  let file = {};
  try {
    file = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".muzic.json"), "utf8"));
  } catch (_) { /* no file, or unreadable: fine */ }
  const url = (process.env.MUZIC_API_URL || file.url || DEFAULT_URL).replace(/\/+$/, "");
  const password = process.env.MUZIC_API_PASSWORD ?? file.password ?? "";
  const maxMb = Number(process.env.MUZIC_MAX_UPLOAD_MB || file.max_upload_mb || MAX_UPLOAD_MB_DEFAULT);
  return { url, password, maxMb, source: process.env.MUZIC_API_URL ? "env" : (file.url ? "~/.muzic.json" : "default") };
}

// ---------------------------------------------------------------- API
let tokenCache = { url: null, password: null, token: "" };

async function login(s) {
  if (!s.password) return "";
  if (tokenCache.url === s.url && tokenCache.password === s.password) return tokenCache.token;
  const r = await fetch(`${s.url}/api/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: s.password }), signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw new Error(`login failed: HTTP ${r.status} ${await r.text()}`);
  const { token } = await r.json();
  tokenCache = { url: s.url, password: s.password, token: token || "" };
  return tokenCache.token;
}

async function health(s) {
  const out = { url: s.url, settings_from: s.source };
  const r = await fetch(`${s.url}/api/health`, { signal: AbortSignal.timeout(20000) });
  out.reachable = r.ok;
  if (!r.ok) return out;
  try {
    const token = await login(s);
    const c = await fetch(`${s.url}/api/auth/check`, {
      headers: token ? { authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(20000),
    });
    out.authenticated = c.ok;
    if (!c.ok) out.auth_error = `HTTP ${c.status}`;
  } catch (e) { out.authenticated = false; out.auth_error = String(e.message || e); }
  return out;
}

function hasFfmpeg() {
  try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); return true; } catch (_) { return false; }
}

// A big WAV bounce does not need to travel: the analysis is happy with a mono mp3.
function shrink(filePath) {
  const out = path.join(os.tmpdir(), `muzic-${process.pid}-${Date.now()}.mp3`);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", filePath, "-vn", "-ac", "1",
    "-ar", "44100", "-b:a", "128k", out], { stdio: "ignore" });
  return out;
}

async function analyze(s, filePath) {
  const abs = path.resolve(filePath.replace(/^~(?=$|\/)/, os.homedir()));
  if (!fs.existsSync(abs)) throw new Error(`no such file: ${abs}`);
  const ext = path.extname(abs).toLowerCase();
  if (!AUDIO_EXT.has(ext)) throw new Error(`unsupported format ${ext}; use ${[...AUDIO_EXT].join(", ")}`);
  let upload = abs, note = "";
  const mb = fs.statSync(abs).size / 1048576;
  if (mb > s.maxMb) {
    if (!hasFfmpeg()) throw new Error(`${mb.toFixed(1)} MB is over the ${s.maxMb} MB upload cap and ffmpeg is not installed to shrink it — export the track as mp3 and try again`);
    upload = shrink(abs);
    note = `(${mb.toFixed(1)} MB ${ext} shrunk to a mono mp3 for upload)`;
  }
  try {
    const token = await login(s);
    const form = new FormData();
    form.append("file", new Blob([fs.readFileSync(upload)]), path.basename(upload));
    const r = await fetch(`${s.url}/api/analyze`, {
      method: "POST", body: form, headers: token ? { authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(ANALYSIS_TIMEOUT_MS),
    });
    if (!r.ok) throw new Error(`analyze failed: HTTP ${r.status} ${(await r.text()).slice(0, 300)}`);
    const profile = await r.json();
    return { profile, note };
  } finally {
    if (upload !== abs) fs.rmSync(upload, { force: true });
  }
}

// ---------------------------------------------------------------- summary
function fmtTime(sec) {
  const m = Math.floor(sec / 60), s = Math.round(sec - m * 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function chordAt(segments, t) {
  for (const seg of segments) if (t >= seg.start && t < seg.end) return seg.chord;
  return null;
}

// Bar-by-bar chart in 4/4 (the API does not report meter); one line per 4 bars.
function chordChart(profile) {
  const bpm = profile.tempo && profile.tempo.bpm;
  const segs = (profile.chords && profile.chords.segments) || [];
  const dur = profile.duration_seconds || (segs.length ? segs[segs.length - 1].end : 0);
  if (!bpm || !segs.length || !dur) return "";
  const bar = 4 * 60 / bpm;
  const bars = Math.max(1, Math.round(dur / bar));
  const lines = [];
  for (let b = 0; b < bars; b += 4) {
    const cells = [];
    for (let i = b; i < Math.min(b + 4, bars); i++) {
      const c = chordAt(segs, (i + 0.5) * bar);
      cells.push(c || "–");
    }
    lines.push(`${String(b + 1).padStart(3)} ${fmtTime(b * bar)}  | ${cells.join(" | ")} |`);
  }
  return lines.join("\n");
}

function energyArc(curve) {
  if (!curve || !curve.length) return "";
  const n = Math.min(10, curve.length), step = curve.length / n, pts = [];
  for (let i = 0; i < n; i++) {
    const slice = curve.slice(Math.floor(i * step), Math.floor((i + 1) * step) || Math.floor(i * step) + 1);
    pts.push(slice.reduce((a, b) => a + b, 0) / slice.length);
  }
  const mx = Math.max(...pts, 1e-9);
  const blocks = " ▁▂▃▄▅▆▇█";
  return pts.map(v => blocks[Math.min(8, Math.round((v / mx) * 8))]).join("");
}

function summarize(profile, note) {
  const p = profile;
  const out = [];
  out.push(`# ${p.filename || "track"}${note ? " " + note : ""}`);
  out.push(`Duration ${fmtTime(p.duration_seconds || 0)}`);
  if (p.tempo) out.push(`Tempo ${Math.round(p.tempo.bpm)} BPM (confidence ${(p.tempo.confidence ?? 0).toFixed(2)}) — meter assumed 4/4`);
  if (p.key) out.push(`Key ${p.key.key} ${p.key.scale} (confidence ${(p.key.confidence ?? 0).toFixed(2)})`);
  if (p.chords && p.chords.unique_chords && p.chords.unique_chords.length)
    out.push(`Chords used: ${p.chords.unique_chords.join(", ")}`);
  if (p.mood && p.mood.tags && p.mood.tags.length) out.push(`Mood: ${p.mood.tags.join(", ")} (valence ${(p.mood.valence ?? 0).toFixed(2)})`);
  if (p.genre && p.genre.tags && p.genre.tags.length) out.push(`Genre: ${p.genre.tags.join(", ")}`);
  if (p.melody) out.push(`Melody: range ${p.melody.range_semitones} semitones, ${p.melody.note_count} notes, ${p.melody.pitch_bend_count} bends`);
  if (p.loudness) out.push(`Loudness: ${(p.loudness.integrated_lufs ?? 0).toFixed(1)} LUFS integrated, dynamic range ${(p.loudness.dynamic_range_db ?? 0).toFixed(1)} dB`);
  if (p.energy) out.push(`Energy: overall ${(p.energy.overall ?? 0).toFixed(2)}, arc over time ${energyArc(p.energy.curve)}`);
  const chart = chordChart(p);
  if (chart) out.push(`\nChord chart (bar · time · 4 bars per line):\n${chart}`);
  if (p.warnings && p.warnings.length) out.push(`\nWarnings: ${p.warnings.join("; ")}`);
  return out.join("\n");
}

// ---------------------------------------------------------------- MCP plumbing
const TOOLS = [
  {
    name: "analyze_song",
    description: "Listen to a track. Uploads an audio file (mp3, wav, flac, ogg, m4a, aac, wma) to the Muzic analysis API and returns tempo, key, the chord progression with timing as a bar-by-bar chart, energy arc, mood, genre, melody range and loudness. Use it whenever the user shares a song file or asks to understand, set up, or match a song.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the audio file (absolute, or starting with ~)." },
        raw: { type: "boolean", description: "Also include the full JSON profile (chord segments with exact start/end seconds, energy curve). Default false." },
      },
      required: ["path"],
    },
  },
  {
    name: "muzic_health",
    description: "Check that the Muzic API is reachable and the configured password is accepted. Use it when analyze_song fails or during first-time setup.",
    inputSchema: { type: "object", properties: {} },
  },
];

async function callTool(name, args) {
  const s = readSettings();
  if (name === "muzic_health") {
    const h = await health(s);
    return `Muzic API ${h.url} (settings from ${h.settings_from}): ${h.reachable ? "reachable" : "NOT reachable"}` +
      (h.reachable ? `, password ${h.authenticated ? "accepted" : "REJECTED" + (h.auth_error ? " (" + h.auth_error + ")" : "")}` : "");
  }
  if (name === "analyze_song") {
    if (!args || typeof args.path !== "string" || !args.path.trim()) throw new Error("path is required");
    const { profile, note } = await analyze(s, args.path.trim());
    let text = summarize(profile, note);
    if (args.raw) text += "\n\nFull profile:\n```json\n" + JSON.stringify(profile, null, 1) + "\n```";
    return text;
  }
  throw new Error(`unknown tool: ${name}`);
}

function send(msg) { process.stdout.write(JSON.stringify(msg) + "\n"); }

async function handle(req) {
  const { id, method, params } = req;
  const reply = (result) => { if (id !== undefined) send({ jsonrpc: "2.0", id, result }); };
  const fail = (code, message) => { if (id !== undefined) send({ jsonrpc: "2.0", id, error: { code, message } }); };
  switch (method) {
    case "initialize":
      return reply({
        protocolVersion: (params && params.protocolVersion) || "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "muzic", version: VERSION },
      });
    case "notifications/initialized":
    case "notifications/cancelled":
      return;
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: TOOLS });
    case "tools/call":
      try {
        const text = await callTool(params && params.name, (params && params.arguments) || {});
        return reply({ content: [{ type: "text", text }] });
      } catch (e) {
        return reply({ content: [{ type: "text", text: `muzic: ${e.message || e}` }], isError: true });
      }
    default:
      if (id !== undefined) return fail(-32601, `method not found: ${method}`);
  }
}

let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let req;
    try { req = JSON.parse(line); } catch (_) { continue; }
    const job = handle(req).catch((e) => process.stderr.write(`muzic server error: ${e.stack || e}\n`));
    pending.add(job); job.finally(() => pending.delete(job));
  }
});
// The client closing stdin means "no more requests", not "drop the ones in flight".
const pending = new Set();
process.stdin.on("end", () => Promise.allSettled([...pending]).then(() => process.exit(0)));
