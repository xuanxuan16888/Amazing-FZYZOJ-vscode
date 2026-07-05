"""Configuration for OJ Proxy Server"""
import os
import json

# 使用相对于 config.py 的路径
_BASE = os.path.dirname(os.path.abspath(__file__))

CONFIG_FILE = os.path.join(_BASE, 'ojserver_config.json')

DEFAULT_CONFIG = {
    "server_host": "0.0.0.0",
    "server_port": 8199,
    "oj_base_url": "https://183.250.108.194:500",
    "admin_users": ["admin"],
    "cookie": "",
    "db_path": "C:\\Users\\xuanxuanmeow\\Desktop\\Code\\FZYZOJ-vscode\\ojserver\\oj_data.db"
}

_config = None

def _resolve_db_path(db_path):
    if not db_path:
        return os.path.join(_BASE, 'oj_data.db')
    if os.path.isabs(db_path):
        if os.path.exists(db_path) or os.path.exists(os.path.dirname(db_path)):
            return db_path
        return os.path.join(_BASE, 'oj_data.db')
    return os.path.join(_BASE, db_path)

def load_config():
    global _config
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
                _config = {**DEFAULT_CONFIG, **json.load(f)}
        except:
            _config = dict(DEFAULT_CONFIG)
    else:
        _config = dict(DEFAULT_CONFIG)
        save_config()
    _config['db_path'] = _resolve_db_path(_config.get('db_path', ''))
    return _config

def save_config():
    global _config
    with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
        json.dump(_config, f, ensure_ascii=False, indent=2)

def get(key, default=None):
    global _config
    if _config is None:
        load_config()
    return _config.get(key, default)

def set(key, value):
    global _config
    if _config is None:
        load_config()
    _config[key] = value
    save_config()