// handle.js - 业务处理核心模块
const vscode = require('vscode');
const fs = require('fs');
const fsAsync = require('fs').promises;
const path = require('path');
const fetch = require('node-fetch'); // 🔑 统一使用 node-fetch
const FormData = require('form-data');

const MAP_FILE = '.yzoj-problem-map.json';

async function getMap() {
  const ws = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
  if (!ws) return {};
  const mapPath = path.join(ws.uri.fsPath, MAP_FILE);
  try {
    if (fs.existsSync(mapPath)) return JSON.parse(await fsAsync.readFile(mapPath, 'utf8'));
  } catch { return {}; }
  return {};
}

async function saveMap(map) {
  const ws = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
  if (!ws) return;
  try {
    await fsAsync.writeFile(path.join(ws.uri.fsPath, MAP_FILE), JSON.stringify(map, null, 2), 'utf8');
  } catch (err) {
    vscode.window.showWarningMessage('⚠️ 映射文件保存失败，绑定可能失效');
  }
}

// ==================== 多映射追踪系统 ====================

const MAP_STORAGE_KEY = 'yzojTrackedMaps';

/** 从指定目录读取 .yzoj-problem-map.json */
async function getMapAtPath(dirPath) {
  if (!dirPath) return {};
  const mapPath = path.join(dirPath, MAP_FILE);
  try {
    if (fs.existsSync(mapPath)) return JSON.parse(await fsAsync.readFile(mapPath, 'utf8'));
  } catch { return {}; }
  return {};
}

/** 保存 .yzoj-problem-map.json 到指定目录 */
async function saveMapAtPath(map, dirPath) {
  if (!dirPath) return;
  try {
    const mapPath = path.join(dirPath, MAP_FILE);
    await fsAsync.writeFile(mapPath, JSON.stringify(map, null, 2), 'utf8');
  } catch (err) {
    }
}

/** 获取所有已注册的映射目录列表（来自 context.globalState） */
function getAllTrackedMapPaths(context) {
  return context.globalState.get(MAP_STORAGE_KEY, []);
}

/** 注册一个映射目录到 context.globalState */
async function registerMapPath(context, dirPath) {
  if (!dirPath || !context) return;
  const absPath = path.resolve(dirPath);
  const paths = getAllTrackedMapPaths(context);
  if (!paths.includes(absPath)) {
    paths.push(absPath);
    await context.globalState.update(MAP_STORAGE_KEY, paths);
  }
}

/** 从 context.globalState 移除一个映射目录 */
async function unregisterMapPath(context, dirPath) {
  if (!dirPath || !context) return;
  const absPath = path.resolve(dirPath);
  const paths = getAllTrackedMapPaths(context).filter(p => p !== absPath);
  await context.globalState.update(MAP_STORAGE_KEY, paths);
}

/**
 * 🔍 检测并清理单个 .yzoj-problem-map.json：
 *   1. 移除代码文件已不存在的失效条目
 *   2. 更新已结束比赛的 isContest 状态
 */
async function checkAndCleanMapAtPath(dirPath, globalCookie) {
  const result = { cleaned: 0, updated: 0 };
  if (!dirPath) return result;
  const mapPath = path.join(dirPath, MAP_FILE);
  if (!fs.existsSync(mapPath)) return result;
  try {
    const map = await getMapAtPath(dirPath);
    let dirty = false;
    const nowIso = new Date().toISOString();

    // 移除失效条目
    for (const [filePath, entry] of Object.entries(map)) {
      if (!fs.existsSync(filePath)) {
        delete map[filePath];
        dirty = true;
        result.cleaned++;
      }
    }

    // 更新已结束比赛的状态
    for (const [filePath, entry] of Object.entries(map)) {
      if (entry.isContest && entry.contestId) {
        try {
          const { getContestInfo } = require('./ojclient');
          const info = await getContestInfo(entry.contestId, globalCookie || '');
          if (info && info.status === 'ended') {
            entry.isContest = false;
            entry.updatedAt = nowIso;
            dirty = true;
            result.updated++;
          }
        } catch (_e) { /* 网络错误跳过本轮 */ }
      }
    }

    if (dirty) await saveMapAtPath(map, dirPath);
  } catch (err) {
    }
  return result;
}

/**
 * ⏱ 对所有已追踪的映射执行周期性检测（每 1 分钟）：
 *   - 映射文件不存在 → 从追踪列表移除
 *   - 清理失效条目 + 更新比赛状态
 *   - 转换已结束比赛（重命名文件 + 更新全局题号）
 */
async function periodicCheckAllMaps(context, yzoj_url, globalCookie) {
  const paths = getAllTrackedMapPaths(context);
  if (!paths.length) return;
  // 🔑 并行检查所有路径，不再串行
  var checkPromises = paths.map(function(dirPath) {
    return (async function() {
      try {
        const mapFilePath = path.join(dirPath, MAP_FILE);
        if (!fs.existsSync(mapFilePath)) {
          await unregisterMapPath(context, dirPath);
          return;
        }
        await checkAndCleanMapAtPath(dirPath, globalCookie);
        await convertEndedContestsAtPath(dirPath, yzoj_url, globalCookie);
      } catch (_e) { /* 单路径失败不影响其他路径 */ }
    })();
  });
  await Promise.all(checkPromises);
}

/**
 * 📁 创建比赛文件夹 + 自动绑定映射
 */
async function handleCreateContestFolder(msg, context) {
  const ws = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
  if (!ws) return vscode.window.showErrorMessage('❌ 请先打开工作区');

  const contestId = msg.contestId || msg.id;
  if (!contestId || contestId === 'undefined' || contestId === 'unknown') {
    return vscode.window.showErrorMessage('❌ 比赛 ID 获取失败，请重试');
  }

  const safeName = msg.contestName.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim();
  const dirPath = path.join(ws.uri.fsPath, `${contestId}_${safeName}`);

  if (fs.existsSync(dirPath)) {
    const choice = await vscode.window.showWarningMessage(
      `文件夹 "${path.basename(dirPath)}" 已存在，是否覆盖？`,
      '覆盖', '取消'
    );
    if (choice !== '覆盖') return;
    await fsAsync.rm(dirPath, { recursive: true, force: true });
  }
  await fsAsync.mkdir(dirPath, { recursive: true });

  const configTpl = vscode.workspace.getConfiguration('yzoj').get('contest.defaultCodeTemplate');
  const defaultTpl = `#include <bits/stdc++.h>
using namespace std;
int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    return 0;
}
`;
  const rawTpl = (typeof configTpl === 'string' && configTpl.trim() !== '') ? configTpl : defaultTpl;
  const todayStr = (() => {
    const d = new Date();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mm}-${dd}`;
  })();

  const map = await getMap();
  const isContestActive = msg.status === 'Active' || msg.status === 'Running' || msg.isRunning;
  const tsNow = new Date().toISOString();

  for (const p of (msg.problems || [])) {
    const pid = p.problemId || p.order || 'unknown';
    const pname = p.name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim();
    const replaced = rawTpl
      .replace(/\{PID\}/g, String(p.order || p.problemId || ''))
      .replace(/\{PROBLEM_ID\}/g, String(p.problemId || p.order || ''))
      .replace(/\{PROBLEM_NAME\}/g, String(p.name || ''))
      .replace(/\{CONTEST_ID\}/g, String(contestId || ''))
      .replace(/\{CONTEST_NAME\}/g, String(msg.contestName || ''))
      .replace(/\{DATE\}/g, todayStr);
    const filePath = path.join(dirPath, `${pid}.${pname}.cpp`);
    await fsAsync.writeFile(filePath, replaced, 'utf8');
    
    map[filePath] = {
      problemId: pid,
      contestId: contestId,
      contestName: msg.contestName,
      isContest: isContestActive,
      url: p.url,
      createdAt: tsNow,
      updatedAt: tsNow,
      converted: false
    };
  }
  await saveMap(map);
  vscode.window.showInformationMessage(`✅ 已创建 ${msg.problems.length} 题并绑定映射`);
  await vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(dirPath));
}

/**
 * 📝 给 map 每条记录补 createdAt/updatedAt（兼容旧的无时间戳映射）
 * 以及初始化 converted 字段
 */
function _ensureTimestampsAndFlags(obj, now) {
  if (!obj) return obj;
  if (!obj.createdAt) obj.createdAt = now;
  if (!obj.updatedAt) obj.updatedAt = now;
  if (typeof obj.converted !== 'boolean') obj.converted = !!obj.converted;
  return obj;
}

/**
 * 🔄 自动转换比赛结束的题目：重命名文件 + 改映射为练习提交 URL
 * 懒执行：每次提交前检查，转换过的不再重复转
 * @param {string} dirPath 映射文件所在目录
 * @returns {Promise<{convertedCount: number, skippedCount: number, errors: string[]}>}
 */
async function convertEndedContestsAtPath(dirPath, yzoj_url, globalCookie) {
  const result = { convertedCount: 0, skippedCount: 0, errors: [] };
  if (!dirPath) return result;
  const baseUrl = yzoj_url || (require('./ojclient').getBaseUrl ? require('./ojclient').getBaseUrl() : '');
  if (!baseUrl) return result;
  const { getContestInfo, getContestProblemGlobalPids } = require('./ojclient');

  try {
    const map = await getMapAtPath(dirPath);
    const nowIso = new Date().toISOString();
    let dirty = false;

    // --- 1. 兼容旧映射：补时间戳 & converted flag ---
    for (const k of Object.keys(map)) {
      const before = JSON.stringify(map[k]);
      _ensureTimestampsAndFlags(map[k], nowIso);
      if (JSON.stringify(map[k]) !== before) dirty = true;
    }

    // --- 2. 按 contestId 分组：收集未转换的比赛条目 ---
    const byContest = new Map();
    for (const oldPath of Object.keys(map)) {
      const entry = map[oldPath];
      if (!entry || !entry.contestId) continue;
      if (entry.converted === true) continue;
      if (entry.isContest === false && entry.problemId && String(entry.problemId).match(/^P?\d{4,}$/)) {
        entry.converted = true;
        entry.updatedAt = nowIso;
        dirty = true;
        continue;
      }
      const cid = String(entry.contestId);
      if (!byContest.has(cid)) byContest.set(cid, { expectedCpids: [], list: [] });
      const grp = byContest.get(cid);
      grp.list.push({ oldPath, entry });
      const cpid = entry.problemId != null ? String(entry.problemId) : '';
      if (cpid && /^\d+$/.test(cpid) && grp.expectedCpids.indexOf(cpid) === -1) {
        grp.expectedCpids.push(cpid);
      }
    }

    if (byContest.size === 0) {
      if (dirty) await saveMapAtPath(map, dirPath);
      return result;
    }

    // --- 3. 对每个比赛：检查是否 ended，若是则取 CPID→GID 映射 & 转换 ---
    for (const [contestId, grp] of byContest.entries()) {
      try {
        const info = await getContestInfo(contestId, globalCookie || '');
        if (!info || info.status !== 'ended') {
          result.skippedCount += grp.list.length;
          continue;
        }

        const cpid2gid = await getContestProblemGlobalPids(contestId, globalCookie || '', grp.expectedCpids);
        if (!cpid2gid || Object.keys(cpid2gid).length === 0) {
          result.errors.push('比赛 #' + contestId + '：未能解析到 CPID→GID 映射');
          result.skippedCount += grp.list.length;
          continue;
        }

        // --- 4. 逐条转换：重命名文件 + 更新 map key ---
        let convCountForContest = 0;
        for (const { oldPath, entry } of grp.list) {
          const cpid = entry.problemId != null ? String(entry.problemId) : '';
          const gid = cpid && cpid2gid[cpid] ? String(cpid2gid[cpid]) : '';
          if (!gid) {
            result.errors.push('比赛 #' + contestId + ' CPID ' + (cpid || '(空)') + '：未找到全局题号');
            result.skippedCount += 1;
            continue;
          }
          try {
            if (!fs.existsSync(oldPath)) {
              delete map[oldPath];
              dirty = true;
              continue;
            }
            const p = path.parse(oldPath);
            const basename = p.base;
            let newBaseNoPrefix = basename.replace(/^\s*\d+\s*\./, '');
            if (!newBaseNoPrefix || newBaseNoPrefix === basename) {
              newBaseNoPrefix = basename;
            }
            const newBase = 'P' + gid + '.' + newBaseNoPrefix;
            const newPath = path.join(p.dir, newBase);

            let finalNewPath = newPath;
            if (fs.existsSync(finalNewPath) && finalNewPath.toLowerCase() !== oldPath.toLowerCase()) {
              const ext = p.ext || '.cpp';
              const stem = path.basename(newBaseNoPrefix, ext);
              finalNewPath = path.join(p.dir, 'P' + gid + '-T' + contestId + 'p' + cpid + '.' + stem + ext);
            }

            if (finalNewPath.toLowerCase() !== oldPath.toLowerCase()) {
              try { await fsAsync.rename(oldPath, finalNewPath); } catch (_renameErr) {
                await fsAsync.copyFile(oldPath, finalNewPath);
                try { await fsAsync.unlink(oldPath); } catch (_unlinkErr) { /* ignore */ }
              }
            }

            delete map[oldPath];
            const cleanBaseUrl = String(baseUrl || '').replace(/\/+$/, '');
            const practiceUrl = cleanBaseUrl + '/OnlineJudge/problem_submit.php?id=' + gid;
            map[finalNewPath] = {
              ...entry,
              problemId: gid,
              isContest: false,
              url: practiceUrl,
              originalContestPid: cpid,
              originalContestUrl: entry.url,
              converted: true,
              convertedAt: nowIso,
              updatedAt: nowIso
            };
            dirty = true;
            convCountForContest += 1;
            result.convertedCount += 1;
          } catch (itemErr) {
            result.errors.push('比赛 #' + contestId + ' CPID ' + (cpid || '(空)') + ': ' + itemErr.message);
            result.skippedCount += 1;
          }
        }
        if (convCountForContest > 0) {
          console.info('[auto-convert] 比赛 #' + contestId + ' 自动转换 ' + convCountForContest + '/' + grp.list.length + ' 题到练习模式');
        }
      } catch (contestErr) {
        result.errors.push('比赛 #' + contestId + ': ' + contestErr.message);
        result.skippedCount += grp.list.length;
      }
    }

    if (dirty) await saveMapAtPath(map, dirPath);
  } catch (err) {
    result.errors.push(err.message);
  }
  return result;
}

/**
 * 🔄 (包装器) 对当前工作区根目录的映射执行比赛结束转换
 * 由 handleSubmitCode 调用，保持向后兼容
 */
async function handleCheckAndConvertEndedContests(yzoj_url, globalCookie) {
  const ws = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
  if (!ws) return { convertedCount: 0, skippedCount: 0, errors: [] };
  return convertEndedContestsAtPath(ws.uri.fsPath, yzoj_url, globalCookie);
}

var _lastConvertCheck = 0;
/**
 * 📤 提交代码命令逻辑（智能路由 + 比赛状态检查）
 */
async function handleSubmitCode(context, yzoj_url, globalCookie) {
  // 懒转换：每次提交前先检查，比赛结束的题目自动转练习模式（重命名文件+换url）
  // 加时间缓存：每 20 分钟只检查一次，已转换的记录会被跳过
  var now = Date.now();
  if (now - _lastConvertCheck > 1200000) {
    _lastConvertCheck = now;
    try {
      await handleCheckAndConvertEndedContests(yzoj_url, globalCookie);
    } catch (_e) {
    }
  }

  const editor = vscode.window.activeTextEditor;
  if (!editor) return vscode.window.showErrorMessage('❌ 请先打开代码文件');

  const filePath = editor.document.uri.fsPath;
  const code = editor.document.getText();
  const map = await getMap();
  const bound = map[filePath];

  let problemId = bound && bound.problemId;
  let contestId = bound && bound.contestId;
  let isContest = bound && bound.isContest;
  let problemUrl = bound && bound.url;
  let contestInnerPid = null;  // 比赛内题号：contest_submit.php 的 pid= 参数（声明前移，供无映射分支使用）

  // ========== 🔑 新交互：无映射记录（bound 为空或字段不全）的智能询问 ==========
  // 用户要求：没有映射记录时，先问「比赛提交/练习提交」：
  //   比赛提交 → 再问 比赛编号(TID) + 第几题(CPID 1,2,3...)
  //   练习提交 → 再问 题号(PID)
  const hasNoMapping = !bound;
  if (hasNoMapping) {
    problemId = undefined;
    contestId = undefined;
    isContest = undefined;
    problemUrl = undefined;
    const typeChoice = await vscode.window.showQuickPick(
      ['比赛提交', '练习提交'],
      { placeHolder: '该代码尚未绑定，请选择提交类型', title: '提交类型选择' }
    );
    if (!typeChoice) return; // 用户取消
    if (typeChoice === '比赛提交') {
      isContest = true;
      // 1) 询问比赛编号
      const tidInput = await vscode.window.showInputBox({
        prompt: '请输入比赛编号 (TID)',
        placeHolder: '例如：3293',
        title: '比赛提交流程 1/2',
        validateInput: (v) => /^\d+$/.test(v.trim()) ? null : '比赛编号必须是纯数字'
      });
      if (!tidInput) return;
      contestId = tidInput.trim();
      // 2) 询问比赛内题号（第几题）
      const cpidInput = await vscode.window.showInputBox({
        prompt: '请输入题目在比赛中的编号（第几题）',
        placeHolder: '例如：1  （表示比赛第1题）',
        title: '比赛提交流程 2/2',
        validateInput: (v) => /^\d+$/.test(v.trim()) ? null : '题号必须是纯数字'
      });
      if (!cpidInput) return;
      const cpid = cpidInput.trim();
      problemId = cpid;                // 比赛内题号（提交表单的 pid）
      contestInnerPid = cpid;
      problemUrl = `${yzoj_url}/OnlineJudge/contest_problem.php?tid=${contestId}&pid=${cpid}`;
    } else {
      // 练习提交
      isContest = false;
      const pidInput = await vscode.window.showInputBox({
        prompt: '请输入练习题号 (PID)',
        placeHolder: '例如：6958 或 P6958',
        title: '练习提交流程',
        validateInput: (v) => {
          const pure = String(v || '').replace(/[Pp]/g, '').trim();
          return /^\d+$/.test(pure) ? null : '题号必须是数字（可带P前缀）';
        }
      });
      if (!pidInput) return;
      const purePid = String(pidInput).replace(/[Pp]/g, '').trim();
      problemId = purePid;
      problemUrl = `${yzoj_url}/OnlineJudge/problem_show.php?id=${purePid}`;
    }
  }

  // 1b. 有映射但缺 problemId（防御性兜底）
  if (!problemId) {
    problemId = await vscode.window.showInputBox({
      prompt: '请输入题号 (PID)', placeHolder: '例如：1000'
    });
    if (!problemId) return;
  }

  // 2. 智能判断提交类型 + 从 problemUrl 提取比赛参数(tid/pid 比赛内题号)
  // ⚠️ contestInnerPid 声明已移至函数开头（第284行），此处直接复用
  if (isContest === undefined && problemUrl) {
    isContest = problemUrl.includes('contest_submit.php') || problemUrl.includes('contest_problem.php');
    if (isContest) {
      const tidMatch = problemUrl.match(/[?&]tid=(\d+)/);
      if (tidMatch) contestId = tidMatch[1];
      // 关键：比赛题目的 problemUrl 里 pid= 是比赛内题号（例如 contest_submit.php?tid=3293&pid=4 → 比赛内第 4 题）
      // 这个 contestInnerPid 必须替换全局 problemId，否则比赛提交的 PID 会错
      const innerPidMatch = problemUrl.match(/[?&]pid=(\d+)/);
      if (innerPidMatch) {
        contestInnerPid = innerPidMatch[1];
      }
    }
  }
  // 如果通过 problemUrl 解析出来了比赛内题号，覆盖掉原来的 problemId（否则用的是全局题号，比赛会错）
  if (isContest && contestInnerPid) {
    problemId = contestInnerPid;
  }

  // 3. 仍无法确定则询问用户（有映射但 isContest 未设置时的兜底逻辑）
  if (isContest === undefined) {
    const choice = await vscode.window.showQuickPick(
      ['练习提交', '比赛提交'],
      { placeHolder: '请选择提交类型' }
    );
    if (!choice) return;
    isContest = (choice === '比赛提交');
    if (isContest && !contestId) {
      contestId = await vscode.window.showInputBox({
        prompt: '请输入比赛 ID (TID)', placeHolder: '例如：3278',
        validateInput: (v) => /^\d+$/.test(v.trim()) ? null : '比赛编号必须是纯数字'
      });
      if (!contestId) return;
      contestId = contestId.trim();
    }
    if (isContest && contestId && (!contestInnerPid || !problemId)) {
      const cpid2 = await vscode.window.showInputBox({
        prompt: '请输入比赛内题号（第几题）',
        placeHolder: '例如：1',
        validateInput: (v) => /^\d+$/.test(v.trim()) ? null : '题号必须是纯数字'
      });
      if (!cpid2) return;
      contestInnerPid = cpid2.trim();
      problemId = contestInnerPid;
      if (!problemUrl) problemUrl = `${yzoj_url}/OnlineJudge/contest_problem.php?tid=${contestId}&pid=${contestInnerPid}`;
    }
  }

  // 4. 🔑 比赛提交：检查比赛状态 + 拉取权限（supportsRank/supportsStatus）用于后面决定是否跳转
  //    结果缓存到局部变量 contestInfoCached，避免重复请求
  let contestInfoCached = null;
  if (isContest && contestId) {
    try {
      const { getContestInfo } = require('./ojclient');
      contestInfoCached = await getContestInfo(contestId, globalCookie);
      if (contestInfoCached && contestInfoCached.status === 'ended') {
        vscode.window.showInformationMessage(`ℹ️ 比赛 #${contestId} 已结束，自动切换为练习提交`);
        isContest = false;
        contestInfoCached = null;
      }
    } catch (err) {
      // 网络错误时不阻断提交
    }
  }

  // 5. 选择语言
  const langMap = {
    'G++ 9.3 (Ubuntu 20.04)': 'G++9', 
    'G++ (NOI Linux)': 'G++', 
    'GCC (NOI Linux)': 'GCC', 
    'FPC (NOI Linux)': 'FPC',
    'GCC (System)': 'GCCSYS', 
    'G++ (System)': 'G++SYS'
  };
  const language = await vscode.window.showQuickPick(Object.keys(langMap), { 
    placeHolder: '选择编译器' 
  });
  if (!language) return;
  const compiler = langMap[language];

  // 6. 发送请求
  try {
    const formData = new FormData();
    formData.append('compiler', compiler);
    formData.append('code', code);
    
    if (!isContest) {
      // 练习提交 URL: /OnlineJudge/submit.php (form action in problem_submit.php)
      // POST body 包含 pid（表单里的 input name=pid）
      formData.append('pid', problemId);
      // 注意：06_problem_submit_1000.html 中 submit 按钮没有 name 属性，因此不需要 submit=xxx 字段
      // 也没有 referer hidden 字段
    } else {
      // 比赛提交 URL: /OnlineJudge/contest_submit.php?tid=xxx&pid=xxx (query string)
      // example.html 中比赛 form 有两个关键 hidden/named 字段，必须加上，否则 PHP isset($_POST['submit']) 不会识别为提交：
      formData.append('submit', '提交');   // <input type="submit" name="submit" value="提交" />
      formData.append('referer', 'index.php');  // <input type="hidden" value="index.php" name="referer" />
    }

    const submitUrl = isContest 
      ? `${yzoj_url}/OnlineJudge/contest_submit.php?tid=${contestId}&pid=${problemId}`
      : `${yzoj_url}/OnlineJudge/submit.php`;

    const res = await fetch(submitUrl, {
      method: 'POST',
      headers: { 
        'Cookie': globalCookie,
        ...formData.getHeaders() // form-data 自动设置 boundary
      },
      body: formData
    });

    if (res.ok) {
      vscode.window.showInformationMessage(
        `✅ 提交成功: P${problemId} (${isContest ? `比赛 #${contestId}` : '练习'})`
      );
      // 🔑 提交成功后跳转策略：
      //  - 练习提交：默认跳转评测列表（用户明确要求）
      //  - 比赛提交：仅当比赛「支持查看评测状态」时才跳转；否则不跳转（用户要求）
      try {
        let shouldJump = false;
        // 最终使用的权限对象（优先级：contestInfoCached 缓存 → 新拉取 → 未知则比赛默认跳转）
        let permInfo = contestInfoCached;
        if (isContest && contestId && !permInfo) {
          // 兜底：若上面比赛检查失败（比如比赛未结束但缓存没取到），再拉一次确保能拿到 supportsStatus
          try {
            const { getContestInfo } = require('./ojclient');
            permInfo = await getContestInfo(contestId, globalCookie);
          } catch (_e) {
          }
        }
        let statusFilters = {};
        if (isContest && contestId) {
          // 比赛提交：只保留 test=比赛编号（上下文），不筛选单题 pid（用户明确要求）
          statusFilters = { test: contestId, contestId: contestId };
          // 比赛提交：严格依据 supportsStatus 判断
          if (permInfo && typeof permInfo.supportsStatus === 'boolean') {
            shouldJump = permInfo.supportsStatus;
          } else {
            // 未知权限：默认不跳转（避免不支持的比赛误跳转）
            shouldJump = false;
          }
          if (!shouldJump) {
            // 说明不支持，给个轻量提示（不在 info message 里重复弹出，console 记录即可）
            }
        } else {
          // 练习提交：默认跳转（用户明确要求递交代码后跳转评测列表），不要加筛选 pid 的条件
          statusFilters = {};
          shouldJump = true;
        }
        if (shouldJump) {
          vscode.commands.executeCommand('yzoj.showStatusList', statusFilters);
        }
      } catch (_jumpErr) {
      }
      // 更新映射
      if (!bound && problemUrl) {
        const tsNow = new Date().toISOString();
        map[filePath] = {
          problemId,
          contestId: isContest ? contestId : null,
          isContest,
          url: problemUrl,
          createdAt: tsNow,
          updatedAt: tsNow,
          converted: false
        };
        await saveMap(map);
      } else if (bound) {
        // 已绑定：更新 updatedAt 时间戳
        const tsNow = new Date().toISOString();
        const before = JSON.stringify(bound);
        bound.updatedAt = tsNow;
        // 确保存在基础字段
        if (!bound.createdAt) bound.createdAt = tsNow;
        if (typeof bound.converted !== 'boolean') bound.converted = !!bound.converted;
        if (JSON.stringify(bound) !== before) {
          map[filePath] = bound;
          await saveMap(map);
        }
      }
    } else {
      const errText = await res.text().catch(() => '');
      vscode.window.showErrorMessage(`❌ 提交失败: ${res.status} ${res.statusText}\n${errText.slice(0, 200)}`);
    }
  } catch (err) {
    vscode.window.showErrorMessage(`❌ 网络异常: ${err.message}`);
  }
}

/**
 * 📤 发送至 CPH（保持原逻辑，附带样例数据）
 */
async function handleSendToCPH(problem, panel) {
  try {
    let tests = [];
    if (Array.isArray(problem.tests) && problem.tests.length > 0) {
      tests = problem.tests.map(function(t){return {input:String((t&&t.input!=null)?t.input:''),output:String((t&&t.output!=null)?t.output:'')}});
    } else if (Array.isArray(problem.samples) && problem.samples.length > 0) {
      tests = problem.samples.map(function(s){return {input:String((s&&s.input!=null)?s.input:''),output:String((s&&s.output!=null)?s.output:'')}});
    }

    function normBytes(v){ try { return Buffer.from(String(v==null?'':v),'utf8').length; } catch(e){ return 0; } }
    tests = tests.filter(function(t){
      var hasIn = (t.input||'').trim() !== '';
      var hasOut = (t.output||'').trim() !== '';
      return hasIn || hasOut;
    });
    // CPH 建议的字段：{ input, output, dataType: 'utf-8-fs', ... }
    // 这里仅保留最简 {input,output}
    var payload = JSON.stringify({
      name: problem.name,
      group: problem.group,
      url: problem.url,
      interactive: false,
      memoryLimit: problem.memoryLimit || 256,
      timeLimit: problem.timeLimit || 1000,
      tests: tests,
      srcPath: problem.srcPath || null,
      batch: problem.batch || null
    });
    logger.log('[DEBUG handleSendToCPH] testCount=' + tests.length + ' totalBytes=' + normBytes(payload));

    const http = require('http');
    const options = {
      hostname: '127.0.0.1',
      port: 27121,
      path: '/',
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode === 200) {
          vscode.window.showInformationMessage(`✅ 已成功发送至 CPH: ${problem.name}（含 ${tests.length} 组样例）`);
        } else {
          vscode.window.showErrorMessage(`❌ CPH 响应异常: ${res.statusCode}`);
        }
      });
    });

    req.on('error', (e) => {
      vscode.window.showWarningMessage(
        `⚠️ 未检测到 CPH 插件\n请确保：\n1. CPH 已打开\n2. 监听端口为 27121\n\n错误详情：${e.message}`
      );
    });

    req.write(payload);
    req.end();
    
  } catch (err) {
    vscode.window.showErrorMessage(`❌ 发送失败: ${err.message}`);
  }
}

// 🔑 代理服务器地址
const PROXY_SERVER = 'http://127.0.0.1:8199';

/**
 * 🔄 检查代理服务器是否可用
 */
async function isProxyAvailable() {
  try {
    const http = require('http');
    return new Promise((resolve) => {
      const req = http.get(`${PROXY_SERVER}/api/health`, (res) => {
        resolve(res.statusCode === 200);
      });
      req.on('error', () => resolve(false));
      req.setTimeout(2000, () => { req.destroy(); resolve(false); });
    });
  } catch { return false; }
}

/**
 * 🔄 获取比赛题号映射（比赛结束后用真实题号替换赛时编号）
 */
async function getContestProblemIds(contestId) {
  const proxyAvail = await isProxyAvailable();
  if (!proxyAvail) return null;
  
  try {
    const http = require('http');
    return new Promise((resolve, reject) => {
      const req = http.get(`${PROXY_SERVER}/api/contest/${contestId}/mappings`, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch { resolve(null); }
        });
      });
      req.on('error', reject);
      req.setTimeout(5000, () => { req.destroy(); reject(new Error('timeout')); });
    });
  } catch { return null; }
}

module.exports = { 
  handleCreateContestFolder, 
  handleSubmitCode,
  handleSendToCPH,
  getMap,
  saveMap,
  getMapAtPath,
  saveMapAtPath,
  getAllTrackedMapPaths,
  registerMapPath,
  unregisterMapPath,
  checkAndCleanMapAtPath,
  periodicCheckAllMaps,
  convertEndedContestsAtPath,
  getContestProblemIds,
  isProxyAvailable
};
