"""Flask server for OJ Proxy Server"""
import os, json, re, threading, time as time_module
from datetime import datetime, timedelta
from flask import Flask, request, jsonify, send_from_directory, Response
import config, database, crawler
from bs4 import BeautifulSoup

app = Flask(__name__, static_folder=None)

# ---- Global Impersonation State ----
# When an admin impersonates a user, this affects ALL API calls
# regardless of which client (admin panel or extension) makes the request.
_active_impersonation = {'username': None}


def _get_effective_username():
    """Resolve the effective username for permission checks.
    
    Priority:
    1. Global active impersonation (affects ALL API calls) — set by admin panel
    2. Admin session impersonation (per-session) — legacy fallback
    3. 'username' query parameter — regular user flow via extension
    
    This ensures that after admin impersonates a user, EVERY API call
    (from admin panel, extension, or any client) uses the impersonated
    user's identity for permission checks.
    """
    # Priority 1: Global impersonation (affects all clients)
    if _active_impersonation.get('username'):
        return _active_impersonation['username']
    # Priority 2: Per-session admin impersonation
    admin_token = request.headers.get('X-Admin-Token', '')
    if admin_token:
        s = database.validate_admin_session(admin_token)
        if s and s.get('impersonate_username'):
            return s['impersonate_username']
    # Priority 3: Query parameter
    return request.args.get('username', '')

# ---- Debug Logging ----
LOGS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'logs')
os.makedirs(LOGS_DIR, exist_ok=True)

def _debug_log(section, content, raw_html=None, parsed_data=None, source=''):
    try:
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        log_file = os.path.join(LOGS_DIR, f'debug_{timestamp}.log')
        
        with open(log_file, 'w', encoding='utf-8') as f:
            f.write(f"=== DEBUG LOG [{section}] ===\n")
            f.write(f"Source: {source}\n")
            f.write(f"Timestamp: {datetime.now().isoformat()}\n\n")
            
            if content:
                f.write(f"=== CONTENT ===\n{content}\n\n")
            
            if raw_html:
                f.write(f"=== RAW HTML ({len(raw_html)} chars) ===\n")
                if len(raw_html) > 50000:
                    f.write(f"[TRUNCATED TO 50000 chars]\n{raw_html[:50000]}\n")
                else:
                    f.write(raw_html + '\n')
                f.write("\n")
            
            if parsed_data:
                f.write(f"=== PARSED DATA ===\n")
                try:
                    f.write(json.dumps(parsed_data, ensure_ascii=False, indent=2) + '\n')
                except:
                    f.write(str(parsed_data) + '\n')
                f.write("\n")
        
        print(f"[Debug] Logged to: {log_file}")
    except Exception as e:
        print(f"[Debug] Failed to write log: {e}")

# ---- Static Files ----
STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'static')
RELEASES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'releases')
os.makedirs(RELEASES_DIR, exist_ok=True)

@app.route('/')
def index():
    return send_from_directory(STATIC_DIR, 'downloads-landing.html')

@app.route('/downloads')
def downloads_page():
    return send_from_directory(STATIC_DIR, 'downloads.html')

@app.route('/api/releases/list')
def list_releases():
    try:
        files = []
        if os.path.isdir(RELEASES_DIR):
            for name in os.listdir(RELEASES_DIR):
                path = os.path.join(RELEASES_DIR, name)
                if os.path.isfile(path):
                    st = os.stat(path)
                    files.append({
                        'name': name,
                        'size': getattr(st, 'st_size', None),
                        'mtime': datetime.fromtimestamp(st.st_mtime).isoformat() if hasattr(st, 'st_mtime') else None,
                    })
        return jsonify({'success': True, 'files': files})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e), 'files': []}), 500

@app.route('/download/<path:filename>')
def download_release(filename):
    # prevent path traversal
    safe_name = os.path.basename(filename)
    if not safe_name or safe_name != filename:
        return jsonify({'error': '非法文件名'}), 400
    if not os.path.isfile(os.path.join(RELEASES_DIR, safe_name)):
        return jsonify({'error': '文件不存在'}), 404
    return send_from_directory(RELEASES_DIR, safe_name, as_attachment=True)

@app.route('/login.html')
def serve_login():
    return send_from_directory(STATIC_DIR, 'login.html')

@app.route('/user.html')
def serve_user():
    # Auto-register user when their page is accessed
    uid = request.args.get('uid', '')
    username = request.args.get('username', '')
    if uid or username:
        key = username or uid
        try:
            # 先按 uid 查（避免 uid 数字搜索 username 找不到）
            found = False
            if uid:
                conn2 = database.get_conn()
                row = conn2.execute("SELECT username FROM users WHERE uid=?", (uid,)).fetchone()
                if row:
                    found = True
            if not found and not database.get_user(key):
                _try_register_user(key, uid)
        except Exception:
            pass
    return send_from_directory(STATIC_DIR, 'user.html')

@app.route('/admin_user.html')
def serve_admin_user():
    return send_from_directory(STATIC_DIR, 'admin_user.html')

@app.route('/admin.html')
def serve_admin():
    return send_from_directory(STATIC_DIR, 'admin.html')

@app.route('/static/<path:filename>')
def serve_static(filename):
    return send_from_directory(STATIC_DIR, filename)

@app.route('/api/health')
def health():
    return jsonify({'status': 'ok', 'time': datetime.now().isoformat()})

# ---- Image Proxy ----
@app.route('/proxy/image/<path:img_path>')
def proxy_image(img_path):
    """Proxy images from YZOJ to avoid mixed content / self-signed cert issues in VSCode WebView"""
    import requests as _req
    base = config.get('oj_base_url', '')
    img_url = f"{base}/OnlineJudge/{img_path}"
    try:
        cookie_str = config.get('cookie', '')
        cookies = {}
        if cookie_str:
            for part in cookie_str.split(';'):
                part = part.strip()
                if '=' in part:
                    k, v = part.split('=', 1)
                    cookies[k.strip()] = v.strip()
        resp = _req.get(img_url, timeout=15, verify=False, cookies=cookies if cookies else None)
        content_type = resp.headers.get('Content-Type', 'image/png')
        return Response(resp.content, content_type=content_type)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# ---- Helper: Verify YZOJ Token ----
import urllib.parse as _uparse

def verify_yzoj_token(username, token):
    try:
        test_html = crawler.fetch_html(f"{config.get('oj_base_url')}/OnlineJudge/")
        from bs4 import BeautifulSoup
        soup = BeautifulSoup(test_html, 'html.parser')
        user_link = soup.find('a', href=lambda v: v and 'logout' in v if v else False)
        if user_link:
            return True
        return False
    except:
        return False

def verify_yzoj_username_match(username, token):
    try:
        old_cookie = config.get('cookie', '')
        config.set('cookie', token)
        crawler.visit_homepage_first()
        html = crawler.fetch_html(f"{config.get('oj_base_url')}/OnlineJudge/")
        config.set('cookie', old_cookie)
        crawler._apply_cookie_to_session()
        from bs4 import BeautifulSoup
        soup = BeautifulSoup(html, 'html.parser')
        for a in soup.find_all('a', href=re.compile(r'user_show\.php\?id=')):
            text = a.get_text(strip=True)
            if text == username or text in username or username in text:
                return True
        return False
    except:
        return False

# ---- YZOJ Token Auth ----
def verify_yzoj_uid_by_cookie(cookie_str):
    """Verify YZOJ cookie and return the user's UID from the page"""
    try:
        old_cookie = config.get('cookie', '')
        config.set('cookie', cookie_str)
        crawler.visit_homepage_first()
        html = crawler.fetch_html(f"{config.get('oj_base_url')}/OnlineJudge/")
        config.set('cookie', old_cookie)
        crawler._apply_cookie_to_session()
        # Extract user UID from current_user() JS function
        m = re.search(r"function current_user\(\)\s*\{\s*return\s+(\d+)\s*;", html)
        if m:
            return m.group(1)
        return None
    except:
        return None

def is_admin_uid(uid):
    """Check if a YZOJ UID is in the admin list"""
    return str(uid) in config.get('admin_users', ['admin'])

# ---- Auth ----
@app.route('/api/yzoj/admin/verify', methods=['POST'])
def yzoj_admin_verify():
    """Verify YZOJ token and check if user is admin by UID"""
    data = request.json or {}
    token = data.get('token', '')
    if not token:
        return jsonify({'success': False, 'message': '缺少Token'}), 400
    uid = verify_yzoj_uid_by_cookie(token)
    if not uid:
        return jsonify({'success': False, 'message': 'Token无效'}), 401
    is_admin = is_admin_uid(uid)
    return jsonify({'success': True, 'uid': uid, 'is_admin': is_admin})

@app.route('/api/yzoj/admin/config', methods=['GET', 'POST'])
def yzoj_admin_config():
    """Get/set admin UID list (requires existing admin token)"""
    data = request.json or {}
    token = data.get('token', '')
    
    # Resolve admin identity: prefer YZOJ cookie token, fallback to admin session
    uid = None
    if token:
        uid = verify_yzoj_uid_by_cookie(token)
    else:
        # For GET requests lacking body token, try admin session header
        adm_token = request.headers.get('X-Admin-Token', '')
        if adm_token:
            adm = database.validate_admin_session(adm_token)
            if adm:
                uid = adm.get('username', '')  # admin session stores UID as username
    
    if not uid or not is_admin_uid(uid):
        if not token and not adm_token:
            return jsonify({'success': False, 'message': '缺少Token'}), 400
        return jsonify({'success': False, 'message': '权限不足'}), 403
    
    if request.method == 'POST':
        new_admins = data.get('admin_uids', [])
        config.set('admin_users', [str(u) for u in new_admins])
        config.save_config()
        return jsonify({'success': True, 'admin_uids': config.get('admin_users')})
    return jsonify({'admin_uids': config.get('admin_users', [])})

@app.route('/api/root/setup', methods=['POST'])
def root_setup():
    if database.root_exists():
        return jsonify({'success': False, 'message': 'Root 已经存在'}), 400
    data = request.json or {}
    password = data.get('password', '')
    if len(password) < 6:
        return jsonify({'success': False, 'message': '密码至少6位'}), 400
    database.create_root(password)
    return jsonify({'success': True, 'message': 'Root 账户已创建'})

@app.route('/api/root/check')
def root_check():
    return jsonify({'exists': database.root_exists()})

@app.route('/api/admin/login', methods=['POST'])
def admin_login():
    data = request.json or {}
    mode = data.get('mode', 'password')
    if mode == 'yzoj':
        yzoj_token = data.get('token', '')
        if not yzoj_token:
            return jsonify({'success': False, 'message': '缺少YZOJ Token (Cookie)'}), 400
        uid = verify_yzoj_uid_by_cookie(yzoj_token)
        if not uid:
            return jsonify({'success': False, 'message': 'YZOJ Token 无效或已过期'}), 401
        if not is_admin_uid(uid):
            return jsonify({'success': False, 'message': f'用户 (UID {uid}) 不在管理员列表中'}), 403
        yzoj_username = uid
        try:
            user_html = crawler.fetch_html(f"{config.get('oj_base_url')}/OnlineJudge/user_show.php?id={uid}", custom_cookie=yzoj_token)
            from bs4 import BeautifulSoup
            soup = BeautifulSoup(user_html, 'html.parser')
            h2 = soup.find('h2')
            if h2:
                h2a = h2.find('a', href=lambda v: v and 'user_show.php' in str(v) if v else False)
                if h2a:
                    yzoj_username = h2a.get_text(strip=True).replace('(我)', '').strip()
        except Exception as e_yz:
            print(f"[admin/login] fetch username error: {e_yz}")
        token = database.create_admin_session(yzoj_username)
        # 持久化保存 YZOJ Cookie，避免刷新后需要重新输入
        config.set('cookie', yzoj_token)
        config.save_config()
        return jsonify({'success': True, 'logged_in': True, 'token': token, 'username': yzoj_username, 'role': 'admin', 'yzoj_uid': uid})
    return jsonify({'success': False, 'message': '仅支持YZOJ Token登录'}), 400

@app.route('/api/admin/check')
def admin_check():
    s = database.validate_admin_session(request.headers.get('X-Admin-Token', ''))
    if not s:
        return jsonify({'valid': False})
    return jsonify({
        'valid': True,
        'username': s.get('username', ''),
        'impersonating': bool(_active_impersonation.get('username')),
        'impersonate_username': _active_impersonation.get('username') or ''
    })

@app.route('/api/admin/config/admins', methods=['GET', 'POST'])
def admin_config_admins():
    s = database.validate_admin_session(request.headers.get('X-Admin-Token', ''))
    if not s: return jsonify({'success': False, 'message': '未授权'}), 401
    admin_uids = config.get('admin_users', [])
    if request.method == 'GET':
        return jsonify({'admin_uids': admin_uids})
    data = request.json or {}
    new_admins = data.get('admin_uids', [])
    config.set('admin_users', [str(u) for u in new_admins])
    config.save_config()
    return jsonify({'success': True, 'admin_uids': config.get('admin_users')})

@app.route('/api/admin/logout', methods=['POST'])
def admin_logout():
    database.delete_admin_session(request.headers.get('X-Admin-Token', ''))
    return jsonify({'success': True})

@app.route('/api/admin/users', methods=['GET', 'POST', 'DELETE'])
def admin_users_manage():
    s = database.validate_admin_session(request.headers.get('X-Admin-Token', ''))
    if not s: return jsonify({'success': False, 'message': '未授权'}), 401
    if s['username'] != 'root': return jsonify({'success': False, 'message': '仅 root 可管理'}), 403
    if request.method == 'GET':
        return jsonify({'users': database.get_all_admin_users()})
    elif request.method == 'POST':
        data = request.json or {}
        uname = data.get('username', '')
        pwd = data.get('password', '')
        role = data.get('role', 'admin')
        if not uname or not pwd: return jsonify({'success': False, 'message': '参数不完整'}), 400
        database.create_admin_user(uname, pwd, role)
        return jsonify({'success': True, 'message': f'用户 {uname} 已创建'})
    elif request.method == 'DELETE':
        data = request.json or {}
        uname = data.get('username', '')
        if uname == 'root': return jsonify({'success': False, 'message': '不能删除 root'}), 400
        database.delete_admin_user(uname)
        return jsonify({'success': True, 'message': f'用户 {uname} 已删除'})

# ---- Stats ----
@app.route('/api/stats')
def stats_api():
    """Get basic statistics."""
    try:
        return jsonify(database.get_stats())
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ---- Homepage ----
@app.route('/api/homepage')
def homepage_api():
    """Get homepage content."""
    try:
        base = config.get('oj_base_url')
        html = crawler.fetch_html(f"{base}/OnlineJudge/")
        return jsonify({'html': html, 'success': True})
    except Exception as e:
        return jsonify({'error': str(e), 'success': False}), 500


# ---- Discussion Search ----
@app.route('/api/discussions/search')
def search_discussions_api():
    """Search discussions (placeholder returning empty results)."""
    return jsonify({'discussions': [], 'total': 0, 'total_pages': 1})


# ---- Problem Solutions ----
@app.route('/api/problems/<pid>/solutions')
def problem_solutions_api(pid):
    """Get solutions for a problem."""
    try:
        conn = database.get_conn()
        rows = conn.execute(
            "SELECT * FROM solutions WHERE problem_id=? ORDER BY created_at DESC",
            (pid,)
        ).fetchall()
        return jsonify([dict(r) for r in rows])
    except Exception as e:
        return jsonify([])


# ---- Crawl Status (returns current status without auth - for admin panel) ----
@app.route('/api/crawl/status')
def crawl_status_api():
    try:
        return jsonify(database.get_crawl_status())
    except Exception as e:
        return jsonify({'status': 'idle', 'error': str(e)})


# ---- Crawl Operations (stubs for admin panel compatibility) ----
@app.route('/api/crawl/all', methods=['POST'])
def crawl_all():
    return jsonify({'success': True, 'message': '爬取请求已提交'})

@app.route('/api/crawl/new', methods=['POST'])
def crawl_new():
    return jsonify({'success': True, 'message': '爬取新题目请求已提交'})

@app.route('/api/crawl/contests', methods=['POST'])
def crawl_contests():
    return jsonify({'success': True, 'message': '爬取比赛请求已提交'})

@app.route('/api/crawl/new/contests', methods=['POST'])
def crawl_new_contests():
    return jsonify({'success': True, 'message': '爬取新比赛请求已提交'})

@app.route('/api/crawl/users', methods=['POST'])
def crawl_users():
    return jsonify({'success': True, 'message': '爬取用户请求已提交'})

@app.route('/api/crawl/new/users', methods=['POST'])
def crawl_new_users():
    return jsonify({'success': True, 'message': '爬取新用户请求已提交'})

@app.route('/api/crawl/single', methods=['POST'])
def crawl_single():
    return jsonify({'success': True, 'message': '单题爬取请求已提交'})

@app.route('/api/crawl/single/contest', methods=['POST'])
def crawl_single_contest():
    return jsonify({'success': True, 'message': '单比赛爬取请求已提交'})

@app.route('/api/crawl/single/user', methods=['POST'])
def crawl_single_user():
    return jsonify({'success': True, 'message': '单用户爬取请求已提交'})

@app.route('/api/crawl/pause', methods=['POST'])
def crawl_pause():
    return jsonify({'success': True, 'message': '已暂停'})

@app.route('/api/crawl/resume', methods=['POST'])
def crawl_resume():
    return jsonify({'success': True, 'message': '已恢复'})

@app.route('/api/crawl/stop', methods=['POST'])
def crawl_stop():
    return jsonify({'success': True, 'message': '已停止'})


@app.route('/api/users/search')
def search_users_api():
    params = {}
    for k in ['keyword', 'sort_by', 'sort_order']:
        v = request.args.get(k, '').strip()
        if v: params[k] = v
    params['page'] = int(request.args.get('page', 1))
    params['page_size'] = int(request.args.get('page_size', 50))
    try:
        result = database.search_users(params)
        for u in result.get('users', []):
            u['tags'] = _normalize_tags(database.get_user_tags(u.get('username') or u.get('uid') or ''))
        return jsonify(result)
    except Exception as e: return jsonify({'error': str(e), 'users': [], 'total': 0}), 500

# ---- Stats ----
@app.route('/api/config')
def get_config():
    return jsonify({
        'oj_base_url': config.get('oj_base_url'),
    })

@app.route('/api/config/base_url', methods=['POST'])
def set_base_url():
    s = database.validate_admin_session(request.headers.get('X-Admin-Token', ''))
    if not s: return jsonify({'success': False, 'message': '未授权'}), 401
    data = request.json or {}
    base_url = (data.get('base_url') or data.get('oj_base_url') or '').strip()
    if not base_url:
        return jsonify({'success': False, 'message': 'OJ 基础 URL 不能为空'}), 400
    if not (base_url.startswith('http://') or base_url.startswith('https://')):
        return jsonify({'success': False, 'message': 'URL 必须以 http:// 或 https:// 开头'}), 400
    base_url = base_url.rstrip('/')
    old = config.get('oj_base_url', '')
    config.set('oj_base_url', base_url)
    return jsonify({'success': True, 'message': 'OJ 基础 URL 已更新', 'old': old, 'new': base_url})

# ---- Homepage ----
# ---- Homepage ----

@app.route('/api/user/detail')
def get_user_detail_api():
    """Get detailed user info by UID from YZOJ page"""
    uid = request.args.get('uid', '')
    if not uid:
        return jsonify({'error': '缺少UID'}), 400
    base = config.get('oj_base_url')
    try:
        html = crawler.fetch_html(f"{base}/OnlineJudge/user_show.php?id={uid}")
        soup = BeautifulSoup(html, 'html.parser')
        data = {'uid': uid, 'username': '', 'realname': '', 'school': '', 'email': '', 'level': '', 'solved_count': 0, 'submission_count': 0, 'pass_rate': '', 'solved_problems': []}
        h2 = soup.find('h2')
        if h2:
            h2text = h2.get_text(strip=True)
            m = re.search(r'-\s*(.+?)$', h2text)
            if m: data['username'] = m.group(1).strip()
            else: data['username'] = h2text.strip()
        info_table = soup.find('table', style=lambda v: v and '90%' in str(v) if v else False)
        if info_table:
            tds = info_table.find_all('td')
            for i, td in enumerate(tds):
                txt = td.get_text(strip=True)
                if '真实姓名' in txt and i+1 < len(tds): data['realname'] = tds[i+1].get_text(strip=True)
                if '提交次数' in txt and i+1 < len(tds):
                    m = re.search(r'(\d+)', tds[i+1].get_text(strip=True))
                    if m: data['submission_count'] = int(m.group(1))
                if '学校' in txt and i+1 < len(tds): data['school'] = tds[i+1].get_text(strip=True)
                if 'E-mail' in txt or 'Email' in txt:
                    if i+1 < len(tds): data['email'] = tds[i+1].get_text(strip=True)
        # Extract solved problems list (3rd column in the info table)
        if info_table:
            rows = info_table.find_all('tr')
            for row in rows:
                tds2 = row.find_all('td')
                if len(tds2) >= 3:
                    third_col = tds2[2]
                    problems_html = str(third_col)
                    # Find all problem links
                    # Actually problems are in the third column with <a> tags pointing to problem_show.php
                    solved = []
                    for a in third_col.find_all('a', href=re.compile(r'problem_show\.php\?id=')):
                        pid = re.search(r'id=(\d+)', a.get('href', ''))
                        if pid:
                            solved.append({'id': pid.group(1), 'name': a.get_text(strip=True)})
                    if solved:
                        data['solved_problems'] = solved
        # Extract solved count from text
        pt = soup.get_text()
        sm = re.search(r'解决题数[\s]*(\d+)', pt)
        if sm: data['solved_count'] = int(sm.group(1))
        pm = re.search(r'(\d+\.?\d*)%\s*\((\d+)/(\d+)\)', pt)
        if pm:
            data['pass_rate'] = pm.group(1) + '%'
        return jsonify(data)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/user/status_history')
def get_user_status_history():
    """Deprecated: use activityData from /api/user/profile/full instead.
    Previously fetched AC records to compute first-AC per day heatmap.
    Now returns empty array to remain API-compatible without doing AC-record crawling."""
    return jsonify([])

@app.route('/api/user/profile')
def get_user_profile():
    """Get user profile info from YZOJ user_show.php page (matching extension's parseUserPage logic)"""
    uid = request.args.get('uid', '')
    if not uid:
        return jsonify({'error': '缺少UID'}), 400
    base = config.get('oj_base_url')
    try:
        html = crawler.fetch_html(f"{base}/OnlineJudge/user_show.php?id={uid}")
        soup = BeautifulSoup(html, 'html.parser')
        data = {'uid': uid, 'username': '', 'realname': '', 'school': '', 'email': '', 'level': '', 'solved_count': 0, 'submission_count': 0, 'pass_rate': '', 'solved_problems': [], 'rank': '', 'rating': ''}
        
        # Parse h2 for username - mirroring parseUserPage
        h2 = soup.find('h2')
        username = ''
        if h2:
            h2a = h2.find('a', href=lambda v: v and 'user_show.php' in v if v else False)
            if h2a:
                username = h2a.get_text(strip=True).replace('(我)', '').strip()
            if not username:
                h2text = h2.get_text(strip=True)
                m = re.search(r'-\s*(.+?)$', h2text)
                if m: username = m.group(1).strip()
                else: username = h2text.strip()
        if username:
            data['username'] = username
        
        # Parse #tablelist for user info - mirroring parseUserPage
        tablelist = soup.find(id='tablelist')
        if tablelist:
            rows = tablelist.find_all('tr')
            for row in rows:
                tds = row.find_all('td')
                if len(tds) < 2: continue
                label = tds[0].get_text(strip=True)
                value = tds[1].get_text(strip=True)
                if '真实姓名' in label: data['realname'] = value
                elif '提交次数' in label:
                    m = re.search(r'(\d+)', value)
                    if m: data['submission_count'] = int(m.group(1))
                elif '解决题数' in label:
                    m = re.search(r'(\d+)', value)
                    if m: data['solved_count'] = int(m.group(1))
                elif '学校' in label: data['school'] = value
                elif 'E-mail' in label or 'Email' in label: data['email'] = value
                elif '等级' in label: data['level'] = value
                # Parse solved problems from third column
                if len(tds) >= 3:
                    third_col = tds[2]
                    solved = []
                    for a in third_col.find_all('a', href=lambda v: v and 'problem_show.php' in v if v else False):
                        href = a.get('href', '')
                        pid_m = re.search(r'id=(\d+)', href)
                        if pid_m:
                            solved.append({'id': pid_m.group(1), 'name': a.get_text(strip=True)})
                    if solved: data['solved_problems'] = solved
        
        # Parse rank and pass_rate from full text
        pt = soup.get_text()
        sm = re.search(r'解决题数[\s]*(\d+)', pt)
        if sm: data['solved_count'] = int(sm.group(1))
        pm = re.search(r'(\d+\.?\d*)%\s*\((\d+)/(\d+)\)', pt)
        if pm: data['pass_rate'] = pm.group(1) + '%'
        rm = re.search(r'排名[\s]*(\d+)', pt)
        if rm: data['rank'] = rm.group(1)
        
        return jsonify(data)
    except Exception as e:
        print(f"[Error] get_user_profile({uid}): {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/user/heatmap')
def get_user_heatmap():
    """Get user heatmap data based on submissions in database"""
    uid = request.args.get('uid', '')
    if not uid:
        return jsonify({'error': '缺少UID'}), 400
    try:
        conn = database.get_conn()
        cursor = conn.execute('''
            SELECT s.submit_time, s.score, s.status, p.difficulty
            FROM status s 
            LEFT JOIN problems p ON s.problem_id = p.id
            WHERE s.user_id = ? AND s.submit_time IS NOT NULL
            ORDER BY s.submit_time DESC
        ''', (uid,))
        
        daily_stats = {}
        solved_today = set()
        
        for row in cursor.fetchall():
            submit_time = row[0]
            score = row[1]
            status = row[2]
            difficulty = row[3]
            
            if not submit_time:
                continue
            
            date_m = re.match(r'(\d{4}-\d{2}-\d{2})', submit_time)
            if not date_m:
                continue
            date_str = date_m.group(1)
            
            is_ac = status and (status.upper() == 'AC' or (isinstance(score, int) and score >= 100))
            
            if date_str not in daily_stats:
                daily_stats[date_str] = {'count': 0, 'new_solved': 0, 'max_difficulty': 0, 'solved_set': set()}
            
            daily_stats[date_str]['count'] += 1
            
            if is_ac and submit_time not in solved_today:
                daily_stats[date_str]['new_solved'] += 1
                daily_stats[date_str]['solved_set'].add(submit_time)
                solved_today.add(submit_time)
                
                if difficulty:
                    try:
                        diff_num = float(difficulty)
                        if diff_num > daily_stats[date_str]['max_difficulty']:
                            daily_stats[date_str]['max_difficulty'] = diff_num
                    except:
                        pass
        
        result = []
        for date_str in sorted(daily_stats.keys()):
            ds = daily_stats[date_str]
            result.append({
                'date': date_str,
                'count': ds['count'],
                'new_solved': ds['new_solved'],
                'max_difficulty': ds['max_difficulty']
            })
        
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/users/<username>')
def get_user_info(username):
    user = database.get_user(username)
    if user: return jsonify(user)
    # 自动从 YZOJ 注册（对于 uid 数字，_try_register_user 会解析实际用户名）
    try:
        _try_register_user(username, username if username.isdigit() else None)
    except Exception:
        pass
    user = database.get_user(username)
    if user: return jsonify(user)
    # 如果 username 是数字 uid，再按解析后的用户名查一次
    if username.isdigit():
        conn = database.get_conn()
        row = conn.execute("SELECT * FROM users WHERE uid=?", (username,)).fetchone()
        if row:
            return jsonify(dict(row))
    return jsonify({'error': '未找到该用户', 'username': username}), 404

# ---- User Auth API ----
def get_user_session():
    token = request.headers.get('X-User-Token', '')
    if not token:
        token = request.cookies.get('user_token', '')
    _debug_log('get_user_session',
               f"X-User-Token: {token[:20]}...",
               source='get_user_session')
    if not token:
        return None
    session = None
    try:
        session = database.validate_user_session(token)
    except Exception as _e_us:
        print(f"[get_user_session] validate_user_session error: {_e_us}")
        session = None
    _debug_log('get_user_session_result',
               f"Session validated: {session is not None}",
               parsed_data=session,
               source='validate_user_session')
    return session

def get_any_session():
    """
    Unified auth helper: returns an auth session dict if ANY valid login is present
    (preference: user login via X-User-Token, then admin login via X-Admin-Token).
    Return dict always exposes is_admin, yzoj_username, yzoj_uid fields consistently.
    Returns None if no valid login at all.
    """
    # Try user login first (full profile + is_admin flag)
    user_sess = get_user_session()
    if user_sess:
        return {
            'source': 'user',
            'token': request.headers.get('X-User-Token', '') or request.cookies.get('user_token', ''),
            'yzoj_uid': user_sess.get('yzoj_uid', ''),
            'yzoj_username': user_sess.get('yzoj_username', ''),
            'yzoj_cookie': user_sess.get('yzoj_cookie', ''),
            'is_admin': bool(user_sess.get('is_admin', False)),
            '_raw': user_sess,
        }
    # Try admin login (admin_sessions: username field stores UID)
    admin_token = request.headers.get('X-Admin-Token', '')
    if not admin_token:
        admin_token = request.cookies.get('admin_token', '')
    if admin_token:
        adm = database.validate_admin_session(admin_token)
        if adm:
            adm_uid = adm.get('username', '')  # admin_sessions.username stores UID actually
            adm_uname = ''
            # Try resolve a username for this UID for convenience
            try:
                if adm_uid:
                    r_uid, r_uname = database.resolve_user_id(adm_uid, '')
                    if r_uname:
                        adm_uname = r_uname
            except Exception:
                pass
            return {
                'source': 'admin',
                'token': admin_token,
                'yzoj_uid': adm_uid,
                'yzoj_username': adm_uname,
                'yzoj_cookie': '',
                'is_admin': True,
                '_raw': adm,
            }
    return None

@app.route('/api/user/login', methods=['POST'])
def user_login():
    data = request.json or {}
    yzoj_cookie = data.get('yzoj_cookie', '')
    if not yzoj_cookie:
        return jsonify({'success': False, 'message': '缺少YZOJ Cookie'}), 400
    try:
        # 使用YZOJ cookie验证用户身份
        old_cookie = config.get('cookie', '')
        config.set('cookie', yzoj_cookie)
        crawler.visit_homepage_first()
        html = crawler.fetch_html(f"{config.get('oj_base_url')}/OnlineJudge/")
        config.set('cookie', old_cookie)
        crawler._apply_cookie_to_session()
        
        _debug_log('user_login', f"YZOJ Cookie: {yzoj_cookie[:20]}...", raw_html=html, source='YZOJ Homepage')
        
        from bs4 import BeautifulSoup
        soup = BeautifulSoup(html, 'html.parser')
        
        # 从页面提取用户信息
        yzoj_uid = None
        yzoj_username = ''
        yzoj_user_color = '#2563EB'  # default color
        yzoj_permission_level = 0    # permission level
        
        uid_m = re.search(r"function current_user\(\)\s*\{\s*return\s+(\d+)\s*;", html)
        if uid_m:
            yzoj_uid = uid_m.group(1)
        
        # Find userinfo div for color and permission level
        userinfo_div = soup.find(id='userinfo')
        _debug_log('user_login_userinfo', 
                   f"userinfo_div found: {userinfo_div is not None}", 
                   raw_html=str(userinfo_div) if userinfo_div else None,
                   source='userinfo div extraction')
        
        if userinfo_div:
            # Find user link in userinfo - matches pattern from example.html
            user_link = userinfo_div.find('a', href=lambda v: v and 'user_show.php?id=' in str(v) if v else False)
            _debug_log('user_login_userlink',
                       f"user_link found: {user_link is not None}",
                       raw_html=str(user_link) if user_link else None,
                       source='user link extraction')
            
            if user_link:
                yzoj_username = user_link.get_text(strip=True)
                # Extract color from span style (pattern: color:#EFA216)
                style = user_link.get('style', '')
                if not style:
                    user_span = user_link.find('span')
                    if user_span:
                        style = user_span.get('style', '')
                color_m = re.search(r'color\s*:\s*([#\w]+)', style)
                if color_m:
                    yzoj_user_color = color_m.group(1)
                
                _debug_log('user_login_userspan',
                           f"style: {style}, extracted color: {yzoj_user_color}",
                           raw_html=str(user_link) if user_link else None,
                           source='user color extraction')
                
                # Find permission level (georgia font is the key feature)
                # Direct regex search in userinfo div HTML (most reliable)
                userinfo_html = str(userinfo_div) if userinfo_div else ''
                perm_m = re.search(r'<span[^>]*style[^>]*font-family:\s*georgia[^>]*>([\d.]+)</span>', userinfo_html, re.I)
                if perm_m:
                    _pv = perm_m.group(1)
                    yzoj_permission_level = int(_pv) if '.' not in _pv else float(_pv)
                
                _debug_log('user_login_permission',
                           f"permission level: {yzoj_permission_level}",
                           raw_html=userinfo_html,
                           source='permission level extraction')
        
        # Fallback: find user link anywhere
        if not yzoj_username:
            user_link = soup.find('a', href=lambda v: v and 'user_show.php' in v if v else False)
            if user_link:
                yzoj_username = user_link.get_text(strip=True)
            else:
                for a in soup.find_all('a', href=re.compile(r'user_show\.php\?id=')):
                    text = a.get_text(strip=True)
                    if text:
                        yzoj_username = text
                        break
        
        _debug_log('user_login_result',
                   f"Extracted - uid: {yzoj_uid}, username: {yzoj_username}, color: {yzoj_user_color}, permission: {yzoj_permission_level}",
                   parsed_data={
                       'yzoj_uid': yzoj_uid,
                       'yzoj_username': yzoj_username,
                       'yzoj_user_color': yzoj_user_color,
                       'yzoj_permission_level': yzoj_permission_level,
                       'is_admin': is_admin_uid(yzoj_uid) if yzoj_uid else False,
                   },
                   source='login result')
        
        if not yzoj_uid:
            return jsonify({'success': False, 'message': 'YZOJ Cookie无效或已过期'}), 401
        
        # 检查是否是admin
        is_admin = is_admin_uid(yzoj_uid)
        
        # 创建session (include color and permission level)
        token = database.create_user_session(yzoj_cookie, yzoj_uid, yzoj_username, is_admin, yzoj_user_color, yzoj_permission_level)

        def _enrich_with_profile(base_dict, uid, uname):
            av, hv, sig = '', '', ''
            _av_user = None
            _db_uname = ''
            for lk in [uname, uid]:
                if not lk: continue
                p = database.get_user_profile(lk)
                if p:
                    if not av and p.get('avatar_url'):
                        av = p['avatar_url']
                        if not av.startswith('http'):
                            av = request.host_url.rstrip('/') + av
                    if not hv and p.get('header_image_url'):
                        hv = p['header_image_url']
                        if not hv.startswith('http'):
                            hv = request.host_url.rstrip('/') + hv
                    if not sig and p.get('signature'):
                        sig = p['signature']
                    if not _av_user:
                        _av_user = p
                    if not _db_uname and p.get('username'):
                        _cand = str(p['username']).strip()
                        if _cand and not _cand.isdigit():
                            _db_uname = _cand
            r_uname = ''
            for _c in [uname, _db_uname]:
                if _c and str(_c).strip() and not str(_c).strip().isdigit():
                    r_uname = str(_c).strip()
                    break
            if not r_uname and uname and str(uname).strip():
                r_uname = str(uname).strip()
            if not r_uname or str(r_uname).strip().isdigit():
                r_uname = 'User #' + (str(uid or '0'))
            base_dict['username'] = r_uname
            base_dict['avatar_url'] = av
            base_dict['avatarUrl'] = av
            base_dict['header_image_url'] = hv
            base_dict['signature'] = sig
            return base_dict

        resp = {
            'success': True,
            'logged_in': True,
            'token': token,
            'uid': yzoj_uid,
            'username': yzoj_username,
            'is_admin': is_admin,
            'user_color': yzoj_user_color,
            'permission_level': yzoj_permission_level,
        }
        _enrich_with_profile(resp, yzoj_uid, yzoj_username)
        return jsonify(resp)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'message': '登录失败: ' + str(e)}), 500

@app.route('/api/user/logout', methods=['POST'])
def user_logout():
    token = request.headers.get('X-User-Token', '') or request.cookies.get('user_token', '')
    if token:
        database.delete_user_session(token)
    return jsonify({'success': True, 'message': '已退出登录'})

@app.route('/api/user/check')
def user_check():
    session = get_user_session()
    _debug_log('user_check',
               f"Session found: {session is not None}",
               parsed_data=session,
               source='user_check')
    
    if session:
        yzoj_uid = session.get('yzoj_uid')
        yzoj_username = session.get('yzoj_username')
        is_admin = bool(session.get('is_admin'))
        av, hv, sig = '', '', ''
        db_username = ''
        for lk in [yzoj_username, yzoj_uid]:
            if not lk: continue
            p = database.get_user_profile(lk)
            if p:
                if not av and p.get('avatar_url'):
                    av = p['avatar_url']
                    if not av.startswith('http'):
                        av = request.host_url.rstrip('/') + av
                if not hv and p.get('header_image_url'):
                    hv = p['header_image_url']
                    if not hv.startswith('http'):
                        hv = request.host_url.rstrip('/') + hv
                if not sig and p.get('signature'):
                    sig = p['signature']
                if not db_username and p.get('username'):
                    cand = str(p['username']).strip()
                    if cand and not cand.isdigit():
                        db_username = cand
        display_name = ''
        for _cand in [yzoj_username, db_username]:
            if _cand and str(_cand).strip() and not str(_cand).strip().isdigit():
                display_name = str(_cand).strip()
                break
        if not display_name and yzoj_username and str(yzoj_username).strip():
            display_name = str(yzoj_username).strip()
        if not display_name or str(display_name).strip().isdigit():
            display_name = 'User #' + (str(yzoj_uid or '0'))
        return jsonify({
            'logged_in': True,
            'uid': yzoj_uid,
            'username': display_name,
            'is_admin': is_admin,
            'avatar_url': av,
            'avatarUrl': av,
            'header_image_url': hv,
            'signature': sig,
            'user_color': session.get('yzoj_user_color', ''),
            'permission_level': session.get('yzoj_permission_level', 0),
        })
    return jsonify({'logged_in': False})

# ---- Admin User Management API ----
@app.route('/api/admin/users/profiles')
def get_all_user_profiles():
    session = get_user_session()
    if not session:
        return jsonify({'error': '未登录'}), 401
    if not session.get('is_admin'):
        return jsonify({'error': '权限不足'}), 403
    
    conn = database.get_conn()
    rows = conn.execute("SELECT * FROM user_profiles ORDER BY updated_at DESC").fetchall()
    return jsonify([dict(r) for r in rows])

@app.route('/api/admin/users/list')
def get_users_list():
    session = get_user_session()
    if not session:
        return jsonify({'error': '未登录'}), 401
    if not session.get('is_admin'):
        return jsonify({'error': '权限不足'}), 403
    
    params = {k: request.args.get(k, '') for k in ['keyword', 'sort_by', 'sort_order']}
    params['page'] = int(request.args.get('page', 1))
    params['page_size'] = int(request.args.get('page_size', 50))
    return jsonify(database.search_users(params))


@app.route('/api/admin/users/manage', methods=['DELETE'])
def admin_delete_user():
    """Admin delete a regular user (cascade all related data). Requires admin session (X-Admin-Token)."""
    s = database.validate_admin_session(request.headers.get('X-Admin-Token', ''))
    if not s:
        return jsonify({'success': False, 'message': '未授权'}), 401
    data = request.json or {}
    username = (data.get('username') or '').strip()
    if not username:
        return jsonify({'success': False, 'message': '缺少 username 参数'}), 400

    admin_name = s.get('username') or ''
    if str(username).lower() == str(admin_name).lower():
        return jsonify({'success': False, 'message': '不能删除当前登录的管理员账号'}), 400
    if str(username).lower() == 'root':
        return jsonify({'success': False, 'message': '不能删除 root 管理员账号'}), 400

    conn = database.get_conn()
    protected = conn.execute(
        "SELECT username FROM admin_users WHERE LOWER(username)=LOWER(?) LIMIT 1",
        (username,)
    ).fetchone()
    if protected:
        return jsonify({'success': False, 'message': '该账号是后台管理员，请先在管理Tab移除管理员身份再删除'}), 400

    try:
        counts = database.delete_user(username)
        if counts.get('_deleted_user', 0) <= 0:
            return jsonify({'success': False, 'message': '用户不存在'}), 404
        return jsonify({'success': True, 'message': '删除成功', 'counts': counts})
    except Exception as e:
        print(f"[admin/delete_user] error: {e}")
        return jsonify({'success': False, 'message': f'删除失败: {str(e)}'}), 500

# ---- User Profile API ----
def _try_register_user(lookup_key, lookup_uid=None):
    """尝试从 YZOJ 获取用户基本信息并在本地数据库登记"""
    # 先检查用户是否已存在（同时按 uid 和 key 查），避免重复注册
    _existing = None
    if lookup_uid:
        _conn = database.get_conn()
        _row = _conn.execute("SELECT username FROM users WHERE uid=?", (lookup_uid,)).fetchone()
        if _row:
            _existing = dict(_row)
    if not _existing and lookup_key:
        _existing = database.get_user(lookup_key)
    if _existing:
        return
    try:
        base = config.get('oj_base_url')
        uid_param = lookup_uid or lookup_key
        html = crawler.fetch_html(f"{base}/OnlineJudge/user_show.php?id={uid_param}")
        from bs4 import BeautifulSoup
        soup = BeautifulSoup(html, 'html.parser')
        
        # 从 YZOJ 页面解析实际用户名（h2 > a 的文本）
        actual_username = lookup_key
        nickname = ''
        h2 = soup.find('h2')
        if h2:
            a_tag = h2.find('a')
            if a_tag:
                raw = a_tag.get_text(strip=True).replace('(我)', '').strip()
                if raw:
                    actual_username = raw
                # 昵称同样从 a 标签获取
                nickname = a_tag.get_text(strip=True).replace('(我)', '').strip()
            else:
                raw = h2.get_text(strip=True).replace('(我)', '').strip()
                if raw:
                    actual_username = raw
                nickname = raw
        
        # 如果解析出的用户名是全数字（等于 uid），说明页面解析失败（可能 cookie 无效），不注册
        if str(actual_username).strip().isdigit() and str(actual_username).strip() == str(uid_param).strip():
            print(f"[auto-register] Skipped: parsed username '{actual_username}' is numeric uid, page may not be accessible")
            return
        
        data = {
            'username': actual_username,
            'uid': str(uid_param),
            'nickname': nickname or actual_username,
            'solved_count': 0,
            'submission_count': 0,
            'rating': 0
        }
        pt = soup.get_text()
        sm = re.search(r'解决.*?(\d+)', pt)
        if sm: data['solved_count'] = int(sm.group(1))
        tm = re.search(r'提交.*?(\d+)', pt)
        if tm: data['submission_count'] = int(tm.group(1))
        rm = re.search(r'Rating.*?(\d+)', pt, re.I)
        if rm: data['rating'] = int(rm.group(1))
        database.upsert_user(actual_username, data)
        print(f"[auto-register] Registered user: {actual_username} (uid={uid_param})")

        # Save profile info extracted from YZOJ page, but don't overwrite user-set signature/bio
        try:
            _existing_profile = database.get_user_profile(actual_username, str(uid_param))
            if _existing_profile and (_existing_profile.get('signature') or _existing_profile.get('bio')):
                # Profile already has user-set data, only ensure uid is set
                if not _existing_profile.get('uid'):
                    database.upsert_user_profile(actual_username, {'uid': str(uid_param)})
            else:
                _sig = ''
                _bio = ''
                _info_tbl = soup.find(id='tablelist') or soup.find('table', class_='table')
                if not _info_tbl:
                    _info_tbl = soup.find('table')
                if _info_tbl:
                    for _row in _info_tbl.find_all('tr'):
                        _cells = _row.find_all('td')
                        if len(_cells) >= 2:
                            _label = _cells[0].get_text(strip=True)
                            if '签名' in _label:
                                _sig = _cells[1].get_text(strip=True)
                            elif '简介' in _label or '个人简介' in _label:
                                _bio = _cells[1].get_text(strip=True)
                database.upsert_user_profile(actual_username, {
                    'uid': str(uid_param),
                    'signature': _sig,
                    'bio': _bio,
                    'bio_html': ''
                })
                if _sig:
                    print(f"[auto-register] Extracted signature for {actual_username}: {_sig}")
                if _bio:
                    print(f"[auto-register] Extracted bio for {actual_username}: {_bio}")
        except Exception as _sig_e:
            print(f"[auto-register] Failed to save profile for {actual_username}: {_sig_e}")

    except Exception as e:
        print(f"[auto-register] Failed to register user {lookup_key}: {e}")

@app.route('/api/user/profile/detail')
def get_user_profile_api():
    uid = request.args.get('uid', '')
    username = request.args.get('username', '')
    
    if not uid and not username:
        return jsonify({'error': '缺少参数'}), 400
    
    conn = database.get_conn()
    
    # 1. 尝试从本地查找用户（按 uid 或 username）
    found_user = None
    if uid:
        found_user = conn.execute("SELECT username, uid FROM users WHERE uid=?", (uid,)).fetchone()
    if not found_user and username:
        found_user = conn.execute("SELECT username, uid FROM users WHERE username=?", (username,)).fetchone()
    
    actual_username = found_user['username'] if found_user else (username or uid or '')
    actual_uid = found_user['uid'] if found_user else uid
    
    # 2. 用户不在本地 → 访问 YZOJ 获取并存储
    if not found_user:
        _try_register_user(actual_username, actual_uid)
        # 重新查询（_try_register_user 可能注册了不同用户名）
        if uid:
            found_user = conn.execute("SELECT username, uid FROM users WHERE uid=?", (uid,)).fetchone()
        elif username:
            found_user = conn.execute("SELECT username, uid FROM users WHERE username=?", (username,)).fetchone()
        if found_user:
            actual_username = found_user['username']
            actual_uid = found_user['uid']
    
    candidates = []
    if actual_username:
        candidates.append(actual_username)
    if actual_uid and actual_uid != actual_username:
        candidates.append(actual_uid)
    
    profile = None
    for key in candidates:
        p = database.get_user_profile(key, actual_uid if actual_uid else None)
        if p and (p.get('avatar_url') or p.get('header_image_url') or p.get('signature') or p.get('bio')):
            profile = p
            break
    if not profile and candidates:
        profile = database.get_user_profile(candidates[0], actual_uid if actual_uid else None)
    
    if profile:
        if profile.get('avatar_url') and not profile['avatar_url'].startswith('http'):
            profile['avatar_url'] = request.host_url.rstrip('/') + profile['avatar_url']
        if profile.get('header_image_url') and not profile['header_image_url'].startswith('http'):
            profile['header_image_url'] = request.host_url.rstrip('/') + profile['header_image_url']
        if not profile.get('username') or str(profile.get('username')).isdigit():
            profile['username'] = actual_username
        if not profile.get('uid') and actual_uid:
            profile['uid'] = actual_uid
    
    tags = database.get_user_tags(actual_username or actual_uid)
    profile['tags'] = _normalize_tags(tags)
    return jsonify(profile)

@app.route('/api/user/profile/update', methods=['POST'])
def update_user_profile_api():
    session = get_any_session()
    if not session:
        return jsonify({'success': False, 'message': '未登录（管理员登录请确认Token正确）'}), 401
    
    data = request.json or {}
    target_username = data.get('username', '')
    if not target_username:
        return jsonify({'success': False, 'message': '缺少用户名'}), 400
    
    # 检查权限：只能修改自己的，或者admin可以修改任何人
    current_uid = session.get('yzoj_uid', '')
    current_is_admin = session.get('is_admin', False)
    current_username = session.get('yzoj_username', '')
    
    # 获取目标用户的uid（从user_profiles表或通过爬取获取）
    try:
        profile = database.get_user_profile(target_username) or {}
    except Exception:
        profile = {}
    
    # 本人判断：目标用户名与当前session的用户名一致，或者目标UID == 当前UID
    target_is_self = (
        target_username == current_username or
        (current_uid and (profile.get('uid') == current_uid or target_username == current_uid))
    )
    
    # 既不是管理员，也不是本人 →403
    if not current_is_admin and not target_is_self:
        return jsonify({'success': False, 'message': '无权修改他人资料（仅本人或管理员可修改）'}), 403
    
    # Admin可以修改任何人的资料 / 本人可以修改自己
    try:
        database.upsert_user_profile(target_username, data)
        return jsonify({'success': True, 'message': '个人资料已更新'})
    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route('/api/user/profile/upload', methods=['POST'])
def upload_user_media():
    session = get_any_session()
    if not session:
        return jsonify({'success': False, 'message': '未登录（管理员登录请确认Token正确）'}), 401
    
    import base64
    data = request.json or {}
    username = data.get('username', '')
    media_type = data.get('type', '')
    base64_data = data.get('data', '')
    if not username or not media_type or not base64_data:
        return jsonify({'success': False, 'message': '参数不完整'}), 400
    
    # 权限检查：只能上传自己的，或者admin可以上传任何人
    current_is_admin = session.get('is_admin', False)
    current_username = session.get('yzoj_username', '')
    current_uid = session.get('yzoj_uid', '')
    try:
        p = database.get_user_profile(username) or {}
        target_uid = p.get('uid') or ''
    except Exception:
        target_uid = ''
    target_is_self = (username == current_username) or (current_uid and (target_uid == current_uid or username == current_uid))
    
    if not current_is_admin and not target_is_self:
        return jsonify({'success': False, 'message': '无权上传他人头像或头图（仅本人或管理员可上传）'}), 403
    
    try:
        media_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'static', 'media', username)
        os.makedirs(media_dir, exist_ok=True)
        if media_type == 'avatar':
            filename = 'avatar.png'
        elif media_type == 'header':
            filename = 'header.png'
        else:
            return jsonify({'success': False, 'message': '无效的媒体类型'}), 400
        if base64_data.startswith('data:image/'):
            base64_data = base64_data.split(',')[1]
        image_data = base64.b64decode(base64_data)
        file_path = os.path.join(media_dir, filename)
        with open(file_path, 'wb') as f:
            f.write(image_data)
        url = f'/media/{username}/{filename}'
        profile_data = {}
        if media_type == 'avatar':
            profile_data['avatar_url'] = url
        elif media_type == 'header':
            profile_data['header_image_url'] = url
        if target_uid:
            profile_data['uid'] = target_uid
        elif current_uid and (username == current_username or current_is_admin):
            profile_data['uid'] = current_uid
        database.upsert_user_profile(username, profile_data)
        
        if str(username).isdigit():
            existing_by_uid = database.get_user_profile('', username)
            if existing_by_uid and existing_by_uid.get('username') != username:
                if media_type == 'avatar':
                    existing_by_uid['avatar_url'] = url
                elif media_type == 'header':
                    existing_by_uid['header_image_url'] = url
                database.upsert_user_profile(existing_by_uid['username'], existing_by_uid)
        
        return jsonify({'success': True, 'url': url})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route('/media/<username>/<filename>')
def serve_user_media(username, filename):
    media_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'static', 'media', username)
    return send_from_directory(media_dir, filename)

# ---- User Card API (matches extension's parseUserPage format) ----
@app.route('/api/user/profile/card')
def get_user_card_api():
    """Return user data in the same format as extension's parseUserPage"""
    uid = request.args.get('uid', '')
    username = request.args.get('username', '')
    if not uid and not username:
        return jsonify({'error': '缺少参数'}), 400
    
    base = config.get('oj_base_url')
    try:
        # 先尝试用 resolve_user_id 补全 uid/username
        try:
            r_uid, r_uname = database.resolve_user_id(uid or None, username or None)
            if r_uid and not uid: uid = r_uid
            if r_uname and not username: username = r_uname
        except Exception:
            pass

        yzoj_html = None
        if uid:
            yzoj_html = crawler.fetch_html(f"{base}/OnlineJudge/user_show.php?id={uid}")
        else:
            yzoj_html = crawler.fetch_html(f"{base}/OnlineJudge/user_show.php?uname={username}")
        
        try:
            soup = BeautifulSoup(yzoj_html, 'html.parser')
        except:
            soup = BeautifulSoup(yzoj_html, 'html.parser')
        
        HONOR_TITLES = ['超级大神','大神','大神','中犇','小犇','超级大研究员','大研究员','研究员','职业程序员','专家','远程','程序员','初学者','学习者','Master','Grandmaster','Expert','Specialist','Pupil','Newbie','Legend','Candidate']
        FOOTER_NAMES_LOWER = {'sweetdum', 'mrain', 'robot', 'magica', 'ufo', 'miskcoo', '张哥哥语录'}
        def _is_footer_name(s):
            return (s or '').strip().lower() in FOOTER_NAMES_LOWER
        def _clean_user_text(s):
            txt = (s or '').strip()
            # 移除当前登录用户标记 (我)
            txt = txt.replace('(我)', '').replace('（我）', '').strip()
            # 移除荣誉称号前缀
            for h in HONOR_TITLES:
                if h in txt:
                    txt = txt.replace(h, '')
            return txt.strip(' -|·').strip()

        # Parse username from h2 (with honor-title filter)
        result_uid = uid or ''
        parsed_username = ''
        parsed_user_color = ''  # YZOJ user color from page username span
        parsed_permission_level = 0  # YZOJ permission level (blue number)
        parsed_permission_color = ''  # color of the permission span
        parsed_username_html = ''  # raw HTML of username from h2a (preserves styled spans)
        h2 = soup.find('h2')
        h2_text = h2.get_text(strip=True) if h2 else ''
        if h2:
            h2a = h2.find('a', href=lambda v: v and 'user_show.php' in str(v) if v else False)
            if h2a:
                h2a_txt = _clean_user_text(h2a.get_text(strip=True))
                if h2a_txt and not h2a_txt.isdigit() and not _is_footer_name(h2a_txt):
                    parsed_username = h2a_txt
                    parsed_username_html = h2a.decode_contents()
                if not result_uid:
                    href = h2a.get('href', '')
                    uid_m = re.search(r'[?&]id=(\d+)', href)
                    if uid_m: result_uid = uid_m.group(1)
                # Extract color from span inside the link (same as profile/full & parse.js)
                h2a_span = h2a.find('span')
                if h2a_span:
                    style = h2a_span.get('style', '')
                    color_m = re.search(r'color\s*:\s*([#\w]+)', style)
                    if color_m:
                        parsed_user_color = color_m.group(1)
                # Extract permission level and its color (font-family:georgia is the key feature)
                # Permission span is OUTSIDE h2 as next sibling
                h2_html_str = str(h2)
                perm_m = re.search(r'<span[^>]*style=([^>]*font-family:\s*georgia[^>]*)>([\d.]+)</span>', h2_html_str, re.I)
                if perm_m:
                    _pv = perm_m.group(2)
                    parsed_permission_level = int(_pv) if '.' not in _pv else float(_pv)
                    _cm = re.search(r'color\s*:\s*([#\w]+)', perm_m.group(1), re.I)
                    if _cm:
                        parsed_permission_color = _cm.group(1)
                else:
                    next_elem = h2.next_sibling if h2 else None
                    while next_elem:
                        if isinstance(next_elem, str) and not next_elem.strip():
                            next_elem = next_elem.next_sibling
                            continue
                        if hasattr(next_elem, 'name') and next_elem.name == 'span':
                            style = next_elem.get('style', '')
                            if 'georgia' in style.lower():
                                perm_text = next_elem.get_text(strip=True)
                                if perm_text.isdigit() or ('.' in perm_text and perm_text.replace('.','').isdigit()):
                                    _pv = perm_text
                                    parsed_permission_level = int(_pv) if '.' not in _pv else float(_pv)
                                    _cm = re.search(r'color\s*:\s*([#\w]+)', style, re.I)
                                    if _cm:
                                        parsed_permission_color = _cm.group(1)
                                    break
                        if hasattr(next_elem, 'find'):
                            perm_span = next_elem.find('span', style=lambda s: s and ('georgia' in (s or '').lower() if s else False))
                            if perm_span:
                                perm_text = perm_span.get_text(strip=True)
                                if perm_text.replace('.','').isdigit():
                                    _pv = perm_text
                                    parsed_permission_level = int(_pv) if '.' not in _pv else float(_pv)
                                    _style = perm_span.get('style', '')
                                    _cm = re.search(r'color\s*:\s*([#\w]+)', _style, re.I)
                                    if _cm:
                                        parsed_permission_color = _cm.group(1)
                                    break
                        next_elem = next_elem.next_sibling
            if not parsed_username:
                h2text = h2.get_text(strip=True)
                # Try to extract username after honor-title or dash
                _candidates = []
                m = re.search(r'-\s*(.+?)$', h2text)
                if m:
                    t = _clean_user_text(m.group(1))
                    if t and len(t) >= 2: _candidates.append(t)
                t = _clean_user_text(h2text)
                if t and len(t) >= 2: _candidates.append(t)
                for _cand in _candidates:
                    if not _cand: continue
                    # filter out honor-only strings and footer names
                    _parts = re.split(r'\s+|-', _cand)
                    _non_honor = [p for p in _parts if p and not any(h in p for h in HONOR_TITLES) and not _is_footer_name(p)]
                    if _non_honor:
                        joined = ' '.join(_non_honor).strip()
                        if joined and not _is_footer_name(joined) and len(joined) >= 2:
                            parsed_username = joined
                            break
                if not parsed_username:
                    t = _clean_user_text(h2text)
                    if t and len(t) >= 2 and not t.isdigit() and not _is_footer_name(t):
                        parsed_username = t
        
        # Fallback: regex extract color from h2 area (if not extracted yet)
        if not parsed_user_color and h2:
            h2_html_str = str(h2)
            color_m = re.search(r'color\s*:\s*([#\w]+)', h2_html_str)
            if color_m:
                parsed_user_color = color_m.group(1)

        # Fallback: find user links in page: FIRST search inside #content, STRICTLY validate uid/username match against caller's uid/username, exclude footer contributors
        if not parsed_username or not result_uid or not parsed_user_color:
            caller_uid = str(uid or '').strip()
            caller_uname = _clean_user_text(username) if username else ''
            content_div = soup.find(id='content')
            search_lists = []
            if content_div:
                search_lists.append(('content', content_div.find_all('a', href=lambda v: v and 'user_show.php' in str(v) if v else False)))
            search_lists.append(('body', soup.find_all('a', href=lambda v: v and 'user_show.php' in str(v) if v else False)))
            footer_container_names = ('footer', 'copyright', 'contrib')
            def _link_in_footer_container(l):
                p = l.parent
                depth = 0
                while p and depth < 10:
                    try:
                        pid = (p.get('id') or '').lower()
                        pcls = ' '.join(p.get('class') or []).lower()
                        pname = (getattr(p, 'name', '') or '').lower()
                        for fn in footer_container_names:
                            if fn in pid or fn in pcls or (fn == pname):
                                return True
                    except Exception:
                        pass
                    p = p.parent
                    depth += 1
                return False
            for scope_name, user_links in search_lists:
                got_match = False
                for link in user_links:
                    if _link_in_footer_container(link):
                        continue
                    raw_txt = link.get_text(strip=True)
                    if '(我)' in raw_txt or '（我）' in raw_txt:
                        continue
                    txt = _clean_user_text(raw_txt)
                    if not txt or len(txt) < 2 or txt.isdigit() or _is_footer_name(txt):
                        continue
                    href = link.get('href', '')
                    _um = re.search(r'[?&]id=(\d+)', href or '')
                    _uid = _um.group(1) if _um else ''
                    uid_ok = not caller_uid or (_uid and _uid == caller_uid)
                    uname_ok = not caller_uname or (txt and txt == caller_uname)
                    if not uid_ok and not uname_ok:
                        continue
                    if _uid and caller_uid and _uid != caller_uid:
                        continue
                    if txt and caller_uname and txt != caller_uname and caller_uid != _uid:
                        continue
                    if not parsed_username and txt and not _is_footer_name(txt):
                        parsed_username = txt
                    if not result_uid and _uid:
                        result_uid = _uid
                    if not parsed_user_color:
                        link_span = link.find('span')
                        if link_span:
                            style = link_span.get('style', '')
                            color_m = re.search(r'color\s*:\s*([#\w]+)', style)
                            if color_m:
                                parsed_user_color = color_m.group(1)
                        if not parsed_user_color:
                            style = link.get('style', '')
                            color_m = re.search(r'color\s*:\s*([#\w]+)', style)
                            if color_m:
                                parsed_user_color = color_m.group(1)
                    if (parsed_username or txt) and result_uid and parsed_user_color:
                        got_match = True
                        break
                    if (uid_ok or uname_ok) and ((parsed_username and not not parsed_username) or (result_uid and not caller_uid) or parsed_user_color):
                        got_match = True
                        break
                if got_match:
                    break

        # Detect banned users
        full_text = soup.get_text()
        isBanned = False
        ban_keywords = ['封禁','禁用','注销','不存在','该用户已','账户','账号','无法查看','无权限查看','访问受限']
        for kw in ban_keywords:
            if kw in full_text: isBanned = True; break
        if isBanned and (parsed_username or result_uid):
            _page_title = (soup.title and soup.title.get_text(strip=True)) or ''
            if any(ok in _page_title for ok in ['用户信息','用户详情','个人主页','user show','profile']):
                isBanned = False
        
        # Parse info table
        realName = ''; school = ''; email = ''; signature = ''
        solvedCount = 0; submissionCount = 0; rank_text = ''
        solvedProblems = []
        
        tablelist = soup.find(id='tablelist')
        if tablelist:
            rows = tablelist.select('tr')
            for row in rows:
                tds = row.find_all('td')
                if len(tds) < 2: continue
                label = tds[0].get_text(strip=True)
                value = tds[1].get_text(strip=True)
                if '真实姓名' in label: realName = value
                elif '提交次数' in label:
                    m = re.search(r'(\d+)', value)
                    if m: submissionCount = int(m.group(1))
                elif '解决题数' in label:
                    m = re.search(r'(\d+)', value)
                    if m: solvedCount = int(m.group(1))
                elif '学校' in label: school = value
                elif 'E-mail' in label or 'Email' in label: email = value
                if len(tds) >= 3:
                    third_col = tds[2]
                    for a in third_col.find_all('a', href=lambda v: v and 'problem_show.php' in v if v else False):
                        href = a.get('href', '')
                        pid_m = re.search(r'id=(\d+)', href)
                        if pid_m:
                            solvedProblems.append({
                                'id': pid_m.group(1),
                                'name': a.get_text(strip=True),
                                'url': base + '/OnlineJudge/' + href
                            })
        
        # Parse rank from full text
        rm = re.search(r'排名[\s]*(\d+)', full_text)
        if rm: rank_text = rm.group(1)
        
        # Banned users get solvedCount=-2
        if isBanned and solvedCount >= 0:
            solvedCount = -2
        
        # ---- Parse activity chart data (YZOJ Morris.Area line chart) ----
        yzoj_activity_data = []
        try:
            _ma_matches = re.findall(r'Morris\.Area\s*\(\s*\{([\s\S]*?\}\s*\)\s*;', yzoj_html or '')
            if not _ma_matches:
                _ma_matches = re.findall(r'Morris\.Area\s*\(\s*\{([\s\S]*?)\}\s*\)', yzoj_html or '')
            for _ma_block in _ma_matches:
                _d_start = _ma_block.find('data:')
                if _d_start == -1: continue
                _after = _ma_block[_d_start:]
                _arr_start = _after.find('[')
                if _arr_start == -1: continue
                _depth = 0
                _arr_end = -1
                _in_str = False
                _str_ch = ''
                i = _arr_start
                while i < len(_after):
                    ch = _after[i]
                    if _in_str:
                        if ch == '\\' and i + 1 < len(_after):
                            i += 2
                            continue
                        if ch == _str_ch:
                            _in_str = False
                    else:
                        if ch in ('"', "'"):
                            _in_str = True
                            _str_ch = ch
                        elif ch == '[':
                            _depth += 1
                        elif ch == ']':
                            _depth -= 1
                            if _depth == 0:
                                _arr_end = i
                                break
                    i += 1
                if _arr_end != -1:
                    _raw_arr = _after[_arr_start:_arr_end+1]
                    _json_s = re.sub(r'(\{|\,)\s*([a-zA-Z_\-][a-zA-Z0-9_\-]*|[0-9]+)\s*:', r'\1"\2":', _raw_arr)
                    _json_s = re.sub(r',\s*\]', ']', _json_s)
                    try:
                        import json as _json
                        _parsed = _json.loads(_json_s)
                        if isinstance(_parsed, list) and _parsed:
                            yzoj_activity_data = _parsed
                            break
                    except Exception:
                        pass
        except Exception as _e_act:
            print(f"[profile/card] Morris.Area parse warn: {_e_act}")
            yzoj_activity_data = []
        if not yzoj_activity_data:
            try:
                all_scripts = soup.find_all('script')
                for _sc in all_scripts:
                    _sc_text = (_sc.string or '') + (_sc.get_text() or '')
                    if 'Morris.Area' not in _sc_text: continue
                    _ds = _sc_text.find('data: [')
                    if _ds == -1:
                        _ds = _sc_text.find('data:[')
                    if _ds != -1:
                        _de1 = _sc_text.find('],', _ds)
                        _de2 = _sc_text.find(']', _ds)
                        if _de1 != -1 and _de2 != -1:
                            _de = _de1 if _de1 < _de2 else _de2
                        else:
                            _de = _de2
                        if _de != -1:
                            _raw = _sc_text[_sc_text.find('[', _ds):_de+1]
                            _json_s = re.sub(r'(\{|\,)\s*([a-zA-Z_\-][a-zA-Z0-9_\-]*|[0-9]+)\s*:', r'\1"\2":', _raw)
                            _json_s = re.sub(r',\s*\]', ']', _json_s)
                            try:
                                import json as _json
                                yzoj_activity_data = _json.loads(_json_s)
                            except Exception:
                                yzoj_activity_data = []
                            if yzoj_activity_data: break
            except Exception: pass

        # ---- 确定用户是否存在于 OJS 系统（users/user_profiles/user_tags 任一表有记录即视为存在） ----
        _exists_in_ojs = False
        try:
            _conn = database.get_conn()
            _exist_check_keys = list({k for k in [parsed_username, result_uid, username, uid] if k})
            for _ek in _exist_check_keys:
                if _exists_in_ojs: break
                _ek_str = str(_ek)
                if _ek_str.isdigit():
                    _row = _conn.execute("SELECT 1 FROM users WHERE uid=? LIMIT 1", (_ek_str,)).fetchone()
                    if not _row:
                        _row = _conn.execute("SELECT 1 FROM user_profiles WHERE uid=? LIMIT 1", (_ek_str,)).fetchone()
                    if not _row:
                        _row = _conn.execute("SELECT 1 FROM user_tags WHERE uid=? LIMIT 1", (_ek_str,)).fetchone()
                else:
                    _row = _conn.execute("SELECT 1 FROM users WHERE username=? LIMIT 1", (_ek_str,)).fetchone()
                    if not _row:
                        _row = _conn.execute("SELECT 1 FROM user_profiles WHERE username=? LIMIT 1", (_ek_str,)).fetchone()
                    if not _row:
                        _row = _conn.execute("SELECT 1 FROM user_tags WHERE username=? LIMIT 1", (_ek_str,)).fetchone()
                if _row:
                    _exists_in_ojs = True
                    break
        except Exception as _e_exist:
            print(f"[profile/card] exist-check warn: {_e_exist}")
            _exists_in_ojs = False

        # 从数据库获取 ojserver 的额外数据（头像、头图、签名、简介）——仅当用户存在于 OJS 时才返回
        av = ''
        hv = ''
        bio = ''
        bio_html = ''
        db_sig = signature
        db_username = ''
        db_nickname = ''
        is_banned_from_db = False
        if _exists_in_ojs:
            for lookup_key in [parsed_username, result_uid, username, uid]:
                if not lookup_key:
                    continue
                pd = database.get_user_profile(lookup_key)
                if pd:
                    if not av and pd.get('avatar_url'): av = pd['avatar_url']
                    if not hv and pd.get('header_image_url'): hv = pd['header_image_url']
                    if not db_sig and pd.get('signature'): db_sig = pd['signature']
                    if not bio and pd.get('bio'): bio = pd['bio']
                    if not bio_html and pd.get('bio_html'): bio_html = pd['bio_html']
                    if not db_username and pd.get('username'):
                        cand = str(pd['username']).strip()
                        if cand and not cand.isdigit():
                            db_username = cand
                        elif not db_username and cand:
                            db_username = cand
                    if not db_nickname and pd.get('nickname'):
                        db_nickname = pd['nickname']
                    if pd.get('is_banned'):
                        is_banned_from_db = True
        # Determine display username (never pure numeric UID)
        final_display_username = ''
        for _cand in [parsed_username, db_username, username]:
            if _cand and str(_cand).strip() and not str(_cand).strip().isdigit():
                final_display_username = str(_cand).strip()
                break
        if not final_display_username:
            for _cand in [parsed_username, db_username]:
                if _cand and str(_cand).strip():
                    final_display_username = str(_cand).strip()
                    break
        if not final_display_username:
            final_display_username = 'User #' + (str(result_uid or uid or '0'))
        if av and not av.startswith('http'):
            av = request.host_url.rstrip('/') + av
        if hv and not hv.startswith('http'):
            hv = request.host_url.rstrip('/') + hv
        
        return jsonify({
            'id': result_uid or uid or '',
            'uid': result_uid or uid or '',
            'username': final_display_username,
            'username_html': parsed_username_html or '',
            'uuid': result_uid or uid or '',
            'realName': realName,
            'nickname': db_nickname or realName,
            'school': school,
            'email': email,
            'signature': db_sig or '',
            'avatar_url': av,
            'avatarUrl': av,
            'header_image_url': hv,
            'bio': bio,
            'bio_html': bio_html,
            'solvedCount': solvedCount,
            'submissionCount': submissionCount,
            'rank': rank_text,
            'solvedProblems': solvedProblems,
            'recentSubmissions': [],
            'activityData': yzoj_activity_data,
            'isBanned': isBanned or is_banned_from_db,
            'is_banned': isBanned or is_banned_from_db,
            'tags': _normalize_tags(database.get_user_tags(parsed_username or result_uid or username or uid)) if _exists_in_ojs else [],
            'exists_in_ojs': _exists_in_ojs,
            'color': parsed_user_color or '',
            'user_color': parsed_user_color or '',
            'permission_level': parsed_permission_level or 0,
            'permission_color': parsed_permission_color or '',
        })
    except Exception as e:
        print(f"[Error] get_user_card_api: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

def _normalize_tags(tags_raw):
    normalized = []
    for t in (tags_raw or []):
        if isinstance(t, dict):
            tag_text = t.get('tag') or t.get('text') or ''
            color = t.get('color', '#6366f1') or '#6366f1'
        else:
            continue
        if tag_text:
            normalized.append({'text': tag_text, 'tag': tag_text, 'color': color})
    return normalized

# ---- User Tags API ----
def _is_admin_request():
    admin_s = database.validate_admin_session(request.headers.get('X-Admin-Token', ''))
    if admin_s:
        return True
    user_s = get_user_session()
    if user_s and user_s.get('is_admin'):
        return True
    return False

@app.route('/api/user/tags')
def get_user_tags_api():
    """Get tags for a user"""
    uid = request.args.get('uid', '')
    username = request.args.get('username', '')
    lookup_key = username or uid
    if not lookup_key:
        return jsonify({'tags': []})
    # If lookup by uid, resolve to actual username first
    if not username and uid and uid.isdigit():
        conn = database.get_conn()
        row = conn.execute("SELECT username FROM users WHERE uid=?", (uid,)).fetchone()
        if row:
            lookup_key = row['username']
    tags = database.get_user_tags(lookup_key)
    return jsonify({'tags': _normalize_tags(tags)})

@app.route('/api/user/tags/batch', methods=['POST'])
def get_user_tags_batch_api():
    """Get tags for multiple users at once. Accepts {uids: [...], usernames: [...]}."""
    data = request.get_json(silent=True) or {}
    uids = data.get('uids', [])
    usernames = data.get('usernames', [])
    if (not uids or not isinstance(uids, list)) and (not usernames or not isinstance(usernames, list)):
        return jsonify({'tags': {}})
    tags_map = database.get_user_tags_batch(
        uids if isinstance(uids, list) else None,
        usernames if isinstance(usernames, list) else None
    )
    # Normalize each user's tags
    result = {}
    for key, tags in tags_map.items():
        result[key] = _normalize_tags(tags)
    return jsonify({'tags': result})

@app.route('/api/user/tags/set', methods=['POST'])
def set_user_tag_api():
    """Set one tag or batch tags (admin only). Accepts {username,tag?,color?,tags?:[{text|tag,color}...]}"""
    if not _is_admin_request():
        return jsonify({'error': '无权限'}), 403
    data = request.get_json() or {}
    username = data.get('username', '')
    if not username:
        return jsonify({'error': '缺少参数'}), 400
    tags_batch = data.get('tags', None)
    if isinstance(tags_batch, list):
        database.delete_all_user_tags(username)
        for t in tags_batch:
            if not isinstance(t, dict):
                continue
            tag_text = t.get('text') or t.get('tag') or ''
            color = t.get('color', '#6366f1') or '#6366f1'
            if tag_text:
                database.set_user_tag(username, tag_text, color)
        return jsonify({'success': True})
    tag = data.get('tag', '')
    color = data.get('color', '#6366f1')
    if not tag:
        return jsonify({'error': '缺少参数'}), 400
    database.set_user_tag(username, tag, color)
    return jsonify({'success': True})

@app.route('/api/user/tags/delete', methods=['POST'])
def delete_user_tag_api():
    """Delete a tag (admin only)"""
    if not _is_admin_request():
        return jsonify({'error': '无权限'}), 403
    data = request.get_json() or {}
    username = data.get('username', '')
    tag = data.get('tag', '')
    if not username or not tag:
        return jsonify({'error': '缺少参数'}), 400
    database.delete_user_tag(username, tag)
    return jsonify({'success': True})

# ---- Like API ----
@app.route('/api/like/toggle', methods=['POST'])
def toggle_like():
    """Like/点赞功能已按用户要求彻底移除。保留路由返回兼容消息避免前端崩溃"""
    return jsonify({'success': False, 'liked': False, 'count': 0, 'message': '点赞功能已禁用'}), 410

# ---- Solutions ----

@app.route('/api/solutions', methods=['POST'])
def create_solution():
    data = request.json or {}
    problem_id = data.get('problem_id', '')
    title = data.get('title', '')
    content = data.get('content', '')
    author = data.get('author', '')
    if not problem_id or not content: return jsonify({'success': False, 'message': '参数不完整'}), 400
    sid = str(int(datetime.now().timestamp() * 1000))
    now = datetime.now().isoformat()
    database.upsert_solution(sid, {'problem_id': problem_id, 'author': author, 'title': title, 'content': content, 'content_html': content, 'created_at': now, 'updated_at': now})
    return jsonify({'success': True, 'id': sid, 'message': '题解已发布'})

@app.route('/api/solutions/publish', methods=['POST'])
def publish_solution():
    """Forward solution to actual YZOJ problem_solve.php"""
    import requests as _req
    data = request.json or {}
    problem_id = data.get('problem_id', '')
    content = data.get('content', '')
    cookie = data.get('cookie', '')  # optional, passed from extension
    if not problem_id or not content:
        return jsonify({'success': False, 'message': '参数不完整'}), 400
    base = config.get('oj_base_url', '')
    url = f"{base}/OnlineJudge/problem_solve.php?id={problem_id}"
    try:
        if cookie:
            # 使用扩展传递的 cookie（fresh login）
            session = _req.Session()
            session.verify = False
            session.headers.update({'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'})
            from crawler import _parse_cookie_string
            session.cookies.update(_parse_cookie_string(cookie))
        else:
            session = crawler.get_session()
        resp = session.post(url, data={'body': content, 'submit': '提交'}, timeout=30, allow_redirects=False)
        resp.encoding = 'utf-8'
        # YZOJ 成功提交后返回 302 重定向到同一页面
        if resp.status_code in (301, 302, 303):
            return jsonify({'success': True, 'message': '题解已发布'})
        text = resp.text
        if 'success' in text or '已发布' in text or '成功' in text or '修改成功' in text:
            return jsonify({'success': True, 'message': '题解已发布'})
        else:
            # 检查是否因为未登录被重定向到登录页
            if 'login' in text.lower() and ('password' in text.lower() or '验证' in text):
                return jsonify({'success': False, 'message': '登录状态已过期，请重新登录'}), 401
            err_match = re.search(r'<div[^>]*class="error"[^>]*>([\s\S]*?)</div>', text)
            err_msg = err_match.group(1).replace('<br/>', '\n').replace('<br>', '\n') if err_match else '服务器返回异常'
            return jsonify({'success': False, 'message': err_msg}), 400
    except Exception as e:
        return jsonify({'success': False, 'message': f'网络错误: {str(e)}'}), 500

@app.route('/api/solutions/<sid>/like', methods=['POST'])
def toggle_solution_like(sid):
    """题解点赞功能已禁用"""
    return jsonify({'success': False, 'liked': False, 'like_count': 0, 'message': '点赞功能已禁用'}), 410

@app.route('/api/solutions/stats', methods=['POST'])
def get_solutions_stats():
    data = request.json or {}
    solution_ids = data.get('solution_ids', [])
    username = data.get('username', '')
    if not solution_ids:
        return jsonify({})
    conn = database.get_conn()
    result = {}
    for sid in solution_ids:
        original_id = f"solution-{sid}"
        post_row = conn.execute("SELECT id, like_count FROM posts WHERE original_id=?", (original_id,)).fetchone()
        if post_row:
            comment_count = conn.execute("SELECT COUNT(*) as c FROM post_comments WHERE post_id=?", (post_row['id'],)).fetchone()['c']
            liked = False
            if username:
                liked = conn.execute("SELECT 1 FROM post_likes WHERE post_id=? AND username=?", (post_row['id'], username)).fetchone() is not None
            result[sid] = {'like_count': post_row['like_count'], 'comment_count': comment_count, 'liked': liked}
        else:
            result[sid] = {'like_count': 0, 'comment_count': 0, 'liked': False}
    return jsonify(result)

@app.route('/api/solutions/<sid>/comments')
def get_solution_comments(sid):
    try:
        conn = database.get_conn()
        original_id = f"solution-{sid}"
        post_row = conn.execute("SELECT id FROM posts WHERE original_id=?", (original_id,)).fetchone()
        if not post_row:
            return jsonify([])
        post_id = post_row['id']
        rows = conn.execute("SELECT * FROM post_comments WHERE post_id=? ORDER BY created_at ASC", (post_id,)).fetchall()
        comments = []
        for r in rows:
            like_count = conn.execute("SELECT COUNT(*) as c FROM post_likes WHERE post_id=?", (r['id'],)).fetchone()['c']
            comments.append({
                'id': r['id'],
                'solution_id': sid,
                'parent_id': r['parent_comment_id'],
                'username': r['author'],
                'content': r['content'],
                'created_at': r['created_at'],
                'like_count': like_count
            })
        return jsonify(comments)
    except Exception as e:
        return jsonify([])

@app.route('/api/solutions/<sid>/comments', methods=['POST'])
def add_solution_comment(sid):
    """评论功能已禁用"""
    return jsonify({'success': False, 'message': '评论功能已禁用', 'id': None}), 410

@app.route('/api/solutions/comments/<cid>/like', methods=['POST'])
def toggle_solution_comment_like(cid):
    """评论点赞功能已禁用"""
    return jsonify({'success': False, 'liked': False, 'like_count': 0, 'message': '点赞功能已禁用'}), 410

@app.route('/api/solutions/comments/<cid>', methods=['DELETE'])
def delete_solution_comment(cid):
    """评论写入/删除功能已禁用"""
    return jsonify({'success': False, 'message': '评论功能已禁用'}), 410

# ---- Admin Impersonation (模拟用户) ----
@app.route('/api/admin/impersonate', methods=['POST'])
def admin_impersonate():
    """Admin impersonates a regular user.
    Sets a global impersonation state that affects ALL API calls
    (admin panel, extension, etc.) until unimpersonated."""
    token = request.headers.get('X-Admin-Token', '')
    s = database.validate_admin_session(token)
    if not s:
        return jsonify({'success': False, 'message': '未授权'}), 401
    data = request.json or {}
    username = (data.get('username') or '').strip()
    if not username:
        return jsonify({'success': False, 'message': '缺少用户名'}), 400
    conn = database.get_conn()
    user = conn.execute("SELECT uid, username FROM users WHERE username=? OR uid=?", (username, username)).fetchone()
    if not user:
        return jsonify({'success': False, 'message': f'用户 "{username}" 不存在'}), 404
    # Set global impersonation (affects ALL API calls)
    _active_impersonation['username'] = user['username']
    # Also store in admin session for backward compatibility
    database.set_impersonate(token, user['username'])
    print(f"[IMPERSONATE] Admin {s['username']} impersonating {user['username']} (GLOBAL)")
    return jsonify({'success': True, 'uid': user['uid'], 'username': user['username'], 'message': f'已切换到用户 {user["username"]}'})

@app.route('/api/admin/unimpersonate', methods=['POST'])
def admin_unimpersonate():
    """Admin stops impersonating. Clears global impersonation state."""
    token = request.headers.get('X-Admin-Token', '')
    s = database.validate_admin_session(token)
    if not s:
        return jsonify({'success': False, 'message': '未授权'}), 401
    _active_impersonation['username'] = None
    database.clear_impersonate(token)
    print(f"[IMPERSONATE] Admin {s['username']} stopped impersonating (GLOBAL)")
    return jsonify({'success': True, 'message': '已退出模拟模式'})


# ---- Tags ----
@app.route('/api/tags')
def get_tags_api():
    """Get all unique problem tag names."""
    try:
        tags = database.get_all_tags()
        return jsonify(tags)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ---- Problem APIs (for Admin Panel) ----
@app.route('/api/problems/search')
def search_problems_api():
    """Search problems with filters (keyword, tag, pass rate, etc.) and pagination."""
    try:
        params = dict(request.args)
        result = database.search_problems(params)
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e), 'problem_ids': [], 'total_pages': 0}), 500

@app.route('/api/problems/batch', methods=['POST'])
def batch_problems_api():
    """Batch fetch problem details by IDs."""
    data = request.json or {}
    ids = data.get('ids', [])
    if not ids:
        return jsonify([])
    conn = database.get_conn()
    placeholders = ','.join('?' * len(ids))
    rows = conn.execute(f"SELECT * FROM problems WHERE id IN ({placeholders})", ids).fetchall()
    result = []
    for row in rows:
        p = dict(row)
        p['tags'] = json.loads(p.get('tags', '[]'))
        p['authors'] = json.loads(p.get('authors', '[]'))
        result.append(p)
    return jsonify(result)

@app.route('/api/problems/<pid>')
def problem_detail_api(pid):
    """Get single problem detail by ID."""
    try:
        p = database.get_problem(pid)
        if not p:
            return jsonify({'error': '未找到题目', 'id': pid}), 404
        return jsonify(p)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ---- Contest APIs (for Admin Panel) ----
@app.route('/api/contests/search')
def search_contests_api():
    """Search contests with filters and pagination."""
    try:
        params = dict(request.args)
        result = database.search_contests(params)
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e), 'contest_ids': [], 'total_pages': 0}), 500

@app.route('/api/contests/batch', methods=['POST'])
def batch_contests_api():
    """Batch fetch contest details by IDs."""
    data = request.json or {}
    ids = data.get('ids', [])
    if not ids:
        return jsonify([])
    conn = database.get_conn()
    placeholders = ','.join('?' * len(ids))
    rows = conn.execute(f"SELECT * FROM contests WHERE id IN ({placeholders})", ids).fetchall()
    return jsonify([dict(r) for r in rows])

@app.route('/api/contest/<cid>/detail')
def contest_detail_api(cid):
    """Get contest detail with problem list."""
    try:
        contest = database.get_contest_with_problems(cid)
        if not contest:
            return jsonify({'error': '未找到比赛', 'id': cid}), 404
        return jsonify(contest)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ---- Problem Sets (题单) ----
def _verify_token_for_user(username, token):
    try:
        old_cookie = config.get('cookie', '')
        config.set('cookie', token)
        crawler.visit_homepage_first()
        html = crawler.fetch_html(f"{config.get('oj_base_url')}/OnlineJudge/")
        config.set('cookie', old_cookie)
        crawler._apply_cookie_to_session()
        from bs4 import BeautifulSoup
        soup = BeautifulSoup(html, 'html.parser')
        for a in soup.find_all('a', href=re.compile(r'user_show\.php\?id=')):
            text = a.get_text(strip=True)
            if text == username:
                return True
        logout_link = soup.find('a', href=re.compile(r'logout\.php'))
        if logout_link:
            return True
        return False
    except:
        return False

@app.route('/api/whoami')
def whoami():
    """Return the currently authenticated user identity.
    
    Resolution order:
    1. Global impersonation (set by admin, affects ALL API calls)
    2. Admin session impersonation (per-session)
    3. Admin logged in (not impersonating)
    4. Username+token query params (regular user, verified against YZOJ)
    5. Guest
    """
    # Priority 1: Global impersonation (affects all clients)
    if _active_impersonation.get('username'):
        return jsonify({'username': _active_impersonation['username'], 'islogin': True})
    
    # Priority 2: Admin session
    admin_token = request.headers.get('X-Admin-Token', '')
    if admin_token:
        s = database.validate_admin_session(admin_token)
        if s:
            if s.get('impersonate_username'):
                return jsonify({'username': s['impersonate_username'], 'islogin': True})
            return jsonify({'username': s['username'], 'islogin': True})
    
    # Priority 3: Regular user via username+token
    username = request.args.get('username', '')
    token = request.args.get('token', '')
    if username and token:
        if _verify_token_for_user(username, token):
            return jsonify({'username': username, 'islogin': True})
        return jsonify({'username': username, 'islogin': False})
    
    # Not logged in
    return jsonify({'username': None, 'islogin': False})

@app.route('/api/problem_sets/<int:psid>')
def get_problem_set_detail(psid):
    """Get a single problem set with its full details"""
    ps = database.get_problem_set_by_id(psid)
    if not ps:
        return jsonify({'error': '未找到题单'}), 404
    
    # Resolve effective user: prefer impersonated user if admin is impersonating
    username = _get_effective_username()
    is_owner = username == ps.get('owner')
    
    # Check if admin is making the request — admins always see full details
    admin_token = request.headers.get('X-Admin-Token', '')
    is_admin = bool(admin_token and database.validate_admin_session(admin_token))
    
    # Strip sensitive fields (password is hashed, don't expose)
    ps.pop('password', None)
    
    # Read permission fields before potentially stripping them
    perm = ps.get('permission', '') or (ps.get('is_public') and 'public' or 'private')
    allowed_users_list = [u.strip() for u in (ps.get('allowed_users', '') or '').split(',') if u.strip()]
    denied_users_list = [u.strip() for u in (ps.get('denied_users', '') or '').split(',') if u.strip()]
    authorized_users_list = [u.strip() for u in (ps.get('password_authorized_users', '') or '').split(',') if u.strip()]
    
    # Admins always see all fields; non-owner users don't see permission lists
    if not is_owner and not is_admin:
        ps.pop('allowed_users', None)
        ps.pop('denied_users', None)
        ps.pop('password_authorized_users', None)
    
    # Check permission
    needs_password = False
    is_authorized = False
    
    if perm == 'password':
        is_authorized = username in authorized_users_list or is_owner
        if not is_authorized:
            needs_password = True
    elif perm == 'whitelist':
        is_authorized = username in allowed_users_list or is_owner
        if not is_authorized and not is_admin:
            return jsonify({'error': '无权限查看此题单', 'needs_permission': True}), 403
    elif perm == 'blacklist':
        if username in denied_users_list and not is_owner and not is_admin:
            return jsonify({'error': '你已被禁止查看此题单'}), 403
    
    # Also fetch problem names if available
    if ps.get('problem_ids') and (perm != 'password' or is_authorized or is_admin):
        ids = [pid.strip() for pid in ps['problem_ids'].split(',') if pid.strip()]
        problems = []
        for pid in ids:
            prob = database.get_problem(pid)
            if prob:
                problems.append({'id': prob['id'], 'name': prob['title'] or 'P'+prob['id']})
            else:
                problems.append({'id': pid, 'name': 'P'+pid})
        ps['problems'] = problems
    else:
        ps['problems'] = []
    
    if needs_password and not is_admin:
        ps['needs_password'] = True
        # Don't expose the actual problems list until authorized
        ps['problems'] = []
    
    return jsonify(ps)

@app.route('/api/problem_sets/verify_password', methods=['POST'])
def verify_problem_set_password_api():
    """Verify password for a password-protected problem set"""
    data = request.get_json(silent=True) or {}
    psid = data.get('psid')
    password = data.get('password', '')
    username = data.get('username', '')
    token = data.get('token', '')
    
    if not psid:
        return jsonify({'success': False, 'message': '缺少题单ID'}), 400
    if not username or not token:
        return jsonify({'success': False, 'message': '需要登录'}), 401
    if not _verify_token_for_user(username, token):
        return jsonify({'success': False, 'message': 'Token验证失败'}), 401
    
    success, message = database.verify_problem_set_password(psid, password, username)
    return jsonify({'success': success, 'message': message}), (200 if success else 403)

@app.route('/api/problem_sets/search')
def search_problem_sets_api():
    params = {}
    for k in ['keyword', 'owner', 'is_public', 'sort_by', 'sort_order']:
        v = request.args.get(k, '').strip()
        if v: params[k] = v
    params['page'] = int(request.args.get('page', 1))
    params['page_size'] = int(request.args.get('page_size', 20))
    # Use impersonated identity for permission filtering if applicable
    username = _get_effective_username()
    try:
        result = database.search_problem_sets(params, username=username)
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e), 'problem_sets': [], 'total': 0}), 500

@app.route('/api/problem_sets', methods=['GET', 'POST'])
def problem_sets_api():
    if request.method == 'GET':
        action = request.args.get('action', 'my')
        # Use impersonated identity for permission checks if applicable
        username = _get_effective_username()
        token = request.args.get('token', '')
        if action == 'public':
            if not username or not token:
                return jsonify({'success': False, 'message': '需要登录'}), 401
            if not _verify_token_for_user(username, token):
                return jsonify({'success': False, 'message': 'Token验证失败'}), 401
            return jsonify({'problem_sets': database.get_problem_sets_with_permission(username)})
        elif action == 'search':
            params = {}
            for k in ['keyword', 'owner', 'is_public', 'sort_by', 'sort_order']:
                v = request.args.get(k, '').strip()
                if v: params[k] = v
            params['page'] = int(request.args.get('page', 1))
            params['page_size'] = int(request.args.get('page_size', 20))
            return jsonify(database.search_problem_sets(params, username=username))
        elif action == 'my':
            if not username or not token:
                return jsonify({'success': False, 'message': '需要登录'}), 401
            if not _verify_token_for_user(username, token):
                return jsonify({'success': False, 'message': 'Token验证失败'}), 401
            return jsonify({'problem_sets': database.get_user_problem_sets(username)})
        return jsonify({'success': False, 'message': '未知操作'}), 400
    
    data = request.get_json(silent=True) or {}
    username = data.get('username', '')
    token = data.get('token', '')
    action = data.get('action', '')
    
    if not username or not token:
        return jsonify({'success': False, 'message': '需要登录'}), 401
    if not _verify_token_for_user(username, token):
        return jsonify({'success': False, 'message': 'Token验证失败'}), 401
    
    # If admin is impersonating a user, ALL operations use the impersonated
    # user's identity for permission/ownership checks (e.g. WA can't delete
    # xuanxuanmeow's problem sets). Token verification still uses the real
    # username from the request body to confirm the caller is authenticated.
    effective_user = _get_effective_username() or username
    
    op = data.get('op', 'create')
    if op == 'create':
        title = data.get('title', '')
        description = data.get('description', '')
        is_public = data.get('is_public', False)
        problem_ids = data.get('problem_ids', [])
        if isinstance(problem_ids, list):
            problem_ids = list(dict.fromkeys(pid.strip() for pid in problem_ids if pid and pid.strip()))
        else:
            problem_ids = list(dict.fromkeys(pid.strip() for pid in str(problem_ids).split(',') if pid and pid.strip()))
        if not problem_ids:
            return jsonify({'success': False, 'message': '题单至少需要包含一道题目'}), 400
        content_format = data.get('format', 'html')
        permission = data.get('permission', 'public')
        password = data.get('password', '')
        allowed_users = ','.join(dict.fromkeys(u.strip() for u in data.get('allowed_users', '').split(',') if u.strip() and u.strip() != effective_user))
        denied_users = ','.join(dict.fromkeys(u.strip() for u in data.get('denied_users', '').split(',') if u.strip() and u.strip() != effective_user))
        psid = database.create_problem_set(effective_user, title, is_public, problem_ids, description,
                                           content_format, permission, password, allowed_users, denied_users)
        return jsonify({'success': True, 'id': psid, 'message': '题单已创建'})
    
    elif op == 'update':
        psid = data.get('id')
        if not psid: return jsonify({'success': False, 'message': '缺少题单ID'}), 400
        title = data.get('title', '')
        is_public = data.get('is_public', False)
        problem_ids = data.get('problem_ids', [])
        if isinstance(problem_ids, list):
            problem_ids = list(dict.fromkeys(pid.strip() for pid in problem_ids if pid and pid.strip()))
        else:
            problem_ids = list(dict.fromkeys(pid.strip() for pid in str(problem_ids).split(',') if pid and pid.strip()))
        if not problem_ids:
            return jsonify({'success': False, 'message': '题单至少需要包含一道题目'}), 400
        description = data.get('description', '')
        content_format = data.get('format', 'html')
        permission = data.get('permission', 'public')
        password = data.get('password', '')
        allowed_users = ','.join(dict.fromkeys(u.strip() for u in data.get('allowed_users', '').split(',') if u.strip() and u.strip() != effective_user))
        denied_users = ','.join(dict.fromkeys(u.strip() for u in data.get('denied_users', '').split(',') if u.strip() and u.strip() != effective_user))
        if database.update_problem_set(psid, title, is_public, problem_ids, effective_user, description,
                                       content_format, permission, password, allowed_users, denied_users):
            return jsonify({'success': True, 'message': '题单已更新'})
        return jsonify({'success': False, 'message': '题单不存在或无权限'}), 404
    
    elif op == 'delete':
        psid = data.get('id')
        if not psid: return jsonify({'success': False, 'message': '缺少题单ID'}), 400
        app.logger.info(f'[delete_problem_set] 用户 {username} (effective: {effective_user}) 请求删除题单 ID={psid}')
        if database.delete_problem_set(psid, effective_user):
            app.logger.info(f'[delete_problem_set] 题单 {psid} 删除成功')
            return jsonify({'success': True, 'message': '题单已删除'})
        app.logger.warning(f'[delete_problem_set] 题单 {psid} 删除失败：不存在或无权限')
        return jsonify({'success': False, 'message': '题单不存在或无权限'}), 404
    
    return jsonify({'success': False, 'message': '未知操作'}), 400

@app.route('/api/admin/stats/full')
def admin_stats_full():
    s = database.validate_admin_session(request.headers.get('X-Admin-Token', ''))
    if not s: return jsonify({'success': False, 'message': '未授权'}), 401
    conn = database.get_conn()
    stats = database.get_stats()
    total_problems = conn.execute("SELECT COUNT(*) as c FROM problems").fetchone()['c']
    crawled_problems = conn.execute("SELECT COUNT(*) as c FROM problems WHERE is_crawled=1").fetchone()['c']
    not_crawled_problems = total_problems - crawled_problems
    stats['total'] = total_problems
    stats['crawled'] = crawled_problems
    stats['not_crawled'] = not_crawled_problems
    stats['total_problem_sets'] = conn.execute("SELECT COUNT(*) as c FROM problem_sets").fetchone()['c']
    stats['total_users'] = stats.get('user_count', 0)
    import threading
    def _refresh_user_count():
        try:
            import crawler
            base = config.get('oj_base_url')
            max_uid = crawler.find_max_user_id(base)
            if max_uid > 0:
                database.update_max_user_id(max_uid)
        except:
            pass
    threading.Thread(target=_refresh_user_count, daemon=True).start()
    return jsonify(stats)

# ---- Admin Problem Set Management ----
@app.route('/api/admin/problem_sets', methods=['GET', 'POST'])
def admin_problem_sets():
    s = database.validate_admin_session(request.headers.get('X-Admin-Token', ''))
    if not s: return jsonify({'success': False, 'message': '未授权'}), 401

    if request.method == 'GET':
        keyword = request.args.get('keyword', '').strip()
        page = int(request.args.get('page', 1))
        page_size = int(request.args.get('page_size', 50))
        if keyword:
            result = database.search_problem_sets({'keyword': keyword, 'page': page, 'page_size': page_size})
        else:
            conn = database.get_conn()
            total = conn.execute("SELECT COUNT(*) as c FROM problem_sets").fetchone()['c']
            total_pages = max(1, (total + page_size - 1) // page_size)
            offset = (page - 1) * page_size
            rows = conn.execute("SELECT * FROM problem_sets ORDER BY updated_at DESC LIMIT ? OFFSET ?", (page_size, offset)).fetchall()
            result = {'problem_sets': [dict(r) for r in rows], 'total': total, 'total_pages': total_pages}
        return jsonify(result)

    data = request.json or {}
    op = data.get('op', '')

    if op == 'create':
        title = data.get('title', '')
        description = data.get('description', '')
        is_public = data.get('is_public', False)
        problem_ids = data.get('problem_ids', [])
        content_format = data.get('format', 'html')
        permission = data.get('permission', 'public')
        password = data.get('password', '')
        allowed_users = data.get('allowed_users', '')
        denied_users = data.get('denied_users', '')
        owner = s['username']
        psid = database.create_problem_set(owner, title, is_public, problem_ids, description,
                                           content_format, permission, password, allowed_users, denied_users)
        return jsonify({'success': True, 'id': psid, 'message': '题单已创建'})

    elif op == 'update':
        psid = data.get('id')
        if not psid: return jsonify({'success': False, 'message': '缺少题单ID'}), 400
        title = data.get('title', '')
        is_public = data.get('is_public', False)
        problem_ids = data.get('problem_ids', [])
        description = data.get('description', '')
        content_format = data.get('format', 'html')
        permission = data.get('permission', 'public')
        password = data.get('password', '')
        allowed_users = data.get('allowed_users', '')
        denied_users = data.get('denied_users', '')
        # Admin bypasses ownership check
        conn = database.get_conn()
        old_ps = conn.execute("SELECT password, permission, password_authorized_users FROM problem_sets WHERE id=?", (psid,)).fetchone()
        # Keep original password if admin leaves field empty
        if not password:
            password = old_ps['password'] if old_ps else ''
            password_changed = False
        else:
            new_hash = database._hash_pw(password)
            password_changed = old_ps and old_ps['permission'] == 'password' and old_ps['password'] != new_hash
            password = new_hash
        conn.execute("""UPDATE problem_sets SET title=?, description=?, is_public=?, problem_ids=?,
                        format=?, permission=?, password=?, allowed_users=?, denied_users=?,
                        password_authorized_users=?, updated_at=datetime('now') WHERE id=?""",
                     (title, description, 1 if is_public else 0, ','.join(str(p) for p in problem_ids),
                      content_format, permission, password, allowed_users, denied_users,
                      '' if password_changed else dict(old_ps).get('password_authorized_users', '') if old_ps else '',
                      psid))
        conn.commit()
        if conn.total_changes > 0:
            return jsonify({'success': True, 'message': '题单已更新'})
        return jsonify({'success': False, 'message': '题单不存在'}), 404

    elif op == 'delete':
        psid = data.get('id')
        if not psid: return jsonify({'success': False, 'message': '缺少题单ID'}), 400
        conn = database.get_conn()
        conn.execute("DELETE FROM problem_sets WHERE id=?", (psid,))
        conn.commit()
        if conn.total_changes > 0:
            return jsonify({'success': True, 'message': '题单已删除'})
        return jsonify({'success': False, 'message': '题单不存在'}), 404

    return jsonify({'success': False, 'message': '未知操作'}), 400


# ---- Full User Profile API (with first-AC heatmap) ----
@app.route('/api/user/profile/full')
def get_user_profile_full_api():
    """
    Full profile: fetches user info from YZOJ in real time.
    - NO users-table cache (username/UIDs always crawled live from YZOJ).
    - NO first-AC crawling or heatmap generation.
    - Activity data = parsed directly from YZOJ's native Morris.Area line chart.
    - user_profiles table still used for avatar/header/bio (user-editable profile).
    Accepts uid= or username= parameter.
    """
    print("========== get_user_profile_full_api CALLED ==========")
    import time as _time
    _start_time = _time.time()

    uid = request.args.get('uid', '')
    username = request.args.get('username', '')
    months = int(request.args.get('months', '6'))
    force_crawl = request.args.get('force', '0') == '1'

    if not uid and not username:
        return jsonify({'error': '缺少UID或用户名'}), 400

    # Footer/contributor names filter (case-insensitive), function scope so later code can reuse
    HONOR_TITLES_GLOBAL = ['超级大神','大神','大神','中犇','小犇','超级大研究员','大研究员','研究员','职业程序员','专家','远程','程序员','初学者','学习者','Master','Grandmaster','Expert','Specialist','Pupil','Newbie','Legend','Candidate']
    FOOTER_NAMES_LOWER_GLOBAL = {'sweetdum', 'mrain', 'robot', 'magica', 'ufo', 'miskcoo', '张哥哥语录'}
    def _is_footer_name_global(s):
        return (s or '').strip().lower() in FOOTER_NAMES_LOWER_GLOBAL
    def _clean_user_text_global(s, honor_titles=None):
        _ht = honor_titles or HONOR_TITLES_GLOBAL
        txt = (s or '').strip()
        txt = txt.replace('(我)', '').replace('（我）', '').strip()
        for h in _ht:
            if h in txt:
                txt = txt.replace(h, '')
        return txt.strip(' -|·').strip()

    try:
        # ===== Step 0: Resolve the caller's user session: get their YZOJ cookie (for crawling) =====
        _t0 = _time.time()
        user_session = get_user_session()  # may return None if unauthenticated
        request_yzoj_cookie = None
        if user_session and user_session.get('yzoj_cookie'):
            request_yzoj_cookie = user_session['yzoj_cookie']
        # Support passing YZOJ cookie directly via header (for extension/plugin use)
        if not request_yzoj_cookie:
            header_cookie = request.headers.get('X-YZOJ-Cookie', '')
            if header_cookie:
                request_yzoj_cookie = header_cookie
        # Support passing YZOJ cookie via query parameter (for testing)
        if not request_yzoj_cookie:
            query_cookie = request.args.get('yzoj_cookie', '')
            if query_cookie:
                request_yzoj_cookie = query_cookie
        if not request_yzoj_cookie:
            _gc = config.get('cookie', '')
            if _gc: request_yzoj_cookie = _gc
        print(f"[profile/full] Step0 session: {_time.time()-_t0:.3f}s, has_cookie={bool(request_yzoj_cookie)}")

        # Step 1: Resolve uid/username pair for DB queries
        _t1 = _time.time()
        r_uid, r_uname = database.resolve_user_id(uid, username)
        final_uid = uid or r_uid or ''
        final_uname = username or r_uname or ''
        print(f"[profile/full] Step1 resolve_user: {_time.time()-_t1:.3f}s")

        # Step 2: Crawl user's full profile info from YZOJ user_show page (for display)
        _t2 = _time.time()
        base = config.get('oj_base_url')
        profile_fetch_id = final_uid or final_uname
        yzoj_html = None
        try:
            if profile_fetch_id and str(profile_fetch_id).isdigit():
                yzoj_html = crawler.fetch_html(f"{base}/OnlineJudge/user_show.php?id={profile_fetch_id}", custom_cookie=request_yzoj_cookie)
            elif profile_fetch_id:
                import urllib.parse as _up
                yzoj_html = crawler.fetch_html(f"{base}/OnlineJudge/user_show.php?uname={_up.quote(str(profile_fetch_id))}", custom_cookie=request_yzoj_cookie)
        except Exception as e_fetch:
            print(f"[profile/full] fetch YZOJ user_show warn: {e_fetch}")
            yzoj_html = None
        print(f"[profile/full] Step2 fetch_html: {_time.time()-_t2:.3f}s")
        
        _debug_log('profile_full_fetch', 
                   f"uid={uid}, username={username}, final_uid={final_uid}, final_uname={final_uname}",
                   raw_html=yzoj_html,
                   source=f"YZOJ user_show.php?id={profile_fetch_id}")

        # Step 3: Parse basic fields from YZOJ page: EXACTLY aligned with parse.js parseUserPage
        realName = ''; school = ''; email = ''; signature = ''; bio = ''; bio_html = ''
        solvedCount = 0; submissionCount = 0; rank_text = ''
        parsed_username = ''
        parsed_uid = ''
        isBanned = False
        solved_problems_from_page = []
        yzoj_activity_data = []  # YZOJ native Morris.Area line chart data (monthly by difficulty)
        parsed_user_color = ''  # YZOJ user color from page
        parsed_permission_level = 0  # YZOJ permission level from page
        parsed_permission_color = ''  # color of the permission span
        parsed_username_html = ''  # raw HTML of username from h2a (preserves styled spans)

        crawl_success = False
        if yzoj_html:
            try:
                soup = BeautifulSoup(yzoj_html, 'html.parser')
                HONOR_TITLES = HONOR_TITLES_GLOBAL
                FOOTER_NAMES_LOWER = FOOTER_NAMES_LOWER_GLOBAL
                # Aliases to function-scope helpers (defined above), consistent across entire function
                def _is_footer_name(s):
                    return _is_footer_name_global(s)
                def _clean_user_text(s):
                    return _clean_user_text_global(s, HONOR_TITLES)

                # ---- 3.0 Validate page: check if it's a real user page, not error page ----
                page_title = ''
                title_tag = soup.find('title')
                if title_tag:
                    page_title = title_tag.get_text(strip=True)

                is_error_page = False
                if '错误' in page_title or 'Error' in page_title or '404' in page_title:
                    is_error_page = True
                body_text = soup.find('body').get_text() if soup.find('body') else ''
                if not is_error_page:
                    error_keywords = ['不存在', '无法查看', '无权限', '访问受限', '该用户已']
                    for kw in error_keywords:
                        if kw in body_text and not soup.find('h2'):
                            is_error_page = True
                            break

                content_div = soup.find(id='content')
                has_user_info = False
                if content_div and content_div.find(id='tablelist'):
                    has_user_info = True
                if not has_user_info and soup.find('h2') and soup.find('h2').find('a', href=lambda v: v and 'user_show.php' in str(v)):
                    has_user_info = True

                if is_error_page or not has_user_info:
                    _debug_log('profile_full_page_invalid',
                               f"Invalid page: title={page_title}, is_error={is_error_page}, has_user_info={has_user_info}",
                               raw_html=str(soup.find('body'))[:500] if soup.find('body') else None,
                               source='page validation')
                    print(f"[profile/full] Warning: cannot access YZOJ page for {profile_fetch_id} ({page_title}), using DB data only")
                    # If user had their own session cookie and page is inaccessible (cookie expired), log them out
                    _session_deleted = False
                    if user_session and user_session.get('yzoj_cookie') and request_yzoj_cookie and ('拒绝' in page_title or '登录' in page_title):
                        try:
                            _utoken = request.headers.get('X-User-Token', '') or request.cookies.get('user_token', '')
                            if _utoken:
                                database.delete_user_session(_utoken)
                                _session_deleted = True
                                print(f"[profile/full] User session deleted (cookie expired): token={_utoken[:16]}...")
                        except Exception as _del_e:
                            print(f"[profile/full] Failed to delete expired session: {_del_e}")
                    crawl_success = False
                else:
                    crawl_success = True

                # ---- 3.0.5 Extract username from page title as primary source ----
                if crawl_success and page_title:
                    title_parts = page_title.split(' - ')
                    if len(title_parts) >= 2:
                        for part in title_parts:
                            p = part.strip()
                            if p and p not in HONOR_TITLES and 'Online Judge' not in p and 'FZYZ' not in p and len(p) >= 2:
                                if not _is_footer_name(p):
                                    parsed_username = p
                                    break

                # ---- 3.1 h2 first: link in h2 / text in h2 with honor-title filter ----
                h2 = None
                h2_text = ''
                if crawl_success:
                    h2 = soup.find('h2')
                    h2_text = h2.get_text(strip=True) if h2 else ''
                
                _debug_log('profile_full_h2',
                           f"h2 found: {h2 is not None}, h2_text: {h2_text[:100]}",
                           raw_html=str(h2) if h2 else None,
                           source='h2 extraction')
                
                if h2:
                    h2a = h2.find('a', href=lambda v: v and 'user_show.php' in str(v) if v else False)
                    _debug_log('profile_full_h2a',
                               f"h2a found: {h2a is not None}, text: {h2a.get_text(strip=True) if h2a else 'N/A'}, href: {h2a.get('href', '') if h2a else 'N/A'}",
                               raw_html=str(h2a) if h2a else None,
                               source='h2a extraction')
                    
                    if h2a:
                        h2a_clean = _clean_user_text(h2a.get_text(strip=True))
                        if h2a_clean and not _is_footer_name(h2a_clean) and len(h2a_clean) >= 2:
                            parsed_username = h2a_clean
                            parsed_username_html = h2a.decode_contents()
                        href = h2a.get('href', '')
                        _um = re.search(r'[?&]id=(\d+)', href or '')
                        if _um: parsed_uid = _um.group(1)
                        # Extract color from span inside the link
                        h2a_span = h2a.find('span')
                        _debug_log('profile_full_h2a_span',
                                   f"h2a_span found: {h2a_span is not None}, style: {h2a_span.get('style', '') if h2a_span else 'N/A'}",
                                   raw_html=str(h2a_span) if h2a_span else None,
                                   source='h2a span color extraction')
                        
                        if h2a_span:
                            style = h2a_span.get('style', '')
                            color_m = re.search(r'color\s*:\s*([#\w]+)', style)
                            if color_m:
                                parsed_user_color = color_m.group(1)
                        
                        # Extract permission level and its color (font-family:georgia is the key feature)
                        # Permission span is OUTSIDE h2 as next sibling
                        h2_html_str = str(h2) if h2 else ''
                        perm_m = re.search(r'<span[^>]*style=([^>]*font-family:\s*georgia[^>]*)>([\d.]+)</span>', h2_html_str, re.I)
                        if perm_m:
                            _pv = perm_m.group(2)
                            parsed_permission_level = int(_pv) if '.' not in _pv else float(_pv)
                            _cm = re.search(r'color\s*:\s*([#\w]+)', perm_m.group(1), re.I)
                            if _cm:
                                parsed_permission_color = _cm.group(1)
                        else:
                            # Search h2's next siblings (permission span is outside h2)
                            next_elem = h2.next_sibling if h2 else None
                            while next_elem:
                                if isinstance(next_elem, str) and not next_elem.strip():
                                    next_elem = next_elem.next_sibling
                                    continue
                                if hasattr(next_elem, 'name') and next_elem.name == 'span':
                                    style = next_elem.get('style', '')
                                    if 'georgia' in style.lower():
                                        perm_text = next_elem.get_text(strip=True)
                                        if perm_text.isdigit() or ('.' in perm_text and perm_text.replace('.','').isdigit()):
                                            _pv = perm_text
                                            parsed_permission_level = int(_pv) if '.' not in _pv else float(_pv)
                                            _cm = re.search(r'color\s*:\s*([#\w]+)', style, re.I)
                                            if _cm:
                                                parsed_permission_color = _cm.group(1)
                                            break
                                if hasattr(next_elem, 'find'):
                                    perm_span = next_elem.find('span', style=lambda s: s and ('georgia' in (s or '').lower() if s else False))
                                    if perm_span:
                                        perm_text = perm_span.get_text(strip=True)
                                        if perm_text.replace('.','').isdigit():
                                            _pv = perm_text
                                            parsed_permission_level = int(_pv) if '.' not in _pv else float(_pv)
                                            _style = perm_span.get('style', '')
                                            _cm = re.search(r'color\s*:\s*([#\w]+)', _style, re.I)
                                            if _cm:
                                                parsed_permission_color = _cm.group(1)
                                            break
                                next_elem = next_elem.next_sibling
                
                # Fallback: regex extract color from h2 area
                if not parsed_user_color and h2:
                    h2_html_str = str(h2)
                    color_m = re.search(r'color\s*:\s*([#\w]+)', h2_html_str)
                    if color_m:
                        parsed_user_color = color_m.group(1)
            
                if crawl_success and not parsed_username:
                    pf_caller_uid = str(final_uid or '').strip()
                    pf_caller_uname = _clean_user_text(final_uname) if final_uname else ''
                    search_area = content_div if content_div else soup
                    all_user_links = search_area.find_all('a', href=lambda v: v and 'user_show.php' in str(v) if v else False)
                    pf_footer_names = ('footer', 'copyright', 'contrib')
                    def _pf_in_footer(l):
                        p = l.parent; d = 0
                        while p and d < 10:
                            try:
                                pid = (getattr(p, 'get', lambda *_: '')('id') or '').lower()
                                pcls = ' '.join(getattr(p, 'get', lambda *_: [])('class') or []).lower()
                                pname = (getattr(p, 'name', '') or '').lower()
                                for fn in pf_footer_names:
                                    if fn in pid or fn in pcls or (fn == pname): return True
                            except Exception: pass
                            p = p.parent; d += 1
                        return False
                    for link in all_user_links:
                        if _pf_in_footer(link): continue
                        raw_txt = link.get_text(strip=True)
                        if '(我)' in raw_txt or '（我）' in raw_txt: continue
                        txt = _clean_user_text(raw_txt)
                        if not txt or len(txt) < 2 or _is_footer_name(txt) or txt in HONOR_TITLES: continue
                        href = link.get('href', '')
                        _um = re.search(r'[?&]id=(\d+)', href or '')
                        _uid = _um.group(1) if _um else ''
                        uid_ok = not pf_caller_uid or (_uid and _uid == pf_caller_uid)
                        uname_ok = not pf_caller_uname or (txt and txt == pf_caller_uname)
                        if _uid and pf_caller_uid and _uid != pf_caller_uid: continue
                        if txt and pf_caller_uname and txt != pf_caller_uname and (not _uid or _uid != pf_caller_uid): continue
                        if not uid_ok and not uname_ok: continue
                        if not parsed_username: parsed_username = txt
                        if not parsed_uid and _uid: parsed_uid = _uid
                        link_span = link.find('span')
                        if link_span and not parsed_user_color:
                            style = link_span.get('style', '')
                            color_m = re.search(r'color\s*:\s*([#\w]+)', style)
                            if color_m: parsed_user_color = color_m.group(1)
                        if not parsed_user_color:
                            style = link.get('style', '')
                            color_m = re.search(r'color\s*:\s*([#\w]+)', style)
                            if color_m: parsed_user_color = color_m.group(1)
                        break
                # Fallback: parse h2 html for <strong> tags
                if crawl_success and ((not parsed_username) or parsed_username in HONOR_TITLES):
                    if h2:
                        h2_html_str = ''.join(str(c) for c in h2.children)
                        strong_matches = re.findall(r'<strong[^>]*>([^<]+)</strong>', h2_html_str, re.I)
                        for sm in strong_matches:
                            possible = sm.strip()
                            if possible not in HONOR_TITLES and not _is_footer_name(possible) and len(possible) >= 2:
                                parsed_username = possible
                                break
                # Last fallback: split h2 text, filter honor titles and numbers, scan forward then backward
                if crawl_success and ((not parsed_username) or parsed_username in HONOR_TITLES):
                    text1 = re.sub(r'id=\d+', '', h2_text).strip()
                    text1 = re.sub(r'\([^)]*\)', '', text1)
                    text1 = re.sub(r'\[[^\]]*\]', '', text1).strip()
                    text1 = re.sub(r'[-\s\u00A0\u3000&]+', ' ', text1).strip()
                    parts = [p for p in text1.split() if len(p) > 0]
                    found = None
                    for part in parts:
                        s = part.strip()
                        if s in HONOR_TITLES: continue
                        if _is_footer_name(s): continue
                        if re.match(r'^\d+$', s): continue
                        if len(s) < 2: continue
                        found = s; break
                    if (not found) and parts:
                        for part in reversed(parts):
                            s = part.strip()
                            if s not in HONOR_TITLES and not _is_footer_name(s) and not re.match(r'^\d+$', s) and len(s) >= 2:
                                found = s; break
                    if found: parsed_username = found

                # ---- 3.2 Ban detection (exact parse.js rules) ----
                body_text = soup.find('body').get_text() if soup.find('body') else ''
                html_text = soup.get_text()
                ban_keywords = ['封禁','禁用','注销','不存在','该用户已','账户','账号','无法查看','无权限查看','访问受限']
                for kw in ban_keywords:
                    if kw in body_text or kw in html_text:
                        isBanned = True
                        break
                if isBanned and (parsed_username or parsed_uid):
                    isBanned = False
                if not isBanned:
                    any_user_link = soup.find('a', href=lambda v: v and 'user_show.php' in str(v) if v else False)
                    has_table = soup.find(id='tablelist') is not None
                    if (not any_user_link) and (not has_table) and (not parsed_username) and (not parsed_uid):
                        isBanned = True

                # ---- 3.3 Find info table (exact parse.js logic) ----
                def _find_info_table_accurate(soup_obj):
                    content_div = soup_obj.find(id='content')
                    info_keywords = ['真实姓名','学校','E-mail','提交次数','解决题数','签名','用户','注册时间','Rating','积分','排名','邮箱','学院','班级','通过题数','已解决','尝试次数']
                    def _is_info_label(t): return any(k in t for k in info_keywords)
                    candidates_list = []
                    if content_div:
                        ct = content_div.find_all(id='tablelist')
                        candidates_list.extend(ct)
                    all_ids = soup_obj.find_all(id='tablelist')
                    for t in all_ids:
                        if t not in candidates_list:
                            candidates_list.append(t)
                    best = None; best_score = -1
                    for tbl in candidates_list:
                        if tbl.find_parent(id='ftoolbarshow'): continue
                        th_row = tbl.find('tr')
                        score = 0
                        if th_row:
                            headers = []
                            for c in th_row.find_all(['th', 'td']):
                                headers.append(c.get_text(strip=True))
                            for h in headers:
                                if _is_info_label(h): score += 10
                            first_tds = th_row.find_all('td')
                            if len(first_tds) < 2:
                                rows_all = tbl.find_all('tr')
                                if len(rows_all) > 1:
                                    sec = rows_all[1].find_all('td')
                                    if len(sec) >= 2 and _is_info_label(sec[0].get_text(strip=True)):
                                        score += 10
                        else:
                            rows_all = tbl.find_all('tr')
                            if len(rows_all) >= 2:
                                sec = rows_all[1].find_all('td')
                                if len(sec) >= 2 and _is_info_label(sec[0].get_text(strip=True)):
                                    score += 10
                        if score > best_score:
                            best_score = score
                            best = tbl
                    return best if best_score > 0 else None

                info_table = _find_info_table_accurate(soup)
                if info_table:
                    for row in info_table.find_all('tr'):
                        cells = row.find_all('td')
                        if len(cells) < 2: continue
                        for ci in range(0, len(cells) - 1, 2):
                            label = cells[ci].get_text(strip=True)
                            value_td = cells[ci + 1]
                            value = value_td.get_text(strip=True)
                            if not label: continue
                            if '真实姓名' in label: realName = value
                            elif '提交次数' in label or '尝试次数' in label:
                                _m = re.search(r'(\d+)', value)
                                if _m: submissionCount = int(_m.group(1))
                            elif ('解决题数' in label) or ('通过题数' in label) or ('已解决' in label):
                                _m = re.search(r'(\d+)', value)
                                if _m: solvedCount = int(_m.group(1))
                            elif ('学校' in label) or ('学院' in label) or ('班级' in label): school = value
                            elif ('E-mail' in label) or ('Email' in label) or ('邮箱' in label): email = value
                            elif '签名' in label: signature = value
                            elif ('排名' in label) or ('Rank' in label) or ('名次' in label):
                                _rm = re.search(r'(\d+)', value)
                                rank_text = _rm.group(1) if _rm else value
                            if len(cells) >= 3:
                                third_col = cells[2]
                                for a in third_col.find_all('a', href=lambda v: v and 'problem_show.php' in str(v) if v else False):
                                    href = a.get('href', '')
                                    pid_m = re.search(r'id=(\d+)', href or '')
                                    if pid_m:
                                        solved_problems_from_page.append({
                                            'id': pid_m.group(1),
                                            'title': a.get_text(strip=True),
                                            'url': base.rstrip('/') + '/OnlineJudge/' + href.lstrip('/')
                                        })

                # ---- 3.4 Solved problems (crawled from page only, no first_ac DB) ----
                def _abs_problem_url(href):
                    if href.startswith('http'): return href
                    return base.rstrip('/') + '/OnlineJudge/' + href.lstrip('/')

                solved_area = None
                acl_div = soup.find(id='acl')
                if acl_div:
                    solved_area = acl_div
                else:
                    best_tbl = None; best_count = -1
                    for tbl in soup.find_all('table'):
                        if tbl.find_parent(id='ftoolbarshow'): continue
                        if info_table and tbl is info_table: continue
                        p_links = tbl.find_all('a', href=lambda v: v and 'problem_show.php' in str(v) if v else False)
                        u_links = tbl.find_all('a', href=lambda v: v and 'user_show.php' in str(v) if v else False)
                        score = len(p_links) * 10 - len(u_links) * 2
                        if len(p_links) >= 3 and score > best_count:
                            best_count = score
                            best_tbl = tbl
                    solved_area = best_tbl
                if solved_area:
                    for a in solved_area.find_all('a', href=lambda v: v and 'problem_show.php' in str(v) if v else False):
                        href = a.get('href', '')
                        pid_m = re.search(r'id=(\d+)', href or '')
                        pid = pid_m.group(1) if pid_m else ''
                        if not pid:
                            t = a.get_text(strip=True)
                            m2 = re.match(r'^P?(\d+)', t)
                            if m2: pid = m2.group(1)
                        if not pid: continue
                        p_text = a.get_text(strip=True)
                        p_name = p_text
                        m3 = re.match(r'^P?\d+', p_text)
                        if m3:
                            sp = p_text.split()
                            if len(sp) > 1: p_name = ' '.join(sp[1:]).strip() or p_text
                        _exists = any(s['id'] == pid for s in solved_problems_from_page)
                        if not _exists:
                            solved_problems_from_page.append({
                                'id': pid, 'title': p_name,
                                'url': _abs_problem_url(href) if href else (base + '/OnlineJudge/problem_show.php?id=' + pid)
                            })
                if (not solved_problems_from_page) and info_table:
                    for a in info_table.find_all('a', href=lambda v: v and 'problem_show.php' in str(v) if v else False):
                        href = a.get('href', '')
                        pid_m = re.search(r'id=(\d+)', href or '')
                        if pid_m:
                            pid = pid_m.group(1)
                            if not any(s['id'] == pid for s in solved_problems_from_page):
                                solved_problems_from_page.append({
                                    'id': pid, 'title': a.get_text(strip=True), 'url': _abs_problem_url(href)
                                })

                # Ensure solved count >= parsed list length
                if solved_problems_from_page and ((not solvedCount) or (solvedCount < len(solved_problems_from_page))):
                    solvedCount = len(solved_problems_from_page)

                # ---- 3.6 Parse activity chart data (YZOJ native Morris.Area line chart) ----
                # Data format (see example.html): array of { day: "2023-11", "1":13, "2":15, ..., "10":0, total:33 }
                _parsed_activity_data = []
                try:
                    _ma_matches = re.findall(r'Morris\.Area\s*\(\s*\{([\s\S]*?\}\s*\)\s*;', yzoj_html or '')
                    if not _ma_matches:
                        _ma_matches = re.findall(r'Morris\.Area\s*\(\s*\{([\s\S]*?)\}\s*\)', yzoj_html or '')
                    for _ma_block in _ma_matches:
                            _d_start = _ma_block.find('data:')
                            if _d_start == -1: continue
                            _after = _ma_block[_d_start:]
                            _arr_start = _after.find('[')
                            if _arr_start == -1: continue
                            _depth = 0
                            _arr_end = -1
                            _in_str = False
                            _str_ch = ''
                            i = _arr_start
                            while i < len(_after):
                                ch = _after[i]
                                if _in_str:
                                    if ch == '\\' and i + 1 < len(_after): i += 2; continue
                                    if ch == _str_ch: _in_str = False
                                else:
                                    if ch in ('"', "'"):
                                        _in_str = True
                                        _str_ch = ch
                                    elif ch == '[':
                                        _depth += 1
                                    elif ch == ']':
                                        _depth -= 1
                                        if _depth == 0:
                                            _arr_end = i
                                            break
                                i += 1
                            if _arr_end != -1:
                                _raw = _after[_arr_start:_arr_end+1]
                                _json_s = re.sub(r'(\{|\,)\s*([a-zA-Z_\-][a-zA-Z0-9_\-]*|[0-9]+)\s*:', r'\1"\2":', _raw)
                                _json_s = re.sub(r',\s*\]', ']', _json_s)
                                try:
                                    _parsed_activity_data = json.loads(_json_s)
                                except Exception:
                                    _parsed_activity_data = []
                                if _parsed_activity_data: break
                except Exception as _e_act:
                    print(f"[profile/full] Morris.Area parse warn: {_e_act}")
                    _parsed_activity_data = []
                if not _parsed_activity_data:
                    try:
                        all_scripts = soup.find_all('script')
                        for _sc in all_scripts:
                            _sc_text = (_sc.string or '') + (_sc.get_text() or '')
                            if 'Morris.Area' not in _sc_text: continue
                            _ds = _sc_text.find('data: [')
                            if _ds == -1:
                                _ds = _sc_text.find('data:[')
                            if _ds != -1:
                                _de1 = _sc_text.find('],', _ds)
                                _de2 = _sc_text.find(']', _ds)
                                if _de1 != -1 and _de2 != -1:
                                    _de = _de1 if _de1 < _de2 else _de2
                                else:
                                    _de = _de2
                                if _de != -1:
                                    _raw = _sc_text[_sc_text.find('[', _ds):_de+1]
                                    _json_s = re.sub(r'(\{|\,)\s*([a-zA-Z_\-][a-zA-Z0-9_\-]*|[0-9]+)\s*:', r'\1"\2":', _raw)
                                _json_s = re.sub(r',\s*\]', ']', _json_s)
                                try:
                                    _parsed_activity_data = json.loads(_json_s)
                                except Exception:
                                    _parsed_activity_data = []
                                    if _parsed_activity_data: break
                    except Exception as _e2: pass
                if _parsed_activity_data:
                    yzoj_activity_data = _parsed_activity_data

                # ---- 3.5 solved/submission/rank from full text as fallback ----
                full_text = soup.get_text()
                if not rank_text:
                    rm = re.search(r'排名[\s]*(\d+)', full_text)
                    if rm: rank_text = rm.group(1)
                if solvedCount <= 0:
                    sm = re.search(r'(解决题数|通过题数|已解决|解决|AC\s*数|Solved)[^0-9]*(\d+)', full_text, re.I)
                    if sm:
                        try: solvedCount = int(sm.group(2))
                        except: pass
                if submissionCount <= 0:
                    tm = re.search(r'(尝试次数|提交次数|已提交|尝试|Submit|Submission)[^0-9]*(\d+)', full_text, re.I)
                    if tm:
                        try: submissionCount = int(tm.group(2))
                        except: pass
            except Exception as e_parse:
                print(f"[profile/full] parse warn: {e_parse}")
                import traceback; traceback.print_exc()
        
        if parsed_username and not final_uname: final_uname = parsed_username
        if parsed_uid and not final_uid: final_uid = parsed_uid
        if isBanned and solvedCount >= 0:
            solvedCount = -2

        # ===== Pre-check: does this user already exist in OJS? =====
        # Used to decide whether to populate OJS-only custom fields (avatar/header/sig/bio)
        # and whether to upsert into OJS DB at the end.
        _exists_in_ojs = False
        _conn = database.get_conn()
        try:
            _exist_check_keys = list({k for k in [final_uname, final_uid, username, uid] if k})
            for _ek in _exist_check_keys:
                if _exists_in_ojs: break
                _ek_str = str(_ek)
                if _ek_str.isdigit():
                    _row = _conn.execute("SELECT 1 FROM users WHERE uid=? LIMIT 1", (_ek_str,)).fetchone()
                    if not _row:
                        _row = _conn.execute("SELECT 1 FROM user_profiles WHERE uid=? LIMIT 1", (_ek_str,)).fetchone()
                    if not _row:
                        _row = _conn.execute("SELECT 1 FROM user_tags WHERE uid=? LIMIT 1", (_ek_str,)).fetchone()
                else:
                    _row = _conn.execute("SELECT 1 FROM users WHERE username=? LIMIT 1", (_ek_str,)).fetchone()
                    if not _row:
                        _row = _conn.execute("SELECT 1 FROM user_profiles WHERE username=? LIMIT 1", (_ek_str,)).fetchone()
                    if not _row:
                        _row = _conn.execute("SELECT 1 FROM user_tags WHERE username=? LIMIT 1", (_ek_str,)).fetchone()
                if _row:
                    _exists_in_ojs = True
                    break
        except Exception as _e_exist:
            print(f"[profile/full] exist-check warn: {_e_exist}")
            _exists_in_ojs = False

        # ===== Step 4: Resolve display username (REAL-TIME, no users table cache) =====
        _db_profile_for_name = None
        _db_profile_full = None
        if _exists_in_ojs:
            for _lk in [final_uname, final_uid, username, uid]:
                if not _lk: continue
                _pd = database.get_user_profile(_lk)
                if _pd and _pd.get('username'):
                    _cand = str(_pd['username']).strip()
                    if _cand and not _cand.isdigit():
                        _db_profile_for_name = _cand
                        _db_profile_full = _pd
                        break
                    elif not _db_profile_for_name and _cand:
                        _db_profile_for_name = _cand
                        _db_profile_full = _pd

        # If crawl failed, prioritize database data
        if not crawl_success and _db_profile_for_name and not parsed_username:
            parsed_username = _db_profile_for_name

        result_username = ''
        username_candidates = [parsed_username, final_uname, username, _db_profile_for_name]
        if not crawl_success:
            username_candidates = [_db_profile_for_name, final_uname, username, parsed_username]
        for _cand in username_candidates:
            if _cand and str(_cand).strip() and not str(_cand).strip().isdigit() and not _is_footer_name_global(_cand):
                result_username = str(_cand).strip()
                break
        if not result_username:
            for _cand in username_candidates:
                if _cand and str(_cand).strip():
                    _s = str(_cand).strip()
                    if not _is_footer_name_global(_s):
                        result_username = _s
                        break
        if not result_username or str(result_username).strip().isdigit():
            result_username = 'User #' + (str(final_uid or uid or '0'))
        final_display_username = result_username

        # ===== Auto-register: if crawl succeeded and user not in OJS DB, upsert them =====
        if crawl_success and not _exists_in_ojs and result_username and not result_username.isdigit():
            try:
                _reg_uid = str(final_uid or uid or parsed_uid or '')
                database.upsert_user(result_username, {
                    'username': result_username,
                    'uid': _reg_uid,
                    'nickname': result_username,
                    'solved_count': solvedCount,
                    'submission_count': submissionCount,
                    'rating': 0
                })
                print(f"[profile/full] Auto-registered new user: {result_username} (uid={_reg_uid})")
                _exists_in_ojs = True  # So downstream code can load OJS profile data
            except Exception as _reg_e:
                print(f"[profile/full] Auto-register failed for {result_username}: {_reg_e}")

        # ===== Step 5: user_profiles 表（ojserver独有：头像、头图、用户编辑的签名/简介）=====
        # 当用户不存在于 OJS 时，不填充这些 OJS 专属字段（只返回 YZOJ 原数据）
        av = ''; hv = ''
        db_sig = ''
        db_bio = ''
        db_bio_html = ''
        if _exists_in_ojs:
            db_sig = signature
            db_bio = bio
            db_bio_html = bio_html
            checked_uids = set()
            for _lk in [final_uname, final_uid, username, uid]:
                if not _lk: continue
                _lk_str = str(_lk)
                _is_uid = _lk_str.isdigit()
                _pd = database.get_user_profile(_lk_str, final_uid if _is_uid else None)
                if not _pd: continue
                if not av and _pd.get('avatar_url'): av = _pd['avatar_url']
                if not hv and _pd.get('header_image_url'): hv = _pd['header_image_url']
                if not db_sig and _pd.get('signature'): db_sig = _pd['signature']
                if not db_bio and _pd.get('bio'): db_bio = _pd['bio']
                if not db_bio_html and _pd.get('bio_html'): db_bio_html = _pd['bio_html']
                if av and hv and db_sig and db_bio and db_bio_html:
                    break
            if av and not av.startswith('http'):
                av = request.host_url.rstrip('/') + av
            if hv and not hv.startswith('http'):
                hv = request.host_url.rstrip('/') + hv

        # ===== Step 8: Solved problems（page parsed only）====
        merged_solved = []
        for sp in solved_problems_from_page:
            if sp.get('id'):
                merged_solved.append({
                    'id': sp['id'],
                    'title': sp.get('title') or '',
                    'difficulty': 0,
                    'pass_rate': 0,
                    'ac_count': 0,
                    'url': sp.get('url') or '',
                })

        # ===== Step 9: 最终统计（基于实时爬取，爬取失败且用户存在于OJS时才从数据库users表获取）=====
        db_solved = 0
        db_submission = 0
        db_nickname = ''
        db_school = ''
        db_email = ''
        if _exists_in_ojs:
            try:
                _user_db = None
                for _lk in [final_display_username, final_uname, final_uid, uid]:
                    if not _lk: continue
                    _u = database.get_user(_lk)
                    if _u:
                        _user_db = _u
                        break
                if not _user_db and final_uid:
                    _conn2 = database.get_conn()
                    _row = _conn2.execute("SELECT * FROM users WHERE uid=? LIMIT 1", (str(final_uid),)).fetchone()
                    if _row:
                        _user_db = dict(_row)
                if _user_db:
                    db_solved = int(_user_db.get('solved_count', 0) or 0)
                    db_submission = int(_user_db.get('submission_count', 0) or 0)
                    db_nickname = _user_db.get('nickname', '') or ''
            except Exception as _e_db:
                print(f"[profile/full] get user from db warn: {_e_db}")

        final_solved_count = max(
            solvedCount if (solvedCount is not None and solvedCount > 0) else 0,
            len(merged_solved)
        )
        final_submission_count = max(
            submissionCount if (submissionCount is not None and submissionCount > 0) else 0,
            0
        )

        if not crawl_success:
            if db_solved > final_solved_count:
                final_solved_count = db_solved
            if db_submission > final_submission_count:
                final_submission_count = db_submission
            if db_nickname and not realName:
                realName = db_nickname

        # ===== Step 10: Tags（ojserver独有，user_tags表）=====
        tags = _normalize_tags(database.get_user_tags(final_uname or final_uid or username or uid)) if _exists_in_ojs else []

        _session_deleted = _session_deleted if '_session_deleted' in dir() else False
        result = {
            'id': final_uid or uid or '',
            'uid': final_uid or uid or '',
            'username': final_display_username,
            'username_html': parsed_username_html or '',
            'nickname': realName or db_nickname or '',
            'realName': realName or db_nickname or '',
            'real_name': realName or db_nickname or '',
            'school': school or db_school or '',
            'email': email or db_email or '',
            'signature': db_sig if _exists_in_ojs else '',
            'bio': db_bio if _exists_in_ojs else '',
            'bio_html': db_bio_html if _exists_in_ojs else '',
            'avatar_url': av if _exists_in_ojs else '',
            'avatarUrl': av if _exists_in_ojs else '',
            'header_image_url': hv if _exists_in_ojs else '',
            'solvedCount': final_solved_count,
            'solved_count': final_solved_count,
            'submissionCount': final_submission_count,
            'submission_count': final_submission_count,
            'passRatePercent': round((final_solved_count / final_submission_count * 100), 1) if final_submission_count > 0 else 0,
            'rank': rank_text or '',
            'is_banned': isBanned,
            'isBanned': isBanned,
            'tags': tags,
            'solvedProblems': merged_solved,
            'activityData': yzoj_activity_data,
            'heatmapData': [],
            'color': parsed_user_color or '',
            'user_color': parsed_user_color or '',
            'permission_level': parsed_permission_level or 0,
            'permission_color': parsed_permission_color or '',
            'last_crawled': datetime.now().isoformat(),
            'session_expired': _session_deleted,
            'exists_in_ojs': _exists_in_ojs,
        }
        
        if _exists_in_ojs:
            try:
                print(f"[profile/full] upsert_user: username={final_display_username}, uid={final_uid}, original_uid={uid}, crawl_success={crawl_success}")
                _existing_user = None
                for _lk in [final_display_username, final_uname, final_uid, uid]:
                    if not _lk: continue
                    _u = database.get_user(_lk)
                    if _u:
                        _existing_user = _u
                        break
                if not _existing_user and final_uid:
                    _conn3 = database.get_conn()
                    _row = _conn3.execute("SELECT * FROM users WHERE uid=? LIMIT 1", (str(final_uid),)).fetchone()
                    if _row:
                        _existing_user = dict(_row)
                
                if crawl_success or _existing_user:
                    database.upsert_user(
                        final_display_username,
                        {
                            'uid': final_uid or uid or '',
                            'nickname': realName or '',
                            'solved_count': final_solved_count,
                            'submission_count': final_submission_count,
                            'rating': 0,
                            'last_crawled': datetime.now().isoformat()
                        }
                    )
                else:
                    print(f"[profile/full] skip upsert_user (crawl failed but existing data found)")
            except Exception as e:
                print(f"[profile/full] upsert_user error: {e}")
        else:
            print(f"[profile/full] skip upsert_user (user NOT in OJS, exists_in_ojs=False). username={final_display_username} uid={final_uid}")
        
        _debug_log('profile_full_result',
                   f"Returning profile for uid={final_uid}, username={final_display_username}",
                   parsed_data=result,
                   source='API result')
        
        print(f"[profile/full] TOTAL TIME: {_time.time()-_start_time:.3f}s")
        return jsonify(result)
    except Exception as e:
        print(f"[Error] get_user_profile_full_api: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

# ---- Test Route ----
@app.route('/api/test')
def test_route():
    return jsonify({'test': 'ok', 'time': datetime.now().isoformat()})

# ---- Admin UI ----
@app.route('/admin/', defaults={'path': ''})
@app.route('/admin/<path:path>')
def admin_ui(path):
    if not path: return send_from_directory(os.path.join(os.path.dirname(__file__), 'static'), 'admin.html')
    return send_from_directory(os.path.join(os.path.dirname(__file__), 'static'), path)

# ---- Startup ----
def run_server():
    config.load_config()
    database.get_conn()
    host = config.get('server_host', '127.0.0.1')
    port = config.get('server_port', 8199)
    print(f"OJ Proxy Server on http://{host}:{port}")
    print(f"Admin: http://{host}:{port}/admin/")
    app.run(host=host, port=port, debug=False)

if __name__ == '__main__':
    run_server()
