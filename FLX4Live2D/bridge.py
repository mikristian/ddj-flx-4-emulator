"""Local-only FLX4 Live 2D HTTP and outbound Ableton MIDI bridge."""
from __future__ import annotations

import json
import os
import plistlib
import signal
import subprocess
import sys
import threading
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
HOST = "127.0.0.1"
PORT = 18767
MIDI_NAME = "FLX4 Live 2D to Ableton"
MAX_VOICES = 128
SAMPLER_APPS = {
    "maschine": ("MASCHINE LAB", Path.home() / "Applications/MASCHINE LAB.app"),
    "vintage": ("Vintage Sampler Lab", Path.home() / "Applications/Vintage Sampler Lab.app"),
    "asr10": ("ASR-10 Sampler Lab", Path.home() / "Applications/ASR-10 Sampler Lab.app"),
}


def sampler_executable(app: Path) -> Path | None:
    """Require a complete macOS app bundle before advertising launchability."""
    try:
        with (app / "Contents/Info.plist").open("rb") as stream:
            name = plistlib.load(stream).get("CFBundleExecutable")
        if isinstance(name, str) and name and Path(name).name == name:
            executable = app / "Contents/MacOS" / name
            if executable.is_file() and os.access(executable, os.X_OK):
                return executable
    except (OSError, ValueError, TypeError, plistlib.InvalidFileException):
        pass
    return None


def sampler_status() -> list[dict]:
    try:
        processes = subprocess.run(["ps", "-axo", "command="], capture_output=True,
                                   text=True, timeout=3, check=True).stdout.splitlines()
    except (OSError, subprocess.SubprocessError):
        processes = []
    result = []
    for app_id, (name, path) in SAMPLER_APPS.items():
        executable = sampler_executable(path)
        # The process command begins with the bundle executable's absolute path.
        running = bool(executable and any(
            line == str(executable) or line.startswith(str(executable) + " ")
            for line in processes))
        result.append({"id": app_id, "name": name, "installed": executable is not None,
                       "running": running, "path": str(path)})
    return result


def open_sampler(app_id: str) -> dict:
    if not isinstance(app_id, str) or app_id not in SAMPLER_APPS:
        raise ValueError("id must be maschine, vintage, or asr10")
    name, path = SAMPLER_APPS[app_id]
    if sampler_executable(path) is None:
        raise FileNotFoundError(f"{name} app is not installed at {path}")
    subprocess.run(["open", "-a", str(path)], timeout=8, capture_output=True,
                   text=True, check=True)
    return {"ok": True, "id": app_id, "name": name, "launched": True}


def audio_devices() -> dict:
    """Read-only CoreAudio inventory, queried only for this endpoint."""
    try:
        proc = subprocess.run(["system_profiler", "SPAudioDataType", "-json"],
                              capture_output=True, text=True, timeout=8, check=True)
        inventory = json.loads(proc.stdout).get("SPAudioDataType", [])
    except (OSError, subprocess.SubprocessError, ValueError) as exc:
        return {"available": False, "error": str(exc), "ddj_flx4_present": False,
                "guidance": "Check macOS Sound settings and each app's audio output independently."}
    names = []
    def walk(node):
        if isinstance(node, dict):
            name = node.get("_name")
            if isinstance(name, str):
                names.append(name)
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)
    walk(inventory)
    present = any("DDJ-FLX4" in name.upper() or "DDJ FLX4" in name.upper() for name in names)
    return {"available": True, "device_names": sorted(set(names)),
            "ddj_flx4_present": present,
            "guidance": "Select your desired audio output inside each sampler and Rekordbox; route Ableton MIDI using the FLX4 Live 2D virtual MIDI port. This bridge does not change audio devices."}


def integer_field(data: dict, name: str, low: int, high: int, default=None) -> int:
    value = data.get(name, default)
    if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
        raise ValueError(f"{name} must be an integer from {low} to {high}")
    return value


def validate_note(data: dict) -> tuple[int, int, int]:
    return (integer_field(data, "note", 0, 127),
            integer_field(data, "velocity", 0, 127, 100),
            integer_field(data, "duration_ms", 1, 5000, 250))


def validate_cc(data: dict) -> tuple[int, int]:
    return integer_field(data, "cc", 0, 127), integer_field(data, "value", 0, 127)


class MidiBridge:
    """Serialize MIDI sends and keep overlapping same-note triggers sounding."""

    def __init__(self, midi_module=None, port=None):
        self.lock = threading.RLock()
        self.port = port
        self.midi = midi_module
        self.error = None
        self.closed = False
        self.timers: set[threading.Timer] = set()
        self.active: dict[tuple[int, int], int] = {}
        if self.port is None:
            try:
                if self.midi is None:
                    import mido
                    self.midi = mido
                self.port = self.midi.open_output(MIDI_NAME, virtual=True)
            except Exception as exc:
                self.error = str(exc)

    @property
    def available(self) -> bool:
        with self.lock:
            return self.port is not None and not self.closed

    def _send(self, kind: str, channel: int = 0, **kwargs):
        try:
            self.port.send(self.midi.Message(kind, channel=channel, **kwargs))
        except Exception as exc:
            self.error = str(exc)
            raise RuntimeError(f"MIDI send failed: {exc}") from exc

    def note(self, note: int, velocity: int, duration_ms: int, channel: int = 0):
        with self.lock:
            if not self.available:
                raise RuntimeError(self.error or "Ableton MIDI output unavailable")
            if len(self.timers) >= MAX_VOICES:
                raise RuntimeError("Too many simultaneous MIDI notes")
            self._send("note_on", channel=channel, note=note, velocity=velocity)
            key = (channel, note)
            self.active[key] = self.active.get(key, 0) + 1
            timer = threading.Timer(duration_ms / 1000, lambda: self._end_note(key, timer))
            timer.daemon = True
            self.timers.add(timer)
            timer.start()

    def _end_note(self, key: tuple[int, int], timer: threading.Timer):
        with self.lock:
            self.timers.discard(timer)
            if self.closed or key not in self.active:
                return
            remaining = self.active[key] - 1
            if remaining:
                self.active[key] = remaining
            else:
                del self.active[key]
                try:
                    self._send("note_off", channel=key[0], note=key[1], velocity=0)
                except RuntimeError:
                    pass

    def cc(self, cc: int, value: int):
        with self.lock:
            if not self.available:
                raise RuntimeError(self.error or "Ableton MIDI output unavailable")
            self._send("control_change", control=cc, value=value)

    def close(self):
        with self.lock:
            if self.closed:
                return
            self.closed = True
            for timer in self.timers:
                timer.cancel()
            self.timers.clear()
            if self.port is not None:
                for channel, note in list(self.active):
                    try:
                        self._send("note_off", channel=channel, note=note, velocity=0)
                    except RuntimeError:
                        pass
                self.active.clear()
                self.port.close()



def runtime_client():
    configured_root = os.environ.get("REKORDBOX_MCP_ROOT", "").strip()
    import_root = Path(configured_root).expanduser() if configured_root else ROOT
    if str(import_root) not in sys.path:
        sys.path.insert(0, str(import_root))
    import runtime_client as client
    return client


def handler_factory(midi: MidiBridge, runtime=None):
    runtime = runtime or runtime_client()

    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(HERE), **kwargs)

        def _json(self, code: int, payload: dict):
            body = json.dumps(payload).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.path == "/api/samplers":
                self._json(200, {"samplers": sampler_status()})
                return
            if self.path == "/api/audio-devices":
                self._json(200, audio_devices())
                return
            if self.path == "/api/status":
                try:
                    rekordbox = bool(runtime.runtime_alive())
                except Exception:
                    rekordbox = False
                self._json(200, {"rekordbox_connected": rekordbox,
                                 "ableton_midi_available": midi.available,
                                 "ableton_midi_port": MIDI_NAME if midi.available else None,
                                 "ableton_midi_error": midi.error})
                return
            if self.path.startswith("/api/"):
                # Preserve all read-only library/waveform/settings queries
                # used by the original dashboard. The second fixed-view
                # window proxies only GET requests to the existing local
                # Rekordbox HTTP runtime, never changes control assignments.
                try:
                    request = urllib.request.Request("http://127.0.0.1:18766" + self.path,
                                                     headers={"Accept": "application/json"})
                    with urllib.request.urlopen(request, timeout=5) as upstream:
                        body = upstream.read(32 * 1024 * 1024 + 1)
                        if len(body) > 32 * 1024 * 1024:
                            raise ValueError("Rekordbox API response exceeds 32 MiB")
                        self.send_response(upstream.status)
                        self.send_header("Content-Type",
                                         upstream.headers.get("Content-Type", "application/json"))
                        self.send_header("Content-Length", str(len(body)))
                        self.send_header("Cache-Control", "no-store")
                        self.end_headers()
                        self.wfile.write(body)
                except (urllib.error.URLError, OSError, ValueError) as exc:
                    self._json(503, {"error": "Rekordbox runtime unavailable: " + str(exc)})
                return
            super().do_GET()

        def do_POST(self):
            if self.path not in ("/api/ableton/notes", "/api/ableton/cc", "/api/rekordbox/connect", "/api/samplers/open"):
                self._json(404, {"error": "Unknown endpoint"})
                return
            origin = self.headers.get("Origin")
            if origin and origin != f"http://{HOST}:{self.server.server_port}":
                self._json(403, {"error": "Cross-origin request forbidden"})
                return
            if self.headers.get("Content-Type", "").split(";", 1)[0].strip() != "application/json":
                self._json(415, {"error": "Expected application/json"})
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if length < 0 or length > 4096:
                    raise ValueError("Request body must be 4096 bytes or less")
                data = json.loads(self.rfile.read(length))
                if not isinstance(data, dict):
                    raise ValueError("Request must be a JSON object")
                if self.path == "/api/ableton/notes":
                    midi.note(*validate_note(data), channel=integer_field(data, "channel", 0, 15, 0))
                    self._json(200, {"ok": True})
                elif self.path == "/api/ableton/cc":
                    midi.cc(*validate_cc(data))
                    self._json(200, {"ok": True})
                elif self.path == "/api/samplers/open":
                    self._json(200, open_sampler(data.get("id")))
                else:
                    connected = bool(runtime.ensure_runtime())
                    self._json(200 if connected else 503, {"ok": connected, "rekordbox_connected": connected})
            except (ValueError, json.JSONDecodeError) as exc:
                self._json(400, {"error": str(exc)})
            except FileNotFoundError as exc:
                self._json(404, {"error": str(exc)})
            except Exception as exc:
                self._json(503, {"error": str(exc)})

        def end_headers(self):
            self.send_header("Referrer-Policy", "no-referrer")
            super().end_headers()

    return Handler


def main():
    midi = MidiBridge()
    server = ThreadingHTTPServer((HOST, PORT), handler_factory(midi))
    server.daemon_threads = True

    def on_sigterm(_signum, _frame):
        # Interrupt the main serve_forever loop. Calling shutdown() from the
        # server thread would deadlock; finally flushes MIDI note_off events.
        raise KeyboardInterrupt

    previous_sigterm = signal.signal(signal.SIGTERM, on_sigterm)
    try:
        print(f"FLX4 Live 2D: http://{HOST}:{PORT}/", flush=True)
        server.serve_forever(poll_interval=0.2)
    except KeyboardInterrupt:
        pass
    finally:
        try:
            server.server_close()
        finally:
            midi.close()
            signal.signal(signal.SIGTERM, previous_sigterm)


if __name__ == "__main__":
    main()
