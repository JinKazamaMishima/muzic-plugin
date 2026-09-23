#!/usr/bin/env node
// muzic — MCP server (stdio). Dependency-free: Node 18+ only.
//
// Tools:
//   analyze_song  — upload a track to the Muzic API and return its profile
//                   (tempo, key, chords with timing, energy, mood, genre,
//                   melody, loudness) plus a bar-by-bar chord chart.
//   muzic_health  — is the API reachable, and is the password accepted?
//   replicate_song   — start a replicate job: stems, drums/bass/melody/chords
//                      as MIDI, sections, sound hints (minutes; poll it).
//   replicate_status — poll a job; when done, fetch the MIDI and loop into a
//                      local folder and return the producer's summary.
//   part_notes       — a bar range of one part as [pitch,start,dur,vel]
//                      notes, ready for SMYLZ create_authored_midi / add_midi.
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

const VERSION = "1.1.0";
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

async function startReplicate(s, filePath, bpm) {
  const abs = path.resolve(filePath.replace(/^~(?=$|\/)/, os.homedir()));
  if (!fs.existsSync(abs)) throw new Error(`no such file: ${abs}`);
  const ext = path.extname(abs).toLowerCase();
  if (!AUDIO_EXT.has(ext)) throw new Error(`unsupported format ${ext}; use ${[...AUDIO_EXT].join(", ")}`);
  let upload = abs, note = "";
  const mb = fs.statSync(abs).size / 1048576;
  if (mb > s.maxMb) {
    if (!hasFfmpeg()) throw new Error(`${mb.toFixed(1)} MB is over the ${s.maxMb} MB upload cap and ffmpeg is not installed to shrink it`);
    upload = shrink(abs); note = `(${mb.toFixed(1)} MB ${ext} shrunk to a mono mp3 for upload)`;
  }
  try {
    const token = await login(s);
    const form = new FormData();
    form.append("file", new Blob([fs.readFileSync(upload)]), path.basename(upload));
    if (bpm) form.append("bpm", String(bpm));
    const r = await fetch(`${s.url}/api/replicate`, {
      method: "POST", body: form, headers: token ? { authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(ANALYSIS_TIMEOUT_MS),
    });
    if (!r.ok) throw new Error(`replicate failed: HTTP ${r.status} ${(await r.text()).slice(0, 300)}`);
    const j = await r.json();
    return { jobId: j.job_id, note, name: path.basename(abs, ext) };
  } finally {
    if (upload !== abs) fs.rmSync(upload, { force: true });
  }
}

async function pollReplicate(s, jobId) {
  const token = await login(s);
  const r = await fetch(`${s.url}/api/replicate/${encodeURIComponent(jobId)}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(60000),
  });
  if (!r.ok) throw new Error(`status failed: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

async function downloadFile(s, jobId, name, dest) {
  const token = await login(s);
  const r = await fetch(`${s.url}/api/replicate/${encodeURIComponent(jobId)}/files/${encodeURIComponent(name)}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(ANALYSIS_TIMEOUT_MS),
  });
  if (!r.ok) throw new Error(`download ${name}: HTTP ${r.status}`);
  fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
  return dest;
}

// Where the MIDI and loops land: a folder Ableton can be pointed at.
function outDirFor(jobStatus, override) {
  const base = override ? override.replace(/^~(?=$|\/)/, os.homedir())
                        : path.join(os.homedir(), "Music", "muzic");
  const name = String(jobStatus.filename || "track").replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "_");
  const dir = path.join(base, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// The job's result is kept on disk next to the files so part_notes can page it.
function resultPath(dir) { return path.join(dir, "muzic-result.json"); }

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

function replicateSummary(res, dir, files, withStems) {
  const out = [];
  const t = res.tempo || {};
  out.push(`# replicate: ${res.filename || path.basename(dir)}`);
  out.push(`Tempo ${t.bpm} BPM (confidence ${t.confidence}), first downbeat at ${t.downbeat_s}s, ${res.bars} bars, ${res.meter}`);
  if (res.key) out.push(`Key ${res.key.key} ${res.key.scale}`);
  if (res.sections && res.sections.length) {
    out.push("\nSections (bar · time · label · energy):");
    for (const sec of res.sections) out.push(`  ${String(sec.start_bar + 1).padStart(3)}–${String(sec.end_bar).padStart(3)}  ${fmtTime(sec.start_s)}  ${sec.label.padEnd(9)} ${sec.energy}`);
  }
  if (res.drums) {
    out.push(`\nDrums: ${res.drums.hits} hits, ${res.drums.note_count} notes, swing ${res.drums.swing} (fraction of a 16th, + = late)`);
    out.push(`Most-repeated 4 bars start at bar ${res.drums.loop.start_bar + 1} (16 steps per bar, K kick / S snare / H hat):`);
    out.push(res.drums.grid_text);
  }
  if (res.chords && res.chords.unique) out.push(`\nChords: ${res.chords.unique.join(", ")} (${(res.chords.segments || []).length} changes)`);
  if (res.bass) out.push(`Bass: ${res.bass.note_count} notes`);
  if (res.melody) out.push(`Melody (from the ${res.melody.source} stem): ${res.melody.note_count} notes`);
  if (res.hints && res.hints.length) out.push("\nSound hints:\n  " + res.hints.join("\n  "));
  out.push(`\nFiles in ${dir}:`);
  for (const f of files) out.push(`  ${f}`);
  if (!withStems) out.push("  (stems not downloaded; call replicate_status again with with_stems: true to fetch drums/bass/vocals/other WAVs)");
  out.push("\nNotes for Ableton: call part_notes(job_id, part, from_bar, to_bar) for drums_loop, drums, bass, melody or chords — they come as [pitch, start_beat, duration_beats, velocity], the shape SMYLZ create_authored_midi and add_midi take.");
  if (res.warnings && res.warnings.length) out.push(`\nWarnings: ${res.warnings.join("; ")}`);
  out.push(`\n(analysis took ${res.elapsed_s}s)`);
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
    name: "replicate_song",
    description: "Start rebuilding a track's skeleton from an audio file: stems (drums, bass, vocals, other), drums as a MIDI pattern with swing plus a one-bar loop, bass and melody as MIDI, chords as MIDI, sections, and sound hints. Takes minutes; returns a job_id to poll with replicate_status. Use when the user wants to recreate, remake, reproduce, or study a track's drums, bass or arrangement in Ableton.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the audio file (absolute, or starting with ~)." },
        bpm: { type: "number", description: "Known tempo, if the user is sure; otherwise omit and it is detected." },
      },
      required: ["path"],
    },
  },
  {
    name: "replicate_status",
    description: "Poll a replicate job. While running it reports the stage and percent; call it again after ~30 seconds. When done it downloads the MIDI files and the drum loop into a local folder (default ~/Music/muzic/<track>/) and returns the summary: tempo, key, sections, drum grid, chord list, note counts and file paths.",
    inputSchema: {
      type: "object",
      properties: {
        job_id: { type: "string" },
        out_dir: { type: "string", description: "Folder to save into (default ~/Music/muzic). Point Ableton's approved sample folders at it." },
        with_stems: { type: "boolean", description: "Also download the four stem WAVs (large). Default false." },
      },
      required: ["job_id"],
    },
  },
  {
    name: "part_notes",
    description: "A bar range of one transcribed part as notes [pitch, start_beat, duration_beats, velocity], start relative to from_bar, ready to pass to SMYLZ create_authored_midi (length = bars*4) or ableton_action add_midi. Parts: drums_loop (the most-repeated 4 bars), drums, bass, melody, chords. Keep ranges to 32 bars or fewer.",
    inputSchema: {
      type: "object",
      properties: {
        job_id: { type: "string" },
        part: { type: "string", enum: ["drums_loop", "drums", "bass", "melody", "chords"] },
        from_bar: { type: "integer", description: "1-based first bar (default 1)." },
        to_bar: { type: "integer", description: "1-based last bar inclusive (default from_bar + 7)." },
      },
      required: ["job_id", "part"],
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
  if (name === "replicate_song") {
    if (!args || typeof args.path !== "string" || !args.path.trim()) throw new Error("path is required");
    const { jobId, note, name: track } = await startReplicate(s, args.path.trim(), args.bpm);
    return `replicate job ${jobId} started for ${track}${note ? " " + note : ""}. Stems take a few minutes: call replicate_status with this job_id in about 30 seconds, and again until it says done.`;
  }
  if (name === "replicate_status") {
    if (!args || typeof args.job_id !== "string") throw new Error("job_id is required");
    const st = await pollReplicate(s, args.job_id.trim());
    if (st.state === "failed") throw new Error(`job ${args.job_id} failed at ${st.stage}: ${st.error || "unknown error"}`);
    if (st.state !== "done") return `job ${args.job_id}: ${st.state}, ${st.stage} (${st.percent || 0}%). Poll again in ~30 seconds.`;
    const res = st.result || {};
    const dir = outDirFor(st, args.out_dir);
    const want = Object.entries(st.files || {}).filter(([k]) => args.with_stems || !k.startsWith("stem_"));
    const got = [];
    for (const [key, fname] of want) {
      const dest = path.join(dir, key.startsWith("stem_") ? `stem_${fname}` : fname);
      if (!fs.existsSync(dest)) await downloadFile(s, args.job_id.trim(), fname, dest);
      got.push(path.basename(dest));
    }
    res.filename = st.filename;
    res.job_id = args.job_id.trim();
    fs.writeFileSync(resultPath(dir), JSON.stringify(res));
    return replicateSummary(res, dir, got, !!args.with_stems);
  }
  if (name === "part_notes") {
    if (!args || typeof args.job_id !== "string" || !args.part) throw new Error("job_id and part are required");
    const hit = findResult(args.job_id.trim());
    if (!hit) throw new Error(`no downloaded result for job ${args.job_id}; call replicate_status first`);
    const from = Math.max(1, parseInt(args.from_bar || 1, 10));
    const to = Math.min(from + 63, Math.max(from, parseInt(args.to_bar || from + 7, 10)));
    let notes;
    if (args.part === "drums_loop") notes = ((hit.drums || {}).loop || {}).notes || [];
    else if (args.part === "drums") notes = await midiNotes(path.join(hit._dir, "drums.mid"));
    else if (args.part === "bass") notes = (hit.bass || {}).notes || [];
    else if (args.part === "melody") notes = (hit.melody || {}).notes || [];
    else if (args.part === "chords") notes = (hit.chords || {}).notes || [];
    else throw new Error(`unknown part ${args.part}`);
    const a = (from - 1) * 4, b = to * 4;
    const sel = notes.filter(n => n[1] >= a && n[1] < b).map(n => [n[0], +(n[1] - a).toFixed(4), +Math.min(n[2], b - n[1]).toFixed(4), n[3]]);
    return JSON.stringify({ part: args.part, from_bar: from, to_bar: to, length_beats: b - a, bpm: (hit.tempo || {}).bpm, note_count: sel.length, notes: sel });
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

function findResult(jobId) {
  const base = path.join(os.homedir(), "Music", "muzic");
  let dirs = [];
  try { dirs = fs.readdirSync(base).map(d => path.join(base, d)); } catch (_) { return null; }
  for (const d of dirs) {
    try {
      const r = JSON.parse(fs.readFileSync(resultPath(d), "utf8"));
      if (r.job_id === jobId) { r._dir = d; return r; }
    } catch (_) { /* not a result dir */ }
  }
  return null;
}

// Minimal Standard MIDI File reader: one format-0/1 file, note_on/off → notes in beats.
async function midiNotes(file) {
  const buf = fs.readFileSync(file);
  let pos = 0;
  const u32 = () => { const v = buf.readUInt32BE(pos); pos += 4; return v; };
  const u16 = () => { const v = buf.readUInt16BE(pos); pos += 2; return v; };
  if (buf.toString("latin1", 0, 4) !== "MThd") throw new Error("not a MIDI file");
  pos = 8; u16(); const ntracks = u16(); const tpq = u16();
  const notes = []; const open = {};
  for (let t = 0; t < ntracks; t++) {
    if (buf.toString("latin1", pos, pos + 4) !== "MTrk") throw new Error("bad track");
    pos += 4; const len = u32(); const end = pos + len; let tick = 0, status = 0;
    while (pos < end) {
      let delta = 0, b;
      do { b = buf[pos++]; delta = (delta << 7) | (b & 0x7f); } while (b & 0x80);
      tick += delta;
      let ev = buf[pos];
      if (ev & 0x80) { status = ev; pos++; } else { ev = status; }
      const type = ev & 0xf0;
      if (ev === 0xff) { const meta = buf[pos++]; let l = 0; do { b = buf[pos++]; l = (l << 7) | (b & 0x7f); } while (b & 0x80); pos += l; if (meta === 0x2f) break; continue; }
      if (ev === 0xf0 || ev === 0xf7) { let l = 0; do { b = buf[pos++]; l = (l << 7) | (b & 0x7f); } while (b & 0x80); pos += l; continue; }
      const d1 = buf[pos++]; const d2 = (type === 0xc0 || type === 0xd0) ? 0 : buf[pos++];
      if (type === 0x90 && d2 > 0) open[d1] = [tick, d2];
      else if (type === 0x80 || (type === 0x90 && d2 === 0)) {
        if (open[d1]) { const [t0, v] = open[d1]; notes.push([d1, t0 / tpq, Math.max(0.0625, (tick - t0) / tpq), v]); delete open[d1]; }
      }
    }
    pos = end;
  }
  notes.sort((x, y) => x[1] - y[1] || x[0] - y[0]);
  return notes.map(n => [n[0], +n[1].toFixed(4), +n[2].toFixed(4), n[3]]);
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
