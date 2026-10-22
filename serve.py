"""Local dev server: python serve.py [port], then open http://localhost:8000.

Same as `python -m http.server`, but always serves .js as JavaScript. On Windows the stock server
takes MIME types from the registry, which often maps .js to text/plain, and browsers refuse to run
ES modules served that way.
"""
import http.server
import sys

handler = http.server.SimpleHTTPRequestHandler
handler.extensions_map.update({".js": "text/javascript", ".mjs": "text/javascript", ".webmanifest": "application/manifest+json"})
port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
http.server.test(HandlerClass=handler, port=port)
