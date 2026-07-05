// ac.js - AC 自动机多模式匹配
// 用于高速多关键字匹配，替代重复的 string.includes() 调用

/**
 * 构建 AC 自动机
 * @param {string[]} patterns - 模式串数组
 * @returns {object} 自动机根节点
 */
function build(patterns) {
  var root = { next: {}, fail: null, output: [] };
  for (var pi = 0; pi < patterns.length; pi++) {
    var p = patterns[pi];
    var node = root;
    for (var ci = 0; ci < p.length; ci++) {
      var c = p[ci];
      if (!node.next[c]) node.next[c] = { next: {}, fail: null, output: [] };
      node = node.next[c];
    }
    node.output.push(pi);
  }
  var queue = [];
  for (var c in root.next) {
    root.next[c].fail = root;
    queue.push(root.next[c]);
  }
  while (queue.length) {
    var node = queue.shift();
    for (var c in node.next) {
      var child = node.next[c];
      var fail = node.fail;
      while (fail && !fail.next[c]) fail = fail.fail;
      child.fail = fail ? fail.next[c] : root;
      child.output = child.output.concat(child.fail.output);
      queue.push(child);
    }
  }
  return root;
}

/**
 * 在文本中搜索所有模式串
 * @param {string} text - 待搜索文本
 * @param {object} root - build() 返回的自动机根节点
 * @returns {number[]} 匹配到的模式串索引数组（去重）
 */
function match(text, root) {
  var node = root;
  var matched = {};
  for (var i = 0; i < text.length; i++) {
    var c = text[i];
    while (node !== root && !node.next[c]) node = node.fail;
    if (node.next[c]) { node = node.next[c]; } else { node = root; }
    if (node.output.length) {
      for (var k = 0; k < node.output.length; k++) {
        matched[node.output[k]] = true;
      }
    }
  }
  return Object.keys(matched).map(Number);
}

/**
 * 检查文本是否匹配任意模式串
 * @param {string} text - 待搜索文本
 * @param {object} root - build() 返回的自动机根节点
 * @returns {boolean}
 */
function test(text, root) {
  var node = root;
  for (var i = 0; i < text.length; i++) {
    var c = text[i];
    while (node !== root && !node.next[c]) node = node.fail;
    if (node.next[c]) { node = node.next[c]; } else { node = root; }
    if (node.output.length) return true;
  }
  return false;
}

module.exports = { build: build, match: match, test: test };
