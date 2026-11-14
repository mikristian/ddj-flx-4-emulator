# FLX4 Live 2D — fixed-view rekordbox controller + existing samplers

This is a **separate macOS app** using the *same actual photo-textured Three.js DDJ-FLX4 model* as the original dashboard. The chassis, jogs, texture maps, lighting, physical depth, interactive transport buttons, pads, mixer and faders remain 3D. **"2D" means the camera is fixed**: the user cannot orbit, spin, pan or zoom the board. It is not the old vector redraw.

The original `../dashboard.html`, `../dashboard3d.js` and `../dashboard.css` are untouched. The app no longer contains Drum Lab, drum kits or a second synthesized sampler. Its collapsed **SAMPLER APPS / ABLETON** panel works with the existing MASCHINE LAB, Vintage Sampler Lab and ASR-10 projects.

## Launch

The installed application is **`~/Applications/FLX4 Live 2D.app`**. Its WebKit view opens the self-contained **`http://127.0.0.1:18767/realistic.html`** local interface and starts the isolated MIDI/HTTP bridge with `rekordbox_mcp/.venv/bin/python`. Its source is `FLX4Live2D/`; run `native/package_mac_app.sh` to rebuild a code-signed Mac bundle. No CDNs or remote asset services are required.

The original 3D dashboard is still available in the existing rekordbox project. FLX4 Live 2D uses the same WebSocket MIDI protocol (127.0.0.1:18765) for DJ controls, and proxies read-only library/track endpoints through 127.0.0.1:18766. No changes are made to rekordbox mapping or macOS audio setup.

## Play samplers during your DJ set

1. Start rekordbox and the existing FLX4 controller mapping. The DDJ-FLX4 hardware may continue to control rekordbox as normal.
2. Open **FLX4 Live 2D**. Its original photo-textured board is clickable, with the camera fixed.
3. Open **SAMPLER APPS / ABLETON**. All three existing sampler apps are listed with real installed/running status. Use **OPEN APP**/**FOCUS APP** to run the standalone sampler and trigger its own sounds while rekordbox plays.
4. For pads on the *onscreen FLX4* to play your **Ableton instrument plugins**, enable **Track** for the MIDI input **FLX4 Live 2D to Ableton** in Ableton's **Settings → Link, Tempo & MIDI**. Add your desired sampler AU/VST3 as an instrument on a MIDI track, enable monitoring or arm it, and select the proper MIDI input channel.
5. In the companion choose **MASCHINE LAB**, **VINTAGE AKAI**, or **ASR-10**. The two banks of 3D onscreen FLX4 performance pads now send notes to that selected Ableton instrument's MIDI channel, leaving the FLX4 jog, cue, transport and mixer mapped to rekordbox.

| Companion selection | MIDI channel in Ableton | Notes from the 16 onscreen pads |
| --- | ---: | --- |
| MASCHINE LAB | 1 | 36–51 (its 16 sample pads) |
| VINTAGE AKAI | 2 | 36–51 (its 16 sample pads) |
| ASR-10 | 3 | 60–75 (chromatic keys about default root 60) |
| REKORDBOX | — | Original rekordbox performance-pad MIDI mapping |

A connected *virtual MIDI output* means that Ableton has a selectable input. It **does not prove** that Ableton has enabled Track, that a sampler instrument is receiving the matching channel, or that audible audio is routed to the DDJ-FLX4. Each application's audio output must be configured appropriately. The companion has a **CHECK FLX4 AUDIO DEVICE** read-only inventory action; it never changes a device.

**Physical controller limitation:** the interface has not been verified to intercept real DDJ-FLX4 hardware pad presses while rekordbox is using the hardware. The MIDI note routing above is verified for the software's onscreen 3D pads, and the three standalone samplers can also play independently while rekordbox continues. Physical-pad-to-Ableton routing requires a separate hardware MIDI input to be exposed and mapped. No guaranteed audio beat-sync, automatic audio mixing, or direct injection into rekordbox is claimed.

## Validation

The backend serves only loopback `127.0.0.1:18767`. POST inputs are checked for bounds, origin and JSON content. Overlapping note-on messages and MIDI note-off cleanup on shutdown are handled per note/channel. The backend can enumerate and open only the three allowlisted sampler app bundles. The original 3D controller files, saved samples, and Ableton projects are never modified.

Run:

```bash
cd ~/Chat\ On\ Steroids\ Workspace/rekordbox_mcp
./.venv/bin/python -m unittest discover -s FLX4Live2D -p test_bridge.py -v
node --check FLX4Live2D/realistic3d.js
node --check FLX4Live2D/sampler-companion.js
```

This release was checked by compiling/signing the native app and inspecting both its fixed hardware view and its sampler companion in a real macOS window.
