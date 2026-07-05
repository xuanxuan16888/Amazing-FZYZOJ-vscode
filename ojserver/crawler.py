"""Crawler module for OJ Proxy Server - HTTP fetching utilities"""
import time
import requests
import urllib.parse as _urllib
from bs4 import BeautifulSoup
import config, database

requests.packages.urllib3.disable_warnings()
SESSION = None


def get_session():
    global SESSION
    if SESSION is None:
        SESSION = requests.Session()
        SESSION.verify = False
        SESSION.headers.update({'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'})
        _apply_cookie_to_session()
    return SESSION


def _apply_cookie_to_session():
    global SESSION
    if SESSION is None:
        return
    cookie_str = config.get('cookie', '')
    if not cookie_str:
        return
    if '=' not in cookie_str:
        cookie_str = 'PHPSESSID=' + cookie_str.strip()
    cookies = {}
    for part in cookie_str.split(';'):
        part = part.strip()
        if '=' in part:
            k, v = part.split('=', 1)
            cookies[k.strip()] = v.strip()
    if cookies:
        SESSION.cookies.update(cookies)


def _parse_cookie_string(cookie_str):
    """Parse a raw Cookie header string into a dict."""
    if not cookie_str:
        return {}
    s = str(cookie_str).strip()
    if not s:
        return {}
    if '=' not in s:
        s = 'PHPSESSID=' + s
    result = {}
    for part in s.split(';'):
        part = part.strip()
        if '=' in part:
            k, v = part.split('=', 1)
            result[k.strip()] = v.strip()
    return result


def fetch_html(url, retries=3, custom_cookie=None):
    """
    Fetch URL HTML.
    If custom_cookie (str or dict) is provided, temporarily apply it to a fresh session
    so the request is made with that cookie (preserves global session state).
    """
    last_error = None
    cookie_dict = _parse_cookie_string(custom_cookie) if isinstance(custom_cookie, (str, type(None))) else (custom_cookie or {})
    if not cookie_dict:
        session = get_session()
        for attempt in range(retries):
            try:
                resp = session.get(url, timeout=15)
                resp.encoding = 'utf-8'
                return resp.text
            except Exception as e:
                last_error = e
                if attempt < retries - 1:
                    time.sleep(1 * (attempt + 1))
        raise last_error or Exception("Failed to fetch URL")
    else:
        # Use a one-shot session with only this cookie (preserves global SESSION untouched)
        tmp = requests.Session()
        tmp.verify = False
        tmp.headers.update({'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'})
        tmp.cookies.update(cookie_dict)
        # Visit homepage first to initialize session
        try:
            base = config.get('oj_base_url', '')
            if base:
                tmp.get(base + '/OnlineJudge/', timeout=10)
        except Exception:
            pass
        for attempt in range(retries):
            try:
                resp = tmp.get(url, timeout=15)
                resp.encoding = 'utf-8'
                return resp.text
            except Exception as e:
                last_error = e
                if attempt < retries - 1:
                    time.sleep(1 * (attempt + 1))
        raise last_error or Exception("Failed to fetch URL")


def visit_homepage_first():
    session = get_session()
    base = config.get('oj_base_url', '')
    if not base:
        return
    _apply_cookie_to_session()
    try:
        session.get(base + '/OnlineJudge/', timeout=10)
    except Exception as e:
        print("Homepage visit warning: " + str(e))


def _is_valid_user_html(html, soup=None):
    """Strict check: html/soup must contain a valid user page indicator."""
    if not html:
        return False
    if '\u7528\u6237\u4e0d\u5b58\u5728' in html:
        return False
    if soup is None:
        soup = BeautifulSoup(html, 'html.parser')
    h2 = soup.find('h2')
    if not h2:
        return False
    a_tag = h2.find('a', href=lambda v: v and 'user_show.php' in v if v else False)
    if not a_tag:
        txt = h2.get_text(strip=True)
        if not txt or len(txt) < 1:
            return False
    return True


def find_max_user_id(base_url):
    """Use binary search to find the last valid user ID with strict validation"""
    low, high = 1001, 100000
    last_valid = database.get_max_user_id() or 0
    if last_valid <= 0:
        last_valid = 1000
    probe = last_valid * 2 if last_valid > 0 else 2000
    while probe <= 100000:
        try:
            html = fetch_html(base_url + '/OnlineJudge/user_show.php?id=' + str(probe))
            if _is_valid_user_html(html):
                last_valid = probe
                probe *= 2
            else:
                break
        except Exception:
            break
    high = min(100000, max(last_valid * 2, probe))
    low = max(1001, last_valid // 2)
    while low <= high:
        mid = (low + high) // 2
        try:
            html = fetch_html(base_url + '/OnlineJudge/user_show.php?id=' + str(mid))
            if _is_valid_user_html(html):
                last_valid = mid
                low = mid + 1
            else:
                high = mid - 1
        except Exception:
            high = mid - 1
    return last_valid
