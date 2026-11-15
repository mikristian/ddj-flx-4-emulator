# GitHub release status — 14 November 2026

## Two installed app versions represented

This repository documents **only the two pictured macOS controller applications** in its public screenshot gallery:

| App | Native version | User-provided screenshot | GitHub source |
| --- | --- | --- | --- |
| FLX4 Live 2D, Fixed 3D | **0.3.0** | `docs/screenshots/flx4-live-fixed-3d-v0.3.0.png` | `FLX4Live2D/realistic.html`, `realistic3d.js`, `sampler-companion.js`, `bridge.py`, Swift wrapper |
| FLX4 Flat 2D | **1.1.1** | `docs/screenshots/flx4-flat-2d-v1.1.1.png` | `FLX4FlatDrumApp/ui/`, `native/FLX4LiveBridge.py`, Swift wrapper |

The screenshots were captured in the Mac's installed app windows at **11:16 PM on November 14, 2026**. They replaced four older redacted or source-preview images which depicted different or incomplete surfaces. The root README now embeds exactly these two complete images and links each to the actual app's source.

## Source parity verified

- `FLX4FlatDrumApp/ui/index.html`, `style.css`, and `app.js` **byte-for-byte matched** the installed Flat 2D v1.1.1 web resources at inspection.
- `FLX4Live2D/realistic.html`, `realistic.css`, `sampler-companion.js`, and `companion.css` **byte-for-byte matched** the installed Fixed 3D v0.3.0 resources.
- The public `FLX4Live2D/realistic3d.js` preserves the original installed scene and interactive controller paths, with an added `?geometry=1` procedural fallback for builds without manufacturer-style imagery. Its source SHA therefore differs from the installed file by design.
- The public `FLX4Live2D/bridge.py` uses the standard local `~/Applications/ASR-10 Sampler Lab.app` path; the installed application used a development-workspace path. That is a portability change, not proof of refreshed installed-app behavior.
- `node scripts/verify-release.mjs` checks the **exact two original screenshot SHA-256 hashes**, source file presence, native packaging version, and main page wiring.

## Checks from this update

- Release screenshot/version/source check: **PASS**, both app variants.
- Flat 2D control and hotspot simulation: **19/19 PASS**.
- Flat 2D crossfader direction and pointer/keyboard behavior: **PASS**.
- Fixed 3D JavaScript syntax checks: **PASS**.
- Local Python bridge unit suite: **10/10 PASS**, including status, explicit connect, channel bounds, origin restrictions, allowlisted apps, and note cleanup.

These are software/unit tests. The screenshots' status indicators are UI state, not independent validation of physical DDJ-FLX4 hardware activity or an audible rekordbox + Ableton signal.

## Known build and redistribution limits

This public repository carries the code and native wrapper for the same **two versions** but does not redistribute manufacturer controller photographs, panels/jog textures, recorded music, private settings, or built `.app` bundles. The photos/textures used by the original installed applications must be supplied separately with appropriate rights to reproduce the screenshot visuals exactly. The optional procedural 3D prototype can run without them, with reduced visual fidelity.

The native build scripts require an appropriate local macOS toolchain, Python environment, and original app resources; packaging an exact photo-backed release from the public source alone is currently incomplete. Third-party branding inside the user-supplied screenshots is solely incidental documentation of app appearance.

See [README.md](README.md), [Third-party notices](THIRD_PARTY_NOTICES.md), and the individual project READMEs for controls and supported integration.
