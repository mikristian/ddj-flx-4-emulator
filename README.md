# DDJ-FLX4 Apps — source publication candidate

Two local macOS FLX4 interfaces are retained as separate source trees:
- `FLX4FlatDrumApp/`: flat photo-backed interface with native Swift bridge. The original top-down hardware photograph is omitted pending redistributable artwork. Its unmodified visual layout cannot render faithfully until an authorized replacement asset is provided.
- `FLX4Live2D/`: fixed-camera photo-textured 3D interface. Hardware imagery, 3D textures and sample WAVs are omitted pending license confirmation, so complete visual/audio fidelity is unavailable.

Both installed application versions were compared with their corresponding main UI JavaScript source and found SHA-256 identical during audit. Their software MIDI bridges require separately configured Rekordbox/Ableton and local Python environment; physical DDJ-FLX4 pad-to-Ableton routing was not verified.

## Verify
`node --check FLX4FlatDrumApp/ui/app.js`, `node FLX4FlatDrumApp/tests/test_crossfader.js`, `node --check FLX4Live2D/realistic3d.js`, `node --check FLX4Live2D/sampler-companion.js`. Bridge tests require configured Python dependencies.

## Build gaps
App bundle build scripts may require local runtime paths and media assets. This is a curated SOURCE export; it cannot reproduce the installed photo-backed appearance without authorized original artwork. No binaries or source media are distributed.
