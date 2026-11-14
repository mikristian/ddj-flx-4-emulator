"""Focused HTTP/MIDI tests. Run: .venv/bin/python -m unittest discover -s FLX4Live2D -p test_bridge.py"""
import http.client
import json
import threading
import time
import unittest
import tempfile
import plistlib
import signal
from pathlib import Path
from http.server import ThreadingHTTPServer
from unittest.mock import patch

import bridge


class FakeMidi:
    @staticmethod
    def Message(kind, **kwargs):
        return kind, kwargs


class FakePort:
    def __init__(self):
        self.messages = []
        self.closed = False

    def send(self, message):
        self.messages.append(message)

    def close(self):
        self.closed = True


class FakeRuntime:
    def __init__(self):
        self.started = 0

    def runtime_alive(self):
        return False

    def ensure_runtime(self):
        self.started += 1
        return True


class TestValidation(unittest.TestCase):
    def test_ranges_and_defaults(self):
        self.assertEqual(bridge.validate_note({"note": 36}), (36, 100, 250))
        self.assertEqual(bridge.validate_cc({"cc": 7, "value": 127}), (7, 127))
        for bad in ({"note": True}, {"note": 128}, {"note": 60, "duration_ms": 5001},
                    {"note": 60, "velocity": -1}, {"note": 60.0}):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                bridge.validate_note(bad)

    def test_overlap_and_shutdown(self):
        port = FakePort()
        midi = bridge.MidiBridge(FakeMidi(), port)
        midi.note(60, 90, 25)
        midi.note(60, 100, 80)
        time.sleep(0.045)
        self.assertEqual([msg[0] for msg in port.messages], ["note_on", "note_on"])
        midi.close()
        self.assertEqual([msg[0] for msg in port.messages], ["note_on", "note_on", "note_off"])
        self.assertTrue(port.closed)
        time.sleep(0.065)
        self.assertEqual(len(port.messages), 3)

    def test_sampler_midi_routes_have_independent_channels(self):
        port = FakePort()
        midi = bridge.MidiBridge(FakeMidi(), port)
        midi.note(36, 110, 20, channel=0)   # MASCHINE LAB / Live MIDI CH 1
        midi.note(36, 105, 40, channel=1)   # Vintage Sampler / Live MIDI CH 2
        midi.note(36, 100, 50, channel=2)   # ASR-10 / Live MIDI CH 3
        time.sleep(0.085)
        self.assertEqual([m[1]["channel"] for m in port.messages if m[0] == "note_on"], [0, 1, 2])
        self.assertEqual(sorted(m[1]["channel"] for m in port.messages if m[0] == "note_off"), [0, 1, 2])
        self.assertFalse(midi.active)
        midi.close()

    def test_sigterm_releases_active_notes(self):
        port = FakePort()
        midi = bridge.MidiBridge(FakeMidi(), port)
        midi.note(61, 100, 5000)
        handlers = {}

        def set_handler(signum, handler):
            previous = handlers.get(signum, signal.SIG_DFL)
            handlers[signum] = handler
            return previous

        class FakeServer:
            def serve_forever(self, **kwargs):
                handlers[signal.SIGTERM](signal.SIGTERM, None)

            def server_close(self):
                self.closed = True

        server = FakeServer()
        with patch.object(bridge, "MidiBridge", return_value=midi), \
             patch.object(bridge, "ThreadingHTTPServer", return_value=server), \
             patch.object(bridge, "handler_factory", return_value=object()), \
             patch.object(bridge.signal, "signal", side_effect=set_handler):
            bridge.main()

        self.assertTrue(server.closed)
        self.assertTrue(port.closed)
        self.assertEqual([msg[0] for msg in port.messages], ["note_on", "note_off"])
        self.assertEqual(handlers[signal.SIGTERM], signal.SIG_DFL)


class TestHTTP(unittest.TestCase):
    def setUp(self):
        self.port = FakePort()
        self.midi = bridge.MidiBridge(FakeMidi(), self.port)
        self.runtime = FakeRuntime()
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), bridge.handler_factory(self.midi, self.runtime))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.midi.close()
        self.thread.join(timeout=2)

    def call(self, method, path, data=None, headers=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=2)
        body = json.dumps(data).encode() if data is not None else None
        h = {"Content-Type": "application/json"} if body is not None else {}
        h.update(headers or {})
        conn.request(method, path, body=body, headers=h)
        response = conn.getresponse()
        result = response.status, json.loads(response.read())
        conn.close()
        return result

    def test_status_does_not_start_runtime(self):
        status, data = self.call("GET", "/api/status")
        self.assertEqual(status, 200)
        self.assertFalse(data["rekordbox_connected"])
        self.assertTrue(data["ableton_midi_available"])
        self.assertEqual(self.runtime.started, 0)

    def test_midi_and_explicit_connect(self):
        self.assertEqual(self.call("POST", "/api/ableton/cc", {"cc": 1, "value": 64})[0], 200)
        self.assertEqual(self.port.messages[-1], ("control_change", {"channel": 0, "control": 1, "value": 64}))
        self.assertEqual(self.call("POST", "/api/ableton/notes", {"note": 48, "duration_ms": 30})[0], 200)
        time.sleep(0.06)
        self.assertEqual([m[0] for m in self.port.messages[-2:]], ["note_on", "note_off"])
        self.assertEqual(self.runtime.started, 0)
        self.assertEqual(self.call("POST", "/api/rekordbox/connect", {})[0], 200)
        self.assertEqual(self.runtime.started, 1)

    def test_midi_channel_validation_and_http_routing(self):
        self.assertEqual(
            self.call("POST", "/api/ableton/notes",
                      {"note": 48, "duration_ms": 10, "channel": 2})[0], 200
        )
        time.sleep(0.04)
        self.assertEqual([m[1]["channel"] for m in self.port.messages], [2, 2])
        self.assertEqual(self.call("POST", "/api/ableton/notes",
                                   {"note": 48, "channel": 16})[0], 400)

    def test_reject_bad_requests_and_cross_origin(self):
        self.assertEqual(self.call("POST", "/api/ableton/notes", {"note": 999})[0], 400)
        self.assertEqual(self.call("POST", "/api/ableton/cc", {"cc": 0, "value": 0},
                                   {"Origin": "https://example.com"})[0], 403)
        self.assertEqual(self.runtime.started, 0)
        self.assertEqual(len(self.port.messages), 0)

    def test_sampler_endpoints_launch_allowlisted_app_only(self):
        with tempfile.TemporaryDirectory() as root:
            app = Path(root) / "Test Sampler.app"
            macos = app / "Contents/MacOS"
            macos.mkdir(parents=True)
            (app / "Contents/Info.plist").write_bytes(plistlib.dumps({"CFBundleExecutable": "TestSampler"}))
            exe = macos / "TestSampler"
            exe.write_text("#!/bin/sh\nexit 0\n")
            exe.chmod(0o755)
            with patch.dict(bridge.SAMPLER_APPS, {"maschine": ("Test Sampler", app)}, clear=True), \
                 patch.object(bridge.subprocess, "run") as mocked:
                mocked.return_value.stdout = f"{exe}\n"
                status, payload = self.call("GET", "/api/samplers")
                self.assertEqual(status, 200)
                self.assertEqual(payload["samplers"][0]["running"], True)
                self.assertEqual(self.call("POST", "/api/samplers/open", {"id": "../../bin/sh"})[0], 400)
                self.assertEqual(self.call("POST", "/api/samplers/open", {"id": "maschine"})[0], 200)
                self.assertEqual(mocked.call_args.args[0], ["open", "-a", str(app)])

    def test_missing_sampler_and_audio_inventory(self):
        with patch.dict(bridge.SAMPLER_APPS, {"asr10": ("ASR", Path("/nonexistent/test-asr10.app"))}, clear=True):
            self.assertEqual(self.call("POST", "/api/samplers/open", {"id": "asr10"})[0], 404)
        with patch.object(bridge.subprocess, "run") as mocked:
            mocked.return_value.stdout = json.dumps({"SPAudioDataType": [{"_name": "DDJ-FLX4"}]})
            status, payload = self.call("GET", "/api/audio-devices")
            self.assertEqual(status, 200)
            self.assertTrue(payload["ddj_flx4_present"])
            self.assertEqual(mocked.call_args.args[0], ["system_profiler", "SPAudioDataType", "-json"])


if __name__ == "__main__":
    unittest.main()
