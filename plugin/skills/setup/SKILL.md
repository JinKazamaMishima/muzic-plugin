---
description: First-time setup of the muzic plugin — where the analysis API is and its password. Use when the user runs /muzic:setup, when analyze_song fails with a connection or password error, or when muzic_health reports it is not reachable or the password is rejected.
disable-model-invocation: true
---

# Set up muzic

The plugin talks to a Muzic analysis API. It reads its settings, first match
wins, from the environment (`MUZIC_API_URL`, `MUZIC_API_PASSWORD`), then
from `~/.muzic.json`, then a built-in default address with no password.

1. Ask for the API address if the user has one (otherwise keep the default)
   and for the password. Do not echo the password back.
2. Write `~/.muzic.json` with exactly:
   `{"url": "<address>", "password": "<password>"}`
   Create the file if it does not exist; overwrite it if it does.
3. Call `muzic_health` and show the result. Reachable and password accepted
   means done: tell the user to try `/muzic:listen <path to a track>`.
4. If it is not reachable, the address is wrong or the service is down; if the
   password is rejected, ask for it again. Large files: the API caps uploads
   (50 MB by default); the plugin shrinks bigger files to mp3 when `ffmpeg` is
   installed, otherwise ask the user to export an mp3.
