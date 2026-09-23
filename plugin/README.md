# muzic — a Claude Code plugin that listens

Give Claude a track and it comes back with tempo, key, the chord progression
bar by bar, the energy arc, mood, genre, melody range and loudness, then
proposes the Ableton project setup and, if your Live set is connected to
Claude Code, applies it on your say-so.

## Install

No GitHub account needed. Open a terminal and run these two lines; they work
whether you use Claude Code in the terminal or in the Claude desktop app, since
plugins are installed for your user:

```bash
claude plugin marketplace add https://github.com/JinKazamaMishima/muzic-plugin.git
claude plugin install muzic@muzic
```

Then restart Claude (or run `/reload-plugins` in an open session) and, in the
chat:

```
/muzic:setup
```

`/muzic:setup` asks for the analysis API address (leave the default unless
you were given one) and its password, writes them to `~/.muzic.json`, and
checks the connection.

Inside a terminal session the same two steps also work as `/plugin marketplace
add …` and `/plugin install muzic@muzic`. In the desktop app those slash
commands only open the Plugins window, so use the terminal lines above.

## Use

```
/muzic:listen ~/Music/bounces/my-track.wav
/muzic:replicate ~/Music/refs/that-track.wav
```

`listen` describes a track in seconds. `replicate` rebuilds its skeleton in
minutes: stems, drums as MIDI with the swing plus a one-bar drum loop, bass
and melody as MIDI, chords, sections and sound hints, saved under
`~/Music/muzic/<track>/` and handed to SMYLZ Producer's tools as note lists.

or just tell Claude "listen to this" with a file path. Supported: mp3, wav,
flac, ogg, m4a, aac, wma. Uploads are capped at 50 MB; if `ffmpeg` is
installed the plugin shrinks bigger bounces to a mono mp3 before sending.

## Tools

- `analyze_song(path, raw?)` — the profile plus a 4/4 chord chart; `raw: true`
  adds the full JSON with chord segments in seconds and the energy curve.
- `replicate_song(path, bpm?)` — start a replicate job (minutes).
- `replicate_status(job_id, out_dir?, with_stems?)` — poll; on completion downloads
  the MIDI and the drum loop (and the stems if asked) and returns the summary.
- `part_notes(job_id, part, from_bar?, to_bar?)` — a bar range of drums_loop, drums,
  bass, melody or chords as `[pitch, start, duration, velocity]` in beats.
- `muzic_health()` — is the API reachable, is the password accepted.

## Where the analysis runs

The heavy lifting (Essentia, Basic Pitch, autochord) runs in the Muzic API,
not on your machine. The plugin is a thin client: Node 18+ and nothing else.
