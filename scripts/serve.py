"""Serve the unpacked standalone Department Hub app on loopback."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import sys

root = Path(__file__).resolve().parent / "app"
port = int(sys.argv[1]) if len(sys.argv) > 1 else 8769
handler = partial(SimpleHTTPRequestHandler, directory=root)
with ThreadingHTTPServer(("127.0.0.1", port), handler) as server:
    print(f"Department Hub is ready at http://127.0.0.1:{port}", flush=True)
    print("Press Control-C to stop.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
