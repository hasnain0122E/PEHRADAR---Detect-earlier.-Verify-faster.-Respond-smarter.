# Demo assets (M5 scenario engine, M6B Pakistan-based demo feeds)

These clips are committed deliberately (`git add -f`; `*.mp4` is otherwise ignored). Each is a
30 s segment from the M2 validation set, re-encoded to 480p 15 fps. **None of them was recorded in
Karachi, and none is CCTV.** In the product they appear only on `demo_stream` nodes, labelled
SIMULATED LIVE FEED, and the scenario engine runs them through the real detector.

| File | Used for | Source | Licence | Attribution |
|---|---|---|---|---|
| `fire_jamestown_night.mp4` | Korangi fire scenario | archive.org `TomSimpsonJamestownNDFireofDecember92005`, "Jamestown, ND - Fire of December 9, 2005" | [CC BY-NC-SA 2.5](http://creativecommons.org/licenses/by-nc-sa/2.5/) | Tom Simpson. This trimmed, re-encoded segment is shared under the same licence. Non-commercial use only. |
| `fire_jamestown_night_2.mp4` | SITE fire scenario (M6B; another 30 s segment of the same film) | archive.org `TomSimpsonJamestownNDFireofDecember92005`, "Jamestown, ND - Fire of December 9, 2005" | [CC BY-NC-SA 2.5](http://creativecommons.org/licenses/by-nc-sa/2.5/) | Tom Simpson. This trimmed, re-encoded segment is shared under the same licence. Non-commercial use only. |
| `smoke_structure_1964.mp4` | Clifton smoke scenario | archive.org `casbcfm_000070`, *Structure Fire Control Tactics* (1964) | [Public Domain Mark 1.0](http://creativecommons.org/publicdomain/mark/1.0/) | California Division of Forestry |
| `street_sunset_traffic.mp4` | Lyari glare scenario (negative); until M6B also the idle loop on demo-stream nodes | archive.org `santabarbarastreet`, "Time lapse during sunset on State Street, Santa Barbara" (2005) | [Public Domain](http://creativecommons.org/licenses/publicdomain/) | Tracey Jaquith |

The API serves only files that are listed in this folder (`GET /api/v1/media/{name}`).

## Pakistan-based demo feeds (M6B)

Short segments of openly licensed footage **recorded in Pakistan**, re-encoded to 480p 15 fps
without audio (`seed/feed_library.json` holds the same provenance in machine-readable form).
**None of them was recorded in Karachi, none is CCTV and none is live.** They loop on simulated
`demo_stream` nodes labelled SIMULATED LIVE FEED / Pakistan-based demo footage; each node starts
its loop at a different offset (`seed/assign_feeds.py`). Two of them are also detector input for the M6B lookalike
scenarios (`pk_peshawar_night_road.mp4`, `pk_faisalabad_hotel_lobby.mp4`); the real model rejects both. Segments were chosen to avoid the vlog presenter; public street scenes still show
passers-by as filmed by the original authors.

Licences: the Peace Travels clips are CC BY 3.0 (YouTube Creative Commons, licence-reviewed on
Wikimedia Commons); the Jamshoro clips are CC BY-SA 4.0, so these trimmed segments are shared
under CC BY-SA 4.0 too; the Lahore clip is public domain.

| File | Recorded in | Context | Source | Segment | Licence | Attribution |
|---|---|---|---|---|---|---|
| `pk_peshawar_market_street.mp4` | Peshawar | Market street with pedestrians and motorcycles (daytime) | [Peshawar: Why Pakistanis Won't Let Me Pay? (Wikimedia Commons, from YouTube t4pNTDTUN4w)](https://commons.wikimedia.org/wiki/File:Peshawar;_Why_Pakistanis_Won%27t_Let_Me_Pay%3F.webm) | 09:45-09:52 | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) | Peace Travels |
| `pk_peshawar_chowk_traffic.mp4` | Peshawar | Busy intersection with rickshaws, cars and pedestrians (evening) | [Peshawar: Why Pakistanis Won't Let Me Pay? (Wikimedia Commons, from YouTube t4pNTDTUN4w)](https://commons.wikimedia.org/wiki/File:Peshawar;_Why_Pakistanis_Won%27t_Let_Me_Pay%3F.webm) | 26:06-26:16 | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) | Peace Travels |
| `pk_peshawar_city_gate.mp4` | Peshawar | Old-city gate with street traffic | [Peshawar: Why Pakistanis Won't Let Me Pay? (Wikimedia Commons, from YouTube t4pNTDTUN4w)](https://commons.wikimedia.org/wiki/File:Peshawar;_Why_Pakistanis_Won%27t_Let_Me_Pay%3F.webm) | 26:22-26:26 | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) | Peace Travels |
| `pk_peshawar_night_road.mp4` | Peshawar | Arterial road at night, moving traffic | [Why Pakistanis Are Extremely Nice? (ACTION in Peshawar) (Wikimedia Commons, from YouTube 6TmG3rr5SGg)](https://commons.wikimedia.org/wiki/File:Why_Pakistanis_Are_Extremely_Nice%3F_(ACTION_in_Peshawar).webm) | 01:00-01:03 and 01:14-01:17 | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) | Peace Travels |
| `pk_peshawar_night_shops.mp4` | Peshawar | Lit shopfronts and parked cars at night | [Why Pakistanis Are Extremely Nice? (ACTION in Peshawar) (Wikimedia Commons, from YouTube 6TmG3rr5SGg)](https://commons.wikimedia.org/wiki/File:Why_Pakistanis_Are_Extremely_Nice%3F_(ACTION_in_Peshawar).webm) | 04:44-04:47 | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) | Peace Travels |
| `pk_faisalabad_hotel_lobby.mp4` | Faisalabad | Indoor lobby (interior) | [SHOCKING Pakistan First Impression (Faisalabad) (Wikimedia Commons, from YouTube d6UTk4cjmts)](https://commons.wikimedia.org/wiki/File:SHOCKING_Pakistan_First_Impression_(Faisalabad).webm) | 11:01-11:09 | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) | Peace Travels |
| `pk_faisalabad_corridor.mp4` | Faisalabad | Indoor corridor (interior, office-like) | [SHOCKING Pakistan First Impression (Faisalabad) (Wikimedia Commons, from YouTube d6UTk4cjmts)](https://commons.wikimedia.org/wiki/File:SHOCKING_Pakistan_First_Impression_(Faisalabad).webm) | 11:43-11:50 and 12:04-12:10 | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) | Peace Travels |
| `pk_faisalabad_boulevard.mp4` | Faisalabad | Tree-lined boulevard and gateway, light traffic (daytime) | [SHOCKING Pakistan First Impression (Faisalabad) (Wikimedia Commons, from YouTube d6UTk4cjmts)](https://commons.wikimedia.org/wiki/File:SHOCKING_Pakistan_First_Impression_(Faisalabad).webm) | 09:56-09:59 and 10:04-10:07 | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) | Peace Travels |
| `pk_motorway.mp4` | Punjab (motorway near Faisalabad) | Divided highway with trucks (daytime) | [SHOCKING Pakistan First Impression (Faisalabad) (Wikimedia Commons, from YouTube d6UTk4cjmts)](https://commons.wikimedia.org/wiki/File:SHOCKING_Pakistan_First_Impression_(Faisalabad).webm) | 02:19-02:21 and 02:26-02:30 | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) | Peace Travels |
| `pk_kotri_barrage_river.mp4` | Jamshoro, Sindh | River and barrage view (waterfront, daytime haze) | [River Indus at Kotri Barrage Jamshoro (Wikimedia Commons, own work)](https://commons.wikimedia.org/wiki/File:River_Indus_at_Kotri_Barrage_Jamshoro.webm) | 00:00-00:17 | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | JogiAsad |
| `pk_jamshoro_waterfront_boats.mp4` | Jamshoro, Sindh | Riverbank with moored boats (waterfront) | [River Indus at Kotri Barrage Jamshoro (Wikimedia Commons, own work)](https://commons.wikimedia.org/wiki/File:River_Indus_at_Kotri_Barrage_Jamshoro.webm) | 00:27-00:37 | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | JogiAsad |
| `pk_jamshoro_bus_stand.mp4` | Jamshoro, Sindh | Roadside stop with buses and pedestrians | [River Indus at Kotri Barrage Jamshoro (Wikimedia Commons, own work)](https://commons.wikimedia.org/wiki/File:River_Indus_at_Kotri_Barrage_Jamshoro.webm) | 00:43-00:49 | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | JogiAsad |
| `pk_lahore_traffic.mp4` | Lahore | Congested street with rickshaws (filmed from a car, 2007, low resolution) | [Traffic in Lahore (Internet Archive MaartenVHTrafficinLahore)](https://archive.org/details/MaartenVHTrafficinLahore) | 00:01-00:09 | [Public domain](http://creativecommons.org/licenses/publicdomain/) | Maarten VH |
