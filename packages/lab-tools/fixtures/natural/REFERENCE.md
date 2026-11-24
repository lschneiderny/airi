# Natural fingerprint reference bands, version 1

`reference-talk-v1.json` and `reference-song-v1.json` are `natural-reference` version 1 files, built on 2026-11-24 by `pnpm lab:natural reference` with 60 s windows at a half-window hop. For each fingerprint measure a file holds the value of every window and the band from their minimum to their maximum. [Natural fingerprint](../../README.md#natural-fingerprint) defines the measures; `lab:natural compare` reads the files.

Only derived statistics are committed. No footage, frame, track, audio or voice envelope is in the repository, and the files name no source file.

## Segments

The reference performer is Neuro-sama's current 2D model, on two public stream recordings, both at 60 fps and tracked every second frame (about 30 fps).

| File | Segment | Windows |
| --- | --- | --- |
| `reference-talk-v1.json` | Stream of 2026-11-10: 360 s of solo talk. | 11 |
| `reference-talk-v1.json` | Stream of 2026-09-16: 115 s of talk before a song (0 to 115 s of the recording). | 2 |
| `reference-song-v1.json` | Stream of 2026-09-16: 165 s of one song (135 to 300 s of the recording). | 4 |

Tracker: `track-avatar-video 1` (`scripts/track-avatar-video.py`, `dghs-imgutils` face and eye detectors). A change to the tracker that changes its output bumps that string and needs new files.

## Rebuild

With the recordings outside the repository, from the repository root:

```bash
uv run packages/lab-tools/scripts/track-avatar-video.py <2026-11-10 recording> .temp/natural/chat.json --step 2
uv run packages/lab-tools/scripts/track-avatar-video.py <2026-09-16 recording> .temp/natural/talk.json --step 2 --start 0 --end 115
uv run packages/lab-tools/scripts/track-avatar-video.py <2026-09-16 recording> .temp/natural/song.json --step 2 --start 135 --end 300
pnpm lab:natural reference --name reference-talk-v1 --note "Neuro-sama's current 2D model talking solo on stream; head tilt, blinks and their relation to her voice." --out <new file> --window 60 --segment "stream 2026-11-10, 360 s of solo talk" --segment "stream 2026-09-16, 115 s of talk before a song" .temp/natural/chat.json .temp/natural/talk.json
pnpm lab:natural reference --name reference-song-v1 --note "Neuro-sama's current 2D model singing one song on stream; head tilt and blinks while the song plays." --out <new file> --window 60 --segment "stream 2026-09-16, 165 s of one song" .temp/natural/song.json
```

`reference` refuses to overwrite a file; write a new version beside the old one.

## Limits

- One talk segment pair and one song, from one performer and one model. The bands are the spread of their windows, not a population.
- Tilt is the only channel in degrees. `x`, `y` and `scale` are in face widths on video and in Natural's units in a replay, so they are not compared.
- The mouth is not tracked, so lip sync is not compared.
- The voice is the stream's whole audio track. In the karaoke stream music plays under the talk, so its talk share reads high and its talking-to-silent measures rest on few silent frames.
- The Natural side of a comparison is the commanded head angle, not rendered pixels.
