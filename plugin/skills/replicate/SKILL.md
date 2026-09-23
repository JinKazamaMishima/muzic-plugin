---
description: Rebuild a track's skeleton in Ableton from an audio file — drums as MIDI with the swing, a one-bar drum loop, bass and melody MIDI, chords, sections. Use when the user wants to recreate, remake, reproduce, reverse-engineer or study a song's drums, bass, groove or arrangement, or asks "how do I make this".
---

# Replicate a track

Argument: an audio file path (and optionally the tempo, if the user is sure).

1. Start the job with `replicate_song`. It returns a job id and takes minutes,
   most of it stem separation. Tell the user, then call `replicate_status`
   about every 30 seconds until it says done. Don't start a second job for
   the same file.
2. When done, `replicate_status` saves the MIDI files and the one-bar drum
   loop under `~/Music/muzic/<track>/` and returns the summary. Present it in
   this order: tempo and key; the sections table; the drum grid with the
   swing; the chord list; note counts for bass and melody; the sound hints;
   the file list. Meter is assumed 4/4 — say so, and ask if it isn't.
3. Building it in Live, with SMYLZ Producer's tools, only after the user says
   go, and never over an existing arrangement without asking:
   - `inspect_project` first, then `ableton_action` op `tempo` to set the
     detected BPM if the project is empty or the user agrees.
   - Approved folders: `add_audio` only reads WAVs inside folders approved in
     the SMYLZ dashboard. Ask the user to add `~/Music/muzic` there once.
   - Fetch notes with `part_notes(job_id, part, from_bar, to_bar)`, at most
     32 bars per call. Notes are `[pitch, start_beat, duration_beats,
     velocity]` with start relative to `from_bar`, which is exactly what
     `create_authored_midi` (length = bars × 4, bpm) and `ableton_action`
     `add_midi` (start, length, notes) take. Drum pitches are General MIDI:
     kick 36, snare 38, closed hat 42.
   - Suggested order, one `batch_actions` call: `create_track` "Drums" (midi)
     + `add_midi` with the `drums_loop` part at the section starts, or the
     full `drums` part section by section; `create_track` "Chords" + the
     `chords` part; `create_track` "Bass" + the `bass` part; `create_track`
     "Melody" + the `melody` part; `create_track` "Drum loop" (audio) +
     `add_audio` with `drum_loop.wav` at bar 1 so the user can hear the
     source groove next to the MIDI.
   - Instruments: use `browser_search` / `browser_load` for a Drum Rack and a
     bass instrument if the user wants sound right away; otherwise leave
     the MIDI clips for them to assign.
   - Swing: the summary gives the off-8th lateness and its percentage toward
     a triplet feel; suggest that as the Groove Pool swing amount rather than
     nudging notes.
4. Stems: `replicate_status` with `with_stems: true` downloads drums, bass,
   vocals and other as WAVs. Import them muted (`add_audio`, then `mixer`
   with mute true) as a reference next to the rebuild, or leave them for
   SMYLZ's own Reference Study if the user prefers that workflow.
5. Be honest about limits: chords are major/minor triads only, the melody is
   a single line from the vocal or the "other" stem, drums are kick, snare
   and hat, and nothing here recreates the original sounds — the skeleton
   and the groove, not the patches.
