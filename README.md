# muzic for Claude Code

A plugin that lets Claude listen to a track: tempo, key, the chord
progression bar by bar, the energy arc, mood, genre, melody range and
loudness, then proposes the Ableton project setup and, if your Live set is
connected to Claude Code, applies it on your say-so.

No GitHub account needed. Inside Claude Code:

```
/plugin marketplace add https://github.com/JinKazamaMishima/muzic-plugin.git
/plugin install muzic@muzic
/muzic:setup
```

`/muzic:setup` asks for the password once and checks the connection. Then:

```
/muzic:listen ~/Music/bounces/my-track.wav
```

Details, tools and troubleshooting: [`plugin/README.md`](plugin/README.md).
The analysis itself runs on a hosted service; the plugin is a thin client
that needs Node 18+ and nothing else.
