#!/usr/bin/env python
"""Start OJ Proxy Server - self-contained launcher"""
import sys, os

# Add parent dir to path (so 'ojserver' is importable from outside)
_base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(_base)
sys.path.insert(0, _base)

from ojserver.server import run_server
print("Starting OJ Proxy Server on http://127.0.0.1:8199")
print("Admin: http://127.0.0.1:8199/admin/")
run_server()