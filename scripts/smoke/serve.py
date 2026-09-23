#!/usr/bin/env python3
"""Serve renderer/ for the smoke tests, with the Tauri stub injected.

Deliberately outside renderer/: `frontendDist` points there, so anything dropped in
that folder is bundled into the shipped app. That is why the old in-tree harness was
gitignored — and being gitignored is why it never ran in CI.

The stub is scripts/screenshots/fixture.js, shared with the screenshot capture so the
two cannot drift apart. It is injected as a <script> tag rather than through
Playwright's addInitScript: that hook runs at document-start, before <html> exists, and
the fixture sets `document.documentElement.dataset.theme` on load. It has to go INSIDE
the page, and before lib/tauri-api.js, which destructures window.__TAURI__ at load.
"""
import http.server
import os
import socketserver
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
RENDERER = os.path.normpath(os.path.join(HERE, "..", "..", "renderer"))
FIXTURE = os.path.normpath(os.path.join(HERE, "..", "screenshots", "fixture.js"))
FIXTURE_URL = "/__fixture.js"
ANCHOR = '<script src="lib/tauri-api.js"></script>'


def page_with_stub():
    with open(os.path.join(RENDERER, "index.html"), encoding="utf-8") as f:
        html = f.read()
    if html.count(ANCHOR) != 1:
        raise SystemExit(f"renderer/index.html: expected exactly one {ANCHOR}")
    return html.replace(ANCHOR, f'<script src="{FIXTURE_URL}"></script>\n  {ANCHOR}', 1)


class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.split("?")[0] in ("/", "/index.html"):
            return self._send(page_with_stub().encode("utf-8"), "text/html")
        if self.path.split("?")[0] == FIXTURE_URL:
            with open(FIXTURE, "rb") as f:
                return self._send(f.read(), "text/javascript")
        return super().do_GET()

    def _send(self, body, ctype):
        self.send_response(200)
        self.send_header("Content-Type", f"{ctype}; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def end_headers(self):
        # Without this the browser serves a stale renderer between runs, and a test
        # then passes against code that is no longer on disk.
        if "Cache-Control" not in self._headers_buffer_str():
            self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()

    def _headers_buffer_str(self):
        return b"".join(getattr(self, "_headers_buffer", []) or []).decode("latin-1")

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 4173
    os.chdir(RENDERER)
    socketserver.TCPServer.allow_reuse_address = True
    # The listen backlog defaults to 5. A page of this app requests ~30 scripts at once, so
    # connections past the fifth were refused, a random script never loaded, and whatever
    # needed it failed: a list that never rendered, an undefined window.CSMBrutus. The
    # smoke tests flaked on it, on master too.
    socketserver.TCPServer.request_queue_size = 128
    with socketserver.TCPServer(("127.0.0.1", port), Handler) as srv:
        srv.serve_forever()
