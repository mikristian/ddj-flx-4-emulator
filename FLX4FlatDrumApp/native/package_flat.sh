#!/bin/zsh
# Dedicated photo-backed flat 2D controller (no rotatable 3D or Drum Lab).
# The separate FLX4 Live 2D app remains installed and unchanged.
set -euo pipefail
cd -- "${0:A:h}/../.."
ROOT="$PWD"
SRC="$ROOT/FLX4FlatDrumApp/ui"
NATIVE="$ROOT/FLX4FlatDrumApp/native"
APP="$ROOT/FLX4FlatDrumApp/build/FLX4 Flat 2D.app"
STATIC="$APP/Contents/Resources/FLX4Flat2D"
mkdir -p "$APP/Contents/MacOS" "$STATIC"

"$ROOT/.venv/bin/python" "$NATIVE/create_icon.py"
iconutil -c icns "$NATIVE/FLX4Flat2D.iconset" -o "$NATIVE/FLX4Flat2D.icns"
"$ROOT/.venv/bin/python" "$NATIVE/clean_photo_faders.py"

for filename in index.html style.css app.js flx4-top-faders-clean.png jog-left.png jog-right.png; do
    [[ -s "$SRC/$filename" ]] || { echo "Missing $filename" >&2; exit 1; }
    cp -f "$SRC/$filename" "$STATIC/$filename"
done
cp -f "$NATIVE/FLX4LiveBridge.py" "$STATIC/bridge.py"
cp -f "$NATIVE/FLX4Flat2D.icns" "$APP/Contents/Resources/FLX4Flat2D.icns"
cat > "$APP/Contents/Info.plist" <<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>FLX4 Flat 2D</string>
<key>CFBundleDisplayName</key><string>FLX4 Flat 2D</string>
<key>CFBundleExecutable</key><string>FLX4 Flat 2D</string>
<key>CFBundleIdentifier</key><string>com.mikristian.flx4flat2d</string>
<key>CFBundleShortVersionString</key><string>1.1.1</string>
<key>CFBundleVersion</key><string>4</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>LSMinimumSystemVersion</key><string>13.0</string>
<key>NSHighResolutionCapable</key><true/>
<key>CFBundleIconFile</key><string>FLX4Flat2D.icns</string>
<key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict></plist>
XML
swiftc -O -target arm64-apple-macos13.0 -framework AppKit -framework WebKit \
    "$NATIVE/FLX4Flat2D.swift" -o "$APP/Contents/MacOS/FLX4 Flat 2D"
codesign --force --deep --sign - "$APP"
codesign --verify --deep --verbose=2 "$APP"
echo "Independent flat FLX4 app packaged at: $APP"
