# muzic — a Claude Code plugin that listens

Give Claude a track and it comes back with tempo, key, the chord progression
bar by bar, the energy arc, mood, genre, melody range and loudness, then
proposes the Ableton project setup and, if your Live set is connected to
Claude Code, applies it on your say-so.

## Install

No account needed. Inside Claude Code:

```
/plugin marketplace add https://github.com/JinKazamaMishima/muzic-plugin.git
/plugin install muzic@muzic
/muzic:setup
```

`/muzic:setup` asks for the analysis API address (leave the default unless
you were given one) and its password, writes them to `~/.muzic.json`, and
checks the connection.

## Use

```
/muzic:listen ~/Music/bounces/my-track.wav
```

or just tell Claude "listen to this" with a file path. Supported: mp3, wav,
flac, ogg, m4a, aac, wma. Uploads are capped at 50 MB; if `ffmpeg` is
installed the plugin shrinks bigger bounces to a mono mp3 before sending.

## Tools

- `analyze_song(path, raw?)` — the profile plus a 4/4 chord chart; `raw: true`
  adds the full JSON with chord segments in seconds and the energy curve.
- `muzic_health()` — is the API reachable, is the password accepted.

## Where the analysis runs

The heavy lifting (Essentia, Basic Pitch, autochord) runs in the Muzic API,
not on your machine. The plugin is a thin client: Node 18+ and nothing else.
