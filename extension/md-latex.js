// Markdown + LaTeX ↔ HTML 双向转换器
// 引擎：markdown-it + @vscode/markdown-it-katex
// 统一渲染入口：mdToHtml（Markdown）、mdLatexToHtml（Markdown + 实体解码）

const MarkdownIt = require('markdown-it');
var markdownItKatex = require('@vscode/markdown-it-katex').default;
// 如果 default 不存在，回退到直接使用模块本身
if (!markdownItKatex) markdownItKatex = require('@vscode/markdown-it-katex');

const HIDDEN_MARKER = '<!-- yzoj-md-content -->';

// =========================== markdown-it 实例 ===========================

var md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
  highlight: function (str, lang) {
    if (lang && supportedLanguages.indexOf(lang.toLowerCase()) !== -1) {
      try {
        var highlighted = highlightSyntax(str, lang.toLowerCase());
        return '<pre class="code-block"><code class="language-' + lang.toLowerCase() + '">' + highlighted + '</code></pre>';
      } catch (e) {}
    }
    return ''; // 返回空字符串使用 markdown-it 默认转义
  }
});
md.use(markdownItKatex, { throwOnError: false });

// 用于 YZOJ 提交的实例：无 KaTeX，让 YZOJ 的 MathJax 处理公式
var mdNoKatex = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true
});
// 注意：不使用 katex 插件，LaTeX 定界符（$$...$$、$...$、\(...\)、\[...\]）
// 原样保留在 HTML 中，由 YZOJ 页面的 MathJax 渲染

// =========================== HTML 转义 ===========================

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function unescapeHtml(str) {
  return String(str)
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

// =========================== YZOJ HTML 实体解码 ===========================
// 将 OJ 页面中 HTML 转义的内容还原为原始字符
// 例如：$1 &gt; 2$ → $1 > 2$

function _decodeHtmlEntities(text) {
  return String(text)
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, function(m,n){return String.fromCharCode(parseInt(n,10));})
    .replace(/&#x([0-9a-f]+);/gi, function(m,n){return String.fromCharCode(parseInt(n,16));});
}

// =========================== 代码语法高亮 ===========================

var supportedLanguages = ['cpp', 'c', 'java', 'python', 'pascal', 'javascript', 'js', 'typescript', 'ts', 'c#', 'csharp', 'cs', 'go', 'rust', 'ruby', 'php', 'swift', 'kotlin', 'scala', 'sql', 'html', 'css', 'xml', 'json', 'yaml', 'yml', 'markdown', 'md', 'bash', 'sh', 'shell', 'powershell', 'ps1', 'dockerfile', 'makefile', 'cmake', 'latex', 'tex', 'r', 'perl', 'lua', 'haskell', 'scala', 'clojure', 'fsharp', 'ocaml', 'erlang', 'elixir', 'vim', 'viml', 'toml', 'ini', 'diff', 'patch', 'asm', 'assembly', 'mips', 'arm', 'x86', 'verilog', 'vhdl', 'systemverilog', 'log'];

function highlightSyntax(code, lang) {
  var keywords = {
    cpp: ['int','long','short','float','double','char','bool','void','string','auto','const','static','extern','register','volatile','typedef','struct','union','enum','class','public','private','protected','virtual','override','final','template','typename','namespace','using','new','delete','this','nullptr','true','false','if','else','switch','case','default','while','for','do','break','continue','return','goto','try','catch','throw','inline','friend','operator','sizeof','typeid','dynamic_cast','static_cast','reinterpret_cast','const_cast','include','define','ifdef','ifndef','endif','pragma'],
    c: ['int','long','short','float','double','char','void','const','static','extern','register','volatile','typedef','struct','union','enum','if','else','switch','case','default','while','for','do','break','continue','return','goto','sizeof','include','define','ifdef','ifndef','endif','pragma'],
    java: ['int','long','short','float','double','char','boolean','byte','void','String','final','static','abstract','synchronized','volatile','transient','native','strictfp','class','interface','extends','implements','public','private','protected','package','import','new','this','super','null','true','false','if','else','switch','case','default','while','for','do','break','continue','return','throw','throws','try','catch','finally','instanceof','enum','assert','const','goto'],
    python: ['def','class','import','from','as','if','elif','else','for','while','break','continue','return','yield','try','except','finally','raise','with','pass','lambda','global','nonlocal','in','is','not','and','or','True','False','None','self','del','assert','async','await'],
    pascal: ['program','unit','uses','const','var','type','procedure','function','begin','end','if','then','else','case','of','for','to','downto','do','while','repeat','until','break','continue','exit','array','record','string','integer','real','boolean','char','byte','word','longint','shortint','single','double','extended','comp','currency','set','file','text','nil','true','false','and','or','not','xor','div','mod','in','shr','shl','as','is','class','object','interface','implementation','initialization','finalization'],
    javascript: ['var','let','const','function','return','if','else','for','while','do','switch','case','break','continue','new','this','class','extends','super','import','export','from','default','async','await','try','catch','finally','throw','typeof','instanceof','in','of','true','false','null','undefined','NaN','Infinity']
  };

  var kwList = keywords[lang] || keywords.cpp;
  var lines = code.split('\n');
  var result = [];
  var inBlockComment = false;
  var inString = '';

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var out = '';
    var j = 0;

    while (j < line.length) {
      if (inBlockComment) {
        var endIdx = line.indexOf('*/', j);
        if (endIdx !== -1) {
          out += '<span style="color:#6a9955">' + line.substring(j, endIdx + 2) + '</span>';
          j = endIdx + 2;
          inBlockComment = false;
        } else {
          out += '<span style="color:#6a9955">' + line.substring(j) + '</span>';
          j = line.length;
        }
        continue;
      }

      if (inString) {
        var strEnd = line.indexOf(inString, j);
        var esc = false;
        var pos = j;
        while (pos < line.length) {
          if (line[pos] === '\\') { esc = !esc; pos++; continue; }
          if (line[pos] === inString && !esc) { strEnd = pos; break; }
          esc = false;
          pos++;
        }
        if (strEnd !== -1 && strEnd >= j) {
          out += '<span style="color:#ce9178">' + line.substring(j, strEnd + 1) + '</span>';
          j = strEnd + 1;
          inString = '';
        } else {
          out += '<span style="color:#ce9178">' + line.substring(j) + '</span>';
          j = line.length;
        }
        continue;
      }

      var nextChar = line[j];
      // String starts
      if ((nextChar === '"' || nextChar === "'" || nextChar === '`') && (j === 0 || line[j-1] !== '\\')) {
        inString = nextChar;
        out += nextChar;
        j++;
        continue;
      }

      // Line comment
      if (nextChar === '/' && j + 1 < line.length && line[j+1] === '/') {
        out += '<span style="color:#6a9955">' + line.substring(j) + '</span>';
        j = line.length;
        continue;
      }

      // Block comment start
      if (nextChar === '/' && j + 1 < line.length && line[j+1] === '*') {
        var endIdx = line.indexOf('*/', j + 2);
        if (endIdx !== -1) {
          out += '<span style="color:#6a9955">' + line.substring(j, endIdx + 2) + '</span>';
          j = endIdx + 2;
        } else {
          out += '<span style="color:#6a9955">' + line.substring(j) + '</span>';
          j = line.length;
          inBlockComment = true;
        }
        continue;
      }

      // Numbers
      if (/[0-9]/.test(nextChar) && (j === 0 || /[\s\(\)\[\]{},;:+\-*/%=<>!&|^~]/.test(line[j-1]))) {
        var numEnd = j;
        if (numEnd + 1 < line.length && line[numEnd] === '0' && (line[numEnd+1] === 'x' || line[numEnd+1] === 'X')) {
          numEnd += 2;
          while (numEnd < line.length && /[0-9a-fA-F]/.test(line[numEnd])) numEnd++;
        } else {
          while (numEnd < line.length && /[0-9.]/.test(line[numEnd])) numEnd++;
          if (numEnd < line.length && (line[numEnd] === 'e' || line[numEnd] === 'E')) {
            numEnd++;
            if (numEnd < line.length && (line[numEnd] === '+' || line[numEnd] === '-')) numEnd++;
            while (numEnd < line.length && /[0-9]/.test(line[numEnd])) numEnd++;
          }
        }
        if (numEnd > j + (line[j] === '0' && j + 1 < line.length && (line[j+1] === 'x' || line[j+1] === 'X') ? 2 : 1)) {
          out += '<span style="color:#b5cea8">' + line.substring(j, numEnd) + '</span>';
          j = numEnd;
          continue;
        }
      }

      // Keywords
      if (/[a-zA-Z_]/.test(nextChar)) {
        var kwEnd = j;
        while (kwEnd < line.length && /[a-zA-Z0-9_]/.test(line[kwEnd])) kwEnd++;
        var word = line.substring(j, kwEnd);
        if (kwList.indexOf(word) !== -1) {
          out += '<span style="color:#569cd6">' + word + '</span>';
          j = kwEnd;
          continue;
        }
        // Function call detection
        if (kwEnd < line.length && line[kwEnd] === '(') {
          out += '<span style="color:#dcdcaa">' + word + '</span>';
          j = kwEnd;
          continue;
        }
        out += word;
        j = kwEnd;
        continue;
      }

      // Operators and punctuation
      if (/[\[\](){}]/.test(nextChar)) {
        out += '<span style="color:#ffd700">' + nextChar + '</span>';
        j++;
        continue;
      }
      // Preprocessor
      if (nextChar === '#' && (j === 0 || line[j-1] === '\n' || line[j-1] === '\r')) {
        out += '<span style="color:#569cd6">' + line.substring(j) + '</span>';
        j = line.length;
        continue;
      }

      out += escHtml(nextChar);
      j++;
    }
    result.push(out);
  }
  return result.join('\n');
}

// =========================== mdToHtml（Markdown → HTML） ===========================
// 使用 markdown-it + markdown-it-katex 渲染
// 用于 webview 中的标题、描述等

function mdToHtml(text) {
  if (!text) return '';
  var s = _normalizeLatexDelimiters(text);
  try {
    return md.render(s);
  } catch (e) {
    return '<p>' + escHtml(s) + '</p>';
  }
}

// =========================== LaTeX 定界符归一化 ===========================
// 将 YZOJ 常用的 MathJax 风格定界符转换为 markdown-it-katex 识别的格式
// \(...\) → $...$（行内公式）
// \[...\] → $$...$$（展示公式）

function _normalizeLatexDelimiters(text) {
  var result = String(text)
    // 展示公式：\[ ... \] → $$ ... $$（仅当内容包含 LaTeX 命令如 \int\sum\le... 时才转换，
    // 避免将 markdown 中用作字面量转义方括号的 \[xxx\] 误转为 LaTeX）
    .replace(/\\\[([\s\S]*?)\\\]/g, function(match, content) {
      if (/\\[a-zA-Z]/.test(content)) {
        return '$$\n' + content.trim() + '\n$$';
      }
      // 不含 LaTeX 命令时，用 HTML 实体代替 \[ 和 \]，防止 markdown-it
      // 将 \[ 解释为转义括号而输出 [xxx]，同时避免 KaTeX 客户端自动渲染拾取
      return '&#91;' + content + '&#93;';
    })
    // 行内公式：\( ... \) → $ ... $（同样仅当内容含 LaTeX 命令时转换）
    .replace(/\\\(([\s\S]*?)\\\)/g, function(match, content) {
      if (/\\[a-zA-Z]/.test(content)) {
        return '$' + content.trim() + '$';
      }
      // 不含 LaTeX 命令时，用 HTML 实体代替 \( 和 \)，防止 KaTeX
      // 客户端自动渲染将 \(xxx\) 当作数学公式处理
      return '&#40;' + content + '&#41;';
    });
  return result;
}

// =========================== mdLatexToHtml（Markdown + LaTeX → HTML，含实体解码） ===========================
// 与 mdToHtml 的区别：先解码 HTML 实体（来自 OJ 页面的内容可能含 &gt; &amp; 等转义）
// 用于用户 bio、讨论区内容等来自 OJ 页面解析的文本

function mdLatexToHtml(text) {
  if (!text) return '';
  var s = _decodeHtmlEntities(text);
  s = _normalizeLatexDelimiters(s);
  // 将原始源码用隐藏 div 包裹 + HIDDEN_MARKER 标记，方便后续精确还原
  var escapedSource = escHtml(text);
  var rendered;
  try {
    rendered = mdNoKatex.render(s);
  } catch (e) {
    // 渲染失败时回退到纯文本
    rendered = '<p>' + escHtml(s) + '</p>';
  }
  return '<div style="display:none" data-yzoj-source="true">' + escapedSource + '</div>\n' + HIDDEN_MARKER + '\n' + rendered;
}

// =========================== HTML → Markdown + LaTeX ===========================

function htmlToMdLatex(html) {
  if (!html) return '';
  // 优先从隐藏的源码容器提取原始 markdown（精确还原）
  var sourceMatch = html.match(/<div[^>]*data-yzoj-source="true"[^>]*>([\s\S]*?)<\/div>/);
  if (sourceMatch) {
    return unescapeHtml(sourceMatch[1]);
  }
  if (html.indexOf(HIDDEN_MARKER) === -1) return html;
  var s = html.replace(HIDDEN_MARKER, '').trim();

  // KaTeX 格式：注意必须在其他替换之前处理
  // 行内公式：<span class="katex">...<annotation encoding="application/x-tex">LATEX</annotation>...</span>
  // 展示公式：<span class="katex katex-display">...<annotation encoding="application/x-tex">LATEX</annotation>...</span>
  s = s.replace(/<span class="katex[^"]*katex-display[^"]*">[\s\S]*?<annotation encoding="application\/x-tex">([\s\S]*?)<\/annotation>[\s\S]*?<\/span>/g, function(m, latex) {
    return '$$\n' + latex.trim() + '\n$$';
  });
  s = s.replace(/<span class="katex">[\s\S]*?<annotation encoding="application\/x-tex">([\s\S]*?)<\/annotation>[\s\S]*?<\/span>/g, function(m, latex) {
    return '$' + latex.trim() + '$';
  });

  // 兼容旧的 MathJax 格式
  s = s.replace(/<div class="math-block">\\\[([\s\S]*?)\\\]<\/div>/g, '$$\n$1\n$$');
  s = s.replace(/<span class="math-inline">\\\(([\s\S]*?)\\\)<\/span>/g, function(m, inner) {
    return inner.indexOf('\n') >= 0 ? '$$\n' + inner.trim() + '\n$$' : '$' + inner.trim() + '$';
  });

  // markdown-it 输出的代码块格式
  s = s.replace(/<pre class="code-block"><code(?:\s+class="language-(\w+)")?>([\s\S]*?)<\/code><\/pre>/g, function(m, lang, code) {
    return '```' + (lang || '') + '\n' + unescapeHtml(code.trim()) + '\n```';
  });
  s = s.replace(/<pre><code(?:\s+class="language-(\w+)")?>([\s\S]*?)<\/code><\/pre>/g, function(m, lang, code) {
    return '```' + (lang || '') + '\n' + unescapeHtml(code.trim()) + '\n```';
  });
  s = s.replace(/<code>([^<]+)<\/code>/g, '`$1`');
  s = s.replace(/<samp>([\s\S]*?)<\/samp>/g, '`$1`');
  s = s.replace(/<img[^>]+src="([^"]+)"[^>]*alt="([^"]*)"[^>]*>/g, '![$2]($1)');
  s = s.replace(/<img[^>]+src="([^"]+)"[^>]*>/g, '![]($1)');
  s = s.replace(/<a\s+[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g, '[$2]($1)');
  s = s.replace(/<strong>([\s\S]*?)<\/strong>/g, '**$1**');
  s = s.replace(/<b>([\s\S]*?)<\/b>/g, '**$1**');
  s = s.replace(/<em>([\s\S]*?)<\/em>/g, '*$1*');
  s = s.replace(/<i>([\s\S]*?)<\/i>/g, '*$1*');
  s = s.replace(/<del>([\s\S]*?)<\/del>/g, '~~$1~~');
  s = s.replace(/<h1>([\s\S]*?)<\/h1>/g, '# $1');
  s = s.replace(/<h2>([\s\S]*?)<\/h2>/g, '## $1');
  s = s.replace(/<h3>([\s\S]*?)<\/h3>/g, '### $1');
  s = s.replace(/<h4>([\s\S]*?)<\/h4>/g, '#### $1');
  s = s.replace(/<h5>([\s\S]*?)<\/h5>/g, '##### $1');
  s = s.replace(/<h6>([\s\S]*?)<\/h6>/g, '###### $1');
  s = s.replace(/<hr\s*\/?>/g, '\n---\n');
  s = s.replace(/<blockquote>([\s\S]*?)<\/blockquote>/g, function(m, content) {
    return content.trim().split('\n').map(function(l) { return '> ' + l.trim(); }).join('\n') + '\n\n';
  });
  s = s.replace(/<table>([\s\S]*?)<\/table>/g, function(m, content) {
    var trMatches = content.match(/<tr>([\s\S]*?)<\/tr>/g);
    if (!trMatches) return m;
    var mdRows = [], isHeader = false;
    for (var ti = 0; ti < trMatches.length; ti++) {
      var trContent = trMatches[ti].replace(/<\/?tr>/g, '');
      var thMatch = trContent.match(/<th>([\s\S]*?)<\/th>/g);
      var tdMatch = trContent.match(/<td>([\s\S]*?)<\/td>/g);
      var cellTags = thMatch || tdMatch;
      if (!cellTags) continue;
      var mdCells = [];
      for (var ci = 0; ci < cellTags.length; ci++) mdCells.push(cellTags[ci].replace(/<\/?t[hd]>/g, '').trim());
      if (thMatch) isHeader = true;
      mdRows.push('| ' + mdCells.join(' | ') + ' |');
    }
    if (mdRows.length > 0) {
      if (isHeader) mdRows.splice(1, 0, '|' + new Array(mdRows[0].split('|').length - 2).fill(' --- ').join('|') + '|');
      return mdRows.join('\n') + '\n\n';
    }
    return m;
  });
  s = s.replace(/<ol>([\s\S]*?)<\/ol>/g, function(m, content) {
    var liMatches = content.match(/<li>([\s\S]*?)<\/li>/g);
    if (!liMatches) return content;
    var lines = [];
    for (var oi = 0; oi < liMatches.length; oi++) lines.push((oi + 1) + '. ' + liMatches[oi].replace(/<\/?li>/g, '').trim());
    return lines.join('\n') + '\n\n';
  });
  s = s.replace(/<ul>([\s\S]*?)<\/ul>/g, function(m, content) {
    var liMatches = content.match(/<li>([\s\S]*?)<\/li>/g);
    if (!liMatches) return content;
    return liMatches.map(function(l) { return '- ' + l.replace(/<\/?li>/g, '').trim(); }).join('\n') + '\n\n';
  });
  s = s.replace(/<p>([\s\S]*?)<\/p>/g, '$1\n\n');
  s = s.replace(/<br\s*\/?>/g, '\n');
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

// =========================== 导出 ===========================

module.exports = {
  HIDDEN_MARKER: HIDDEN_MARKER,
  mdToHtml: mdToHtml,
  mdLatexToHtml: mdLatexToHtml,
  htmlToMdLatex: htmlToMdLatex,
  escHtml: escHtml
};
