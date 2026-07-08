// Markdown + LaTeX ↔ HTML 双向转换器
// 引擎：markdown-it + @vscode/markdown-it-katex
// 统一渲染入口：mdToHtml（Markdown）、mdLatexToHtml（Markdown + 实体解码）

const MarkdownIt = require('markdown-it');
var markdownItKatex = require('@vscode/markdown-it-katex').default;
// 如果 default 不存在，回退到直接使用模块本身
if (!markdownItKatex) markdownItKatex = require('@vscode/markdown-it-katex');

const HIDDEN_MARKER = '<!-- yzoj-md-content -->';

// 折叠框 CSS（嵌入到 YZOJ 提交的 HTML 中，确保网页端正确渲染）
var YZOJ_FOLD_CSS = 'details.yzoj-fold{border:1px solid #d0d7de;border-radius:8px;margin:12px 0;overflow:hidden;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,0.04)}' +
'details.yzoj-fold summary.yzoj-fold-summary{cursor:pointer;font-weight:600;font-size:13px;background:#f6f8fa;color:#333;user-select:none;padding:8px 14px 8px 28px;position:relative;list-style:none}' +
'details.yzoj-fold summary.yzoj-fold-summary::-webkit-details-marker{display:none}' +
'details.yzoj-fold summary.yzoj-fold-summary:hover{background:#eef1f5}' +
'details.yzoj-fold summary.yzoj-fold-summary::before{content:\"\";position:absolute;left:12px;top:50%;width:6px;height:6px;border-right:1.5px solid #666;border-bottom:1.5px solid #666;transform:translateY(-50%) rotate(-45deg);transition:transform 0.2s ease}' +
'details.yzoj-fold[open] summary.yzoj-fold-summary::before{transform:translateY(-50%) rotate(45deg)}' +
'details.yzoj-fold .yzoj-fold-content{padding:10px 14px;font-size:14px;line-height:1.7}' +
'details.yzoj-fold .yzoj-fold-content>:first-child{margin-top:0}' +
'details.yzoj-fold .yzoj-fold-content>:last-child{margin-bottom:0}' +
'details.yzoj-fold-info{border-color:#0969da}' +
'details.yzoj-fold-info>summary.yzoj-fold-summary{color:#0969da;background:#f0f6ff}' +
'details.yzoj-fold-info>summary.yzoj-fold-summary::before{border-color:#0969da}' +
'details.yzoj-fold-info>.yzoj-fold-content{background:#f0f6ff}' +
  'details.yzoj-fold-success{border-color:#2ea043}' +
  'details.yzoj-fold-success>summary.yzoj-fold-summary{color:#2ea043;background:#f0faf3}' +
  'details.yzoj-fold-success>summary.yzoj-fold-summary::before{border-color:#2ea043}' +
  'details.yzoj-fold-success>.yzoj-fold-content{background:#f0faf3}' +
  'details.yzoj-fold-warning{border-color:#d4920b}' +
  'details.yzoj-fold-warning>summary.yzoj-fold-summary{color:#b47a08;background:#fef8ec}' +
  'details.yzoj-fold-warning>summary.yzoj-fold-summary::before{border-color:#b47a08}' +
  'details.yzoj-fold-warning>.yzoj-fold-content{background:#fef8ec}' +
  'details.yzoj-fold-error{border-color:#cf222e}' +
  'details.yzoj-fold-error>summary.yzoj-fold-summary{color:#cf222e;background:#fff0f0}' +
  'details.yzoj-fold-error>summary.yzoj-fold-summary::before{border-color:#cf222e}' +
  'details.yzoj-fold-error>.yzoj-fold-content{background:#fff0f0}';

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

// 专用于提交到 YZOJ 的实例：禁用 typographer（避免智能引号等替换导致 YZOJ 显示异常）
var mdForYzoj = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: false,
  breaks: false
});
// 为表格添加 class，使 CSS 能精确选中 markdown 生成的表格而不影响 YZOJ 自身的布局表格
mdForYzoj.renderer.rules.table_open = function(tokens, idx, options, env, self) {
  return '<table class="yzoj-md-table">';
};
// YZOJ 的 reset.css 设置了 ol,ul,li{list-style:none}
// 改用 <div> + CSS ::before 伪元素渲染列表，彻底避开 reset.css
mdForYzoj.renderer.rules.bullet_list_open = function() { return '<div class="yzoj-md-ul">'; };
mdForYzoj.renderer.rules.bullet_list_close = function() { return '</div>'; };
mdForYzoj.renderer.rules.ordered_list_open = function() { return '<div class="yzoj-md-ol">'; };
mdForYzoj.renderer.rules.ordered_list_close = function() { return '</div>'; };
mdForYzoj.renderer.rules.list_item_open = function() { return '<div class="yzoj-md-li">'; };
mdForYzoj.renderer.rules.list_item_close = function() { return '</div>'; };

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

// =========================== 自定义 Markdown 特性预处理 ===========================
// 在处理之前，将 YZOJ 增强语法转换为 HTML

function _preprocessMarkdown(text, mdInstance) {
  if (!text) return '';
  var s = String(text);
  
  // 1. 处理折叠框/居中等 ::: 容器语法（先处理，避免与后续步骤冲突）
  //    ::::info[title]{open}  ...  ::::
  //    :::align{center} ... :::
  s = _processContainerBlocks(s, mdInstance);
  
  // 2. 处理 ::cute-table{tuack} 语法（包裹下一个表格）
  s = s.replace(/::cute-table\{tuack\}\s*\n([\s\S]*?)(?=\n\n|$)/g, function(m, content) {
    return '<div class="cute-table tuack">\n\n' + content + '\n\n</div>';
  });
  
  return s;
}

// 处理 ::: 容器块（支持嵌套），预渲染内部 Markdown+LaTeX 内容
function _processContainerBlocks(text, mdInstance) {
  var lines = text.split('\n');
  var result = [];
  var i = 0;
  
  while (i < lines.length) {
    var line = lines[i];
    // 检测 ::: 开闭标记（至少3个:）
    var openMatch = line.match(/^(:{3,})\s*(\w+)(?:\[([^\]]*)\])?(?:\{(\w+)\})?\s*$/);
    if (openMatch) {
      var colons = openMatch[1];
      var type = openMatch[2];
      var title = openMatch[3] || '';
      var attr = openMatch[4] || '';
      var level = colons.length;
      
      if (type === 'info' || type === 'success' || type === 'warning' || type === 'error' || type === 'align' || type === 'epigraph') {
        // 收集容器内部所有内容（支持嵌套）
        var innerLines = [];
        var innerStack = [{level: level}];
        i++;
        
        while (i < lines.length) {
          var curLine = lines[i];
          
          // 检查是否为关闭标记
          var cMatch = curLine.match(/^(:{3,})\s*$/);
          if (cMatch) {
            var closeLevel = cMatch[1].length;
            // 在栈中找到相同层级
            var found = -1;
            for (var si = innerStack.length - 1; si >= 0; si--) {
              if (innerStack[si].level === closeLevel) { found = si; break; }
            }
            if (found >= 0) {
              innerStack.length = found;
              if (innerStack.length === 0) break; // 当前容器完全关闭
              // 对于嵌套容器的关闭标记，不跳过 —— 保留在 innerLines 中
              // 让递归的 _preprocessInnerContent 处理它
            }
          }
          
          // 检查是否为嵌套的开启标记
          var oMatch = curLine.match(/^(:{3,})\s*(\w+)(?:\[([^\]]*)\])?(?:\{(\w+)\})?\s*$/);
          if (oMatch) {
            innerStack.push({level: oMatch[1].length});
          }
          
          innerLines.push(curLine);
          i++;
        }
        
        // 预处理内部内容：递归处理嵌套容器 + cute-table
        var innerContent = innerLines.join('\n');
        innerContent = _preprocessInnerContent(innerContent, mdInstance);
        
        // 渲染内部 Markdown+LaTeX（如果提供了 mdInstance）
        var renderedInner;
        if (mdInstance) {
          try {
            renderedInner = _postProcessTable(mdInstance.render(innerContent));
          } catch (e) {
            renderedInner = '<p>' + escHtml(innerContent) + '</p>';
          }
        } else {
          renderedInner = innerContent;
        }
        
        // 包装为容器 HTML
        var html = '';
        if (type === 'align') {
          var align = title || attr || 'center';
          html = '<div style="text-align:' + align + '">' + renderedInner + '</div>';
        } else if (type === 'epigraph') {
          html = '<div class="yzoj-epigraph">' + renderedInner + '</div>';
          if (title) {
            html = '<div class="yzoj-epigraph-attrib">—— ' + escHtml(title) + '</div>' + html;
          }
        } else {
          var openAttr = attr === 'open' ? ' open' : '';
          html = '<details class="yzoj-fold yzoj-fold-' + type + '"' + openAttr + '>';
          html += '<summary class="yzoj-fold-summary">' + (title || type) + '</summary>';
          html += '<div class="yzoj-fold-content">' + renderedInner + '</div></details>';
        }
        
        result.push(html);
        i++;
        continue;
      }
      // 未知类型，原样输出
      result.push(line);
      i++;
      continue;
    }
    
    result.push(line);
    i++;
  }
  
  return result.join('\n');
}

// 预处理容器内部内容：递归处理嵌套容器 + cute-table
function _preprocessInnerContent(text, mdInstance) {
  if (!text) return '';
  // 递归处理嵌套容器
  text = _processContainerBlocks(text, mdInstance);
  // 将软换行转为段落分隔，使每行独立成 <p>（与 mdLatexToHtmlForYzoj 保持一致）
  text = text.replace(/  \n/g, '\n\n');
  // 处理 cute-table
  text = text.replace(/::cute-table\{tuack\}\s*\n([\s\S]*?)(?=\n\n|$)/g, function(m, content) {
    return '<div class="cute-table tuack">\n\n' + content + '\n\n</div>';
  });
  return text;
}

// 表格合并后处理：处理 ^（向上合并）和 <（向左合并）
function _postProcessTable(html) {
  if (!html) return html;
  // 使用正则匹配表格
  return html.replace(/<table>([\s\S]*?)<\/table>/g, function(tableMatch, tableContent) {
    var rows = tableContent.match(/<tr>[\s\S]*?<\/tr>/g);
    if (!rows || rows.length === 0) return tableMatch;
    
    // 解析所有单元格
    var grid = [];
    for (var ri = 0; ri < rows.length; ri++) {
      var cells = [];
      var cellMatches = rows[ri].match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/g);
      if (cellMatches) {
        for (var ci = 0; ci < cellMatches.length; ci++) {
          cells.push(cellMatches[ci]);
        }
      }
      grid.push(cells);
    }
    
    // 第一轮：处理 ^（向上合并）
    for (var r = grid.length - 1; r >= 0; r--) {
      for (var c = 0; c < grid[r].length; c++) {
        var cellContent = grid[r][c].replace(/<t[dh][^>]*>/, '').replace(/<\/t[dh]>/, '').trim();
        // 替换 &#94; (&amp;#94;) 等实体
        var decoded = cellContent.replace(/&amp;#94;/g, '^').replace(/&#94;/g, '^').replace(/&Hat;/g, '^');
        if (decoded === '^' || decoded === '^') {
          // 向上合并：找到上方的单元格，增加 rowspan
          if (r > 0) {
            var upperCell = grid[r-1][c];
            if (upperCell) {
              var rowspanMatch = upperCell.match(/rowspan=["'](\d+)["']/);
              var rowspan = rowspanMatch ? parseInt(rowspanMatch[1]) : 1;
              // 替换或添加 rowspan
              if (rowspanMatch) {
                grid[r-1][c] = upperCell.replace(/rowspan=["'](\d+)["']/, 'rowspan="' + (rowspan + 1) + '"');
              } else {
                grid[r-1][c] = upperCell.replace(/<t[dh]/, '<t[dh] rowspan="' + (rowspan + 1) + '"');
              }
              // 标记当前行为删除
              grid[r][c] = '<!-- MERGED -->';
            }
          }
        }
      }
    }
    
    // 第二轮：处理 <（向左合并）
    for (var r2 = 0; r2 < grid.length; r2++) {
      for (var c2 = grid[r2].length - 1; c2 >= 0; c2--) {
        if (grid[r2][c2] === '<!-- MERGED -->') continue;
        var cellContent2 = grid[r2][c2].replace(/<t[dh][^>]*>/, '').replace(/<\/t[dh]>/, '').trim();
        var decoded2 = cellContent2.replace(/&amp;lt;/g, '<').replace(/&lt;/g, '<');
        if (decoded2 === '<' || decoded2 === '<' || cellContent2 === '&lt;' || cellContent2 === '&#60;') {
          // 向左合并：找到左边的单元格，增加 colspan
          if (c2 > 0) {
            var leftCell = grid[r2][c2 - 1];
            if (leftCell && leftCell !== '<!-- MERGED -->') {
              var colspanMatch = leftCell.match(/colspan=["'](\d+)["']/);
              var colspan = colspanMatch ? parseInt(colspanMatch[1]) : 1;
              if (colspanMatch) {
                grid[r2][c2 - 1] = leftCell.replace(/colspan=["'](\d+)["']/, 'colspan="' + (colspan + 1) + '"');
              } else {
                grid[r2][c2 - 1] = leftCell.replace(/<t[dh]/, '<t[dh] colspan="' + (colspan + 1) + '"');
              }
              grid[r2][c2] = '<!-- MERGED -->';
            }
          }
        }
      }
    }
    
    // 重建表格
    var newRows = [];
    for (var r3 = 0; r3 < grid.length; r3++) {
      var rowCells = [];
      for (var c3 = 0; c3 < grid[r3].length; c3++) {
        if (grid[r3][c3] !== '<!-- MERGED -->') {
          rowCells.push(grid[r3][c3]);
        }
      }
      if (rowCells.length > 0) {
        newRows.push('<tr>' + rowCells.join('') + '</tr>');
      }
    }
    
    return '<table>' + newRows.join('') + '</table>';
  });
}

// =========================== mdToHtml（Markdown → HTML） ===========================
// 使用 markdown-it + markdown-it-katex 渲染
// 用于 webview 中的标题、描述等

function mdToHtml(text) {
  if (!text) return '';
  var s = _normalizeLatexDelimiters(text);
  s = _preprocessMarkdown(s);
  try {
    var rendered = md.render(s);
    rendered = _postProcessTable(rendered);
    return rendered;
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
      if (/\\[a-zA-Z%${}_&#^~\\]/.test(content)) {
        return '$$\n' + content.trim() + '\n$$';
      }
      // 不含 LaTeX 命令时，用 HTML 实体代替 \[ 和 \]，防止 markdown-it
      // 将 \[ 解释为转义括号而输出 [xxx]，同时避免 KaTeX 客户端自动渲染拾取
      return '&#91;' + content + '&#93;';
    })
    // 行内公式：\( ... \) → $ ... $（同样仅当内容含 LaTeX 命令时转换）
    .replace(/\\\(([\s\S]*?)\\\)/g, function(match, content) {
      if (/\\[a-zA-Z%${}_&#^~\\]/.test(content)) {
        return '$' + content.trim() + '$';
      }
      // 不含 LaTeX 命令时，用 HTML 实体代替 \( 和 \)，防止 KaTeX
      // 客户端自动渲染将 \(xxx\) 当作数学公式处理
      return '&#40;' + content + '&#41;';
    });
  // 将 \mbox{...} 转为 KaTeX 支持的 \text{...}（\mbox 仅在数学模式中出现）
  result = result.replace(/\\mbox\{/g, '\\text{');
  // 保护数学模式内的 \% 等特殊转义不被 markdown-it 的 \ 转义吃掉
  // markdown-it 会将 \% 视为转义百分号输出 %，但 LaTeX 数学模式下 % 是注释符
  // 例如 $30 \%$ → markdown-it 输出 $30 %$ → MathJax 将 %$ 视为注释 → 渲染异常
  // 修复：将数学模式内的 \% 加倍为 \\%，使 markdown-it 输出 \% 保留给 MathJax
  // 行内数学：$...$
  result = result.replace(/\$([^$\n]+?)\$/g, function(m, content) {
    return '$' + content.replace(/\\%/g, '\\\\%') + '$';
  });
  // 展示数学：$$...$$
  result = result.replace(/\$\$([\s\S]*?)\$\$/g, function(m, content) {
    return '$$' + content.replace(/\\%/g, '\\\\%') + '$$';
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
  s = _preprocessMarkdown(s, mdNoKatex);
  // 将原始源码用隐藏 div 包裹 + HIDDEN_MARKER 标记，方便后续精确还原
  var escapedSource = escHtml(text);
  var rendered;
  try {
    rendered = mdNoKatex.render(s);
    rendered = _postProcessTable(rendered);
  } catch (e) {
    // 渲染失败时回退到纯文本
    rendered = '<p>' + escHtml(s) + '</p>';
  }
  return '<div style="display:none" data-yzoj-source="true">' + escapedSource + '</div>\n' + HIDDEN_MARKER + '\n' + rendered;
}

// =========================== mdLatexToHtmlForYzoj（专用于提交到 YZOJ 的渲染） ===========================
// 与 mdLatexToHtml 的区别：不添加隐藏 div 和 HIDDEN_MARKER，只返回渲染后的 HTML
// LaTeX 定界符原样保留，由 YZOJ 页面的 MathJax 渲染

// Base64 编码（兼容 Node.js 和浏览器）
function _b64Encode(str) {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(str, 'utf8').toString('base64');
  }
  return btoa(unescape(encodeURIComponent(str)));
}

function _b64Decode(str) {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(str, 'base64').toString('utf8');
  }
  return decodeURIComponent(escape(atob(str)));
}

function mdLatexToHtmlForYzoj(text) {
  if (!text) return '';
  var s = _decodeHtmlEntities(text);
  s = _normalizeLatexDelimiters(s);
  s = _preprocessMarkdown(s, mdForYzoj);
  // 将每个软换行（行尾两个空格）转为段落分隔，使每行独立成 <p>
  s = s.replace(/  \n/g, '\n\n');
  var rendered;
  try {
    rendered = mdForYzoj.render(s);
    rendered = _postProcessTable(rendered);
  } catch (e) {
    rendered = '<p>' + escHtml(s) + '</p>';
  }
  // 收集需要嵌入的 CSS
  var extraCss = '';
  // 检测是否包含折叠框，若包含则嵌入 CSS（折叠框已使用特定 class 选择器，无需额外限定）
  if (rendered.indexOf('class="yzoj-fold') >= 0) {
    extraCss += YZOJ_FOLD_CSS;
  }
  // 检测是否包含列表，若包含则嵌入 CSS（使用 <div> + ::before 伪元素，不被 reset.css 影响）
  if (rendered.indexOf('class="yzoj-md-ul"') >= 0 || rendered.indexOf('class="yzoj-md-ol"') >= 0) {
    extraCss += '.yzoj-md-ul,.yzoj-md-ol{padding-left:2em !important;margin:0.5em 0 !important}.yzoj-md-ol{counter-reset:yzoj-counter}.yzoj-md-li{margin:0.2em 0 !important}.yzoj-md-li p{display:inline;margin:0}.yzoj-md-ul>.yzoj-md-li::before{content:"\\2022 ";display:inline}.yzoj-md-ol>.yzoj-md-li::before{counter-increment:yzoj-counter;content:counter(yzoj-counter) ". ";display:inline}';
  }
  // 检测是否包含表格，若包含则嵌入边框 CSS，限定到 .yzoj-md-table 避免影响 YZOJ 自身布局表格
  if (rendered.indexOf('<table') >= 0) {
    extraCss += '.yzoj-md-table{border-collapse:collapse !important;margin:0.5em 0 !important}.yzoj-md-table th,.yzoj-md-table td{border:1px solid #ccc !important;padding:6px 10px !important;text-align:left !important}';
  }
  if (extraCss) {
    rendered = '<style>' + extraCss + '</style>\n' + rendered;
  }
  // 将源码注释放在末尾，避免开头换行被 YZOJ 渲染为段首空格
  var sourceComment = '<!-- yzoj-md-source:' + _b64Encode(text) + ' -->';
  return rendered.trim() + '\n' + sourceComment;
}

// =========================== HTML → Markdown + LaTeX ===========================

function htmlToMdLatex(html) {
  if (!html) return '';
  // 优先从隐藏的源码容器提取原始 markdown（精确还原）
  var sourceMatch = html.match(/<div[^>]*data-yzoj-source="true"[^>]*>([\s\S]*?)<\/div>/);
  if (sourceMatch) {
    return unescapeHtml(sourceMatch[1]);
  }
  // 从 YZOJ 提交的 HTML 注释标记中提取原始 Markdown 源码
  var commentMatch = html.match(/<!--\s*yzoj-md-source:([A-Za-z0-9+/=]+)\s*-->/);
  if (commentMatch) {
    return _b64Decode(commentMatch[1]);
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
  mdLatexToHtmlForYzoj: mdLatexToHtmlForYzoj,
  htmlToMdLatex: htmlToMdLatex,
  escHtml: escHtml
};
