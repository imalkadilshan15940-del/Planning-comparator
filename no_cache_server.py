#!/usr/bin/env python3
"""No-cache local server for the Planning Comparator app.

Identical to `python -m http.server`, except every response includes headers
that stop the browser from caching JS modules — this is what caused the app
to load an old (stale) version of a file after an update. Run this instead
of the plain http.server module.
"""
import http.server
import socketserver
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080

class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def guess_type(self, path):
        # Python's default doesn't declare a charset, which can cause the
        # browser to guess wrong when displaying a file's raw text directly
        # (as opposed to executing it as a script, which browsers always
        # decode as UTF-8 by spec regardless of this header) — explicit is
        # simply more correct either way.
        mimetype = super().guess_type(path)
        if isinstance(mimetype, tuple):
            mimetype = mimetype[0]
        if mimetype and mimetype.startswith('text/') or mimetype in ('application/javascript', 'application/json'):
            return f'{mimetype}; charset=utf-8'
        return mimetype

if __name__ == '__main__':
    with socketserver.TCPServer(('', PORT), NoCacheHandler) as httpd:
        print(f"Serving with caching disabled at http://localhost:{PORT}")
        print("Keep this window open. Press Ctrl+C to stop.")
        httpd.serve_forever()
