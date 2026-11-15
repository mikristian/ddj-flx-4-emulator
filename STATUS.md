# Publication verification (2026-11-14)

Source content scan: passed. No controller photos/texture artwork, WAV sounds, compiled apps or absolute personal paths.

Local checks: `node --check FLX4FlatDrumApp/ui/app.js`; `node FLX4FlatDrumApp/tests/test_crossfader.js` **passed**; `node --check FLX4Live2D/realistic3d.js` and `sampler-companion.js` **passed**; `python3 -m py_compile FLX4Live2D/bridge.py FLX4FlatDrumApp/native/FLX4LiveBridge.py` **passed**.

Known blockers: missing licensable FLX4 controller photo and textures prevent original visual rendering; excluded sound sample WAVs prevent their playback. Mac app packaging requires matching Python interpreter and original environment settings. Verified main JavaScript source for both installed applications was identical to local authored source at the time of audit. This does not establish full end-to-end hardware parity.


## Screenshot correction (2026-11-14)

Removed all four prior screenshots and README image references after the user reported misleading gallery content. Launched and photographed the actual installed `FLX4 Flat 2D.app` v1.1.1 and `FLX4 Live 2D.app` v0.3.0 (the latter titled Fixed 3D). The two public screenshots are from native macOS window captures and visibly redact licensed/uncertain-rights controller photographs/textures and local media data. Unredacted evidence was retained only in ignored local audit files. The browser `realistic.html` is source in FLX4Live2D, not proof of a separately installed app. Full visual screenshots still require rights clearance.
