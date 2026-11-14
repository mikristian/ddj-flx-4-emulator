# FLX4 Flat 2D — original flat controller, rebuilt

**Release: FLX4 Flat 2D v1.1.1**, installed separately at `~/Applications/FLX4 Flat 2D.app`.

**v1.1.1 single-slider cleanup:** The original controller photograph contained
five stationary fader handles behind the interactive ones. The script
`native/clean_photo_faders.py` produces `ui/flx4-top-faders-clean.png`
by replacing only those static photographed handles with realistic chassis,
slots and tick marks. The source `ui/flx4-top-crop.png` remains unchanged.
Both tempo sliders, both channel faders and the crossfader now display **one
functional moving handle each**; the extra CSS track over the physical rails
and the large opaque crossfader panel are gone. Dragging, keyboard and MIDI
routing retain the v1.1.0 behavior. The build regenerates the cleaned photo.

**v1.1 control pass:** Photo-backed jogs rotate visibly on drag, wheel and
keyboard gestures. Mixer EQ/CFX/FX knobs show their positions; tempo, channel
and crossfaders render moving handles. CUE/LOOP CALL arrows, SHIFT+BEAT JUMP
(BEAT LOOP), PAD FX1, Smart CFX/Fader and Beat FX targeting decks 1/2/both
are mapped to supported rekordbox MIDI commands. Master, TRIM, mic and
headphone level controls are visually adjustable only pending verified MIDI
Learn mappings; the app does not falsely claim audio was changed.

Verification: 19 passing headless interaction tests; a native macOS jog
drag that visibly rotates the platter; a signed v1.1 app which opens its
independent MIDI bridge on 127.0.0.1:18867. End-to-end audio/deck behavior
still requires rekordbox running with the correct MIDI routing.
Previous v1.0.1 backup: `backups/FLX4-Flat-2D-v101-before-v110.app`.

**v1.0.1 crossfader fix:** The bottom crossfader is now an explicitly
horizontal slider, with a left-right graphical thumb covering the former
static vertical-looking image. Drag or click along the horizontal track,
or use Left/Right and Home/End keys. Up/Down keys and mouse-wheel scrolling
cannot accidentally move the crossfader. The channel/tempo faders retain
their intended vertical controls. The fader's full pointer travel and
keyboard handling are tested with `node FLX4FlatDrumApp/tests/test_crossfader.js`.

This is the original FLX4 **truly flat 2D app** rebuilt with the exact top-down
Pioneer DJ DDJ-FLX4 controller layout. It uses the project's locally saved
1630 × 921 top-view controller photograph as a fixed flat hardware face,
and separate responsive, keyboard-accessible 2D hotspots precisely aligned
with the real jog wheels, orange pad outlines, transport, browser, mixer knobs,
faders, crossfader and FX controls. **No 3D camera, spinning model, CSS tilt,
or orbit gestures.** The 16 pads are tightly spaced as on the hardware.

The separately installed `~/Applications/FLX4 Live 2D.app` is the
**realistic, fixed-camera Three.js edition**. It is intentionally unchanged.
The former 2D prototype remains in `build/FLX4 Live 2D.app` as an earlier
local source/build reference, not as the current application.

## Controls and performance

The top-down hardware view supports both jog-wheel scratch/touch gestures,
two deck cue/play, loop in/out/4-beat, sync, track loading/browsing, eight
Rekordbox performance pads per deck, keyboard shortcuts, channel EQ/CFX,
faders, crossfader and software FX. Hover and activation illuminate the pads
and hardware controls while preserving the photograph's physical proportions.

**TRIM knobs are currently display-only.** There is no corresponding trim
action in the existing rekordbox virtual bridge; assigning them to a guessed
command could change an unrelated audio setting.

The upper **Performance Route** selector defaults to rekordbox. You can change
it to **MASCHINE LAB**, **Vintage Sampler Lab** or **ASR-10 Sampler Lab**:
the app sends virtual Ableton MIDI notes to the chosen sampler's track, while
the FLX4 decks continue using rekordbox normally.

- MASCHINE LAB: MIDI channel 1, pad notes 36–51.
- Vintage Sampler Lab: MIDI channel 2, pad notes 36–51.
- ASR-10: MIDI channel 3, keyboard notes 60–75 (default root mapping).

The collapsible **Sampler Companion** shows which of the three existing
sampler apps are installed/running, and opens them using their existing macOS
applications. This edition has **no duplicate Drum Lab** and does not copy or
modify any saved songs, samples or Ableton projects.

## Ableton + rekordbox setup

Open Ableton Live → **Settings → Link, Tempo & MIDI** and enable **Track**
on the virtual MIDI input named **FLX4 Flat 2D to Ableton**. Create a MIDI track
for the sampler you want to play. Load its installed AU/VST3 instrument
(MASCHINE LAB 2D, Vintage Sampler Lab or ASR-10), choose the input
`FLX4 Flat 2D to Ableton`, select the appropriate MIDI input channel above,
and arm or monitor the track.

Continue DJing in rekordbox and select the desired FLX4 Flat 2D performance
route. Pad presses in this **software app** send MIDI to the chosen Ableton
instrument; rekordbox deck operations remain on the original controller bridge.
A physical DDJ-FLX4 can remain connected to rekordbox independently, but
mirroring **physical hardware** pad presses into the sampler also requires an
available MIDI input from the device and a verified mapping. That connection
is **not claimed** by this standalone interface.

To hear sampler audio through the same speakers as rekordbox, configure
Ableton or each standalone sampler's output device appropriately. The FLX4
Flat 2D app does not silently intercept rekordbox audio, alter macOS audio
devices or internally mix the two applications.

## Application boundaries

The native app has its own bundle ID `com.mikristian.flx4flat2d`, icon,
HTTP bridge on `127.0.0.1:18867` and virtual MIDI source
`FLX4 Flat 2D to Ableton`. It only uses the existing rekordbox WebSocket
bridge on `127.0.0.1:18765`. The earlier fixed-3D edition uses HTTP 18767;
both can coexist. The status display does **not** call a connected WebSocket
proof that the rekordbox application is running.

This app is not an AU/VST plug-in, does not provide automatic rekordbox/Ableton
tempo synchronization, and does not promise a tested low-latency audio loop
through the physical FLX4.

## Development and tests

Source UI: `ui/index.html`, `ui/style.css`, `ui/app.js`.
Native wrapper: `native/FLX4Flat2D.swift`.
Bridge: `native/FLX4LiveBridge.py`.
Packaging: `native/package_flat.sh`.
Real FLX4 front reference: `../assets/pioneer-ddj-flx4-top-crop.png`.

Rebuild using `zsh FLX4FlatDrumApp/native/package_flat.sh` from the
`rekordbox_mcp` root. Syntax-check the source with
`node --check FLX4FlatDrumApp/ui/app.js`. Focused HTTP and outbound MIDI
tests are shared with `FLX4Live2D/test_bridge.py` and are run with the flat
bridge module imported as `bridge`. Physical controller deck actions require
the user's live rekordbox application and verified MIDI mapping, so they are
not simulated as successful during isolated tests.
