#!/bin/zsh
# Build the native two-dimensional DJ controller window. No DJ configuration
# or Rekordbox settings are altered. Does not replace any existing application.
set -euo pipefail
cd -- "${0:A:h}/../.."
PROJECT_ROOT="$PWD"
SUBDIR="$PROJECT_ROOT/FLX4Live2D"
OUT="$SUBDIR/build/FLX4 Live 2D.app"
CONTENTS="$OUT/Contents"
RESOURCE="$CONTENTS/Resources"
STATIC="$RESOURCE/FLX4Live2D"
mkdir -p "$CONTENTS/MacOS" "$STATIC"
# This is an intentionally clean generated resource directory. The previous
# experimental Drum Lab and flat redraw are excluded from the corrected app.
rm -f "$STATIC/index.html" "$STATIC/style.css" "$STATIC/app.js"
rm -rf "$STATIC/sounds"

"$PROJECT_ROOT/.venv/bin/python" "$SUBDIR/native/generate_icon.py"
iconutil -c icns "$SUBDIR/native/FLX4Live2D.iconset" -o "$SUBDIR/native/FLX4Live2D.icns"
cp -f "$SUBDIR/native/FLX4Live2D.icns" "$RESOURCE/FLX4Live2D.icns"

for file in realistic.html realistic.css realistic3d.js companion.css sampler-companion.js bridge.py; do
    if [[ ! -s "$SUBDIR/$file" ]]; then
        echo "Missing application resource: $SUBDIR/$file" >&2
        exit 1
    fi
    cp -f "$SUBDIR/$file" "$STATIC/$file"
done

# Exact texture and geometry dependencies from the existing 3D FLX4 project.
# The new native window locks the viewpoint while preserving meshes, original
# image skin, lighting, fader/jog hit tests and the verified control mapping.
mkdir -p "$STATIC/vendor" "$STATIC/assets"
for module in OrbitControls.js RoundedBoxGeometry.js three.module.js three.core.js; do
    cp -f "$SUBDIR/vendor/$module" "$STATIC/vendor/$module"
done
for image in pioneer-ddj-flx4-panel-clean.png pioneer-ddj-flx4-front-band.png pioneer-ddj-flx4-rear-band.png pioneer-jog-housing-left.png pioneer-jog-housing-right.png pioneer-jog-center.png; do
    cp -f "$SUBDIR/assets/$image" "$STATIC/assets/$image"
done

cat > "$CONTENTS/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>FLX4 Live 2D</string>
<key>CFBundleDisplayName</key><string>FLX4 Live 2D</string>
<key>CFBundleExecutable</key><string>FLX4 Live 2D</string>
<key>CFBundleIdentifier</key><string>com.mikristian.flx4live2d</string>
<key>CFBundleShortVersionString</key><string>0.3.0</string>
<key>CFBundleVersion</key><string>3</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>LSMinimumSystemVersion</key><string>13.0</string>
<key>NSHighResolutionCapable</key><true/>
<key>CFBundleIconFile</key><string>FLX4Live2D.icns</string>
<key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
<key>NSMicrophoneUsageDescription</key><string>Audio input may be used in future recording features.</string>
</dict></plist>
PLIST

swiftc -O -target arm64-apple-macos13.0 -framework AppKit -framework WebKit \
    "$SUBDIR/native/FLX4Live2D.swift" \
    -o "$CONTENTS/MacOS/FLX4 Live 2D"
codesign --force --deep --sign - "$OUT"
codesign --verify --deep --verbose=1 "$OUT"
echo "Packaged: $OUT"
