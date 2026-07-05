/* eslint-disable no-console */
// ojclient.js - 网络请求核心模块 (优化版: keep-alive + 缓存 + 并发控制)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // ⚠️ 仅用于自签名证书测试环境

const vscode = require('vscode');
const cheerio = require('cheerio');
const fetch = require('node-fetch');
const { AbortSignal } = require('node-abort-controller');
const iconv = require('iconv-lite');
const http = require('http');
const https = require('https');
const logger = require('./logger');

// ==================== 连接复用 ====================
// 创建 keep-alive agent，避免每次请求都新建 TCP 连接
var _httpAgent = new http.Agent({ keepAlive: true, maxSockets: 10, keepAliveMsecs: 30000 });
var _httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 10, keepAliveMsecs: 30000, rejectUnauthorized: false });

function _getAgent(url) {
  return url.startsWith('https') ? _httpsAgent : _httpAgent;
}

// ==================== 响应缓存 ====================
var _responseCache = {};
var _cacheTTL = 5000; // 默认 5 秒缓存（短 TTL 避免数据过时）

function _cacheKey(url, cookie) {
  // 用 URL + cookie 前缀做 key
  return url + '|' + (cookie ? cookie.slice(0, 30) : '');
}

function _cacheGet(url, cookie) {
  var key = _cacheKey(url, cookie);
  var entry = _responseCache[key];
  if (entry && Date.now() - entry.time < _cacheTTL) {
    return entry.data;
  }
  delete _responseCache[key];
  return null;
}

function _cacheSet(url, cookie, data) {
  var key = _cacheKey(url, cookie);
  _responseCache[key] = { data: data, time: Date.now() };
}

// 定期清理过期缓存（每 30 秒）
setInterval(function() {
  var now = Date.now();
  for (var k in _responseCache) {
    if (_responseCache[k] && now - _responseCache[k].time > _cacheTTL * 2) {
      delete _responseCache[k];
    }
  }
}, 30000);

// ==================== 并发控制 ====================
var _pendingCount = 0;
var _maxConcurrent = 6; // 最大并发请求数
var _requestQueue = [];

function _dequeue() {
  while (_pendingCount < _maxConcurrent && _requestQueue.length > 0) {
    var item = _requestQueue.shift();
    _pendingCount++;
    item.resolve(item.executor());
  }
}

// 包装 fetch 以避免并行请求过多
function _limitedFetch(url, options) {
  return new Promise(function(resolve, reject) {
    var executor = async function() {
      try {
        var result = await fetch(url, options);
        _pendingCount--;
        _dequeue();
        resolve(result);
      } catch (err) {
        _pendingCount--;
        _dequeue();
        reject(err);
      }
    };
    if (_pendingCount >= _maxConcurrent) {
      _requestQueue.push({ resolve: function() { executor().catch(function() {}); }, executor: executor });
    } else {
      _pendingCount++;
      executor().catch(function() {}); // actually executor has its own try/catch
    }
  });
}

/**
 * 🔑 动态获取基础配置（支持热更新）
 */
function getBaseUrl() {
  return vscode.workspace.getConfiguration('yzoj').get('baseUrl');
}

/**
 * 1. 登录函数
 */
async function login(username, password) {
  try {
    const baseUrl = getBaseUrl();
    const LOGIN_API = `${baseUrl}/OnlineJudge/user.php`;
    
    const formData = new URLSearchParams();
    formData.append('username', username);
    formData.append('password', password);
    formData.append('is_login', '登录');
    
    logger.log('正在尝试登录用户: ' + username);
    
    const response = await _limitedFetch(LOGIN_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (VS Code Extension)'
      },
      body: formData.toString(),
      redirect: 'manual',
      agent: _getAgent(LOGIN_API),
      signal: AbortSignal.timeout(10000)
    });
    
    const setCookie = response.headers.get('set-cookie');
    if (!setCookie) return { success: false, msg: '未获取到登录凭证' };
    
    const cookie = setCookie.split(';')[0];
    
    let resultJson = {};
    try {
      resultJson = await response.json();
    } catch (_e) {
      return { success: true, cookie: cookie, msg: '登录成功（响应格式兼容）' };
    }
    
    if (resultJson.res === true || resultJson.res === 'true') {
      logger.log('登录成功');
      return { success: true, cookie: cookie, msg: '登录成功' };
    } else {
      logger.log('登录失败:', resultJson.msg);
      return { success: false, msg: resultJson.msg || '账号或密码错误', cookie: '' };
    }
  } catch (error) {
    logger.log('登录请求出错:', error);
    return { success: false, msg: '网络错误: ' + error.message, cookie: '' };
  }
}

/**
 * 2. 检查登录状态
 */
async function checkStatus(cookie) {
  if (!cookie) {
    return { isLoggedIn: false, username: '' };
  }
  try {
    const baseUrl = getBaseUrl();
    const url = baseUrl + '/OnlineJudge/';
    // 检查缓存（检查状态不需要太频繁）
    var cached = _cacheGet(url + '__checkStatus', cookie);
    if (cached) return cached;
    
    const response = await _limitedFetch(url, {
      method: 'GET',
      headers: {
        'Cookie': cookie,
        'User-Agent': 'Mozilla/5.0 (VS Code Extension)'
      },
      agent: _getAgent(url),
      signal: AbortSignal.timeout(8000)
    });
    
    const buffer = await response.buffer();
    const html = iconv.decode(buffer, 'utf8');
    
    const $ = cheerio.load(html);
    let username = '';
    
    const userLink = $('a[href*="user_show.php"]').first();
    if (userLink.length > 0) {
      username = userLink.text().trim();
    }
    
    var result = { isLoggedIn: username.length > 0, username: username };
    // 缓存 3 秒
    _cacheSet(url + '__checkStatus', cookie, result);
    _cacheSet(url, cookie, html); // 同时缓存主页 HTML
    
    return result;
  } catch (error) {
    return { isLoggedIn: false, username: '' };
  }
}

/**
 * 3. 获取网页源码（通用，带缓存+keep-alive+并发控制）
 */
async function gethtml(url, cookie) {
  try {
    // 检查缓存
    var cached = _cacheGet(url, cookie);
    if (cached) return cached;
    
    const headers = { 'User-Agent': 'Mozilla/5.0 (VS Code Extension)' };
    if (cookie) headers['Cookie'] = cookie;
    
    const response = await _limitedFetch(url, {
      headers,
      agent: _getAgent(url),
      signal: AbortSignal.timeout(10000)
    });
    
    let text;
    if (typeof response.text === 'function') {
      text = await response.text();
    } else {
      const buffer = await response.buffer();
      text = iconv.decode(buffer, 'utf8');
    }
    
    // 缓存结果
    _cacheSet(url, cookie, text);
    return text;
  } catch (error) {
    throw error;
  }
}

/**
 * 解析 YZOJ 风格的时间字符串为 Date 对象
 */
function parseYZOJDate(str) {
  if (!str || typeof str !== 'string') return null;
  const s = str.trim().replace(/\s+/g, ' ');
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/);
  if (m) {
    const [, y, mo, d, h = '0', mi = '0', se = '0'] = m;
    const date = new Date(parseInt(y, 10), parseInt(mo, 10) - 1, parseInt(d, 10), parseInt(h, 10), parseInt(mi, 10), parseInt(se, 10), 0);
    if (!isNaN(date.getTime())) return date;
  }
  const t = Date.parse(s);
  if (!isNaN(t)) return new Date(t);
  return null;
}

/**
 * 4. 获取比赛详情（带缓存）
 */
async function getContestInfo(contestId, cookie) {
  // 缓存 key 包含 contestId
  var cacheKey = '__contestInfo_' + contestId;
  var cached = _cacheGet(cacheKey, cookie);
  if (cached) return cached;
  
  try {
    const baseUrl = getBaseUrl();
    const url = baseUrl + '/OnlineJudge/contest_show.php?id=' + contestId;
    const html = await gethtml(url, cookie);
    const $ = cheerio.load(html);
    
    const rawTitle = $('h2').first().text().trim();
    const title = rawTitle.replace(/^T\d+\s*[-–—]\s*/, '');
    
    let startTimeStr = null;
    let endTimeStr = null;
    const infoTable = $('table[style*="600px"]').first();
    if (infoTable.length) {
      infoTable.find('td').each(function () {
        const t = $(this);
        const labelEl = t.contents().filter(function () { return this.nodeType === 3; }).first();
        let label = labelEl.text().replace(/[：:]/g, '').trim();
        if (!label) {
          const clone = t.clone();
          clone.find('font, a, span, strong').remove();
          label = clone.text().replace(/[：:]/g, '').trim();
        }
        let value = '';
        const f = t.find('font');
        const a = t.find('a');
        if (f.length) value = f.text().trim();
        else if (a.length) value = a.text().trim();
        else {
          const clone = t.clone();
          clone.find('font, a, span, strong').remove();
          value = clone.text().replace(label, '').replace(/[：:]/g, '').trim();
          if (!value) value = t.text().replace(label, '').replace(/[：:]/g, '').trim();
        }
        const lk = label.toLowerCase();
        if (label.includes('开始') || lk.includes('start') || label.includes('起始')) startTimeStr = value || startTimeStr;
        if (label.includes('结束') || lk.includes('end')) endTimeStr = value || endTimeStr;
      });
    }
    
    if (!endTimeStr) {
      $('td, th, span, font').each((i, el) => {
        if (endTimeStr) return;
        const text = $(el).text().trim();
        if (text.includes('结束') || text.toLowerCase().includes('end')) {
          const next = $(el).next();
          if (next.length) {
            endTimeStr = next.text().trim() || next.find('font').text().trim() || null;
          }
        }
      });
    }
    
    let status = 'unknown';
    const startDate = parseYZOJDate(startTimeStr);
    const endDate = parseYZOJDate(endTimeStr);
    const now = new Date();
    if (startDate || endDate) {
      if (startDate && now.getTime() < startDate.getTime()) {
        status = 'scheduled';
      } else if (endDate && now.getTime() > endDate.getTime()) {
        status = 'ended';
      } else if ((startDate && now.getTime() >= startDate.getTime() && !endDate) ||
                 (endDate && now.getTime() <= endDate.getTime() && !startDate) ||
                 (startDate && endDate && now.getTime() >= startDate.getTime() && now.getTime() <= endDate.getTime())) {
        status = 'active';
      }
    }
    
    if (status === 'unknown') {
      const pageText = $('body').text().toLowerCase();
      if (pageText.includes('进行中') || pageText.includes('running') || pageText.includes('active')) {
        status = 'active';
      } else if (pageText.includes('已结束') || pageText.includes('ended') || pageText.includes('finished')) {
        status = 'ended';
      } else if (pageText.includes('未开始') || pageText.includes('scheduled') || pageText.includes('pending')) {
        status = 'scheduled';
      }
    }

    let supportsRank = false;
    let supportsStatus = false;
    try {
      const permTextNodes = [];
      $('p center, p, #content, body').each((_, el) => {
        const t = $(el).text() || '';
        if (t.includes('允许查看') || t.includes('排行榜') || t.includes('评测状态') || t.includes('比赛过程中')) permTextNodes.push(t);
      });
      const permJoined = permTextNodes.join('\n');
      if (/允许查看排行榜|支持查看排行榜|查看排行榜/.test(permJoined)) supportsRank = true;
      if (/允许查看评测状态|支持查看评测状态|查看评测状态/.test(permJoined)) supportsStatus = true;
    } catch (_e) { /* ignore */ }
    try {
      const rankLink = $('a[href*="contest_result.php"], a[href*="contest_rank.php"]').first();
      const statusLink = $('a[href*="status.php"]').filter((_, el) => {
        const h = $(el).attr('href') || '';
        return /[?&]test=\d+/.test(h) || /[?&]tid=\d+/.test(h);
      }).first();
      if (rankLink.length) supportsRank = true;
      if (statusLink.length) supportsStatus = true;
    } catch (_e) { /* ignore */ }

    var result = {
      title, status, startTime: startTimeStr, endTime: endTimeStr,
      supportsRank, supportsStatus,
      _startTs: startDate ? startDate.getTime() : null,
      _endTs: endDate ? endDate.getTime() : null,
      _nowTs: now.getTime()
    };
    // 缓存 10 秒
    _cacheSet(cacheKey, cookie, result);
    _responseCache[_cacheKey(cacheKey, cookie)].ttl = 10000;
    return result;
  } catch (err) {
    return { title: '', status: 'unknown', startTime: null, endTime: null, supportsRank: false, supportsStatus: false, _startTs: null, _endTs: null, _nowTs: Date.now() };
  }
}

/**
 * 5. 提取比赛题目到全局练习题号的映射
 */
async function getContestProblemGlobalPids(contestId, cookie, expectedCpidList) {
  const result = {};
  try {
    const baseUrl = getBaseUrl();
    const showUrl = baseUrl + '/OnlineJudge/contest_show.php?id=' + contestId;
    let html = '';
    try { html = await gethtml(showUrl, cookie); } catch (_e) { html = ''; }
    const $ = cheerio.load(html || '');

    const seenProbShowGids = new Set();
    $('a[href*="problem_show.php"]').each((_, el) => {
      const href = $(el).attr('href') || '';
      const gm = href.match(/[?&]id=(\d+)/);
      if (!gm) return;
      const gid = gm[1];
      if (!gid || seenProbShowGids.has(gid)) return;
      seenProbShowGids.add(gid);
      let cpid = null;
      const linkText = $(el).text().trim();
      const m = linkText.match(/^(\d+)/);
      if (m) { cpid = m[1]; }
      if (!cpid) {
        let candidate = $(el).closest('tr, td, li, div');
        const surround = candidate.length ? candidate.text() : '';
        const sm = surround.match(/(?:^|[\s（(【#])(\d+)(?:[\.\、\s：:)】]|$)/);
        if (sm) cpid = sm[1];
      }
      if (cpid && !result[cpid]) result[cpid] = gid;
    });

    // 策略 2: 并行获取所有 contest_problem.php
    const toFetch = [];
    const seenCpid = new Set();
    $('a[href*="contest_problem.php"]').each((_, el) => {
      const href = $(el).attr('href') || '';
      const pm = href.match(/[?&]pid=(\d+)/);
      if (pm && !seenCpid.has(pm[1])) {
        seenCpid.add(pm[1]);
        if (!result[pm[1]]) toFetch.push(pm[1]);
      }
    });
    if (expectedCpidList && Array.isArray(expectedCpidList)) {
      for (const c of expectedCpidList) {
        const cs = String(c);
        if (!result[cs] && toFetch.indexOf(cs) === -1) toFetch.push(cs);
      }
    }

    // 🔑 并行获取，不再串行等待
    if (toFetch.length > 0) {
      var promises = toFetch.map(function(cpid) {
        return (async function() {
          try {
            const cpUrl = baseUrl + '/OnlineJudge/contest_problem.php?tid=' + contestId + '&pid=' + cpid;
            const cpHtml = await gethtml(cpUrl, cookie);
            const cp$ = cheerio.load(cpHtml || '');
            const candidates = [
              cp$('a[href*="problem_submit.php"]').first().attr('href'),
              cp$('a[href*="problem_show.php"]').first().attr('href')
            ];
            let found = null;
            for (const hf of candidates) {
              if (!hf) continue;
              const m = hf.match(/[?&]id=(\d+)/);
              if (m && m[1]) { found = m[1]; break; }
            }
            if (!found) {
              cp$('a[href]').each((_, el) => {
                if (found) return;
                const hf = cp$(el).attr('href') || '';
                if (!/problem_(show|submit|status|discuss|solve)\.php/.test(hf)) return;
                const m = hf.match(/[?&]id=(\d+)/);
                if (m && m[1]) found = m[1];
              });
            }
            if (found) result[cpid] = found;
          } catch (_e) { /* skip */ }
        })();
      });
      await Promise.all(promises);
    }
    return result;
  } catch (err) {
    return result;
  }
}

// 清除缓存（用户可调用）
function clearCache() {
  _responseCache = {};
}

module.exports = { login, checkStatus, gethtml, getContestInfo, getContestProblemGlobalPids, clearCache };
