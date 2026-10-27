"""Serve the site locally without caching: public/ at the root, plus tools/ for development aids.

Only public/ is deployed; tools/ is reachable here so the browser console can import inspect.js.
"""

import functools
import http.server
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent


class Handler(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        if path.startswith("/tools/"):
            return str(ROOT / "tools" / path.split("?", 1)[0].removeprefix("/tools/"))
        return super().translate_path(path)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 4173
    handler = functools.partial(Handler, directory=str(ROOT / "public"))
    with http.server.ThreadingHTTPServer(("127.0.0.1", port), handler) as server:
        print(f"Serving {ROOT / 'public'} at http://127.0.0.1:{port}")
        server.serve_forever()


if __name__ == "__main__":
    main()
