// logger.js - 无操作日志（发布版已移除所有控制台输出）

function log() {
}

function logObj(label, obj) {
}

function flush() {
  return Promise.resolve();
}

function getLogPath() {
  return '';
}

module.exports = {
  log: log,
  logObj: logObj,
  flush: flush,
  getLogPath: getLogPath
};
