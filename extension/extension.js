// extension.js - YZOJ VSCode 插件主入口
const vscode = require('vscode');
const logger = require('./logger');
const { login, checkStatus, gethtml } = require('./ojclient');
const { encrypt, decrypt } = require('./crypto');
const { 
  parseStatusDetail, parseStatusPage, parseProblemListPage, parseTagList,
  parseContestProblem, parsePracticeProblem, parseContestDetail,
  parseScheduledContests, parseActiveContests, parsePastContests,
  parseHomepage, parseUserPage,
  parseContestResult, parseSolutionsPage, parseSolutionDetail, parseProblemStatusPage,
  parseDiscussionList, parseDiscussionShow, parseDiscussionPosts, parseProblemDiscussionPage,
  parseRanklist, parseProblemPassStatus
} = require('./parse');
const { 
  getStatusDetailWebview, getProblemDetailWebview, 
  getContestDetailWebview, getContestWebviewContent,
  getStatusListWebview, getProblemListWebview,
  getHomepageWebview, getSolutionsWebview, getSolutionDetailWebview,
  getFullDiscussionListWebview, getDiscussionDetailWebview,
  getUserWebview, getMarkdownEditorWebview,
  getContestResultWebview, getContestStatusWebview,
  getProblemStatusWebview,
  getProblemSetListWebview, getProblemSetDetailWebview,
  getProblemSetEditorWebview, getRanklistWebview
} = require('./webview');
const { handleSendToCPH, handleCreateContestFolder, handleSubmitCode, getMap, saveMap, registerMapPath, periodicCheckAllMaps } = require('./handle');
const { mdToHtml, mdLatexToHtml, htmlToMdLatex } = require('./md-latex');
const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch');
const { AbortSignal } = require('node-abort-controller');
/* global setTimeout, setInterval, clearInterval */

function esc(t) { if (!t) return ''; return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;'); }

// 调试日志写入 logs/ 文件夹
var _debugLogFile = null;

async function checkAndUpdateMaps() {
  try {
    const map = await getMap();
    var entries = Object.entries(map).filter(function(e) { return e[1].isContest && e[1].contestId; });
    if (entries.length === 0) return;
    // 🔑 并行检查所有比赛状态
    var results = await Promise.all(entries.map(function(e) {
      return getContestInfo(e[1].contestId, globalCookie).then(function(info) {
        return { entry: e[1], ended: info && info.status === 'ended' };
      }).catch(function() { return { entry: e[1], ended: false }; });
    }));
    var changed = false;
    for (var ri = 0; ri < results.length; ri++) {
      if (results[ri].ended) {
        results[ri].entry.isContest = false;
        changed = true;
      }
    }
    if (changed) await saveMap(map);
  } catch(_e) { /* ignore */ }
}

let globalCookie = null, usernamep, yzoj_url = null;
const panelManager = require('./panelManager');
const userProblemStatus = new Map(); // problemId -> 'ac' | 'attempted' | null
const userCache = new Map(); // username/uid -> user data
let fetchUserProblemStatusPromise = null; // 用于跟踪 fetchUserProblemStatus 的执行状态

async function getUserCardData(username, uid) {
  const cacheKey = uid || username;
  if (userCache.has(cacheKey)) {
    const cached = userCache.get(cacheKey);
    if (Date.now() - cached.time < 300000) {
      return cached.data;
    } else {
    }
  }
  
  let cardResult = null;
  // Try ojserver first (has profile/avatar/signature/bio)
  try {
    const params = new URLSearchParams();
    if (uid) params.set('uid', uid);
    else if (username) params.set('username', username);
    const cardData = await proxyFetch('/api/user/profile/card?' + params.toString());
    if (cardData && cardData.username) {
      cardResult = cardData;
    } else {
    }
  } catch(e) {
  }
  
  // Always fetch YZOJ data as base
  try {
    let html;
    let yzoj_url = vscode.workspace.getConfiguration('yzoj').get('baseUrl');
    if (uid) {
      html = await gethtml(yzoj_url + '/OnlineJudge/user_show.php?id=' + uid, globalCookie);
    } else if (username) {
      html = await gethtml(yzoj_url + '/OnlineJudge/user_show.php?uname=' + encodeURIComponent(username), globalCookie);
    } else {
      return null;
    }
    const data = parseUserPage(html, yzoj_url);
    if (data && data.username) {
      // Merge ojserver extra fields into YZOJ base data
      if (cardResult) {
        // ⚠️ 关键修复：永远不用 cardResult.username 覆盖 YZOJ 原生 data.username
        // 即使 exists_in_ojs=true，ojserver 的 fallback 抓取也可能因 footer contributor 污染而串号
        // YZOJ 页面 parseUserPage 返回的 data.username 是权威用户名
        // 只有 YZOJ 本身没拿到 username 时，才兜底使用 cardResult.username
        if (!data.username && cardResult.username) {
          const cleanU = String(cardResult.username).trim();
          if (cleanU && !/^\d+$/.test(cleanU)) {
            data.username = cleanU;
          }
        }
        // 仅在 ojs uid 与 yzoj uid 匹配时，或 yzoj uid 缺失时，才信任 ojs 返回的 uid
        if (!data.uid || (cardResult.ojs_uid && String(cardResult.ojs_uid) === String(data.id || data.uid))) {
          if (cardResult.uid && !data.uid) data.uid = cardResult.uid;
        }
        // 头像/头图合并：ojserver 已完整头像 / YZOJ 爬的原生数据
        if (cardResult.avatar_url && !data.avatar_url) data.avatar_url = cardResult.avatar_url;
        if (cardResult.avatarUrl && !data.avatar_url) data.avatar_url = cardResult.avatarUrl;
        if (cardResult.header_image_url && !data.header_image_url) data.header_image_url = cardResult.header_image_url;
        if (cardResult.header_url && !data.header_image_url) data.header_image_url = cardResult.header_url;
        if (!data.header_url && data.header_image_url) data.header_url = data.header_image_url;
        if (cardResult.signature && !data.signature) data.signature = cardResult.signature;
        if (cardResult.realName && !data.realName) data.realName = cardResult.realName;
        if (cardResult.nickname && !data.nickname) data.nickname = cardResult.nickname;
        if (cardResult.school && !data.school) data.school = cardResult.school;
        if (cardResult.email && !data.email) data.email = cardResult.email;

        // ojs bio / signature / tags：不再要求 exists_in_ojs，只要有值就合并
        // （/api/user/tags 会对任何 username/uid 返回 tags，profile/card 对新用户仅因空表返回 exists_in_ojs=false 导致 tags 被吞）
        if (cardResult.bio && !data.bio) data.bio = cardResult.bio;
        if (cardResult.bio_html && !data.bio_html) data.bio_html = cardResult.bio_html;
        // 始终从 raw bio 生成 bio_html，避免 YZOJ 页面 &gt; 转义破坏 LaTeX（如 $1 > 2$ 变成 $1 &gt; 2$）
        if (data.bio) {
          try {
            data.bio_html = mdLatexToHtml(data.bio);
          } catch(e) {
          }
        } else {
        }
        if (cardResult.signature && !data.signature) data.signature = cardResult.signature;
        if (Array.isArray(cardResult.tags) && cardResult.tags.length && (!data.tags || !data.tags.length)) {
          data.tags = cardResult.tags;
        }
        if (!cardResult.header_url && data.header_url) { /* no-op */ }
        if (cardResult.header_url && !data.header_image_url) data.header_image_url = cardResult.header_url;
        if (cardResult.header_image_url && !data.header_url) data.header_url = cardResult.header_image_url;

        // 若 tags 仍为空：fallback 单独调 /api/user/tags
        if (!data.tags || !data.tags.length) {
          try {
            const tParams = new URLSearchParams();
            if (data.id) tParams.set('uid', String(data.id));
            else if (data.uid) tParams.set('uid', String(data.uid));
            else if (data.username) tParams.set('username', data.username);
            else if (username) tParams.set('username', username);
            else if (uid) tParams.set('uid', String(uid));
            if (tParams.toString()) {
              const tData = await proxyFetch('/api/user/tags?' + tParams.toString());
              if (tData && Array.isArray(tData.tags) && tData.tags.length) {
                data.tags = tData.tags;
              } else if (tData && tData.tags) {
              } else if (tData) {
              } else {
              }
            }
          } catch(_te) {
          }
        }

        // YZOJ 用户名字颜色：直接爬取 YZOJ 页面 username span 的 style color（不是 OJS 自定义，因此不需要 exists_in_ojs）
        // 优先级：parseUserPage 的 data.color > parseUserPage 的 data.user_color > cardResult.color > cardResult.user_color
        const rawColorCandidates = [
          data.color,
          data.user_color,
          cardResult.color,
          cardResult.user_color
        ];
        let finalColor = '';
        for (let i = 0; i < rawColorCandidates.length; i++) {
          const c = rawColorCandidates[i] ? String(rawColorCandidates[i]).trim() : '';
          if (c) {
            // Sanitize & normalize color: only accept #RRGGBB / #RGB / named colors / rgb(...)
            const clean = c.replace(/[,，。)\]}]+$/g, '').trim();
            if (/^(#[0-9a-fA-F]{3,8}|[a-zA-Z]{3,20}|rgb[a]?\([^)]+\))$/.test(clean)) {
              finalColor = /^[0-9a-fA-F]{6}$/.test(clean) ? '#' + clean : clean;
              if (/^[0-9a-fA-F]{3}$/.test(finalColor)) finalColor = '#' + finalColor;
              break;
            }
          }
        }
        if (finalColor) {
          data.color = finalColor;
          data.user_color = finalColor;
        }
        if (cardResult.permission_level && !data.permission_level) {
          data.permission_level = cardResult.permission_level;
        }
      }
      // 再次统一 color/user_color 字段，保证无论 profile/full 还是 webview 都能正确读取
      if (!data.color && data.user_color) data.color = data.user_color;
      if (!data.user_color && data.color) data.user_color = data.color;

      userCache.set(cacheKey, { data: data, time: Date.now() });
      if (data.id && data.id !== cacheKey) {
        userCache.set(data.id, { data: data, time: Date.now() });
      }
      return data;
    }
  } catch(e) {
  }
  return null;
}

// Tag batch-fetching system - batches all pending tag requests into one API call
var _tagCache = {};
var _tagQueue = [];
var _tagTimer = null;

function getUserTags(username, uid) {
  var key = uid || username;
  if (!key) return Promise.resolve([]);
  if (_tagCache[key]) return Promise.resolve(_tagCache[key]);
  return new Promise(function(resolve) {
    _tagQueue.push({ username: username, uid: uid, key: key, resolve: resolve });
    if (_tagTimer) clearTimeout(_tagTimer);
    _tagTimer = setTimeout(_flushTagQueue, 50);
  });
}

async function _flushTagQueue() {
  _tagTimer = null;
  var items = _tagQueue.slice();
  _tagQueue = [];
  var uidSet = {}, usernameSet = {};
  items.forEach(function(i){ if (i.uid) uidSet[i.uid] = true; if (i.username) usernameSet[i.username] = true; });
  var uids = Object.keys(uidSet);
  var usernames = Object.keys(usernameSet);
  if (uids.length === 0 && usernames.length === 0) {
    items.forEach(function(i){ _tagCache[i.key] = []; i.resolve([]); });
    return;
  }
  var tagsMap = {};
  try {
    var res = await proxyFetch('/api/user/tags/batch', {
      method: 'POST', body: JSON.stringify({ uids: uids, usernames: usernames })
    });
    if (res && res.tags) tagsMap = res.tags;
  } catch(_e) {}
  items.forEach(function(i){
    var tags = tagsMap[i.username] || tagsMap[i.uid] || [];
    _tagCache[i.key] = tags;
    i.resolve(tags);
  });
}

/**
 * 批量预加载用户 tags：在页面渲染前调用，返回 {key: [tags]} map
 * @param {string[]} uids - 用户 UID 数组
 * @param {string[]} usernames - 用户名数组
 * @returns {Promise<Object>} {key: [{tag, color}, ...]}
 */
async function preloadUserTags(uids, usernames) {
  uids = uids || [];
  usernames = usernames || [];
  if (!uids.length && !usernames.length) return {};
  var uniqueUids = [], uniqueUsernames = [];
  var seen = {};
  uids.forEach(function(id) {
    if (id && !seen[id]) { seen[id] = true; uniqueUids.push(id); }
  });
  usernames.forEach(function(name) {
    if (name && !seen[name]) { seen[name] = true; uniqueUsernames.push(name); }
  });
  if (!uniqueUids.length && !uniqueUsernames.length) return {};
  try {
    var res = await proxyFetch('/api/user/tags/batch', {
      method: 'POST', body: JSON.stringify({ uids: uniqueUids, usernames: uniqueUsernames })
    });
    return (res && res.tags) ? res.tags : {};
  } catch(e) {
    return {};
  }
}

async function _batchFetchUserData(userList) {
  const userDataMap = {};
  const fetchPromises = [];
  const seen = {};
  
  for (const user of userList) {
    const key = user.uid || user.username;
    if (seen[key]) continue;
    seen[key] = true;
    
    fetchPromises.push((async () => {
      const data = await getUserCardData(user.username, user.uid);
      if (data) {
        userDataMap[key] = data;
        if (data.id && !userDataMap[data.id]) {
          userDataMap[data.id] = data;
        }
      } else {
      }
    })());
  }
  
  await Promise.all(fetchPromises);
  return userDataMap;
}

// =====================================================
// 题目难度缓存
const problemDifficultyCache = new Map();

// 获取题目难度
async function getProblemDifficulty(problemId, baseUrl) {
  const pid = String(problemId).replace(/^P/i, '').replace(/[^\d]/g, '');
  if (problemDifficultyCache.has(pid)) {
    return problemDifficultyCache.get(pid);
  }
  try {
    const html = await gethtml(baseUrl + '/OnlineJudge/problem_show.php?id=' + pid, globalCookie);
    const data = parsePracticeProblem(html, baseUrl);
    const diff = parseFloat(data.difficulty) || 0;
    problemDifficultyCache.set(pid, diff);
    return diff;
  } catch(_e) {
    return 0;
  }
}

async function _fetchUserProblemStatus() {
  // 如果已经在执行中，返回现有的 Promise
  if (fetchUserProblemStatusPromise) {
    return fetchUserProblemStatusPromise;
  }
  
  fetchUserProblemStatusPromise = (async () => {
    try {
      const baseUrl = vscode.workspace.getConfiguration('yzoj').get('baseUrl');
      userProblemStatus.clear();
      // Fetch multiple pages using command=raw for reliable parsing + user filter
      // Increase to 100 pages to cover users with many submissions (e.g., 1071 submissions)
      var allRecords = [];
      var maxPages = 15; // 限制最多15页，避免加载过慢
      for (var page = 1; page <= maxPages; page++) {
        try {
          const html = await gethtml(baseUrl + '/OnlineJudge/status.php?page=' + page + '&command=raw&user=' + usernamep, globalCookie);
          const data = parseStatusPage(html, baseUrl);
          allRecords = allRecords.concat(data.records);
          if (!data.hasMore) break;
        } catch(e) { break; }
      }
      if (allRecords.length > 0) {
        for (const rec of allRecords) {
          // Double-check: only records belonging to current user
          if (rec.user && usernamep && rec.user.toLowerCase() !== usernamep.toLowerCase()) continue;
          var pid = String(rec.problemId || '').replace(/^P/i,'').replace(/[^\d]/g,'');
          if (!pid) continue;
          const score = parseInt(rec.score) || 0;
          if (!userProblemStatus.has(pid) || userProblemStatus.get(pid) !== 'ac') {
            userProblemStatus.set(pid, score >= 100 ? 'ac' : 'attempted');
          }
        }
      }
      } catch(e) {
      }
  })();

  // Promise 完成后重置，确保下次调用能重新获取最新数据
  fetchUserProblemStatusPromise.finally(function() { fetchUserProblemStatusPromise = null; });
  
  return fetchUserProblemStatusPromise;
}

function getProblemStatusMark(problemId) {
  const s = userProblemStatus.get(String(problemId).replace(/^P/i,''));
  if (s === 'ac') return 'ac';
  if (s === 'attempted') return 'attempted';
  return '';
}

async function fetchProblemPassStatus(problemId, baseUrl, cookie) {
  try {
    const pid = String(problemId).replace(/^P/i,'').trim();
    if (!pid) return '';
    const url = baseUrl + '/OnlineJudge/problem_show.php?id=' + encodeURIComponent(pid);
    const html = await gethtml(url, cookie);
    if (!html) return '';
    const mark = parseProblemPassStatus(html) || '';
    if (mark) userProblemStatus.set(pid, mark);
    return mark;
  } catch (e) {
    logger.log('fetchProblemPassStatus error pid=' + problemId + ': ' + e.message);
    return '';
  }
}

var _cachedProxyUrl = null;
function getProxyUrl() {
  if (!_cachedProxyUrl) {
    _cachedProxyUrl = vscode.workspace.getConfiguration('yzoj').get('proxyServer') || 'http://127.0.0.1:8199';
    // 配置变更时重置缓存
    vscode.workspace.onDidChangeConfiguration(function(e) {
      if (e.affectsConfiguration('yzoj.proxyServer')) _cachedProxyUrl = null;
    });
  }
  return _cachedProxyUrl;
}

async function proxyFetch(path, options = {}) {
  const fetch = require('node-fetch');
  try {
    const resp = await fetch(getProxyUrl() + path, { timeout: 10000, ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
    const body = await resp.json();
    return body;
  } catch (e) { logger.log('Proxy error:', path, e.message); return null; }
}

let searchState = { opts: { sort_by: 'id', sort_order: 'asc', page: 1, page_size: 50 }, selectedTags: [], result: null, allTags: [] };
let contestSearchState = { opts: { page: 1, page_size: 50 }, result: null, listName: '比赛列表', action: 'scheduled' };

async function _fetchContestListPage(baseUrl, cookie, action, page, keyword) {
  try {
    const pageNum = parseInt(page || 1);
    // YZOJ contest_list.php: ?action=now/past/scheduled
    let actParam;
    switch (action) {
      case 'now': actParam = 'now'; break;
      case 'past': actParam = 'past'; break;
      default: actParam = 'scheduled'; break; // scheduled
    }
    var url = baseUrl + '/OnlineJudge/contest_list.php?page=' + pageNum + '&action=' + actParam;
    if (keyword) url += '&keyword=' + encodeURIComponent(keyword);
    const html = await gethtml(url, cookie);
    if (!html) return { contests: [], currentPage: pageNum, totalPages: 1 };
    let parsed;
    switch (action) {
      case 'now': parsed = parseActiveContests(html, baseUrl); break;
      case 'past': parsed = parsePastContests(html, baseUrl); break;
      default: parsed = parseScheduledContests(html, baseUrl); break;
    }
    return {
      contests: (parsed && parsed.contests) ? parsed.contests : [],
      currentPage: parsed.currentPage ? parseInt(parsed.currentPage) : pageNum,
      totalPages: parsed.totalPages ? parseInt(parsed.totalPages) : 1
    };
  } catch (e) {
    return { contests: [], currentPage: parseInt(page || 1), totalPages: 1 };
  }
}

// 通过扩展的 Node.js 客户端获取 YZOJ 图片并返回 base64 给 webview
async function handleFetchImage(panel, msg) {
  try {
    const url = msg.url;
    if (!url || typeof url !== 'string') return;
    const headers = { 'User-Agent': 'Mozilla/5.0 (VS Code Extension)' };
    if (globalCookie) headers['Cookie'] = globalCookie;
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
    const buffer = await response.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    const contentType = response.headers.get('content-type') || 'image/png';
    panel.webview.postMessage({ command: 'imageFetched', url: url, data: 'data:' + contentType + ';base64,' + base64 });
  } catch (e) {
  }
}

// 下载 YZOJ 文件（.zip等）到工作文件夹
async function handleSaveFile(panel, url, buffer) {
  try {
    var fileName = url.split('/').pop().split('?')[0] || 'download';
    try { fileName = decodeURIComponent(fileName); } catch(_e) {}
    var workspaceFolders = vscode.workspace.workspaceFolders;
    var targetDir = workspaceFolders && workspaceFolders.length > 0 ? workspaceFolders[0].uri.fsPath : vscode.env.appRoot;
    var targetPath = path.join(targetDir, fileName);
    var counter = 1;
    while (fs.existsSync(targetPath)) {
      var ext = path.extname(fileName);
      var base = path.basename(fileName, ext);
      targetPath = path.join(targetDir, base + '_' + counter + ext);
      counter++;
    }
    await fs.promises.writeFile(targetPath, buffer);
    panel.webview.postMessage({ command: 'downloadComplete', url: url, localPath: targetPath });
    vscode.window.showInformationMessage('文件已保存: ' + targetPath);
  } catch (e) {
  }
}

async function handleDownloadFile(panel, msg) {
  try {
    var url = msg.url;
    if (!url || typeof url !== 'string') return;
    // 处理 vscode-webview:// 协议下的 /Upload/ 路径 → 重建为 HTTP URL
    if (url.startsWith('vscode-webview://') && /\/Upload\//i.test(url)) {
      var uploadPath = url.replace(/^vscode-webview:\/\/[^\/]+/, '');
      // 路径可能已包含 /OnlineJudge/（如原 href="/OnlineJudge/Upload/..."），避免双重前缀
      if (uploadPath.startsWith('/OnlineJudge/')) {
        url = yzoj_url.replace(/\/+$/, '') + uploadPath;
      } else {
        url = yzoj_url.replace(/\/+$/, '') + '/OnlineJudge' + uploadPath;
      }
    }
    // 非 HTTP(S) URL 交给系统打开（如 file:// 等）
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      vscode.env.openExternal(vscode.Uri.parse(url));
      return;
    }
    const headers = { 'User-Agent': 'Mozilla/5.0 (VS Code Extension)' };
    if (globalCookie) headers['Cookie'] = globalCookie;
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
    if (!response.ok) {
      // 404 时尝试加 /OnlineJudge/ 前缀（只有 URL 不含 OnlineJudge 时才尝试）
      if (response.status === 404 && !/\/OnlineJudge\//i.test(url)) {
        var fixedUrl = url.replace(/^(https?:\/\/[^\/]+)(\/Upload\/)/i, '$1/OnlineJudge$2');
        const retryResponse = await fetch(fixedUrl, { headers, signal: AbortSignal.timeout(30000) });
        if (retryResponse.ok) {
          const buf2 = Buffer.from(await retryResponse.arrayBuffer());
          await handleSaveFile(panel, fixedUrl, buf2);
          return;
        }
      }
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    await handleSaveFile(panel, url, buffer);
  } catch (e) {
    vscode.window.showErrorMessage('下载失败: ' + e.message);
  }
}

async function loadContestList(panel, action, page, baseUrl, cookie, opts) {
  panel.webview.html = '<div style="text-align:center;padding:50px;color:#666">少女祈祷中...</div>';
  try {
    contestSearchState.action = action || 'scheduled';
    if (!opts) opts = contestSearchState.opts;
    else contestSearchState.opts = opts;
    opts.page = page;
    opts.page_size = 50;
    opts.type = contestSearchState.action;

    const fetchResult = await _fetchContestListPage(baseUrl, globalCookie, contestSearchState.action, page, opts.keyword);
    let contests = fetchResult.contests || [];
    const totalPages = fetchResult.totalPages || 1;

    // Build contest_ids array compatible with contestSearchState.result shape
    const contestIds = contests.map(function(c) { return String(c.id); });
    contestSearchState.result = {
      contest_ids: contestIds,
      contests: contests,
      page: page,
      total_pages: totalPages,
      total: contests.length
    };

    switch (contestSearchState.action) {
      case 'scheduled': contestSearchState.listName = '计划中的比赛'; break;
      case 'now': contestSearchState.listName = '进行中的比赛'; break;
      case 'past': contestSearchState.listName = '过去的比赛'; break;
      default: contestSearchState.listName = '比赛列表';
    }
    const data = {
      contests: contests.map(c => ({
        id: c.id, name: c.name, type: c.type || contestSearchState.action, time: c.time, status: c.status,
        url: c.url || (baseUrl + '/OnlineJudge/contest_show.php?id=' + c.id),
        isHidden: c.isHidden === 1 || c.id === '-1' || (c.name && c.name.includes('隐藏')),
        permissionTag: c.permissionTag || c.permission || null
      })),
      currentPage: page, totalPages: Math.max(totalPages || 1, page),
      currentKeyword: opts.keyword || ''
    };
    panel.webview.html = getContestWebviewContent(contestSearchState.listName, data, contestSearchState.action, baseUrl);
  } catch (err) { panel.webview.html = '<div style="text-align:center;padding:50px;color:red">' + err.message + '</div>'; }
}

async function loadStatusList(panel, page, baseUrl, cookie, filters, isRefresh) {

  // 🔑 关键修复：合并初始 filters（特别是 test=比赛编号、contestId）与用户传入的 filters
  // 确保前端 getFilters() 未返回 test 时，仍能从 panel._statusBaseFilters 恢复比赛编号等关键参数
  const baseFilters = panel._statusBaseFilters || {};
  const effectiveFilters = Object.assign({}, baseFilters, filters || {});
  // 用户显式传空字符串的字段（如 pid 清空）要覆盖 baseFilters 中原值
  if (filters) {
    for (const k of Object.keys(filters)) {
      if (filters[k] === '' || filters[k] === null || filters[k] === undefined) {
        // 用户手动清空的字段：如果 baseFilters 里同名也是筛选字段，就不要硬塞回去
        // 但对于 test（比赛编号）这种关键的上下文参数：只有当用户真的从非比赛入口打开时才允许空，
        // 这里保留用户显式置空的选择
        continue;
      }
      effectiveFilters[k] = filters[k];
    }
  }
  filters = effectiveFilters;
  
  if (!isRefresh) {
    panel.webview.html = '<div style="text-align:center;padding:50px;color:#666">少女祈祷中...</div>';
  }
  try {
    if (!cookie) { panel.webview.html = '<div style="text-align:center;padding:50px;color:#cf222e">请先登录</div>'; return; }
    var params = '?page=' + page;
    if (filters) {

      // 🔑 比赛编号：支持 contestId / tid 两个别名，统一映射到 YZOJ status.php 的 test 参数
      let contestTestId = filters.test || filters.contestId || filters.tid || '';
      if (!contestTestId && panel._statusBaseFilters) {
        contestTestId = panel._statusBaseFilters.test || panel._statusBaseFilters.contestId || panel._statusBaseFilters.tid || '';
      }
      if (contestTestId) {
        params += '&test=' + encodeURIComponent(contestTestId);
      }
      
      // 🔑 关键修复：pid / uname 是 UI 可编辑字段，只要 filters 中存在它们的 key（哪怕是空字符串），
      // 就优先取 ui 字段的实际值（trim 后非空才加到 URL），严格忽略别名 problemId / username（避免 _preservedFilters 旧值复活）
      let resolvedPid = '';
      if (Object.prototype.hasOwnProperty.call(filters || {}, 'pid')) {
        resolvedPid = String(filters.pid || '').trim();
      } else if (Object.prototype.hasOwnProperty.call(filters || {}, 'problemId')) {
        resolvedPid = String(filters.problemId || '').trim();
      }
      if (resolvedPid) {
        params += '&pid=' + encodeURIComponent(resolvedPid);
      }
      
      let resolvedUname = '';
      if (Object.prototype.hasOwnProperty.call(filters || {}, 'uname')) {
        resolvedUname = String(filters.uname || '').trim();
      } else if (Object.prototype.hasOwnProperty.call(filters || {}, 'username')) {
        resolvedUname = String(filters.username || '').trim();
      }
      if (resolvedUname) {
        params += '&uname=' + encodeURIComponent(resolvedUname);
      }
      
      
      if (filters.status) {
        if (filters.status === 'ac') {
          params += '&status=1';
        } else {
          params += '&status=' + filters.status;
        }
      }
      
      // 分数筛选
      if (filters.scorel) params += '&scorel=' + encodeURIComponent(filters.scorel);
      if (filters.scorer) params += '&scorer=' + encodeURIComponent(filters.scorer);
      
    }
    
    const url = baseUrl + '/OnlineJudge/status.php' + params + '&command=raw';
    
    const html = await gethtml(url, cookie);
    
    const data = parseStatusPage(html, baseUrl);
    
    
    data.filters = filters || {};
    const records = data.records || [];
    
    // 收集所有用户的 UID 和用户名，批量预加载 tags
    // 注意：即使缓存命中也要从服务端请求，确保最新 tag 在页面展示前就嵌入 HTML
    var allUids = [], allUsernames = [];
    records.forEach(function(r) {
      if (r.userId) allUids.push(String(r.userId));
      if (r.user) allUsernames.push(String(r.user));
    });
    var tagsMap = await preloadUserTags(allUids, allUsernames);
    // 将 tags 注入到每条记录中
    // 注意：set_user_tag 只存了 username 列，未存 uid 列，所以 get_user_tags_batch 返回的 map 中
    // uid key 的值可能是 []（空数组，JS 中 [] 是 truthy），必须先按 username 查找，且检查 t.length
    records.forEach(function(r) {
      var t = tagsMap[r.user] || tagsMap[r.userId] || null;
      if (t && t.length) r.tags = t;
    });
    // 统计有多少条记录注入了 tag
    var taggedCount = 0;
    records.forEach(function(r){ if(r.tags && r.tags.length) taggedCount++; });
    // 更新缓存和面板 tag map，供下次刷新前预处理
    // 只缓存有实际 tag 的条目，避免空数组污染 cache 导致后续 getUserTags 短路返回 []
    Object.keys(tagsMap).forEach(function(k) {
      if (tagsMap[k] && tagsMap[k].length) _tagCache[k] = tagsMap[k];
    });
    panel._statusTagMap = {};
    records.forEach(function(r) {
      if (r.tags) {
        if (r.userId) panel._statusTagMap[r.userId] = r.tags;
        if (r.user) panel._statusTagMap[r.user] = r.tags;
      }
    });
    
    
    if (isRefresh && panel._statusKnownIds) {
      var knownIds = panel._statusKnownIds;
      var newRecords = [];
      var updatedRecords = [];
      for (var i = 0; i < records.length; i++) {
        var rec = records[i];
        var parsed = parseStatusForWebview(rec);
        if (!knownIds.has(rec.id)) {
          newRecords.push(parsed);
          knownIds.add(rec.id);
        } else {
          updatedRecords.push(parsed);
        }
      }
      if (newRecords.length > 0) {
        panel.webview.postMessage({command: 'addNewRecords', records: newRecords});
      }
      if (updatedRecords.length > 0) {
        panel.webview.postMessage({command: 'updateRecords', records: updatedRecords});
      }
    } else {
      panel._statusKnownIds = new Set(records.map(function(r){return r.id;}));
      panel.webview.html = getStatusListWebview(data, baseUrl);
    }
  } catch (err) { panel.webview.html = '<div style="text-align:center;padding:50px;color:red">' + err.message + '</div>'; }
}

function parseStatusForWebview(rec) {
  var status = rec.status || '';
  var rawStatus = rec.rawStatus || '';
  
  var isRunning = rec.isRunning || false;
  var isCE = false;
  var shortStatus = '';
  
  if (rec.id === '-1' || rec.id === '-') {
    return Object.assign({}, rec, {
      statusDisplay: '???',
      scoreDisplay: '???',
      shortStatus: 'hidden',
      isRunning: false,
      isCE: false
    });
  }
  
  if (rawStatus.includes('compile') || rawStatus.includes('compiling') || status.includes('正在编译')) {
    shortStatus = 'Compiling';
    isRunning = true;
  } else if (rawStatus.includes('run') || rawStatus.includes('judging') || rawStatus.includes('评测中') || 
             rawStatus.includes('running') || rawStatus.includes('评测 ') || status.includes('评测 ') || 
             status.includes('judging')) {
    shortStatus = 'Judging';
    isRunning = true;
  } else if (rawStatus.includes('wait') || rawStatus.includes('pending') || rawStatus.includes('等待') || 
             rawStatus.includes('queued')) {
    shortStatus = 'Queued';
    isRunning = true;
  } else if (status.includes('Compile Error') || status.includes('编译错误') || status.includes('CE') || 
             rawStatus.includes('compile error')) {
    shortStatus = 'CE';
    isCE = true;
  } else if (status.includes('Accepted') || status.includes('正确') || status.includes('AC')) {
    shortStatus = 'AC';
  } else if (status.includes('Wrong Answer') || status.includes('答案错误') || status.includes('WA')) {
    shortStatus = 'WA';
  } else if (status.includes('Time Limit') || status.includes('超时') || status.includes('TLE')) {
    shortStatus = 'TLE';
  } else if (status.includes('Memory Limit') || status.includes('超内存') || status.includes('MLE')) {
    shortStatus = 'MLE';
  } else if (status.includes('Segmentation') || status.includes('段错误') || status.includes('RE')) {
    shortStatus = 'RE';
  } else if (status.includes('Aborted') || status.includes('已放弃')) {
    shortStatus = 'ABORT';
  } else {
    shortStatus = status.slice(0, 10);
  }
  
  var statusDisplay = shortStatus;
  if (!isCE && !isRunning && rec.failTestId) {
    statusDisplay += ' on #' + rec.failTestId;
  }
  // 正在评测/等待中的记录不显示状态，只显示分数
  if (isRunning) {
    statusDisplay = '';
  }
  
  var scoreDisplay = '-';
  if (!isRunning && !isCE) {
    scoreDisplay = rec.score;
  } else if (isRunning) {
    scoreDisplay = rec.score || '-';
  }
  
  return Object.assign({}, rec, {
    statusDisplay: statusDisplay,
    scoreDisplay: scoreDisplay,
    shortStatus: shortStatus,
    isRunning: isRunning,
    isCE: isCE
  });
}

async function loadHomepage(panel, baseUrl, cookie) {
  panel.webview.html = '<div style="text-align:center;padding:50px;color:#666">少女祈祷中...</div>';
  try {
  const html = await gethtml(baseUrl + '/OnlineJudge/', cookie);
  var fixedHtml = html.replace(/src=["']([^"']*?)["']/gi, function(match, src) {
    if (src && !src.startsWith('http') && !src.startsWith('data:') && !src.startsWith('//')) {
      var cleanPath = src.replace(/^\.?\//, '').replace(/^\/+/, '');
      var fullUrl;
      if (cleanPath.startsWith('OnlineJudge/')) {
        fullUrl = baseUrl.replace(/\/+$/, '') + '/' + cleanPath;
      } else if (cleanPath.startsWith('Upload/')) {
        fullUrl = baseUrl.replace(/\/+$/, '') + '/OnlineJudge/' + cleanPath;
      } else {
        fullUrl = baseUrl.replace(/\/+$/, '') + '/OnlineJudge/' + cleanPath;
      }
      return 'src="' + fullUrl + '"';
    }
    return match;
  });
  // Pre-fetch YZOJ images and inline as base64 (bypass webview SSL limitation)
  var yzojHost = baseUrl.replace(/\/+$/, '');
  var imgFound = [];
  fixedHtml.replace(/<img[^>]+src=["']([^"']+)["']/gi, function(m, s) {
    if (s && !s.startsWith('data:') && s.indexOf(yzojHost) !== -1 && imgFound.indexOf(s) === -1) imgFound.push(s);
    return m;
  });
  if (imgFound.length > 0) {
    var replacements = await Promise.all(imgFound.map(async function(url) {
      try {
        var hdrs = { 'User-Agent': 'Mozilla/5.0 (VS Code Extension)' };
        if (globalCookie) hdrs['Cookie'] = globalCookie;
        var resp = await fetch(url, { headers: hdrs, signal: AbortSignal.timeout(8000) });
        if (resp.ok) {
          var buf = await resp.arrayBuffer();
          var b64 = Buffer.from(buf).toString('base64');
          var ct = resp.headers.get('content-type') || 'image/png';
          return { from: url, to: 'data:' + ct + ';base64,' + b64 };
        }
        return null;
      } catch(e) { return null; }
    }));
    replacements.forEach(function(r) { if (r) fixedHtml = fixedHtml.split(r.from).join(r.to); });
  }
  var data = parseHomepage(fixedHtml, baseUrl);
  // /api/stats removed (crawl proxy disabled)
  panel.webview.html = getHomepageWebview(data, baseUrl, usernamep);
    panel.webview.onDidReceiveMessage(msg => {
      if (msg.command == 'fetchImage') { handleFetchImage(panel, msg); return; }
      if (msg.command == 'downloadFile') { handleDownloadFile(panel, msg); return; }
      if (msg.command == 'openExternal') {
        var _extUrl = msg.url;
        if (_extUrl.startsWith('vscode-webview://')) {
          var _extPath = _extUrl.replace(/^vscode-webview:\/\/[^\/]+/, '');
          if (_extPath.startsWith('/OnlineJudge/')) {
            _extUrl = yzoj_url.replace(/\/+$/, '') + _extPath;
          } else {
            _extUrl = yzoj_url.replace(/\/+$/, '') + '/OnlineJudge' + _extPath;
          }
        }
        vscode.env.openExternal(vscode.Uri.parse(_extUrl));
      }
      if (msg.command == 'openContest') vscode.commands.executeCommand('yzoj.openContestDetail', { id: msg.id, title: msg.title, url: msg.url });
      if (msg.command == 'openProblem') vscode.commands.executeCommand('yzoj.openProblemDetail', { id: msg.id, url: msg.url });
      if (msg.command == 'openUserProfile') vscode.commands.executeCommand('yzoj.openUserProfile', msg.uid, msg.username);
      if (msg.command == 'openDiscussion') vscode.commands.executeCommand('yzoj.openDiscussionDetail', { id: msg.id, url: msg.url });
      if (msg.command == 'openDiscussionList') vscode.commands.executeCommand('yzoj.openDiscussionList', msg.problemId || msg.id);
      if (msg.command == 'openStatusList') vscode.commands.executeCommand('yzoj.showStatusList', msg.filters || {});
      if (msg.command == 'openProblemStatus') vscode.commands.executeCommand('yzoj.openProblemStatus', msg.problemId || msg.id);
      if (msg.command == 'openRanklist') vscode.commands.executeCommand('yzoj.showRanklist', msg.url);
      if (msg.command == 'requestUserCard') {
        (async () => {
          const data = await getUserCardData(msg.username, msg.uid);
          panel.webview.postMessage({ command: 'userCardData', username: msg.username, uid: msg.uid, data: data || {} });
        })();
      }
      if (msg.command == 'requestUserTags') {
        (async () => {
          const tags = await getUserTags(msg.username, msg.uid);
          panel.webview.postMessage({ command: 'userTagsData', username: msg.username, uid: msg.uid, tags: tags });
        })();
      }
    });
  } catch (err) { panel.webview.html = '<div style="text-align:center;padding:50px;color:red">' + err.message + '</div>'; }
}

async function renderProblemList(panel, baseUrl) {
  panel.webview.html = '<div style="text-align:center;padding:50px;color:#666">少女祈祷中...</div>';
  const sr = searchState.result;

  // Source of truth: searchState.result.problems (directly from parseProblemListPage)
  let srcProblems = [];
  if (sr && sr.problems && Array.isArray(sr.problems)) srcProblems = sr.problems.slice();
  // Fallback: if somehow sr only has problem_ids, try to crawl list again (shouldn't happen normally)
  if (srcProblems.length === 0 && sr && sr.problem_ids && sr.problem_ids.length > 0) {
    try {
      const sortBy = searchState.opts.sort_by || 'id';
      const sortOrder = searchState.opts.sort_order || 'asc';
      const orderByMap = { id: 'id', title: 'title', difficulty: 'level', pass_rate: 'ratio' };
      const orderBy = orderByMap[sortBy] || 'id';
      const page = sr.page || 1;
      const fall = await _fetchProblemListPage(baseUrl, globalCookie, null, page, orderBy, sortOrder);
      srcProblems = fall.problems || [];
    } catch(_e) {}
  }


  // Merge user-specific marks (from parsed problems)
  const markMap = {};
  srcProblems.forEach(function(p) {
    if (p && p.mark) markMap[String(p.id)] = p.mark;
  });

  const mapped = srcProblems.map(function(problem) {
    if (!problem) return null;
    const markFromMap = markMap[String(problem.id)];
    const finalMark = markFromMap || problem.mark || '';
    return {
      id: problem.id,
      name: problem.name || ('P' + problem.id),
      permission: problem.permission || null,
      passRate: problem.passRate,
      acCount: String(problem.acCount || ''),
      subCount: String(problem.subCount || ''),
      level: problem.level ? String(problem.level) : '',
      isHidden: !!problem.isHidden,
      url: problem.url || (baseUrl + '/OnlineJudge/problem_show.php?id=' + problem.id),
      mark: finalMark
    };
  }).filter(Boolean);

  const acCount = mapped.filter(p => p.mark === 'ac').length;
  const attemptedCount = mapped.filter(p => p.mark === 'attempted').length;

  const data = {
    problems: mapped, currentPage: sr ? (sr.page || 1) : 1, totalPages: sr ? (sr.total_pages || 1) : 1,
    allTags: searchState.allTags || [], selectedTags: searchState.selectedTags || [],
    currentKeyword: searchState.opts.keyword || '', currentSort: searchState.opts.sort_by || 'id',
    currentOrder: searchState.opts.sort_order || 'asc'
  };
  panel.webview.html = getProblemListWebview(data, baseUrl);
}

async function _fetchProblemListPage(baseUrl, cookie, tagId, page, orderBy, sortOrder, keyword) {
  try {
    let url = baseUrl + '/OnlineJudge/problem_list.php?page=' + parseInt(page || 1) + '&orderby=' + encodeURIComponent(orderBy || 'id') + '&order=' + encodeURIComponent(sortOrder || 'asc');
    if (tagId !== undefined && tagId !== null && String(tagId).trim() !== '') {
      url += '&tag=' + encodeURIComponent(String(tagId));
    }
    if (keyword) {
      url += '&name=' + encodeURIComponent(keyword);
    }
    const html = await gethtml(url, cookie);
    if (!html) return { problems: [], currentPage: parseInt(page || 1), totalPages: 1, total: 0 };
    const parsed = parseProblemListPage(html, baseUrl);
    return {
      problems: (parsed && parsed.problems) ? parsed.problems : [],
      currentPage: parsed.currentPage ? parseInt(parsed.currentPage) : parseInt(page || 1),
      totalPages: parsed.totalPages ? parseInt(parsed.totalPages) : 1
    };
  } catch (e) {
    return { problems: [], currentPage: parseInt(page || 1), totalPages: 1, total: 0 };
  }
}

async function _ensureTagsLoaded(baseUrl) {
  if (searchState.allTags && searchState.allTags.length > 0) return searchState.allTags;
  try {
    const tagHtml = await gethtml(baseUrl + '/OnlineJudge/tag_list.php', globalCookie);
    const tagParsed = parseTagList(tagHtml, baseUrl);
    // Convert parseTagList {id, name, count}[] into array of tag *names* (UI expects strings, matches prev behavior)
    // But keep id/name mapping in _tagNameToId so doSearch can translate selectedTags (names) -> ids
    searchState._tagMap = {}; // name -> id
    searchState.allTags = (tagParsed && tagParsed.tags ? tagParsed.tags : []).map(function(t) {
      searchState._tagMap[t.name] = t.id;
      if (t.count) searchState._tagMap[t.name + '__count'] = t.count;
      return t.name;
    });
    return searchState.allTags;
  } catch (e) {
    searchState.allTags = [];
    searchState._tagMap = {};
    return [];
  }
}

async function doSearch(opts, selectedTags, baseUrl) {
  if (!opts) opts = { sort_by: 'id', sort_order: 'asc' };
  opts.page = parseInt(opts.page || 1);
  if (!selectedTags) selectedTags = [];
  if (!Array.isArray(selectedTags)) selectedTags = [];
  searchState.opts = opts;
  searchState.selectedTags = selectedTags;

  // YZOJ native only supports: id / title / level / ratio
  // Extra client-only sorts (ac_count / submit_count) are mapped to 'id' for server fetch, then sorted client-side
  const serverOrderByMap = { id: 'id', title: 'title', difficulty: 'level', pass_rate: 'ratio', ac_count: 'id', submit_count: 'id' };
  const orderBy = serverOrderByMap[opts.sort_by] || 'id';
  const sortOrder = opts.sort_order === 'desc' ? 'desc' : 'asc';
  const keyword = (opts.keyword || '').trim().toLowerCase();
  if (!baseUrl) baseUrl = vscode.workspace.getConfiguration('yzoj').get('baseUrl');

  // Load tags (only fetches tag_list.php once)
  await _ensureTagsLoaded(baseUrl);

  // --- Build list of tag IDs we need to crawl ---
  let tagIdsToFetch = [];
  if (selectedTags.length > 0 && searchState._tagMap) {
    for (var si = 0; si < selectedTags.length; si++) {
      var tname = selectedTags[si];
      var tid = searchState._tagMap[tname];
      if (tid !== undefined && tid !== null && tid !== '' && tagIdsToFetch.indexOf(tid) === -1) {
        tagIdsToFetch.push(tid);
      }
    }
  }

  var mergedById = new Map(); // problemId -> problem object
  var totalPages = 1;

  if (tagIdsToFetch.length === 0) {
    // Single fetch: no tag filter
    var one = await _fetchProblemListPage(baseUrl, globalCookie, null, opts.page, orderBy, sortOrder, keyword);
    (one.problems || []).forEach(function(p) {
      if (!p || !p.id) return;
      if (!p.isHidden) mergedById.set(String(p.id), p);
    });
    totalPages = one.totalPages || 1;
  } else if (tagIdsToFetch.length === 1) {
    // Single tag fetch: preserves native pagination
    var oneT = await _fetchProblemListPage(baseUrl, globalCookie, tagIdsToFetch[0], opts.page, orderBy, sortOrder, keyword);
    (oneT.problems || []).forEach(function(p) {
      if (!p || !p.id) return;
      if (!p.isHidden) mergedById.set(String(p.id), p);
    });
    totalPages = oneT.totalPages || 1;
  } else {
    // Multi-tag union (OR logic): crawl each tag's first page, merge by problem id
    // (To keep it simple, always fetch page 1 for all tags when combining multiple tags)
    var perTagResults = [];
    for (var ti = 0; ti < tagIdsToFetch.length; ti++) {
      perTagResults.push(await _fetchProblemListPage(baseUrl, globalCookie, tagIdsToFetch[ti], 1, orderBy, sortOrder, keyword));
    }
    perTagResults.forEach(function(r) {
      (r.problems || []).forEach(function(p) {
        if (!p || !p.id) return;
        if (!p.isHidden) mergedById.set(String(p.id), p);
      });
      if ((r.totalPages || 1) > totalPages) totalPages = r.totalPages || 1;
    });
    // When merging multiple tags, we collapse to a single page of results (no cross-tag server-side pagination)
    totalPages = 1;
    opts.page = 1;
    searchState.opts.page = 1;
  }

  // ---- Keyword filter: 服务端已按 name 过滤，客户端不再重复过滤 ----
  var filteredList = [];
  mergedById.forEach(function(prob) {
    // 如果有关键字，服务端已通过 ?name=keyword 过滤，直接收录
    if (!keyword) { filteredList.push(prob); return; }
    var titleText = String(prob.name || '').toLowerCase();
    if (titleText.indexOf(keyword.toLowerCase()) !== -1) filteredList.push(prob);
  });

  // Always perform a client-side sort to guarantee correct ordering for ALL sort keys,
  // including keys not natively supported by YZOJ server (ac_count / submit_count).
  var sortField = opts.sort_by || 'id';
  var sortDir = (opts.sort_order === 'desc') ? -1 : 1;
  filteredList.sort(function(a, b) {
    var va, vb;
    switch (sortField) {
      case 'difficulty':
        va = parseFloat(a.level) || 0; vb = parseFloat(b.level) || 0;
        return (va - vb) * sortDir;
      case 'pass_rate':
        va = parseFloat(a.passRate) || 0; vb = parseFloat(b.passRate) || 0;
        return (va - vb) * sortDir;
      case 'ac_count':
        va = parseInt(a.acCount) || 0; vb = parseInt(b.acCount) || 0;
        return (va - vb) * sortDir;
      case 'submit_count':
        va = parseInt(a.subCount) || 0; vb = parseInt(b.subCount) || 0;
        return (va - vb) * sortDir;
      case 'id':
      default:
        va = parseInt(a.id) || 0; vb = parseInt(b.id) || 0;
        return (va - vb) * sortDir;
    }
  });

  searchState.result = {
    problem_ids: filteredList.map(function(p) { return String(p.id); }),
    problems: filteredList,
    page: opts.page,
    total_pages: totalPages,
    total: filteredList.length
  };
  return searchState.result;
}

async function loadSolutions(panel, problemId, baseUrl) {
  try {
    panel.webview.html = '<div style="text-align:center;padding:50px;color:#666">加载中...</div>';
    
    const allSolutions = [];
    
    const firstHtml = await gethtml(baseUrl + '/OnlineJudge/problem_solve.php?id=' + problemId + '&ignore=yes&page=0', globalCookie);
    const firstData = parseSolutionsPage(firstHtml, baseUrl, 0);
    allSolutions.push(...firstData.solutions);
    
    const totalPages = firstData.totalPages;
    if (totalPages > 1) {
      // 🔑 并行获取剩余页面
      var pagePromises = [];
      for (let page = 1; page < totalPages; page++) {
        pagePromises.push(
          gethtml(baseUrl + '/OnlineJudge/problem_solve.php?id=' + problemId + '&ignore=yes&page=' + page, globalCookie)
            .then(function(html) { return parseSolutionsPage(html, baseUrl, page); })
            .catch(function() { return { solutions: [] }; })
        );
      }
      var pageResults = await Promise.all(pagePromises);
      for (var pi = 0; pi < pageResults.length; pi++) {
        allSolutions.push(...(pageResults[pi].solutions || []));
      }
    }
    
    // 预加载所有用户的 tags
    var allUids = [];
    (allSolutions||[]).forEach(function(s) { if (s.authorId) allUids.push(String(s.authorId)); });
    var tagsMap = await preloadUserTags(allUids);
    (allSolutions||[]).forEach(function(s) {
      if (s.authorId && tagsMap[s.authorId]) {
        s.tags = tagsMap[s.authorId];
      }
    });
    
    const data = {
      solutions: allSolutions,
      problemId: problemId,
      problemTitle: firstData.problemTitle,
      proxyUrl: getProxyUrl(),
      username: usernamep || '',
      currentPage: 1,
      totalPages: 1
    };
    
    panel.webview.html = getSolutionsWebview(data, baseUrl);
    if (!panel._solutionMsgHandler) {
      panel._solutionMsgHandler = panel.webview.onDidReceiveMessage(msg => {
        if (msg.command == 'fetchImage') { handleFetchImage(panel, msg); return; }
        if (msg.command == 'downloadFile') { handleDownloadFile(panel, msg); return; }
        if (msg.command == 'openSolution') {
          vscode.commands.executeCommand('yzoj.openSolutionDetail', msg.id);
        }
        if (msg.command == 'newSolution') {
          showEditor(panel, {
            editorId: 'solution-new-' + problemId,
            title: '撰写题解 - P' + problemId,
            submitLabel: '发布题解',
            submitCommand: 'submitEditorContent',
            placeholder: '使用 Markdown 撰写题解，支持 LaTeX 公式...',
            extraData: { type: 'solution', problemId: problemId, title: 'P' + problemId + ' 题解' }
          }, context);
        }
        if (msg.command == 'editSolution') {
          showEditor(panel, {
            editorId: 'solution-edit-' + msg.id,
            title: '编辑题解',
            submitLabel: '更新题解',
            submitCommand: 'submitEditorContent',
            placeholder: '',
            // 优先使用 contentHtml（含隐藏标记），检测到标记则转回 markdown
            initialContent: htmlToMdLatex(msg.contentHtml || msg.content || ''),
            extraData: { type: 'solution', problemId: problemId, title: '题解', id: msg.id, edit: true }
          }, context);
        }
        if (msg.command == 'backToProblem') {
          vscode.commands.executeCommand('yzoj.openProblemDetail', { id: msg.problemId, url: baseUrl + '/OnlineJudge/problem_show.php?id=' + msg.problemId });
        }
        if (msg.command == 'openUserProfile') vscode.commands.executeCommand('yzoj.openUserProfile', msg.uid, msg.username);
        if (msg.command == 'requestUserCard') {
          (async () => {
            const uData = await getUserCardData(msg.username, msg.uid);
            panel.webview.postMessage({ command: 'userCardData', username: msg.username, uid: msg.uid, data: uData || {} });
          })();
        }
        if (msg.command == 'requestUserTags') {
          (async () => {
            const tags = await getUserTags(msg.username, msg.uid);
            panel.webview.postMessage({ command: 'userTagsData', username: msg.username, uid: msg.uid, tags: tags });
          })();
        }
      });
    }
  } catch (e) {
    panel.webview.html = '<div style="text-align:center;padding:30px;color:red">加载失败: ' + esc(e.message) + '</div>';
  }
}

async function loadDiscussions(panel, problemId, baseUrl) {
  panel.webview.html = '<div style="text-align:center;padding:50px;color:#666">加载中...</div>';
  try {
    const allDiscussions = [];
    
    // 先获取第一页，获取总页数
    const firstHtml = await gethtml(`${baseUrl}/OnlineJudge/problem_discuss.php?pid=${problemId}&page=0`, globalCookie);
    const firstData = parseProblemDiscussionPage(firstHtml, baseUrl, 0);
    allDiscussions.push(...firstData.discussions);
    
    // 获取剩余页面的讨论
    const totalPages = firstData.totalPages;
    if (totalPages > 1) {
      for (let page = 1; page < totalPages; page++) {
        const html = await gethtml(`${baseUrl}/OnlineJudge/problem_discuss.php?pid=${problemId}&page=${page}`, globalCookie);
        const data = parseProblemDiscussionPage(html, baseUrl, page);
        allDiscussions.push(...data.discussions);
      }
    }
    
    const discussion = {
      id: problemId,
      title: firstData.title || ('题目 P' + problemId + ' 讨论'),
      problemId: problemId,
      source: 'problem',
      post_type: 'problem_discuss',
      replies: allDiscussions.map(d => ({
        author: d.author,
        authorId: d.authorId,
        content: d.content,
        content_html: d.contentHtml,
        created_at: d.time,
        floor: d.floor,
        like_count: 0,
        comment_count: 0,
        original_id: '',
        id: d.id
      })),
      author: '',
      content: '',
      content_html: '',
      currentPage: 1,
      totalPages: 1
    };
    // 预加载所有用户的 tags
    var allUids = [];
    (discussion.replies||[]).forEach(function(r) { if (r.authorId) allUids.push(String(r.authorId)); });
    var tagsMap = await preloadUserTags(allUids);
    (discussion.replies||[]).forEach(function(r) {
      if (r.authorId && tagsMap[r.authorId]) {
        r.tags = tagsMap[r.authorId];
      }
    });
    panel.webview.html = getDiscussionDetailWebview(discussion, baseUrl, usernamep);
    if (!panel._discussionMsgHandler) {
      panel._discussionMsgHandler = panel.webview.onDidReceiveMessage(msg => {
        if (msg.command == 'fetchImage') { handleFetchImage(panel, msg); return; }
        if (msg.command == 'downloadFile') { handleDownloadFile(panel, msg); return; }
        if (msg.command == 'openDiscussion') {
          vscode.commands.executeCommand('yzoj.openDiscussionDetail', msg.id);
        }
        if (msg.command == 'openContest') {
          vscode.commands.executeCommand('yzoj.openContestDetail', { id: msg.id, url: msg.url, title: msg.title });
        }
        if (msg.command == 'openProblem') {
          vscode.commands.executeCommand('yzoj.openProblemDetail', { id: msg.id, url: msg.url });
        }
        if (msg.command == 'openExternal') {
          var _extSlnUrl = msg.url;
          if (_extSlnUrl.startsWith('vscode-webview://')) {
            var _extSlnPath = _extSlnUrl.replace(/^vscode-webview:\/\/[^\/]+/, '');
            if (_extSlnPath.startsWith('/OnlineJudge/')) {
              _extSlnUrl = yzoj_url.replace(/\/+$/, '') + _extSlnPath;
            } else {
              _extSlnUrl = yzoj_url.replace(/\/+$/, '') + '/OnlineJudge' + _extSlnPath;
            }
          }
          vscode.env.openExternal(vscode.Uri.parse(_extSlnUrl));
        }
        if (msg.command == 'backToProblem') {
          vscode.commands.executeCommand('yzoj.openProblemDetail', { id: problemId, url: baseUrl + '/OnlineJudge/problem_show.php?id=' + problemId });
        }
        if (msg.command == 'newDiscussion') {
          showEditor(panel, {
            editorId: 'discussion-new-' + problemId,
            title: '发起讨论 - P' + problemId,
            submitLabel: '发布讨论',
            submitCommand: 'submitEditorContent',
            placeholder: '使用 Markdown 撰写讨论，支持 LaTeX 公式...',
            extraData: { type: 'problem_discussion', problemId: problemId, title: 'P' + problemId + ' 讨论' }
          }, context);
        }
        if (msg.command == 'editDiscussion') {
          showEditor(panel, {
            editorId: 'discussion-edit-' + (msg.id || Date.now()),
            title: '编辑讨论',
            submitLabel: '更新讨论',
            submitCommand: 'submitEditorContent',
            placeholder: '',
            // 讨论没有隐藏标记，直接使用内容
            initialContent: msg.content || '',
            extraData: { type: 'problem_discussion', problemId: problemId, title: '讨论', id: msg.id, edit: true }
          }, context);
        }
        if (msg.command == 'replyDiscussion') {
          showEditor(panel, {
            title: '回复讨论',
            editorId: 'discussion-reply-' + msg.id,
            submitCommand: 'submitEditorContent',
            submitLabel: '发布回复',
            extraData: { type: 'discussion_reply', discussionId: msg.id, fetchExisting: true }
          }, context);
        }
        if (msg.command == 'confirmDeletePost') {
          vscode.window.showWarningMessage('确定删除这个帖子吗？', '确定', '取消').then(function(ans) {
            if (ans === '确定') vscode.commands.executeCommand('yzoj.deleteDiscussionPost', { delUrl: msg.delUrl });
          });
        }
        if (msg.command == 'openUserProfile') vscode.commands.executeCommand('yzoj.openUserProfile', msg.uid, msg.username);
        if (msg.command == 'requestUserCard') {
          (async () => {
            const uData = await getUserCardData(msg.username, msg.uid);
            panel.webview.postMessage({ command: 'userCardData', username: msg.username, uid: msg.uid, data: uData || {} });
          })();
        }
        if (msg.command == 'requestUserTags') {
          (async () => {
            const tags = await getUserTags(msg.username, msg.uid);
            panel.webview.postMessage({ command: 'userTagsData', username: msg.username, uid: msg.uid, tags: tags });
          })();
        }
      });
    }
  } catch (e) {
    panel.webview.html = '<div style="text-align:center;padding:30px;color:red">加载失败: ' + esc(e.message) + '</div>';
  }
}

async function loadDiscussionList(panel, page, baseUrl, opts) {
  panel.webview.html = '<div style="text-align:center;padding:50px;color:#666">少女祈祷中...</div>';
  try {
    const url = `${baseUrl}/OnlineJudge/discuss_list.php?page=${page}`;
    const html = await gethtml(url, globalCookie);
    const data = parseDiscussionList(html, baseUrl, page);
    data.discussions = (data.discussions || []).filter(d => !d.url || !d.url.includes('problem_discuss.php'));
    
    // 预加载所有用户的 tags
    var allUids = [];
    (data.discussions||[]).forEach(function(d) { if (d.authorId) allUids.push(String(d.authorId)); });
    var tagsMap = await preloadUserTags(allUids);
    (data.discussions||[]).forEach(function(d) {
      if (d.authorId && tagsMap[d.authorId]) {
        d.tags = tagsMap[d.authorId];
      }
    });
    
    panel.webview.html = getFullDiscussionListWebview(data, baseUrl);
    // 处理分页消息
    const oldHandler = panel._discussionListMsgHandler;
    if (oldHandler) oldHandler.dispose();
    panel._discussionListMsgHandler = panel.webview.onDidReceiveMessage(msg => {
      if (msg.command == 'fetchImage') { handleFetchImage(panel, msg); return; }
      if (msg.command == 'downloadFile') { handleDownloadFile(panel, msg); return; }
      if (msg.command === 'changeDiscussionPage') {
        const newPage = msg.page !== undefined ? msg.page : (msg.p || 0);
        loadDiscussionList(panel, newPage, baseUrl, opts);
      }
      if (msg.command === 'openDiscussion') {
        vscode.commands.executeCommand('yzoj.openDiscussionDetail', { id: msg.id, url: baseUrl + '/OnlineJudge/discuss_discuss.php?did=' + msg.id });
      }
      if (msg.command == 'openContest') {
        vscode.commands.executeCommand('yzoj.openContestDetail', { id: msg.id, url: msg.url, title: msg.title });
      }
      if (msg.command == 'openProblem') {
        vscode.commands.executeCommand('yzoj.openProblemDetail', { id: msg.id, url: msg.url });
      }
      if (msg.command == 'openExternal') {
        var _extDLUrl = msg.url;
        if (_extDLUrl.startsWith('vscode-webview://')) {
          var _extDLPath = _extDLUrl.replace(/^vscode-webview:\/\/[^\/]+/, '');
          if (_extDLPath.startsWith('/OnlineJudge/')) {
            _extDLUrl = yzoj_url.replace(/\/+$/, '') + _extDLPath;
          } else {
            _extDLUrl = yzoj_url.replace(/\/+$/, '') + '/OnlineJudge' + _extDLPath;
          }
        }
        vscode.env.openExternal(vscode.Uri.parse(_extDLUrl));
      }
      if (msg.command == 'openUserProfile') vscode.commands.executeCommand('yzoj.openUserProfile', msg.uid, msg.username);
      if (msg.command == 'requestUserCard') {
        (async () => {
          const uData = await getUserCardData(msg.username, msg.uid);
          panel.webview.postMessage({ command: 'userCardData', username: msg.username, uid: msg.uid, data: uData || {} });
        })();
      }
      if (msg.command == 'requestUserTags') {
        (async () => {
          const tags = await getUserTags(msg.username, msg.uid);
          panel.webview.postMessage({ command: 'userTagsData', username: msg.username, uid: msg.uid, tags: tags });
        })();
      }
    });
  } catch (err) { panel.webview.html = '<div style="text-align:center;padding:50px;color:red">加载失败: ' + esc(err.message) + '</div>'; }
}

async function loadDiscussionDetail(panel, discussionId, baseUrl, page = 0) {
  panel.webview.html = '<div style="text-align:center;padding:50px;color:#666">少女祈祷中...</div>';
  try {
    const showUrl = `${baseUrl}/OnlineJudge/discuss_show.php?id=${discussionId}`;
    const [showHtml, firstPostsHtml] = await Promise.all([
      gethtml(showUrl, globalCookie),
      gethtml(`${baseUrl}/OnlineJudge/discuss_discuss.php?did=${discussionId}&page=${page}`, globalCookie)
    ]);
    const showData = parseDiscussionShow(showHtml, baseUrl);
    const firstPostsData = parseDiscussionPosts(firstPostsHtml, baseUrl, page);

    // 爬取所有页（YZOJ 页码 0-based）
    let allPosts = [...(firstPostsData.posts || [])];
    const totalPages = firstPostsData.totalPages || 1;
    if (totalPages > 1) {
      for (let p = 0; p < totalPages; p++) {
        if (p === page) continue; // 已获取
        const pHtml = await gethtml(`${baseUrl}/OnlineJudge/discuss_discuss.php?did=${discussionId}&page=${p}`, globalCookie);
        const pData = parseDiscussionPosts(pHtml, baseUrl, p);
        if (pData && pData.posts) allPosts.push(...pData.posts);
      }
    }
    
    const discussion = {
      id: discussionId,
      title: showData.title || firstPostsData.title || ('DC' + discussionId),
      content: showData.content || '',
      contentHtml: showData.contentHtml || '',
      posts: allPosts,
      currentPage: firstPostsData.currentPage || page,
      totalPages: totalPages,
      source: 'discussionList'  // 🔑 标记来源：从全站讨论区进入 → 返回按钮显示「返回讨论区」
    };
    // 预加载所有用户的 tags
    var allUids = [];
    if (showData.authorId) allUids.push(String(showData.authorId));
    (discussion.posts||[]).forEach(function(p) { if (p.authorId) allUids.push(String(p.authorId)); });
    var tagsMap = await preloadUserTags(allUids);
    if (showData.authorId && tagsMap[showData.authorId]) {
      discussion.tags = tagsMap[showData.authorId];
    }
    (discussion.posts||[]).forEach(function(p) {
      if (p.authorId && tagsMap[p.authorId]) {
        p.tags = tagsMap[p.authorId];
      }
    });
    panel.webview.html = getDiscussionDetailWebview(discussion, baseUrl, usernamep);
    const oldHandler = panel._discussionDetailMsgHandler;
    if (oldHandler) oldHandler.dispose();
    panel._discussionDetailMsgHandler = panel.webview.onDidReceiveMessage(async msg => {
      logger.log('[FZYZOJ-discussionDetail] msg.command=' + msg.command + ' id=' + (msg.id || msg.did || '') + ' url=' + (msg.url || '').substring(0, 80));
      if (msg.command == 'fetchImage') { handleFetchImage(panel, msg); return; }
      if (msg.command == 'downloadFile') { handleDownloadFile(panel, msg); return; }
      if (msg.command === 'changeDiscussionPage') {
        loadDiscussionDetail(panel, discussionId, baseUrl, msg.page == null ? 0 : msg.page);
      }
      if (msg.command == 'backToDiscussionList') {
        vscode.commands.executeCommand('yzoj.showDiscussionList');
      }
      if (msg.command == 'backToProblem') {
        vscode.commands.executeCommand('yzoj.openProblemDetail', { id: msg.problemId, url: baseUrl + '/OnlineJudge/problem_show.php?id=' + msg.problemId });
      }
      if (msg.command == 'openExternal') {
        var _extUrl2 = msg.url;
        if (_extUrl2.startsWith('vscode-webview://')) {
          var _extPath2 = _extUrl2.replace(/^vscode-webview:\/\/[^\/]+/, '');
          if (_extPath2.startsWith('/OnlineJudge/')) {
            _extUrl2 = yzoj_url.replace(/\/+$/, '') + _extPath2;
          } else {
            _extUrl2 = yzoj_url.replace(/\/+$/, '') + '/OnlineJudge' + _extPath2;
          }
        }
        vscode.env.openExternal(vscode.Uri.parse(_extUrl2));
      }
      if (msg.command == 'openProblem') vscode.commands.executeCommand('yzoj.openProblemDetail', { id: msg.id, url: msg.url });
      if (msg.command == 'openContest') vscode.commands.executeCommand('yzoj.openContestDetail', { id: msg.id, url: msg.url, title: msg.title });
      if (msg.command == 'openContestResult') vscode.commands.executeCommand('yzoj.openContestResult', { contestId: msg.contestId || msg.id, url: msg.url });
      if (msg.command == 'openDiscussion') vscode.commands.executeCommand('yzoj.openDiscussionDetail', { id: msg.id, url: msg.url });
      if (msg.command == 'openDiscussionList') vscode.commands.executeCommand('yzoj.openDiscussionList', msg.problemId || msg.id);
      if (msg.command == 'replyDiscussion') {
        showEditor(panel, {
          title: '回复讨论',
          editorId: 'discussion-reply-' + msg.id,
          submitCommand: 'submitEditorContent',
          submitLabel: '发布回复',
          extraData: { type: 'discussion_reply', discussionId: msg.id, fetchExisting: true }
        }, context);
      }
      if (msg.command == 'confirmDeletePost') {
        vscode.window.showWarningMessage('确定删除这个帖子吗？', '确定', '取消').then(function(ans) {
          if (ans === '确定') vscode.commands.executeCommand('yzoj.deleteDiscussionPost', { delUrl: msg.delUrl });
        });
      }
      if (msg.command == 'openStatusDetail') vscode.commands.executeCommand('yzoj.openStatusDetail', msg.id);
      if (msg.command == 'openStatusList') vscode.commands.executeCommand('yzoj.showStatusList', msg.filters || {});
      if (msg.command == 'openProblemStatus') vscode.commands.executeCommand('yzoj.openProblemStatus', msg.problemId || msg.id);
      if (msg.command == 'openRanklist') vscode.commands.executeCommand('yzoj.showRanklist', msg.url);
      if (msg.command == 'openUserProfile') vscode.commands.executeCommand('yzoj.openUserProfile', msg.uid, msg.username);
      if (msg.command == 'requestUserCard') {
        const data = await getUserCardData(msg.username, msg.uid);
        panel.webview.postMessage({ command: 'userCardData', username: msg.username, uid: msg.uid, data: data || {} });
      }
      if (msg.command == 'requestUserTags') {
        const tags = await getUserTags(msg.username, msg.uid);
        panel.webview.postMessage({ command: 'userTagsData', username: msg.username, uid: msg.uid, tags: tags });
      }
    });
  } catch (err) { panel.webview.html = '<div style="text-align:center;padding:50px;color:red">加载失败: ' + esc(err.message) + '</div>'; }
}

async function loadProblemStatusPage(panel, url, baseUrl) {
  panel.webview.html = '<div style="text-align:center;padding:50px;color:#666">少女祈祷中...</div>';
  try {
    const html = await gethtml(url, globalCookie);
    const data = parseProblemStatusPage(html, baseUrl);
    
    // 预加载 tags
    var allUids = (data.records||[]).map(function(r){ return r.userId ? String(r.userId) : null; }).filter(Boolean);
    var tagsMap = await preloadUserTags(allUids);
    (data.records||[]).forEach(function(r) {
      if (r.userId && tagsMap[r.userId]) r.tags = tagsMap[r.userId];
    });
    
    panel.webview.html = getProblemStatusWebview(data, baseUrl);
  } catch (err) {
    panel.webview.html = '<div style="text-align:center;padding:50px;color:red">' + err.message + '</div>';
  }
}

async function showEditor(panel, options, context) {
  // 如果是撰写题解（非编辑已有题解），获取用户之前已发布的题解作为初始内容
  if (options.extraData && options.extraData.type === 'solution' && options.extraData.problemId && !options.initialContent) {
    try {
      const html = await gethtml(yzoj_url + '/OnlineJudge/problem_solve.php?id=' + options.extraData.problemId + '&ignore=yes&page=0', globalCookie);
      const pageData = parseSolutionsPage(html, yzoj_url, 0);
      if (pageData && pageData.solutions) {
        const userSolution = pageData.solutions.find(function(s) { return s.author === usernamep; });
        if (userSolution && userSolution.contentHtml) {
          var converted = htmlToMdLatex(userSolution.contentHtml);
          // 如果没有 HIDDEN_MARKER（来自 YZOJ 直接保存的内容），剥离 HTML 标签
          if (converted === userSolution.contentHtml && /<[a-z][\s\S]*>/i.test(converted)) {
            converted = userSolution.contentHtml.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
          }
          options.initialContent = converted;
        }
      }
    } catch (e) {
      // 静默失败，编辑器将显示空内容
    }
  }
  // 如果是回复讨论，从 discuss_discuss.php 页面的 textarea 提取已有内容
  if (options.extraData && options.extraData.type === 'discussion_reply' && options.extraData.fetchExisting && !options.initialContent) {
    try {
      var replyId = options.extraData.discussionId || options.extraData.id;
      if (replyId) {
        const html = await gethtml(yzoj_url + '/OnlineJudge/discuss_discuss.php?did=' + replyId + '&page=0', globalCookie);
        var taMatch = html.match(/<textarea[^>]*name=["']body["'][^>]*>([\s\S]*?)<\/textarea>/i);
        if (taMatch && taMatch[1]) {
          var existingContent = taMatch[1].trim();
          // HTML 解码
          existingContent = existingContent.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g,' ');
          // 有隐藏标记时提取原始 Markdown 源码，否则保留原内容
          if (existingContent) options.initialContent = htmlToMdLatex(existingContent);
        }
      }
    } catch (e) {
      // 静默失败，编辑器将显示空内容
    }
  }

  const editorPanel = panelManager.getOrCreate('editor:' + (options.editorId || Date.now()), options.title || '编辑器', vscode.ViewColumn.Two, { enableScripts: true, retainContextWhenHidden: true });
  editorPanel.webview.html = getMarkdownEditorWebview(options);
  editorPanel.webview.onDidReceiveMessage(msg => {
    if (msg.command == 'submitEditorContent') {
      handleEditorSubmit(msg.content, msg.format || 'markdown', msg.extraData, context, yzoj_url, globalCookie);
      editorPanel.dispose();
    }
    if (msg.command == 'cancelEditor') {
      editorPanel.dispose();
    }
  });
}

async function handleEditorSubmit(content, format, extraData, _context, yzoj_url, globalCookie) {
  if (!extraData) return;
  const type = extraData.type;
  format = format || extraData.format || 'markdown';
  // 题解：markdown → HTML + 隐藏标记；讨论：markdown → HTML（无标记）
  let finalContent = content;
  if (format === 'markdown') {
    if (type === 'solution' || type === 'discussion' || type === 'discussion_reply' || type === 'contest_discussion') {
      // 题解 & 讨论区讨论（含回复、比赛讨论）：md→html + 隐藏标记，方便后续编辑还原
      finalContent = mdLatexToHtml(content);
    } else {
      // 题目讨论等：md→html，无标记（不支持编辑）
      finalContent = mdToHtml(content);
    }
  }
  if (type === 'solution') {
    // 直接 POST 到 YZOJ 的 problem_solve.php
    try {
      const pid = extraData.problemId;
      if (!pid) { vscode.window.showErrorMessage('❌ 缺少题目 ID'); return; }
      const fetch = require('node-fetch');
      const url = yzoj_url + '/OnlineJudge/problem_solve.php?id=' + pid + '&ignore=yes&page=0';
      const resp = await fetch(url, {
        method: 'POST',
        redirect: 'manual',
        headers: { 'Cookie': globalCookie, 'Content-Type': 'application/x-www-form-urlencoded', 'Referer': url },
        body: new URLSearchParams({
          body: finalContent,
          submit: '提交'
        }).toString()
      });
      logger.log('[submitSolution] status:', resp.status, 'url:', url);
      // YZOJ 成功提交后返回 302 重定向
      if (resp.status >= 300 && resp.status < 400) {
        vscode.window.showInformationMessage('✅ 题解已发布');
        vscode.commands.executeCommand('yzoj.openSolutionList', pid);
      } else {
        const text = await resp.text();
        logger.log('[submitSolution] response length:', text.length, 'preview:', text.substring(0, 500));
        if (text.indexOf('success') >= 0 || text.indexOf('已发布') >= 0 || text.indexOf('成功') >= 0 || text.indexOf('修改成功') >= 0) {
          vscode.window.showInformationMessage('✅ 题解已发布');
          vscode.commands.executeCommand('yzoj.openSolutionList', pid);
        } else {
          // 尝试提取 YZOJ 错误信息
          var errMatch = text.match(/<div[^>]*class="error"[^>]*>([\s\S]*?)<\/div>/i);
          var errMsg = errMatch ? errMatch[1].replace(/<[^>]*>/g, '').trim() : '发布失败，请检查内容或登录状态';
          vscode.window.showErrorMessage('❌ ' + errMsg);
        }
      }
    } catch (e) {
      vscode.window.showErrorMessage('❌ 网络错误: ' + e.message);
    }
  } else if (type === 'problem_discussion') {
    try {
      // 题目讨论：POST 到 problem_discuss.php（每人可发任意条）
      const pid = extraData.problemId || extraData.pid;
      if (!pid) { vscode.window.showErrorMessage('❌ 缺少题目 ID'); return; }
      const postUrl = yzoj_url + '/OnlineJudge/problem_discuss.php?pid=' + pid + '&page=0';
      const res = await fetch(postUrl, {
        method: 'POST',
        headers: { 'Cookie': globalCookie, 'Content-Type': 'application/x-www-form-urlencoded', 'Referer': postUrl },
        body: new URLSearchParams({
          body: finalContent,
          submit: '提交'
        }).toString()
      });
      const text = await res.text();
      if (text.indexOf('success') >= 0 || text.indexOf('已发布') >= 0 || text.indexOf('成功') >= 0 || res.status === 200) {
        vscode.window.showInformationMessage('✅ 讨论已发布');
        // 跳转回题目
        vscode.commands.executeCommand('yzoj.openProblemDetail', { id: pid, url: yzoj_url + '/OnlineJudge/problem_show.php?id=' + pid });
      } else {
        vscode.window.showErrorMessage('❌ 发布讨论失败，请检查内容');
      }
    } catch (e) {
      vscode.window.showErrorMessage('❌ 网络错误: ' + e.message);
    }
  } else if (type === 'discussion') {
    try {
      // 普通讨论：POST 到 discuss_send.php
      const pid = extraData.problemId || extraData.pid;
      const res = await fetch(yzoj_url + '/OnlineJudge/discuss_send.php', {
        method: 'POST',
        headers: { 'Cookie': globalCookie, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          pid: String(pid || ''),
          title: String(extraData.title || ''),
          content: finalContent
        }).toString()
      });
      const text = await res.text();
      if (text.indexOf('success') >= 0 || text.indexOf('已发布') >= 0 || text.indexOf('成功') >= 0 || res.status === 200) {
        vscode.window.showInformationMessage('✅ 讨论已发布');
      } else {
        vscode.window.showErrorMessage('❌ 发布讨论失败，请检查内容');
      }
    } catch (e) {
      vscode.window.showErrorMessage('❌ 网络错误: ' + e.message);
    }
  } else if (type === 'discussion_reply') {
    try {
      // 回复讨论：POST 到 discuss_discuss.php
      const did = extraData.discussionId || extraData.id;
      const res = await fetch(yzoj_url + '/OnlineJudge/discuss_discuss.php?did=' + did + '&page=0', {
        method: 'POST',
        headers: { 'Cookie': globalCookie, 'Content-Type': 'application/x-www-form-urlencoded', 'Referer': yzoj_url + '/OnlineJudge/discuss_discuss.php?did=' + did },
        body: new URLSearchParams({
          body: finalContent,
          submit: '\u63D0\u4EA4'
        }).toString()
      });
      const text = await res.text();
      if (text.indexOf('success') >= 0 || text.indexOf('已发布') >= 0 || text.indexOf('成功') >= 0 || res.status === 200) {
        vscode.window.showInformationMessage('\u2705 \u56DE\u590D\u5DF2\u53D1\u5E03');
        // 刷新讨论详情
        vscode.commands.executeCommand('yzoj.openDiscussionDetail', did);
      } else {
        vscode.window.showErrorMessage('\u274C \u56DE\u590D\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u5185\u5BB9');
      }
    } catch (e) {
      vscode.window.showErrorMessage('\u274C \u7F51\u7EDC\u9519\u8BEF: ' + e.message);
    }
  } else if (type === 'contest_discussion') {
    try {
      const tid = extraData.contestId || extraData.tid;
      const res = await fetch(yzoj_url + '/OnlineJudge/discuss_send.php?tid=' + tid, {
        method: 'POST',
        headers: { 'Cookie': globalCookie, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          tid: String(tid || ''),
          title: String(extraData.title || ''),
          content: finalContent
        }).toString()
      });
      const text = await res.text();
      if (text.indexOf('success') >= 0 || text.indexOf('已发布') >= 0 || text.indexOf('成功') >= 0 || res.status === 200) {
        vscode.window.showInformationMessage('✅ 讨论已发布');
      } else {
        vscode.window.showErrorMessage('❌ 发布讨论失败，请检查内容');
      }
    } catch (e) {
      vscode.window.showErrorMessage('❌ 网络错误: ' + e.message);
    }
  }
}

// ---- Problem Set Functions ----
async function loadProblemSetList(panel, action, baseUrl, opts) {
  panel.webview.html = '<div style="text-align:center;padding:50px;color:#666">少女祈祷中...</div>';
  try {
    let result;
    if (action === 'public') {
      result = await proxyFetch('/api/problem_sets?action=public&username=' + (usernamep||'') + '&token=' + (globalCookie||''));
    } else if (action === 'my') {
      result = await proxyFetch('/api/problem_sets?action=my&username=' + (usernamep||'') + '&token=' + (globalCookie||''));
    } else if (action === 'search') {
      var params = '?action=search&username=' + encodeURIComponent(usernamep||'');
      if (opts) {
        if (opts.keyword) params += '&keyword=' + encodeURIComponent(opts.keyword);
        if (opts.sort_by) params += '&sort_by=' + opts.sort_by;
        if (opts.sort_order) params += '&sort_order=' + opts.sort_order;
      }
      result = await proxyFetch('/api/problem_sets' + params);
    }
    const sets = (result && result.problem_sets) || [];
    // 客户端过滤：如果当前用户在 denited_users 列表中，则过滤掉该题单
    var filteredSets = sets.filter(function(s) {
      if (s.permission === 'blacklist' && s.denied_users) {
        var deniedList = s.denied_users.split(',').map(function(x){return x.trim();}).filter(Boolean);
        if (deniedList.indexOf(usernamep) !== -1) return false;
      }
      return true;
    });
    
    panel.webview.html = getProblemSetListWebview(filteredSets, baseUrl, usernamep, (opts && opts.keyword) || '', (opts && opts.sort_by) || 'updated_at', (opts && opts.sort_order) || 'desc');
  } catch (err) { panel.webview.html = '<div style="text-align:center;padding:50px;color:red">' + err.message + '</div>'; }
}

async function showProblemSetEditor(panel, baseUrl, existingSet) {
  panel.webview.html = getProblemSetEditorWebview(existingSet || {}, baseUrl, usernamep);
}

async function saveProblemSet(panel, baseUrl, data) {
  try {
    // 前端验证：标题和题目列表不能为空
    if (!data.title || !String(data.title).trim()) {
      vscode.window.showErrorMessage('❌ 题目标题不能为空');
      return;
    }
    var pids = (data.problem_ids||'').split(',').map(s=>s.trim()).filter(Boolean);
    // 题目 ID 去重
    pids = [...new Set(pids)];
    if (pids.length === 0) {
      vscode.window.showErrorMessage('❌ 请至少输入一道题目');
      return;
    }
    // 允许/禁止用户列表去重 + 过滤自身
    var allowedUsers = (data.allowed_users||'').split(',').map(s=>s.trim()).filter(Boolean);
    allowedUsers = [...new Set(allowedUsers)].filter(u => u !== usernamep);
    var deniedUsers = (data.denied_users||'').split(',').map(s=>s.trim()).filter(Boolean);
    deniedUsers = [...new Set(deniedUsers)].filter(u => u !== usernamep);
    var body = {
      username: usernamep, token: globalCookie,
      title: data.title, is_public: data.is_public,
      description: data.description || '',
      format: data.format || 'html',
      permission: data.permission || 'public',
      password: data.password || '',
      allowed_users: allowedUsers.join(','),
      denied_users: deniedUsers.join(','),
      problem_ids: pids
    };
    if (data.id) {
      body.op = 'update';
      body.action = 'update';
      body.id = data.id;
    } else {
      body.op = 'create';
      body.action = 'create';
    }
    var res = await proxyFetch('/api/problem_sets', {
      method: 'POST', body: JSON.stringify(body)
    });
    if (res && res.success) {
      vscode.window.showInformationMessage('✅ ' + (data.id?'题单已更新':'题单已创建'));
      loadProblemSetList(panel, 'public', baseUrl);
    } else {
      vscode.window.showErrorMessage('❌ ' + ((res && res.message)||'操作失败'));
    }
  } catch (err) { vscode.window.showErrorMessage('❌ 网络错误: ' + err.message); }
}

async function deleteProblemSet(panel, baseUrl, psid) {
  const confirmed = await vscode.window.showWarningMessage('确定删除此题单?', { modal: true }, '确定');
  if (confirmed !== '确定') return;
  try {
    var res = await proxyFetch('/api/problem_sets', {
      method: 'POST', body: JSON.stringify({ username: usernamep, token: globalCookie, action: 'delete', op: 'delete', id: psid })
    });
    if (res && res.success) {
      vscode.window.showInformationMessage('✅ 题单已删除');
      loadProblemSetList(panel, 'public', baseUrl);
    } else { vscode.window.showErrorMessage('❌ ' + ((res && res.message)||'删除失败')); }
  } catch (err) { vscode.window.showErrorMessage('❌ 网络错误: ' + err.message); }
}


function activate(ctx) {
  context = ctx;
  yzoj_url = vscode.workspace.getConfiguration('yzoj').get('baseUrl');

  vscode.commands.registerCommand('yzoj.login', async () => {
    let type, saved_user, key, users, username, password, status, tmp;
    type = await vscode.window.showQuickPick(['账密登录','cookie登录'],{placeHolder:'选择登录方式'});
    // type = '账密登录';
    if (type == '账密登录') {
      saved_user = context.globalState.get('user');
      if (saved_user) {
        type = await vscode.window.showQuickPick(['是','否'],{placeHolder:'是否使用本地保存的密码数据?'})
        // type = '是';
        if (type == '是') {
          key = await vscode.window.showInputBox({prompt:'加密密钥:', password: true});
          // key = 'hhrhhrhhrhhr';
          try {
            users = decrypt(saved_user, key); [username, password] = users.split(':');
            status = await login(username, password);
            if (status.success) { usernamep = username; globalCookie = status.cookie; vscode.window.showInformationMessage('登录成功: ' + usernamep); checkAndUpdateMaps(); }
            else vscode.window.showErrorMessage('登录失败!');
          } catch (_error) { vscode.window.showErrorMessage('解密失败'); }
        }else{
          username = await vscode.window.showInputBox({ prompt: '用户名:' });
          if (!username) return;
          password = await vscode.window.showInputBox({ prompt: '密码:', password: true });
          if (!password) return;
          type = await vscode.window.showQuickPick(['是', '否'], { placeHolder: '保存密码?' });
          if (type == '是') {
            key = await vscode.window.showInputBox({ prompt: '加密密钥:', password: true });
            if (!key) return;
            context.globalState.update('user', encrypt(username + ':' + password, key));
            vscode.window.showInformationMessage('保存成功');
          }
          status = await login(username, password);
          if (status.success) { usernamep = username; globalCookie = status.cookie; vscode.window.showInformationMessage('登录成功: ' + usernamep); checkAndUpdateMaps(); }
          else vscode.window.showErrorMessage('登录失败!');
        }
      } else {
        username = await vscode.window.showInputBox({ prompt: '用户名:' });
        if (!username) return;
        password = await vscode.window.showInputBox({ prompt: '密码:', password: true });
        if (!password) return;
        type = await vscode.window.showQuickPick(['是', '否'], { placeHolder: '保存密码?' });
        if (type == '是') {
          key = await vscode.window.showInputBox({ prompt: '加密密钥:', password: true });
          if (!key) return;
          context.globalState.update('user', encrypt(username + ':' + password, key));
          vscode.window.showInformationMessage('保存成功');
        }
        status = await login(username, password);
        if (status.success) { usernamep = username; globalCookie = status.cookie; vscode.window.showInformationMessage('登录成功: ' + usernamep); checkAndUpdateMaps(); }
        else vscode.window.showErrorMessage('登录失败!');
      }
    } else if (type == 'cookie 登录') {
      tmp = await vscode.window.showInputBox({ prompt: 'Cookie:', password: true });
      if ((status = (await checkStatus(tmp))).isLoggedIn) { usernamep = status.username; globalCookie = tmp; vscode.window.showInformationMessage('登录成功: ' + usernamep); checkAndUpdateMaps(); }
      else vscode.window.showErrorMessage('登录失败!');
    }
  });

  function setupContestPanel(panel, action) {
    panel.webview.onDidReceiveMessage(msg => {
      if (msg.command == 'fetchImage') { handleFetchImage(panel, msg); return; }
      if (msg.command == 'downloadFile') { handleDownloadFile(panel, msg); return; }
      if (msg.command == 'changePage') {
        loadContestList(panel, action, msg.p, yzoj_url, globalCookie, {});
      }
      if (msg.command == 'openContest') {
        vscode.commands.executeCommand('yzoj.openContestDetail', { id: msg.id, title: msg.title, url: msg.url });
      }
      if (msg.command == 'openExternal') {
        var _extCLUrl = msg.url;
        if (_extCLUrl.startsWith('vscode-webview://')) {
          var _extCLPath = _extCLUrl.replace(/^vscode-webview:\/\/[^\/]+/, '');
          if (_extCLPath.startsWith('/OnlineJudge/')) {
            _extCLUrl = yzoj_url.replace(/\/+$/, '') + _extCLPath;
          } else {
            _extCLUrl = yzoj_url.replace(/\/+$/, '') + '/OnlineJudge' + _extCLPath;
          }
        }
        vscode.commands.executeCommand('vscode.open', vscode.Uri.parse(_extCLUrl));
      }
      if (msg.command == 'openUserProfile') vscode.commands.executeCommand('yzoj.openUserProfile', msg.uid, msg.username);
      if (msg.command == 'searchContest') {
        loadContestList(panel, msg.act || action, 1, yzoj_url, globalCookie, { keyword: msg.keyword });
      }
      if (msg.command == 'requestUserCard') {
        (async () => {
          const data = await getUserCardData(msg.username, msg.uid);
          panel.webview.postMessage({ command: 'userCardData', username: msg.username, uid: msg.uid, data: data || {} });
        })();
      }
      if (msg.command == 'requestUserTags') {
        (async () => {
          const tags = await getUserTags(msg.username, msg.uid);
          panel.webview.postMessage({ command: 'userTagsData', username: msg.username, uid: msg.uid, tags: tags });
        })();
      }
    });
  }

  vscode.commands.registerCommand('yzoj.showScheduledContests', () => {
    if (!globalCookie) { vscode.window.showWarningMessage('请先登录'); return; }
    const panel = panelManager.getOrCreate('contest::scheduled', '计划中的比赛', vscode.ViewColumn.Two, { enableScripts: true, retainContextWhenHidden: true });
    contestSearchState.opts = { page: 1, page_size: 50 };
    loadContestList(panel, 'scheduled', 1, yzoj_url, globalCookie, {});
    setupContestPanel(panel, 'scheduled');
  });

  vscode.commands.registerCommand('yzoj.showActiveContests', () => {
    if (!globalCookie) { vscode.window.showWarningMessage('请先登录'); return; }
    const panel = panelManager.getOrCreate('contest:active', '进行中的比赛', vscode.ViewColumn.Two, { enableScripts: true, retainContextWhenHidden: true });
    contestSearchState.opts = { page: 1, page_size: 50 };
    loadContestList(panel, 'now', 1, yzoj_url, globalCookie, {});
    setupContestPanel(panel, 'now');
  });

  vscode.commands.registerCommand('yzoj.showPastContests', () => {
    if (!globalCookie) { vscode.window.showWarningMessage('请先登录'); return; }
    const panel = panelManager.getOrCreate('contest:past', '过去的比赛', vscode.ViewColumn.Two, { enableScripts: true, retainContextWhenHidden: true });
    contestSearchState.opts = { page: 1, page_size: 50 };
    loadContestList(panel, 'past', 1, yzoj_url, globalCookie, {});
    setupContestPanel(panel, 'past');
  });

  vscode.commands.registerCommand('yzoj.openContestDetail', async (contest) => {
    logger.log('[FZYZOJ] openContestDetail called with contest=' + JSON.stringify(contest));
    if (!globalCookie) { vscode.window.showWarningMessage('请先登录'); return; }
    let target = contest;
    if (!target) {
      const id = await vscode.window.showInputBox({ prompt: '比赛编号:', placeHolder: '如 3281', validateInput: v => /^\d+$/.test(v) ? null : '请输入数字' });
      if (!id) return;
      target = { id, title: '比赛 #' + id, url: yzoj_url + '/OnlineJudge/contest_show.php?id=' + id };
    }
    // 从 id 构造 URL，不依赖 msg.url（webview 中传递的是 vscode-webview:// 协议地址）
    if (!target.url || target.url.startsWith('vscode-webview://')) {
      target.url = yzoj_url + '/OnlineJudge/contest_show.php?id=' + target.id;
    }
    const panel = panelManager.getOrCreate('contest:detail:' + target.id, target.title, vscode.ViewColumn.Two, { enableScripts: true, retainContextWhenHidden: true });
    // 先注册消息处理器，再设置 HTML，确保不遗漏 webview 消息
    panel.webview.onDidReceiveMessage(msg => {
      if (msg.command == 'fetchImage') { handleFetchImage(panel, msg); return; }
      if (msg.command == 'downloadFile') { handleDownloadFile(panel, msg); return; }
      if (msg.command == 'createContestFolder') {
        handleCreateContestFolder(msg, context);
        // 注册工作区映射路径到本地存储
        const ws = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
        if (ws) registerMapPath(context, ws.uri.fsPath);
      }
      if (msg.command == 'openProblem') vscode.commands.executeCommand('yzoj.openProblemDetail', { id: msg.id, url: msg.url, contestId: target.id, contestTitle: target.title, contestUrl: target.url });
      if (msg.command == 'openContestStatus') {
        vscode.commands.executeCommand('yzoj.openContestStatus', { contestId: msg.contestId, url: msg.url });
      }
      if (msg.command == 'openProblemStatusPage') {
        vscode.commands.executeCommand('yzoj.openProblemStatus', { url: msg.url });
      }
      if (msg.command == 'openStatusDetail') {
        logger.log('[FZYZOJ] openStatusDetail received, id=' + msg.id);
        vscode.commands.executeCommand('yzoj.openStatusDetail', msg.id);
      }
      if (msg.command == 'openExternal') {
        var url = msg.url;
        if (url.indexOf('contest_result.php') >= 0) {
          vscode.commands.executeCommand('yzoj.openContestResult', { contestId: target.id, url: url });
        } else if (url.indexOf('status.php') >= 0) {
          vscode.commands.executeCommand('yzoj.openContestStatus', { contestId: target.id, url: url });
        } else if (url.indexOf('contest_rank.php') >= 0 || url.indexOf('contest_scoreboard') >= 0) {
          vscode.commands.executeCommand('yzoj.openContestRank', { contestId: target.id, url: url });
        } else {
          if (url.startsWith('vscode-webview://')) {
            var _extContestPath = url.replace(/^vscode-webview:\/\/[^\/]+/, '');
            if (_extContestPath.startsWith('/OnlineJudge/')) {
              url = yzoj_url.replace(/\/+$/, '') + _extContestPath;
            } else {
              url = yzoj_url.replace(/\/+$/, '') + '/OnlineJudge' + _extContestPath;
            }
          }
          vscode.env.openExternal(vscode.Uri.parse(url));
        }
      }
      if (msg.command == 'openUserProfile') vscode.commands.executeCommand('yzoj.openUserProfile', msg.uid, msg.username);
      if (msg.command == 'openDiscussion') vscode.commands.executeCommand('yzoj.openDiscussionDetail', { id: msg.id, url: msg.url });
      if (msg.command == 'openDiscussionList') vscode.commands.executeCommand('yzoj.openDiscussionList', msg.problemId || msg.id);
      if (msg.command == 'openStatusList') vscode.commands.executeCommand('yzoj.showStatusList', msg.filters || {});
      if (msg.command == 'openProblemStatus') vscode.commands.executeCommand('yzoj.openProblemStatus', msg.problemId || msg.id);
      if (msg.command == 'openRanklist') vscode.commands.executeCommand('yzoj.showRanklist', msg.url);
      if (msg.command == 'requestUserCard') {
        (async () => {
          const data = await getUserCardData(msg.username, msg.uid);
          panel.webview.postMessage({ command: 'userCardData', username: msg.username, uid: msg.uid, data: data || {} });
        })();
      }
      if (msg.command == 'requestUserTags') {
        (async () => {
          const tags = await getUserTags(msg.username, msg.uid);
          panel.webview.postMessage({ command: 'userTagsData', username: msg.username, uid: msg.uid, tags: tags });
        })();
      }
    });
    panel.webview.html = '<div style="text-align:center;padding:50px;color:#666">少女祈祷中...</div>';
    try {
      const html = await gethtml(target.url, globalCookie);
      const detail = parseContestDetail(html, yzoj_url);
      detail.contestId = target.id;
      
      
      if (detail.title) {
        try { panel.title = detail.title; } catch(_e) {}
      }
      // 首次渲染：不做预处理，用户卡片按需 hover 加载
      panel.webview.html = getContestDetailWebview(detail, yzoj_url);
    } catch (err) { panel.webview.html = '<div style="text-align:center;padding:50px;color:red">' + err.message + '</div>'; }
  });

  const openContestResultCmd = vscode.commands.registerCommand('yzoj.openContestResult', async (data) => {
    if (!globalCookie) { vscode.window.showWarningMessage('请先登录'); return; }
    const panel = panelManager.getOrCreate('contest:result:' + data.contestId, '比赛结果', vscode.ViewColumn.Two, { enableScripts: true, retainContextWhenHidden: true });
    panel.webview.html = '<div style="text-align:center;padding:50px;color:#666">少女祈祷中...</div>';
    try {
      const html = await gethtml(data.url, globalCookie);
      const result = parseContestResult(html, yzoj_url);
      
      panel.webview.html = getContestResultWebview(result, yzoj_url);
      panel.webview.onDidReceiveMessage(msg => {
        if (msg.command == 'fetchImage') { handleFetchImage(panel, msg); return; }
        if (msg.command == 'downloadFile') { handleDownloadFile(panel, msg); return; }
        if (msg.command == 'openStatusDetail') vscode.commands.executeCommand('yzoj.openStatusDetail', msg.id);
        if (msg.command == 'openProblem') vscode.commands.executeCommand('yzoj.openProblemDetail', { id: msg.id, url: msg.url });
        if (msg.command == 'openUserProfile') vscode.commands.executeCommand('yzoj.openUserProfile', msg.uid, msg.username);
        if (msg.command == 'requestUserCard') {
          (async () => {
            const uData = await getUserCardData(msg.username, msg.uid);
            panel.webview.postMessage({ command: 'userCardData', username: msg.username, uid: msg.uid, data: uData || {} });
          })();
        }
        if (msg.command == 'requestUserTags') {
          (async () => {
            const tags = await getUserTags(msg.username, msg.uid);
            panel.webview.postMessage({ command: 'userTagsData', username: msg.username, uid: msg.uid, tags: tags });
          })();
        }
      });
    } catch (err) { panel.webview.html = '<div style="text-align:center;padding:50px;color:red">' + err.message + '</div>'; }
  });

  vscode.commands.registerCommand('yzoj.openContestStatus', async (data) => {
    if (!globalCookie) { vscode.window.showWarningMessage('请先登录'); return; }
    var contestId = '';
    if (data && typeof data === 'object') contestId = data.contestId || '';
    if (!contestId) {
      var _in = await vscode.window.showInputBox({ prompt: '请输入比赛 ID', placeHolder: '例如: 1001', ignoreFocusOut: true });
      if (!_in) return;
      contestId = _in.trim();
    }
    const filters = Object.assign({}, (data && data.filters) || {}, { test: contestId });
    vscode.commands.executeCommand('yzoj.showStatusList', filters);
  });

  vscode.commands.registerCommand('yzoj.openContestRank', async (data) => {
    if (!globalCookie) { vscode.window.showWarningMessage('请先登录'); return; }
    var contestId = '';
    var url = '';
    if (data && typeof data === 'object') {
      contestId = data.contestId || '';
      url = data.url || '';
    }
    if (!contestId && !url) {
      var _in = await vscode.window.showInputBox({ prompt: '请输入比赛 ID', placeHolder: '例如: 1001', ignoreFocusOut: true });
      if (!_in) return;
      contestId = _in.trim();
    }
    if (!url) url = yzoj_url + '/OnlineJudge/contest_rank.php?id=' + contestId;
    const panel = panelManager.getOrCreate('contest:rank:' + contestId, '排行榜', vscode.ViewColumn.Two, { enableScripts: true, retainContextWhenHidden: true });
    panel.webview.html = '<div style="text-align:center;padding:50px;color:#666">少女祈祷中...</div>';
    try {
      const html = await gethtml(url, globalCookie);
      const result = parseContestResult(html, yzoj_url);
      
      // 预加载所有用户的 tags
      var allUids = [];
      (result.records||[]).forEach(function(r) { if (r.userId) allUids.push(String(r.userId)); });
      var tagsMap = await preloadUserTags(allUids);
      (result.records||[]).forEach(function(r) {
        if (r.userId && tagsMap[r.userId]) {
          r.tags = tagsMap[r.userId];
        }
      });
      
      panel.webview.html = getContestResultWebview(result, yzoj_url);
      panel.webview.onDidReceiveMessage(msg => {
        if (msg.command == 'openStatusDetail') vscode.commands.executeCommand('yzoj.openStatusDetail', msg.id);
        if (msg.command == 'openProblem') vscode.commands.executeCommand('yzoj.openProblemDetail', { id: msg.id, url: msg.url });
        if (msg.command == 'openUserProfile') vscode.commands.executeCommand('yzoj.openUserProfile', msg.uid, msg.username);
        if (msg.command == 'requestUserCard') {
        (async () => {
          const uData = await getUserCardData(msg.username, msg.uid);
          panel.webview.postMessage({ command: 'userCardData', username: msg.username, uid: msg.uid, data: uData || {} });
        })();
      }
      if (msg.command == 'requestUserTags') {
        (async () => {
          const tags = await getUserTags(msg.username, msg.uid);
          panel.webview.postMessage({ command: 'userTagsData', username: msg.username, uid: msg.uid, tags: tags });
        })();
      }
    });
  } catch (err) { panel.webview.html = '<div style="text-align:center;padding:50px;color:red">' + err.message + '</div>'; }
  });

  vscode.commands.registerCommand('yzoj.showProblemSetList', async () => { if (!globalCookie) { vscode.window.showWarningMessage('请先登录'); return; }
    const panel = panelManager.getOrCreate('problemset:list', '题单列表', vscode.ViewColumn.Two, { enableScripts: true, retainContextWhenHidden: true });
    loadProblemSetList(panel, 'public', yzoj_url);
    panel.webview.onDidReceiveMessage(msg => {
      if (msg.command == 'fetchImage') { handleFetchImage(panel, msg); return; }
      if (msg.command == 'downloadFile') { handleDownloadFile(panel, msg); return; }
      if (msg.command == 'openProblemSet') vscode.commands.executeCommand('yzoj.openProblemSetDetail', msg);
      if (msg.command == 'loadPublicSets') loadProblemSetList(panel, 'public', yzoj_url);
      if (msg.command == 'loadMySets') loadProblemSetList(panel, 'my', yzoj_url);
      if (msg.command == 'showCreateSet') showProblemSetEditor(panel, yzoj_url, null);
      if (msg.command == 'saveProblemSet') saveProblemSet(panel, yzoj_url, msg);
      if (msg.command == 'deleteProblemSet') deleteProblemSet(panel, yzoj_url, msg.id);
      if (msg.command == 'cancelEdit') loadProblemSetList(panel, 'public', yzoj_url);
      if (msg.command == 'searchProblemSets') loadProblemSetList(panel, 'search', yzoj_url, { keyword: msg.keyword, sort_by: msg.sort_by, sort_order: msg.sort_order });
      if (msg.command == 'searchUsers') {
        (async () => {
          const res = await proxyFetch('/api/users/search?keyword=' + encodeURIComponent(msg.keyword) + '&page_size=10');
          panel.webview.postMessage({ command: 'userSearchResult', results: (res && res.users) || [], source: msg.source || 'allowed' });
        })();
      }
      if (msg.command == 'openUserProfile') vscode.commands.executeCommand('yzoj.openUserProfile', msg.uid, msg.username);
      if (msg.command == 'requestUserCard') {
        (async () => {
          const uData = await getUserCardData(msg.username, msg.uid);
          panel.webview.postMessage({ command: 'userCardData', username: msg.username, uid: msg.uid, data: uData || {} });
        })();
      }
      if (msg.command == 'requestUserTags') {
        (async () => {
          const tags = await getUserTags(msg.username, msg.uid);
          panel.webview.postMessage({ command: 'userTagsData', username: msg.username, uid: msg.uid, tags: tags });
        })();
      }
    });
  });

  vscode.commands.registerCommand('yzoj.openProblemSetDetail', async (data) => { if (!globalCookie) { vscode.window.showWarningMessage('请先登录'); return; } var psid = data && data.id; if (!psid) { psid = await vscode.window.showInputBox({ prompt: '题单编号:', placeHolder: '输入题单ID' }); if (!psid) return; }
    const panel = panelManager.getOrCreate('problemset:detail:' + psid, (data && data.title) || '题单 #' + psid, vscode.ViewColumn.Two, { enableScripts: true, retainContextWhenHidden: true });
    panel.webview.html = '<div style="text-align:center;padding:50px;color:#666">少女祈祷中...</div>';
    // 通过 whoami 获取当前登录用户
    var currentUsername = usernamep || '';
    try {
      var whoamiRes = await proxyFetch('/api/whoami');
      if (whoamiRes && whoamiRes.username) currentUsername = whoamiRes.username;
    } catch(e) {}
    try {
      var set = null;
      var problems = [];
      var pMarks = {};
      // Use new API to get problem set detail with problems
      var apiSet = await proxyFetch('/api/problem_sets/' + psid + '?username=' + encodeURIComponent(currentUsername));
      if (!apiSet || apiSet.error) {
        const sets = await proxyFetch('/api/problem_sets?action=public&username=' + (usernamep||'') + '&token=' + (globalCookie||''));
        set = ((sets && sets.problem_sets) || []).find(s => String(s.id) === String(psid));
        if (set && set.problem_ids) {
          const ids = set.problem_ids.split(',').filter(Boolean);
          problems = ids.map(function(pid) {
            pid = String(pid).trim();
            if (!pid) return null;
            return {
              id: pid,
              name: 'P' + pid,
              url: yzoj_url + '/OnlineJudge/problem_show.php?id=' + pid,
              mark: getProblemStatusMark(pid)
            };
          }).filter(Boolean);
          problems.forEach(function(p){pMarks[p.id] = getProblemStatusMark(p.id);});
        }
      } else {
        set = apiSet;
        // Check if the problem set needs password verification
        if (set.needs_password) {
          const password = await vscode.window.showInputBox({
            prompt: '该题单受密码保护，请输入密码:',
            password: true,
            placeHolder: '输入题单密码',
            ignoreFocusOut: true
          });
          if (password) {
            const verifyResult = await proxyFetch('/api/problem_sets/verify_password', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                psid: psid,
                password: password,
                username: currentUsername,
                token: globalCookie
              })
            });
            if (verifyResult && verifyResult.success) {
              vscode.window.showInformationMessage('✅ 密码验证成功');
              // Re-fetch the full content
              apiSet = await proxyFetch('/api/problem_sets/' + psid + '?username=' + encodeURIComponent(currentUsername));
              set = apiSet;
            } else {
              vscode.window.showErrorMessage((verifyResult && verifyResult.message) || '密码错误');
              panel.dispose();
              return;
            }
          } else {
            panel.dispose();
            return;
          }
        }
        problems = (set.problems || []).map(p => ({
          id: p.id, name: p.name || 'P' + p.id,
          url: yzoj_url + '/OnlineJudge/problem_show.php?id=' + p.id,
          mark: getProblemStatusMark(p.id)
        }));
        problems.forEach(function(p){pMarks[p.id] = getProblemStatusMark(p.id);});
      }
      if (!set) {
        panel.webview.html = '<div style="text-align:center;padding:50px;color:red">未找到题单</div>';
      } else if (set.permission === 'blacklist' && set.denied_users && set.denied_users.split(',').map(function(x){return x.trim();}).filter(Boolean).indexOf(currentUsername) !== -1) {
        panel.webview.html = '<div style="text-align:center;padding:50px;color:red">无权访问此题单</div>';
      } else if (!problems.length && !set.needs_password) {
        panel.webview.html = '<div style="text-align:center;padding:50px;color:red">题单为空</div>';
      } else {
        panel.webview.html = getProblemSetDetailWebview(set, problems, yzoj_url, currentUsername, pMarks);
      }
      panel.webview.onDidReceiveMessage(msg => {
        if (msg.command == 'fetchImage') { handleFetchImage(panel, msg); return; }
        if (msg.command == 'downloadFile') { handleDownloadFile(panel, msg); return; }
        if (msg.command == 'openProblem') {
          vscode.commands.executeCommand('yzoj.openProblemDetail', { id: msg.id, url: msg.url });
        }
        if (msg.command == 'deleteProblemSet') {
          (async function(){
            const cf = await vscode.window.showWarningMessage('确定删除此题单?', { modal: true }, '确定');
            if (cf !== '确定') return;
            try {
              var res = await proxyFetch('/api/problem_sets', {
                method: 'POST', body: JSON.stringify({ username: usernamep, token: globalCookie, action: 'delete', op: 'delete', id: psid })
              });
              if (res && res.success) {
                vscode.window.showInformationMessage('✅ 题单已删除');
                panel.dispose();
                vscode.commands.executeCommand('yzoj.showProblemSetList');
              } else { vscode.window.showErrorMessage('❌ ' + ((res && res.message)||'删除失败')); }
            } catch(err) { vscode.window.showErrorMessage('❌ 网络错误: ' + err.message); }
          })();
        }
        if (msg.command == 'editProblemSet') {
          const editPanel = panelManager.getOrCreate('problemset:edit:' + psid, '编辑题单', vscode.ViewColumn.Two, { enableScripts: true, retainContextWhenHidden: true });
          (async function(){
            var setData = await proxyFetch('/api/problem_sets/' + psid + '?username=' + encodeURIComponent(usernamep||''));
            if (!setData || setData.error) setData = set;
            showProblemSetEditor(editPanel, yzoj_url, setData);
            editPanel.webview.onDidReceiveMessage(editMsg => {
              if (editMsg.command == 'saveProblemSet') {
                (async function(){
                  try {
                    if (!editMsg.title || !String(editMsg.title).trim()) {
                      vscode.window.showErrorMessage('❌ 题目标题不能为空');
                      return;
                    }
                    var epids = (editMsg.problem_ids||'').split(',').map(function(s){return s.trim();}).filter(Boolean);
                    epids = [...new Set(epids)];
                    if (epids.length === 0) {
                      vscode.window.showErrorMessage('❌ 请至少输入一道题目');
                      return;
                    }
                    var eAllowedUsers = (editMsg.allowed_users||'').split(',').map(s=>s.trim()).filter(Boolean);
                    eAllowedUsers = [...new Set(eAllowedUsers)].filter(u => u !== usernamep);
                    var eDeniedUsers = (editMsg.denied_users||'').split(',').map(s=>s.trim()).filter(Boolean);
                    eDeniedUsers = [...new Set(eDeniedUsers)].filter(u => u !== usernamep);
                    var body = {
                      username: usernamep, token: globalCookie,
                      title: editMsg.title, is_public: editMsg.is_public,
                      description: editMsg.description || '',
                      format: editMsg.format || 'html',
                      permission: editMsg.permission || 'public',
                      password: editMsg.password || '',
                      allowed_users: eAllowedUsers.join(','),
                      denied_users: eDeniedUsers.join(','),
                      problem_ids: epids
                    };
                    if (editMsg.id) { body.op = 'update'; body.action = 'update'; body.id = editMsg.id; }
                    else { body.op = 'create'; body.action = 'create'; }
                    var res = await proxyFetch('/api/problem_sets', { method: 'POST', body: JSON.stringify(body) });
                    if (res && res.success) {
                      vscode.window.showInformationMessage('✅ ' + (editMsg.id?'题单已更新':'题单已创建'));
                      editPanel.dispose();
                      vscode.commands.executeCommand('yzoj.showProblemSetList');
                    } else {
                      vscode.window.showErrorMessage('❌ ' + ((res && res.message)||'操作失败'));
                    }
                  } catch(err) { vscode.window.showErrorMessage('❌ 网络错误: ' + err.message); }
                })();
              }
              if (editMsg.command == 'cancelEdit') { editPanel.dispose(); vscode.commands.executeCommand('yzoj.openProblemSetDetail', { id: psid, title: setData.title }); }
              if (editMsg.command == 'searchUsers') {
                (async () => {
                  const res = await proxyFetch('/api/users/search?keyword=' + encodeURIComponent(editMsg.keyword) + '&page_size=10');
                  editPanel.webview.postMessage({ command: 'userSearchResult', results: (res && res.users) || [], source: editMsg.source || 'allowed' });
                })();
              }
              if (editMsg.command == 'deleteProblemSet') {
                (async function(){
                  const cf = await vscode.window.showWarningMessage('确定删除此题单?', { modal: true }, '确定');
                  if (cf !== '确定') return;
                  try {
                    var res = await proxyFetch('/api/problem_sets', {
                      method: 'POST', body: JSON.stringify({ username: usernamep, token: globalCookie, action: 'delete', op: 'delete', id: editMsg.id })
                    });
                    if (res && res.success) {
                      vscode.window.showInformationMessage('✅ 题单已删除');
                      editPanel.dispose();
                      vscode.commands.executeCommand('yzoj.showProblemSetList');
                    } else { vscode.window.showErrorMessage('❌ ' + ((res && res.message)||'删除失败')); }
                  } catch(err) { vscode.window.showErrorMessage('❌ 网络错误: ' + err.message); }
                })();
              }
            });
          })();
        }
        if (msg.command == 'openUserProfile') vscode.commands.executeCommand('yzoj.openUserProfile', msg.uid, msg.username);
        if (msg.command == 'requestUserCard') {
          (async () => {
            const uData = await getUserCardData(msg.username, msg.uid);
            panel.webview.postMessage({ command: 'userCardData', username: msg.username, uid: msg.uid, data: uData || {} });
          })();
        }
        if (msg.command == 'requestUserTags') {
          (async () => {
            const tags = await getUserTags(msg.username, msg.uid);
            panel.webview.postMessage({ command: 'userTagsData', username: msg.username, uid: msg.uid, tags: tags });
          })();
        }
      });
    } catch (err) { panel.webview.html = '<div style="text-align:center;padding:50px;color:red">' + err.message + '</div>'; }
  });

  vscode.commands.registerCommand('yzoj.openProblemDetail', async (problem) => {
    logger.log('[FZYZOJ] openProblemDetail called with problem=' + JSON.stringify({ id: problem?.id, url: problem?.url?.substring(0,80) }));
    if (!globalCookie) { vscode.window.showWarningMessage('请先登录'); return; }
    let target = problem;
    if (!target) {
      const id = await vscode.window.showInputBox({ prompt: '题号:', placeHolder: '1000', validateInput: v => /^\d+$/.test(v.replace(/^P/i, '')) ? null : '无效题号' });
      if (!id) return;
      const pid = id.replace(/^P/i, '');
      target = { id: pid, title: 'P' + pid, url: yzoj_url + '/OnlineJudge/problem_show.php?id=' + pid };
    }
    if (!target.url || target.url.startsWith('vscode-webview://')) target.url = yzoj_url + '/OnlineJudge/problem_show.php?id=' + target.id;
    const panel = panelManager.getOrCreate('problem:' + target.id, 'P' + target.id, vscode.ViewColumn.Two, { enableScripts: true, retainContextWhenHidden: true });
    panel.webview.html = '<div style="text-align:center;padding:50px;color:#666">少女祈祷中...</div>';
    try {
      const html = await gethtml(target.url, globalCookie);
      
      const detail = target.url.includes('problem_show.php') ? parsePracticeProblem(html, yzoj_url) : parseContestProblem(html, yzoj_url);
      
      // 直接使用解析结果中的 ac_count 和 sub_count
      if (detail.meta && detail.meta.acCount) {
        detail.acCount = detail.meta.acCount;
        detail.subCount = detail.meta.subCount;
      } else {
        // /api/problems/<id> removed - AC/sub count fallback not available via server
      }
      
      // 从已获取的 HTML 实时解析 Mark（替代缓存）
      detail.mark = parseProblemPassStatus(html) || '';
      
      panel.webview.html = getProblemDetailWebview(detail, yzoj_url);
      panel.webview.onDidReceiveMessage(msg => {
        if (msg.command == 'fetchImage') { handleFetchImage(panel, msg); return; }
        if (msg.command == 'sendToCPH') handleSendToCPH(msg.problem, panel);
        if (msg.command == 'downloadFile') { handleDownloadFile(panel, msg); return; }
        if (msg.command == 'submitProblem') vscode.commands.executeCommand('yzoj.submitCode');
        if (msg.command == 'openExternal') {
          var _extUrl3 = msg.url;
          if (_extUrl3.startsWith('vscode-webview://')) {
            var _extPath3 = _extUrl3.replace(/^vscode-webview:\/\/[^\/]+/, '');
            if (_extPath3.startsWith('/OnlineJudge/')) {
              _extUrl3 = yzoj_url.replace(/\/+$/, '') + _extPath3;
            } else {
              _extUrl3 = yzoj_url.replace(/\/+$/, '') + '/OnlineJudge' + _extPath3;
            }
          }
          vscode.env.openExternal(vscode.Uri.parse(_extUrl3));
        }
        if (msg.command == 'openContest') vscode.commands.executeCommand('yzoj.openContestDetail', { id: msg.id, url: msg.url, title: msg.title });
        if (msg.command == 'openProblem') vscode.commands.executeCommand('yzoj.openProblemDetail', { id: msg.id, url: msg.url });
        if (msg.command == 'loadSolutions') vscode.commands.executeCommand('yzoj.openSolutionList', msg.problemId);
        if (msg.command == 'loadStatus') vscode.commands.executeCommand('yzoj.showStatusList');
        if (msg.command == 'loadProblemStatus') {
          vscode.commands.executeCommand('yzoj.openProblemStatus', { problemId: msg.problemId, url: yzoj_url + '/OnlineJudge/problem_status.php?id=' + msg.problemId });
        }
        if (msg.command == 'openStatusWithFilter') {
          vscode.commands.executeCommand('yzoj.showStatusList', { problemId: msg.problemId, status: msg.status });
        }
        if (msg.command == 'openSolution') {
          vscode.commands.executeCommand('yzoj.openSolutionDetail', msg.id);
        }
        if (msg.command == 'newSolution') {
          showEditor(panel, {
            editorId: 'solution-' + msg.problemId,
            title: '撰写题解 - P' + msg.problemId,
            submitLabel: '发布题解',
            submitCommand: 'submitEditorContent',
            placeholder: '使用 Markdown 撰写题解，支持 LaTeX 公式...',
            extraData: { type: 'solution', problemId: msg.problemId, title: 'P' + msg.problemId + ' 题解' }
          }, context);
        }
        if (msg.command == 'loadDiscussions') vscode.commands.executeCommand('yzoj.openDiscussionList', msg.problemId);
        if (msg.command == 'newDiscussion') {
          showEditor(panel, {
            editorId: 'discussion-new-' + msg.problemId,
            title: '发起讨论 - P' + msg.problemId,
            submitLabel: '发布讨论',
            submitCommand: 'submitEditorContent',
            placeholder: '使用 Markdown 撰写讨论，支持 LaTeX 公式...',
            extraData: { type: 'problem_discussion', problemId: msg.problemId, title: 'P' + msg.problemId + ' 讨论' }
          }, context);
        }
        if (msg.command == 'openDiscussion') vscode.commands.executeCommand('yzoj.openDiscussionDetail', { id: msg.id, url: msg.url });
        if (msg.command == 'openDiscussionList') vscode.commands.executeCommand('yzoj.openDiscussionList', msg.problemId || msg.id);
        if (msg.command == 'openStatusDetail') vscode.commands.executeCommand('yzoj.openStatusDetail', msg.id);
        if (msg.command == 'openStatusList') vscode.commands.executeCommand('yzoj.showStatusList', msg.filters || {});
        if (msg.command == 'openProblemStatus') vscode.commands.executeCommand('yzoj.openProblemStatus', msg.problemId || msg.id);
        if (msg.command == 'openRanklist') vscode.commands.executeCommand('yzoj.showRanklist', msg.url);
        if (msg.command == 'backToProblem') {
          vscode.commands.executeCommand('yzoj.openProblemDetail', { id: msg.problemId, url: yzoj_url + '/OnlineJudge/problem_show.php?id=' + msg.problemId });
        }
        if (msg.command == 'openUserProfile') vscode.commands.executeCommand('yzoj.openUserProfile', msg.uid, msg.username);
        if (msg.command == 'requestUserCard') {
          (async () => {
            const data = await getUserCardData(msg.username, msg.uid);
            panel.webview.postMessage({ command: 'userCardData', username: msg.username, uid: msg.uid, data: data || {} });
          })();
        }
        if (msg.command == 'requestUserTags') {
          (async () => {
            const tags = await getUserTags(msg.username, msg.uid);
            panel.webview.postMessage({ command: 'userTagsData', username: msg.username, uid: msg.uid, tags: tags });
          })();
        }
      });
    } catch (err) { panel.webview.html = '<div style="text-align:center;padding:50px;color:red">' + err.message + '</div>'; }
  });

  vscode.commands.registerCommand('yzoj.submitCode', () => {
    if (!globalCookie) { vscode.window.showWarningMessage('请先登录'); return; }
    handleSubmitCode(context, yzoj_url, globalCookie);
    // 注册工作区映射路径到本地存储（submit 可能创建新映射）
    const ws = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
    if (ws) registerMapPath(context, ws.uri.fsPath);
  });

  vscode.commands.registerCommand('yzoj.openStatusDetail', async (recordId) => {
    logger.log('[FZYZOJ] yzoj.openStatusDetail executed, recordId=' + recordId);
    if (!globalCookie) { vscode.window.showWarningMessage('请先登录'); return; }
    if (!recordId) {
      recordId = await vscode.window.showInputBox({ prompt: '评测记录ID:', placeHolder: '647618', validateInput: v => /^\d+$/.test(v) ? null : '请输入数字' });
      if (!recordId) return;
    }
    const panel = panelManager.getOrCreate('status:' + recordId, 'R' + recordId, vscode.ViewColumn.Two, { enableScripts: true, retainContextWhenHidden: true });
    panel.webview.html = '<div style="text-align:center;padding:50px;color:#666">少女祈祷中...</div>';
    try {
      const html = await gethtml(yzoj_url + '/OnlineJudge/status_details.php?id=' + recordId, globalCookie);
      let sourceHtml = '';
      try { sourceHtml = await gethtml(yzoj_url + '/OnlineJudge/status_source.php?id=' + recordId + '&real=', globalCookie); } catch(_e) {}
      const detail = parseStatusDetail(html, yzoj_url, sourceHtml);
      
      panel.webview.html = getStatusDetailWebview(detail, yzoj_url);
      panel.webview.onDidReceiveMessage(msg => {
        if (msg.command == 'fetchImage') { handleFetchImage(panel, msg); return; }
        if (msg.command == 'downloadFile') { handleDownloadFile(panel, msg); return; }
        if (msg.command == 'openCodeInEditor') {
          vscode.workspace.openTextDocument({ language: 'cpp', content: msg.code }).then(doc => vscode.window.showTextDocument(doc, { preview: false }));
        }
        if (msg.command == 'refreshStatus') {
          gethtml(yzoj_url + '/OnlineJudge/status_details.php?id=' + recordId, globalCookie).then(h => {
            panel.webview.html = getStatusDetailWebview(parseStatusDetail(h, yzoj_url), yzoj_url);
          });
        }
        if (msg.command == 'openUserProfile') vscode.commands.executeCommand('yzoj.openUserProfile', msg.uid, msg.username);
        if (msg.command == 'requestUserCard') {
          (async () => {
            const uData = await getUserCardData(msg.username, msg.uid);
            panel.webview.postMessage({ command: 'userCardData', username: msg.username, uid: msg.uid, data: uData || {} });
          })();
        }
        if (msg.command == 'requestUserTags') {
          (async () => {
            const tags = await getUserTags(msg.username, msg.uid);
            panel.webview.postMessage({ command: 'userTagsData', username: msg.username, uid: msg.uid, tags: tags });
          })();
        }
      });
    } catch (err) { panel.webview.html = '<div style="text-align:center;padding:50px;color:red">' + err.message + '</div>'; }
  });

  vscode.commands.registerCommand('yzoj.showStatusList', (params) => {
    if (!globalCookie) { vscode.window.showWarningMessage('请先登录'); return; }
    // params 可以包含 problemId, username, status, test(比赛编号), contestId 等筛选条件
    const initialFilters = params || {};
    // 🔑 规范化初始 filters：支持 contestId/tid → test(YZOJ status.php 参数名) 的别名
    const normalizedInitial = Object.assign({}, initialFilters);
    if ((!normalizedInitial.test) && (initialFilters.contestId || initialFilters.tid)) {
      normalizedInitial.test = initialFilters.contestId || initialFilters.tid;
    }
    if ((!normalizedInitial.pid) && initialFilters.problemId) {
      normalizedInitial.pid = initialFilters.problemId;
    }
    if ((!normalizedInitial.uname) && initialFilters.username) {
      normalizedInitial.uname = initialFilters.username;
    }
    const panel = panelManager.getOrCreate('status:list', '评测记录', vscode.ViewColumn.Two, { enableScripts: true, retainContextWhenHidden: true });
    // 🔑 持久保存基础 filters（含比赛编号），所有刷新/换页/筛选都要合并它
    panel._statusBaseFilters = Object.assign({}, panel._statusBaseFilters || {}, normalizedInitial);
    panel._statusCurrentPage = 1;
    loadStatusList(panel, 1, yzoj_url, globalCookie, panel._statusBaseFilters);
    var autoRefreshTimer = null;
    function startAutoRefresh() {
      if (autoRefreshTimer) return;
      autoRefreshTimer = setInterval(function() {
        // 🔑 5s 自动刷新：严格使用 panel._statusBaseFilters + 上次用户操作的 filters
        loadStatusList(panel, panel._statusCurrentPage || 1, yzoj_url, globalCookie, panel._statusBaseFilters, true);
      }, 5000);
    }
    panel.onDidDispose(function() {
      if (autoRefreshTimer) { clearInterval(autoRefreshTimer); autoRefreshTimer = null; }
    });
    panel.webview.onDidReceiveMessage(msg => {
      if (msg.command == 'changeStatusPage') {
        panel._statusCurrentPage = msg.p;
        panel._statusKnownIds = null;
        // 🔑 更新用户最近一次输入的 filters（合并到 base，保留比赛编号）
        if (msg.filters && typeof msg.filters === 'object') {
          panel._statusBaseFilters = Object.assign({}, panel._statusBaseFilters || {}, msg.filters);
        }
        loadStatusList(panel, msg.p, yzoj_url, globalCookie, panel._statusBaseFilters);
      }
      if (msg.command == 'statusFilter') {
        panel._statusKnownIds = null;
        panel._statusCurrentPage = 1;
        // 🔑 用户筛选：合并用户输入到 base（保留 test=比赛编号）
        if (msg.filters && typeof msg.filters === 'object') {
          panel._statusBaseFilters = Object.assign({}, panel._statusBaseFilters || {}, msg.filters);
        }
        loadStatusList(panel, 1, yzoj_url, globalCookie, panel._statusBaseFilters);
      }
      if (msg.command == 'refreshStatusList') {
        // 🔑 用户手动刷新：同样合并 baseFilters，确保 test=比赛编号不丢
        if (msg.filters && typeof msg.filters === 'object') {
          panel._statusBaseFilters = Object.assign({}, panel._statusBaseFilters || {}, msg.filters);
        }
        // 刷新前先预处理 tag：将上次已知的用户 tag 预填入缓存，确保刷新后 tag 立即显示
        if (panel._statusTagMap) {
          Object.keys(panel._statusTagMap).forEach(function(key) {
            _tagCache[key] = panel._statusTagMap[key];
          });
        }
        loadStatusList(panel, panel._statusCurrentPage || 1, yzoj_url, globalCookie, panel._statusBaseFilters, true);
      }
      if (msg.command == 'openStatusDetail') vscode.commands.executeCommand('yzoj.openStatusDetail', msg.id);
      if (msg.command == 'initAutoRefresh') startAutoRefresh();
      if (msg.command == 'openUserProfile') vscode.commands.executeCommand('yzoj.openUserProfile', msg.uid, msg.username);
      if (msg.command == 'requestUserCard') {
        (async () => {
          const data = await getUserCardData(msg.username, msg.uid);
          panel.webview.postMessage({ command: 'userCardData', username: msg.username, uid: msg.uid, data: data || {} });
        })();
      }
      if (msg.command == 'requestUserTags') {
        (async () => {
          const tags = await getUserTags(msg.username, msg.uid);
          panel.webview.postMessage({ command: 'userTagsData', username: msg.username, uid: msg.uid, tags: tags });
        })();
      }
    });
  });

  vscode.commands.registerCommand('yzoj.showProblemList', async () => {
    const panel = panelManager.getOrCreate('problem:list', '在线题库', vscode.ViewColumn.Two, { enableScripts: true, retainContextWhenHidden: true });
    // Tags + problem list both fetched from YZOJ directly via doSearch
    await doSearch({ sort_by: 'id', sort_order: 'asc', page: 1 }, [], yzoj_url);
    await renderProblemList(panel, yzoj_url);
    panel.webview.onDidReceiveMessage(async (msg) => {
      if (msg.command == 'fetchImage') { handleFetchImage(panel, msg); return; }
      if (msg.command == 'downloadFile') { handleDownloadFile(panel, msg); return; }
      if (msg.command == 'search') {
        await doSearch(msg.opts, msg.selectedTags || [], yzoj_url);
        await renderProblemList(panel, yzoj_url);
      }
      if (msg.command == 'changePage') {
        if (msg.opts) Object.assign(searchState.opts, msg.opts);
        searchState.opts.page = msg.p;
        await doSearch(searchState.opts, msg.selectedTags || searchState.selectedTags, yzoj_url);
        await renderProblemList(panel, yzoj_url);
      }
      if (msg.command == 'randomProblem') {
        try {
          // 从全 YZOJ 题库随机跳题：先获取总页数，再随机选一页，最后随机选一道题
          const firstPage = await _fetchProblemListPage(yzoj_url, globalCookie, null, 1, 'id', 'asc');
          const totalPages = firstPage.totalPages || 1;
          const randomPage = Math.floor(Math.random() * totalPages) + 1;
          const pageData = await _fetchProblemListPage(yzoj_url, globalCookie, null, randomPage, 'id', 'asc');
          const probList = pageData.problems || [];
          if (probList.length > 0) {
            const ridx = Math.floor(Math.random() * probList.length);
            const rid = probList[ridx].id;
            const rurl = probList[ridx].url || (yzoj_url + '/OnlineJudge/problem_show.php?id=' + rid);
            vscode.commands.executeCommand('yzoj.openProblemDetail', { id: rid, url: rurl });
          } else {
            vscode.window.showWarningMessage('随机跳题失败：未找到题目');
          }
        } catch (e) {
          vscode.window.showWarningMessage('随机跳题出错：' + e.message);
        }
      }
      if (msg.command == 'openProblem') vscode.commands.executeCommand('yzoj.openProblemDetail', { id: msg.id, url: msg.url });
      if (msg.command == 'openUserProfile') vscode.commands.executeCommand('yzoj.openUserProfile', msg.uid, msg.username);
      if (msg.command == 'requestUserCard') {
        (async () => {
          const data = await getUserCardData(msg.username, msg.uid);
          panel.webview.postMessage({ command: 'userCardData', username: msg.username, uid: msg.uid, data: data || {} });
        })();
      }
      if (msg.command == 'requestUserTags') {
        (async () => {
          const tags = await getUserTags(msg.username, msg.uid);
          panel.webview.postMessage({ command: 'userTagsData', username: msg.username, uid: msg.uid, tags: tags });
        })();
      }
    });
  });

  vscode.commands.registerCommand('yzoj.showHomepage', () => {
    if (!globalCookie) { vscode.window.showWarningMessage('请先登录'); return; }
    const panel = panelManager.getOrCreate('homepage', 'YZOJ 首页', vscode.ViewColumn.Two, { enableScripts: true, retainContextWhenHidden: true });
    loadHomepage(panel, yzoj_url, globalCookie);
  });

  vscode.commands.registerCommand('yzoj.openProblemStatus', async (data) => {
    if (!globalCookie) { vscode.window.showWarningMessage('请先登录'); return; }
    var pid = '';
    var url = '';
    if (data && typeof data === 'object') {
      pid = data.problemId || '';
      url = data.url || '';
    }
    if (!pid && !url) {
      var _in = await vscode.window.showInputBox({ prompt: '请输入题目 ID', placeHolder: '例如: 1001 或 P1001', ignoreFocusOut: true });
      if (!_in) return;
      pid = String(_in).trim().replace(/^[Pp\s#]+/, '');
    }
    if (!url) url = yzoj_url + '/OnlineJudge/problem_status.php?id=' + pid;
    const panel = panelManager.getOrCreate('problem-status:' + pid, (pid ? 'P' + pid : '题目') + ' 状态', vscode.ViewColumn.Two, { enableScripts: true, retainContextWhenHidden: true });
    if (pid) {
      await loadProblemStatusPage(panel, url, yzoj_url);
    } else {
      try {
        const html = await gethtml(url, globalCookie);
        const result = parseStatusPage(html, yzoj_url);
        
        panel.webview.html = getContestStatusWebview(result, yzoj_url);
      } catch (err) { panel.webview.html = '<div style="text-align:center;padding:50px;color:red">' + err.message + '</div>'; }
    }
    panel.webview.onDidReceiveMessage(msg => {
      if (msg.command == 'fetchImage') { handleFetchImage(panel, msg); return; }
      if (msg.command == 'downloadFile') { handleDownloadFile(panel, msg); return; }
      if (msg.command == 'openStatusDetail') vscode.commands.executeCommand('yzoj.openStatusDetail', msg.id);
      if (msg.command == 'changeStatusPage') {
        vscode.commands.executeCommand('yzoj.showStatusList', msg.filters || {});
      }
      if (msg.command == 'statusFilter') {
        vscode.commands.executeCommand('yzoj.showStatusList', msg.filters || {});
      }
      if (msg.command == 'openUserProfile') vscode.commands.executeCommand('yzoj.openUserProfile', msg.uid, msg.username);
      if (msg.command == 'requestUserCard') {
        (async () => {
          const uData = await getUserCardData(msg.username, msg.uid);
          panel.webview.postMessage({ command: 'userCardData', username: msg.username, uid: msg.uid, data: uData || {} });
        })();
      }
      if (msg.command == 'requestUserTags') {
        (async () => {
          const tags = await getUserTags(msg.username, msg.uid);
          panel.webview.postMessage({ command: 'userTagsData', username: msg.username, uid: msg.uid, tags: tags });
        })();
      }
    });
  });

  vscode.commands.registerCommand('yzoj.openUserProfile', async (uid, username) => {
    if (!globalCookie) { vscode.window.showWarningMessage('请先登录'); return; }
    
    if (!uid && !username) {
      const choice = await vscode.window.showQuickPick([
        { label: '按 UID 查看', description: '使用数字用户 ID 查询 (user_show.php?id=)' },
        { label: '按用户名查询', description: '使用 YZOJ 原生用户名搜索 (user_show.php?uname=)' }
      ], { placeHolder: '请选择查询方式', ignoreFocusOut: true });
      if (!choice) return;
      if (choice.label.startsWith('按 UID')) {
        const _uid = await vscode.window.showInputBox({
          prompt: '请输入用户 UID',
          placeHolder: '例如: 2953',
          ignoreFocusOut: true
        });
        if (!_uid) return;
        uid = String(_uid).trim();
      } else {
        const _uname = await vscode.window.showInputBox({
          prompt: '请输入用户名 (YZOJ 原生搜索)',
          placeHolder: '例如: xuanxuanmeow',
          ignoreFocusOut: true
        });
        if (!_uname) return;
        username = String(_uname).trim();
      }
    }
    
    const panel = panelManager.getOrCreate('user:' + (uid || username), username || ('User #' + uid), vscode.ViewColumn.Two, { enableScripts: true, retainContextWhenHidden: true });
    panel.webview.html = '<div style="text-align:center;padding:50px;color:#666">少女祈祷中...<br><small>正在从 YZOJ 爬取个人主页数据，请稍候...</small></div>';
    try {
      if (!uid && username) {
        try {
          const searchRes = await proxyFetch('/api/users/search?keyword=' + encodeURIComponent(username) + '&page_size=5');
          if (searchRes && searchRes.users && searchRes.users.length > 0) {
            uid = searchRes.users[0].id;
            if (!username && searchRes.users[0].username) username = searchRes.users[0].username;
          }
        } catch(_e) {}
      }
      
      let userData = null;
      
      // Use ojserver /api/user/profile/full API: fetches user info + native YZOJ Morris.Area activity chart data
      try {
        const params = new URLSearchParams();
        if (uid) params.set('uid', uid);
        else if (username) params.set('username', username);
        params.set('months', '6');
        // Reasonable timeout since we no longer crawl first-AC pages
        const fetch = require('node-fetch');
        const headers = { 'Content-Type': 'application/json' };
        if (globalCookie) {
          headers['X-YZOJ-Cookie'] = globalCookie;
        }
        const resp = await fetch(getProxyUrl() + '/api/user/profile/full?' + params.toString(), {
          timeout: 60000,
          headers: headers
        });
        if (resp.ok) {
          const fullProfile = await resp.json();
          if (fullProfile && (fullProfile.username || fullProfile.uid || fullProfile.id)) {
            userData = fullProfile;
          }
        }
      } catch(_e) {
        logger.log('[openUserProfile] /api/user/profile/full error: ' + _e.message);
      }
      
      // If userData was obtained from ojserver without userHtml, fetch YZOJ page for userHtml
      if (userData && !userData.userHtml) {
        try {
          let yzojHtml = '';
          if (uid) {
            yzojHtml = await gethtml(yzoj_url + '/OnlineJudge/user_show.php?id=' + uid, globalCookie);
          } else if (username) {
            yzojHtml = await gethtml(yzoj_url + '/OnlineJudge/user_show.php?uname=' + encodeURIComponent(username), globalCookie);
          }
          if (yzojHtml) {
            const yzojData = parseUserPage(yzojHtml, yzoj_url);
            if (yzojData && yzojData.userHtml) {
              userData.userHtml = yzojData.userHtml;
            }
          }
        } catch(_e) {
          logger.log('[openUserProfile] userHtml fetch error: ' + _e.message);
        }
      }
      
      // Fallback: if ojserver full profile failed, fall back to old method (direct YZOJ fetch + parse)
      if (!userData) {
        logger.log('[openUserProfile] Falling back to direct YZOJ fetch');
        let ojsData = null;
        try {
          const params = new URLSearchParams();
          if (uid) params.set('uid', uid);
          else if (username) params.set('username', username);
          const cardData = await proxyFetch('/api/user/profile/card?' + params.toString());
          if (cardData && cardData.username) {
            ojsData = cardData;
          }
        } catch(_e) {}
        
        let html = '';
        if (uid) {
          html = await gethtml(yzoj_url + '/OnlineJudge/user_show.php?id=' + uid, globalCookie);
          userData = parseUserPage(html, yzoj_url);
        } else if (username) {
          html = await gethtml(yzoj_url + '/OnlineJudge/user_show.php?uname=' + encodeURIComponent(username), globalCookie);
          userData = parseUserPage(html, yzoj_url);
        }
        
        if (ojsData && userData) {
          // 仅当 OJS 存在该用户（exists_in_ojs=true）时才合并 OJS 自定义数据（头像、头图、签名、简介、tags 等）
          // 否则只保留 YZOJ 原生解析数据（不写入本地，不显示 OJS 自定义字段）
          const userExistsInOJS = !!(ojsData && ojsData.exists_in_ojs);
          // Priority: use ojserver's username if it's not a pure numeric UID
          if (userExistsInOJS && ojsData.username && !/^\d+$/.test(String(ojsData.username).trim())) {
            userData.username = ojsData.username;
          }
          if (userExistsInOJS) {
            if (ojsData.avatar_url) userData.avatar_url = ojsData.avatar_url;
            if (ojsData.avatarUrl && !userData.avatar_url) userData.avatar_url = ojsData.avatarUrl;
            if (ojsData.header_image_url) userData.header_image_url = ojsData.header_image_url;
            if (ojsData.signature) userData.signature = ojsData.signature;
            if (ojsData.bio) userData.bio = ojsData.bio;
            if (ojsData.bio_html) userData.bio_html = ojsData.bio_html;
            // 始终从 raw bio 生成 bio_html，避免 YZOJ 页面 &gt; 转义破坏 LaTeX（如 $1 > 2$ 变成 $1 &gt; 2$）
            if (userData.bio) {
              userData.bio_html = mdLatexToHtml(userData.bio);
            }
            if (ojsData.tags) userData.tags = ojsData.tags;
          }
          // 以下字段即使不存在于 OJS 也可能有原生解析值，OJS 仅覆盖 YZOJ 没返回的字段
          if (ojsData.realName && !userData.realName) userData.realName = ojsData.realName;
          if (ojsData.nickname && !userData.nickname) userData.nickname = ojsData.nickname;
          if (ojsData.school && !userData.school) userData.school = ojsData.school;
          if (ojsData.email && !userData.email) userData.email = ojsData.email;
        }
      }
      
      if (userData) {
        const displayName = userData.username || username || ('User #' + (uid || userData.uid || userData.id || ''));
        try {
          if (panel && typeof panel.setTitle === 'function') {
            panel.setTitle(displayName);
          }
        } catch(_e) {}
        panel.webview.html = getUserWebview(userData, yzoj_url);
        panel.webview.onDidReceiveMessage(msg => {
          if (msg.command == 'fetchImage') { handleFetchImage(panel, msg); return; }
          if (msg.command == 'downloadFile') { handleDownloadFile(panel, msg); return; }
          if (msg.command == 'openStatusDetail') vscode.commands.executeCommand('yzoj.openStatusDetail', msg.id);
          if (msg.command == 'openProblem') vscode.commands.executeCommand('yzoj.openProblemDetail', { id: msg.id, url: msg.url });
          if (msg.command == 'openUserProfile') vscode.commands.executeCommand('yzoj.openUserProfile', msg.uid, msg.username);
          if (msg.command == 'requestUserCard') {
            (async () => {
              const data = await getUserCardData(msg.username, msg.uid);
              panel.webview.postMessage({ command: 'userCardData', username: msg.username, uid: msg.uid, data: data || {} });
            })();
          }
          if (msg.command == 'requestUserTags') {
            (async () => {
              const tags = await getUserTags(msg.username, msg.uid);
              panel.webview.postMessage({ command: 'userTagsData', username: msg.username, uid: msg.uid, tags: tags });
            })();
          }
        });
      } else {
        panel.webview.html = '<div style="text-align:center;padding:50px;color:#d93025">无法获取用户信息，请检查用户ID或用户名是否正确。</div>';
      }
    } catch (err) {
      logger.log('[openUserProfile] Fatal error: ' + err.stack);
      panel.webview.html = '<div style="text-align:center;padding:50px;color:red">加载失败：' + esc(err.message) + '</div>';
    }
  });

  vscode.commands.registerCommand('yzoj.showUserSearch', () => {
    if (!globalCookie) { vscode.window.showWarningMessage('请先登录'); return; }
    const panel = panelManager.getOrCreate('userSearch', '用户搜索', vscode.ViewColumn.Two, { enableScripts: true, retainContextWhenHidden: true });
    panel.webview.html = getUserSearchWebview('', [], yzoj_url);
    panel.webview.onDidReceiveMessage(msg => {
      if (msg.command == 'search') {
        (async function(){
          try {
            var res = await proxyFetch('/api/users/search?keyword=' + encodeURIComponent(msg.keyword) + '&page_size=20');
            var users = (res && res.users) || [];
            panel.webview.html = getUserSearchWebview(msg.keyword, users, yzoj_url);
          } catch(e) {
            panel.webview.html = getUserSearchWebview(msg.keyword, [], yzoj_url);
          }
        })();
      }
      if (msg.command == 'autocomplete') {
        (async function(){
          try {
            var res = await proxyFetch('/api/users/search?keyword=' + encodeURIComponent(msg.keyword) + '&page_size=5');
            var users = (res && res.users) || [];
            panel.webview.postMessage({ command: 'userSearchAutocomplete', keyword: msg.keyword, results: users });
          } catch(e) {}
        })();
      }
    });
  });

  vscode.commands.registerCommand('yzoj.openSolutionDetail', async (solutionId) => {
    if (!globalCookie) { vscode.window.showWarningMessage('请先登录'); return; }
    var sid = solutionId || '';
    if (typeof sid === 'object' && sid !== null) sid = sid.id || sid.solutionId || '';
    sid = String(sid || '').trim();
    if (!sid) {
      var _in = await vscode.window.showInputBox({ prompt: '请输入题解 ID', placeHolder: '例如: 1234', ignoreFocusOut: true });
      if (!_in) return;
      sid = String(_in).trim();
    }
    const panel = panelManager.getOrCreate('solution:' + sid, '题解', vscode.ViewColumn.Two, { enableScripts: true, retainContextWhenHidden: true });
    panel.webview.html = '<div style="text-align:center;padding:50px;color:#666">少女祈祷中...</div>';
    try {
      const html = await gethtml(yzoj_url + '/OnlineJudge/problem_solve.php?id=' + sid + '&ignore=yes', globalCookie);
      const data = parseSolutionDetail(html, yzoj_url);
      data.id = sid;
      
      if (data.author) {
        const userData = await getUserCardData(data.author, data.authorId);
        if (userData) {
          data.solvedCount = userData.solvedCount;
        }
      }
      
      panel.webview.html = getSolutionDetailWebview(data, yzoj_url);
    } catch (err) {
      panel.webview.html = '<div style="text-align:center;padding:50px;color:red">' + err.message + '</div>';
    }
    panel.webview.onDidReceiveMessage(msg => {
      if (msg.command == 'fetchImage') { handleFetchImage(panel, msg); return; }
      if (msg.command == 'downloadFile') { handleDownloadFile(panel, msg); return; }
      if (msg.command == 'backToProblem') {
        vscode.commands.executeCommand('yzoj.openProblemDetail', { id: msg.problemId, url: yzoj_url + '/OnlineJudge/problem_show.php?id=' + msg.problemId });
      }
      if (msg.command == 'editSolution') {
        showEditor(panel, {
          editorId: 'solution-edit-' + msg.id,
          title: '编辑题解',
          submitLabel: '更新题解',
          submitCommand: 'submitEditorContent',
          placeholder: '',
          initialContent: htmlToMdLatex(msg.contentHtml || msg.content || ''),
          extraData: { type: 'solution', problemId: data.problem_id || '', title: '题解', id: msg.id, edit: true }
        }, context);
      }
      if (msg.command == 'openUserProfile') vscode.commands.executeCommand('yzoj.openUserProfile', msg.uid, msg.username);
      if (msg.command == 'requestUserCard') {
        (async () => {
          const data = await getUserCardData(msg.username, msg.uid);
          panel.webview.postMessage({ command: 'userCardData', username: msg.username, uid: msg.uid, data: data || {} });
        })();
      }
      if (msg.command == 'requestUserTags') {
        (async () => {
          const tags = await getUserTags(msg.username, msg.uid);
          panel.webview.postMessage({ command: 'userTagsData', username: msg.username, uid: msg.uid, tags: tags });
        })();
      }
    });
  });

  vscode.commands.registerCommand('yzoj.openDiscussionDetail', async (discussionId) => {
    if (!globalCookie) { vscode.window.showWarningMessage('请先登录'); return; }
    let baseUrl = yzoj_url;
    var realId = (typeof discussionId === 'object' && discussionId !== null) ? (discussionId.id || discussionId.discussionId || '') : String(discussionId || '');
    // 从 url 中提取 baseUrl（支持跨域讨论链接）
    if (typeof discussionId === 'object' && discussionId !== null && discussionId.url) {
      var match = String(discussionId.url).match(/^(https?:\/\/[^\/]+)/);
      if (match) baseUrl = match[1];
    }
    realId = String(realId || '').trim();
    if (!realId) {
      var _in = await vscode.window.showInputBox({ prompt: '请输入讨论 ID', placeHolder: '例如: 1234', ignoreFocusOut: true });
      if (!_in) return;
      realId = String(_in).trim();
    }
    const panel = panelManager.getOrCreate('discussion:' + realId, '讨论', vscode.ViewColumn.Two, { enableScripts: true, retainContextWhenHidden: true });
    loadDiscussionDetail(panel, realId, baseUrl);
  });

  vscode.commands.registerCommand('yzoj.openSolutionList', async (problemId) => {
    if (!globalCookie) { vscode.window.showWarningMessage('请先登录'); return; }
    var pid = (typeof problemId === 'object' && problemId !== null) ? (problemId.problemId || problemId.id || '') : String(problemId || '');
    pid = String(pid || '').trim();
    if (!pid) return;
    const panel = panelManager.getOrCreate('solutions:' + pid, '题解 - P' + pid, vscode.ViewColumn.Two, { enableScripts: true, retainContextWhenHidden: true });
    loadSolutions(panel, pid, yzoj_url);
  });

  vscode.commands.registerCommand('yzoj.openDiscussionList', async (problemId) => {
    if (!globalCookie) { vscode.window.showWarningMessage('请先登录'); return; }
    var pid = (typeof problemId === 'object' && problemId !== null) ? (problemId.problemId || problemId.id || '') : String(problemId || '');
    pid = String(pid || '').trim();
    if (!pid) return;
    const panel = panelManager.getOrCreate('discussions:' + pid, '讨论 - P' + pid, vscode.ViewColumn.Two, { enableScripts: true, retainContextWhenHidden: true });
    loadDiscussions(panel, pid, yzoj_url);
  });

  vscode.commands.registerCommand('yzoj.showDiscussionList', () => {
    if (!globalCookie) { vscode.window.showWarningMessage('请先登录'); return; }
    const panel = panelManager.getOrCreate('discussion:list', '讨论区', vscode.ViewColumn.Two, { enableScripts: true, retainContextWhenHidden: true });
    loadDiscussionList(panel, 1, yzoj_url, {});
  });

  vscode.commands.registerCommand('yzoj.deleteDiscussionPost', async (data) => {
    if (!globalCookie) { vscode.window.showWarningMessage('请先登录'); return; }
    var delUrl = data && data.delUrl;
    if (!delUrl) { vscode.window.showErrorMessage('参数错误'); return; }
    // 如果 delUrl 是相对路径，拼成绝对 URL
    if (!/^https?:\/\//i.test(delUrl)) {
      var base = yzoj_url.replace(/\/+$/,'');
      var path = delUrl.replace(/^\/+/, '');
      // 如果路径不含 OnlineJudge 目录，且 base 中也没有，则补上
      if (!path.startsWith('OnlineJudge/') && !base.endsWith('/OnlineJudge')) {
        path = 'OnlineJudge/' + path;
      }
      delUrl = base + '/' + path;
      // 去除可能的重复斜杠
      delUrl = delUrl.replace(/([^:])\/+/g, '$1/');
    }
    try {
      var res = await fetch(delUrl, {
        method: 'GET',
        headers: { 'Cookie': globalCookie, 'Referer': yzoj_url + '/OnlineJudge/discuss_discuss.php' }
      });
      var text = await res.text();
      // YZOJ 删除成功后通常返回重定向或成功提示，检查 text 是否不含错误信息
      if (text.indexOf('success') >= 0 || text.indexOf('删除成功') >= 0 || text.indexOf('已删除') >= 0 || res.status === 200) {
        vscode.window.showInformationMessage('已删除');
        // 从 delUrl 中提取 did
        var didMatch = delUrl.match(/[?&]did=(\d+)/);
        var did = didMatch ? didMatch[1] : '';
        // 延迟 4 秒再刷新，确保服务器处理完成
        setTimeout(function() {
          if (did) vscode.commands.executeCommand('yzoj.openDiscussionDetail', { id: did });
        }, 4000);
      } else {
        vscode.window.showErrorMessage('删除失败');
      }
    } catch (e) {
      vscode.window.showErrorMessage('网络错误: ' + e.message);
    }
  });

  // ---- Ranklist Command ----
  const showRanklistCmd = vscode.commands.registerCommand('yzoj.showRanklist', async () => {
    if (!globalCookie) { vscode.window.showWarningMessage('请先登录'); return; }
    const panel = panelManager.getOrCreate('ranklist:main', '选手排名', vscode.ViewColumn.Two, { enableScripts: true, retainContextWhenHidden: true });
    async function loadRanklist(panel, page, baseUrl) {
      panel.webview.html = '<div style="text-align:center;padding:50px;color:#666">少女祈祷中...</div>';
      try {
        const html = await gethtml(baseUrl + '/OnlineJudge/ranklist.php?page=' + page, globalCookie);
        const data = parseRanklist(html, baseUrl, page);
        // 预加载所有用户的 tags
        var allUids = [];
        (data.records||[]).forEach(function(r) { if (r.userId) allUids.push(String(r.userId)); });
        var tagsMap = await preloadUserTags(allUids);
        (data.records||[]).forEach(function(r) {
          if (r.userId && tagsMap[r.userId]) {
            r.tags = tagsMap[r.userId];
          }
        });
        panel.webview.html = getRanklistWebview(data, baseUrl);
      } catch (err) { panel.webview.html = '<div style="text-align:center;padding:50px;color:red">' + err.message + '</div>'; }
    }
    loadRanklist(panel, 1, yzoj_url);
    panel.webview.onDidReceiveMessage(msg => {
      if (msg.command == 'fetchImage') { handleFetchImage(panel, msg); return; }
      if (msg.command == 'downloadFile') { handleDownloadFile(panel, msg); return; }
      if (msg.command == 'changePage') loadRanklist(panel, msg.p, yzoj_url);
      if (msg.command == 'openUserProfile') vscode.commands.executeCommand('yzoj.openUserProfile', msg.uid, msg.username);
      if (msg.command == 'requestUserCard') {
        (async () => {
          const data = await getUserCardData(msg.username, msg.uid);
          panel.webview.postMessage({ command: 'userCardData', username: msg.username, uid: msg.uid, data: data || {} });
        })();
      }
      if (msg.command == 'requestUserTags') {
        (async () => {
          const tags = await getUserTags(msg.username, msg.uid);
          panel.webview.postMessage({ command: 'userTagsData', username: msg.username, uid: msg.uid, tags: tags });
        })();
      }
    });
  });

  // Dispose old contest result command and register new one with click handling
  if (openContestResultCmd) {
    openContestResultCmd.dispose();
    context.subscriptions = context.subscriptions.filter(s => s !== openContestResultCmd);
  }

  const openContestResultCmd_new = vscode.commands.registerCommand('yzoj.openContestResult', async (data) => {
    if (!globalCookie) { vscode.window.showWarningMessage('请先登录'); return; }
    var contestId = '';
    var url = '';
    if (data && typeof data === 'object') {
      contestId = data.contestId || '';
      url = data.url || '';
    }
    if (!contestId && !url) {
      var _in = await vscode.window.showInputBox({ prompt: '请输入比赛 ID', placeHolder: '例如: 1001', ignoreFocusOut: true });
      if (!_in) return;
      contestId = _in.trim();
    }
    if (!url) url = yzoj_url + '/OnlineJudge/contest_result.php?id=' + contestId;
    const panel = panelManager.getOrCreate('contest:result:' + contestId, '比赛结果', vscode.ViewColumn.Two, { enableScripts: true, retainContextWhenHidden: true });
    panel.webview.html = '<div style="text-align:center;padding:50px;color:#666">少女祈祷中...</div>';
    try {
      const html = await gethtml(url, globalCookie);
      const result = parseContestResult(html, yzoj_url);
      
      // 预加载所有用户的 tags
      var allUids = [];
      (result.records||[]).forEach(function(r) { if (r.userId) allUids.push(String(r.userId)); });
      var tagsMap = await preloadUserTags(allUids);
      (result.records||[]).forEach(function(r) {
        if (r.userId && tagsMap[r.userId]) {
          r.tags = tagsMap[r.userId];
        }
      });
      
      panel.webview.html = getContestResultWebview(result, yzoj_url);
      panel.webview.onDidReceiveMessage(msg => {
        if (msg.command == 'fetchImage') { handleFetchImage(panel, msg); return; }
        if (msg.command == 'downloadFile') { handleDownloadFile(panel, msg); return; }
        if (msg.command == 'openProblem') vscode.commands.executeCommand('yzoj.openProblemDetail', { id: msg.id, url: msg.url || (yzoj_url + '/OnlineJudge/problem_show.php?id=' + msg.id) });
        if (msg.command == 'openStatusDetail') vscode.commands.executeCommand('yzoj.openStatusDetail', msg.id);
        if (msg.command == 'openUserProfile') vscode.commands.executeCommand('yzoj.openUserProfile', msg.uid, msg.username);
        if (msg.command == 'requestUserCard') {
          (async () => {
            const uData = await getUserCardData(msg.username, msg.uid);
            panel.webview.postMessage({ command: 'userCardData', username: msg.username, uid: msg.uid, data: uData || {} });
          })();
        }
        if (msg.command == 'requestUserTags') {
          (async () => {
            const tags = await getUserTags(msg.username, msg.uid);
            panel.webview.postMessage({ command: 'userTagsData', username: msg.username, uid: msg.uid, tags: tags });
          })();
        }
      });
    } catch (err) { panel.webview.html = '<div style="text-align:center;padding:50px;color:red">' + err.message + '</div>'; }
  });

  context.subscriptions.push(showRanklistCmd, openContestResultCmd_new);

  // 注册当前工作区映射路径到本地存储追踪
  const wsRoot = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
  if (wsRoot) registerMapPath(context, wsRoot.uri.fsPath);

  // 🔄 启动 1 分钟定时器：周期性检测所有已追踪的映射文件
  // （清理失效条目 + 更新比赛状态 + 转换已结束比赛）
  const MAP_CHECK_INTERVAL = 60000; // 1 分钟
  const mapCheckTimer = setInterval(() => {
    periodicCheckAllMaps(context, yzoj_url, globalCookie).catch(err => {
      logger.log('[mapCheckTimer] error:', err.message);
    });
  }, MAP_CHECK_INTERVAL);

  // 首次运行：延迟 15 秒执行（给登录留时间，globalCookie 可能此时才就绪）
  setTimeout(() => {
    periodicCheckAllMaps(context, yzoj_url, globalCookie).catch(err => {
      logger.log('[mapCheckTimer:first] error:', err.message);
    });
  }, 15000);

  // 插件停用时清理定时器
  context.subscriptions.push({ dispose: () => clearInterval(mapCheckTimer) });

  // ===== YZOJ 命令树视图 =====
  const yzojCommandProvider = new YZOJCommandTreeProvider();
  vscode.window.registerTreeDataProvider('yzojCommands', yzojCommandProvider);
  context.subscriptions.push(yzojCommandProvider);
}

// ===== YZOJ 命令树视图数据提供器 =====
class YZOJCommandTreeProvider {
  constructor() {
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    this.items = [
      { cmd: 'yzoj.login',         label: '登录' },
      { cmd: 'yzoj.showHomepage',  label: '首页' },
      { cmd: 'yzoj.showActiveContests',   label: '显示进行中的比赛' },
      { cmd: 'yzoj.showScheduledContests', label: '显示计划中的比赛' },
      { cmd: 'yzoj.showPastContests',     label: '显示过去的比赛' },
      { cmd: 'yzoj.openContestDetail',    label: '显示比赛详情' },
      { cmd: 'yzoj.openContestResult',    label: '比赛结果' },
      { cmd: 'yzoj.openContestStatus',    label: '比赛评测状态' },
      { cmd: 'yzoj.showProblemList',      label: '显示题目列表' },
      { cmd: 'yzoj.openProblemDetail',    label: '显示题目详情' },
      { cmd: 'yzoj.openProblemStatus',    label: '查看题目状态' },
      { cmd: 'yzoj.showStatusList',       label: '显示评测列表' },
      { cmd: 'yzoj.openStatusDetail',     label: '显示评测记录' },
      { cmd: 'yzoj.submitCode',           label: '递交代码' },
      { cmd: 'yzoj.showDiscussionList',   label: '讨论区' },
      { cmd: 'yzoj.openDiscussionDetail', label: '查看讨论' },
      { cmd: 'yzoj.showProblemSetList',   label: '显示题单列表' },
      { cmd: 'yzoj.openProblemSetDetail', label: '查看题单详情' },
      { cmd: 'yzoj.showRanklist',         label: '选手排名' },
      { cmd: 'yzoj.openUserProfile',      label: '查看个人主页' },
    ];
  }
  getTreeItem(element) { return element; }
  getChildren(element) {
    if (element) return [];
    var self = this;
    return self.items.map(function(i) {
      var item = new vscode.TreeItem(i.label, vscode.TreeItemCollapsibleState.None);
      item.command = { command: i.cmd, title: i.label, arguments: [] };
      item.iconPath = new vscode.ThemeIcon('play');
      return item;
    });
  }
  refresh() { this._onDidChangeTreeData.fire(); }
}

var context = null;
function deactivate() { globalCookie = null; usernamep = null; }
module.exports = { activate, deactivate };
