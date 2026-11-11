"""Serve the unpacked standalone Department Hub app on this computer only, and open it in the browser.

Usage: python3 serve.py [port] [--no-open]

The app keeps its data in the browser under the address it is opened at, so use the same port each time.
If an older copy of Department Hub is still running on that port, it is stopped and replaced.
"""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import os
import signal
import socket
import subprocess
import sys
import threading
import time
import urllib.request
import webbrowser

args = [arg for arg in sys.argv[1:] if not arg.startswith("--")]
port = int(args[0]) if args else 8769
root = Path(__file__).resolve().parent / "app"
url = f"http://127.0.0.1:{port}"


def in_use():
    with socket.socket() as probe:
        probe.settimeout(0.5)
        return probe.connect_ex(("127.0.0.1", port)) == 0


def is_department_hub():
    try:
        with urllib.request.urlopen(url, timeout=2) as response:
            return b"<title>Department Hub</title>" in response.read(4096)
    except OSError:
        return False


def stop_older_copy():
    try:
        # Select listeners only; established browser/client sockets also name this port.
        found = subprocess.run(["lsof", "-nP", f"-tiTCP:{port}", "-sTCP:LISTEN"], capture_output=True, text=True, timeout=5).stdout.split()
    except (OSError, subprocess.SubprocessError):
        return False
    for pid in found:
        if pid.isdigit() and int(pid) != os.getpid():
            try:
                os.kill(int(pid), signal.SIGTERM)
            except OSError:
                pass
    for _ in range(30):
        if not in_use():
            return True
        time.sleep(0.1)
    return False


if in_use():
    if not is_department_hub():
        sys.exit(f"Something else on this computer is using port {port}. Run this again with a different number, for example: python3 serve.py {port + 1}")
    print("An older copy of Department Hub is running here. Replacing it.", flush=True)
    if not stop_older_copy():
        sys.exit("The older copy could not be stopped. Close the Terminal window it is running in, then run this again.")

handler = partial(SimpleHTTPRequestHandler, directory=root)
ThreadingHTTPServer.allow_reuse_address = True
with ThreadingHTTPServer(("127.0.0.1", port), handler) as server:
    print(f"Department Hub is ready at {url}", flush=True)
    print("Leave this window open while you use it. Press Control-C to stop.", flush=True)
    if "--no-open" not in sys.argv:
        threading.Timer(0.5, webbrowser.open, [url]).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
