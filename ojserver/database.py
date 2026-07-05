"""Database module for OJ Proxy Server"""
import sqlite3
import os
import json
import hashlib
from datetime import datetime

def _hash_pw(pw):
    """SHA-256 hash of a password. Returns empty string if empty."""
    if not pw:
        return ''
    return hashlib.sha256(pw.encode('utf-8')).hexdigest()

def _row_to_dict(row):
    """Safely convert a sqlite3.Row to a dict, handling potential IndexError."""
    try:
        return dict(row)
    except (IndexError, ValueError):
        try:
            return {k: row[k] for k in row.keys()} if hasattr(row, 'keys') else {}
        except Exception:
            return {}
import config

_conn = None

def get_conn():
    global _conn
    if _conn is None:
        db_path = config.get('db_path')
        _conn = sqlite3.connect(db_path, check_same_thread=False)
        _conn.row_factory = sqlite3.Row
        _init_db()
    return _conn

def _init_db():
    conn = get_conn()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS contests (
            id TEXT PRIMARY KEY,
            name TEXT,
            type TEXT,
            time TEXT,
            end_time TEXT DEFAULT '',
            status TEXT,
            url TEXT,
            permission TEXT,
            author TEXT DEFAULT '',
            description TEXT DEFAULT '',
            problem_ids TEXT DEFAULT '',
            last_crawled TEXT DEFAULT (datetime('now'))
        );
        
        CREATE TABLE IF NOT EXISTS problems (
            id TEXT PRIMARY KEY,
            title TEXT,
            difficulty REAL,
            permission TEXT,
            pass_rate REAL,
            ac_count INTEGER,
            sub_count INTEGER,
            tags TEXT DEFAULT '[]',
            authors TEXT DEFAULT '[]',
            time_limit TEXT,
            memory_limit TEXT,
            content TEXT,
            sample_input TEXT,
            sample_output TEXT,
            is_crawled INTEGER DEFAULT 0,
            is_hidden INTEGER DEFAULT 0,
            crawl_error TEXT,
            last_crawled TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        );
        
        CREATE TABLE IF NOT EXISTS crawl_status (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            status TEXT DEFAULT 'idle',
            total INTEGER DEFAULT 0,
            crawled INTEGER DEFAULT 0,
            failed INTEGER DEFAULT 0,
            message TEXT,
            started_at TEXT,
            finished_at TEXT
        );
        
        CREATE TABLE IF NOT EXISTS contest_problem_mapping (
            contest_id TEXT NOT NULL,
            problem_order TEXT NOT NULL,
            problem_id TEXT,
            problem_title TEXT,
            PRIMARY KEY (contest_id, problem_order)
        );
        
        CREATE TABLE IF NOT EXISTS admin_sessions (
            token TEXT PRIMARY KEY,
            username TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now'))
        );
        
        CREATE TABLE IF NOT EXISTS user_sessions (
            token TEXT PRIMARY KEY,
            yzoj_cookie TEXT NOT NULL,
            yzoj_uid TEXT NOT NULL,
            yzoj_username TEXT NOT NULL,
            is_admin INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now')),
            last_active TEXT DEFAULT (datetime('now'))
        );
    """)
    conn.commit()
    _migrate_db(conn)

def _migrate_db(conn):
    def has_column(table, col):
        rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
        return any(row['name'] == col for row in rows)
    
    for col in ['content_html', 'sample_input_html', 'sample_output_html']:
        if not has_column('problems', col):
            try:
                conn.execute(f"ALTER TABLE problems ADD COLUMN {col} TEXT DEFAULT ''")
                print(f"DB migration: Added {col} to problems")
            except Exception as e:
                print(f"DB migration note: {e}")
    
    if not has_column('contests', 'description_html'):
        try:
            conn.execute("ALTER TABLE contests ADD COLUMN description_html TEXT DEFAULT ''")
            print("DB migration: Added description_html to contests")
        except Exception as e:
            print(f"DB migration note: {e}")
    
    # Add user color and permission level columns to user_sessions
    for col in ['yzoj_user_color', 'yzoj_permission_level']:
        if not has_column('user_sessions', col):
            try:
                conn.execute(f"ALTER TABLE user_sessions ADD COLUMN {col} TEXT DEFAULT ''")
                print(f"DB migration: Added {col} to user_sessions")
            except Exception as e:
                print(f"DB migration note: {e}")
    
    # Add impersonate_username to admin_sessions
    if not has_column('admin_sessions', 'impersonate_username'):
        try:
            conn.execute("ALTER TABLE admin_sessions ADD COLUMN impersonate_username TEXT DEFAULT NULL")
            print("DB migration: Added impersonate_username to admin_sessions")
        except Exception as e:
            print(f"DB migration note: {e}")
    
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS discussions (
            id TEXT PRIMARY KEY,
            title TEXT,
            author TEXT,
            content TEXT,
            content_html TEXT DEFAULT '',
            problem_id TEXT,
            contest_id TEXT,
            category TEXT DEFAULT 'discussion',
            created_at TEXT,
            reply_count INTEGER DEFAULT 0,
            like_count INTEGER DEFAULT 0,
            last_reply_at TEXT,
            last_crawled TEXT DEFAULT (datetime('now'))
        );
        
        CREATE TABLE IF NOT EXISTS discussion_replies (
            id TEXT PRIMARY KEY,
            discussion_id TEXT NOT NULL,
            author TEXT,
            content TEXT,
            content_html TEXT DEFAULT '',
            created_at TEXT,
            like_count INTEGER DEFAULT 0,
            last_crawled TEXT DEFAULT (datetime('now'))
        );
        
        CREATE TABLE IF NOT EXISTS likes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            target_type TEXT NOT NULL,
            target_id TEXT NOT NULL,
            username TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now')),
            UNIQUE(target_type, target_id, username)
        );
        
        CREATE TABLE IF NOT EXISTS users (
            username TEXT PRIMARY KEY,
            nickname TEXT,
            solved_count INTEGER DEFAULT 0,
            submission_count INTEGER DEFAULT 0,
            last_crawled TEXT
        );
        
        CREATE TABLE IF NOT EXISTS user_profiles (
            username TEXT PRIMARY KEY,
            avatar_url TEXT DEFAULT '',
            header_image_url TEXT DEFAULT '',
            signature TEXT DEFAULT '',
            bio TEXT DEFAULT '',
            bio_html TEXT DEFAULT '',
            updated_at TEXT DEFAULT (datetime('now'))
        );
        
        CREATE TABLE IF NOT EXISTS user_submissions (
            id TEXT PRIMARY KEY,
            username TEXT NOT NULL,
            problem_id TEXT,
            score INTEGER DEFAULT 0,
            status TEXT,
            time TEXT,
            memory TEXT,
            compiler TEXT,
            submit_time TEXT,
            last_crawled TEXT DEFAULT (datetime('now'))
        );
        
        CREATE TABLE IF NOT EXISTS solutions (
            id TEXT PRIMARY KEY,
            problem_id TEXT NOT NULL,
            author TEXT,
            title TEXT,
            content TEXT,
            content_html TEXT DEFAULT '',
            created_at TEXT,
            updated_at TEXT,
            last_crawled TEXT DEFAULT (datetime('now'))
        );
        
        CREATE TABLE IF NOT EXISTS solution_likes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            solution_id TEXT NOT NULL,
            username TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now')),
            UNIQUE(solution_id, username)
        );
        
        CREATE TABLE IF NOT EXISTS solution_comments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            solution_id TEXT NOT NULL,
            parent_id INTEGER DEFAULT 0,
            username TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        );
        
        CREATE TABLE IF NOT EXISTS solution_comment_likes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            comment_id INTEGER NOT NULL,
            username TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now')),
            UNIQUE(comment_id, username)
        );
        
        CREATE TABLE IF NOT EXISTS admin_users (
            username TEXT PRIMARY KEY,
            password_hash TEXT NOT NULL,
            role TEXT DEFAULT 'admin',
            created_at TEXT DEFAULT (datetime('now'))
        );
        
        CREATE TABLE IF NOT EXISTS problem_sets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            owner TEXT NOT NULL,
            title TEXT DEFAULT '',
            description TEXT DEFAULT '',
            is_public INTEGER DEFAULT 0,
            problem_ids TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        );
        
        CREATE TABLE IF NOT EXISTS system_meta (
            key TEXT PRIMARY KEY,
            value TEXT,
            updated_at TEXT DEFAULT (datetime('now'))
        );
        
        CREATE TABLE IF NOT EXISTS user_tags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            tag TEXT NOT NULL,
            color TEXT DEFAULT '#6366f1',
            created_at TEXT DEFAULT (datetime('now')),
            UNIQUE(username, tag)
        );

        CREATE TABLE IF NOT EXISTS user_first_ac (
            uid TEXT NOT NULL,
            problem_id TEXT NOT NULL,
            ac_date TEXT NOT NULL,
            submission_id TEXT,
            username TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            PRIMARY KEY (uid, problem_id)
        );
        CREATE INDEX IF NOT EXISTS idx_uac_uid_date ON user_first_ac(uid, ac_date);
        CREATE INDEX IF NOT EXISTS idx_uac_user_ac ON user_first_ac(username, ac_date);
    """)
    conn.commit()
    # ---- Migration: add uid column to users / user_profiles / user_tags ----
    for tbl, col in [('users', 'uid'), ('user_profiles', 'uid'), ('user_submissions', 'uid'),
                     ('user_tags', 'uid')]:
        if not has_column(tbl, col):
            try:
                conn.execute(f"ALTER TABLE {tbl} ADD COLUMN {col} TEXT DEFAULT ''")
                print(f"DB migration: Added {col} to {tbl}")
            except Exception:
                pass
    if not has_column('users', 'is_banned'):
        try:
            conn.execute("ALTER TABLE users ADD COLUMN is_banned INTEGER DEFAULT 0")
        except Exception:
            pass
    if not has_column('users', 'rank'):
        try:
            conn.execute("ALTER TABLE users ADD COLUMN rank TEXT DEFAULT ''")
        except Exception:
            pass
    if not has_column('users', 'real_name'):
        try:
            conn.execute("ALTER TABLE users ADD COLUMN real_name TEXT DEFAULT ''")
        except Exception:
            pass
    if not has_column('users', 'school'):
        try:
            conn.execute("ALTER TABLE users ADD COLUMN school TEXT DEFAULT ''")
        except Exception:
            pass
    if not has_column('users', 'email'):
        try:
            conn.execute("ALTER TABLE users ADD COLUMN email TEXT DEFAULT ''")
        except Exception:
            pass
    if not has_column('users', 'signature'):
        try:
            conn.execute("ALTER TABLE users ADD COLUMN signature TEXT DEFAULT ''")
        except Exception:
            pass
    if not has_column('users', 'bio'):
        try:
            conn.execute("ALTER TABLE users ADD COLUMN bio TEXT DEFAULT ''")
        except Exception:
            pass
    if not has_column('users', 'bio_html'):
        try:
            conn.execute("ALTER TABLE users ADD COLUMN bio_html TEXT DEFAULT ''")
        except Exception:
            pass
    # Migration: add description column if missing
    if not has_column('problem_sets', 'description'):
        try:
            conn.execute("ALTER TABLE problem_sets ADD COLUMN description TEXT DEFAULT ''")
            print("DB migration: Added description to problem_sets")
        except:
            pass
    for col in ['like_count']:
        if not has_column('discussions', col):
            try:
                conn.execute(f"ALTER TABLE discussions ADD COLUMN {col} INTEGER DEFAULT 0")
                print(f"DB migration: Added {col} to discussions")
            except:
                pass
        if not has_column('discussion_replies', col):
            try:
                conn.execute(f"ALTER TABLE discussion_replies ADD COLUMN {col} INTEGER DEFAULT 0")
                print(f"DB migration: Added {col} to discussion_replies")
            except:
                pass
    # Migration for problem_sets: add description if missing
    if not has_column('problem_sets', 'description'):
        try:
            conn.execute("ALTER TABLE problem_sets ADD COLUMN description TEXT DEFAULT ''")
        except:
            pass
    if not has_column('admin_users', 'email'):
        try:
            conn.execute("ALTER TABLE admin_users ADD COLUMN email TEXT DEFAULT ''")
        except:
            pass
    # Migration for problem_sets: permission fields
    for col in ['format', 'permission', 'password', 'allowed_users', 'denied_users', 'creator_uid', 'password_authorized_users']:
        if not has_column('problem_sets', col):
            try:
                conn.execute(f"ALTER TABLE problem_sets ADD COLUMN {col} TEXT DEFAULT ''")
                print(f"DB migration: Added {col} to problem_sets")
            except:
                pass
    # Create discussion posts system tables
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS posts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            original_id TEXT UNIQUE,
            post_type TEXT NOT NULL,
            parent_id TEXT NOT NULL,
            author TEXT,
            title TEXT DEFAULT '',
            content TEXT,
            content_html TEXT DEFAULT '',
            created_at TEXT,
            like_count INTEGER DEFAULT 0,
            comment_count INTEGER DEFAULT 0,
            source TEXT DEFAULT 'yzoj',
            is_deleted INTEGER DEFAULT 0
        );
        
        CREATE TABLE IF NOT EXISTS post_likes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            post_id INTEGER NOT NULL,
            username TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now')),
            UNIQUE(post_id, username)
        );
        
        CREATE TABLE IF NOT EXISTS post_comments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            post_id INTEGER NOT NULL,
            parent_comment_id INTEGER DEFAULT 0,
            author TEXT,
            content TEXT,
            content_html TEXT DEFAULT '',
            like_count INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now'))
        );
    """)
    conn.commit()

# ---- User Tags ----
def get_user_tags(lookup_key):
    """Get all tags for a user. lookup_key can be username or uid (numeric string)."""
    conn = get_conn()
    if isinstance(lookup_key, str) and lookup_key.isdigit():
        # 数字字符串 => 按 uid 列查找（user_tags 表有 uid 列，由 migration 添加）
        rows = conn.execute("SELECT * FROM user_tags WHERE uid=?", (lookup_key,)).fetchall()
        if not rows:
            # 兜底：也按 username 列查找（兼容旧数据）
            rows = conn.execute("SELECT * FROM user_tags WHERE username=?", (lookup_key,)).fetchall()
    else:
        rows = conn.execute("SELECT * FROM user_tags WHERE username=?", (lookup_key,)).fetchall()
    return [_row_to_dict(r) for r in rows]

def get_user_tags_batch(uids=None, usernames=None):
    """Get tags for multiple users at once.
    uids: list of UID strings.
    usernames: list of username strings.
    Returns a dict mapping uid/username -> list of {tag, color}."""
    conn = get_conn()
    result = {}
    if uids:
        uids = [u for u in uids if u]
        if uids:
            placeholders = ','.join('?' * len(uids))
            rows = conn.execute(f"SELECT uid, tag, color FROM user_tags WHERE uid IN ({placeholders})", uids).fetchall()
            for uid in uids:
                result[uid] = []
            for r in rows:
                uid = r['uid']
                tag = r['tag']
                color = r['color'] or '#6366f1'
                if uid in result:
                    result[uid].append({'tag': tag, 'color': color})
    if usernames:
        usernames = [u for u in usernames if u]
        if usernames:
            placeholders = ','.join('?' * len(usernames))
            rows = conn.execute(f"SELECT username, tag, color FROM user_tags WHERE username IN ({placeholders})", usernames).fetchall()
            for uname in usernames:
                if uname not in result:
                    result[uname] = []
            for r in rows:
                uname = r['username']
                tag = r['tag']
                color = r['color'] or '#6366f1'
                if uname in result:
                    result[uname].append({'tag': tag, 'color': color})
    return result

def set_user_tag(username, tag, color='#6366f1'):
    """Set a tag for a user"""
    conn = get_conn()
    conn.execute("""
        INSERT INTO user_tags (username, tag, color) VALUES (?, ?, ?)
        ON CONFLICT(username, tag) DO UPDATE SET color=excluded.color
    """, (username, tag, color))
    conn.commit()

def delete_user_tag(username, tag):
    """Remove a tag from a user"""
    conn = get_conn()
    conn.execute("DELETE FROM user_tags WHERE username=? AND tag=?", (username, tag))
    conn.commit()

def delete_all_user_tags(username):
    """Remove all tags from a user"""
    conn = get_conn()
    conn.execute("DELETE FROM user_tags WHERE username=?", (username,))
    conn.commit()


def delete_user(username):
    """Delete a user and all related data (profile, tags, submissions, sessions, likes, comments, discussions, posts, solutions).

    Returns a dict with counts of deleted rows per table.
    """
    username = (username or '').strip()
    if not username:
        raise ValueError('username is required')
    conn = get_conn()
    counts = {}
    try:
        conn.execute('BEGIN TRANSACTION')

        cur = conn.execute("DELETE FROM users WHERE username=?", (username,))
        counts['users'] = cur.rowcount
        deleted_users = counts['users']

        cur = conn.execute("DELETE FROM user_profiles WHERE username=?", (username,))
        counts['user_profiles'] = cur.rowcount

        cur = conn.execute("DELETE FROM user_tags WHERE username=?", (username,))
        counts['user_tags'] = cur.rowcount

        cur = conn.execute("DELETE FROM user_submissions WHERE username=?", (username,))
        counts['user_submissions'] = cur.rowcount

        cur = conn.execute("DELETE FROM user_first_ac WHERE username=? OR uid IN (SELECT uid FROM users WHERE username=?)", (username, username))
        counts['user_first_ac'] = cur.rowcount

        cur = conn.execute("DELETE FROM user_sessions WHERE yzoj_username=?", (username,))
        counts['user_sessions'] = cur.rowcount

        cur = conn.execute("DELETE FROM likes WHERE username=?", (username,))
        counts['likes'] = cur.rowcount

        cur = conn.execute("DELETE FROM solution_likes WHERE username=?", (username,))
        counts['solution_likes'] = cur.rowcount

        cur = conn.execute("DELETE FROM solution_comment_likes WHERE username=?", (username,))
        counts['solution_comment_likes'] = cur.rowcount

        cur = conn.execute("DELETE FROM solution_comments WHERE username=?", (username,))
        counts['solution_comments'] = cur.rowcount

        cur = conn.execute("DELETE FROM solutions WHERE author=?", (username,))
        counts['solutions'] = cur.rowcount

        cur = conn.execute("DELETE FROM discussions WHERE author=?", (username,))
        counts['discussions'] = cur.rowcount

        cur = conn.execute("DELETE FROM discussion_replies WHERE author=?", (username,))
        counts['discussion_replies'] = cur.rowcount

        cur = conn.execute("DELETE FROM posts WHERE author=?", (username,))
        counts['posts'] = cur.rowcount

        cur = conn.execute("DELETE FROM post_likes WHERE username=?", (username,))
        counts['post_likes'] = cur.rowcount

        cur = conn.execute("DELETE FROM post_comments WHERE author=?", (username,))
        counts['post_comments'] = cur.rowcount

        cur = conn.execute("DELETE FROM problem_sets WHERE owner=?", (username,))
        counts['problem_sets'] = cur.rowcount

        conn.commit()
        counts['_deleted_user'] = deleted_users
        return counts
    except Exception:
        try:
            conn.execute('ROLLBACK')
        except Exception:
            pass
        raise

# ---- User First-AC Records (heatmap) ----
def upsert_user_first_ac(uid, problem_id, ac_date, submission_id=None, username=None):
    conn = get_conn()
    try:
        conn.execute("""
            INSERT INTO user_first_ac (uid, problem_id, ac_date, submission_id, username)
            VALUES (?,?,?,?,?)
            ON CONFLICT(uid, problem_id) DO NOTHING
        """, (str(uid), str(problem_id), str(ac_date),
              str(submission_id) if submission_id else None,
              str(username) if username else None))
        conn.commit()
        return True
    except Exception as e:
        return False

def bulk_upsert_user_first_ac(records):
    """records: list of (uid, problem_id, ac_date, submission_id, username)"""
    if not records:
        return 0
    conn = get_conn()
    cur = conn.cursor()
    inserted = 0
    for r in records:
        try:
            cur.execute("""
                INSERT INTO user_first_ac (uid, problem_id, ac_date, submission_id, username)
                VALUES (?,?,?,?,?)
                ON CONFLICT(uid, problem_id) DO NOTHING
            """, (str(r[0]), str(r[1]), str(r[2]),
                  str(r[3]) if r[3] is not None else None,
                  str(r[4]) if r[4] is not None else None))
            if cur.rowcount and cur.rowcount > 0:
                inserted += 1
        except Exception:
            pass
    conn.commit()
    return inserted

def get_user_first_ac_all(uid=None, username=None):
    conn = get_conn()
    rows = []
    if uid:
        rows = conn.execute("SELECT uid, problem_id, ac_date, submission_id, username FROM user_first_ac WHERE uid=?",
                            (str(uid),)).fetchall()
    elif username:
        rows = conn.execute("SELECT uid, problem_id, ac_date, submission_id, username FROM user_first_ac WHERE username=?",
                            (str(username),)).fetchall()
    return [dict(r) for r in rows]

def get_user_first_ac_heatmap(uid=None, username=None, months=6):
    conn = get_conn()
    today = __import__('datetime').date.today()
    start = today - __import__('datetime').timedelta(days=months*31)
    start_str = start.strftime('%Y-%m-%d')
    sql = """
        SELECT ac_date AS day, COUNT(*) AS count
        FROM user_first_ac
        WHERE ac_date >= ?
          AND (uid=? OR username=?)
        GROUP BY ac_date
        ORDER BY ac_date ASC
    """
    args = (start_str, str(uid or ''), str(username or ''))
    rows = conn.execute(sql, args).fetchall()
    result = []
    total_new = 0
    for r in rows:
        d = dict(r)
        result.append({'day': d['day'], 'count': int(d['count'])})
        total_new += int(d['count'])
    return result, total_new

# ---- User Profile (full aggregate) ----
def upsert_user_full_info(user_data):
    """user_data: dict with username, uid, real_name, solved_count etc."""
    conn = get_conn()
    username = user_data.get('username') or ''
    if not username:
        return False
    uid = str(user_data.get('uid') or user_data.get('id') or '')
    try:
        conn.execute("""
            INSERT INTO users (username, uid, nickname, solved_count, submission_count, real_name, school, email, signature, bio, bio_html, `rank`, is_banned, last_crawled)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, datetime('now'))
            ON CONFLICT(username) DO UPDATE SET
                uid=excluded.uid,
                nickname=excluded.nickname,
                solved_count=excluded.solved_count,
                submission_count=excluded.submission_count,
                real_name=excluded.real_name,
                school=excluded.school,
                email=excluded.email,
                signature=excluded.signature,
                bio=excluded.bio,
                bio_html=excluded.bio_html,
                `rank`=excluded.rank,
                is_banned=excluded.is_banned,
                last_crawled=datetime('now')
        """, (
            username, uid,
            user_data.get('nickname') or user_data.get('realName') or '',
            int(user_data.get('solved_count') if user_data.get('solved_count') is not None else (user_data.get('solvedCount') or 0)),
            int(user_data.get('submission_count') if user_data.get('submission_count') is not None else (user_data.get('submissionCount') or 0)),
            user_data.get('real_name') or user_data.get('realName') or '',
            user_data.get('school') or '',
            user_data.get('email') or '',
            user_data.get('signature') or '',
            user_data.get('bio') or '',
            user_data.get('bio_html') or '',
            user_data.get('rank') or '',
            1 if (user_data.get('is_banned') or user_data.get('isBanned') or
                  (user_data.get('solvedCount') is not None and int(user_data.get('solvedCount') or 0) < -1)) else 0
        ))
        conn.commit()
        return True
    except Exception as e:
        print(f"[DB upsert_user_full_info] error: {e}")
        return False

def get_user_profile_full(uid=None, username=None):
    conn = get_conn()
    base = None
    if uid:
        row = conn.execute("SELECT * FROM users WHERE uid=? LIMIT 1", (str(uid),)).fetchone()
        if not row and str(uid).isdigit() is False:
            row = conn.execute("SELECT * FROM users WHERE username=? LIMIT 1", (str(uid),)).fetchone()
        base = dict(row) if row else None
    if not base and username:
        row = conn.execute("SELECT * FROM users WHERE username=? LIMIT 1", (str(username),)).fetchone()
        base = dict(row) if row else None
    if not base:
        return None
    profile_row = conn.execute("SELECT * FROM user_profiles WHERE username=? LIMIT 1",
                               (base['username'],)).fetchone()
    profile = dict(profile_row) if profile_row else {}
    tags_rows = conn.execute("SELECT tag, color FROM user_tags WHERE username=?",
                             (base['username'],)).fetchall()
    tags = [{'tag': r['tag'], 'color': r['color']} for r in tags_rows]
    solved_rows = conn.execute("""
        SELECT p.id, p.title, p.difficulty, p.pass_rate, p.ac_count, p.sub_count
        FROM user_first_ac a
        LEFT JOIN problems p ON p.id = a.problem_id
        WHERE a.uid=? OR a.username=?
        ORDER BY a.ac_date DESC
    """, (base.get('uid') or '', base['username']))
    solved_list = []
    for r in solved_rows:
        d = dict(r)
        if d.get('id'):
            solved_list.append({
                'id': d['id'],
                'title': d.get('title') or '',
                'difficulty': d.get('difficulty') or 0,
                'pass_rate': d.get('pass_rate') or 0,
                'ac_count': d.get('ac_count') or 0,
            })
    return {
        'id': base.get('uid') or '',
        'uid': base.get('uid') or '',
        'username': base.get('username') or '',
        'nickname': base.get('nickname') or '',
        'realName': base.get('real_name') or '',
        'real_name': base.get('real_name') or '',
        'school': base.get('school') or '',
        'email': base.get('email') or '',
        'signature': base.get('signature') or (profile.get('signature') if profile else '') or '',
        'bio': base.get('bio') or (profile.get('bio') if profile else '') or '',
        'bio_html': base.get('bio_html') or (profile.get('bio_html') if profile else '') or '',
        'avatar_url': profile.get('avatar_url') if profile else '' or '',
        'header_image_url': profile.get('header_image_url') if profile else '' or '',
        'solvedCount': int(base.get('solved_count') or 0),
        'solved_count': int(base.get('solved_count') or 0),
        'submissionCount': int(base.get('submission_count') or 0),
        'submission_count': int(base.get('submission_count') or 0),
        'rank': base.get('rank') or '',
        'is_banned': bool(base.get('is_banned') or 0),
        'isBanned': bool(base.get('is_banned') or 0),
        'last_crawled': base.get('last_crawled') or '',
        'tags': tags,
        'solvedProblems': solved_list
    }

def resolve_user_id(uid=None, username=None):
    """Given either uid or username, return (uid, username) pair as far as possible.
    Tries users table first, then user_profiles table as fallback."""
    conn = get_conn()
    if uid and username:
        return str(uid), str(username)
    if uid:
        row = conn.execute("SELECT uid, username FROM users WHERE uid=? LIMIT 1", (str(uid),)).fetchone()
        if row and (row['uid'] or row['username']):
            return str(row['uid'] or uid), str(row['username'] or '')
        row2 = conn.execute("SELECT uid, username FROM user_profiles WHERE uid=? LIMIT 1", (str(uid),)).fetchone()
        if row2:
            u = str(row2['username'] or '').strip()
            if u and not u.isdigit():
                return str(row2['uid'] or uid), u
            return str(row2['uid'] or uid), u
        return str(uid), ''
    if username:
        uname_str = str(username)
        row = conn.execute("SELECT uid, username FROM users WHERE username=? LIMIT 1", (uname_str,)).fetchone()
        if row and (row['uid'] or row['username']):
            return str(row['uid'] or ''), str(row['username'] or username)
        row2 = conn.execute("SELECT uid, username FROM user_profiles WHERE username=? LIMIT 1", (uname_str,)).fetchone()
        if row2:
            return str(row2['uid'] or ''), str(row2['username'] or username)
        if uname_str.isdigit():
            row3 = conn.execute("SELECT uid, username FROM user_profiles WHERE uid=? LIMIT 1", (uname_str,)).fetchone()
            if row3:
                return str(row3['uid'] or uname_str), str(row3['username'] or '')
        return '', str(username)
    return '', ''

def close():
    global _conn
    if _conn:
        _conn.close()
        _conn = None

# ---- Admin User Management ----
def hash_password(password):
    import hashlib
    return hashlib.sha256(password.encode()).hexdigest()

def root_exists():
    conn = get_conn()
    row = conn.execute("SELECT * FROM admin_users WHERE role='root'").fetchone()
    return row is not None

def create_root(password):
    conn = get_conn()
    conn.execute("INSERT OR REPLACE INTO admin_users (username, password_hash, role) VALUES (?, ?, 'root')",
                 ('root', hash_password(password)))
    conn.commit()

def create_admin_user(username, password, role='admin'):
    conn = get_conn()
    conn.execute("INSERT OR REPLACE INTO admin_users (username, password_hash, role) VALUES (?, ?, ?)",
                 (username, hash_password(password), role))
    conn.commit()

def verify_admin_login(username, password):
    conn = get_conn()
    row = conn.execute("SELECT * FROM admin_users WHERE username=?", (username,)).fetchone()
    if row and row['password_hash'] == hash_password(password):
        return dict(row)
    return None

def get_all_admin_users():
    conn = get_conn()
    rows = conn.execute("SELECT username, role, created_at FROM admin_users ORDER BY role, username").fetchall()
    return [dict(r) for r in rows]

def delete_admin_user(username):
    conn = get_conn()
    conn.execute("DELETE FROM admin_users WHERE username=? AND role!='root'", (username,))
    conn.commit()

# ---- Problem Sets (题单) ----
def create_problem_set(owner, title, is_public, problem_ids, description='', content_format='html', 
                       permission='public', password='', allowed_users='', denied_users=''):
    conn = get_conn()
    password = _hash_pw(password)
    cursor = conn.execute("""
        INSERT INTO problem_sets (owner, title, is_public, problem_ids, description, 
            format, permission, password, allowed_users, denied_users) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (owner, title, 1 if is_public else 0, 
         ','.join(problem_ids) if isinstance(problem_ids, list) else problem_ids,
         description, content_format, permission, password, allowed_users, denied_users))
    conn.commit()
    return cursor.lastrowid

def update_problem_set(psid, title, is_public, problem_ids, owner, description='', content_format='html',
                       permission='public', password='', allowed_users='', denied_users=''):
    conn = get_conn()
    row = conn.execute("SELECT * FROM problem_sets WHERE id=? AND owner=?", (psid, owner)).fetchone()
    if not row:
        return False
    # If password is empty, keep the original (no change)
    if not password:
        password = row['password']
    else:
        password = _hash_pw(password)
    # Clear authorized users if password changed
    password_authorized_users = dict(row).get('password_authorized_users', '') or ''
    if row['permission'] == 'password' and row['password'] != password:
        password_authorized_users = ''
    conn.execute("""
        UPDATE problem_sets SET title=?, is_public=?, problem_ids=?, description=?, 
            format=?, permission=?, password=?, allowed_users=?, denied_users=?, 
            password_authorized_users=?, updated_at=datetime('now') 
        WHERE id=?""",
        (title, 1 if is_public else 0, 
         ','.join(problem_ids) if isinstance(problem_ids, list) else problem_ids,
         description, content_format, permission, password, allowed_users, denied_users, 
         password_authorized_users, psid))
    conn.commit()
    return True

def delete_problem_set(psid, owner):
    conn = get_conn()
    row = conn.execute("SELECT * FROM problem_sets WHERE id=? AND owner=?", (psid, owner)).fetchone()
    if not row:
        return False
    conn.execute("DELETE FROM problem_sets WHERE id=?", (psid,))
    conn.commit()
    return True

def get_problem_set_by_id(psid):
    conn = get_conn()
    row = conn.execute("SELECT * FROM problem_sets WHERE id=?", (psid,)).fetchone()
    return dict(row) if row else None

def get_user_problem_sets(owner):
    conn = get_conn()
    rows = conn.execute("SELECT * FROM problem_sets WHERE owner=? ORDER BY updated_at DESC", (owner,)).fetchall()
    return [dict(r) for r in rows]

def get_public_problem_sets():
    conn = get_conn()
    rows = conn.execute("SELECT * FROM problem_sets WHERE is_public=1 ORDER BY updated_at DESC").fetchall()
    return [dict(r) for r in rows]

def get_problem_sets_with_permission(username):
    conn = get_conn()
    all_sets = conn.execute("SELECT * FROM problem_sets ORDER BY updated_at DESC").fetchall()
    result = []
    for row in all_sets:
        ps = dict(row)
        perm = ps.get('permission', '') or (ps.get('is_public') and 'public' or 'private')
        allowed_users = [u.strip() for u in (ps.get('allowed_users', '') or '').split(',') if u.strip()]
        denied_users = [u.strip() for u in (ps.get('denied_users', '') or '').split(',') if u.strip()]
        can_access = False
        
        if perm == 'public':
            can_access = True
        elif perm == 'private':
            can_access = username == ps.get('owner')
        elif perm == 'password':
            can_access = True  # 密码保护的题单在列表中可见，查看详情时需输入密码
        elif perm == 'whitelist':
            can_access = username in allowed_users or username == ps.get('owner')
        elif perm == 'blacklist':
            can_access = username not in denied_users or username == ps.get('owner')
        else:
            can_access = username == ps.get('owner')
        
        if can_access:
            result.append(ps)
    return result

def verify_problem_set_password(psid, password, username):
    """Verify password for a password-protected problem set and authorize the user."""
    conn = get_conn()
    row = conn.execute("SELECT password, permission, password_authorized_users FROM problem_sets WHERE id=?", (psid,)).fetchone()
    if not row:
        return False, '题单不存在'
    if row['permission'] != 'password':
        return False, '该题单无需密码'
    if row['password'] != _hash_pw(password):
        # Backward compatibility: check if stored value is still plaintext
        if row['password'] == password:
            # Upgrade to hash
            conn.execute("UPDATE problem_sets SET password=? WHERE id=?", (_hash_pw(password), psid))
            conn.commit()
        else:
            return False, '密码错误'
    # Add user to authorized list if not already there
    authorized = [u.strip() for u in (row['password_authorized_users'] or '').split(',') if u.strip()]
    if username and username not in authorized:
        authorized.append(username)
        conn.execute("UPDATE problem_sets SET password_authorized_users=? WHERE id=?", (','.join(authorized), psid))
        conn.commit()
    return True, '验证成功'

def search_problem_sets(params, username=''):
    conn = get_conn()
    conditions = ["1=1"]; args = []
    keyword = params.get('keyword', '').strip()
    if keyword:
        # Also search problems table for matching problem IDs or names
        matching_pids = []
        try:
            prob_rows = conn.execute(
                "SELECT id FROM problems WHERE id LIKE ? OR title LIKE ?",
                (f'%{keyword}%', f'%{keyword}%')
            ).fetchall()
            matching_pids = [r['id'] for r in prob_rows]
        except:
            pass
        # Build keyword condition: search title, description, owner, and problem_ids
        if matching_pids:
            # Find problem_sets whose problem_ids contain any matching problem ID
            pid_conditions = " OR ".join(["problem_ids LIKE ?" for _ in matching_pids])
            pid_args = [f'%{pid}%' for pid in matching_pids]
            conditions.append(
                "(title LIKE ? OR description LIKE ? OR owner LIKE ? OR problem_ids LIKE ? OR " + pid_conditions + ")"
            )
            args.extend([f'%{keyword}%', f'%{keyword}%', f'%{keyword}%', f'%{keyword}%'])
            args.extend(pid_args)
        else:
            conditions.append("(title LIKE ? OR description LIKE ? OR owner LIKE ? OR problem_ids LIKE ?)")
            args.extend([f'%{keyword}%', f'%{keyword}%', f'%{keyword}%', f'%{keyword}%'])
    owner = params.get('owner', '').strip()
    if owner: conditions.append("owner=?"); args.append(owner)
    is_public = params.get('is_public', '').strip()
    if is_public == '1': conditions.append("is_public=1")
    elif is_public == '0': conditions.append("is_public=0")
    where = " AND ".join(conditions)
    page = int(params.get('page', 1))
    page_size = int(params.get('page_size', 20))
    offset = (page-1)*page_size
    count = conn.execute(f"SELECT COUNT(*) as c FROM problem_sets WHERE {where}", args).fetchone()['c']
    sort_by = params.get('sort_by', 'updated_at')
    sort_order = params.get('sort_order', 'DESC').upper()
    if sort_order not in ('ASC','DESC'): sort_order = 'DESC'
    valid_sort = {'created_at':'created_at','updated_at':'updated_at','title':'title','id':'id'}
    sort_col = valid_sort.get(sort_by, 'updated_at')
    rows = conn.execute(f"SELECT id FROM problem_sets WHERE {where} ORDER BY {sort_col} {sort_order} LIMIT ? OFFSET ?", args + [page_size, offset]).fetchall()
    ids = [r['id'] for r in rows]
    result = []
    for pid in ids:
        r = conn.execute("SELECT * FROM problem_sets WHERE id=?", (pid,)).fetchone()
        if r:
            ps = dict(r)
            # Filter by permission if username is provided
            if username:
                perm = ps.get('permission', '') or (ps.get('is_public') and 'public' or 'private')
                allowed_users = [u.strip() for u in (ps.get('allowed_users', '') or '').split(',') if u.strip()]
                denied_users = [u.strip() for u in (ps.get('denied_users', '') or '').split(',') if u.strip()]
                if perm == 'private' and username != ps.get('owner'):
                    continue
                elif perm == 'password':
                    pass  # 密码保护的题单在搜索结果中可见
                elif perm == 'whitelist' and username not in allowed_users and username != ps.get('owner'):
                    continue
                elif perm == 'blacklist' and username in denied_users and username != ps.get('owner'):
                    continue
            result.append(ps)
    count = len(result)  # adjust count after filtering
    return {'total': count, 'page': page, 'total_pages': max(1,(count+page_size-1)//page_size), 'problem_sets': result}

def get_all_problem_sets_admin():
    conn = get_conn()
    rows = conn.execute("SELECT * FROM problem_sets ORDER BY updated_at DESC LIMIT 500").fetchall()
    return [dict(r) for r in rows]

def delete_problem_set_admin(psid):
    conn = get_conn()
    conn.execute("DELETE FROM problem_sets WHERE id=?", (psid,))
    conn.commit()

# ---- Like System ----
def toggle_like(target_type, target_id, username):
    conn = get_conn()
    existing = conn.execute("SELECT id FROM likes WHERE target_type=? AND target_id=? AND username=?", (target_type, target_id, username)).fetchone()
    if existing:
        conn.execute("DELETE FROM likes WHERE id=?", (existing['id'],))
        conn.commit()
        return {'liked': False}
    else:
        conn.execute("INSERT INTO likes (target_type, target_id, username) VALUES (?, ?, ?)", (target_type, target_id, username))
        conn.commit()
        return {'liked': True}

def get_like_count(target_type, target_id):
    conn = get_conn()
    row = conn.execute("SELECT COUNT(*) as c FROM likes WHERE target_type=? AND target_id=?", (target_type, target_id)).fetchone()
    return row['c'] if row else 0

def get_user_likes(target_type, target_ids, username):
    if not target_ids or not username:
        return {}
    conn = get_conn()
    placeholders = ','.join('?' for _ in target_ids)
    rows = conn.execute(f"SELECT target_id FROM likes WHERE target_type=? AND target_id IN ({placeholders}) AND username=?", (target_type,) + tuple(target_ids) + (username,)).fetchall()
    return {r['target_id'] for r in rows}

# ---- Problem CRUD (unchanged) ----
def upsert_problem(pid, data):
    conn = get_conn()
    existing = conn.execute("SELECT * FROM problems WHERE id=?", (pid,)).fetchone()
    fields = {
        'title': data.get('title'), 'difficulty': data.get('difficulty'), 'permission': data.get('permission'),
        'pass_rate': data.get('pass_rate'), 'ac_count': data.get('ac_count'), 'sub_count': data.get('sub_count'),
        'tags': json.dumps(data.get('tags', []), ensure_ascii=False),
        'authors': json.dumps(data.get('authors', []), ensure_ascii=False),
        'time_limit': data.get('time_limit'), 'memory_limit': data.get('memory_limit'),
        'content': data.get('content'), 'content_html': data.get('content_html', ''),
        'sample_input': data.get('sample_input'), 'sample_output': data.get('sample_output'),
        'sample_input_html': data.get('sample_input_html', ''), 'sample_output_html': data.get('sample_output_html', ''),
        'is_crawled': 1 if data.get('is_crawled', True) else 0,
        'is_hidden': 1 if data.get('is_hidden', False) else 0,
        'crawl_error': data.get('crawl_error'), 'last_crawled': datetime.now().isoformat()
    }
    if existing:
        set_clause = ", ".join(f"{k}=?" for k in fields.keys())
        conn.execute(f"UPDATE problems SET {set_clause} WHERE id=?", list(fields.values()) + [pid])
    else:
        fields['id'] = pid
        placeholders = ", ".join("?" for _ in fields)
        columns = ", ".join(fields.keys())
        conn.execute(f"INSERT INTO problems ({columns}) VALUES ({placeholders})", list(fields.values()))
    conn.commit()

def get_problem(pid):
    conn = get_conn()
    row = conn.execute("SELECT * FROM problems WHERE id=?", (pid,)).fetchone()
    if row:
        d = dict(row)
        d['tags'] = json.loads(d.get('tags', '[]'))
        d['authors'] = json.loads(d.get('authors', '[]'))
        return d
    return None

def search_problems(params):
    conn = get_conn()
    conditions = ["1=1"]; args = []
    keyword = params.get('keyword', '').strip()
    if keyword:
        conditions.append("(title LIKE ? OR id LIKE ? OR content LIKE ? OR authors LIKE ?)")
        args.extend([f"%{keyword}%", f"%{keyword}%", f"%{keyword}%", f"%{keyword}%"])
    problem_id = params.get('problemId', '').strip()
    if problem_id: conditions.append("id LIKE ?"); args.append(f"%{problem_id}%")
    author = params.get('author', '').strip()
    if author: conditions.append("authors LIKE ?"); args.append(f"%{author}%")
    tag = params.get('tag', '').strip()
    if tag:
        tag_list = [t.strip() for t in tag.split(',') if t.strip()]
        tag_conditions = []
        for t in tag_list:
            tag_conditions.append("tags LIKE ?"); args.append(f"%{t}%")
        if tag_conditions: conditions.append("(" + " OR ".join(tag_conditions) + ")")
    content = params.get('content', '').strip()
    if content: conditions.append("content LIKE ?"); args.append(f"%{content}%")
    min_rate = params.get('min_pass_rate')
    if min_rate is not None and min_rate != '': conditions.append("pass_rate IS NOT NULL AND pass_rate >= ?"); args.append(float(min_rate))
    max_rate = params.get('max_pass_rate')
    if max_rate is not None and max_rate != '': conditions.append("pass_rate IS NOT NULL AND pass_rate <= ?"); args.append(float(max_rate))
    # Include both crawled and list-only problems for search
    conditions.append("(is_crawled = 1 OR is_crawled = 0)")
    where = " AND ".join(conditions)
    count_row = conn.execute(f"SELECT COUNT(*) as cnt FROM problems WHERE {where}", args).fetchone()
    total = count_row['cnt']
    sort_by = params.get('sort_by', 'id')
    sort_order = params.get('sort_order', 'asc').upper()
    if sort_order not in ('ASC', 'DESC'): sort_order = 'ASC'
    valid_sort = {'id': 'CAST(id AS INTEGER)', 'title': 'title', 'difficulty': 'difficulty',
        'pass_rate': 'pass_rate', 'ac_count': 'ac_count', 'sub_count': 'sub_count'}
    sort_col = valid_sort.get(sort_by, 'CAST(id AS INTEGER)')
    page = int(params.get('page', 1))
    page_size = int(params.get('page_size', 50))
    offset = (page - 1) * page_size
    rows = conn.execute(f"SELECT id FROM problems WHERE {where} ORDER BY {sort_col} {sort_order} LIMIT ? OFFSET ?", args + [page_size, offset]).fetchall()
    ids = [row['id'] for row in rows]
    return {'total': total, 'page': page, 'page_size': page_size, 'total_pages': (total + page_size - 1) // page_size, 'problem_ids': ids}

def get_all_tags():
    """Get list of all unique tag names from problems table."""
    conn = get_conn()
    rows = conn.execute("SELECT tags FROM problems WHERE tags IS NOT NULL AND tags != '[]'").fetchall()
    tag_set = set()
    for row in rows:
        try:
            tags = json.loads(row['tags'])
            if isinstance(tags, list):
                for t in tags:
                    if isinstance(t, str) and t.strip():
                        tag_set.add(t.strip())
        except:
            pass
    return sorted(tag_set)


def get_contest(contest_id):
    """Get a single contest by ID."""
    conn = get_conn()
    row = conn.execute("SELECT * FROM contests WHERE id=?", (str(contest_id),)).fetchone()
    return dict(row) if row else None


def search_contests(params):
    """Search contests with filters and pagination."""
    conn = get_conn()
    conditions = ["1=1"]
    args = []
    keyword = params.get('keyword', '').strip()
    if keyword:
        conditions.append("(name LIKE ? OR id LIKE ? OR author LIKE ?)")
        args.extend([f"%{keyword}%", f"%{keyword}%", f"%{keyword}%"])
    ctype = params.get('type', '').strip()
    if ctype:
        conditions.append("type LIKE ?")
        args.append(f"%{ctype}%")
    where = " AND ".join(conditions)
    count_row = conn.execute(f"SELECT COUNT(*) as cnt FROM contests WHERE {where}", args).fetchone()
    total = count_row['cnt']
    sort_by = params.get('sort_by', 'id')
    sort_order = params.get('sort_order', 'asc').upper()
    if sort_order not in ('ASC', 'DESC'):
        sort_order = 'ASC'
    valid_sort = {'id': 'CAST(id AS INTEGER)', 'name': 'name', 'time': 'time', 'status': 'status'}
    sort_col = valid_sort.get(sort_by, 'CAST(id AS INTEGER)')
    page = int(params.get('page', 1))
    page_size = int(params.get('page_size', 50))
    offset = (page - 1) * page_size
    rows = conn.execute(
        f"SELECT id FROM contests WHERE {where} ORDER BY {sort_col} {sort_order} LIMIT ? OFFSET ?",
        args + [page_size, offset]
    ).fetchall()
    ids = [row['id'] for row in rows]
    return {'total': total, 'page': page, 'page_size': page_size,
            'total_pages': (total + page_size - 1) // page_size if total > 0 else 1,
            'contest_ids': ids}


def get_contest_with_problems(contest_id):
    """Get contest details along with its problem mappings."""
    contest = get_contest(contest_id)
    if not contest:
        return None
    mappings = get_contest_mappings(contest_id)
    contest['problems'] = []
    for m in mappings:
        contest['problems'].append({
            'problem_order': m.get('problem_order', ''),
            'problem_id': m.get('problem_id', ''),
            'problem_title': m.get('problem_title', '')
        })
    return contest


# ---- Other CRUD (unchanged) ----
def set_contest_mapping(contest_id, order, problem_id, problem_title=None):
    conn = get_conn()
    conn.execute("INSERT OR REPLACE INTO contest_problem_mapping (contest_id, problem_order, problem_id, problem_title) VALUES (?, ?, ?, ?)", (contest_id, order, problem_id, problem_title))
    conn.commit()

def get_contest_mappings(contest_id):
    conn = get_conn()
    rows = conn.execute("SELECT * FROM contest_problem_mapping WHERE contest_id=? ORDER BY problem_order", (contest_id,)).fetchall()
    return [dict(r) for r in rows]

def get_crawl_status():
    conn = get_conn()
    row = conn.execute("SELECT * FROM crawl_status ORDER BY id DESC LIMIT 1").fetchone()
    return dict(row) if row else {'status': 'idle', 'total': 0, 'crawled': 0, 'failed': 0}

def update_crawl_status(status, total=None, crawled=None, failed=None, message=None):
    conn = get_conn()
    now = datetime.now().isoformat()
    if status == 'running':
        conn.execute("INSERT INTO crawl_status (status, total, crawled, failed, message, started_at) VALUES (?, ?, ?, ?, ?, ?)", (status, total or 0, crawled or 0, failed or 0, message or '', now))
    else:
        last = conn.execute("SELECT id FROM crawl_status ORDER BY id DESC LIMIT 1").fetchone()
        if last:
            updates = ["status=?", "finished_at=?"]
            args = [status, now]
            if total is not None: updates.append("total=?"); args.append(total)
            if crawled is not None: updates.append("crawled=?"); args.append(crawled)
            if failed is not None: updates.append("failed=?"); args.append(failed)
            if message is not None: updates.append("message=?"); args.append(message)
            args.append(last['id'])
            conn.execute(f"UPDATE crawl_status SET {', '.join(updates)} WHERE id=?", args)
    conn.commit()

def create_admin_session(username):
    import secrets
    token = secrets.token_hex(32)
    conn = get_conn()
    conn.execute("INSERT INTO admin_sessions (token, username) VALUES (?, ?)", (token, username))
    conn.commit()
    return token

def validate_admin_session(token):
    if not token: return None
    conn = get_conn()
    row = conn.execute("SELECT * FROM admin_sessions WHERE token=?", (token,)).fetchone()
    return dict(row) if row else None

def delete_admin_session(token):
    conn = get_conn()
    conn.execute("DELETE FROM admin_sessions WHERE token=?", (token,))
    try:
        conn.commit()
    except Exception:
        pass

def set_impersonate(admin_token, target_username):
    conn = get_conn()
    conn.execute("UPDATE admin_sessions SET impersonate_username=? WHERE token=?", (target_username, admin_token))
    conn.commit()

def clear_impersonate(admin_token):
    conn = get_conn()
    conn.execute("UPDATE admin_sessions SET impersonate_username=NULL WHERE token=?", (admin_token,))
    conn.commit()

# ---- User Sessions ----
def create_user_session(yzoj_cookie, yzoj_uid, yzoj_username, is_admin=False, yzoj_user_color='', yzoj_permission_level=0):
    import secrets
    token = secrets.token_hex(32)
    conn = get_conn()
    conn.execute("""
        INSERT INTO user_sessions (token, yzoj_cookie, yzoj_uid, yzoj_username, is_admin, yzoj_user_color, yzoj_permission_level) 
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (token, yzoj_cookie, yzoj_uid, yzoj_username, 1 if is_admin else 0, yzoj_user_color, yzoj_permission_level))
    try:
        conn.commit()
    except Exception:
        pass
    return token

def validate_user_session(token):
    if not token: return None
    conn = get_conn()
    row = conn.execute("SELECT * FROM user_sessions WHERE token=?", (token,)).fetchone()
    if row:
        # Update last_active as best-effort; never let a commit failure invalidate a valid session.
        try:
            conn.execute("UPDATE user_sessions SET last_active=datetime('now') WHERE token=?", (token,))
            conn.commit()
        except Exception:
            pass
        return dict(row)
    return None

def delete_user_session(token):
    conn = get_conn()
    conn.execute("DELETE FROM user_sessions WHERE token=?", (token,))
    try:
        conn.commit()
    except Exception:
        pass

def get_stats():
    conn = get_conn()
    problem_count = conn.execute("SELECT COUNT(*) as c FROM problems WHERE is_crawled=1 AND is_hidden=0").fetchone()['c']
    user_count_db = conn.execute("SELECT COUNT(*) as c FROM users").fetchone()['c']
    user_count = user_count_db
    contest_count = conn.execute("SELECT COUNT(*) as c FROM contests").fetchone()['c']
    problemset_count = conn.execute("SELECT COUNT(*) as c FROM problem_sets").fetchone()['c']
    last_crawl = conn.execute("SELECT finished_at FROM crawl_status WHERE status='completed' ORDER BY id DESC LIMIT 1").fetchone()
    post_comment_count = conn.execute("SELECT COUNT(*) as c FROM post_comments").fetchone()['c']
    solution_comment_count = conn.execute("SELECT COUNT(*) as c FROM solution_comments").fetchone()['c']
    like_count_general = conn.execute("SELECT COUNT(*) as c FROM likes").fetchone()['c']
    like_count_post = conn.execute("SELECT COUNT(*) as c FROM post_likes").fetchone()['c']
    like_count_solution = conn.execute("SELECT COUNT(*) as c FROM solution_likes").fetchone()['c']
    like_count_solution_comment = conn.execute("SELECT COUNT(*) as c FROM solution_comment_likes").fetchone()['c']
    return {
        'problem_count': problem_count,
        'user_count': user_count,
        'contest_count': contest_count,
        'problemset_count': problemset_count,
        'comment_count': post_comment_count + solution_comment_count,
        'total_likes': like_count_general + like_count_post + like_count_solution + like_count_solution_comment,
        'last_crawl': last_crawl['finished_at'] if last_crawl else None
    }

def upsert_user(username, data):
    conn = get_conn()
    existing = conn.execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()
    fields = {'nickname': data.get('nickname'), 'solved_count': data.get('solved_count', 0), 'submission_count': data.get('submission_count', 0), 'last_crawled': datetime.now().isoformat()}
    if existing:
        set_clause = ", ".join(f"{k}=?" for k in fields.keys())
        conn.execute(f"UPDATE users SET {set_clause} WHERE username=?", list(fields.values()) + [username])
    else:
        fields['username'] = username
        placeholders = ", ".join("?" for _ in fields)
        columns = ", ".join(fields.keys())
        conn.execute(f"INSERT INTO users ({columns}) VALUES ({placeholders})", list(fields.values()))
    conn.commit()

def get_user(username):
    conn = get_conn()
    row = conn.execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()
    return dict(row) if row else None

def search_users(params):
    conn = get_conn()
    conditions = ["1=1"]; args = []
    keyword = params.get('keyword', '').strip()
    if keyword: conditions.append("(username LIKE ? OR nickname LIKE ?)"); args.extend([f'%{keyword}%', f'%{keyword}%'])
    where = " AND ".join(conditions)
    page = int(params.get('page', 1))
    page_size = int(params.get('page_size', 50))
    offset = (page-1)*page_size
    count = conn.execute(f"SELECT COUNT(*) as c FROM users WHERE {where}", args).fetchone()['c']
    sort_by = params.get('sort_by', 'username')
    sort_order = params.get('sort_order', 'asc').upper()
    if sort_order not in ('ASC','DESC'): sort_order = 'ASC'
    valid_sort = {'username':'CAST(username AS INTEGER)','nickname':'nickname'}
    sort_col = valid_sort.get(sort_by, 'CAST(username AS INTEGER)')
    rows = conn.execute(f"SELECT * FROM users WHERE {where} ORDER BY {sort_col} {sort_order} LIMIT ? OFFSET ?", args + [page_size, offset]).fetchall()
    return {'total':count,'page':page,'total_pages':max(1,(count+page_size-1)//page_size),'users':[dict(r) for r in rows]}

def upsert_user(username, data):
    conn = get_conn()
    existing = conn.execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()
    fields = {
        'uid': data.get('uid', ''),
        'nickname': data.get('nickname', ''),
        'solved_count': data.get('solved_count', 0),
        'submission_count': data.get('submission_count', 0),
        'last_crawled': data.get('last_crawled', datetime.now().isoformat())
    }
    if existing:
        set_clause = ", ".join(f"{k}=?" for k in fields.keys())
        conn.execute(f"UPDATE users SET {set_clause} WHERE username=?", list(fields.values()) + [username])
    else:
        fields['username'] = username
        placeholders = ", ".join("?" for _ in fields)
        columns = ", ".join(fields.keys())
        conn.execute(f"INSERT INTO users ({columns}) VALUES ({placeholders})", list(fields.values()))
    conn.commit()

def _check_media_files(username_or_uid):
    result = {'avatar_url': '', 'header_image_url': ''}
    media_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'static', 'media', str(username_or_uid))
    if os.path.exists(media_dir):
        avatar_path = os.path.join(media_dir, 'avatar.png')
        if os.path.exists(avatar_path):
            result['avatar_url'] = f'/media/{username_or_uid}/avatar.png'
        header_path = os.path.join(media_dir, 'header.png')
        if os.path.exists(header_path):
            result['header_image_url'] = f'/media/{username_or_uid}/header.png'
    return result

def get_user_profile(lookup_key, uid=None):
    conn = get_conn()
    row = conn.execute("SELECT * FROM user_profiles WHERE username=?", (lookup_key,)).fetchone()
    if row:
        result = dict(row)
    else:
        result = {'username': lookup_key, 'uid': uid or '', 'avatar_url': '', 'header_image_url': '', 'signature': '', 'bio': '', 'bio_html': '', 'updated_at': ''}
    
    # 强制按 uid（数字）确定头像/头图路径，忽略 DB 中可能存错的值
    # 例如 uid=2952 → 始终检查 static/media/2952/ 目录
    if uid:
        media_uid = _check_media_files(uid)
        result['avatar_url'] = media_uid['avatar_url']
        result['header_image_url'] = media_uid['header_image_url']
    
    # 无 uid 时回退到按 lookup_key 查找
    if not result.get('avatar_url') and not result.get('header_image_url'):
        media = _check_media_files(lookup_key)
        if media['avatar_url']:
            result['avatar_url'] = media['avatar_url']
        if media['header_image_url']:
            result['header_image_url'] = media['header_image_url']
    
    return result

def upsert_user_profile(username, data):
    conn = get_conn()
    uid = data.get('uid', '')
    existing = conn.execute("SELECT * FROM user_profiles WHERE username=?", (username,)).fetchone()
    if not existing and uid:
        existing = conn.execute("SELECT * FROM user_profiles WHERE uid=?", (uid,)).fetchone()
    if not existing and str(username).isdigit():
        existing = conn.execute("SELECT * FROM user_profiles WHERE uid=?", (username,)).fetchone()
    
    fields = {
        'avatar_url': data.get('avatar_url', ''),
        'header_image_url': data.get('header_image_url', ''),
        'signature': data.get('signature', ''),
        'bio': data.get('bio', ''),
        'bio_html': data.get('bio_html', ''),
        'updated_at': datetime.now().isoformat()
    }
    if uid:
        fields['uid'] = uid
    
    if existing:
        set_clause = ", ".join(f"{k}=?" for k in fields.keys())
        conn.execute(f"UPDATE user_profiles SET {set_clause} WHERE username=?", list(fields.values()) + [existing['username']])
    else:
        fields['username'] = username
        placeholders = ", ".join("?" for _ in fields)
        columns = ", ".join(fields.keys())
        conn.execute(f"INSERT INTO user_profiles ({columns}) VALUES ({placeholders})", list(fields.values()))
    conn.commit()

# ---- Discussion & Solution functions ----
def search_discussions(params):
    conn = get_conn()
    conditions = ["1=1"]; args = []
    problem_id = params.get('problem_id', '').strip()
    if problem_id: conditions.append("problem_id=?"); args.append(problem_id)
    category = params.get('category', '').strip()
    if category: conditions.append("category=?"); args.append(category)
    author = params.get('author', '').strip()
    if author: conditions.append("author=?"); args.append(author)
    keyword = params.get('keyword', '').strip()
    if keyword: conditions.append("(title LIKE ? OR content LIKE ?)"); args.extend([f'%{keyword}%', f'%{keyword}%'])
    where = " AND ".join(conditions)
    page = int(params.get('page', 1))
    page_size = int(params.get('page_size', 20))
    offset = (page-1)*page_size
    count = conn.execute(f"SELECT COUNT(*) as c FROM discussions WHERE {where}", args).fetchone()['c']
    sort_order = params.get('sort_order', 'DESC')
    if sort_order not in ('ASC','DESC'): sort_order = 'DESC'
    sort_by = params.get('sort_by', 'created_at')
    valid_sort = {'created_at':'created_at','last_reply_at':'last_reply_at','reply_count':'reply_count'}
    sort_col = valid_sort.get(sort_by, 'created_at')
    rows = conn.execute(f"SELECT id FROM discussions WHERE {where} ORDER BY {sort_col} {sort_order} LIMIT ? OFFSET ?", args + [page_size, offset]).fetchall()
    ids = [r['id'] for r in rows]
    return {'total':count, 'page':page, 'total_pages':max(1,(count+page_size-1)//page_size), 'discussion_ids':ids}

def get_discussion(did):
    conn = get_conn()
    row = conn.execute("SELECT * FROM discussions WHERE id=?", (did,)).fetchone()
    return dict(row) if row else None

def get_replies(discussion_id):
    conn = get_conn()
    rows = conn.execute("SELECT * FROM discussion_replies WHERE discussion_id=? ORDER BY created_at ASC", (discussion_id,)).fetchall()
    return [dict(r) for r in rows]

def upsert_solution(sid, data):
    conn = get_conn()
    existing = conn.execute("SELECT * FROM solutions WHERE id=?", (sid,)).fetchone()
    fields = {'problem_id': data.get('problem_id'), 'author': data.get('author'), 'title': data.get('title'), 'content': data.get('content'), 'content_html': data.get('content_html', ''), 'created_at': data.get('created_at'), 'updated_at': data.get('updated_at'), 'last_crawled': datetime.now().isoformat()}
    if existing:
        set_clause = ", ".join(f"{k}=?" for k in fields.keys())
        conn.execute(f"UPDATE solutions SET {set_clause} WHERE id=?", list(fields.values()) + [sid])
    else:
        fields['id'] = sid
        placeholders = ", ".join("?" for _ in fields)
        columns = ", ".join(fields.keys())
        conn.execute(f"INSERT INTO solutions ({columns}) VALUES ({placeholders})", list(fields.values()))
    conn.commit()

def get_solutions_for_problem(problem_id, username=None):
    conn = get_conn()
    rows = conn.execute("SELECT * FROM solutions WHERE problem_id=? ORDER BY created_at DESC", (problem_id,)).fetchall()
    result = []
    for r in rows:
        d = dict(r)
        like_count = conn.execute("SELECT COUNT(*) as c FROM solution_likes WHERE solution_id=?", (r['id'],)).fetchone()['c']
        d['like_count'] = like_count
        comment_count = conn.execute("SELECT COUNT(*) as c FROM solution_comments WHERE solution_id=?", (r['id'],)).fetchone()['c']
        d['comment_count'] = comment_count
        if username:
            liked = conn.execute("SELECT 1 FROM solution_likes WHERE solution_id=? AND username=?", (r['id'], username)).fetchone()
            d['liked'] = liked is not None
        result.append(d)
    return result

def upsert_discussion(did, data):
    conn = get_conn()
    existing = conn.execute("SELECT * FROM discussions WHERE id=?", (did,)).fetchone()
    fields = {'title': data.get('title'), 'author': data.get('author'), 'content': data.get('content'), 'content_html': data.get('content_html', ''), 'problem_id': data.get('problem_id'), 'contest_id': data.get('contest_id'), 'category': data.get('category', 'discussion'), 'created_at': data.get('created_at'), 'reply_count': data.get('reply_count', 0), 'last_reply_at': data.get('last_reply_at'), 'last_crawled': datetime.now().isoformat()}
    if existing:
        set_clause = ", ".join(f"{k}=?" for k in fields.keys())
        conn.execute(f"UPDATE discussions SET {set_clause} WHERE id=?", list(fields.values()) + [did])
    else:
        fields['id'] = did
        placeholders = ", ".join("?" for _ in fields)
        columns = ", ".join(fields.keys())
        conn.execute(f"INSERT INTO discussions ({columns}) VALUES ({placeholders})", list(fields.values()))
    conn.commit()

def upsert_reply(rid, data):
    conn = get_conn()
    existing = conn.execute("SELECT * FROM discussion_replies WHERE id=?", (rid,)).fetchone()
    fields = {'discussion_id': data.get('discussion_id'), 'author': data.get('author'), 'content': data.get('content'), 'content_html': data.get('content_html', ''), 'created_at': data.get('created_at'), 'last_crawled': datetime.now().isoformat()}
    if existing:
        set_clause = ", ".join(f"{k}=?" for k in fields.keys())
        conn.execute(f"UPDATE discussion_replies SET {set_clause} WHERE id=?", list(fields.values()) + [rid])
    else:
        fields['id'] = rid
        placeholders = ", ".join("?" for _ in fields)
        columns = ", ".join(fields.keys())
        conn.execute(f"INSERT INTO discussion_replies ({columns}) VALUES ({placeholders})", list(fields.values()))
    conn.commit()

def get_max_user_id():
    conn = get_conn()
    row = conn.execute("SELECT value FROM system_meta WHERE key='max_user_id'").fetchone()
    if row and row['value']:
        try:
            return int(row['value'])
        except:
            return 0
    return 0

def update_max_user_id(max_id):
    conn = get_conn()
    existing = conn.execute("SELECT value FROM system_meta WHERE key='max_user_id'").fetchone()
    if existing:
        conn.execute("UPDATE system_meta SET value=?, updated_at=datetime('now') WHERE key='max_user_id'", (str(max_id),))
    else:
        conn.execute("INSERT INTO system_meta (key, value) VALUES ('max_user_id', ?)", (str(max_id),))
    conn.commit()