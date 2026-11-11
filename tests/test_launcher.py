"""Exercise launcher replacement with real, disposable server and client processes."""
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.request


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "serve.py"


class LauncherTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.children = []
        self.addCleanup(self.stop_children)
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            self.port = probe.getsockname()[1]
        self.url = f"http://127.0.0.1:{self.port}"

    def stop_children(self):
        for child in reversed(self.children):
            if child.poll() is None:
                child.terminate()
                try:
                    child.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.wait(timeout=5)

    def start(self, *args):
        child = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.children.append(child)
        return child

    def copy(self, name):
        root = Path(self.temp.name) / name
        (root / "app").mkdir(parents=True)
        shutil.copyfile(SCRIPT, root / "serve.py")
        (root / "app" / "index.html").write_text(f"<title>Department Hub</title>{name}")
        return root / "serve.py"

    def wait_for_page(self, marker):
        end = time.monotonic() + 8
        while time.monotonic() < end:
            try:
                with urllib.request.urlopen(self.url, timeout=0.3) as response:
                    if marker in response.read().decode():
                        return
            except (OSError, urllib.error.URLError):
                pass
            time.sleep(0.05)
        self.fail(f"The server did not serve {marker!r}")

    @unittest.skipUnless(shutil.which("lsof"), "lsof is required for replacement")
    def test_replacement_keeps_connected_client_alive(self):
        old = self.start(sys.executable, str(self.copy("older")), str(self.port), "--no-open")
        self.wait_for_page("older")
        ready = Path(self.temp.name) / "client-ready"
        client = self.start(sys.executable, "-c", (
            "import socket,sys,time; from pathlib import Path; "
            "sock=socket.create_connection(('127.0.0.1',int(sys.argv[1]))); "
            "Path(sys.argv[2]).touch(); time.sleep(30)"
        ), str(self.port), str(ready))
        end = time.monotonic() + 5
        while not ready.exists() and time.monotonic() < end:
            time.sleep(0.05)
        self.assertTrue(ready.exists(), "The disposable client did not connect")
        replacement = self.start(sys.executable, str(self.copy("newer")), str(self.port), "--no-open")
        self.wait_for_page("newer")
        old.wait(timeout=5)
        self.assertIsNone(replacement.poll(), "The replacement stopped")
        self.assertIsNone(client.poll(), "Restarting killed a connected client")

    def test_unrelated_server_is_left_running(self):
        other_root = Path(self.temp.name) / "unrelated"
        other_root.mkdir()
        (other_root / "index.html").write_text("Unrelated app")
        other = self.start(sys.executable, "-m", "http.server", str(self.port), "--bind", "127.0.0.1", "--directory", str(other_root))
        self.wait_for_page("Unrelated app")
        result = subprocess.run([sys.executable, str(self.copy("candidate")), str(self.port), "--no-open"], capture_output=True, text=True, timeout=10)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Something else", result.stderr)
        self.assertIsNone(other.poll(), "The unrelated app was stopped")
        self.wait_for_page("Unrelated app")


if __name__ == "__main__":
    unittest.main()
