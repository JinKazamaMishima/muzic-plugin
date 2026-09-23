---
description: Listen to a song and set the project up from it. Use when the user shares an audio file, names a track to analyze, or asks for a song's tempo, key, chords, structure, energy or mood, or asks to set up a DAW project or session around a track.
---

# Listen to a track

Argument: an audio file path. If `$ARGUMENTS` is empty, ask for the file.

1. Call `analyze_song` with the path. If it errors, call `muzic_health` and
   report what it says; if the settings are the problem, point the user to
   `/muzic:setup`.
2. Present the result the way a producer wants it, in this order:
   tempo and key first (one line each), then the chord chart, then the
   energy arc and where the song builds and drops, then mood, genre, melody
   range and loudness. Keep the chart monospaced.
3. Propose the project setup as a short checklist: tempo, key and scale, a
   chord track or markers per section, section markers at the bars where the
   chords or the energy change, and the loudness target. Say that meter is
   assumed 4/4 and ask if it is not.
4. The producer here works in Ableton Live. If Ableton tools are available
   in this session (an Ableton Live MCP server), offer to apply the setup
   and do it only after they confirm: set the session tempo; set the clip key and scale
   where the tools allow; add locators at the section boundaries, named by
   the chord that starts them (verse/chorus if the structure is clear); and
   create a MIDI track with one clip per section holding the chord
   progression as block chords, one per bar, so he can audition the
   harmony against the track. Never touch an existing clip or device, and
   never write into the set unasked. If no Ableton tools are present, give
   the same steps as a checklist to do by hand.
5. If the user wants to rebuild the track rather than describe it — drums, bass and melody as MIDI, the loop, the sections — use `/muzic:replicate` (the `replicate_song` tool), which goes further than this analysis.
6. For a second track, compare: tempo difference, key relationship (same,
   relative, a fifth apart), and whether the energy arcs match — useful for
   mixing, mashups and set building.

The chart is derived from chord segments with the bar length from the
detected tempo; if the tempo confidence is low, say so before trusting the
bar numbers, and offer the raw segments (`raw: true`) with exact seconds.
