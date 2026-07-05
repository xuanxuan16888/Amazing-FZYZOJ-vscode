// webview.js - Webview
var AE=String.fromCharCode(38,97,109,112,59);
var LT=String.fromCharCode(38,108,116,59);
var GT=String.fromCharCode(38,103,116,59);
var QT=String.fromCharCode(38,113,117,111,116,59);
var AP=String.fromCharCode(38,35,48,51,57,59);
function esc(t){if(!t)return '';return String(t).replace(/&/g,AE).replace(/</g,LT).replace(/>/g,GT).replace(/"/g,QT).replace(/'/g,AP);}

// 导入统一 Markdown+LaTeX 渲染器
const { mdToHtml, mdLatexToHtml } = require('./md-latex');

// 用户链接HTML生成器
// username: 用户名 (必填)
// uid: 用户ID (可选，如果有会传递给后端)
// solvedCount: 通过题数 (可选，-1表示未知需要请求数据)
// crawledColor: 从YZOJ爬取到的原生颜色代码 (可选，优先使用)
function userLinkHtml(username, uid, solvedCount, crawledColor, noColor, tags, authorHtml) {
  if (!username) return '';
  var color = '';
  if (noColor) {
    color = '#2563EB';
  } else if (crawledColor && typeof crawledColor === 'string' && crawledColor.trim()) {
    color = crawledColor.trim();
  } else {
    color = '#2563EB';
  }
  var dataAttrs = 'data-username="' + esc(username) + '"';
  if (uid) dataAttrs += ' data-uid="' + esc(uid) + '"';
  if ((solvedCount === -1) && !crawledColor && !noColor) dataAttrs += ' data-needs-data="1"';
  // 渲染tags（若提供）
  var tagsHtml = '';
  if (tags && tags.length) {
    tagsHtml = tags.map(function(t) {
      return '<span class="user-tag" style="background:' + esc(t.color||t.colour||'#6366f1') + '">' + esc(t.tag||t.text||t.name||'') + '</span>';
    }).join('');
  }
  var innerHtml = esc(username);
  if (authorHtml && typeof authorHtml === 'string' && authorHtml.trim() && authorHtml.trim().indexOf('<') >= 0 && authorHtml.trim().indexOf('>') >= 0) {
    innerHtml = authorHtml;
    dataAttrs += ' data-user-html="' + esc(authorHtml) + '"';
  }
  return '<span class="user-link" ' + dataAttrs + ' style="color:' + color + ';font-weight:bold;cursor:pointer">' + innerHtml + '<span class="utc">' + tagsHtml + '</span></span>';
}
// 委托递交渲染：user1 ← user2 ← user3
function delegationUserHtml(delegation, userTagMap) {
  if (!delegation || !delegation.length) return '';
  var parts = [];
  for (var di = 0; di < delegation.length; di++) {
    var du = delegation[di];
    var tagKey = du.userId || du.user;
    var tags = tagKey ? (userTagMap[tagKey] || []) : [];
    parts.push(userLinkHtml(du.user, du.userId || '', -1, du.userColor || '', false, tags, du.userHtml || ''));
    if (di < delegation.length - 1) {
      parts.push('<span style="color:#888;font-weight:normal;margin:0 1px">←</span>');
    }
  }
  return parts.join('');
}
// 纯文本用户名显示：不带 hover、不带用户卡片颜色（使用统一蓝色替代），用于 题解/讨论 页面
function plainUserHtml(username) {
  if (!username) return '';
  return '<span style="font-weight:600;color:#007acc">' + esc(username) + '</span>';
}

// 用户卡片CSS样式
function userCardCss() {
  return `
.user-link{cursor:pointer;padding:0 2px;border-radius:2px;transition:background 0.1s;outline:none!important;text-decoration:none!important;-webkit-tap-highlight-color:transparent;user-select:none}
.user-link:hover{background:rgba(0,122,204,0.15)}
.user-link:focus,.user-link:focus-visible,.user-link:focus-within{outline:none!important;text-decoration:none!important;box-shadow:none!important}
.user-link .utc{display:inline;color:inherit}
.user-card{position:fixed;z-index:99999;min-width:240px;background:#fff;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,0.18);overflow:hidden;padding:0;font-family:system-ui,sans-serif;font-size:13px}
.user-card-banner{height:48px;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);background-size:cover;background-repeat:no-repeat;background-position:center;width:100%}
.user-card-body{padding:0 14px 14px 14px}
.user-card-avatar{width:58px;height:58px;border-radius:50%;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);border:3px solid #fff;margin-top:-32px;display:flex;align-items:center;justify-content:center;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.12)}
.user-card-avatar img{width:100%;height:100%;object-fit:cover}
.user-card-avatar-letter{color:#fff;font-weight:bold;font-size:20px}
.user-card-name{font-size:16px;font-weight:bold;margin-top:6px}
.user-card-realname{font-size:12px;color:#666;margin-top:2px}
.user-card-sign{font-size:11px;color:#999;margin-top:4px;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.user-tag{display:inline-block;padding:1px 6px;border-radius:8px;color:#fff;font-size:10px;font-weight:600;margin-left:4px;vertical-align:middle}
.user-card-stats{margin-top:10px;display:flex;gap:6px;flex-wrap:wrap}
.user-card-stats span{padding:3px 8px;background:#f0f0f0;border-radius:4px;font-size:11px;color:#333}
.user-card-bio{margin-top:10px;padding:8px 10px;border-top:1px solid #eee;font-size:12px;color:#333;max-height:110px;overflow-y:auto;line-height:1.55}
  `;
}

// 用户卡片JavaScript - 独立的IIFE，不依赖全局变量
function userCardScript() {
  // 使用String.raw防止模板字面量吞噬反斜杠
  var _sr=function(s){return s.raw[0];};
  return _sr`
(function(){
  window.vscodeApi.postMessage({command:'debugLog',message:'[UserCard] IIFE_started'});
  if (!window.vscodeApi){try{window.vscodeApi.postMessage({command:'debugLog',message:'[UserCard] NO_vscodeApi'});}catch(e){}return;}
  var hoverTimer=null;
  var hideTimer=null;
  var forceShowTimer=null;
  var cardEl=null;
  var curUser='',curUid='';
  var pendingData={};
  var requestSent={};
  var cancelledKeys={};
  var renderedRealData={};
  var userHtmlCache={};
  var fetchedUsers={};
  var userDataCache={};

  function log(msg){try{window.vscodeApi.postMessage({command:'debugLog',message:'[UserCard] '+msg});}catch(e){}}

  function _simpleMarkdown(t){
    if(!t)return '';
    var s=String(t);
    // 保护 LaTeX 显示公式 $$...$$
    var dm=[],dmi=0;
    s=s.replace(/\$\$([\s\S]*?)\$\$/g,function(m){var p='\x01DM'+dmi+'\x01';dm.push(m);dmi++;return p;});
    // 保护 LaTeX 行内公式 $...$
    var im=[],imi=0;
    s=s.replace(/\$([^\$]+?)\$/g,function(m){var p='\x01IM'+imi+'\x01';im.push(m);imi++;return p;});
    // Markdown 处理
    s=s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g,'<a href="$2" target="_blank" style="color:#007acc">$1</a>')
      .replace(/\x60([^\x60]+)\x60/g,'<code style="background:#f0f0f0;padding:1px 4px;border-radius:3px;font-size:12px;font-family:Consolas,monospace">$1</code>')
      .replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g,'<em>$1</em>')
      .replace(/\n/g,'<br>');
    // 恢复 LaTeX
    for(var dk=0;dk<dm.length;dk++)s=s.replace('\x01DM'+dk+'\x01',dm[dk]);
    for(var ik=0;ik<im.length;ik++)s=s.replace('\x01IM'+ik+'\x01',im[ik]);
    return s;
  }

  function esc(t){if(!t)return '';return String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');}

  function createCard(el){
    if(cardEl){cardEl.remove();cardEl=null;}
    var r=el.getBoundingClientRect();
    cardEl=document.createElement('div');
    cardEl.className='user-card';
    cardEl.style.left=(r.left)+'px';
    cardEl.style.top=(r.bottom+5)+'px';
    if(r.left+260>window.innerWidth)cardEl.style.left=(window.innerWidth-270)+'px';
    if(r.bottom+180>window.innerHeight)cardEl.style.top=Math.max(4,(r.top-180))+'px';
    document.body.appendChild(cardEl);
  }

  function renderCard(data,source){
    if(!cardEl)return;
    var u=data||{};
    var solvedCount=u.solvedCount;
    var color=u.color || '#2563EB';
    log('renderCard: username='+(u.username||curUser)+', source='+(source||'pending')+', solvedCount='+(solvedCount!=null?solvedCount:'undefined')+', color='+color+', hasAvatar='+(!!u.avatar_url)+', hasBanner='+(!!(u.header_image_url||u.headerImg)));
    var bannerUrl=u.header_url || u.header_image_url || u.headerImg || '';
    var bannerStyle='';
    if(bannerUrl) bannerStyle=' style="background-image:url('+esc(bannerUrl)+');background-size:cover;background-position:center;width:100%"';
    var avatarHtml='';
    if(u.avatar_url){
      avatarHtml='<img src="'+esc(u.avatar_url)+'" alt="">';
    }else{
      avatarHtml='<div class="user-card-avatar-letter">'+(u.username?u.username.charAt(0).toUpperCase():'?')+'</div>';
    }
    var extraInfo='';
    var nickOrReal=u.nickname || u.realName;
    if(nickOrReal){
      extraInfo+='<div class="user-card-realname">'+esc(nickOrReal)+(u.realName&&u.nickname&&u.nickname!==u.realName?' · '+esc(u.realName):'')+'</div>';
    }
    if(u.signature){
      extraInfo+='<div class="user-card-sign" title="'+esc(u.signature)+'">'+esc(u.signature)+'</div>';
    }
    var extraStats='';
    if(u.school) extraStats+='<span>🎓 '+esc(String(u.school).slice(0,14))+'</span>';
    if(u.email) extraStats+='<span>✉ '+esc(String(u.email).slice(0,18))+'</span>';
    cardEl.innerHTML=
      '<div class="user-card-banner"'+bannerStyle+'></div>'+
      '<div class="user-card-body">'+
        '<div class="user-card-avatar">'+avatarHtml+'</div>'+
        '<div class="user-card-name" style="color:'+color+'">'+(userHtmlCache[curUid||curUser]||esc(u.username||curUser||''))+
          (u.tags&&u.tags.length?u.tags.map(function(t){return '<span class="user-tag" style="background:'+esc(t.color||t.colour||'#6366f1')+'">'+esc(t.tag||t.text||t.name||'')+'</span>';}).join(''):'')+
        '</div>'+
        extraInfo+
        '<div class="user-card-stats">'+
          '<span>通过 '+((solvedCount||0)+'')+'</span>'+
          '<span>提交 '+((u.submissionCount||0)+'')+'</span>'+
          (u.rank?'<span>排名 #'+(u.rank)+'</span>':'')+
          extraStats+
        '</div>'+
        '</div>'+
      '</div>';
    // 渲染LaTeX
    if(window.MathJax&&MathJax.typesetPromise){
      MathJax.typesetPromise([cardEl]).catch(function(){});
    }
  }

  function requestUserData(username,uid){
    var key=uid||username;
    if(cancelledKeys[key]){delete cancelledKeys[key];}
    if(fetchedUsers[key]){log('requestUserData: SKIP already fetched, username='+username+', uid='+uid);return;}
    if(requestSent[key])return;
    requestSent[key]=true;
    log('requestUserData: FETCH username='+username+', uid='+uid);
    window.vscodeApi.postMessage({command:'requestUserCard',username:username,uid:uid});
  }

  function requestUserTags(username, uid){
    var key=uid||username;
    log('requestUserTags: username='+username+', uid='+uid);
    window.vscodeApi.postMessage({command:'requestUserTags', username:username, uid:uid});
  }

  function startUserCard(el,username,uid){
    clearHideTimer();
    if(cardEl&&(username===curUser||uid===curUid)) return;
    if(cardEl){cardEl.remove();cardEl=null;}
    curUser=username;curUid=uid||'';
    var key=uid||username;
    // 存储多色用户名HTML
    var userHtml=el.getAttribute('data-user-html');
    if(userHtml)userHtmlCache[key]=userHtml;
    delete cancelledKeys[key];
    clearAllTimers();

    // 250ms 延迟后才开始创建卡片和请求数据（不允许预加载）
    hoverTimer=setTimeout(function(){
      hoverTimer=null;
      if(cancelledKeys[key]) return;
      log('startRequest: username='+username+', uid='+uid+', hasPendingData='+(!(!pendingData[key]))+', hasCachedData='+(!!userDataCache[key]));
      // 1. 创建卡片
      createCard(el);
      if(userDataCache[key]){
        renderCard(userDataCache[key],'cached');
      }else if(pendingData[key]){
        renderCard(pendingData[key],'cached');
        delete pendingData[key];
      }else{
        cardEl.innerHTML='<div class="user-card-banner"></div><div class="user-card-body" style="padding:18px 14px;text-align:center;color:#888;font-size:12px">少女祈祷中...</div>';
      }
      // 2. 开始请求数据
      requestUserData(username,uid);
      // 3. 最多再等 500ms，强制显示（从 hover 开始共 750ms）
      forceShowTimer=setTimeout(function(){
        forceShowTimer=null;
        if(cancelledKeys[key]) return;
        if(renderedRealData[key]){log('forceShow: username='+username+', skipped, already rendered');return;}
        if(!cardEl) createCard(el);
        if(userDataCache[key]){
          renderCard(userDataCache[key],'cached');
        }else if(pendingData[key]){
          log('forceShow: username='+username+', using pendingData');
          renderCard(pendingData[key],'forceShow');
          delete pendingData[key];
        }else{
          log('forceShow: username='+username+', showing placeholder');
          renderCard({username:username,solvedCount:undefined,submissionCount:undefined},'forceShow');
        }
      },500);
    },250);
  }

  function clearAllTimers(){
    if(hoverTimer){clearTimeout(hoverTimer);hoverTimer=null;}
    if(forceShowTimer){clearTimeout(forceShowTimer);forceShowTimer=null;}
    if(hideTimer){clearTimeout(hideTimer);hideTimer=null;}
  }
  function clearHideTimer(){if(hideTimer){clearTimeout(hideTimer);hideTimer=null;}}

  function cancelPendingForCur(){
    var key=curUid||curUser;
    if(key){cancelledKeys[key]=true;}
  }

  function hideCardNow(){
    clearAllTimers();
    cancelPendingForCur();
    if(cardEl){cardEl.remove();cardEl=null;}
    curUser='';curUid='';userHtmlCache={};
  }

  function scheduleHide(delay){
    clearHideTimer();
    hideTimer=setTimeout(function(){hideCardNow();},typeof delay==='number'?delay:180);
  }

  function isInCardOrLink(t){
    if(!t)return false;
    var n=t;
    while(n&&n!==document.body){
      if(n.classList&&(n.classList.contains('user-link')||n.classList.contains('user-card')))return true;
      n=n.parentNode;
    }
    return false;
  }

  document.addEventListener('mouseover',function(e){
    var t=e.target;
    if(cardEl&&(t===cardEl||cardEl.contains(t))){clearHideTimer();return;}
    var cur=t,link=null;
    while(cur&&cur!==document.body){
      if(cur.classList&&cur.classList.contains('user-link')){link=cur;break;}
      cur=cur.parentNode;
    }
    if(link){
      clearHideTimer();
      var un=link.dataset.username,uid=link.dataset.uid;
      log('mouseover: username='+un+', uid='+uid+', cardExists='+(!!cardEl)+', curUser='+curUser);
      if(cardEl&&(un===curUser||uid===curUid))return;
      startUserCard(link,un,uid);
      return;
    }
    if(!isInCardOrLink(t)&&cardEl){scheduleHide();}
    clearAllTimers();
    cancelPendingForCur();
  });

  document.addEventListener('mouseout',function(e){
    var from=e.target,to=e.relatedTarget;
    var leftLink=false,n=from;
    while(n&&n!==document.body){if(n.classList&&n.classList.contains('user-link')){leftLink=true;break;}n=n.parentNode;}
    var leftCard=false,m=from;
    while(m&&m!==document.body){if(m.classList&&m.classList.contains('user-card')){leftCard=true;break;}m=m.parentNode;}
    if(!leftLink&&!leftCard)return;
    if(isInCardOrLink(to)){clearHideTimer();return;}
    clearAllTimers();
    cancelPendingForCur();
    if(cardEl){hideCardNow();}
  });

  document.addEventListener('click',function(e){
    var t=e.target,link=null,n=t;
    while(n&&n!==document.body){
      if(n.classList&&n.classList.contains('user-link')){link=n;break;}
      n=n.parentNode;
    }
    if(link){
      e.preventDefault();e.stopPropagation();
      window.vscodeApi.postMessage({command:'openUserProfile',username:link.dataset.username,uid:link.dataset.uid});
    }
    hideCardNow();
  },true);

  window.addEventListener('scroll',function(){hideCardNow();},true);
  window.addEventListener('resize',function(){hideCardNow();},true);
  document.addEventListener('wheel',function(){hideCardNow();},{passive:true,capture:true});
  document.addEventListener('keydown',function(e){if(e.key==='Escape')hideCardNow();},true);

  window.addEventListener('message',function(e){
    var d=e.data;
    if(d.command!=='userCardData')return;
    var u=d.data||{};
    var key=d.uid||d.username;
    if(cancelledKeys[key]){
      log('dataReceived CANCELLED: username='+d.username+', uid='+d.uid);
      userDataCache[key]=u;
      fetchedUsers[key]=true;
      delete requestSent[key];
      delete cancelledKeys[key];
      return;
    }
    var solvedCount=u.solvedCount;
    var color=u.color || '#2563EB';
    log('dataReceived: username='+d.username+', uid='+d.uid+', solvedCount='+(solvedCount!=null?solvedCount:'undefined')+', color='+color+', hasAvatar='+(!!u.avatar_url)+', hasPendingHover='+(!!(hoverTimer||forceShowTimer))+', hasCard='+(!!cardEl)+', tags='+(u.tags?u.tags.length:0));
    var links=document.querySelectorAll('.user-link[data-username="'+d.username+'"],.user-link[data-uid="'+d.uid+'"]');
    for(var i=0;i<links.length;i++){
      links[i].removeAttribute('data-needs-data');
    }
    // 更新tag容器
    if(u.tags&&u.tags.length){
      var uname_sel=d.username?String(d.username).replace(/['"\\]/g,function(c){return '\\'+c;}):'';
      var uid_sel=d.uid?String(d.uid).replace(/['"\\]/g,function(c){return '\\'+c;}):'';
      var tcs=[];
      if(uname_sel){var ns=document.querySelectorAll('.user-link[data-username="'+uname_sel+'"] .utc');for(var xi=0;xi<ns.length;xi++)tcs.push(ns[xi]);}
      if(uid_sel){var us=document.querySelectorAll('.user-link[data-uid="'+uid_sel+'"] .utc');for(var yi=0;yi<us.length;yi++)tcs.push(us[yi]);}
      for(var ti=0;ti<tcs.length;ti++){
        tcs[ti].innerHTML=u.tags.map(function(t){return '<span class="user-tag" style="background:'+esc(t.color||t.colour||'#6366f1')+'">'+esc(t.tag||t.text||t.name||'')+'</span>';}).join('');
      }
    }
    userDataCache[key]=u;
    if(cardEl&&(d.username===curUser||d.uid===curUid)){
      renderCard(u,'dataReceived');
      renderedRealData[key]=true;
    }else if(hoverTimer||forceShowTimer){
      pendingData[key]=u;
    }else{
      pendingData[key]=u;
    }
    fetchedUsers[key]=true;
    delete requestSent[key];
  });

  // userTagsData 处理器：只更新tag容器，不涉及卡片（设置了 __YzDisableTags 的页面跳过）
  if (!window.__YzDisableTags) {
    window.addEventListener('message', function(e2){
      var d2=e2.data;
      if(d2.command!=='userTagsData')return;
      var tags=d2.tags||[];
      log('userTagsData: username='+d2.username+', uid='+d2.uid+', tags='+tags.length);
      var uname_sel=d2.username?String(d2.username).replace(/['"\\]/g,function(c){return '\\'+c;}):'';
      var uid_sel=d2.uid?String(d2.uid).replace(/['"\\]/g,function(c){return '\\'+c;}):'';
      var tcs=[];
      if(uname_sel){var ns=document.querySelectorAll('.user-link[data-username="'+uname_sel+'"] .utc');for(var xi=0;xi<ns.length;xi++)tcs.push(ns[xi]);}
      if(uid_sel){var us=document.querySelectorAll('.user-link[data-uid="'+uid_sel+'"] .utc');for(var yi=0;yi<us.length;yi++)tcs.push(us[yi]);}
      for(var ti=0;ti<tcs.length;ti++){
        tcs[ti].innerHTML=tags.map(function(t){
          return '<span class="user-tag" style="background:'+esc(t.color||t.colour||'#6366f1')+'">'+esc(t.tag||t.text||t.name||'')+'</span>';
        }).join('');
      }
    });
  }

  // 监听所有.user-link元素（包括动态加载的），一出现就立即拉取tag（设置了 __YzDisableTags 的页面跳过）
  if (!window.__YzDisableTags) {
    function _fetchUserTags(el){
      var un=el.dataset.username,uid=el.dataset.uid,key=uid||un;
      if(key&&!requestSent[key]&&!fetchedUsers[key]){requestUserTags(un,uid);}
    }
    function _scanAllUserLinks(){
      var seen={};
      var allLinks=document.querySelectorAll('.user-link');
      for(var ei=0;ei<allLinks.length;ei++){
        var el=allLinks[ei];
        var un=el.dataset.username,uid=el.dataset.uid,key=uid||un;
        if(key&&!seen[key]){seen[key]=true;requestUserTags(un,uid);}
      }
    }
    // 初始扫描
    log('_scanAllUserLinks: starting scan');
    _scanAllUserLinks();
    log('_scanAllUserLinks: scan complete');
    // MutationObserver 侦测动态新增的用户名
    var _tagObs=new MutationObserver(function(muts){
      for(var mi=0;mi<muts.length;mi++){
        var added=muts[mi].addedNodes;
        if(!added||!added.length)continue;
        for(var ni=0;ni<added.length;ni++){
          var n=added[ni];
          if(n.nodeType!==1)continue;
          if(n.classList&&n.classList.contains('user-link')){_fetchUserTags(n);}
          var subs=n.querySelectorAll?n.querySelectorAll('.user-link'):null;
          if(subs&&subs.length){for(var si=0;si<subs.length;si++)_fetchUserTags(subs[si]);}
        }
      }
    });
    _tagObs.observe(document.body,{childList:true,subtree:true});
  }

  log('userCardScript initialized');
})();
  `;
}

// eslint-disable-next-line no-unused-vars
function yzojLevelColor(level) {
  level = parseInt(level) || 1;
  if (level >= 8) return '#FF0000';
  if (level >= 7) return '#F56C0E';
  if (level >= 6) return '#E8D11D';
  if (level >= 5) return '#81D82E';
  if (level >= 4) return '#4BAFB2';
  if (level >= 3) return '#735866';
  return '#666';
}

function wrapWithMathJax(title, fullBodyHtml, baseUrl) {
  // 重写相对路径为绝对路径（支持图片 src 和链接 href）
  if (baseUrl) {
    var rootUrl = String(baseUrl).replace(/\/+$/, '');
    // 保护 <script> 内容不被 URL 重写破坏
    var scriptBlocks = [];
    var scriptIdx = 0;
    fullBodyHtml = fullBodyHtml.replace(/<script[\s>][\s\S]*?<\/script>/gi, function(m) {
      var ph = '\x00SCRIPT' + (scriptIdx++) + '\x00';
      scriptBlocks.push(ph + '|||' + m);
      return ph;
    });
    // 先处理以 /OnlineJudge/ 或 /Upload/ 开头的路径
    fullBodyHtml = fullBodyHtml.replace(/((?:src|href)\s*=\s*)(["'])\/((?:OnlineJudge|Upload)\/[^"']*?)\2/gi, function(m, prefix, quote, path) {
      // /Upload/ 缺少 /OnlineJudge/ 前缀，需要补上
      if (path.startsWith('Upload/')) {
        return prefix + quote + rootUrl + '/OnlineJudge/' + path + quote;
      }
      return prefix + quote + rootUrl + '/' + path + quote;
    });
    // 再处理其它相对路径（如 src="image.png" 或 src="./files/data.zip"）
    fullBodyHtml = fullBodyHtml.replace(/((?:src|href)\s*=\s*)(["'])((?!https?:\/\/|data:|javascript:|mailto:|tel:|#|\/\/|\/[A-Za-z])[^"']*?)\2/gi, function(m, prefix, quote, relPath) {
      var cleaned = relPath.replace(/^\.?\//, '').replace(/^\/+/, '');
      if (cleaned.startsWith('OnlineJudge/')) {
        return prefix + quote + rootUrl + '/' + cleaned + quote;
      } else if (cleaned.startsWith('Upload/')) {
        // Upload/ 缺少 /OnlineJudge/ 前缀，需要补上
        return prefix + quote + rootUrl + '/OnlineJudge/' + cleaned + quote;
      }
      return prefix + quote + rootUrl + '/OnlineJudge/' + cleaned + quote;
    });
    // 恢复 <script> 内容
    for (var si = 0; si < scriptBlocks.length; si++) {
      var parts = scriptBlocks[si].split('|||');
      fullBodyHtml = fullBodyHtml.replace(parts[0], parts[1]);
    }
  }
  var userCardStyle = userCardCss();
  var userCardJS = userCardScript();
  userCardJS = userCardJS.replace(/<\/script>/gi, '<\\/script>');

  // ===== 全局站内链接智能跳转拦截脚本（完整） =====
  var smartLinkJS = `(function(){
    function logToConsole(msg){try{console.log('[SL]',msg);}catch(e){}}
    var v=null;
    var _err=null;
    try{
      if(window.vscodeApi){
        v=window.vscodeApi;
      }else if(typeof acquireVsCodeApi==='function'){
        v=acquireVsCodeApi();
      }else{
        _err='vscodeApi undefined, acquireVsCodeApi typeof='+(typeof acquireVsCodeApi);
      }
    }catch(e){_err='exception: '+(e&&e.toString?e.toString():String(e));}
    try{if(v)v.postMessage({command:'debugLog',message:'[smartLinkJS] initialized, v='+!!v+(_err?' err='+_err:'')});}catch(ee){}
    try{document.title='[SL]'+document.title;}catch(ee){}
    function parseQS(href){
      var qs=href.split('?')[1]||href.split('?')[0].split('#')[1]||'';
      var m,pl=/([^=&]+)=([^&]*)/g,params={};
      while((m=pl.exec(qs))){params[decodeURIComponent(m[1])]=decodeURIComponent(m[2]);}
      return params;
    }
    function pm(cmd,data){if(!data)data={};data.command=cmd;if(v)v.postMessage(data);logToConsole('send command='+cmd+' data='+JSON.stringify(data).substring(0,200));}
    function handleClick(e){
      var a=e.target;
      while(a&&a.tagName!=='A'){a=a.parentNode;}
      if(!a||!a.href){logToConsole('click ignored: no anchor');return;}
      if(a.getAttribute('data-nosmart')==='1'){logToConsole('click ignored: nosmart');return;}
      if(a.onclick&&a.getAttribute('onclick')){
        // PHP 链接即使有 onclick 也拦截（避免在插件内打开泄露到 vscode-webview 协议）
        if(!/\.php/i.test(a.href||href)){
          logToConsole('click ignored: has onclick attr');
          return;
        }
      }
      var href=a.getAttribute('href')||a.href||'';
      if(!href||href.startsWith('#')||href.startsWith('javascript:')||href.startsWith('mailto:')||href.startsWith('tel:')){logToConsole('click ignored: special href='+href.substring(0,80));return;}
      var absHref=a.href||href;
      logToConsole('click href="'+href.substring(0,120)+'" absHref="'+absHref.substring(0,120)+'"');
      var isSmart=false;
      function msg(m){e.preventDefault();e.stopPropagation();isSmart=true;logToConsole('v='+!!v+' posting command='+m.command);if(v){v.postMessage(m);logToConsole('postMessage done');}else{logToConsole('v is null, message NOT sent!');}}
      // 下载链接优先于 _blank 检查
      if(a.hasAttribute('download')||/\.(pdf|zip|rar|7z|tar|gz|doc|docx|xls|xlsx|ppt|pptx|csv|exe|msi|dmg|iso|apk|bin|dat|in|out|ans|data|cpp|c|py|java|pas|txt|json|xml|yml|yaml|md|sql|log|cfg|conf|ini|bat|sh)$/i.test(absHref)||/\\/Upload\\//i.test(absHref)){
        e.preventDefault();e.stopPropagation();isSmart=true;pm('downloadFile',{url:absHref});return;
      }
      if(a.target&&a.target.toLowerCase()==='_blank'){e.preventDefault();pm('openExternal',{url:absHref});return;}
      if(/problem_show\\.php|contest_problem\\.php/i.test(absHref)){
        pm('debugLog',{message:'[smartLinkJS] match problem_show, absHref='+absHref});
        var p=parseQS(absHref);var pid=p.id||p.pid||'';
        if(pid)msg({command:'openProblem',id:pid,url:absHref});
        else pm('openExternal',{url:absHref});
      }else if(/contest_show\\.php/i.test(absHref)){
        pm('debugLog',{message:'[smartLinkJS] match contest_show, absHref='+absHref});
        var cp=parseQS(absHref);var cid=cp.id||cp.tid||cp.cid||'';
        logToConsole('contest_show matched, parsed cid="'+cid+'" from href');
        if(cid)msg({command:'openContest',id:cid,url:absHref});
        else pm('openExternal',{url:absHref});
      }else if(/contest_result\\.php|contest_rank\\.php/i.test(absHref)){
        pm('debugLog',{message:'[smartLinkJS] match contest_result/rank, absHref='+absHref});
        var rp=parseQS(absHref);var rcid=rp.id||rp.tid||rp.cid||rp.contest_id||'';
        if(rcid)msg({command:'openContestResult',contestId:rcid,url:absHref});
        else pm('openExternal',{url:absHref});
      }else if(/discuss_show\\.php|discuss_discuss\\.php/i.test(absHref)){
        var dp=parseQS(absHref);var did=dp.id||dp.did||'';
        if(did)msg({command:'openDiscussion',id:did,url:absHref});
        else pm('openExternal',{url:absHref});
      }else if(/discuss_list\\.php/i.test(absHref)){
        msg({command:'openDiscussionList',url:absHref});
      }else if(/status_details\\.php|source_show\\.php/i.test(absHref)){
        var sp=parseQS(absHref);var sid=sp.id||sp.sid||'';
        if(sid)msg({command:'openStatusDetail',id:sid});
        else pm('openExternal',{url:absHref});
      }else if(/status\\.php/i.test(absHref)){
        var fp=parseQS(absHref);msg({command:'openStatusList',filters:fp,url:absHref});
      }else if(/problem_status\\.php/i.test(absHref)){
        var pp=parseQS(absHref);var ppid=pp.id||pp.pid||'';
        if(ppid)msg({command:'openProblemStatus',problemId:ppid});
        else pm('openExternal',{url:absHref});
      }else if(/user_show\\.php/i.test(absHref)){
        var up=parseQS(absHref);var uid=up.id||'';var uname=up.uname||up.username||a.textContent||'';
        msg({command:'openUserProfile',uid:uid,username:uname.trim()});
      }else if(/ranklist\\.php/i.test(absHref)){
        msg({command:'openRanklist',url:absHref});
      }else if(/\\.(jpg|jpeg|png|gif|svg|webp|bmp|ico)$/i.test(absHref)){
        e.preventDefault();e.stopPropagation();isSmart=true;pm('openExternal',{url:absHref});
      }else{
        e.preventDefault();e.stopPropagation();isSmart=true;
        pm('debugLog',{message:'[smartLinkJS] fallback openExternal: '+absHref});
        pm('openExternal',{url:absHref});
      }
    }
    function attachClick(){
      if(document.body){
        document.body.addEventListener('click',handleClick,true);
        logToConsole('click listener attached to body');
      }else{
        logToConsole('body not ready, will retry');
        setTimeout(attachClick,100);
      }
    }
    attachClick();
    // 同时在 document 层也监听（备份）
    document.addEventListener('click',function(e){
      var a=e.target;while(a&&a.tagName!=='A')a=a.parentNode;
      if(a&&a.href&&!a.getAttribute('data-nosmart'))logToConsole('doc-level click on href='+(a.href||'').substring(0,120));
    },true);
  })();`;

  // ===== 图片代理脚本（完整） =====
  var _yzImgProxy = `<script>(function(){
    var v=window.vscodeApi||null;
    if(!v){try{v=acquireVsCodeApi();}catch(e){}}
    if(!v)return;
    var p={};
    window.addEventListener("message",function(e){
      var m=e.data;
      if(m&&m.command==="imageFetched"&&p[m.url]){
        p[m.url].forEach(function(i){i.src=m.data;});
        delete p[m.url];
      }
    });
    function ri(i){
      if(!i||!i.src)return;
      var u=i.src;
      if(u.indexOf("183.250.108.194")===-1&&u.indexOf("OnlineJudge/Upload/")===-1&&u.indexOf("/Upload/")===-1)return;
      if(!p[u]){p[u]=[];v.postMessage({command:"fetchImage",url:u});}
      p[u].push(i);
    }
    function scanAll(){document.querySelectorAll("img").forEach(ri);}
    scanAll();
    var ob=new MutationObserver(function(m){
      m.forEach(function(x){
        if(x.addedNodes){
          for(var i=0;i<x.addedNodes.length;i++){
            var n=x.addedNodes[i];
            if(n.tagName==="IMG")ri(n);
            if(n.querySelectorAll)n.querySelectorAll("img").forEach(ri);
          }
        }
      });
    });
    var wd=function(){if(document.body)ob.observe(document.body,{childList:true,subtree:true});};
    if(document.body)wd();else document.addEventListener("DOMContentLoaded",wd);
    document.addEventListener("DOMContentLoaded",function(){scanAll();setTimeout(scanAll,2000);setTimeout(scanAll,5000);});
  })();</script>`;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'unsafe-inline' https://cdn.jsdelivr.net; img-src http: https: data:; connect-src http: https:; font-src https://cdn.jsdelivr.net;">
  <title>${esc(title)}</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.4/dist/katex.min.css">
  <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.4/dist/katex.min.js"></script>
  <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.4/dist/contrib/auto-render.min.js"></script>
  <style>${userCardStyle}</style></head>
<body>
  <script>
    window._yzErrors = [];
    window.onerror = function(m,u,l,c,e) {
      try {
        window._yzErrors.push("JS_ERROR: " + m + " at " + u + ":" + l + ":" + c + "\\n" + (e ? e.stack : ""));
      } catch(ex) {}
    };
    function _yzShowErrors() {
      try {
        var es = window._yzErrors;
        if (!es || !es.length) return;
        var d = document.createElement("div");
        d.style.cssText = "position:fixed;top:0;left:0;right:0;background:#c00;color:#fff;padding:8px;font-size:12px;z-index:999999;font-family:monospace;white-space:pre-wrap;word-break:break-all";
        d.textContent = es.join("\\n---\\n");
        document.body.appendChild(d);
      } catch(ex) {}
    }
  </script>
  <script>
    (function() {
      try {
        window.vscodeApi = window.vscodeApi || acquireVsCodeApi();
        if (window.vscodeApi) {
          try {
            window.vscodeApi.postMessage({command:"debugLog", message:"[YZ_DIAG] bootstrap OK"});
          } catch(e) {
            window._yzErrors.push("bootstrap postMessage error: " + e.message);
          }
        } else {
          window._yzErrors.push("bootstrap: vscodeApi falsy");
        }
      } catch(e) {
        window._yzErrors.push("bootstrap exception: " + e.message);
      }
      _yzShowErrors();
    })();
  </script>
  ${fullBodyHtml}
  <script>${userCardJS}</script>
  <script>${smartLinkJS}</script>
  ${_yzImgProxy}
  <script>
  document.addEventListener("DOMContentLoaded", function() {
    if (typeof renderMathInElement === "function") {
      try {
        renderMathInElement(document.body, {
          delimiters: [
            {left: "$$", right: "$$", display: true},
            {left: "$", right: "$", display: false},
            {left: "\\\\(", right: "\\\\)", display: false}
            // 已移除 {left: "\\\\[", right: "\\\\]", display: true}，解决 [NOIP1999] 误渲染
          ],
          throwOnError: false
        });
      } catch(e) {
        if (window._yzErrors) window._yzErrors.push("KaTeX auto-render error: " + e.message);
      }
    }
  });
  </script>
</body>
</html>`;
}

function getHomepageWebview(data,b,username){
  var statsHtml='';
  if(data.stats&&data.stats.serverStats){
    var ss=data.stats.serverStats;
    statsHtml='<div style="display:flex;flex-wrap:wrap;gap:8px;padding:12px 0;justify-content:center">'+
      '<div style="background:#fff;border-radius:10px;padding:12px 16px;text-align:center;min-width:80px;box-shadow:0 1px 4px rgba(0,0,0,0.08)"><div style="font-size:22px;font-weight:700;color:#007acc">'+(ss.problem_count||0)+'</div><div style="font-size:11px;color:#666">题目</div></div>'+
      '<div style="bavar userCardJS = userCardScript();ckground:#fff;border-radius:10px;padding:12px 16px;text-align:center;min-width:80px;box-shadow:0 1px 4px rgba(0,0,0,0.08)"><div style="font-size:22px;font-weight:700;color:#007acc">'+(ss.user_count||0)+'</div><div style="font-size:11px;color:#666">用户</div></div>'+
      '<div style="background:#fff;border-radius:10px;padding:12px 16px;text-align:center;min-width:80px;box-shadow:0 1px 4px rgba(0,0,0,0.08)"><div style="font-size:22px;font-weight:700;color:#007acc">'+(ss.contest_count||0)+'</div><div style="font-size:11px;color:#666">比赛</div></div>'+
      '<div style="background:#fff;border-radius:10px;padding:12px 16px;text-align:center;min-width:80px;box-shadow:0 1px 4px rgba(0,0,0,0.08)"><div style="font-size:22px;font-weight:700;color:#007acc">'+(ss.problemset_count||0)+'</div><div style="font-size:11px;color:#666">题单</div></div>'+
      '<div style="background:#fff;border-radius:10px;padding:12px 16px;text-align:center;min-width:80px;box-shadow:0 1px 4px rgba(0,0,0,0.08)"><div style="font-size:22px;font-weight:700;color:#007acc">'+(ss.comment_count||0)+'</div><div style="font-size:11px;color:#666">评论</div></div></div>';
  }
  var dh='';
  if(data.mainContent){
    var mc=data.mainContent;
    mc=mc.replace(/src=(["'])([^"']*?)\1/gi,function(match,quote,src){
      if(src&&!src.startsWith('http')&&!src.startsWith('data:')&&!src.startsWith('//')){
        var cp=src.replace(/^\.?\//,'').replace(/^\/+/,'');
        if(cp.startsWith('OnlineJudge/')){
          return 'src='+quote+b.replace(/\/+$/,'')+'/'+cp+quote;
        }
        return 'src='+quote+b.replace(/\/+$/,'')+'/OnlineJudge/'+cp+quote;
      }
      return match;
    });
    mc=mc.replace(/href=["']([^"']*?)["']/gi,function(match,href){
      if(href&&!href.startsWith('http')&&!href.startsWith('data:')&&!href.startsWith('//')&&!href.startsWith('javascript:')){
        var cp=href.replace(/^\.?\//,'').replace(/^\/+/,'');
        if(cp.startsWith('OnlineJudge/')){
          return 'href="'+b.replace(/\/+$/,'')+'/'+cp+'"';
        }
        return 'href="'+b.replace(/\/+$/,'')+'/OnlineJudge/'+cp+'"';
      }
      return match;
    });
    var displayName = username ? ('正在看这段文字的' + username) : '未登录用户';
    mc=mc.replace(/Replace/g,displayName);
    dh='<div id="content">'+mc+'</div>';
  }else{dh='<div id="content"><h1 style="text-align:center;font-family:Georgia;font-size:26px"><strong>欢迎访问 FZYZ Online Judge</strong></h1><p style="text-align:center">在线: '+esc(data.stats.onlineUsers||'?')+' 人</p></div>';}
  return wrapWithMathJax('YZOJ \u9996\u9875',
    '<style>'+
    'body{font-family:Georgia,"Times New Roman",system-ui,sans-serif;background:#f7f9fb;padding:16px;color:#333;font-size:14px;line-height:1.8}'+
    '#content{background:#fff;border-radius:8px;padding:20px;margin-bottom:16px;box-shadow:0 2px 8px rgba(0,0,0,0.1);word-break:break-word;overflow-x:auto}'+
    '#content h1{text-align:center;font-size:26px;margin:20px 0;font-family:Georgia;font-weight:700}'+
    '#content h2{font-size:18px;margin:16px 0 12px;color:#333;font-family:Georgia}'+
    '#content h3{font-size:16px;margin:12px 0 8px;color:#333;font-family:Georgia}'+
    '#content p{margin:8px 0;font-size:14px}'+
    '#content a{color:#007acc;text-decoration:none}'+
    '#content a:hover{text-decoration:underline}'+
    '#content img{max-width:100%;height:auto;display:block;margin:12px auto}'+
    '#content pre{background:#f6f8fa;padding:12px;border-radius:6px;font-size:13px;overflow-x:auto;font-family:Consolas,Monaco,monospace}'+
    '#content table{border-collapse:collapse;margin:8px auto;font-size:13px;width:100%}'+
    '#content th,#content td{padding:6px 10px;border:1px solid #ddd;text-align:center}'+
    '#content th{background:#f5f5f5;font-weight:600}'+
    '#content ul,#content ol{margin:8px 0;padding-left:24px}'+
    '#content li{margin:4px 0;font-size:14px}'+
    '#content code{background:#f0f0f0;padding:2px 6px;border-radius:3px;font-size:13px;font-family:Consolas,Monaco,monospace}'+
    '</style>'+dh+statsHtml+'<script>var v=window.vscodeApi||acquireVsCodeApi();</script>', b);
}

function getContestWebviewContent(n,data,action,b){
  var c=data.contests,cp=data.currentPage,tp=data.totalPages||1,h='',kw=esc(data.currentKeyword||'');
  if(!c||!c.length)h='<div style="text-align:center;padding:40px;color:#888">\u6682\u65E0\u6BD4\u8D5B</div>';
  else{h='<table class="tbl"><thead><tr><th style="width:10%">\u7F16\u53F7</th><th style="width:53%">\u6BD4\u8D5B\u540D\u79F0</th><th style="width:25%">\u5F00\u59CB\u65F6\u95F4</th><th style="width:12%">\u72B6\u6001</th></tr></thead><tbody>';c.forEach(function(x){var id=esc(String(x.id)),url=esc(x.url||(b+'/OnlineJudge/contest_show.php?id='+x.id)),hid=x.isHidden?'true':'false',nm=esc(x.name);var st='',sc='';if(x.status=='Ended'||action=='past'){st='\u5DF2\u7ED3\u675F';sc='past';}else if(action=='now'){st='\u8FDB\u884C\u4E2D';sc='active';}else if(action=='scheduled'){st='\u8BA1\u5212\u4E2D';sc='scheduled';}else{st=x.status||'\u5DF2\u7ED3\u675F';sc=x.type||x.status||'past';}h+='<tr class="cd" data-id="'+id+'" data-url="'+url+'" data-title="'+esc(x.name)+'" data-ishidden="'+hid+'"><td style="text-align:center;font-weight:700;color:#007acc;font-size:12px;font-family:monospace">'+id+'</td><td style="text-align:left;word-break:break-word">'+nm+'</td><td style="text-align:center;font-size:12px;color:#666">'+esc(x.time||'')+'</td><td style="text-align:center"><span class="s '+sc+'">'+st+'</span></td></tr>';});h+='</tbody></table>';}
  return wrapWithMathJax(esc(n),
    '<style>body{font-family:system-ui,sans-serif;background:#f7f9fb;padding:16px;color:#333;font-size:13px}h2{font-size:17px;margin:0 0 10px}.p{display:flex;gap:6px;margin-bottom:10px;align-items:center}.p button{padding:5px 12px;border-radius:6px;border:1px solid #dbeaff;background:#fff;color:#007acc;cursor:pointer;font-size:12px}.p button:disabled{opacity:0.4}.p span{font-size:12px;color:#666}.pf{background:#fff;border-radius:10px;padding:12px;margin-bottom:12px;box-shadow:0 1px 4px rgba(0,0,0,0.08)}.fr{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px;align-items:center}.fr input{flex:1;min-width:60px;padding:5px 8px;border:1px solid #dbeaff;border-radius:5px;font-size:12px}.fb{padding:6px 14px;background:#007acc;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;margin:2px}.tbl{width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);margin-top:8px}.tbl th{background:#f5f7fa;padding:8px 12px;text-align:center;font-weight:600;font-size:12px;color:#666;border-bottom:2px solid #eee}.tbl td{padding:7px 12px;text-align:center;border-bottom:1px solid #f0f0f0}.tbl td p{margin:0}.tbl tr:hover{background:#f8fafb}.tbl tr:hover td:first-child{border-left:3px solid #007acc}.tbl .cd{cursor:pointer}.tbl .cd:hover{background:#f0f7ff}.s{padding:3px 8px;border-radius:6px;font-size:11px;font-weight:600;white-space:nowrap;display:inline-block}.s.past{background:#dafbe1;color:#2ea043}.s.active{background:#fff4e6;color:#fa5a05}.s.scheduled{background:#e6f0fa;color:#007acc}</style><h2>'+esc(n)+'</h2><div class="p"><button id="pr"'+(cp<=1?' disabled':'')+'><</button><span>'+cp+'</span><button id="nx"'+(cp>=tp?' disabled':'')+'>></button></div><div class="pf"><div class="fr"><input type="text" id="fKeyword" placeholder="\u641C\u7D22\u6BD4\u8D5B\u540D\u79F0..." style="width:100%" value="'+kw+'"></div><div><button class="fb" id="btnSearch">\u641C\u7D22</button></div></div>'+h+
    '<script>var v=window.vscodeApi||acquireVsCodeApi();var act="'+action+'";var b="'+b+'";document.querySelectorAll(".cd").forEach(function(e){e.onclick=function(){v.postMessage({command:"openContest",id:e.dataset.id,url:e.dataset.url,title:e.dataset.title})}});document.getElementById("pr").onclick=function(){v.postMessage({command:"changePage",p:'+(cp-1)+'})};document.getElementById("nx").onclick=function(){v.postMessage({command:"changePage",p:'+(cp+1)+'})};document.getElementById("btnSearch").onclick=function(){var kw=document.getElementById("fKeyword").value.trim();if(kw){v.postMessage({command:"searchContest",act:act,keyword:kw})}};document.getElementById("fKeyword").onkeypress=function(e){if(e.key==="Enter"){var kw=document.getElementById("fKeyword").value.trim();if(kw){v.postMessage({command:"searchContest",act:act,keyword:kw})}}};</script>', b);
}

function getContestDetailWebview(d,b){
  var ih='',ph='',lh='',dh='',cid=JSON.stringify(d.contestId||'');
  // 为描述中的站内链接/图片补全 baseUrl
  if(b && d.description) d.description = d.description.replace(/(src|href)\s*=\s*(["'])\/((?:OnlineJudge|Upload)\/[^"']*?)\2/gi, function(m, attr, quote, path) { return attr + '=' + quote + b.replace(/\/+$/, '') + '/' + path + quote; });
  if(d.info)Object.entries(d.info).forEach(function(e){
    var v=e[1];
    // 出题人：如果有 authors 数组，用 userLinkHtml 渲染，支持用户卡片/颜色/点击跳转
    if(e[0]==='出题人'&&d.authors&&d.authors.length>0){
      var authorLinks=d.authors.map(function(a,i){
        return userLinkHtml(a, d.authorIds&&d.authorIds[i]||'', -1, d.authorColors&&d.authorColors[i]||'', false, null, d.authorHtmls&&d.authorHtmls[i]||'');
      });
      v='<div style="margin-top:2px">'+authorLinks.join('</div><div style="margin-top:2px">')+'</div>';
    }else if(e[0]==='出题人'){
      // fallback：没有带 userId 的解析结果，也至少给个纯文本换行显示
      v='<div style="margin-top:2px">'+v.replace(/[、\u3001]/g,'</div><div style="margin-top:2px">')+'</div>';
    }
    ih+='<div class="gi"><span class="gl">'+esc(e[0])+'</span><span class="gv">'+v+'</span></div>';
  });
  if(d.description)dh='<div class="c desc"><h3 style="margin:0 0 6px;font-size:13px;color:#007acc;text-align:center">\u6BD4\u8D5B\u8BF4\u660E</h3><div class="dc">'+d.description+'</div></div>';
  if(d.problems)d.problems.forEach(function(p){
    // 正确解析分数：提取数字部分
    var scoreNum = parseInt(String(p.score).replace(/[^\d]/g, '')) || 0;
    // 是否已提交（有 statusId/statusUrl 表示有评测记录）
    var hasSubmit = !!(p.statusId || p.statusUrl);
    // 颜色逻辑：
    //   - 未提交 → 黑色（无特殊 class）
    //   - 已提交 + AC(100分) → 绿色（h）
    //   - 已提交 + 非AC → 红色（l）
    var sc = hasSubmit ? (scoreNum >= 100 ? 'h' : 'l') : '';
    // 通过标记显示逻辑
    var mkHtml='';
    // 使用 markUrl，如果为空则回退到 statusUrl（分数列链接）
    var markLinkUrl = p.markUrl || p.statusUrl || '';
    if(markLinkUrl){
      // 只要有提交记录（markUrl 或 statusUrl），就渲染可点击的 mark 链接
      var mkClass = (p.mark === 'ac') ? 'ac' : 'att';
      var mkSymbol = (p.mark === 'ac') ? '✓' : '●';
      mkHtml='<a href="javascript:void(0)" data-status-url="'+esc(markLinkUrl)+'" style="text-decoration:none;color:inherit" class="mark-link"><span class="pmk '+mkClass+'">'+mkSymbol+'</span></a>';
    }else{
      if(p.mark==='ac')mkHtml='<span class="pmk ac">✓</span>';
      else if(p.mark==='attempted')mkHtml='<span class="pmk att">●</span>';
      else mkHtml='<span class="pmk"></span>';
    }
    var statusAttrs='';
    if(p.statusId){statusAttrs=' data-status-id="'+esc(p.statusId)+'" style="cursor:pointer;text-decoration:underline"';}
    var scoreStyle=p.scoreColor?'color:'+esc(p.scoreColor)+';':'';
    ph+='<div class="pc" data-id="'+esc(p.problemId)+'" data-url="'+esc(p.url)+'">'+mkHtml+'<span class="po">#'+esc(p.order)+'('+esc(p.problemId)+')</span><span class="pn">'+esc(p.name)+'</span><span class="ps '+sc+'"'+statusAttrs+' style="'+scoreStyle+'">'+esc(p.score)+'</span></div>';
  });
  if(d.links)d.links.forEach(function(l){lh+='<button class="ab" data-url="'+esc(l.url)+'">'+esc(l.text)+'</button>';});
  return wrapWithMathJax(mdToHtml(d.title||'\u6BD4\u8D5B'),
    '<style>body{font-family:system-ui,sans-serif;background:#f7f9fb;padding:16px;color:#333}.c{background:#fff;border-radius:10px;padding:16px;margin-bottom:12px;box-shadow:0 1px 4px rgba(0,0,0,0.08)}h2{font-size:18px;margin:0 0 12px;color:#007acc;border-bottom:2px solid #007acc;padding-bottom:8px}.gi{display:inline-block;width:45%;margin:3px 2%;vertical-align:top}.gl{color:#666;font-size:11px;display:block;margin-bottom:2px}.gv{font-weight:600;font-size:13px}.desc{border-left:4px solid #007acc}.dc{font-size:13px;line-height:1.8;white-space:pre-wrap;word-break:break-word;text-align:left;padding:12px;background:#f9f9f9;border-radius:6px;margin-top:8px}.dc table{border-collapse:collapse;margin:8px auto;font-size:12px}.dc th,.dc td{padding:4px 8px;border:1px solid #ddd;text-align:center}.dc th{background:#f5f5f5}.dc pre{background:#f6f8fa;padding:10px;border-radius:6px;font-size:12px;overflow-x:auto;text-align:left}.pc{padding:12px 16px;display:flex;align-items:center;gap:8px;cursor:pointer;border-radius:8px;margin:4px 0;background:#fff;border:1px solid #e1e4e8;transition:all 0.2s}.pc:hover{background:#e6f0fa;border-color:#007acc;transform:translateX(2px)}.pmk{font-size:16px;min-width:24px;text-align:center;font-weight:bold}.pmk.ac{color:#28a745}.pmk.att{color:#ffc107;font-size:14px}.po{font-weight:700;color:#007acc;background:#e6f0fa;padding:3px 10px;border-radius:6px;font-size:13px;flex-shrink:0}.pn{flex:1;font-size:14px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ps{padding:4px 12px;border-radius:6px;font-weight:600;font-size:13px;background:#f0f0f0;flex-shrink:0}.ps.h{background:#dafbe1;color:#2ea043}.ps.m{background:#fff4e6;color:#fa5a05}.ps.l{background:#ffebe9;color:#cf222e}.ab{padding:8px 16px;border:1px solid #dbeaff;border-radius:6px;background:#fff;color:#007acc;cursor:pointer;margin:4px;font-size:13px;transition:all 0.2s}.ab:hover{background:#007acc;color:#fff}.pb{background:#007acc;color:#fff;padding:8px 20px;border:none;border-radius:8px;cursor:pointer;font-size:14px;display:block;margin:16px auto;font-weight:500;transition:all 0.2s}.pb:hover{background:#005999;transform:scale(1.05)}h3{color:#007acc;font-weight:600;margin-bottom:8px}</style><div class="c"><h2>'+mdToHtml(d.title)+'</h2>'+ih+'</div><button class="pb" id="bf">\u521B\u5EFA\u5DE5\u4F5C\u533A</button>'+dh+'<div class="c"><h3>\u9898\u76EE\u5217\u8868 ('+(d.problems?d.problems.length:0)+')</h3>'+ph+'</div>'+(lh?'<div style="text-align:center;margin-top:12px">'+lh+'</div>':'')+
    '<script>var v=window.vscodeApi||acquireVsCodeApi();document.querySelectorAll(".pc").forEach(function(e){e.onclick=function(ev){if(ev.target&&ev.target.closest&&ev.target.closest(".mark-link")){ev.stopPropagation();return;}if(ev.target&&ev.target.classList&&ev.target.classList.contains("ps")&&ev.target.dataset&&ev.target.dataset.statusId){ev.stopPropagation();return;}v.postMessage({command:"openProblem",id:e.dataset.id,url:e.dataset.url})}});document.querySelectorAll(".ps[data-status-id]").forEach(function(e){e.onclick=function(ev){if(ev&&ev.stopPropagation)ev.stopPropagation();v.postMessage({command:"openStatusDetail",id:e.dataset.statusId})}});document.querySelectorAll(".mark-link[data-status-url]").forEach(function(e){e.onclick=function(ev){if(ev)ev.preventDefault();if(ev&&ev.stopPropagation)ev.stopPropagation();try{var u=e.dataset.statusUrl;var u2=e.getAttribute("data-status-url");var m=u.match(/status_details\\.php\\?[^#?&]*id=(\\d+)/);if(!m){m=u.match(/source_show\\.php\\?[^#?&]*id=(\\d+)/);}if(m&&m[1]){v.postMessage({command:"openStatusDetail",id:m[1]});}else{var m2=u2.match(/status_details\\.php\\?[^#?&]*id=(\\d+)/);if(m2&&m2[1]){v.postMessage({command:"openStatusDetail",id:m2[1]})}else{var pc=e.closest(".pc");v.postMessage({command:"loadProblemStatus",problemId:pc?pc.dataset.id:""})}}}catch(err){}}});document.querySelectorAll(".ab[data-url]").forEach(function(e){e.onclick=function(){v.postMessage({command:"openExternal",url:e.dataset.url})}});document.getElementById("bf").onclick=function(){v.postMessage({command:"createContestFolder",contestId:'+JSON.stringify(d.contestId||'')+',contestName:'+JSON.stringify(d.title)+',problems:'+JSON.stringify(d.problems||[])+'})}</script>', b);
}

function getProblemDetailWebview(d,b){
  var mh='',th='',title=mdToHtml(d.title||'P'+d.problemId||''),pid=d.problemId||'';
  var passRate=d.meta&&d.meta.passRate?esc(d.meta.passRate)+'%':'';
  var difficulty=d.difficulty?'\u96BE\u5EA6'+esc(d.difficulty):'';
  var acCount=d.acCount||d.meta&&d.meta.acCount||'';
  var subCount=d.subCount||d.meta&&d.meta.subCount||'';
  var mark=d.mark||'';
  var markHtml='';
  if(mark==='ac')markHtml='<span class="badge mark-ac">✓ AC</span>';
  else if(mark==='attempted')markHtml='<span class="badge mark-att">● 尝试</span>';
  // 预计算 CPH 参数（嵌入客户端脚本用，避免引用客户端不存在的变量 d）
  var _cphName = (d.problemId ? 'P' + d.problemId + ' ' : '') + (d.title || '');
  var _cphUrl = d.url || '';
  var _cphPid = d.problemId || '';
  var _cphMemLimit = (function(){
    var raw = d.meta && d.meta.memoryLimit;
    if (!raw) return 256;
    var m = String(raw).match(/(\d+\.?\d*)\s*(MB|mb|M|m)/);
    if (m) return Math.round(parseFloat(m[1]));
    m = String(raw).match(/(\d+\.?\d*)\s*(KB|kb|K|k)/);
    if (m) return Math.max(Math.round(parseFloat(m[1]) / 1024), 1);
    var n = parseInt(raw);
    return n > 0 ? n : 256;
  })();
  var _cphTimeLimit = (function(){
    var raw = d.meta && d.meta.timeLimit;
    if (!raw) return 1000;
    var m = String(raw).match(/(\d+\.?\d*)\s*(s|S|秒)/);
    if (m) return Math.round(parseFloat(m[1]) * 1000);
    m = String(raw).match(/(\d+\.?\d*)\s*(ms|MS|毫秒)/);
    if (m) return Math.round(parseFloat(m[1]));
    m = String(raw).match(/(\d+)/);
    if (m) return parseInt(m[1]) > 100 ? parseInt(m[1]) : parseInt(m[1]) * 1000;
    return 1000;
  })();
  if(d.meta){if(d.meta.timeLimit)mh+='<div class="mi"><span class="ml">时间</span><span class="mv">'+esc(d.meta.timeLimit)+'</span></div>';if(d.meta.memoryLimit)mh+='<div class="mi"><span class="ml">内存</span><span class="mv">'+esc(d.meta.memoryLimit)+'</span></div>';}
  if(d.tags&&d.tags.length>0)th='<div>'+d.tags.map(function(t){return '<span class="tg2">'+esc(t)+'</span>';}).join('')+'</div>';
  if(d.authors&&d.authors.length>0)th+='<div style="font-size:12px;color:#666;margin-top:4px">\u51FA\u9898\u4EBA:'+d.authors.slice(0,3).map(function(a,i){return userLinkHtml(a, d.authorIds&&d.authorIds[i]||'', d.authorSolvedCounts&&d.authorSolvedCounts[i]!==undefined?d.authorSolvedCounts[i]:-1, d.authorColors&&d.authorColors[i]||'', false, null, d.authorHtmls&&d.authorHtmls[i]||'')}).join(', ')+(d.authors.length>3?'...':'')+'</div>';
  var sh='';
  if(d.sectionsHtml){Object.entries(d.sectionsHtml).forEach(function(e){var c=e[1];if(c&&!c.match(/^\s*</))c='<div class="problem-content">'+esc(c)+'</div>';else c='<div class="problem-content">'+c+'</div>';c=c.replace(/src=(["'])([^"']*?)\1/gi,function(match,quote,src){if(src&&!src.startsWith('http')&&!src.startsWith('data:')&&!src.startsWith('//')){var cp=src.replace(/^\.?\//,'').replace(/^\/+/,'');if(cp.startsWith('OnlineJudge/')){return 'src='+quote+b.replace(/\/+$/,'')+'/'+cp+quote;}return 'src='+quote+b.replace(/\/+$/,'')+'/OnlineJudge/'+cp+quote;}return match;});sh+='<div class="sc"><h3>'+esc(e[0])+'</h3>'+c+'</div>';});}else if(d.sections){Object.entries(d.sections).forEach(function(e){sh+='<div class="sc"><h3>'+esc(e[0])+'</h3><pre>'+esc(e[1])+'</pre></div>';});}
  return wrapWithMathJax(title,
    '<style>body{font-family:system-ui,sans-serif;background:#f7f9fb;padding:16px;color:#333;font-size:14px;line-height:1.7}*{box-sizing:border-box}.cc{background:#fff;border-radius:10px;padding:16px;margin-bottom:12px;box-shadow:0 1px 4px rgba(0,0,0,0.08)}.title-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.title-row h2{font-size:17px;margin:0;flex:1}.title-row .badge{font-size:11px;padding:2px 8px;border-radius:4px;font-weight:500}.badge.difficulty{background:#dafbe1;color:#2ea043}.badge.passrate{background:#e6f0fa;color:#007acc}.badge.mark-ac{background:#28a745;color:#fff}.badge.mark-att{background:#ffc107;color:#333}.mg{display:flex;gap:12px;font-size:12px;margin-top:8px}.mi{display:flex;flex-direction:column}.ml{color:#666;font-size:11px}.mv{font-weight:500}.tg2{background:#f0f0f0;color:#666;padding:2px 8px;border-radius:6px;font-size:11px;margin:2px;display:inline-block}.sc{background:#fff;border-radius:10px;padding:14px 16px;margin:12px 0;box-shadow:0 1px 4px rgba(0,0,0,0.08);overflow-x:auto}.sc h3{font-size:15px;margin:0 0 10px;padding-bottom:6px;border-bottom:1px solid #eee;color:#007acc}.problem-content{font-size:14px;line-height:1.8;word-break:break-word}.problem-content table{border-collapse:collapse;margin:8px 0;font-size:13px}.problem-content th,.problem-content td{padding:5px 8px;border:1px solid #ddd;text-align:center}.problem-content th{background:#f5f5f5;font-weight:600}.problem-content pre{background:#f6f8fa;padding:10px;border-radius:6px;font-size:13px;overflow-x:auto;line-height:1.5}.problem-content img{max-width:100%}.btn-row{display:flex;flex-wrap:wrap;gap:6px;justify-content:center;margin-top:16px}.btn-row .ab{flex:0 1 auto}.ab{padding:6px 16px;border:1px solid #dbeaff;border-radius:8px;background:#fff;color:#007acc;cursor:pointer;font-size:13px;margin:3px}.ab.p{background:#007acc;color:#fff}.stat-link{color:#007acc;cursor:pointer;text-decoration:underline}.stat-link:hover{color:#005a9e}.download-link{color:#007acc;cursor:pointer;text-decoration:underline}.download-link:hover{color:#005a9e}</style><div class="cc"><div class="title-row"><h2>'+title+'</h2>'+markHtml+(difficulty?'<span class="badge difficulty">'+difficulty+'</span>':'')+(passRate?'<span class="badge passrate">\u901A\u8FC7\u7387 '+passRate+'</span>':'')+'</div><div class="mg">'+mh+(acCount||subCount?'<div class="mi"><span class="ml">\u901A\u8FC7/\u63D0\u4EA4</span><span class="mv"><span class="stat-link" id="linkAc">'+esc(acCount||'0')+'</span>/<span class="stat-link" id="linkSub">'+esc(subCount||'0')+'</span></span></div>':'')+'</div>'+th+'</div>'+sh+'<div class="btn-row"><button class="ab p" id="bc">\u53D1\u9001\u81F3CPH</button><button class="ab" id="btnSolutions">\u9898\u89E3</button><button class="ab" id="btnDiscussions">\u8BA8\u8BBA</button><button class="ab" id="btnStatus">\u72B6\u6001</button></div>'+
    '<script>var v=window.vscodeApi||acquireVsCodeApi();var pid="'+pid+'";var dSamples=(function(){try{return '+JSON.stringify(d.samples||[])+';}catch(e){return [];}})();document.querySelectorAll(".copy-sample-btn,.sample-copy-btn").forEach(function(b){b.onclick=function(){navigator.clipboard.writeText(b.dataset.text).then(function(){b.textContent="\u5DF2\u590D\u5236";b.style.background="#2ea043";setTimeout(function(){b.textContent="\u590D\u5236";b.style.background="#007acc"},1500)}).catch(function(){})}});document.querySelectorAll(".download-link").forEach(function(a){a.onclick=function(e){e.preventDefault();v.postMessage({command:"downloadFile",url:a.getAttribute("href")})}});document.getElementById("bc").onclick=function(){var tests=(dSamples||[]).map(function(s){return{input:(s&&s.input!=null)?String(s.input):"",output:(s&&s.output!=null)?String(s.output):""}});v.postMessage({command:"sendToCPH",problem:{name:'+JSON.stringify(_cphName)+',problemId:'+JSON.stringify(_cphPid)+',group:"FZYZOJ",url:'+JSON.stringify(_cphUrl)+',memoryLimit:'+_cphMemLimit+',timeLimit:'+_cphTimeLimit+',tests:tests,samples:dSamples||[]}})};document.getElementById("btnSolutions").onclick=function(){v.postMessage({command:"loadSolutions",problemId:pid})};document.getElementById("btnDiscussions").onclick=function(){v.postMessage({command:"loadDiscussions",problemId:pid})};document.getElementById("btnStatus").onclick=function(){v.postMessage({command:"loadProblemStatus",problemId:pid})};var linkAc=document.getElementById("linkAc");if(linkAc)linkAc.onclick=function(){v.postMessage({command:"openStatusWithFilter",problemId:pid,status:"ac"})};var linkSub=document.getElementById("linkSub");if(linkSub)linkSub.onclick=function(){v.postMessage({command:"openStatusWithFilter",problemId:pid})};</script>', b);
}

// =====================================================
// 评测详情 Webview (重构版)
// =====================================================

function getStatusDetailWebview(data, baseUrl) {
  // ========== 数据准备 ==========
  
  var score = parseInt(data.summary.score) || 0;
  var scoreClass = score === 100 ? 'h' : (score === 0 ? 'l' : 'm');
  var statusText = data.summary.status || (score >= 100 ? 'Accepted' : 'Wrong Answer');
  var rawStatus = data.summary.rawStatus || '';
  var failTestId = data.summary.failTestId || '';
  
  // 解析状态（跟评测列表一样）
  function parseStatusDetail(statusText, rawStatus) {
    var text = statusText || '';
    var raw = rawStatus || '';
    
    if (raw.includes('run') || raw.includes('judging') || raw.includes('评测中') || raw.includes('running')) {
      return { short: 'Judging', detail: '正在评测中', isRunning: true };
    }
    
    if (raw.includes('wait') || raw.includes('pending') || raw.includes('等待') || raw.includes('queued')) {
      return { short: 'Queued', detail: '等待评测', isRunning: true };
    }
    
    if (text.includes('Compile Error') || text.includes('编译') || text.includes('CE') || raw.includes('compile')) {
      return { short: 'CE', detail: '编译错误', isRunning: false };
    }
    
    if (text.includes('Accepted') || text.includes('正确') || text.includes('AC')) {
      return { short: 'AC', detail: '通过', isRunning: false };
    }
    
    var errorMap = [
      { keys: ['段错误', 'Segmentation', 'SIGSEGV', '运行错误'], short: 'RE', detail: '段错误' },
      { keys: ['超时', 'Time Limit', 'TLE', '时间超限'], short: 'TLE', detail: '时间超限' },
      { keys: ['超内存', 'Memory Limit', 'MLE', '内存超限'], short: 'MLE', detail: '内存超限' },
      { keys: ['Wrong Answer', '答案错误', 'WA', '结果错误'], short: 'WA', detail: '答案错误' },
      { keys: ['Output Limit', '输出超限', 'OLE'], short: 'OLE', detail: '输出超限' },
      { keys: ['已放弃', 'Aborted', 'ABORT', 'abort'], short: 'ABORT', detail: '已放弃' }
    ];
    
    for (var i = 0; i < errorMap.length; i++) {
      var item = errorMap[i];
      for (var j = 0; j < item.keys.length; j++) {
        if (text.includes(item.keys[j]) || raw.includes(item.keys[j])) {
          return { short: item.short, detail: item.detail, isRunning: false };
        }
      }
    }
    
    if (text) {
      return { short: text.slice(0, 10), detail: text, isRunning: false };
    }
    
    return { short: '-', detail: '未知', isRunning: false };
  }
  
  var statusInfo = parseStatusDetail(statusText, rawStatus);
  var shortStatus = statusInfo.short;
  var isRunning = statusInfo.isRunning;
  var isAC = shortStatus === 'AC';
  
  // 构建状态显示（带 failTestId）
  var statusDisplay = shortStatus;
  if (!isAC && !isRunning && failTestId) {
    statusDisplay += ' on #' + failTestId;
  }
  
  // 状态样式类
  var statusBadgeClass = 'status-badge';
  if (isAC) statusBadgeClass += ' status-ac';
  else if (isRunning) statusBadgeClass += ' status-running';
  else if (shortStatus === 'CE') statusBadgeClass += ' status-ce';
  else if (shortStatus === 'WA') statusBadgeClass += ' status-wa';
  else if (shortStatus === 'TLE') statusBadgeClass += ' status-tle';
  else if (shortStatus === 'MLE') statusBadgeClass += ' status-mle';
  else if (shortStatus === 'RE') statusBadgeClass += ' status-re';
  else statusBadgeClass += ' status-other';
  
  // 测试点表格
  var testCasesHtml = '';
  if (data.testCases && data.testCases.length > 0) {
    data.testCases.forEach(function(tc) {
      var isOk = tc.status.indexOf('正确') >= 0 || tc.status.indexOf('Accepted') >= 0;
      var scoreColor = isOk ? '#2ea043' : '#cf222e';
      testCasesHtml += '<tr>' +
        '<td>#' + esc(tc.id) + '</td>' +
        '<td>' + esc(tc.fullScore) + '</td>' +
        '<td style="color:' + scoreColor + ';font-weight:600">' + esc(tc.score) + '</td>' +
        '<td>' + (isOk ? '✓' : esc(tc.status)) + '</td>' +
        '<td>' + esc(tc.time) + '</td>' +
        '<td>' + esc(tc.memory) + '</td>' +
      '</tr>';
    });
  } else {
    testCasesHtml = '<tr><td colspan="6" style="color:#888">无详细数据</td></tr>';
  }
  
  // 子任务表格
  var subTasksHtml = '';
  if (data.subTasks && data.subTasks.length > 0) {
    data.subTasks.forEach(function(st) {
      var stScore = parseInt(st.score) || 0;
      var stFull = parseInt(st.fullScore) || 0;
      var stColor = stScore >= stFull ? '#2ea043' : '#cf222e';
      subTasksHtml += '<tr>' +
        '<td>' + esc(st.id) + '</td>' +
        '<td>' + esc(st.method) + '</td>' +
        '<td>' + esc(st.weight) + '</td>' +
        '<td>' + esc(st.fullScore) + '</td>' +
        '<td style="font-weight:600;color:' + stColor + '">' + esc(st.score) + '</td>' +
        '<td>' + esc(st.testPoints) + '</td>' +
      '</tr>';
    });
  }

  // ========== CSS 样式 ==========
  
  var styles = `
body{font-family:system-ui,sans-serif;background:#f7f9fb;padding:16px;color:#333}
.card{background:#fff;border-radius:10px;padding:16px;margin-bottom:12px;box-shadow:0 1px 4px rgba(0,0,0,0.08)}
h2{font-size:17px;margin:0}
.badge{font-size:11px;padding:2px 6px;border-radius:4px;font-weight:600}
.badge.h{background:#dafbe1;color:#2ea043}
.badge.m{background:#fff4e6;color:#fa5a05}
.badge.l{background:#ffebe9;color:#cf222e}
.status-badge{font-size:11px;padding:2px 6px;border-radius:4px;font-weight:600;margin-left:6px}
.status-badge.status-ac{background:#dafbe1;color:#28a745}
.status-badge.status-running{background:#ddf4ff;color:#0969da;animation:pulse 1.5s infinite}
.status-badge.status-ce{background:#ffebe9;color:#cf222e}
.status-badge.status-wa{background:#ffe4e4;color:#cf222e}
.status-badge.status-tle{background:#fff4e5;color:#bf5c00}
.status-badge.status-mle{background:#fbefff;color:#8250df}
.status-badge.status-re{background:#fff0f7;color:#bf3989}
.status-badge.status-other{background:#f6f8fa;color:#666}
.info-grid{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px;font-size:12px}
.info-item{flex:1;min-width:90px}
.info-label{color:#666;font-size:11px;display:block}
.info-value{font-weight:500}
.section{background:#fff;border-radius:10px;padding:14px 16px;margin:12px 0;box-shadow:0 1px 4px rgba(0,0,0,0.08)}
.section h3{font-size:14px;margin:0 0 10px;color:#007acc}
table{width:100%;border-collapse:collapse;font-size:12px}
th,td{padding:5px 6px;border:1px solid #e1e4e8;text-align:center}
th{background:#f6f8fa}
.compile-info{background:#f6f8fa;padding:10px;border-radius:6px;font-family:monospace;font-size:12px;white-space:pre-wrap}
.action-btn{padding:6px 16px;border:1px solid #dbeaff;border-radius:6px;background:#fff;color:#007acc;cursor:pointer;font-size:12px;margin:3px}
.action-btn.primary{background:#007acc;color:#fff}
.btn-row{text-align:center}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.6}}
  ` + userCardCss();

  // ========== HTML 结构 ==========
  
  var html = '<div class="card">' +
    '<h2>R' + data.recordId + 
    '<span class="' + statusBadgeClass + '">' + esc(statusDisplay) + '</span>' +
    '<span class="badge ' + scoreClass + '">' + score + '分</span></h2>' +
    '<div class="info-grid">' +
      '<div class="info-item"><span class="info-label">题目</span><span class="info-value">' + esc(data.summary.problemId || '-') + '</span></div>' +
      '<div class="info-item"><span class="info-label">用户</span><span class="info-value">' + (data.summary.userDelegation && data.summary.userDelegation.length > 1 ? delegationUserHtml(data.summary.userDelegation, {}) : userLinkHtml(data.summary.user, data.summary.userId || '', data.summary.solvedCount!==undefined?data.summary.solvedCount:-1, data.summary.userColor || '', false, null, data.summary.userHtml || '')) + '</span></div>' +
      '<div class="info-item"><span class="info-label">编译器</span><span class="info-value">' + esc(data.summary.compiler) + '</span></div>' +
      '<div class="info-item"><span class="info-label">耗时</span><span class="info-value">' + esc(data.summary.totalTime) + '</span></div>' +
      '<div class="info-item"><span class="info-label">提交</span><span class="info-value">' + esc(data.summary.submitTime) + '</span></div>' +
      '<div class="info-item"><span class="info-label">评测</span><span class="info-value">' + esc(data.summary.evalTime) + '</span></div>' +
    '</div>' +
  '</div>';

  // 子任务部分
  if (subTasksHtml) {
    html += '<div class="section"><h3>子任务</h3><table><thead><tr>' +
      '<th>#</th><th>计算方法</th><th>权重</th><th>满分</th><th>得分</th><th>包含测试点</th>' +
    '</tr></thead><tbody>' + subTasksHtml + '</tbody></table></div>';
  }

  // 测试点部分
  html += '<div class="section">' +
    '<h3>测试点 (' + (data.testCases ? data.testCases.length : 0) + ')</h3>' +
    '<table><thead><tr>' +
      '<th>#</th><th>满分</th><th>得分</th><th>状态</th><th>耗时</th><th>内存</th>' +
    '</tr></thead><tbody>' + testCasesHtml + '</tbody></table>' +
  '</div>';

  // 编译信息
  html += '<div class="section">' +
    '<h3>编译信息</h3>' +
    '<pre class="compile-info">' + esc(data.compileInfo) + '</pre>' +
  '</div>';

  // 操作按钮
  html += '<div class="btn-row">' +
    '<button class="action-btn primary" id="btnOpenCode">打开代码</button>' +
  '</div>';

  // ========== JavaScript ==========
  
  var script = `
var vscode = window.vscodeApi;
document.getElementById("btnOpenCode").onclick = function() {
  vscode.postMessage({
    command: "openCodeInEditor",
    code: ${JSON.stringify(data.sourceCode || '')}
  });
};
// 自动刷新逻辑 - 仅对于正在运行的评测
var isRunning = ${isRunning ? 'true' : 'false'};
if (isRunning) {
  vscode.postMessage({command: 'debugLog', message: '[DEBUG] Auto-refresh enabled for running status'});
  setInterval(function() {
    vscode.postMessage({ command: "refreshStatus" });
  }, 3000);
}
  `;

  return wrapWithMathJax('R' + data.recordId, 
    '<style>' + styles + '</style>' + html + '<script>' + script + '</script>');
}

// =====================================================
// 评测列表 Webview (重构版)
// =====================================================

// 从 records 中构建 tag map JSON（注入到 webview 页面中，使 tag 在加载时立即显示）
function buildUserTagsJson(records) {
  if (!records || !records.length) return '{}';
  var map = {};
  records.forEach(function(r) {
    if (r.tags && r.tags.length) {
      if (r.userId) map[r.userId] = r.tags;
      if (r.user) map[r.user] = r.tags;
    }
  });
  return JSON.stringify(map).replace(/</g, '\\u003c');
}

function getStatusListWebview(data, baseUrl) {
  // ========== 数据准备 ==========
  
  var records = data.records || [];
  var currentPage = data.currentPage || 1;
  var totalPages = data.totalPages || 1;
  var filters = data.filters || {};
  
  // ========== 辅助函数 ==========
  
  // 安全转义 JSON 字符串，防止 </script> 破坏 HTML 脚本标签
  function safeScriptJSON(obj) {
    // 如果 obj 已经是字符串，则直接转义；否则先序列化
    var jsonStr = typeof obj === 'string' ? obj : JSON.stringify(obj);
    return jsonStr.replace(/<\//g, '<\\/');
  }
  
  // 解析状态文本，返回 {short: 短状态, detail: 详细信息, isRunning: 是否正在运行}
  function parseStatus(statusText, rawStatus) {
    var text = statusText || '';
    var raw = rawStatus || '';
    
    // 正在编译
    if (raw.includes('compile') || raw.includes('compiling') || text.includes('正在编译')) {
      return { short: 'Compiling', detail: '正在编译', isRunning: true };
    }
    
    // 正在评测中（包括 "评测 8/12" 格式）
    if (raw.includes('run') || raw.includes('judging') || raw.includes('评测中') || raw.includes('running') || 
        raw.includes('评测 ') || text.includes('评测 ') || text.includes('judging')) {
      return { short: 'Judging', detail: text || '正在评测中', isRunning: true };
    }
    
    // 等待评测
    if (raw.includes('wait') || raw.includes('pending') || raw.includes('等待') || raw.includes('queued')) {
      return { short: 'Queued', detail: '等待评测', isRunning: true };
    }
    
    // 编译错误
    if (text.includes('Compile Error') || text.includes('编译错误') || text.includes('CE') || raw.includes('compile error')) {
      return { short: 'CE', detail: '编译错误', isRunning: false };
    }
    
    // Accepted / 通过
    if (text.includes('Accepted') || text.includes('正确') || text.includes('AC')) {
      return { short: 'AC', detail: '通过', isRunning: false };
    }
    
    // 各种错误类型
    var errorMap = [
      { keys: ['段错误', 'Segmentation', 'SIGSEGV', '运行错误'], short: 'RE', detail: '段错误' },
      { keys: ['超时', 'Time Limit', 'TLE', '时间超限'], short: 'TLE', detail: '时间超限' },
      { keys: ['超内存', 'Memory Limit', 'MLE', '内存超限'], short: 'MLE', detail: '内存超限' },
      { keys: ['Wrong Answer', '答案错误', 'WA', '结果错误'], short: 'WA', detail: '答案错误' },
      { keys: ['Output Limit', '输出超限', 'OLE'], short: 'OLE', detail: '输出超限' },
      { keys: ['已放弃', 'Aborted', 'ABORT', 'abort'], short: 'ABORT', detail: '已放弃' }
    ];
    
    for (var i = 0; i < errorMap.length; i++) {
      var item = errorMap[i];
      for (var j = 0; j < item.keys.length; j++) {
        if (text.includes(item.keys[j]) || raw.includes(item.keys[j])) {
          return { short: item.short, detail: item.detail, isRunning: false };
        }
      }
    }
    
    // 未知状态
    if (text) {
      return { short: text.slice(0, 10), detail: text, isRunning: false };
    }
    
    return { short: '-', detail: '未知', isRunning: false };
  }
  
  // 计算题目列宽度
  var maxProbLen = 7;
  records.forEach(function(r) {
    if (r.problemId && r.problemId.length > maxProbLen) {
      maxProbLen = r.problemId.length;
    }
  });
  var probColWidth = Math.max(50, Math.min(maxProbLen * 8, 100));

  // ========== 筛选器 HTML ==========
  var isContestStatus = !!(filters.test || filters.contestId || filters.tid);
  
  var filterHtml = '<div class="filter-bar">' +
    (isContestStatus ? '' : '<input type="text" id="fPid" placeholder="题号" value="' + esc(filters.problemId || filters.pid || '') + '">') +
    (isContestStatus ? '' : '<input type="text" id="fUser" placeholder="用户" value="' + esc(filters.username || filters.uname || '') + '">') +
    '<input type="number" id="fScoreL" placeholder="分数下限" min="0" max="100" style="width:70px" value="' + esc(filters.scorel || '') + '">' +
    '<span>~</span>' +
    '<input type="number" id="fScoreR" placeholder="上限" min="0" max="100" style="width:60px" value="' + esc(filters.scorer || '') + '">' +
    (isContestStatus ? '' : '<select id="fStatus">' +
      '<option value="">全部</option>' +
      '<option value="1" ' + (filters.status === '1' || filters.status === 'ac' ? 'selected' : '') + '>通过</option>' +
      '<option value="2" ' + (filters.status === '2' || filters.status === 'wa' ? 'selected' : '') + '>未通过</option>' +
      '<option value="3" ' + (filters.status === '3' ? 'selected' : '') + '>编译错误</option>' +
      '<option value="0" ' + (filters.status === '0' ? 'selected' : '') + '>等待评测</option>' +
      '<option value="-1" ' + (filters.status === '-1' ? 'selected' : '') + '>正在评测</option>' +
      '<option value="-2" ' + (filters.status === '-2' ? 'selected' : '') + '>正在/等待评测</option>' +
    '</select>') +
    '<select id="fCompiler">' +
      '<option value="">全部</option>' +
      '<option value="G++" ' + (filters.compiler === 'G++' ? 'selected' : '') + '>G++</option>' +
      '<option value="GCC" ' + (filters.compiler === 'GCC' ? 'selected' : '') + '>GCC</option>' +
      '<option value="FPC" ' + (filters.compiler === 'FPC' ? 'selected' : '') + '>FPC</option>' +
    '</select>' +
    '<button class="filter-btn" id="btnFilter">筛选</button>' +
  '</div>';

  // ========== 记录行 HTML ==========
  
  var recordsHtml = '';
  
  if (records.length > 0) {
    records.forEach(function(rec) {
      var score = parseInt(rec.score) || 0;
      var status = rec.status || '';
      var rawStatus = rec.rawStatus || '';
      var failTestId = rec.failTestId || '';
      
      // 处理隐藏评测记录（id=-1）
      if (rec.id === '-1' || rec.id === '-') {
        recordsHtml += '<div class="record-row hidden-row" data-id="' + rec.id + '">' +
          '<span class="rec-id">???</span>' +
          '<span class="rec-prob">???</span>' +
          '<span class="rec-user">???</span>' +
          '<span class="rec-score">???</span>' +
          '<span class="rec-time">???</span>' +
          '<span class="rec-mem">???</span>' +
          '<span class="rec-code">???</span>' +
          '<span class="rec-compiler">???</span>' +
          '<span class="rec-submit">???</span>' +
        '</div>';
        return;
      }
      
      var statusInfo = parseStatus(status, rawStatus);
      var shortStatus = statusInfo.short;
      var isRunning = statusInfo.isRunning;
      var isAC = shortStatus === 'AC';
      var isCE = shortStatus === 'CE';
      
      // 如果时间栏是"编译错误"，说明是CE记录，直接显示CE
      if (rec.time && rec.time.includes('编译错误')) {
        shortStatus = 'CE';
        isCE = true;
        isAC = false;
        isRunning = false;
      }
      
      var rowClass = 'record-row' + (isRunning ? ' running-row' : '') + (isCE ? ' ce-row' : '');
      
      // 时间和内存 - CE记录不显示时间内存，正在评测的记录用横线
      var timeMemHtml = '';
      if (isCE) {
        timeMemHtml = '<span class="rec-time">-</span><span class="rec-mem">-</span>';
      } else {
        timeMemHtml = '<span class="rec-time">' + esc(rec.time || (isRunning ? '-' : '')) + '</span>' +
                       '<span class="rec-mem">' + esc(rec.memory || (isRunning ? '-' : '')) + '</span>';
      }
      
      // 正在评测/等待中的记录显示分数（如果有），不显示状态
      var scoreDisplay = '-';
      if (!isRunning && !isCE) {
        scoreDisplay = rec.score;
      } else if (isRunning) {
        scoreDisplay = rec.score || '-';
      }
      
      var userHtml = '';
      if (rec.userDelegation && rec.userDelegation.length > 1) {
        var delegationTagMap = {};
        if (rec.userId) delegationTagMap[rec.userId] = rec.tags || [];
        userHtml = delegationUserHtml(rec.userDelegation, delegationTagMap);
      } else {
        userHtml = userLinkHtml(rec.user, rec.userId || '', rec.solvedCount!==undefined?rec.solvedCount:-1, rec.userColor||'', false, rec.tags || [], rec.userHtml || '');
      }
      recordsHtml += '<div class="' + rowClass + '" data-id="' + rec.id + '">' +
        '<span class="rec-id">#' + rec.id + '</span>' +
        '<span class="rec-prob">' + esc(rec.problemId) + '</span>' +
        '<span class="rec-user">' + userHtml + '</span>' +
        '<span class="rec-score ' + (isAC ? 'score-ac' : (isCE ? 'score-ce' : (score > 0 ? 'score-p' : 'score-f'))) + '">' + scoreDisplay + '</span>' +
        timeMemHtml +
        '<span class="rec-code">' + esc(rec.codeLen) + '</span>' +
        '<span class="rec-compiler">' + esc(rec.compiler || '').slice(0, 5) + '</span>' +
        '<span class="rec-submit">' + esc(rec.submitTime || '').slice(5, 16) + '</span>' +
      '</div>';
    });
  } else {
    recordsHtml = '<div style="text-align:center;padding:40px;color:#888">暂无记录</div>';
  }

  // ========== CSS 样式 ==========
  
  var styles = `
body{font-family:system-ui,sans-serif;background:#f7f9fb;padding:16px;color:#333;font-size:12px;min-height:100vh;}
.wrap{max-width:100%;}
.records-wrap{width:100%;overflow-x:auto;}
.status-table-holder{min-width:720px;width:100%;}
h2{font-size:17px;margin:0 0 12px}
.pagination{display:flex;gap:6px;margin-bottom:12px;align-items:center;flex-wrap:wrap;}
.pagination button{padding:5px 12px;border-radius:6px;border:1px solid #dbeaff;background:#fff;color:#007acc;cursor:pointer;font-size:12px}
.pagination button:disabled{opacity:0.4}
.pagination span{font-size:12px;color:#666}
.filter-bar{background:#fff;border-radius:10px;padding:10px;margin-bottom:12px;box-shadow:0 1px 4px rgba(0,0,0,0.08);display:flex;flex-wrap:wrap;gap:6px;align-items:center;font-size:12px}
.filter-bar input,.filter-bar select{padding:4px 6px;border:1px solid #dbeaff;border-radius:5px;font-size:12px;flex:0 0 auto;}
.filter-btn{padding:5px 12px;margin:0;background:#007acc;color:#fff;border:none;border-radius:6px;cursor:pointer}
.header-row{background:#f6f8fa;padding:6px 8px;border-radius:5px;display:grid;grid-template-columns:minmax(50px,0.6fr) minmax(80px,1fr) minmax(120px,2.2fr) minmax(50px,0.65fr) minmax(50px,0.7fr) minmax(50px,0.7fr) minmax(50px,0.7fr) minmax(60px,0.9fr) minmax(90px,1.3fr);gap:6px;align-items:center;font-weight:600;font-size:11px;color:#555;margin-top:6px;}
.header-row span{text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.header-row .h-id{text-align:left}
.header-row .h-prob{text-align:left}
.header-row .h-user{text-align:left}
.header-row .h-right{text-align:right}
.record-row{background:#fff;padding:6px 8px;border-radius:5px;display:grid;grid-template-columns:minmax(50px,0.6fr) minmax(80px,1fr) minmax(120px,2.2fr) minmax(50px,0.65fr) minmax(50px,0.7fr) minmax(50px,0.7fr) minmax(50px,0.7fr) minmax(60px,0.9fr) minmax(90px,1.3fr);gap:6px;align-items:center;cursor:pointer;margin:3px 0;font-size:11px;border-bottom:1px solid #f0f0f0;}
.record-row:hover{background:#e6f0fa}
.running-row{background:#fffbe6 !important}
.running-row:hover{background:#fff3c4 !important}
.ce-row{background:#fff4e6}
.ce-row:hover{background:#ffe8d4}
.hidden-row{background:#f0f0f0;color:#999;pointer-events:none;cursor:not-allowed}
.rec-id{font-weight:700;color:#007acc;overflow:hidden;text-overflow:ellipsis;font-size:10px}
.rec-prob{font-weight:500;overflow:hidden;text-overflow:ellipsis;font-size:11px}
.rec-user{overflow:hidden;text-overflow:ellipsis;font-size:11px}
.rec-status{font-weight:600;font-size:10px;padding:2px 4px;border-radius:3px}
.status-ac{color:#28a745;background:#dafbe1}
.status-running{color:#0969da;background:#ddf4ff;animation:pulse 1.5s infinite}
.status-ce{color:#cf222e;background:#ffebe9}
.status-hidden{color:#999;background:#f0f0f0}
.status-wa{color:#cf222e;background:#ffe4e4}
.status-tle{color:#bf5c00;background:#fff4e5}
.status-mle{color:#8250df;background:#fbefff}
.status-re{color:#bf3989;background:#fff0f7}
.status-other{color:#666;background:#f6f8fa}
.rec-score{text-align:center;font-weight:700;font-size:11px}
.score-ac{color:#28a745}
.score-p{color:#bf8700}
.score-f{color:#cf222e}
.rec-time,.rec-mem{text-align:right;color:#666;font-size:10px}
.rec-code{text-align:right;color:#666;font-size:10px}
.rec-compiler{color:#888;text-align:center;font-size:10px}
.rec-submit{color:#888;text-align:right;font-size:10px}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.6}}
  ` + userCardCss();

  // ========== HTML 结构 ==========
  
  var html = '<div class="wrap">' +
    '<h2>评测记录</h2>' +
    '<div class="pagination">' +
      '<button id="btnPrev" ' + (currentPage <= 1 ? 'disabled' : '') + '><</button>' +
      '<span>' + currentPage + '</span>' +
      '<button id="btnNext" ' + (currentPage >= totalPages ? 'disabled' : '') + '>></button>' +
    '</div>' +
    filterHtml +
    '<div class="records-wrap"><div class="status-table-holder">' +
      '<div class="header-row">' +
        '<span class="h-id">#ID</span>' +
        '<span class="h-prob">题目</span>' +
        '<span class="h-user">用户</span>' +
        '<span>分数</span>' +
        '<span class="h-right">时间</span>' +
        '<span class="h-right">内存</span>' +
        '<span class="h-right">代码</span>' +
        '<span>编译器</span>' +
        '<span class="h-right">提交时间</span>' +
      '</div>' +
      recordsHtml +
    '</div></div>' +
    '</div>';

  // ========== JavaScript ==========
  
  // 🔑 安全生成 JSON 字符串，防止内嵌到 <script> 时被 </script> 破坏
  var preservedFiltersJson = safeScriptJSON({
    test: filters.test || filters.contestId || filters.tid || '',
    contestId: filters.contestId || filters.test || filters.tid || '',
    tid: filters.tid || filters.test || filters.contestId || '',
    problemId: filters.problemId || filters.pid || '',
    username: filters.username || filters.uname || ''
  });
  
  // 安全处理 buildUserTagsJson 返回的字符串（假设它返回 JSON 字符串）
  var safeTagMapJson = safeScriptJSON(buildUserTagsJson(records));
  
  var script = `
var vscode = window.vscodeApi;

// ===== 优先注册按钮/自动刷新/消息监听，即使 tag 处理失败也不影响交互 =====
document.getElementById("btnPrev").onclick = function() {
  vscode.postMessage({ command: "changeStatusPage", p: ${currentPage - 1}, filters: getFilters() });
};
document.getElementById("btnNext").onclick = function() {
  vscode.postMessage({ command: "changeStatusPage", p: ${currentPage + 1}, filters: getFilters() });
};
document.getElementById("btnFilter").onclick = function() {
  vscode.postMessage({ command: "statusFilter", filters: getFilters() });
};
vscode.postMessage({ command: "initAutoRefresh" });
window.addEventListener('message', function(event) {
  var msg = event.data;
  if (!msg) return;
  if (msg.command == 'updateRecords' && msg.records) {
    msg.records.forEach(function(record) { if (record.tags && record.tags.length) { if (record.userId) _yzTagMap[record.userId] = record.tags; if (record.user) _yzTagMap[record.user] = record.tags; } updateRecord(record); });
  }
  if (msg.command == 'addNewRecords' && msg.records) {
    msg.records.forEach(function(record) { if (record.tags && record.tags.length) { if (record.userId) _yzTagMap[record.userId] = record.tags; if (record.user) _yzTagMap[record.user] = record.tags; } addNewRecord(record); });
  }
});

// ===== Tag 注入（try-catch 包裹，失败不影响按钮） =====
var _yzTagMap = ${safeTagMapJson};
try {
  (function(){
    var map = _yzTagMap;
    if (map) {
      Object.keys(map).forEach(function(key) {
        var tags = map[key];
        if (!tags || !tags.length) return;
        var sels = [];
        if (/^\\d+$/.test(key)) sels.push('.user-link[data-uid="' + key + '"] .utc');
        sels.push('.user-link[data-username="' + key.replace(/['"\\\\]/g, '\\\\$&') + '"] .utc');
        sels.forEach(function(sel) {
          document.querySelectorAll(sel).forEach(function(el) {
            el.innerHTML = tags.map(function(t) {
              return '<span class="user-tag" style="background:' + _fe(t.color||t.colour||'#6366f1') + '">' + _fe(t.tag||t.text||t.name||'') + '</span>';
            }).join('');
          });
        });
      });
    }
  })();
} catch(e){}

// ===== 功能变量和函数 =====
var _preservedFilters = ${preservedFiltersJson};
var _isContestStatus = !!(_preservedFilters.test || _preservedFilters.contestId || _preservedFilters.tid);
function _fe(t){if(!t)return '';return String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');}
// 用户颜色计算（前端实现与 yzojUserColor 保持一致）
function _yzUserColor(solvedCount){
  if (solvedCount === -2) return '#999';
  var v = parseInt(solvedCount);
  if (isNaN(v)) return '#2563EB';
  if (v < -1) return '#999';
  if (v >= 900) return '#FC2404';
  if (v >= 700) return '#F46E0E';
  if (v >= 600) return '#EF9A15';
  if (v >= 500) return '#F56B0E';
  if (v >= 450) return '#EF9F15';
  if (v >= 420) return '#EFA015';
  if (v >= 400) return '#94DB2B';
  if (v >= 300) return '#A8DE28';
  if (v >= 200) return '#64D432';
  if (v >= 100) return '#81D82E';
  if (v >= 50)  return '#4BAFB2';
  if (v >= 20)  return '#3B82F6';
  if (v >= 10)  return '#2563EB';
  return '#2563EB';
}
// 生成用户卡片HTML（前端版，照抄 node 端 userLinkHtml 逻辑）
function _buildUserLink(username, uid, solvedCount, userColor, tags, userHtml){
  if(!username||username==='-')return'-';
  var color = userColor && typeof userColor === 'string' && userColor.trim() ? userColor.trim() : '#2563EB';
  var needsData = (solvedCount===undefined||solvedCount===null||solvedCount===-1)?'1':'0';
  // 如果 tags 未传入或为空，尝试从 _yzTagMap 中查找（页面预注入的 tag map）
  if ((!tags || !tags.length) && typeof _yzTagMap !== 'undefined') {
    tags = _yzTagMap[uid] || _yzTagMap[username] || tags;
  }
  var tagsHtml = '';
  if (tags && tags.length) {
    tagsHtml = tags.map(function(t){return '<span class="user-tag" style="background:'+_fe(t.color||t.colour||'#6366f1')+'">'+_fe(t.tag||t.text||t.name||'')+'</span>';}).join('');
  }
  var innerHtml = _fe(username);
  if (userHtml && typeof userHtml === 'string' && userHtml.trim() && userHtml.trim().indexOf('<') >= 0 && userHtml.trim().indexOf('>') >= 0) {
    innerHtml = userHtml;
  }
  return '<span class="user-link" data-username="'+_fe(username)+'" data-uid="'+_fe(uid||'')+'"'+
    (needsData==='1'?' data-needs-data="1"':'')+
    (innerHtml!==_fe(username)?' data-user-html="'+_fe(userHtml)+'"':'')+
    ' style="color:'+color+';font-weight:bold;cursor:pointer">'+innerHtml+'<span class="utc">'+tagsHtml+'</span></span>';
}
// 前端版委托递交渲染
function _buildDelegationUserHtml(delegation, primaryTags){
  if(!delegation||!delegation.length)return'-';
  var parts=[];
  for(var di=0;di<delegation.length;di++){
    var du=delegation[di];
    var tags=di===delegation.length-1?(primaryTags||[]):[];
    parts.push(_buildUserLink(du.user,du.userId||'',-1,du.userColor||'',tags,du.userHtml||''));
    if(di<delegation.length-1)parts.push('<span style="color:#888;font-weight:normal;margin:0 1px">←</span>');
  }
  return parts.join('');
}
// 动态新增记录后，手动请求缺失的用户标签数据
function _refreshPendingUsers(){
  try{
    var links=document.querySelectorAll('.user-link[data-needs-data="1"]');
    var seen={};
    for(var i=0;i<links.length;i++){
      var u=links[i].dataset.username,uid=links[i].dataset.uid,key=uid||u;
      if(!seen[key]){seen[key]=1;vscode.postMessage({command:'requestUserTags',username:u,uid:uid});}
    }
  }catch(e){}
}

function gE(id){var e=document.getElementById(id);return e?e.value:'';}
function getFilters() {
  // 🔑 合并前端输入 + 保留的关键参数（test=比赛编号），防止用户刷新/筛选时丢失上下文
  var ui = {
    scorel: document.getElementById("fScoreL").value,
    scorer: document.getElementById("fScoreR").value,
    compiler: document.getElementById("fCompiler").value
  };
  // 比赛模式（有 test 参数）不展示 pid/uname/status 筛选框，跳过读取避免报错
  if (!_isContestStatus) {
    ui.pid = gE("fPid");
    ui.uname = gE("fUser");
    ui.status = gE("fStatus");
  }
  var merged = {};
  if (_preservedFilters) {
    for (var k in _preservedFilters) {
      if (Object.prototype.hasOwnProperty.call(_preservedFilters, k) && _preservedFilters[k]) {
        merged[k] = _preservedFilters[k];
      }
    }
  }
  for (var k in ui) {
    if (Object.prototype.hasOwnProperty.call(ui, k)) {
      merged[k] = ui[k];
    }
  }
  // 🔑 关键修复：UI 可编辑字段（pid / uname）如果存在（哪怕是空字符串），
  // 就删除它们的别名（problemId / username），避免 _preservedFilters 缓存的旧别名被后端 || 取到真值
  if (Object.prototype.hasOwnProperty.call(merged, 'pid')) delete merged.problemId;
  if (Object.prototype.hasOwnProperty.call(merged, 'uname')) delete merged.username;
  return merged;
}

function bindRowClick() {
  document.querySelectorAll(".record-row").forEach(function(row) {
    row.addEventListener("click", function(e) {
      if (e.target.closest(".user-link")) {
        e.stopPropagation();
        return;
      }
      vscode.postMessage({ command: "openStatusDetail", id: this.dataset.id });
    });
  });
}

bindRowClick();

// 更新单条记录
window.updateRecord = function(record) {
  var row = document.querySelector('.record-row[data-id="' + record.id + '"]');
  if (!row) {
    return;
  }
  
  if (record.shortStatus === 'hidden') return;
  
  var statusCell = row.querySelector('.rec-status');
  var scoreCell = row.querySelector('.rec-score');
  var timeCell = row.querySelector('.rec-time');
  var memCell = row.querySelector('.rec-mem');
  var codeCell = row.querySelector('.rec-code');
  var compilerCell = row.querySelector('.rec-compiler');
  var submitCell = row.querySelector('.rec-submit');
  var userCell = row.querySelector('.rec-user');
  
  vscode.postMessage({command: 'debugLog', message: '[DEBUG updateRecord] Cells found - status: ' + !!statusCell + ', score: ' + !!scoreCell + ', time: ' + !!timeCell + ', mem: ' + !!memCell + ', code: ' + !!codeCell + ', compiler: ' + !!compilerCell + ', submit: ' + !!submitCell + ', user: ' + !!userCell});
  
  // 更新用户列（用户卡片/颜色/委托递交）
  // 如果有 userDelegation 数组，即使 record.user 为空也要渲染
  var hasDelegation = record.userDelegation && record.userDelegation.length > 1;
  if (userCell && (hasDelegation || record.user !== undefined || record.userId !== undefined)) {
    if (hasDelegation) {
      userCell.innerHTML = _buildDelegationUserHtml(record.userDelegation, record.tags || []);
    } else {
      var curUser = record.user;
      if (curUser === undefined) {
        var oldLink = userCell.querySelector('.user-link');
        if (oldLink) curUser = oldLink.getAttribute('data-username');
      }
      if (curUser) {
        userCell.innerHTML = _buildUserLink(curUser || '', record.userId || '', record.solvedCount, record.userColor || '', record.tags || [], record.userHtml || '');
      }
    }
  }
  
  // 更新状态文本和样式
  if (statusCell) {
    statusCell.textContent = record.statusDisplay || record.status || '-';
    statusCell.className = 'rec-status';
    if (record.shortStatus === 'AC') statusCell.classList.add('status-ac');
    else if (record.isRunning) statusCell.classList.add('status-running');
    else if (record.shortStatus === 'CE') statusCell.classList.add('status-ce');
    else if (record.shortStatus === 'WA') statusCell.classList.add('status-wa');
    else if (record.shortStatus === 'TLE') statusCell.classList.add('status-tle');
    else if (record.shortStatus === 'MLE') statusCell.classList.add('status-mle');
    else if (record.shortStatus === 'RE') statusCell.classList.add('status-re');
    else statusCell.classList.add('status-other');
  }
  
  // 更新分数文本和样式
  if (scoreCell) {
    scoreCell.textContent = record.scoreDisplay || '-';
    scoreCell.className = 'rec-score';
    if (record.shortStatus === 'AC') scoreCell.classList.add('score-ac');
    else if (record.shortStatus === 'CE') scoreCell.classList.add('score-ce');
    else if (parseInt(record.score) > 0) scoreCell.classList.add('score-p');
    else scoreCell.classList.add('score-f');
  }
  
  // 更新时间和内存
  if (timeCell) timeCell.textContent = record.time || (record.isRunning ? '-' : '');
  if (memCell) memCell.textContent = record.memory || (record.isRunning ? '-' : '');
  
  // 更新代码长度、编译器、提交时间
  if (codeCell) codeCell.textContent = record.codeLen || '-';
  if (compilerCell) compilerCell.textContent = (record.compiler || '-').slice(0, 5);
  if (submitCell) submitCell.textContent = (record.submitTime || '').slice(5, 16);
  
  // 更新行的样式
  row.classList.remove('running-row', 'ce-row');
  if (record.isRunning) row.classList.add('running-row');
  if (record.shortStatus === 'CE') row.classList.add('ce-row');
};

// 添加新记录
window.addNewRecord = function(record) {
  var container = document.querySelector('.header-row');
  if (!container) return;
  
  if (record.shortStatus === 'hidden') {
    var html = '<div class="record-row hidden-row" data-id="' + record.id + '">' +
      '<span class="rec-id">???</span>' +
      '<span class="rec-prob">???</span>' +
      '<span class="rec-user">???</span>' +
      '<span class="rec-status status-hidden">???</span>' +
      '<span class="rec-score">???</span>' +
      '<span class="rec-time">???</span>' +
      '<span class="rec-mem">???</span>' +
      '<span class="rec-code">???</span>' +
      '<span class="rec-compiler">???</span>' +
      '<span class="rec-submit">???</span>' +
    '</div>';
    container.insertAdjacentHTML('afterend', html);
    bindRowClick();
    return;
  }
  
  // 根据状态选择样式类
  var rowClass = 'record-row';
  var statusClass = 'rec-status';
  var scoreClass = 'rec-score';
  
  // 正在评测/等待中的记录不显示状态
  var isRunning = record.isRunning;
  if (isRunning) {
    rowClass += ' running-row';
  } else if (record.shortStatus === 'CE') {
    rowClass += ' ce-row';
    statusClass += ' status-ce';
    scoreClass += ' score-ce';
  } else if (record.shortStatus === 'AC') {
    statusClass += ' status-ac';
    scoreClass += ' score-ac';
  } else if (record.shortStatus === 'WA') {
    statusClass += ' status-wa';
    scoreClass += ' score-f';
  } else if (record.shortStatus === 'TLE') {
    statusClass += ' status-tle';
    scoreClass += ' score-f';
  } else if (record.shortStatus === 'MLE') {
    statusClass += ' status-mle';
    scoreClass += ' score-f';
  } else if (record.shortStatus === 'RE') {
    statusClass += ' status-re';
    scoreClass += ' score-f';
  } else {
    statusClass += ' status-other';
    scoreClass += ' score-f';
  }
  
  // 新加的评测记录都不显示状态，只显示分数
  var statusHtml = '';
  var html = '<div class="' + rowClass + '" data-id="' + record.id + '">' +
    '<span class="rec-id">#' + record.id + '</span>' +
    '<span class="rec-prob">' + (record.problemId || '-') + '</span>' +
    '<span class="rec-user">' + (record.userDelegation && record.userDelegation.length > 1 ? _buildDelegationUserHtml(record.userDelegation, record.tags || []) : _buildUserLink(record.user || '', record.userId || '', record.solvedCount, record.userColor || '', record.tags || [], record.userHtml || '')) + '</span>' +
    statusHtml +
    '<span class="' + scoreClass + '">' + (record.scoreDisplay || '-') + '</span>' +
    '<span class="rec-time">' + (record.time || '-') + '</span>' +
    '<span class="rec-mem">' + (record.memory || '-') + '</span>' +
    '<span class="rec-code">' + (record.codeLen || '-') + '</span>' +
    '<span class="rec-compiler">' + (record.compiler || '-').slice(0, 5) + '</span>' +
    '<span class="rec-submit">' + (record.submitTime || '').slice(5, 16) + '</span>' +
  '</div>';
  
  container.insertAdjacentHTML('afterend', html);
  bindRowClick();
};

// 显示可能积累的JS错误
if(typeof _yzShowErrors === 'function') _yzShowErrors();
  `;

  return wrapWithMathJax('评测记录', 
    '<style>' + styles + '</style>' + html + '<script>' + script + '</script>');
}

function getProblemListWebview(data,b){
  var p=data.problems,cp=data.currentPage,tp=data.totalPages,allTags=data.allTags||[],h='',kw=esc(data.currentKeyword||''),cs=data.currentSort||'id',co=data.currentOrder||'asc',tagsJson=JSON.stringify(allTags).replace(/</g,'\\u003c'),selTagsJson=JSON.stringify(data.selectedTags||[]);

  var styles='body{font-family:system-ui,sans-serif;background:#f7f9fb;padding:16px;color:#333;font-size:13px}h2{font-size:17px;margin:0 0 10px}.p{display:flex;gap:6px;margin-bottom:10px;align-items:center}.p button{padding:5px 12px;border-radius:6px;border:1px solid #dbeaff;background:#fff;color:#007acc;cursor:pointer;font-size:12px}.p button:disabled{opacity:0.4}.p span{font-size:12px;color:#666}.pf{background:#fff;border-radius:10px;padding:12px;margin-bottom:12px;box-shadow:0 1px 4px rgba(0,0,0,0.08)}.fr{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px;align-items:center}.fr input,.fr select{flex:1;min-width:60px;padding:5px 8px;border:1px solid #dbeaff;border-radius:5px;font-size:12px}.tg{display:flex;flex-wrap:wrap;gap:3px;margin:4px 0;max-height:100px;overflow-y:auto;padding:3px;border:1px solid #eee;border-radius:6px}.tg-item{padding:2px 8px;border-radius:10px;font-size:11px;background:#f0f0f0;color:#666;cursor:pointer;user-select:none}.tg-item:hover{background:#e6f0fa}.tg-item.sel{background:#007acc;color:#fff}.fb{padding:6px 14px;background:#007acc;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;margin:2px}.fb.sec{background:#6c757d}.fb.rnd{background:#6c5ce7}.tbl{width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08)}.tbl th{background:#f5f7fa;padding:8px 12px;text-align:center;font-weight:600;font-size:12px;color:#666;border-bottom:2px solid #eee}.tbl td{padding:7px 12px;text-align:center;border-bottom:1px solid #f0f0f0}.tbl td p{margin:0}.tbl tr:hover{background:#f8fafb}.tbl tr:hover td:first-child{border-left:3px solid #007acc}.tbl .mk{font-size:14px;font-weight:bold}.tbl .mk.ac{color:#28a745}.tbl .mk.att{color:#ffc107;font-size:12px}.tbl .pid{font-weight:700;color:#007acc;font-size:12px}.tbl .pname{text-align:left;font-size:13px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;width:100%}.tbl .pm{font-size:12px;color:#ad58a6;margin-left:3px;flex-shrink:0}.tbl .ptitle{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:inline-block;vertical-align:middle;max-width:100%}.tbl .rate{font-size:12px;color:#666}.tbl .rate strong{color:#007acc}.tbl .level{font-size:11px;font-weight:600;padding:2px 6px;border-radius:4px;display:inline-block}.tbl .level.e{background:#dafbe1;color:#2ea043}.tbl .level.m{background:#fff4e6;color:#fa5a05}.tbl .level.h{background:#ffebe9;color:#cf222e}.tbl .hidden{opacity:0.5;color:#888}';

  if(p&&p.length>0){
    h='<table class="tbl"><thead><tr><th>Mark</th><th>题号</th><th>题名</th><th>通过率</th><th>难度</th></tr></thead><tbody>';
    p.forEach(function(x){
      if(x.isHidden){
        h+='<tr class="hidden"><td></td><td>'+esc(x.id)+'</td><td>\u9690\u85CF</td><td></td><td></td></tr>';
      }else{
        var lc='m',lv=parseFloat(x.level)||0;
        if(lv<2)lc='e';
        else if(lv>=4)lc='h';
        var markHtml='';
        if(x.mark==='ac')markHtml='<span class="mk ac">✓</span>';
        else if(x.mark==='attempted')markHtml='<span class="mk att">●</span>';
        var rateHtml='';
        if(x.passRate!==null&&x.passRate!==undefined){
          rateHtml='<span class="rate"><strong>'+esc(x.passRate)+'%</strong></span>';
          if(x.acCount||x.subCount){
            rateHtml+=' ('+esc(x.acCount||'0')+'/'+esc(x.subCount||'0')+')';
          }
        }
        // 直接使用 esc(x.name)，不再额外转义（因为配置已修复）
        h+='<tr data-id="'+esc(x.id)+'" data-url="'+esc(x.url)+'" style="cursor:pointer"><td>'+markHtml+'</td><td class="pid">'+esc(x.id)+'</td><td class="pname"><span class="ptitle">'+esc(x.name)+'</span>'+(x.permission?'&nbsp;<span class="pm">('+esc(x.permission)+')</span>':'')+'</td><td>'+rateHtml+'</td><td><span class="level '+lc+'">'+esc(x.level||'-')+'</span></td></tr>';
      }
    });
    h+='</tbody></table>';
  }else{
    h='<div style="text-align:center;padding:40px;color:#888">\u6682\u65E0\u9898\u76EE</div>';
  }

  var script='(function(){var v=window.vscodeApi||acquireVsCodeApi();var allTags='+tagsJson+';var selTags='+selTagsJson+';var tc=document.getElementById("tagContainer");var cp='+cp+',tp='+tp+';if(allTags&&allTags.length>0){allTags.forEach(function(t){var el=document.createElement("span");el.className="tg-item";if(selTags.indexOf(t)>=0)el.classList.add("sel");el.textContent=t;el.onclick=function(){if(selTags.indexOf(t)>=0){selTags=selTags.filter(function(x){return x!==t})}else{selTags.push(t)}document.querySelectorAll("#tagContainer .tg-item").forEach(function(e){if(selTags.indexOf(e.textContent)>=0)e.classList.add("sel");else e.classList.remove("sel")})};tc.appendChild(el)})}function getOpts(){var o={};var kw=document.getElementById("fKeyword").value.trim();if(kw)o.keyword=kw;o.sort_by=document.getElementById("fSort").value;o.sort_order=document.getElementById("fOrder").value;if(selTags.length>0)o.tag=selTags[0];return o}document.querySelectorAll(".tbl tbody tr:not(.hidden)").forEach(function(e){e.onclick=function(){v.postMessage({command:"openProblem",id:e.dataset.id,url:e.dataset.url})}});document.getElementById("pr").onclick=function(){v.postMessage({command:"changePage",p:cp-1,opts:getOpts()})};document.getElementById("nx").onclick=function(){v.postMessage({command:"changePage",p:cp+1,opts:getOpts()})};document.getElementById("btnSearch").onclick=function(){v.postMessage({command:"search",opts:getOpts(),selectedTags:selTags})};document.getElementById("btnReset").onclick=function(){selTags=[];document.getElementById("fKeyword").value="";v.postMessage({command:"search",opts:{sort_by:"id",sort_order:"asc"},selectedTags:[]})};document.getElementById("btnRandom").onclick=function(){v.postMessage({command:"randomProblem"})};document.getElementById("fKeyword").onkeypress=function(e){if(e.key==="Enter")document.getElementById("btnSearch").click()}})();';

  return wrapWithMathJax('\u9898\u5E93',
    '<style>'+styles+'</style>'+
    '<h2>\u9898\u5E93</h2>'+
    '<div class="p"><button id="pr"'+(cp<=1?' disabled':'')+'><</button><span>'+cp+'</span><button id="nx"'+(cp>=tp?' disabled':'')+'>></button></div>'+
    '<div class="pf">'+
      '<div class="fr"><input type="text" id="fKeyword" placeholder="\u641C\u7D22\u6807\u9898..." style="width:100%" value="'+kw+'"></div>'+
      '<div class="tg" id="tagContainer"></div>'+
      '<div class="fr"><label style="margin-left:0">\u6392\u5E8F</label><select id="fSort"><option value="id" '+(cs==='id'?'selected':'')+'>\u9898\u76EE\u7F16\u53F7</option><option value="difficulty" '+(cs==='difficulty'?'selected':'')+'>\u96BE\u5EA6</option><option value="pass_rate" '+(cs==='pass_rate'?'selected':'')+'>\u901A\u8FC7\u7387</option><option value="ac_count" '+(cs==='ac_count'?'selected':'')+'>\u901A\u8FC7\u6570</option><option value="submit_count" '+(cs==='submit_count'?'selected':'')+'>\u63D0\u4EA4\u6570</option></select><select id="fOrder"><option value="asc" '+(co==='asc'?'selected':'')+'>\u5347\u5E8F</option><option value="desc" '+(co==='desc'?'selected':'')+'>\u964D\u5E8F</option></select></div>'+
      '<div style="margin-top:6px"><button class="fb" id="btnSearch">\u641C\u7D22</button><button class="fb sec" id="btnReset">\u91CD\u7F6E</button><button class="fb rnd" id="btnRandom">\u968F\u673A</button></div>'+
    '</div>'+h+
    '<script>'+script+'</script>', b);
}
function getSolutionsWebview(data,_b){
  var s=data.solutions||[],pid=data.problemId||'',h='';
  if(s.length>0){s.forEach(function(sol){
    h+='<div class="sol-item"><div class="sol-header"><span class="sol-title">'+esc(sol.title||'')+'</span><span class="sol-meta">'+userLinkHtml(sol.author||'', sol.authorId||'', -1, undefined, true, sol.tags || [])+' \u00B7 '+esc(sol.time||'')+'</span></div><div class="sol-content">'+(sol.contentHtml||esc(sol.content))+'</div></div>';
  });}else h='<div style="text-align:center;padding:40px;color:#888">\u6682\u65E0\u9898\u89E3</div>';
  return wrapWithMathJax('\u9898\u89E3',
    '<style>body{font-family:system-ui,sans-serif;background:#f7f9fb;padding:16px;color:#333;font-size:13px}h2{font-size:17px;margin:0 0 10px}.sol-item{background:#fff;padding:12px 14px;border-radius:8px;margin:6px 0;border:1px solid #eee}.sol-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}.sol-title{font-weight:600;font-size:14px;color:#007acc}.sol-meta{font-size:11px;color:#888}.sol-content{font-size:13px;color:#444;line-height:1.6;word-break:break-all}.sol-content img{max-width:100%}.sol-content pre{background:#f6f8fa;padding:8px;border-radius:4px;overflow-x:auto;font-family:Consolas,monospace;font-size:12px}.sol-content code{background:#f0f0f0;padding:1px 4px;border-radius:2px;font-size:12px}.ab{padding:6px 16px;border:1px solid #dbeaff;border-radius:6px;background:#fff;color:#007acc;cursor:pointer;font-size:12px;margin:3px}.ab.p{background:#007acc;color:#fff}'+userCardCss()+'</style><h2>'+esc(data.problemTitle||'\u9898\u89E3')+'</h2>'+
    '<button class="ab p" id="btnNewSolution" style="margin-bottom:8px">\u64B0\u5199\u9898\u89E3</button>'+h+
    '<script>var pid="'+esc(pid)+'";function vm(m){(window.vscodeApi||acquireVsCodeApi()).postMessage(m)}'+
    'document.getElementById("btnNewSolution").onclick=function(){vm({command:"newSolution",problemId:pid})};'+
    '</script><script>'+userCardScript()+'</script>', _b);
}

function getProblemStatusWebview(data,_b){
  var r=data.records||[],h='';
  if(r.length>0)r.forEach(function(x,i){h+='<div class="rc" data-id="'+esc(x.id)+'"><span class="rank">'+(i+1)+'</span><span>#'+esc(x.id)+'</span><span>'+userLinkHtml(x.user||'', x.userId||'', x.solvedCount!==undefined?x.solvedCount:-1, x.userColor||'', false, x.tags || [], x.userHtml||'')+'</span><span>'+esc(x.time||'')+'</span><span>'+esc(x.memory||'')+'</span><span>'+esc(x.compiler||'')+'</span></div>';});else h='<div style="text-align:center;padding:40px;color:#888">暂无数据</div>';
  return wrapWithMathJax('\u9898\u76EE\u72B6\u6001',
    '<style>body{font-family:system-ui,sans-serif;background:#f7f9fb;padding:16px;color:#333;font-size:12px}h2{font-size:17px;margin:0 0 10px}.rc{background:#fff;padding:5px 8px;border-radius:5px;display:grid;grid-template-columns:50px 55px 1.2fr 60px 55px 65px;gap:4px;align-items:center;cursor:pointer;margin:2px 0;font-size:11px;border-bottom:1px solid #f0f0f0}.rc:hover{background:#e6f0fa}.rank{font-weight:700;color:#007acc;text-align:center;font-size:11px}.header{background:#f6f8fa;padding:5px 8px;border-radius:5px;display:grid;grid-template-columns:50px 55px 1.2fr 60px 55px 65px;gap:4px;align-items:center;font-weight:600;font-size:10px;color:#555}.header span{text-align:center}'+userCardCss()+'</style><h2>\u9898\u76EE\u72B6\u6001</h2><div class="header"><span>#</span><span>\u8BB0\u5F55</span><span>\u7528\u6237</span><span>\u65F6\u95F4</span><span>\u5185\u5B58</span><span>\u7F16\u8BD1\u5668</span></div>'+h+
    '<script>var v=window.vscodeApi||acquireVsCodeApi();document.querySelectorAll(".rc").forEach(function(e){e.onclick=function(){v.postMessage({command:"openStatusDetail",id:e.dataset.id})}});document.querySelectorAll(".rc .user-link").forEach(function(e){e.addEventListener("click",function(ev){ev.stopPropagation()})})</script><script>'+userCardScript()+'</script>', _b);
}

function getContestStatusWebview(data,b){
  var r=data.records,cp=data.currentPage,tp=data.totalPages,h='',f=data.filters||{};
  // 🔑 序列化关键 filters（test/contestId/tid）供前端 getFilters 保留
  var _cPreserved = JSON.stringify({
    test: f.test || f.contestId || f.tid || '',
    contestId: f.contestId || f.test || f.tid || '',
    tid: f.tid || f.test || f.contestId || ''
  });
  var filterHtml='<div class="filter-bar"><input type="number" id="fScoreL" placeholder="分数下限" min="0" max="100" style="width:70px" value="'+esc(f.scorel||'')+'"><span>~</span><input type="number" id="fScoreR" placeholder="上限" min="0" max="100" style="width:60px" value="'+esc(f.scorer||'')+'"><select id="fStatus"><option value="">全部</option><option value="1" '+(f.status==='1'?'selected':'')+'>通过</option><option value="2" '+(f.status==='2'?'selected':'')+'>未通过</option><option value="3" '+(f.status==='3'?'selected':'')+'>CE</option><option value="0" '+(f.status==='0'?'selected':'')+'>等待评测</option></select><select id="fCompiler"><option value="">全部</option><option value="g++" '+(f.compiler==='g++'?'selected':'')+'>G++</option><option value="gcc" '+(f.compiler==='gcc'?'selected':'')+'>GCC</option><option value="java" '+(f.compiler==='java'?'selected':'')+'>Java</option></select><button class="fb" id="btnFilter">筛选</button></div>';
  if(r&&r.length>0)r.forEach(function(x){var s=parseInt(x.score)||0,sc=s===100?'h':(s===0?'l':'m');var isCE=x.status&&x.status.toLowerCase().includes('ce');var tm=isCE?'':esc(x.time||'');var mm=isCE?'':esc(x.memory||'');var st=isCE?'<span style="color:#cf222e">CE</span>':esc(x.status||'');var uh=userLinkHtml(x.user||'', x.userId||'', -1, x.userColor||'', false, x.tags || [], x.userHtml||'');h+='<div class="rc" data-id="'+x.id+'" data-problem-id="'+esc(x.problemId||'')+'"><span>#'+x.id+'</span><span>'+esc(x.problemId)+'</span><span>'+uh+'</span><span class="rs '+sc+'">'+x.score+'</span><span>'+st+'</span><span>'+tm+'</span><span>'+mm+'</span></div>';});else h='<div style="text-align:center;padding:40px;color:#888">\u6682\u65E0</div>';
  return wrapWithMathJax('\u8BC4\u6D4B\u72B6\u6001',
    '<style>body{font-family:system-ui,sans-serif;background:#f7f9fb;padding:16px;color:#333;font-size:12px}h2{font-size:17px;margin:0 0 10px}.p{display:flex;gap:6px;margin-bottom:10px;align-items:center}.p button{padding:5px 12px;border-radius:6px;border:1px solid #dbeaff;background:#fff;color:#007acc;cursor:pointer;font-size:12px}.p button:disabled{opacity:0.4}.p span{font-size:12px;color:#666}.filter-bar{background:#fff;border-radius:10px;padding:10px;margin-bottom:12px;box-shadow:0 1px 4px rgba(0,0,0,0.08);display:flex;flex-wrap:wrap;gap:6px;align-items:center;font-size:12px}.filter-bar input,.filter-bar select{padding:4px 6px;border:1px solid #dbeaff;border-radius:5px;font-size:12px}.filter-bar .fb{padding:5px 12px;margin:0}.rc{background:#fff;padding:5px 6px;border-radius:5px;display:grid;grid-template-columns:50px 70px 1.2fr 35px 1fr 40px 40px;gap:4px;align-items:center;cursor:pointer;margin:2px 0;font-size:11px;border-bottom:1px solid #f0f0f0}.rc:hover{background:#e6f0fa}.rc span{overflow:hidden;text-overflow:ellipsis}.rs{text-align:center;font-weight:700;font-size:11px}.rs.h{color:#2ea043}.rs.m{color:#fa5a05}.rs.l{color:#cf222e}.header{background:#f6f8fa;padding:5px 6px;border-radius:5px;display:grid;grid-template-columns:50px 70px 1.2fr 35px 1fr 40px 40px;gap:4px;align-items:center;font-weight:600;font-size:10px;color:#555}.header span{text-align:center}</style><h2>\u8BC4\u6D4B\u72B6\u6001</h2><div class="p"><button id="pr"'+(cp<=1?' disabled':'')+'><</button><span>'+cp+'</span><button id="nx"'+(cp>=tp?' disabled':'')+'>></button></div>'+filterHtml+'<div class="header"><span>#ID</span><span>\u9898\u76EE</span><span>\u7528\u6237</span><span>\u5206</span><span>\u72B6\u6001</span><span>\u65F6\u95F4</span><span>\u5185\u5B58</span></div>'+h+
    '<script>var v=window.vscodeApi||acquireVsCodeApi();var _preservedFilters='+_cPreserved+';document.querySelectorAll(".rc").forEach(function(e){e.onclick=function(){v.postMessage({command:"openStatusDetail",id:e.dataset.id,problemId:e.dataset.problemId})}});document.getElementById("pr").onclick=function(){var f=getFilters();v.postMessage({command:"changeStatusPage",p:'+(cp-1)+',filters:f})};document.getElementById("nx").onclick=function(){var f=getFilters();v.postMessage({command:"changeStatusPage",p:'+(cp+1)+',filters:f})};document.getElementById("btnFilter").onclick=function(){v.postMessage({command:"statusFilter",filters:getFilters()})};function getFilters(){var ui={scorel:document.getElementById("fScoreL").value,scorer:document.getElementById("fScoreR").value,status:document.getElementById("fStatus").value,compiler:document.getElementById("fCompiler").value};var merged={};if(_preservedFilters){for(var k in _preservedFilters){if(Object.prototype.hasOwnProperty.call(_preservedFilters,k)&&_preservedFilters[k]){merged[k]=_preservedFilters[k];}}}for(var k in ui){if(Object.prototype.hasOwnProperty.call(ui,k)){merged[k]=ui[k];}}return merged;}</script>', b);
}

function getSolutionDetailWebview(s,b){
  var contentHtml=s.content_html||'';
  if(contentHtml){contentHtml=contentHtml.replace(/src=(["'])([^"']*?)\1/gi,function(match,quote,src){if(src&&!src.startsWith('http')&&!src.startsWith('data:')&&!src.startsWith('//')){var cp=src.replace(/^\.?\//,'').replace(/^\/+/,'');if(cp.startsWith('OnlineJudge/')){return 'src='+quote+b.replace(/\/+$/,'')+'/'+cp+quote;}return 'src='+quote+b.replace(/\/+$/,'')+'/OnlineJudge/'+cp+quote;}return match;});}
  var authorHtml = s.author ? plainUserHtml(s.author) : '\u533F\u540D';
  var editBtnHtml = '';
  // 如果检测到隐藏标记，说明是插件编辑的题解，显示编辑按钮
  if (s.content_html && s.content_html.indexOf('<!-- yzoj-md-content -->') >= 0) {
    editBtnHtml = '<button class="ab" id="btnEditSolution">编辑题解</button>';
  }
  return wrapWithMathJax('\u9898\u89E3',
    '<style>body{font-family:system-ui,sans-serif;background:#f7f9fb;padding:16px;color:#333}.c{background:#fff;border-radius:10px;padding:16px;margin-bottom:12px;box-shadow:0 1px 4px rgba(0,0,0,0.08)}h2{font-size:17px;margin:0 0 10px}.meta{font-size:12px;color:#888;margin-bottom:12px;display:flex;align-items:center;gap:6px}.content{line-height:1.7;font-size:14px}.content img{max-width:100%}.btn-row{display:flex;flex-wrap:wrap;gap:6px;justify-content:center;margin-top:16px}.ab{padding:6px 16px;border:1px solid #dbeaff;border-radius:6px;background:#fff;color:#007acc;cursor:pointer;font-size:12px;margin:3px}.ab.p{background:#007acc;color:#fff}</style><div class="c"><h2>\u9898\u89E3: '+esc(s.title)+'</h2><div class="meta">'+authorHtml+' <span>\u00B7 '+esc(s.created_at||'')+'</span></div></div><div class="c content">'+(contentHtml||esc(s.content))+'</div><div class="btn-row">'+editBtnHtml+'</div><script>function vm(m){(window.vscodeApi||acquireVsCodeApi()).postMessage(m)}'+
    'var btnEdit=document.getElementById("btnEditSolution");if(btnEdit){btnEdit.onclick=function(){vm({command:"editSolution",id:"'+esc(s.id||'')+'",contentHtml:"'+esc(s.content_html||'').replace(/"/g,'&quot;')+'",content:"'+esc(s.content||'').replace(/"/g,'&quot;')+'"})}}'+
    '</script>', b);
}

function getDiscussionListWebview(data,_b){
  var ds=data.discussions||[],h='',pid=data.problemId||'';
  if(ds.length===0)h='<div style="text-align:center;padding:30px;color:#888">\u6682\u65E0\u8BA8\u8BBA</div>';
  else ds.forEach(function(d){
    var dAuthor=(d.author||'').toString().trim().replace(/[.。\s]+$/g,'');
    var dTime=(d.time||d.created_at||'').toString().trim().replace(/[.。\s]+$/g,'');
    h+='<div class="disc-item" data-id="'+esc(d.id)+'"><div class="disc-title">'+esc(d.title)+'</div><div class="disc-meta">'+userLinkHtml(dAuthor, d.authorId||'', -1, undefined, true)+' \u00B7 '+esc(dTime)+'</div></div>';
  });
  return wrapWithMathJax('\u8BA8\u8BBA',
    '<style>body{font-family:system-ui,sans-serif;background:#f7f9fb;padding:16px;color:#333;font-size:13px}.disc-item{background:#fff;padding:10px 14px;border-radius:8px;margin:4px 0;cursor:pointer;border:1px solid #eee}.disc-item:hover{background:#e6f0fa;border-color:#dbeaff}.disc-title{font-weight:600;font-size:13px;color:#333}.disc-meta{font-size:11px;color:#888;margin-top:3px}.ab{padding:6px 16px;border:1px solid #dbeaff;border-radius:6px;background:#fff;color:#007acc;cursor:pointer;font-size:12px;margin:3px}.ab.p{background:#007acc;color:#fff}'+userCardCss()+'</style><div style="margin-bottom:8px"><button class="ab p" id="btnNewDiscussion">\u64B0\u5199\u8BA8\u8BBA</button></div>'+h+'<script>var pid="'+esc(pid)+'";function vm(m){(window.vscodeApi||acquireVsCodeApi()).postMessage(m)}document.getElementById("btnNewDiscussion").onclick=function(){if(pid&&pid.trim()){vm({command:"newDiscussion",problemId:pid.trim()})}else{var inp=prompt("\u8BF7\u8F93\u5165\u9898\u76EE\u7F16\u53F7:");if(inp&&inp.trim())vm({command:"newDiscussion",problemId:inp.trim()})}};document.querySelectorAll(".disc-item").forEach(function(e){e.addEventListener("click",function(ev){if(ev.target.closest(".user-link")){ev.stopPropagation();return}vm({command:"openDiscussion",id:e.dataset.id})})})</script><script>'+userCardScript()+'</script>');
}

function getDiscussionDetailWebview(d,b,curUser){
  function fixImgSrc(html){if(!html)return html;return html.replace(/src=["']([^"']*?)["']/gi,function(match,src){if(src&&!src.startsWith('http')&&!src.startsWith('data:')&&!src.startsWith('//')){var cp=src.replace(/^\.?\//,'').replace(/^\/+/,'');if(cp.startsWith('OnlineJudge/')){return 'src="'+b.replace(/\/+$/,'')+'/'+cp+'"';}return 'src="'+b.replace(/\/+$/,'')+'/OnlineJudge/'+cp+'"';}return match;});}
  var discContent=fixImgSrc(d.contentHtml||d.content_html||'');
  var posts=d.posts||d.replies||[];
  var postsHtml='';
  if(posts.length>0){
    posts.forEach(function(p, idx){
      var postContent=fixImgSrc(p.contentHtml||p.content_html||'');
      var floor=p.floor||(idx+1);
      var delUrl = p.deleteUrl || '';
      var delBtn=(curUser&&p.author&&p.author===curUser && delUrl)?('<button class="del-btn" data-delurl="'+esc(delUrl)+'">\u5220\u9664</button>'):'';
      postsHtml+='<div class="post"><div class="post-header"><span class="post-floor">#'+floor+'</span> '+userLinkHtml(p.author||'', p.authorId||'', -1, undefined, true, p.tags || [])+' <span style="font-size:11px;color:#888">'+esc(p.time||p.created_at||'')+'</span>'+delBtn+'</div><div class="post-content">'+(postContent||esc(p.content||''))+'</div></div>';
    });
  }else{postsHtml='<div style="text-align:center;padding:20px;color:#888">\u6682\u65E0\u5E16\u5B50</div>';}
  // ===== 主楼元信息（作者+时间） =====
  var opMeta='';
  if(d.author||d.time){
    opMeta='<div class="meta">'+(d.author?userLinkHtml(d.author, d.authorId||'', -1, undefined, true, d.tags || [])+' ':'')+(d.time?'<span>\u00B7 '+esc(d.time)+'</span>':'')+'</div>';
  }
  var pid = d.problemId || d.pid || '';
  return wrapWithMathJax('\u8BA8\u8BBA - '+esc(d.title),
    '<style>body{font-family:system-ui,sans-serif;background:#f7f9fb;padding:16px;color:#333}.c{background:#fff;border-radius:10px;padding:16px;margin-bottom:12px;box-shadow:0 1px 4px rgba(0,0,0,0.08)}h2{font-size:17px;margin:0 0 10px}.meta{font-size:12px;color:#888;margin-bottom:8px}.content{line-height:1.7;font-size:14px;margin-bottom:8px}.content img,.post-content img{max-width:100%}.post{border-bottom:1px solid #eee;padding:12px 0}.post:last-child{border-bottom:none}.post-header{font-weight:600;font-size:12px;margin-bottom:6px;color:#555;display:flex;align-items:center;gap:8px}.post-floor{display:inline-block;padding:2px 8px;background:#007acc;color:#fff;border-radius:12px;font-size:11px;margin-right:8px;font-weight:700}.post-content{font-size:13px;line-height:1.6;margin-top:6px}.del-btn{padding:2px 8px;border:none;border-radius:4px;background:#e74c3c;color:#fff;cursor:pointer;font-size:10px;margin-left:auto}.del-btn:hover{background:#c0392b}.ab{padding:6px 16px;border:1px solid #dbeaff;border-radius:6px;background:#fff;color:#007acc;cursor:pointer;font-size:12px;margin:3px}.ab.p{background:#007acc;color:#fff}'+userCardCss()+'</style><div class="c"><h2>'+esc(d.title)+'</h2>'+opMeta+'<div class="content">'+(discContent||esc(d.content||''))+'</div></div><div class="c"><div style="display:flex;align-items:center;gap:10px;margin-bottom:10px"><h3 style="margin:0;font-size:14px;color:#007acc">\u5E16\u5B50\u5217\u8868 ('+posts.length+')</h3><button class="ab p" id="btnNewDiscussion">\u64B0\u5199\u8BA8\u8BBA</button></div>'+postsHtml+'</div><script>var _pid="'+esc(pid)+'";function vm(m){(window.vscodeApi||acquireVsCodeApi()).postMessage(m)}document.getElementById("btnNewDiscussion").onclick=function(){vm({command:"newDiscussion",problemId:_pid})};document.querySelectorAll(".del-btn").forEach(function(b){b.onclick=function(e){e.stopPropagation();vm({command:"confirmDeletePost",delUrl:this.dataset.delurl})}});</script><script>'+userCardScript()+'</script>');
}

function getFullDiscussionListWebview(data,b){
  var ds=data.discussions||[],cp=data.currentPage||1,tp=data.totalPages||1,h='';
  if(ds.length===0)h='<div style="text-align:center;padding:40px;color:#888">\u6682\u65E0\u8BA8\u8BBA</div>';
  else ds.forEach(function(d){
    var dAuthor=(d.author||'').toString().trim().replace(/[.。\s]+$/g,'');
    var dTime=(d.time||d.created_at||'').toString().trim().replace(/[.。\s]+$/g,'');
    h+='<div class="disc-item" data-id="'+esc(d.id)+'"><div class="disc-title">'+esc(d.title)+'</div><div class="disc-meta">'+userLinkHtml(dAuthor, d.authorId||'', -1, undefined, true, d.tags || [])+' \u00B7 '+esc(dTime)+'</div></div>';
  });
  return wrapWithMathJax('\u8BA8\u8BBA\u533A',
    '<style>body{font-family:system-ui,sans-serif;background:#f7f9fb;padding:16px;color:#333;font-size:13px}h2{font-size:17px;margin:0 0 10px}.p{display:flex;gap:6px;margin-bottom:10px;align-items:center}.p button{padding:5px 12px;border-radius:6px;border:1px solid #dbeaff;background:#fff;color:#007acc;cursor:pointer;font-size:12px}.p button:disabled{opacity:0.4}.p span{font-size:12px;color:#666}.disc-item{background:#fff;padding:10px 14px;border-radius:8px;margin:4px 0;border:1px solid #eee}.disc-title{font-weight:600;font-size:13px;color:#333}.disc-meta{font-size:11px;color:#888;margin-top:3px}'+userCardCss()+'</style><h2>\u8BA8\u8BBA\u533A</h2><div class="p"><button id="pr"'+(cp<=1?' disabled':'')+'><</button><span>'+cp+'</span><button id="nx"'+(cp>=tp?' disabled':'')+'>></button></div>'+h+
    '<script>var v=(window.vscodeApi||acquireVsCodeApi());var cp='+cp+';document.getElementById("pr").onclick=function(){v.postMessage({command:"changeDiscussionPage",p:cp-1})};document.getElementById("nx").onclick=function(){v.postMessage({command:"changeDiscussionPage",p:cp+1})};document.querySelectorAll(".disc-item").forEach(function(e){e.addEventListener("click",function(ev){if(ev.target.closest(".user-link")){ev.stopPropagation();return}v.postMessage({command:"openDiscussion",id:e.dataset.id})})});</script><script>'+userCardScript()+'</script>');
}

function getUserWebview(data,b){
  var solvedCount=(data.solvedCount!==undefined&&data.solvedCount!==null)?data.solvedCount:(data.solved!==undefined&&data.solved!==null?data.solved:0);
  solvedCount=parseInt(solvedCount)||0;
  var submissionCount=(data.submissionCount!==undefined&&data.submissionCount!==null)?data.submissionCount:(data.submissions!==undefined&&data.submissions!==null?data.submissions:0);
  submissionCount=parseInt(submissionCount)||0;
  var activityData=data.activityData||[];
  var solvedProblems=data.solvedProblems||[];
  var _rawUsername=data.username||'';
  var _uid=data.uid||data.id||data.uuid||'';
  var username='User';
  if(_rawUsername&&String(_rawUsername).trim()&&!/^\d+$/.test(String(_rawUsername).trim())){
    username=String(_rawUsername).trim();
  }else if(_rawUsername&&String(_rawUsername).trim()){
    username=String(_rawUsername).trim();
  }
  if(!username||/^\d+$/.test(String(username).trim())){
    username='User #'+(_uid||String(username).trim()||'0');
  }
  var rawCrawledColor=data.color||data.userColor||'';
  if(typeof rawCrawledColor==='string'&&rawCrawledColor.trim()){
    rawCrawledColor=rawCrawledColor.trim();
  }else{
    rawCrawledColor='';
  }
  var userColor=rawCrawledColor?rawCrawledColor:'#2563EB';

  function _difficultyLabel(diff){
    diff=parseFloat(diff)||0;
    if(diff>=8)return'Theory';
    if(diff>=7)return'Legendary';
    if(diff>=6)return'National';
    if(diff>=5)return'Provincial';
    if(diff>=4.5)return'NOIP+';
    if(diff>=4)return'NOIP';
    if(diff>=3)return'Improving';
    if(diff>=2)return'Popular+';
    if(diff>=1)return'Popular';
    if(diff>0)return'Entry';
    return'?';
  }

  var YZOJ_LV_COLORS = ['#8CE600','#A6E600','#BFE600','#D9E600','#E6D900','#E6BF00','#E6A600','#E68C00','#CC0000','#0073E6'];
  var YZOJ_LV_LABELS = ['Lv.1','Lv.2','Lv.3','Lv.4','Lv.5','Lv.6','Lv.7','Lv.8','Lv.9','Lv.10'];
  function _normalizeActivityData(ad){
    if(!ad||!Array.isArray(ad))return {rows:[]};
    var outRows=[];
    var dateKeys=['period','date','day','time'];
    for(var i=0;i<ad.length;i++){
      var row=ad[i];if(!row||typeof row!=='object')continue;
      var d='';for(var k=0;k<dateKeys.length;k++){if(row[dateKeys[k]]!==undefined){d=String(row[dateKeys[k]]);break;}}
      if(!d)continue;
      var r={period:d};
      var tot=0;
      for(var lv=1;lv<=10;lv++){
        var v=0;
        if(row[String(lv)]!==undefined&&row[String(lv)]!==null){v=parseInt(row[String(lv)])||0;}
        r['lv'+lv]=v;tot+=v;
      }
      if(tot<=0&&row['total']!==undefined&&row['total']!==null){tot=parseInt(row['total'])||0;}
      r.total=tot;
      if(tot>0||r.total>0)outRows.push(r);
    }
    outRows.sort(function(a,b){return a.period<b.period?-1:1;});
    return {rows:outRows};
  }
  function renderActivityChart(activityData){
    var parsed=_normalizeActivityData(activityData);
    var rows=parsed.rows||[];
    var n=rows.length;
    // YZOJ Morris.Area 折线图数据是「截至该时间点的累计 AC 数」，非当月增量。
    // 因此总 AC 数取所有行的 total 最大值（即最新的累计值），而非逐行累加。
    var totalAC=0;
    for(var i=0;i<n;i++){
      var tv=(rows[i].total||0);
      if(tv>totalAC)totalAC=tv;
    }
    var iconSvg='<svg viewBox="0 0 16 16" width="16" height="16" style="vertical-align:-3px;margin-right:6px;fill:#2563eb"><path d="M2 2h1v12h12v1H2V2zm2 9h2v3H4v-3zm3-5h2v8H7V6zm3 3h2v5h-2V9zm3-6h2v11h-2V3z"/></svg>';
    var header='<div class="card-head"><div class="cht">'+iconSvg+'活动统计 · 按难度分层累积 <span class="chm">(YZOJ 原生 Morris.Area)</span></div><div class="chm">总 AC <b style="color:#d4a72c">'+totalAC+'</b> 次</div></div>';
    if(!n){
      return '<div class="card hm-card">'+header+'<div style="padding:36px 16px;text-align:center;color:#8b949e">暂无活动数据，请稍后刷新</div></div>';
    }
    var W=720,H=260,padL=48,padR=18,padT=18,padB=38;
    var plotW=W-padL-padR,plotH=H-padT-padB;
    var yMax=0;for(var i=0;i<n;i++){var s=rows[i].total||0;if(s>yMax)yMax=s;}
    if(yMax<=0)yMax=1;
    var niceSteps=[1,2,5,10,20,50,100,200,500,1000];
    var niceMax=niceSteps[niceSteps.length-1];
    for(var s=0;s<niceSteps.length;s++){if(niceSteps[s]>=yMax){niceMax=niceSteps[s];break;}}
    if(yMax>niceMax)niceMax=Math.ceil(yMax/50)*50;
    yMax=niceMax;
    function xAt(ii){return padL+(n===1?plotW/2:(ii/(n-1))*plotW);}
    function yVal(vv){return padT+plotH-(Math.min(vv,yMax)/yMax)*plotH;}
    var gridLines='';var yTicks=4;
    for(var t=0;t<=yTicks;t++){
      var yv=padT+plotH*(t/yTicks);
      var label=Math.round(yMax-(yMax*t/yTicks));
      gridLines+='<line x1="'+padL+'" x2="'+(W-padR)+'" y1="'+yv+'" y2="'+yv+'" stroke="#e6e8eb" stroke-width="1" stroke-dasharray="3 3"/>'+
                '<text x="'+(padL-6)+'" y="'+(yv+4)+'" text-anchor="end" font-size="10" fill="#8b949e">'+label+'</text>';
    }
    var xLabels='';var lastMM=-1,lastYY=-1;
    for(var i=0;i<n;i++){
      var m=/^(\d{4})\-(\d{2})/.exec(rows[i].period);
      if(!m)continue;
      var yy=parseInt(m[1]),mmm=parseInt(m[2]);
      if(mmm!==lastMM||yy!==lastYY){
        lastMM=mmm;lastYY=yy;
        var x=xAt(i);
        xLabels+='<line x1="'+x+'" x2="'+x+'" y1="'+(padT+plotH)+'" y2="'+(padT+plotH+4)+'" stroke="#8b949e" stroke-width="1"/>'+
                 '<text x="'+x+'" y="'+(padT+plotH+18)+'" text-anchor="middle" fill="#6e7781" font-size="11" font-family="sans-serif">'+yy+'/'+mmm+'</text>';
      }
    }
    var cum=new Array(n);
    for(var i=0;i<n;i++)cum[i]=0;
    var layerSvg='';
    for(var lv=1;lv<=10;lv++){
      var areaD='';
      for(var i=0;i<n;i++){
        var xx=xAt(i);
        var prev=cum[i];
        var cur=prev+(rows[i]['lv'+lv]||0);
        var yy=yVal(cur);
        if(i===0){areaD='M'+padL+','+yVal(0)+' L'+xx+','+yy;}
        else{areaD+=' L'+xx+','+yy;}
      }
      var lastX=xAt(n-1);
      areaD+=' L'+lastX+','+(padT+plotH)+' L'+padL+','+(padT+plotH)+' Z';
      var lineD='';
      for(var i=0;i<n;i++){
        var xx=xAt(i);var cur=cum[i]+(rows[i]['lv'+lv]||0);var yy=yVal(cur);
        lineD+=(i===0?'M':'L')+xx+','+yy+' ';
      }
      layerSvg='<path d="'+areaD+'" fill="'+YZOJ_LV_COLORS[lv-1]+'" fill-opacity="0.9" stroke="none"/>'+layerSvg;
      layerSvg+='<path d="'+lineD+'" fill="none" stroke="'+YZOJ_LV_COLORS[lv-1]+'" stroke-width="1.2" stroke-linejoin="round" stroke-linecap="round"/>';
      for(var i=0;i<n;i++){cum[i]+=(rows[i]['lv'+lv]||0);}
    }
    var hover='';
    for(var i=0;i<n;i++){
      var xx=xAt(i);
      var xPr=i===0?padL:(xx+xAt(i-1))/2;
      var xNe=i===n-1?(W-padR):(xx+xAt(i+1))/2;
      var ww=Math.max(1,xNe-xPr);
      var tip=rows[i].period+'&#10;总计: '+(rows[i].total||0);
      for(var lv=1;lv<=10;lv++){tip+='&#10;Lv.'+lv+': '+(rows[i]['lv'+lv]||0);}
      hover+='<rect x="'+xPr+'" y="'+padT+'" width="'+ww+'" height="'+plotH+'" fill="transparent"><title>'+esc(tip)+'</title></rect>';
    }
    var legend='<div class="hm-legend" style="justify-content:center;flex-wrap:wrap;gap:8px">';
    for(var lv=10;lv>=1;lv--){
      legend+='<span class="hml"><span style="display:inline-block;width:14px;height:8px;background:'+YZOJ_LV_COLORS[lv-1]+';border-radius:2px;vertical-align:middle;margin-right:4px"></span>'+YZOJ_LV_LABELS[lv-1]+'</span>';
    }
    legend+='</div>';
    var svg='<div style="overflow-x:auto;padding:6px 0 4px"><svg viewBox="0 0 '+W+' '+H+'" width="100%" style="min-width:520px;display:block" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">'+gridLines+xLabels+
      layerSvg+
      hover+
      '<line x1="'+padL+'" x2="'+(W-padR)+'" y1="'+(padT+plotH)+'" y2="'+(padT+plotH)+'" stroke="#8b949e" stroke-width="1"/>'+
      '</svg></div>';
    return '<div class="card hm-card">'+header+'<div class="hm-body" style="padding:4px 8px 8px">'+svg+legend+'</div></div>';
  }

  var activityChartHtml = renderActivityChart(activityData);

  var solvedHtml='';
  if(solvedProblems&&solvedProblems.length>0){
    var headSolved='<div class="card-head"><div class="cht"><svg viewBox="0 0 16 16" width="16" height="16" style="vertical-align:-3px;margin-right:6px;fill:#0969da"><path d="M8 0L2 5l1.4 1.4L7 3.8V13h2V3.8l3.6 2.6L14 5 8 0z"/></svg>已解决题目 <span class="chm">('+solvedProblems.length+' 题)</span></div></div>';
    var body='<div class="sp-grid">';
    var unifiedBg='#2563eb';
    var unifiedFg='#fff';
    // 不再按难度排序/着色，统一按题号升序
    solvedProblems.slice().sort(function(a,bb){
      var ida=parseInt(a.id)||0;
      var idb=parseInt(bb.id)||0;
      return ida-idb;
    }).forEach(function(p){
      var tip='P'+p.id+(p.title?' · '+p.title:'')+(p.name?' · '+p.name:'');
      var spHtml='P'+esc(p.id);
      if(p.nameHtml&&p.nameHtml.indexOf('<')>=0&&p.nameHtml.indexOf('>')>=0){
        spHtml='<div style="font-size:10px;opacity:0.7">P'+esc(p.id)+'</div><div style="font-size:12px;font-weight:500">'+p.nameHtml+'</div>';
      }
      body+='<a class="sp-cell" href="#" onclick="event.preventDefault();vm({command:\'openProblem\',id:\''+esc(p.id)+'\',url:\''+esc(p.url||(b+'/OnlineJudge/problem_show.php?id='+p.id))+'\'})" style="background:'+unifiedBg+';color:'+unifiedFg+';border-color:'+unifiedBg+'" title="'+esc(tip)+'">'+spHtml+'</a>';
    });
    body+='</div>';
    solvedHtml='<div class="card solved-card">'+headSolved+body+'</div>';
  }

  var avUrl=data.avatar_url||data.avatarUrl||'';
  var hdrImg=data.header_image_url||'';
  var passRate=submissionCount>0?((solvedCount/submissionCount)*100).toFixed(1):'0';

  function stripHtml(h){return h?h.replace(/<br\s*\/?>/gi,'\n').replace(/<[^>]*>/g,'').replace(/&nbsp;/g,' ').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').trim():'';}
  var displayNameHtml = esc(username);
    if (data.userHtml && typeof data.userHtml === 'string' && data.userHtml.trim() && data.userHtml.trim().indexOf('<') >= 0 && data.userHtml.trim().indexOf('>') >= 0) {
      displayNameHtml = data.userHtml;
    }
    var leftCard='<div class="card profile-card"><div class="banner" style="'+(hdrImg?'background-image:url('+esc(hdrImg)+');background-size:cover;background-position:center':'')+'"><div class="bcover"></div></div><div class="pf-row"><div class="avwrap">'+(avUrl?'<img src="'+esc(avUrl)+'" class="av" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">':'')+'<div class="avph" style="'+(avUrl?'display:none':'')+'">'+(username?username.charAt(0).toUpperCase():'?')+'</div></div><div class="pf-main"><div class="pf-uname-row"><span class="pf-uname" style="color:'+userColor+'">'+displayNameHtml+'</span>'+(data.tags&&data.tags.length?data.tags.map(function(t){return'<span class="ptag" style="background:'+esc(t.color||'#6366f1')+'">'+esc(t.text||t.tag||'')+'</span>';}).join(''):'')+(data.isBanned?'<span class="ptag ban">封禁</span>':'')+'</div>'+(data.nickname&&data.nickname!==username?'<div class="pf-nick">'+esc(data.nickname)+'</div>':'')+(data.signature?'<div class="pf-sig">'+esc(data.signature)+'</div>':'')+'</div></div><div class="stats3"><div class="st"><div class="stn" style="color:#0969da">'+solvedCount+'</div><div class="stl">解决</div></div><div class="st"><div class="stn" style="color:#8250df">'+submissionCount+'</div><div class="stl">提交</div></div><div class="st"><div class="stn" style="color:#2ea043">'+passRate+'%</div><div class="stl">通过率</div></div></div><div class="pf-details">'+(data.school?'<div class="pfd"><svg width="14" height="14" viewBox="0 0 16 16" style="fill:#57606a;margin-right:6px;vertical-align:-2px"><path d="M7.7 1L1 5.2V10c0 .5.5 1 1 1l2-1v2h6V10l2 1c.5 0 1-.5 1-1V5.2L8.3 1h-.6zM2 6.2L8 3l6 3.2-6 3.2L2 6.2z"/></svg>'+esc(data.school)+'</div>':'')+(data.email?'<div class="pfd"><svg width="14" height="14" viewBox="0 0 16 16" style="fill:#57606a;margin-right:6px;vertical-align:-2px"><path d="M1 3h14v10H1V3zm1 2v.3l6 3.7 6-3.7V5H2zm12 1.2l-5.5 3.4c-.3.2-.7.2-1 0L2 6.2V12h12V6.2z"/></svg>'+esc(data.email)+'</div>':'')+(username?'<div class="pfd"><svg width="14" height="14" viewBox="0 0 16 16" style="fill:#57606a;margin-right:6px;vertical-align:-2px"><path d="M8 1a4 4 0 00-4 4c0 1.6 1 3 2.4 3.6C4.3 9.3 3 11 3 13h10c0-2-1.3-3.7-3.4-4.4A4 4 0 008 1zm0 2a2 2 0 110 4 2 2 0 010-4z"/></svg>用户名: '+esc(username)+'</div>':'')+'</div>'+(data.bio!==undefined||data.bio_html!==undefined?'<div class="pf-bio"><div class="pf-bio-h">个人简介</div><div class="pf-bio-b" id="userBioContent">'+mdLatexToHtml(data.bio||stripHtml(data.bio_html||''))+'</div></div>':'')+'</div>';

  var rightCol='';
  if(activityChartHtml)rightCol+=activityChartHtml;
  if(solvedHtml)rightCol+=solvedHtml;
  if(!rightCol)rightCol='<div class="card"><div class="card-head"><div class="cht">暂无更多数据</div></div><div style="padding:16px;color:#666;text-align:center">少女祈祷中...</div></div>';

  var pageCss=[
    'body{margin:0;padding:18px;background:linear-gradient(180deg,#f2f5fa 0%,#eef1f7 40%,#eef1f7 100%);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;color:#1f2328;min-height:100vh;}',
    '.wrap{max-width:1180px;margin:0 auto;}',
    '.two-col{display:grid;grid-template-columns:340px 1fr;gap:16px;}',
    '@media(max-width:880px){.two-col{grid-template-columns:1fr;}}',
    '.card{background:#fff;border-radius:14px;box-shadow:0 1px 2px rgba(0,0,0,.04),0 4px 14px rgba(28,54,89,.05);overflow:hidden;margin-bottom:16px;}',
    '.card-head{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid #eef1f6;}',
    '.cht{font-weight:600;color:#1f2328;font-size:14px;}',
    '.chm{font-size:12px;color:#656d76;font-weight:400;margin-left:4px;}',
    '.profile-card .banner{height:130px;position:relative;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);}',
    '.profile-card .bcover{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,0) 40%,rgba(0,0,0,.18) 100%);}',
    '.pf-row{padding:0 20px 12px;position:relative;}',
    '.avwrap{width:84px;height:84px;border-radius:50%;border:4px solid #fff;background:#eef1f6;margin-top:-44px;overflow:hidden;display:flex;align-items:center;justify-content:center;position:relative;box-shadow:0 2px 10px rgba(0,0,0,.1);}',
    '.av{width:100%;height:100%;object-fit:cover;display:block;}',
    '.avph{width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:30px;font-weight:700;color:#8b949e;background:linear-gradient(135deg,#e0e7ff,#ede9fe);}',
    '.pf-main{margin-top:10px;}',
    '.pf-uname-row{display:flex;align-items:center;flex-wrap:wrap;gap:6px;}',
    '.pf-uname{font-size:20px;font-weight:700;letter-spacing:.2px;}',
    '.ptag{display:inline-block;padding:2px 8px;border-radius:999px;color:#fff;font-size:11px;font-weight:600;vertical-align:middle;}',
    '.ptag.ban{background:#f85149;}',
    '.pf-nick{font-size:13px;color:#474d57;margin-top:2px;}',
    '.pf-sub{font-size:13px;color:#57606a;margin-top:2px;}',
    '.pf-sig{font-size:12px;color:#8b949e;margin-top:6px;font-style:italic;border-left:3px solid #d0d7de;padding-left:8px;line-height:1.5;}',
    '.stats3{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding:12px 18px;border-top:1px solid #f1f3f6;}',
    '.st{text-align:center;padding:8px 4px;border-radius:10px;background:#f7f9fc;}',
    '.stn{font-size:18px;font-weight:700;line-height:1.2;}',
    '.stl{font-size:11px;color:#656d76;margin-top:3px;}',
    '.pf-details{padding:4px 20px 6px;}',
    '.pfd{font-size:12.5px;color:#474d57;padding:6px 0;display:flex;align-items:center;}',
    '.pf-bio{padding:8px 20px 18px;}',
    '.pf-bio-h{font-size:12px;color:#656d76;margin-bottom:6px;font-weight:600;}',
    '.pf-bio-b{font-size:13px;line-height:1.7;color:#24292f;background:#f7f9fc;border-radius:10px;padding:10px 12px;}',
    '.pf-bio-b img{max-width:100%;border-radius:6px;}',
    '.hm-card .card-head{padding:14px 18px 8px;border-bottom:none;}',
    '.hm-body{padding:0 18px 16px;}',
    '.hm-scroll{overflow-x:auto;padding-bottom:4px;}',
    '.hmt{border-collapse:separate;border-spacing:3px;table-layout:fixed;}',
    '.hmt th.dw{font-size:10px;color:#8b949e;font-weight:400;width:22px;padding:0 4px 0 0;text-align:right;line-height:13px;}',
    '.hmt th.ml{font-size:10px;color:#656d76;font-weight:400;text-align:left;height:16px;padding:0 0 2px 2px;}',
    '.hmc{display:inline-block;width:13px;height:13px;border-radius:3px;transition:transform .15s;}',
    'table.hmt .hmc{display:table-cell;padding:0;cursor:pointer;}',
    'table.hmt td.hmc:hover, .hm-legend .hmc, i.hmc{transform:scale(1.15);box-shadow:0 0 0 1px rgba(0,0,0,.1);}',
    'table.hmt td.hmc{border-radius:3px;}',
    '.hm-legend{display:flex;align-items:center;gap:4px;margin-top:10px;justify-content:flex-end;}',
    '.hm-legend .hmc,.hm-legend i.hmc{display:inline-block;width:12px;height:12px;border-radius:2px;margin:0 1px;transform:none;box-shadow:none;}',
    '.hml{font-size:11px;color:#656d76;margin:0 2px;}',
    '.sp-sum{display:flex;flex-wrap:wrap;gap:6px;padding:12px 18px 0;}',
    '.sp-pill{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;background:#f5f7fa;font-size:12px;color:#474d57;}',
    '.sp-pill b{color:#1f2328;}',
    '.sp-dot{display:inline-block;width:10px;height:10px;border-radius:50%;}',
    '.sp-grid{padding:10px 18px 18px;display:flex;flex-wrap:wrap;gap:6px;}',
    '.sp-cell{display:inline-flex;align-items:center;justify-content:center;padding:5px 9px;border-radius:8px;font-size:12px;font-weight:600;text-decoration:none;border:1px solid transparent;transition:transform .12s,box-shadow .12s;}',
    '.sp-cell:hover{transform:translateY(-1px);box-shadow:0 4px 12px rgba(0,0,0,.14);}',
    '.sp-id{letter-spacing:.2px;}'
  ].join('');

  return wrapWithMathJax(esc(username),
    '<style>'+pageCss+'</style>'+
    '<div class="wrap"><div class="two-col"><div class="left-col">'+leftCard+'</div><div class="right-col">'+rightCol+'</div></div></div>'+
    '<script>var v=window.vscodeApi||acquireVsCodeApi();function vm(m){v.postMessage(m);}</script>',
    b
  );
}

function getMarkdownEditorWebview(options){
  var initialContent=options.initialContent||'';
  var jsContent=JSON.stringify(initialContent);
  var submitCmd=options.submitCommand||'submitEditorContent';
  var extraData=JSON.stringify(options.extraData||{});
  var submitLabel=esc(options.submitLabel||'发布');
  var mpCss='<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/markdown-palettes/dist/markdown-palettes.css">';
  var mpJs='<script src="https://cdn.jsdelivr.net/npm/markdown-palettes/dist/markdown-palettes.js"><\/script>';
  return wrapWithMathJax(esc(options.title||'编辑器'),
    '<style>'+
    '*{box-sizing:border-box}body{font-family:system-ui,sans-serif;background:#f7f9fb;padding:12px;color:#333;height:100vh;margin:0;display:flex;flex-direction:column;overflow:hidden}'+
    '#mpEditorContainer{flex:1;min-height:0;border-radius:8px;overflow:hidden;background:#fff;border:1px solid #dbeaff}'+
    '#mpEditorContainer .CodeMirror{height:100% !important}'+
    '.action-bar{flex-shrink:0;text-align:center;padding:8px 0 2px}'+
    '.action-bar button{padding:7px 22px;border:1px solid #dbeaff;border-radius:8px;background:#fff;color:#007acc;cursor:pointer;font-size:13px;margin:0 4px}'+
    '.action-bar button.primary{background:#007acc;color:#fff;border-color:#007acc}'+
    '</style>'+
    mpCss+
    '<div id="mpEditorContainer"><div id="mpEditor"></div></div>'+
    '<div class="action-bar">'+
      '<button class="primary" id="btnSubmit">'+submitLabel+'</button>'+
      '<button id="btnCancel">取消</button>'+
    '</div>'+
    mpJs+
    '<script>'+
    'console.log("[Discuss] 编辑器脚本加载，submitCmd="+JSON.stringify("'+submitCmd+'"),"extraData="+JSON.stringify('+extraData+'));'+
    'var v=window.vscodeApi||acquireVsCodeApi();'+
    'console.log("[Discuss] vscodeApi v="+!!v);'+
    'var mpEditor=null;'+
    '(function initMdEditor(){'+
      'try{'+
        'if(!window.MarkdownPalettes){console.log("[Discuss] MarkdownPalettes 未就绪，重试...");setTimeout(initMdEditor,200);return}'+
        'mpEditor=new MarkdownPalettes("#mpEditor");'+
        'mpEditor.content='+jsContent+';'+
        'console.log("[Discuss] MarkdownPalettes 初始化完成");'+
      '}catch(e){console.log("[Discuss] MarkdownPalettes 初始化错误:",e);setTimeout(initMdEditor,500)}'+
    '})();'+
    'document.getElementById("btnSubmit").addEventListener("click",function(){'+
      'console.log("[Discuss] 提交按钮被点击，mpEditor="+!!mpEditor+", content长度="+(mpEditor?mpEditor.content.length:0));'+
      'try{'+
        'v.postMessage({command:"'+submitCmd+'",content:mpEditor?mpEditor.content:"",format:"markdown",extraData:'+extraData+'})'+
      '}catch(e){console.log("[Discuss] postMessage 失败:",e)}'+
    '});'+
    'document.getElementById("btnCancel").addEventListener("click",function(){v.postMessage({command:"cancelEditor"})});'+
    '</script>');
}

// Contest result with clickable problem headers and score cells
function getContestResultWebview(data,b){
  var r=data.records,pidList=data.problemIds||[],purlList=data.problemUrls||[],h='';
  if(r&&r.length>0)r.forEach(function(x){
    var probCells='';var realnameCell='';
    if(x.realname)realnameCell='<td style="color:#888;font-size:11px">'+esc(x.realname)+'</td>';
    for(var pi=0;pi<x.problems.length;pi++){
      var t=x.problems[pi],sid=x.problemLinks&&x.problemLinks[pi]||'',ppid=x.problemPids&&x.problemPids[pi]||'',purl=(purlList[pi]||'');
      var numV=parseInt(t),cls='';
      if(!isNaN(numV)){cls=numV>=100?'h':numV===0?'l':'m';}else{cls='n';} // 非数字状态：未提交等
      var dataAttrs='';
      if(sid){
        dataAttrs=' data-sid="'+sid+'" data-pid="'+ppid+'"';
        if(purl)dataAttrs+=' data-url="'+esc(purl)+'"';
        probCells+='<td class="pr '+cls+'"'+dataAttrs+' style="cursor:pointer" title="点击查看评测详情">'+esc(t)+'</td>';
      }else if(ppid||purl){
        dataAttrs=' data-pid="'+ppid+'"';
        if(purl)dataAttrs+=' data-url="'+esc(purl)+'"';
        probCells+='<td class="pr '+cls+'"'+dataAttrs+' style="cursor:pointer" title="点击打开题目">'+esc(t)+'</td>';
      }else probCells+='<td class="pr '+cls+'">'+esc(t)+'</td>';
    }
    h+='<tr><td>'+esc(x.rank)+'</td><td>'+userLinkHtml(x.username, x.userId||'', x.solvedCount!==undefined?x.solvedCount:-1, x.color||'', false, x.tags || [], x.usernameHtml||'')+'</td>'+realnameCell+'<td style="font-weight:600;color:#007acc">'+esc(x.score)+'</td>'+probCells+'</tr>';
  });
  var hasRealname=r&&r.length>0&&r[0].realname;
  var headerCols='<th>\u6392\u540D</th><th>\u7528\u6237</th>'+(hasRealname?'<th>\u771F\u540D</th>':'')+'<th>\u603B\u5206</th>';
  var probHeaders='';
  if(r&&r.length>0){
    for(var pi=0;pi<r[0].problems.length;pi++){
      var pId=pidList[pi]||'';
      var pUrl=purlList[pi]||'';
      var headerHtml=(data.problemHeadersHtml&&data.problemHeadersHtml[pi])?data.problemHeadersHtml[pi]:'#'+(pi+1);
      var thDataAttrs='';
      if(pId)thDataAttrs+=' data-pid="'+pId+'"';
      if(pUrl)thDataAttrs+=' data-url="'+esc(pUrl)+'"';
      if(pId||pUrl){
        probHeaders+='<th class="ph"'+thDataAttrs+' style="cursor:pointer;color:#007acc" title="点击打开题目 #'+(pi+1)+'">'+headerHtml+'</th>';
      }else{
        probHeaders+='<th title="题目 #'+(pi+1)+'">'+headerHtml+'</th>';
      }
    }
  }
  return wrapWithMathJax('\u6BD4\u8D5B\u7ED3\u679C',
    '<style>body{font-family:system-ui,sans-serif;background:#f7f9fb;padding:16px;color:#333;font-size:12px}h2{font-size:17px;margin:0 0 10px}.c{background:#fff;border-radius:10px;padding:16px;margin-bottom:12px;box-shadow:0 1px 4px rgba(0,0,0,0.08)}table{width:100%;border-collapse:collapse;font-size:12px}th,td{padding:5px 6px;border:1px solid #e1e4e8;text-align:center}th{background:#f6f8fa;font-weight:600;position:sticky;top:0;z-index:1}th.ph:hover{color:#007acc;text-decoration:underline}.pr{font-weight:600}.pr.h{color:#2ea043;background:#dafbe1}.pr.m{color:#fa5a05;background:#fff4e6}.pr.l{color:#cf222e;background:#ffebe9}.pr.n{color:#888;background:#f6f8fa}</style><h2>\u6BD4\u8D5B\u7ED3\u679C</h2><div class="c" style="overflow-x:auto"><table><thead><tr>'+headerCols+probHeaders+'</tr></thead><tbody>'+h+'</tbody></table></div>'+
    '<script>var v=window.vscodeApi||acquireVsCodeApi();document.querySelectorAll("td[data-sid]").forEach(function(e){e.onclick=function(){v.postMessage({command:"openStatusDetail",id:e.dataset.sid})}});document.querySelectorAll("td[data-pid]:not([data-sid]),td[data-url]:not([data-sid])").forEach(function(e){e.onclick=function(){var pid=e.dataset.pid;var url=e.dataset.url;if(pid&&!url)url="'+b+'/OnlineJudge/problem_show.php?id="+pid;if(!url)return;v.postMessage({command:"openProblem",id:pid,url:url})}});document.querySelectorAll("th.ph").forEach(function(e){e.onclick=function(){var pid=e.dataset.pid;var url=e.dataset.url;if(pid&&!url)url="'+b+'/OnlineJudge/problem_show.php?id="+pid;if(!url)return;v.postMessage({command:"openProblem",id:pid,url:url})}})</script>', b);
}

// Ranklist page
function getRanklistWebview(data,_b){
  var r=data.records||[],h='',cp=data.currentPage||1,tp=data.totalPages||1;
  if(r&&r.length>0)r.forEach(function(x){
    var _sc=x.solvedCount!==undefined?x.solvedCount:(x.solved!==undefined?parseInt(x.solved)||0:-1);
    var _crawledColor=x.color||x.userColor||'';
    var userDisplayHtml;
      if(x.userHtml&&/<span[^>]*style\s*=\s*["'][^"']*color\s*:/i.test(x.userHtml)){
        var dataAttrs='data-username="'+esc(x.username)+'" data-uid="'+esc(x.userId||'')+'"';
        if(_sc===-1&&!_crawledColor)dataAttrs+=' data-needs-data="1"';
        var linkColor=_crawledColor||'#2563EB';
        userDisplayHtml='<span class="user-link" '+dataAttrs+' data-user-html="'+esc(x.userHtml)+'" style="color:'+linkColor+';font-weight:bold;cursor:pointer">'+x.userHtml+'</span>';
      }else{
      userDisplayHtml=userLinkHtml(x.username, x.userId||'', _sc, _crawledColor, false, x.tags || []);
    }
    h+='<tr><td>'+esc(x.rank)+'</td><td>'+userDisplayHtml+'</td><td>'+esc(x.level||x.rank_level||'')+'</td><td>'+esc(x.nickname||'')+'</td><td>'+esc(x.solved||'0')+'</td><td>'+esc(x.submitted||'0')+'</td><td>'+esc(x.ratio||'')+'</td></tr>';
  });else h='<tr><td colspan="7" style="text-align:center;color:#888">\u6682\u65E0\u6570\u636E</td></tr>';
  return wrapWithMathJax('\u9009\u624B\u6392\u540D',
    '<style>body{font-family:system-ui,sans-serif;background:#f7f9fb;padding:16px;color:#333;font-size:13px}h2{font-size:17px;margin:0 0 10px}.p{display:flex;gap:6px;margin-bottom:10px;align-items:center}.p button{padding:5px 12px;border-radius:6px;border:1px solid #dbeaff;background:#fff;color:#007acc;cursor:pointer;font-size:12px}.p button:disabled{opacity:0.4}.p span{font-size:12px;color:#666}.c{background:#fff;border-radius:10px;padding:16px;margin-bottom:12px;box-shadow:0 1px 4px rgba(0,0,0,0.08)}table{width:100%;border-collapse:collapse;font-size:12px}th,td{padding:5px 8px;border:1px solid #e1e4e8;text-align:center}th{background:#f6f8fa;font-weight:600}'+userCardCss()+'</style><h2>\u9009\u624B\u6392\u540D</h2><div class="p"><button id="pr"'+(cp<=1?' disabled':'')+'><</button><span>'+cp+'</span><button id="nx"'+(cp>=tp?' disabled':'')+'>></button></div><div class="c" style="overflow-x:auto"><table><thead><tr><th>\u6392\u540D</th><th>\u7528\u6237</th><th>Level</th><th>\u6635\u79F0</th><th>\u89E3\u51B3</th><th>\u63D0\u4EA4</th><th>\u901A\u8FC7\u7387</th></tr></thead><tbody>'+h+'</tbody></table></div>'+
    '<script>var v=(window.vscodeApi||acquireVsCodeApi());var cp='+cp+',tp='+tp+';document.getElementById("pr").onclick=function(){v.postMessage({command:"changePage",p:cp-1})};document.getElementById("nx").onclick=function(){v.postMessage({command:"changePage",p:cp+1})}</script><script>'+userCardScript()+'</script>', _b);
}

// Problem Set List with tabs - shows #ID, search and sort
function getProblemSetListWebview(sets,b,username,currentKeyword,currentSort,currentOrder){
  var h='', kw=esc(currentKeyword||''), cs=currentSort||'updated_at', co=currentOrder||'desc';
  // 权限类型映射函数
  function getPermLabel(perm, allowedUsers, deniedUsers) {
    if(!perm || perm === 'public') return '\u516C\u5F00';
    if(perm === 'private') return '\u79C1\u6709';
    if(perm === 'password') return '\u5BC6\u7801\u4FDD\u62A4';
    if(perm === 'whitelist') {
      if(allowedUsers && allowedUsers.length > 0) {
        return '\u5141\u8BB8 ' + allowedUsers.slice(0, 3).join(', ') + (allowedUsers.length > 3 ? '...' : '') + ' \u67E5\u770B';
      }
      return '\u6307\u5B9A\u53EF\u8BBF\u95EE';
    }
    if(perm === 'blacklist') {
      if(deniedUsers && deniedUsers.length > 0) {
        return '\u7981\u6B62 ' + deniedUsers.slice(0, 3).join(', ') + (deniedUsers.length > 3 ? '...' : '') + ' \u67E5\u770B';
      }
      return '\u6307\u5B9A\u7981\u8BBF\u95EE';
    }
    return perm;
  }
  function getPermClass(perm) {
    if(!perm || perm === 'public') return 'perm-public';
    if(perm === 'private') return 'perm-private';
    if(perm === 'password') return 'perm-password';
    if(perm === 'whitelist') return 'perm-whitelist';
    if(perm === 'blacklist') return 'perm-blacklist';
    return '';
  }
  if(sets&&sets.length>0)sets.forEach(function(s){
    var perm = s.permission || (s.is_public ? 'public' : 'private');
    var allowedUsers = s.allowed_users ? s.allowed_users.split(',').filter(Boolean) : [];
    var deniedUsers = s.denied_users ? s.denied_users.split(',').filter(Boolean) : [];
    var permLabel = getPermLabel(perm, allowedUsers, deniedUsers);
    var permClass = getPermClass(perm);
    var probCount = s.problem_ids ? s.problem_ids.split(',').filter(Boolean).length : (s.problems ? s.problems.length : 0);
    h+='<div class="ps-item" data-id="'+esc(String(s.id))+'" data-title="'+esc(s.title)+'"><div class="ps-title"><span class="ps-id">#'+esc(String(s.id))+'</span> '+esc(s.title)+'</div><div class="ps-meta">'+userLinkHtml(s.owner||'', s.ownerId||'', s.ownerSolvedCount!==undefined?s.ownerSolvedCount:-1, undefined, true)+' | <span class="'+permClass+'">'+permLabel+'</span> | '+probCount+'\u9898</div></div>';
  });else h='<div style="text-align:center;padding:40px;color:#888">\u6682\u65E0\u9898\u5355</div>';
  return wrapWithMathJax('\u9898\u5355',
    '<style>body{font-family:system-ui,sans-serif;background:#f7f9fb;padding:16px;color:#333;font-size:13px}h2{font-size:17px;margin:0 0 10px}.pf{background:#fff;border-radius:10px;padding:12px;margin-bottom:12px;box-shadow:0 1px 4px rgba(0,0,0,0.08)}.fr{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px;align-items:center}.fr input,.fr select{flex:1;min-width:60px;padding:5px 8px;border:1px solid #dbeaff;border-radius:5px;font-size:12px}.fb{padding:6px 14px;background:#007acc;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;margin:2px}.fb.sec{background:#6c757d}.ps-item{background:#fff;padding:10px 14px;border-radius:8px;margin:4px 0;cursor:pointer;border:1px solid #eee}.ps-item:hover{background:#e6f0fa;border-color:#dbeaff}.ps-title{font-weight:600;font-size:14px;color:#333}.ps-id{color:#007acc;font-weight:700;background:#e6f0fa;padding:1px 6px;border-radius:4px;font-size:12px}.ps-meta{font-size:11px;color:#888;margin-top:3px}.perm-public{color:#2ea043;background:#dafbe1;padding:1px 4px;border-radius:3px;font-size:11px}.perm-private{color:#6c757d;background:#f0f0f0;padding:1px 4px;border-radius:3px;font-size:11px}.perm-password{color:#fa5a05;background:#fff4e6;padding:1px 4px;border-radius:3px;font-size:11px}.perm-whitelist{color:#007acc;background:#e6f0fa;padding:1px 4px;border-radius:3px;font-size:11px}.perm-blacklist{color:#cf222e;background:#ffebe9;padding:1px 4px;border-radius:3px;font-size:11px}.ab{padding:6px 16px;border:1px solid #dbeaff;border-radius:6px;background:#fff;color:#007acc;cursor:pointer;font-size:12px;margin:3px}.ab.p{background:#007acc;color:#fff}.fb.sm{background:#2ea043;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;padding:6px 14px;margin:2px}'+userCardCss()+'</style><h2>\u9898\u5355</h2><div style="display:flex;gap:6px;margin-bottom:12px"><button class="ab p" id="tabPublic">\u516C\u5F00\u9898\u5355</button><button class="ab" id="tabMy">\u6211\u7684\u9898\u5355</button><button class="fb sm" id="btnCreate">\u521B\u5EFA\u9898\u5355</button></div><div class="pf"><div class="fr"><input type="text" id="fKeyword" placeholder="\u641C\u7D22\u9898\u5355\u6807\u9898/\u63CF\u8FF0/\u62E5\u6709\u8005/\u9898\u76EE\u7F16\u53F7/\u540D\u79F0..." style="width:100%" value="'+kw+'"></div><div class="fr"><label>\u6392\u5E8F</label><select id="fSort"><option value="updated_at" '+(cs==='updated_at'?'selected':'')+'>\u66F4\u65B0\u65F6\u95F4</option><option value="created_at" '+(cs==='created_at'?'selected':'')+'>\u521B\u5EFA\u65F6\u95F4</option><option value="title" '+(cs==='title'?'selected':'')+'>\u6807\u9898</option><option value="id" '+(cs==='id'?'selected':'')+'>\u7F16\u53F7</option></select><select id="fOrder"><option value="desc" '+(co==='desc'?'selected':'')+'>\u964D\u5E8F</option><option value="asc" '+(co==='asc'?'selected':'')+'>\u5347\u5E8F</option></select></div><div><button class="fb" id="btnSearch">\u641C\u7D22</button><button class="fb sec" id="btnReset">\u91CD\u7F6E</button></div></div><div id="psetContent">'+h+'</div>'+
    '<script>var v=(window.vscodeApi||acquireVsCodeApi());function vm(m){v.postMessage(m)}document.getElementById("tabPublic").onclick=function(){v.postMessage({command:"loadPublicSets"})};document.getElementById("tabMy").onclick=function(){v.postMessage({command:"loadMySets"})};document.getElementById("btnCreate").onclick=function(){v.postMessage({command:"showCreateSet"})};document.getElementById("btnSearch").onclick=function(){v.postMessage({command:"searchProblemSets",keyword:document.getElementById("fKeyword").value,sort_by:document.getElementById("fSort").value,sort_order:document.getElementById("fOrder").value})};document.getElementById("btnReset").onclick=function(){document.getElementById("fKeyword").value="";v.postMessage({command:"searchProblemSets",keyword:"",sort_by:"updated_at",sort_order:"desc"})};document.getElementById("fKeyword").onkeypress=function(e){if(e.key==="Enter")document.getElementById("btnSearch").click()};document.querySelectorAll(".ps-item").forEach(function(e){e.addEventListener("click",function(ev){if(ev.target.closest(".user-link")){ev.stopPropagation();return}v.postMessage({command:"openProblemSet",id:e.dataset.id,title:e.dataset.title})})})</script><script>'+userCardScript()+'</script>', b);
}

// Problem Set Create / Edit form with live Markdown+LaTeX preview
function getProblemSetEditorWebview(data,b,currentUser){
  var isEdit=data&&data.id;
  var titleVal=esc(data?data.title||'':'');
  var descVal=esc(data?data.description||'':'');
  var isPublicVal=data&&data.is_public?'checked':'';
  var probIds=esc(data?data.problem_ids||'':'');
  var permissionVal=data?data.permission||'public':'';
  var passwordVal=esc(data?data.password||'':'');
  var passwordPlaceholder=isEdit?'留空则保持原密码':'设置访问密码';
  function _toArr(v){if(Array.isArray(v))return v;if(typeof v==='string')return v.split(',').filter(Boolean);return [];}
  var allowedUsers=_toArr(data?data.allowed_users:[]);
  var deniedUsers=_toArr(data?data.denied_users:[]);
  // 去重
  allowedUsers=allowedUsers.filter(function(u,i,a){return a.indexOf(u)===i;});
  deniedUsers=deniedUsers.filter(function(u,i,a){return a.indexOf(u)===i;});
  var currentUsername=currentUser||'';
  var allowedHtml='';
  allowedUsers.forEach(function(u){allowedHtml+='<span class="user-tag" data-uid="'+esc(u)+'">'+esc(u)+'<span class="remove" onclick="removeAllowed(\''+esc(u)+'\')">×</span></span>';});
  var deniedHtml='';
  deniedUsers.forEach(function(u){deniedHtml+='<span class="user-tag" data-uid="'+esc(u)+'">'+esc(u)+'<span class="remove" onclick="removeDenied(\''+esc(u)+'\')">×</span></span>';});
  
  var scriptParts = [
    'var v=window.vscodeApi||acquireVsCodeApi();',
    'var psid=' + JSON.stringify(data?data.id:null) + ';',
    'var allowedList=' + JSON.stringify(allowedUsers) + ';',
    'var deniedList=' + JSON.stringify(deniedUsers) + ';',
    'var currentUser=' + JSON.stringify(currentUsername) + ';',
    'function vm(m){v.postMessage(m)}',
    'function escHtml(t){if(!t)return"";return String(t).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/\\x27/g,"&#039;")}',
    'function md2html(t){if(!t)return"";var latexBlocks=[];var idx=0;var h=t;h=h.replace(/\\$\\$([\\s\\S]*?)\\$\\$/g,function(m){var key="%%LATEX_BLOCK_"+idx+"%%";latexBlocks.push(m);idx++;return key});h=h.replace(/\\$([^\\$\\n]+?)\\$/g,function(m){var key="%%LATEX_INLINE_"+idx+"%%";latexBlocks.push(m);idx++;return key});h=escHtml(h);h=h.replace(/```(\\w*)\\n([\\s\\S]*?)```/g,"<pre><code>$2</code></pre>");h=h.replace(/`([^`]+)`/g,"<code>$1</code>");h=h.replace(/\\*\\*\\*(.+?)\\*\\*\\*/g,"<strong><em>$1</em></strong>");h=h.replace(/\\*\\*(.+?)\\*\\*/g,"<strong>$1</strong>");h=h.replace(/\\*(.+?)\\*/g,"<em>$1</em>");h=h.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g,"<a href=\'$2\' target=\'_blank\' style=\'color:#007acc\'>$1</a>");h=h.replace(/!\\[([^\\]]*)\\]\\(([^)]+)\\)/g,"<img src=\'$2\' alt=\'$1\' style=\'max-width:100%;border-radius:4px;margin:8px 0\'>");h=h.replace(/^### (.+)$/gm,"<h4 style=\'color:#007acc;margin:12px 0 4px\'>$1</h4>");h=h.replace(/^## (.+)$/gm,"<h3 style=\'color:#007acc;margin:12px 0 4px\'>$1</h3>");h=h.replace(/^# (.+)$/gm,"<h2 style=\'color:#007acc;margin:12px 0 4px\'>$1</h2>");h=h.replace(/^- (.+)$/gm,"<li>$1</li>");h=h.replace(/(<li>.*<\\/li>\\n?)+/g,"<ul style=\'padding-left:20px;margin:4px 0\'>$&</ul>");h=h.replace(/^\\d+\\. (.+)$/gm,"<li>$1</li>");h=h.replace(/\\n\\n/g,"</p><p style=\'margin:8px 0\'>");h=h.replace(/\\n/g,"<br>");idx=0;while(latexBlocks.length>0){var blk=latexBlocks.shift();h=h.replace("%%LATEX_BLOCK_"+idx+"%%",blk);h=h.replace("%%LATEX_INLINE_"+idx+"%%",blk);idx++}return"<p style=\'margin:8px 0\'>"+h+"</p>"}',
    'function updatePreview(){var md=document.getElementById("psDesc").value;var p=document.getElementById("psDescPreview");if(!md){p.innerHTML="<span style=\'color:#999\'>\u6682\u65E0\u63CF\u8FF0</span>";return}var h=md2html(md);p.innerHTML=h;if(typeof renderMathInElement==="function"){try{renderMathInElement(p,{delimiters:[{left:"$$",right:"$$",display:true},{left:"$",right:"$",display:false}],throwOnError:false})}catch(e){}}}',
    'document.getElementById("psDesc").oninput=updatePreview;',
    'setTimeout(updatePreview,100);',
    'document.getElementById("psPermission").onchange=function(){var val=this.value;document.getElementById("psPasswordField").style.display=val==="password"?"block":"none";document.getElementById("psWhitelistField").style.display=val==="whitelist"?"block":"none";document.getElementById("psBlacklistField").style.display=val==="blacklist"?"block":"none"};',
    'function addAllowedUser(uid){if(!uid)return;if(uid===currentUser){alert("\u4E0D\u80FD\u5C06\u81EA\u8EAB\u52A0\u5165\u53EF\u8BBF\u95EE\u5217\u8868");return}if(allowedList.indexOf(uid)!==-1){alert("\u7528\u6237\u5DF2\u5728\u5217\u8868\u4E2D");return}allowedList.push(uid);renderAllowedUsers()}',
    'function removeAllowed(uid){allowedList=allowedList.filter(function(u){return u!==uid});renderAllowedUsers()}',
    'function renderAllowedUsers(){var html="";allowedList.forEach(function(u){html+="<span class=\'user-tag\' data-uid=\'"+esc(u)+"\'>"+esc(u)+"<span class=\'remove\' onclick=\'removeAllowed(\\x27"+esc(u)+"\\x27)\'>×</span></span>"});document.getElementById("allowedUsers").innerHTML=html}',
    'function addDeniedUser(uid){if(!uid)return;if(uid===currentUser){alert("\u4E0D\u80FD\u5C06\u81EA\u8EAB\u52A0\u5165\u7981\u6B62\u8BBF\u95EE\u5217\u8868");return}if(deniedList.indexOf(uid)!==-1){alert("\u7528\u6237\u5DF2\u5728\u5217\u8868\u4E2D");return}deniedList.push(uid);renderDeniedUsers()}',
    'function removeDenied(uid){deniedList=deniedList.filter(function(u){return u!==uid});renderDeniedUsers()}',
    'function renderDeniedUsers(){var html="";deniedList.forEach(function(u){html+="<span class=\'user-tag\' data-uid=\'"+esc(u)+"\'>"+esc(u)+"<span class=\'remove\' onclick=\'removeDenied(\\x27"+esc(u)+"\\x27)\'>×</span></span>"});document.getElementById("deniedUsers").innerHTML=html}',
    'var allowedTimer=null;',
    'document.getElementById("allowedUserInput").oninput=function(){var inp=this;clearTimeout(allowedTimer);allowedTimer=setTimeout(function(){var val=inp.value.trim();if(val){v.postMessage({command:"searchUsers",keyword:val,source:"allowed"})}else{document.getElementById("allowedSug").innerHTML=""}},300)};',
    'document.getElementById("btnAddAllowed").onclick=function(){var val=document.getElementById("allowedUserInput").value.trim();if(val){addAllowedUser(val);document.getElementById("allowedUserInput").value="";document.getElementById("allowedSug").innerHTML=""}};',
    'var deniedTimer=null;',
    'document.getElementById("deniedUserInput").oninput=function(){var inp=this;clearTimeout(deniedTimer);deniedTimer=setTimeout(function(){var val=inp.value.trim();if(val){v.postMessage({command:"searchUsers",keyword:val,source:"denied"})}else{document.getElementById("deniedSug").innerHTML=""}},300)};',
    'document.getElementById("btnAddDenied").onclick=function(){var val=document.getElementById("deniedUserInput").value.trim();if(val){addDeniedUser(val);document.getElementById("deniedUserInput").value="";document.getElementById("deniedSug").innerHTML=""}};',
    'window.addEventListener("message",function(e){if(e.data.command==="userSearchResult"){var sug=e.data.results||[];var src=e.data.source||"allowed";var targetId=src==="denied"?"deniedSug":"allowedSug";var addFn=src==="denied"?"addDeniedUser":"addAllowedUser";var html="";sug.forEach(function(u){html+="<div class=\'sug-item\' onclick=\'"+addFn+"(\\x27"+esc(u.username)+"\\x27);document.getElementById(\\x27"+targetId+"\\x27).innerHTML=\\x27\\x27\'>"+esc(u.username)+" ("+(u.id||"")+")</div>"});document.getElementById(targetId).innerHTML=html}});',
    'document.getElementById("btnSave").onclick=function(){var title=document.getElementById("psTitle").value.trim();if(!title){alert("\u8BF7\u8F93\u5165\u9898\u5355\u6807\u9898");return}var pids=document.getElementById("psPids").value;if(!pids||!pids.trim()){alert("\u8BF7\u81F3\u5C11\u8F93\u5165\u4E00\u9053\u9898\u76EEID");return}var dedupPids=[...new Set(pids.split(",").map(function(s){return s.trim()}).filter(Boolean))].join(",");v.postMessage({command:"saveProblemSet",id:psid,title:title,description:document.getElementById("psDesc").value,permission:document.getElementById("psPermission").value,is_public:document.getElementById("psPermission").value==="public",password:document.getElementById("psPassword").value,allowed_users:allowedList.join(","),denied_users:deniedList.join(","),problem_ids:dedupPids})};'
  ];
  
  if(isEdit){
    scriptParts.push('document.getElementById("btnDelete").onclick=function(){v.postMessage({command:"deleteProblemSet",id:psid})};');
  }
  
  var scriptCode = scriptParts.join('');
  
  return wrapWithMathJax('\u9898\u5355\u7F16\u8F91',
    '<style>body{font-family:system-ui,sans-serif;background:#f7f9fb;padding:16px;color:#333;font-size:13px}h2{font-size:17px;margin:0 0 10px}.c{background:#fff;border-radius:10px;padding:16px;margin-bottom:12px;box-shadow:0 1px 4px rgba(0,0,0,0.08)}.fr{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px;align-items:center}.fr input,.fr select,.fr textarea{flex:1;min-width:60px;padding:5px 8px;border:1px solid #dbeaff;border-radius:5px;font-size:12px}.preview-box{background:#f8f9fb;border:1px solid #e1e4e8;border-radius:6px;padding:12px;margin:6px 0;min-height:60px;font-size:13px;line-height:1.6;overflow-x:auto}.preview-box img{max-width:100%;border-radius:4px}.preview-box table{border-collapse:collapse;margin:8px 0;font-size:12px}.preview-box th,.preview-box td{padding:4px 6px;border:1px solid #ddd;text-align:center}.preview-box pre{background:#f0f0f0;padding:8px;border-radius:4px;font-size:12px;overflow-x:auto}.ab{padding:6px 16px;border:1px solid #dbeaff;border-radius:6px;background:#fff;color:#007acc;cursor:pointer;font-size:12px;margin:3px}.ab.p{background:#007acc;color:#fff}.ab.danger{background:#cf222e;color:#fff;border-color:#cf222e}.user-tag{display:inline-block;background:#e6f0fa;color:#007acc;padding:3px 10px 3px 8px;border-radius:14px;font-size:12px;margin:2px;position:relative}.user-tag .remove{margin-left:6px;cursor:pointer;color:#007acc;font-weight:700}.user-tag .remove:hover{color:#cf222e}.user-search-box{display:flex;gap:4px;margin-bottom:6px}.user-search-box input{flex:1;padding:4px 8px;border:1px solid #dbeaff;border-radius:4px;font-size:12px}.user-search-box button{padding:4px 10px;border:1px solid #dbeaff;border-radius:4px;background:#fff;color:#007acc;cursor:pointer;font-size:12px}.sug-list{border:1px solid #dbeaff;border-radius:4px;background:#fff;max-height:150px;overflow-y:auto;margin-bottom:6px}.sug-item{padding:6px 10px;cursor:pointer;border-bottom:1px solid #f0f0f0;font-size:12px}.sug-item:hover{background:#e6f0fa}</style><h2>'+(isEdit?'\u7F16\u8F91\u9898\u5355':'\u521B\u5EFA\u9898\u5355')+'</h2><div class="c"><div class="fr" style="margin-bottom:8px"><label>\u6807\u9898:</label><input type="text" id="psTitle" value="'+titleVal+'" style="flex:1;padding:6px 10px;border:1px solid #dbeaff;border-radius:6px"></div><div class="fr" style="margin-bottom:8px"><label>\u63CF\u8FF0 (\u652F\u6301Markdown+LaTeX):</label></div><textarea id="psDesc" style="width:100%;padding:6px 10px;border:1px solid #dbeaff;border-radius:6px;height:80px;font-family:monospace;font-size:13px">'+descVal+'</textarea><div class="fr" style="margin:4px 0"><label>\u9884\u89C8:</label></div><div class="preview-box" id="psDescPreview">\u52A0\u8F7D\u4E2D...</div><div class="fr" style="margin-bottom:8px"><label>\u6743\u9650\u7C7B\u578B:</label><select id="psPermission"><option value="public"'+(permissionVal==='public'?' selected':'')+'>\u516C\u5F00</option><option value="private"'+(permissionVal==='private'?' selected':'')+'>\u79C1\u5BC6</option><option value="password"'+(permissionVal==='password'?' selected':'')+'>\u5BC6\u7801\u4FDD\u62A4</option><option value="whitelist"'+(permissionVal==='whitelist'?' selected':'')+'>\u6307\u5B9A\u7528\u6237\u53EF\u8BBF\u95EE</option><option value="blacklist"'+(permissionVal==='blacklist'?' selected':'')+'>\u6307\u5B9A\u7528\u6237\u4E0D\u53EF\u8BBF\u95EE</option></select></div><div id="psPasswordField" style="display:'+(permissionVal==='password'?'block':'none')+';margin-bottom:8px"><div class="fr"><label>\u5BC6\u7801:</label><input type="password" id="psPassword" value="'+passwordVal+'" placeholder="'+passwordPlaceholder+'" style="flex:1;padding:6px 10px;border:1px solid #dbeaff;border-radius:6px"></div></div><div id="psWhitelistField" style="display:'+(permissionVal==='whitelist'?'block':'none')+';margin-bottom:8px"><label>\u53EF\u8BBF\u95EE\u7528\u6237:</label><div id="allowedUsers">'+allowedHtml+'</div><div class="user-search-box"><input type="text" id="allowedUserInput" placeholder="\u8F93\u5165\u7528\u6237\u540D..." autocomplete="off"><button id="btnAddAllowed">+</button></div><div id="allowedSug" class="sug-list"></div></div><div id="psBlacklistField" style="display:'+(permissionVal==='blacklist'?'block':'none')+';margin-bottom:8px"><label>\u4E0D\u53EF\u8BBF\u95EE\u7528\u6237:</label><div id="deniedUsers">'+deniedHtml+'</div><div class="user-search-box"><input type="text" id="deniedUserInput" placeholder="\u8F93\u5165\u7528\u6237\u540D..." autocomplete="off"><button id="btnAddDenied">+</button></div><div id="deniedSug" class="sug-list"></div></div><div class="fr" style="margin-bottom:8px"><label>\u9898\u76EEIDs (\u9017\u53F7\u5206\u9694):</label><input type="text" id="psPids" value="'+probIds+'" style="flex:1;padding:6px 10px;border:1px solid #dbeaff;border-radius:6px"></div><div style="text-align:center;margin-top:12px"><button class="ab p" id="btnSave">'+(isEdit?'\u4FDD\u5B58\u4FEE\u6539':'\u521B\u5EFA\u9898\u5355')+'</button>'+(isEdit?'<button class="ab danger" id="btnDelete">\u5220\u9664\u9898\u5355</button>':'')+'<button class="ab" onclick="vm({command:\'cancelEdit\'})">\u53D6\u6D88</button></div></div>'+
    '<script>' + scriptCode + '</script>', b);
}

// Problem Set Detail with marks, progress bar, description rendered as HTML, owner edit/delete
function getProblemSetDetailWebview(set,problems,b,username,problemMarks){
  var ph='', isOwner=(username&&set.owner&&username===set.owner), totalCount=problems?problems.length:0;
  // 权限类型映射函数
  function getPermLabel(perm, allowedUsers, deniedUsers) {
    if(!perm || perm === 'public') return '\u516C\u5F00';
    if(perm === 'private') return '\u79C1\u6709';
    if(perm === 'password') return '\u5BC6\u7801\u4FDD\u62A4';
    if(perm === 'whitelist') {
      if(allowedUsers && allowedUsers.length > 0) {
        return '\u5141\u8BB8 ' + allowedUsers.slice(0, 3).join(', ') + (allowedUsers.length > 3 ? '...' : '') + ' \u67E5\u770B';
      }
      return '\u6307\u5B9A\u53EF\u8BBF\u95EE';
    }
    if(perm === 'blacklist') {
      if(deniedUsers && deniedUsers.length > 0) {
        return '\u7981\u6B62 ' + deniedUsers.slice(0, 3).join(', ') + (deniedUsers.length > 3 ? '...' : '') + ' \u67E5\u770B';
      }
      return '\u6307\u5B9A\u7981\u8BBF\u95EE';
    }
    return perm;
  }
  function getPermClass(perm) {
    if(!perm || perm === 'public') return 'perm-public';
    if(perm === 'private') return 'perm-private';
    if(perm === 'password') return 'perm-password';
    if(perm === 'whitelist') return 'perm-whitelist';
    if(perm === 'blacklist') return 'perm-blacklist';
    return '';
  }
  var perm = set.permission || (set.is_public ? 'public' : 'private');
  var allowedUsers = set.allowed_users ? set.allowed_users.split(',').filter(Boolean) : [];
  var deniedUsers = set.denied_users ? set.denied_users.split(',').filter(Boolean) : [];
  var permLabel = getPermLabel(perm, allowedUsers, deniedUsers);
  var permClass = getPermClass(perm);
  if(problems&&problems.length>0)problems.forEach(function(p){
    var mk=(problemMarks&&problemMarks[p.id])||p.mark||'';
    var mkHtml='';
    if(mk==='ac')mkHtml='<span class="pmk ac" data-mark="ac">\u2713</span>';
    else if(mk==='attempted')mkHtml='<span class="pmk att" data-mark="attempted">\u25CF</span>';
    else mkHtml='<span class="pmk" data-mark=""></span>';
    ph+='<div class="pc" data-id="'+esc(p.id)+'" data-url="'+esc(p.url)+'">'+mkHtml+'<span class="po">#'+esc(p.id)+'</span><span class="pn">'+esc(p.name)+'</span></div>';
  });else ph='<div style="text-align:center;padding:20px;color:#888">\u65E0\u9898\u76EE</div>';
  var progressBar='';
  var descHtml='';
  if(set.description){
    if(set.description.indexOf(String.fromCharCode(60))>=0)descHtml=set.description;
    else descHtml=mdToHtml(set.description);
  }
  var ownerButtons='';
  if(isOwner)ownerButtons='<div style="text-align:center;margin-top:16px"><button class="ab edit" id="btnEditSet">\u7F16\u8F91\u9898\u5355</button><button class="ab danger" id="btnDeleteSet">\u5220\u9664\u9898\u5355</button></div>';
  return wrapWithMathJax(esc(set.title||'\u9898\u5355'),
    '<style>body{font-family:system-ui,sans-serif;background:#f7f9fb;padding:16px;color:#333;font-size:14px}h2{font-size:18px;margin:0 0 12px;color:#007acc;border-bottom:2px solid #007acc;padding-bottom:8px}.meta{font-size:12px;color:#888;margin-bottom:12px;display:flex;align-items:center;gap:8px}.c{background:#fff;border-radius:10px;padding:16px;margin-bottom:12px;box-shadow:0 1px 4px rgba(0,0,0,0.08)}.pc{padding:12px 16px;display:flex;align-items:center;gap:8px;cursor:pointer;border-radius:8px;margin:4px 0;background:#fff;border:1px solid #e1e4e8;transition:all 0.2s}.pc:hover{background:#e6f0fa;border-color:#007acc;transform:translateX(2px)}.pmk{font-size:16px;min-width:24px;text-align:center;font-weight:bold}.pmk.ac{color:#28a745}.pmk.att{color:#ffc107;font-size:14px}.po{font-weight:700;color:#007acc;background:#e6f0fa;padding:3px 10px;border-radius:6px;font-size:13px;flex-shrink:0}.pn{flex:1;font-size:14px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.desc-box{background:#f9f9f9;border-left:4px solid #007acc;padding:12px 16px;border-radius:6px;margin:12px 0;font-size:13px;line-height:1.8}.desc-content{word-break:break-word}.desc-content img{max-width:100%;border-radius:4px;margin:8px 0}.desc-content table{border-collapse:collapse;margin:8px 0;font-size:12px}.desc-content th,.desc-content td{padding:4px 8px;border:1px solid #ddd;text-align:center}.desc-content th{background:#f5f5f5}.desc-content pre{background:#f6f8fa;padding:10px;border-radius:6px;font-size:12px;overflow-x:auto}.desc-content a{color:#007acc;text-decoration:none;font-weight:500}.desc-content a:hover{text-decoration:underline}.perm-public{color:#2ea043;background:#dafbe1;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:500}.perm-private{color:#6c757d;background:#f0f0f0;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:500}.perm-password{color:#fa5a05;background:#fff4e6;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:500}.perm-whitelist{color:#007acc;background:#e6f0fa;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:500}.perm-blacklist{color:#cf222e;background:#ffebe9;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:500}.ab{padding:8px 16px;border:1px solid #dbeaff;border-radius:6px;background:#fff;color:#007acc;cursor:pointer;font-size:13px;margin:4px;transition:all 0.2s;font-weight:500}.ab:hover{background:#007acc;color:#fff;transform:scale(1.05)}.ab.edit:hover{background:#0366d6}.ab.danger{background:#fff;color:#cf222e;border-color:#cf222e}.ab.danger:hover{background:#cf222e;color:#fff}h3{color:#007acc;font-weight:600;margin-bottom:10px;font-size:16px}</style><div class="c"><h2>'+esc(set.title||'\u9898\u5355')+'</h2><div class="meta">'+userLinkHtml(set.owner||'', set.ownerId||'', set.ownerSolvedCount||0, undefined, true)+' \u00B7 <span class="'+permClass+'">'+permLabel+'</span></div>'+(descHtml?'<div class="desc-box"><div class="desc-content">'+descHtml+'</div></div>':'')+progressBar+'</div><div class="c"><h3>\u9898\u76EE\u5217\u8868 ('+totalCount+')</h3>'+ph+'</div>'+ownerButtons+
    '<script>var v=(window.vscodeApi||acquireVsCodeApi());function vm(m){v.postMessage(m)}document.querySelectorAll(".pc").forEach(function(e){e.addEventListener("click",function(ev){if(ev.target.closest(".user-link")){ev.stopPropagation();return}v.postMessage({command:"openProblem",id:e.dataset.id,url:e.dataset.url})})});document.getElementById("btnEditSet")&&(document.getElementById("btnEditSet").onclick=function(){vm({command:"editProblemSet",id:'+JSON.stringify(set.id)+',title:'+JSON.stringify(set.title)+',owner:'+JSON.stringify(set.owner)+'})});document.getElementById("btnDeleteSet")&&(document.getElementById("btnDeleteSet").onclick=function(){vm({command:"deleteProblemSet",id:'+JSON.stringify(set.id)+',psid:'+JSON.stringify(set.id)+'})});</script>', b);
}

// User search with autocomplete
function getUserSearchWebview(keyword,results,_b){
  var resultsHtml='';
  if(results&&results.length>0){
    results.forEach(function(u){
      resultsHtml+='<div class="user-item" onclick="vm({command:\'openUserProfile\',uid:'+JSON.stringify(u.id)+',username:'+JSON.stringify(u.username)+'})"><span class="uname">'+userLinkHtml(u.username, u.id||'', u.solvedCount!==undefined?u.solvedCount:(u.solved!==undefined?u.solved:-1))+'</span><span class="unick">'+esc(String(u.nickname||''))+'</span></div>';
    });
  }else if(keyword){
    resultsHtml='<div style="text-align:center;padding:30px;color:#888">\u672A\u627E\u5230\u5339\u914D\u7528\u6237</div>';
  }
  return wrapWithMathJax('\u7528\u6237\u641C\u7D22',
    '<style>body{font-family:system-ui,sans-serif;background:#f7f9fb;padding:16px;color:#333;font-size:13px}h2{font-size:17px;margin:0 0 10px}.search-box{display:flex;gap:6px;margin-bottom:10px}.search-box input{flex:1;padding:6px 10px;border:1px solid #dbeaff;border-radius:6px;font-size:13px}.user-item{background:#fff;padding:8px 12px;border-radius:6px;margin:3px 0;cursor:pointer;border:1px solid #eee}.user-item:hover{background:#e6f0fa}.uname{font-weight:600;font-size:13px}.unick{font-size:11px;color:#888;margin-left:6px}.suggestions{border:1px solid #dbeaff;border-radius:6px;background:#fff;max-height:200px;overflow-y:auto;margin-top:2px}.sug-item{padding:8px 10px;cursor:pointer;border-bottom:1px solid #f0f0f0;font-size:13px}.sug-item:hover{background:#e6f0fa}.fb{padding:6px 14px;background:#007acc;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;margin:2px}</style><h2>\u7528\u6237\u641C\u7D22</h2><div class="search-box"><input type="text" id="keyword" placeholder="\u8F93\u5165\u7528\u6237\u540D\u641C\u7D22..." value="'+esc(keyword||'')+'" autocomplete="off"><button id="btnSearch" class="fb">\u641C\u7D22</button></div><div id="suggestions" class="suggestions"></div><div id="results">'+resultsHtml+'</div>'+
    '<script>var v=window.vscodeApi||acquireVsCodeApi();var kw=document.getElementById("keyword");function vm(m){v.postMessage(m)};var debounceTimer=null;kw.oninput=function(){clearTimeout(debounceTimer);debounceTimer=setTimeout(function(){var val=kw.value.trim();if(val.length>=1){v.postMessage({command:"autocomplete",keyword:val})}else{document.getElementById("suggestions").innerHTML=""}},300)};kw.onkeypress=function(e){if(e.key==="Enter"){document.getElementById("btnSearch").click()}};document.getElementById("btnSearch").onclick=function(){var val=kw.value.trim();if(val)v.postMessage({command:"search",keyword:val})}</script>', _b);
}

function getUserDetailWebview(data) {
  var solvedListHtml = '';
  if (data.solved_problems && data.solved_problems.length > 0) {
    data.solved_problems.forEach(function(p) {
      solvedListHtml += '<a href="' + esc(data.uid) + '/problem/' + esc(p.id) + '" class="solved-pid">' + esc(p.id) + '</a> ';
    });
  }
  
  var LV_COLORS = ['#8CE600','#A6E600','#BFE600','#D9E600','#E6D900','#E6BF00','#E6A600','#E68C00','#CC0000','#0073E6'];
  var LV_LABELS = ['Lv.1','Lv.2','Lv.3','Lv.4','Lv.5','Lv.6','Lv.7','Lv.8','Lv.9','Lv.10'];
  var rows = [];
  if (data.activityData && data.activityData.length) {
    for (var ai = 0; ai < data.activityData.length; ai++) {
      var rr = data.activityData[ai];
      if (!rr) continue;
      var dk = rr.period || rr.date || rr.day || '';
      if (!dk) continue;
      var nr = {period:dk, total:0};
      for (var lv = 1; lv <= 10; lv++) {
        var vv = 0;
        if (rr[String(lv)] !== undefined && rr[String(lv)] !== null) vv = parseInt(rr[String(lv)]) || 0;
        nr['lv'+lv] = vv; nr.total += vv;
      }
      if (nr.total <= 0 && rr.total !== undefined) nr.total = parseInt(rr.total) || 0;
      if (nr.total > 0) rows.push(nr);
    }
    rows.sort(function(a,b){ return a.period < b.period ? -1 : 1; });
  }
  var actChartHtml = '';
  if (rows.length > 0) {
    var aW = 720, aH = 240;
    var aL = 48, aR = 18, aT = 18, aB = 38;
    var pW = aW - aL - aR, pH = aH - aT - aB, aN = rows.length;
    var ymax = 0;
    for (var ai = 0; ai < aN; ai++) if ((rows[ai].total||0) > ymax) ymax = rows[ai].total;
    if (ymax <= 0) ymax = 1;
    var niceSteps = [1,2,5,10,20,50,100,200,500,1000], nMax = niceSteps[niceSteps.length-1];
    for (var ni = 0; ni < niceSteps.length; ni++) if (niceSteps[ni] >= ymax) { nMax = niceSteps[ni]; break; }
    if (ymax > nMax) nMax = Math.ceil(ymax/50)*50;
    ymax = nMax;
    function xAtI(ii){return aL+(aN===1?pW/2:(ii/(aN-1))*pW);}
    function yAtV(vv){return aT+pH-(Math.min(vv,ymax)/ymax)*pH;}
    var gr='';
    for (var yi=0;yi<=4;yi++){var yy=aT+(yi/4)*pH;var vv=Math.round(ymax-(yi/4)*ymax);gr+='<line x1="'+aL+'" x2="'+(aW-aR)+'" y1="'+yy+'" y2="'+yy+'" stroke="#d0d7de" stroke-width="1" stroke-dasharray="2,3"/><text x="'+(aL-8)+'" y="'+(yy+4)+'" text-anchor="end" fill="#6e7781" font-size="10" font-family="sans-serif">'+vv+'</text>';}
    var xl='';var lmm=-1,lyy=-1;
    for (var ai=0;ai<aN;ai++){var mmm=/^(\d{4})\-(\d{2})/.exec(rows[ai].period);if(!mmm)continue;var ayy=parseInt(mmm[1]),amm=parseInt(mmm[2]);if(amm!==lmm||ayy!==lyy){lmm=amm;lyy=ayy;var xxp=xAtI(ai);xl+='<line x1="'+xxp+'" x2="'+xxp+'" y1="'+(aT+pH)+'" y2="'+(aT+pH+4)+'" stroke="#8b949e" stroke-width="1"/><text x="'+xxp+'" y="'+(aT+pH+16)+'" text-anchor="middle" fill="#6e7781" font-size="11" font-family="sans-serif">'+ayy+'/'+amm+'</text>';}}
    var cum=new Array(aN);for(var i=0;i<aN;i++)cum[i]=0;
    var layerSvg='';
    for(var lv=1;lv<=10;lv++){
      var areaD='';
      for(var i=0;i<aN;i++){
        var xx=xAtI(i);var cur=cum[i]+(rows[i]['lv'+lv]||0);var yy=yAtV(cur);
        if(i===0){areaD='M'+aL+','+yAtV(0)+' L'+xx+','+yy;}else{areaD+=' L'+xx+','+yy;}
      }
      areaD+=' L'+xAtI(aN-1)+','+(aT+pH)+' L'+aL+','+(aT+pH)+' Z';
      var lineD='';
      for(var i=0;i<aN;i++){
        var xx=xAtI(i);var cur=cum[i]+(rows[i]['lv'+lv]||0);var yy=yAtV(cur);
        lineD+=(i===0?'M':'L')+xx+','+yy+' ';
      }
      layerSvg='<path d="'+areaD+'" fill="'+LV_COLORS[lv-1]+'" fill-opacity="0.9" stroke="none"/>'+layerSvg;
      layerSvg+='<path d="'+lineD+'" fill="none" stroke="'+LV_COLORS[lv-1]+'" stroke-width="1.2" stroke-linejoin="round"/>';
      for(var i=0;i<aN;i++)cum[i]+=(rows[i]['lv'+lv]||0);
    }
    var hov='';
    for (var ai=0;ai<aN;ai++){var xxp=xAtI(ai);var xpr=ai===0?aL:(xxp+xAtI(ai-1))/2;var xne=ai===aN-1?(aW-aR):(xxp+xAtI(ai+1))/2;var ww=Math.max(1,xne-xpr);var tp=rows[ai].period+'&#10;总计: '+(rows[ai].total||0);for(var lv=1;lv<=10;lv++){tp+='&#10;Lv.'+lv+': '+(rows[ai]['lv'+lv]||0);}hov+='<rect x="'+xpr+'" y="'+aT+'" width="'+ww+'" height="'+pH+'" fill="transparent"><title>'+esc(tp)+'</title></rect>';}
    var legend = '<div class="heatmap-legend" style="flex-wrap:wrap;gap:6px">';
    for(var lv=10;lv>=1;lv--){legend+='<span style="font-size:11px;color:#666;margin:0 2px"><span class="hm-cell" style="width:14px;height:8px;background:'+LV_COLORS[lv-1]+';margin-right:4px"></span>'+LV_LABELS[lv-1]+'</span>';}
    legend+='</div>';
    actChartHtml =
      '<div style="overflow-x:auto;margin-top:10px"><svg viewBox="0 0 '+aW+' '+aH+'" width="100%" style="min-width:500px;display:block" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">'+
         gr+xl+layerSvg+hov+
         '<line x1="'+aL+'" x2="'+(aW-aR)+'" y1="'+(aT+pH)+'" y2="'+(aT+pH)+'" stroke="#8b949e" stroke-width="1"/>'+
      '</svg></div>'+legend;
  } else {
    actChartHtml = '<div style="padding:14px;color:#888;text-align:center">暂无活动数据</div>';
  }
  var activityCardHtml = '<div class="c"><h2 style="font-size:14px;margin-bottom:8px">活动统计（YZOJ 原生 Morris.Area · 按难度分层）</h2>' + actChartHtml + '</div>';

  return wrapWithMathJax(esc(data.username || data.uid || 'User'),
    '<style>body{font-family:system-ui,sans-serif;background:#f7f9fb;padding:16px;color:#333}.c{background:#fff;border-radius:10px;padding:16px;margin-bottom:12px;box-shadow:0 1px 4px rgba(0,0,0,0.08)}h2{font-size:17px;margin:0}.sub{font-size:12px;color:#888;margin:4px 0}.gi{display:inline-block;width:45%;margin:3px 2%;vertical-align:top}.gl{color:#666;font-size:11px;display:block}.gv{font-weight:600;font-size:13px}.hm-cell{width:13px;height:13px;border-radius:3px;margin:1px;display:inline-block;cursor:pointer}.solved-container{font-size:12px;line-height:1.8;word-break:break-all}.solved-pid{display:inline-block;padding:1px 4px;margin:1px;background:#e6f0fa;color:#007acc;border-radius:3px;font-size:11px;font-family:monospace;text-decoration:none}.solved-pid:hover{background:#007acc;color:#fff}</style>' +
    '<div class="c"><h2>' + esc(data.username || 'User #' + data.uid) + '</h2></div>' +
    '<div class="c"><div class="gi"><span class="gl">真实姓名</span><span class="gv">' + esc(data.realname || '-') + '</span></div>' +
    '<div class="gi"><span class="gl">学校</span><span class="gv">' + esc(data.school || '-') + '</span></div>' +
    '<div class="gi"><span class="gl">Email</span><span class="gv">' + esc(data.email || '-') + '</span></div>' +
    '<div class="gi"><span class="gl">UID</span><span class="gv">' + esc(data.uid) + '</span></div>' +
    '<div class="gi"><span class="gl">等级</span><span class="gv">' + esc(data.level || '-') + '</span></div>' +
    '<div class="gi"><span class="gl">解决题数</span><span class="gv">' + esc(data.solved_count || 0) + '</span></div>' +
    '<div class="gi"><span class="gl">提交次数</span><span class="gv">' + esc(data.submission_count || 0) + '</span></div></div>' +
    activityCardHtml +
    '<div class="c"><h2 style="font-size:14px;margin-bottom:8px">已解决问题 (' + (data.solved_problems ? data.solved_problems.length : 0) + ')</h2><div class="solved-container">' + (solvedListHtml || '<span style="color:#888">暂无</span>') + '</div></div>');
}

module.exports = {
  getHomepageWebview: getHomepageWebview,
  getContestWebviewContent: getContestWebviewContent,
  getContestDetailWebview: getContestDetailWebview,
  getProblemDetailWebview: getProblemDetailWebview,
  getStatusDetailWebview: getStatusDetailWebview,
  getStatusListWebview: getStatusListWebview,
  getProblemListWebview: getProblemListWebview,
  getSolutionsWebview: getSolutionsWebview,
  getProblemStatusWebview: getProblemStatusWebview,
  getSolutionDetailWebview: getSolutionDetailWebview,
  getDiscussionListWebview: getDiscussionListWebview,
  getDiscussionDetailWebview: getDiscussionDetailWebview,
  getFullDiscussionListWebview: getFullDiscussionListWebview,
  getUserWebview: getUserWebview,
  getUserDetailWebview: getUserDetailWebview,
  getMarkdownEditorWebview: getMarkdownEditorWebview,
  getContestResultWebview: getContestResultWebview,
  getContestStatusWebview: getContestStatusWebview,
  getProblemSetListWebview: getProblemSetListWebview,
  getProblemSetDetailWebview: getProblemSetDetailWebview,
  getProblemSetEditorWebview: getProblemSetEditorWebview,
  getRanklistWebview: getRanklistWebview,
  getUserSearchWebview: getUserSearchWebview
};
