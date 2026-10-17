# Demo assets (M5 scenario engine and demo feeds)

These clips are committed deliberately (`git add -f`; `*.mp4` is otherwise ignored). Each is a
30 s segment from the M2 validation set, re-encoded to 480p 15 fps. **None of them was recorded in
Karachi, and none is CCTV.** In the product they appear only on `demo_stream` nodes, labelled
SIMULATED LIVE FEED, and the scenario engine runs them through the real detector.

| File | Used for | Source | Licence | Attribution |
|---|---|---|---|---|
| `fire_jamestown_night.mp4` | Korangi fire scenario | archive.org `TomSimpsonJamestownNDFireofDecember92005`, "Jamestown, ND - Fire of December 9, 2005" | [CC BY-NC-SA 2.5](http://creativecommons.org/licenses/by-nc-sa/2.5/) | Tom Simpson. This trimmed, re-encoded segment is shared under the same licence. Non-commercial use only. |
| `smoke_structure_1964.mp4` | Clifton smoke scenario | archive.org `casbcfm_000070`, *Structure Fire Control Tactics* (1964) | [Public Domain Mark 1.0](http://creativecommons.org/publicdomain/mark/1.0/) | California Division of Forestry |
| `street_sunset_traffic.mp4` | Lyari glare scenario (negative) and the idle loop on demo-stream nodes | archive.org `santabarbarastreet`, "Time lapse during sunset on State Street, Santa Barbara" (2005) | [Public Domain](http://creativecommons.org/licenses/publicdomain/) | Tracey Jaquith |

The API serves only files that are listed in this folder (`GET /api/v1/media/{name}`).
