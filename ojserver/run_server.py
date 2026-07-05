#!/usr/bin/env python
"""YZOJ Proxy Server - Launcher"""
import sys
import os
import io

# Fix encoding for Windows console
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

# Add parent dir to path (so 'ojserver' is importable from outside)
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ojserver.server import run_server

if __name__ == '__main__':
    run_server()