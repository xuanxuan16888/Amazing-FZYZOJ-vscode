// parse.js - HTML parsers
var logger = require('./logger');
var ac = require('./ac');
var ea=String.fromCharCode(38,97,109,112,59);
var el=String.fromCharCode(38,108,116,59);
var eg=String.fromCharCode(38,103,116,59);
var eq=String.fromCharCode(38,113,117,111,116,59);
var ep=String.fromCharCode(38,35,48,51,57,59);
function esc(t){if(!t)return '';return String(t).replace(/&/g,ea).replace(/</g,el).replace(/>/g,eg).replace(/"/g,eq).replace(/'/g,ep);}
function cln(t){return String(t||'').replace(/\xa0/g,' ').replace(/&nbsp;/gi,' ').replace(/\s+/g,' ').trim();}
function extractPagination($){var p=$('#pagelist').last();if(!p.length)return{currentPage:1,totalPages:1,hasMore:false};var cp=1;p.contents().each(function(i,e){if(e.type==='text'){var m=$(e).text().match(/^\d+$/);if(m&&!$(e).parent('a').length){cp=parseInt(m[0]);return false}}});var l=p.find('a[href*="page="]');var tp=cp;l.each(function(i,a){var pg=parseInt($(a).text());if(pg>tp)tp=pg});return{currentPage:cp,totalPages:tp,hasMore:cp<tp};}
// 从 <a href="user_show.php?id=X"><span style="color:#HEX"> 中提取颜色（支持嵌套 span）
function extractUserColorFromLink($link){
  if(!$link||!$link.length)return '';
  // 遍历所有后代 span，找到第一个有意义（非黑色/白色/灰色）的颜色
  var $spans=$link.find('span');
  var fallback='';
  for(var i=0;i<$spans.length;i++){
    var style=$spans.eq(i).attr('style')||'';
    var m=style.match(/color\s*:\s*([^;!"'`<>]+)/i);
    if(m){
      var c=m[1].trim();
      // 跳过纯装饰性的 black/white/gray
      if(/^#(000000|FFFFFF|FFF|000|888|999|AAA|BBB|CCC|DDD|EEE)$/i.test(c)||/^(black|white|gray|grey|silver)$/i.test(c)){
        if(!fallback)fallback=c;
        continue;
      }
      return c;
    }
  }
  return fallback;
}
function parseHomepage(html,b){var $=require('cheerio').load(html);var d={announcements:[],discussions:[],contests:[],mainContent:'',stats:{}};var contentDiv=$('#content');if(!contentDiv.length)contentDiv=$('body');var contentClone=contentDiv.clone();contentClone.find('script,style,#pagelist,#jumpbox,div[style*="text-align:right"],a[href*="logout"],a[href*="user_show"],a[href*="admin"]').remove();d.mainContent=contentClone.html()||'';d.mainText=contentClone.text().replace(/\s+/g,' ').trim();$('h3').each(function(){var t=$(this).text();if(t.includes('公告')||t.includes('Announce')){$(this).nextUntil('h3').find('a').each(function(){var h=$(this).attr('href')||'';d.announcements.push({text:$(this).text(),url:h.startsWith('http')?h:b+'/OnlineJudge/'+h})})}});$('#tablelist').each(function(){var h=$(this).find('th').first().text();if(!h.includes('讨论')&&!h.includes('Topic'))return;$(this).find('tr').each(function(){var tds=$(this).find('td');if(tds.length<2)return;var l=tds.eq(1).find('a').first();if(l.length){var h=l.attr('href')||'';d.discussions.push({title:l.text(),url:h?b+'/OnlineJudge/'+h:'',author:tds.find('a[href*="user_show"]').first().text(),time:tds.last().text()})}})});$('a[href*="contest_show.php"]').each(function(){var h=$(this).attr('href')||'',m=h.match(/id=(\d+)/);if(m)d.contests.push({id:m[1],title:$(this).text(),url:b+'/OnlineJudge/'+h})});var m=$('body').text().match(/在线.*?(\d+)/);if(m)d.stats.onlineUsers=m[1];return d;}
function parseScheduledContests(html,b){var $=require('cheerio').load(html);var c=[];$('#tablelist tbody tr').each(function(){var t=$(this).find('td');if(t.length!==4)return;var id=t.eq(0).text().trim().replace(/[^\d-]/g,'');var nl=t.eq(1).find('a');var name=nl.text();var pt=null;var an=nl.next();if(an.length){var m=an.text().match(/\(\d+\.?\d*\s*级权限\)/);if(m)pt=m[0];}c.push({id:id,name:name,permissionTag:pt,time:t.eq(2).text(),status:t.eq(3).text(),url:nl.attr('href')?b+'/OnlineJudge/'+nl.attr('href'):'',isHidden:id==='-1'||name.includes('隐藏'),type:'scheduled'});});return{contests:c,...extractPagination($)};}
function parseActiveContests(html,b){var $=require('cheerio').load(html);var c=[];$('#tablelist tbody tr').each(function(){var t=$(this).find('td');if(t.length!==4)return;var id=t.eq(0).text().trim().replace(/[^\d-]/g,'');var nl=t.eq(1).find('a');var name=nl.text();var pt=null;if(!name.includes('隐藏')){c.push({id:id,name:name,permissionTag:pt,time:t.eq(2).text(),status:t.eq(3).text(),url:nl.attr('href')?b+'/OnlineJudge/'+nl.attr('href'):'',isHidden:false,type:'active'})}});return{contests:c,...extractPagination($)};}
function parsePastContests(html,b){var $=require('cheerio').load(html);var c=[];$('#tablelist tbody tr').each(function(){var t=$(this).find('td');if(t.length!==4)return;var id=t.eq(0).text().trim().replace(/[^\d-]/g,'');var nl=t.eq(1).find('a');var name=nl.text();var pt=null;if(!name.includes('隐藏')){c.push({id:id,name:name,permissionTag:pt,time:t.eq(2).text(),status:t.eq(3).text(),url:nl.attr('href')?b+'/OnlineJudge/'+nl.attr('href'):'',isHidden:false,type:'past'})}});return{contests:c,...extractPagination($)};}
function parseContestDetail(html,b){var $=require('cheerio').load(html);var raw=$('h2').first().text();var title=raw.replace(/^T\d+\s*[-–—]\s*/,'');var permission=$('p center').first().text()||null;var info={};var infoTable=$('table[style*="600px"]').first();infoTable.find('td').each(function(){var t=$(this);var l=t.contents().filter(function(){return this.nodeType===3}).first().text().replace(/[：:]/g,'');var f=t.find('font');var a=t.find('a');var v='';if(f.length)v=f.text();else if(a.length){var names=[];a.each(function(){names.push($(this).text());});v=names.join('\u3001');}else v=t.text().replace(l,'').replace(/[：:]/g,'');if(l&&v)info[l]=v;});var desc='';var tablelist=$('#tablelist');if(tablelist.length){var prev=tablelist.prevAll('div').filter(function(){var st=$(this).attr('style')||'';return st.indexOf('text-align')>=0||st.indexOf('center')>=0;}).first();if(prev.length){var tmp=prev.html()||'';tmp=tmp.replace(/<script[\s\S]*?<\/script>/gi,'').replace(/<style[\s\S]*?<\/style>/gi,'').replace(/>\s+</g,'><').replace(/<br\s*\/?>\s*/gi,'<br>').replace(/(<br>)+/gi,'<br>').trim();if(tmp&&tmp.length>20&&tmp.indexOf('用户信息')<0&&tmp.indexOf('Lv.')<0&&tmp.indexOf('我')<0&&tmp.indexOf('退出')<0&&tmp.indexOf('比赛结果')<0&&tmp.indexOf('评测状态')<0&&tmp.indexOf('排行榜')<0)desc=tmp;}}if(!desc&&tablelist.length){var allDivs=$('div[style*="text-align"]');var tblIdx=allDivs.index(tablelist);if(tblIdx>0){for(var i=tblIdx-1;i>=0;i--){var d=$(allDivs[i]);var rawHtml=d.html()||'';rawHtml=rawHtml.replace(/<script[\s\S]*?<\/script>/gi,'').replace(/<style[\s\S]*?<\/style>/gi,'').replace(/>\s+</g,'><').replace(/<br\s*\/?>\s*/gi,'<br>').replace(/(<br>)+/gi,'<br>').trim();if(rawHtml&&rawHtml.length>30&&rawHtml.indexOf('Lv.')<0&&rawHtml.indexOf('用户信息')<0&&rawHtml.indexOf('我')<0&&rawHtml.indexOf('出题人')<0&&rawHtml.indexOf('退出')<0&&rawHtml.indexOf('比赛结果')<0&&rawHtml.indexOf('评测状态')<0&&rawHtml.indexOf('排行榜')<0){desc=rawHtml;break;}}}}if(!desc){var cnt=$('#content');if(cnt.length){cnt.find('div[style*="text-align"],div[style*="center"]').each(function(){var rh=$(this).html()||'';rh=rh.replace(/<script[\s\S]*?<\/script>/gi,'').replace(/<style[\s\S]*?<\/style>/gi,'').replace(/>\s+</g,'><').replace(/<br\s*\/?>\s*/gi,'<br>').replace(/(<br>)+/gi,'<br>').trim();if(rh&&rh.length>10&&rh.indexOf('Lv.')<0&&rh.indexOf('用户信息')<0&&rh.indexOf('我')<0&&rh.indexOf('出题人')<0&&rh.indexOf('退出')<0&&rh.indexOf('比赛结果')<0&&rh.indexOf('评测状态')<0&&rh.indexOf('排行榜')<0){desc=rh;return false;}});}}var problems=[];$('#tablelist tbody tr').each(function(){var t=$(this).find('td');if(t.length<3)return;var it=t.eq(0).text();var pidMatch1=it.match(/\((\d+)\)/);var pid=pidMatch1?pidMatch1[1]||'':'';var nl=t.eq(1).find('a');var name=nl.text();var href=nl.attr('href')||'';var sc=t.eq(2);var scoreA=sc.find('a').first();var scoreHref=scoreA.attr('href')||'';var statusId='';var statusUrl='';if(scoreHref){var m=scoreHref.match(/status_details\.php\?[^#?&]*id=(\d+)/);if(m&&m[1])statusId=m[1];else{var m2=scoreHref.match(/[?&]id=(\d+)/);if(m2&&m2[1]&&/status\.php|submit\.php|source_show\.php|status_details\.php/i.test(scoreHref))statusId=m2[1];}statusUrl=scoreHref.startsWith('http')?scoreHref:(b+'/OnlineJudge/'+scoreHref.replace(/^\/+/,''));}var rawScoreText=cln(sc.text());var digitOnly=rawScoreText.replace(/[^\d\-]/g,'');var onlyDigits=digitOnly.length>0&&/^[\-\d]+$/.test(digitOnly);var isSubmittedOnly=false;if(!onlyDigits&&/已提交|Submitted|已递交|submitted|已提交答案|Done/i.test(rawScoreText)){isSubmittedOnly=true;}if(!statusId&&!isSubmittedOnly&&rawScoreText&&/^[^\d]*(\d+)[^\d]*$/.test(rawScoreText)){var mSide=rawScoreText.match(/[^\d]*(\d+)[^\d]*/);if(mSide){digitOnly=mSide[1];onlyDigits=true;}}var scHtml=sc.html()||'';var scoreColor='';var scColorMatch=scHtml.match(/color\s*:\s*([^;"'}]+)/i);if(scColorMatch)scoreColor=scColorMatch[1].trim();var orderMatch1=it.match(/#(\d+)/);var mark=it.indexOf('\u2713')>=0?'ac':'';var markA=t.eq(0).find('a').first();var markUrl='';if(markA.length){var mh=markA.attr('href')||'';if(mh)markUrl=mh.indexOf('http')===0?mh:(b+'/OnlineJudge/'+mh.replace(/^\/+/,''));}problems.push({order:orderMatch1?orderMatch1[1]||'':'',problemId:pid,name:name,url:href?b+'/OnlineJudge/'+href:'',score:onlyDigits?digitOnly:(rawScoreText||'-'),scoreColor:scoreColor,statusId:statusId,statusUrl:statusUrl,markUrl:markUrl,isSubmittedOnly:isSubmittedOnly,mark:mark});});var links=[];$('a[href*="contest_result.php"]').each(function(){var t=$(this).text(),h=$(this).attr('href');if(t&&h)links.push({text:t,url:b+'/OnlineJudge/'+h,type:'result'});});$('a[href*="status.php?tid="]').each(function(){var t=$(this).text(),h=$(this).attr('href');if(t&&h)links.push({text:t,url:b+'/OnlineJudge/'+h,type:'status'});});$('a[href*="status.php?test="]').each(function(){var t=$(this).text(),h=$(this).attr('href');if(t&&h)links.push({text:t,url:b+'/OnlineJudge/'+h,type:'contestStatus'});});$('a[href*="contest_rank.php"]').each(function(){var t=$(this).text(),h=$(this).attr('href');if(t&&h)links.push({text:t,url:b+'/OnlineJudge/'+h,type:'rank'});});$('a[href*="problem_status.php"]').each(function(){var t=$(this).text(),h=$(this).attr('href');if(t&&h)links.push({text:t,url:b+'/OnlineJudge/'+h,type:'probStatus'});});
// 🔑 新增：判断比赛是否支持排行榜 / 评测状态（与 getContestInfo 逻辑保持一致，双保险：提示文字 + 实际链接存在）
var supportsRank=false,supportsStatus=false;
// eslint-disable-next-line no-unused-vars
try{var permTexts=[];$('p center, p, #content, body').each(function(_,el){var tt=$(el).text()||'';if(tt.includes('允许查看')||tt.includes('排行榜')||tt.includes('评测状态')||tt.includes('比赛过程中'))permTexts.push(tt);});var pAll=permTexts.join('\n');if(/允许查看排行榜|支持查看排行榜|查看排行榜/.test(pAll))supportsRank=true;if(/允许查看评测状态|支持查看评测状态|查看评测状态/.test(pAll))supportsStatus=true;}catch(_e){}
// 实际存在的链接（更权威）
if(links.some(function(l){return l.type==='result'||l.type==='rank';}))supportsRank=true;
if(links.some(function(l){return l.type==='status'||l.type==='contestStatus';}))supportsStatus=true;
// 🔑 严格按能力过滤 links：不支持的链接即使存在也不显示（防止旧比赛配置错乱）
var filteredLinks=links.filter(function(l){
  if(l.type==='result'||l.type==='rank')return supportsRank;
  if(l.type==='status'||l.type==='contestStatus')return supportsStatus;
  return true; // problem_status 等其他链接不过滤
});
links=filteredLinks;
// 解析出题人列表（带 userId + color）
var authors=[],authorIds=[],authorColors=[],authorHtmls=[];$('table[style*="600px"]').find('td').each(function(){var t=$(this);var label=t.contents().filter(function(){return this.nodeType===3}).first().text().replace(/[：:]/g,'');if(label.includes('出题人')||label.includes('命题人')){t.find('a[href*="user_show"]').each(function(){var n=$(this).text();var href=$(this).attr('href')||'';var uidMatch=href.match(/id=(\d+)/);var uid=uidMatch?uidMatch[1]:'';var col=extractUserColorFromLink($(this));var innerHtml=$(this).html();if(n){authors.push(n);authorIds.push(uid);authorColors.push(col);authorHtmls.push(innerHtml||n);}});return false;}});
// 如果上面没找到，退而求其次：在 info 里拆字符串（没有 userId，但至少有用户名，fallback）
if(authors.length===0&&info['出题人']){var parts=String(info['出题人']).split(/[\u3001、,，;；]/).filter(Boolean);parts.forEach(function(p){var x=p.trim();if(x&&x.length<=20){authors.push(x);authorIds.push('');authorColors.push('');}});}
return{title:title,permission:permission,info:info,description:desc,problems:problems,links:links,authors:authors,authorIds:authorIds,authorColors:authorColors,authorHtmls:authorHtmls,supportsRank:supportsRank,supportsStatus:supportsStatus};}
function parseContestResult(html,b){
  var $=require('cheerio').load(html);
  var records=[];
  var problemIds=[];
  var problemUrls=[]; // 对应每列题目的完整跳转URL（优先使用）
  var problemHeadersHtml=[]; // 对应每列题目的原始HTML（保留颜色等样式）
  var resultTable=null;
  var headerThs=null;
  var colIdx={rank:-1,username:-1,realname:-1,score:-1,probs:[]};
  var numProbCols=0;
  $('#tablelist').each(function(){
    var thRow=$(this).find('tr').first();
    if(!thRow.length)return true;
    var ths=thRow.find('th');
    if(ths.length<4)return true;
    var thTexts=[];
    ths.each(function(){thTexts.push($(this).text().trim().replace(/\s+/g,' '));});
    var hasScore=false,hasProb=false;
    thTexts.forEach(function(t){
      if(t.includes('总分'))hasScore=true;
      if(t.match(/^#\d+$/))hasProb=true;
    });
    if(hasScore||hasProb){
      resultTable=$(this);
      headerThs=ths;
      ths.each(function(i){
        var txt=$(this).text().trim().replace(/\s+/g,' ');
        if(txt==='#'||txt.includes('排名'))colIdx.rank=i;
        if(txt.includes('用户')||txt.includes('名')){if(colIdx.username===-1)colIdx.username=i;else colIdx.realname=i;}
        if(txt.includes('姓名'))colIdx.realname=i;
        if(txt.includes('总分'))colIdx.score=i;
        if(txt.match(/^#\d+$/))colIdx.probs.push(i);
      });
      if(colIdx.rank===-1)colIdx.rank=0;
      if(colIdx.username===-1)colIdx.username=1;
      if(colIdx.score===-1&&colIdx.probs.length>0)colIdx.score=Math.max.apply(null,colIdx.probs)+1;
      numProbCols=colIdx.probs.length;
      for(var hi=0;hi<colIdx.probs.length;hi++){
        var ci=colIdx.probs[hi];
        var th=$(ths[ci]);
        var linkInTh=th.find('a[href*="problem_show.php"],a[href*="contest_problem.php"],a[href*="contest.php"]').first();
        var gotHeader=false;
        // 捕获题目标题原始HTML（保留颜色等样式）
        var headerHtml=linkInTh.length?linkInTh.html()||'':th.text().trim();
        if(linkInTh.length){
          var href=linkInTh.attr('href')||'';
          var absHref=href.startsWith('http')?href:(b?(b.replace(/\/+$/,'')+'/OnlineJudge/'+href.replace(/^\/+/,'')):href);
          var pidM=href.match(/[?&]id=(\d+)/);
          if(pidM){problemIds.push(pidM[1]);problemUrls.push(absHref);gotHeader=true;}
          else{
            // contest_problem.php?cid=xxx&pid=0 or contest.php?cid=xxx#problem_0
            problemIds.push('');
            problemUrls.push(absHref);
            gotHeader=true;
          }
        }
        if(!gotHeader){
          // 比赛结果未在表头附超链接：先留空，后从数据行首个单元格 <a> 中提取
          problemIds.push('');
          problemUrls.push('');
        }
        problemHeadersHtml.push(headerHtml||th.text().trim());
      }
      return false;
    }
  });
  if(!resultTable){
    $('#tablelist').each(function(){
      $(this).find('tr').each(function(){
        var tds=$(this).find('td');if(tds.length<3)return;if($(this).find('th').length)return;
        records.push({rank:tds.eq(0).text().trim(),username:tds.eq(1).text().trim().replace(/\(我\)/g,'').trim(),realname:'',score:tds.eq(2).text().trim().replace(/[^\d-]/g,'')||'0',problems:[],problemLinks:[],problemPids:[]});
      });
    });
    return{records:records,totalPages:1,problemIds:[],problemUrls:[]};
  }

  // ===== 预处理：problemUrls / problemIds 为空的列，从数据行的得分单元格链接补充 =====
  var firstDataRowCells=null;
  resultTable.find('tr').each(function(ri){
    if(ri===0)return;
    var tds=$(this).find('td');
    if(tds.length<3)return;
    if($(this).find('th').length>0)return;
    firstDataRowCells=tds;
    return false;
  });
  if(firstDataRowCells){
    for(var hii=0;hii<colIdx.probs.length;hii++){
      var cci=colIdx.probs[hii];
      if(problemIds[hii]||problemUrls[hii])continue; // 已有
      if(cci>=firstDataRowCells.length)continue;
      var cellTd=firstDataRowCells.eq(cci);
      var cellLink=cellTd.find('a[href*="problem_show.php"],a[href*="contest_problem.php"],a[href*="status.php?cid="],a[href*="problem"]').first();
      if(!cellLink.length)cellLink=cellTd.find('a').first();
      if(cellLink.length){
        var hrefVal=cellLink.attr('href')||'';
        var absHrefVal=hrefVal.startsWith('http')?hrefVal:(b?(b.replace(/\/+$/,'')+'/OnlineJudge/'+hrefVal.replace(/^\/+/,'')):hrefVal);
        // 如果是 problem_show.php?id=xxx，提取 id
        var pm=hrefVal.match(/[?&]id=(\d+)/);
        if(pm&&/problem_show\.php/.test(hrefVal)){
          problemIds[hii]=pm[1];
          problemUrls[hii]=absHrefVal;
        }else{
          // 其他情况：直接用完整URL，problemId 为空也行（后面openProblem用 msg.url）
          problemIds[hii]='';
          problemUrls[hii]=absHrefVal;
        }
      }
    }
  }

  resultTable.find('tr').each(function(ri){
    var tds=$(this).find('td');
    if(tds.length<3)return;
    if($(this).find('th').length>0&&ri===0)return;
    var rank=colIdx.rank>=0&&tds.length>colIdx.rank?tds.eq(colIdx.rank).text().trim():tds.eq(0).text().trim();
    var userColIdx=colIdx.username>=0?colIdx.username:1;
    var userCol=tds.length>userColIdx?tds.eq(userColIdx):tds.eq(1);
    var userLink=userCol.find('a[href*="user_show"]').first();
    var username=(userLink.length?userLink.text().trim():userCol.text().trim()).replace(/\(我\)/g,'').trim();
    var userId='';
    var userColor='';
    var usernameHtml='';
    if(userLink.length){
      var userHref=userLink.attr('href')||'';
      var userIdM=userHref.match(/[?&]id=(\d+)/);
      if(userIdM)userId=userIdM[1];
      userColor=extractUserColorFromLink(userLink);
      usernameHtml=userLink.html()||'';
    }
    var realname='';
    if(colIdx.realname>=0&&tds.length>colIdx.realname){realname=tds.eq(colIdx.realname).text().trim();}
    else{var rn=userCol.clone();rn.find('a').remove();realname=rn.text().replace(/[（(].*[)）]/g,'').trim();}
    if(!realname)realname='';
    var totalScore=0;
    if(colIdx.score>=0&&tds.length>colIdx.score){var ss=tds.eq(colIdx.score).text().trim().replace(/[^\d-]/g,'');totalScore=parseInt(ss)||0;}
    var probs=[];var probLinks=[];var probPids=[];
    for(var i=0;i<numProbCols;i++){
      var ci=colIdx.probs[i];
      if(ci>=tds.length){probs.push('-');probLinks.push('');probPids.push('');continue;}
      var td=tds.eq(ci);
      var rawText=td.text().trim();
      var scoreText=rawText.replace(/[^\d-]/g,'');
      var sid='';
      var cellLink=td.find('a').first();
      var cellPid='';
      var cellHref='';
      if(cellLink.length){
        cellHref=cellLink.attr('href')||'';
        var sidM=cellHref.match(/[?&]id=(\d+)/);
        if(sidM){
          // 如果是 status.php 的链接那就是提交记录sid；如果是 problem_show.php 的链接那就是 pid
          if(/status\.php|submit\.php|source_show\.php|status_detail\.php/i.test(cellHref)){
            sid=sidM[1];
          }else if(/problem_show\.php|contest_problem\.php/i.test(cellHref)){
            cellPid=sidM[1]; // problem id
          }else{
            sid=sidM[1]; // 默认按sid处理
          }
        }
      }
      if(!sid&&!cellPid){
        var a2=td.find('font a[href*="id="]').first();
        if(!a2.length)a2=td.find('a[href*="id="]').first();
        if(a2.length){
          var hr=a2.attr('href')||'';
          var sm=hr.match(/[?&]id=(\d+)/);
          if(sm){
            if(/status\.php|source_show\.php|status_detail\.php/i.test(hr))sid=sm[1];
            else if(/problem_show\.php|contest_problem\.php/i.test(hr))cellPid=sm[1];
            else sid=sm[1];
          }
        }
      }
      // 如果表头没有problem url，这里从单元格再次补充
      if(!problemIds[i]&&cellPid)problemIds[i]=cellPid;
      if(!problemUrls[i]&&cellHref&&/problem_show\.php|contest_problem\.php/i.test(cellHref)){
        problemUrls[i]=cellHref.startsWith('http')?cellHref:(b?(b.replace(/\/+$/,'')+'/OnlineJudge/'+cellHref.replace(/^\/+/,'')):cellHref);
      }
      // per-row problemPids fallback: 先用单元格链接中提取到的 pid，再用表头对应列的 problemId
      var finalPid=cellPid||problemIds[i]||'';
      probs.push(scoreText||rawText||'-');probLinks.push(sid);probPids.push(finalPid);
    }
    if(rank||username)records.push({rank:rank,username:username,userId:userId,realname:realname,score:String(totalScore),problems:probs,problemLinks:probLinks,problemPids:probPids,color:userColor,usernameHtml:usernameHtml});
  });
  var tp=1;
  $('#pagelist a[href*="page="]').each(function(){
    var m=$(this).attr('href').match(/page=(\d+)/);if(m){var p=parseInt(m[1]);if(p>tp)tp=p;}
  });
  return{records:records,totalPages:tp,problemIds:problemIds,problemUrls:problemUrls,problemHeadersHtml:problemHeadersHtml};
}

function parsePracticeProblem(html,b){
  var $=require('cheerio').load(html);
  var h2=$('h2').first();
  var h2c=h2.clone();
  h2c.find('strong').remove();
  h2c.find('font').remove();
  var clean=cln(h2c.text());
  var tm=clean.match(/^P(\d+)\s*--\s*(.+)$/);
  var pid='',title=clean;
  if(tm){
    pid=tm[1];
    title=tm[2];
  }else{
    var ctm=clean.match(/^#(\d+)\.\s*(?:\[[^\]]+\])?\s*(.+)$/);
    if(ctm){title=ctm[2];}
    else{var stm=clean.match(/^#(\d+)\.\s*(.+)$/);if(stm)title=stm[2];}
  }
  title=cln(title);
  var st=h2.find('strong').first();
  var diff=st?parseFloat(st.text())||null:null;
  var meta={};
  var mp=$('p[style*="font-size: 12px"]').first().text()||'';
  var _tlMatch = mp.match(/<timelimit>([^<]+)<\/timelimit>/);
  meta.timeLimit = (_tlMatch && _tlMatch[1]) ? _tlMatch[1].trim() : null;
  var _mlMatch = mp.match(/<memorylimit>([^<]+)<\/memorylimit>/);
  meta.memoryLimit = (_mlMatch && _mlMatch[1]) ? _mlMatch[1].trim() : null;
  function formatTime(ms){
    if(ms>=1000){
      var s=ms/1000;
      return (s%1===0?s:s.toFixed(1))+'s';
    }
    return ms+'ms';
  }
  function formatMemory(kb){
    if(kb>=1024*1024){
      var gb=kb/(1024*1024);
      return (gb%1===0?gb:gb.toFixed(2))+'GB';
    }
    if(kb>=1024){
      var mb=kb/1024;
      return (mb%1===0?mb:mb.toFixed(1))+'MB';
    }
    return kb+'KB';
  }
  if(!meta.timeLimit){
    var tm=mp.match(/时间限制[:：]\s*(\d+)\s*(MS|ms|秒|s|S)/i);
    if(tm){
      var val=parseInt(tm[1]);
      var unit=tm[2].toLowerCase();
      if(unit==='ms'||unit==='ms')meta.timeLimit=formatTime(val);
      else meta.timeLimit=val+'s';
    }
  }else{
    var tlm=meta.timeLimit.match(/(\d+)\s*(MS|ms|s|秒)/i);
    if(tlm){
      var tv=parseInt(tlm[1]),tu=tlm[2].toLowerCase();
      if(tu==='ms'||tu==='ms')meta.timeLimit=formatTime(tv);
      else meta.timeLimit=tv+'s';
    }
  }
  if(!meta.memoryLimit){
    var mm=mp.match(/内存限制[:：]\s*(\d+)\s*(KB|kb|MB|mb|GB|gb)/i);
    if(mm){
      var mval=parseInt(mm[1]);
      var munit=mm[2].toUpperCase();
      if(munit==='KB')meta.memoryLimit=formatMemory(mval);
      else if(munit==='MB')meta.memoryLimit=formatMemory(mval*1024);
      else if(munit==='GB')meta.memoryLimit=mval+'GB';
      else meta.memoryLimit=formatMemory(mval);
    }
  }else{
    var mlm=meta.memoryLimit.match(/(\d+)\s*(KB|MB|GB)/i);
    if(mlm){
      var mv=parseInt(mlm[1]),mu=mlm[2].toUpperCase();
      if(mu==='KB')meta.memoryLimit=formatMemory(mv);
      else if(mu==='MB')meta.memoryLimit=formatMemory(mv*1024);
      else meta.memoryLimit=mv+'GB';
    }
  }
  if(!meta.passRate){
    var prm=mp.match(/(\d+\.?\d*)%\s*\(/);
    if(prm)meta.passRate=prm[1];
  }
  // 解析通过/提交人数格式：61.96%(891/1438)
  var statMatch=mp.match(/(\d+\.?\d*)%\s*\((\d+)\s*\/\s*(\d+)\)/);
  if(statMatch){
    meta.passRate=statMatch[1];
    meta.acCount=statMatch[2];
    meta.subCount=statMatch[3];
  }
  // 或者从其他格式解析：通过/提交人数：61.96%(891/1438)
  if(!meta.acCount||!meta.subCount){
    var statMatch2=html.match(/通过\/提交人数[：:]\s*(\d+\.?\d*)%\s*\((\d+)\s*\/\s*(\d+)\)/);
    if(statMatch2){
      meta.passRate=statMatch2[1];
      meta.acCount=statMatch2[2];
      meta.subCount=statMatch2[3];
    }
  }
  var acl=$('#acl').first();
  if(acl.length){
    var rs=acl.find('span[style*="color"]').first();
    if(rs.length)meta.passRate=rs.text().replace('%','');
    // 从 acl 区域解析 ac_count/sub_count
    var aclText=acl.text()||'';
    var aclMatch=aclText.match(/(\d+\.?\d*)%\s*\((\d+)\s*\/\s*(\d+)\)/);
    if(aclMatch){
      meta.passRate=aclMatch[1];
      meta.acCount=aclMatch[2];
      meta.subCount=aclMatch[3];
    }
  }

  var tags=[];
  $('#tagslist table tr td').each(function(){
    var t=$(this).text();
    if(t&&!t.includes('展开'))tags.push(t);
  });
  var sections={};
  var sectionsHtml={};
  var rawSamples={};
  // === 新方案：直接渲染原始 #content，不做节段式提取 ===
  var cdiv = $('#content').clone();
  // 移除已在 .cc 头部渲染的元数据，保留所有原始内容结构
  cdiv.find('h2').remove(); // 标题（已在 .cc 渲染）
  cdiv.find('p[align="center"]').remove(); // 时间限制/出题人（已在 .cc 渲染）
  cdiv.find('style,#tagslist,#acl,#pagelist,#jumpbox').remove(); // 保留 script（原页面 toggle）
  cdiv.find('table').removeAttr('border').removeAttr('cellpadding').removeAttr('cellspacing'); // 移除 HTML border 属性（原 OJ 有全局重置）
  // 移除导航链接（题解/提交/状态/讨论等），保留内容链接
  cdiv.find('a[href*="submit"],a[href*="solution"],a[href*="status"],a[href*="discuss"],input,button,a.btn').remove();
  cdiv.find('a:contains("题解"),a:contains("讨论"),a:contains("提交"),a:contains("状态"),a:contains("Source")').remove();
  cdiv.find('center:contains("状态"),center:contains("标签"),center:contains("题解"),center:contains("讨论")').remove();
  var rawHtml = cdiv.html() || '';
  // 原文中的切换表格自带 onclick 和 script，直接保留即可使用原始逻辑
  if (rawHtml.trim()) {
    sectionsHtml['题目描述'] = rawHtml;
    sections['题目描述'] = cdiv.text().trim();
  }
  // 单独提取样例
  $('h3.contenttitle').each(function() {
    var st2 = $(this).text();
    if (!st2) return;
    if (/样例|Sample/i.test(st2)) {
      var nodes = $(this).nextUntil('h3.contenttitle');
      var preTexts = [];
      nodes.each(function() {
        var e = $(this);
        if (e.is('pre, pre.datafield')) {
          var txt = (e.text() || '').replace(/\r\n/g, '\n');
          if (txt.trim()) preTexts.push(txt);
        }
      });
      if (preTexts.length > 0) rawSamples[st2] = preTexts.join('\n');
    }
  });
  function processDownloadLinks(html) {
    if (!html) return html;
    var downloadRegex = /下发文件加载\[(\/Onlinejudge\/[^\]]+)\]/gi;
    return html.replace(downloadRegex, '<a href="' + b + '$1" class="download-link" target="_blank">下载文件</a>');
  }

  function buildSamplesFromTitles(rawMap) {
    var inputs = [];
    var outputs = [];
    var idxFromTitle = function(t) {
      var m = String(t).match(/(\d+)/);
      return m ? parseInt(m[1]) : 0;
    };
    Object.keys(rawMap).forEach(function(title) {
      var t = String(title);
      var txt = rawMap[title] || '';
      if (/样例\s*\d*\s*输入|Sample\s*\d*\s*Input|样例输入|输入样例/i.test(t)) {
        inputs.push({ idx: idxFromTitle(t), title: t, text: String(txt||'').replace(/\r\n/g,'\n') });
      } else if (/样例\s*\d*\s*输出|Sample\s*\d*\s*Output|样例输出|输出样例/i.test(t)) {
        outputs.push({ idx: idxFromTitle(t), title: t, text: String(txt||'').replace(/\r\n/g,'\n') });
      }
    });
    function cmp(a,b){ return a.idx - b.idx || String(a.title).localeCompare(String(b.title)); }
    inputs.sort(cmp); outputs.sort(cmp);
    var samples = [];
    var maxLen = Math.max(inputs.length, outputs.length);
    for (var i = 0; i < maxLen; i++) {
      var inp = inputs[i] || null;
      var out = outputs[i] || null;
      if (!inp && !out) continue;
      samples.push({
        id: (inp && inp.idx ? inp.idx : (out && out.idx ? out.idx : (i + 1))),
        input: inp ? inp.text : '',
        output: out ? out.text : ''
      });
    }
    if (samples.length === 0 && (inputs.length > 0 || outputs.length > 0)) {
      inputs.forEach(function(x, i){
        samples.push({ id: i+1, input: x.text, output: (outputs[i] ? outputs[i].text : '') });
      });
    }
    return samples;
  }

  var samples = buildSamplesFromTitles(rawSamples);
  if (samples.length === 0) {
    var pres = [];
    try {
      $('#content pre.datafield, #content pre').each(function() {
        var txt = ($(this).text() || '').replace(/\r\n/g, '\n');
        if (txt && txt.trim() !== '') pres.push(txt);
      });
    } catch(e){}
    for (var pi = 0; pi + 1 < pres.length; pi += 2) {
      samples.push({ id: (pi / 2 + 1), input: pres[pi] || '', output: pres[pi + 1] || '' });
    }
  }

  var authors=[];
var authorIds=[];
var authorColors=[];
var authorHtmls=[];
$('p').each(function(){
  if($(this).text().includes('出题人')){
    $(this).find('a[href*="user_show"]').each(function(){
      var n=$(this).text();
      var href=$(this).attr('href')||'';
      var uidMatch=href.match(/id=(\d+)/);
      var uid=uidMatch?uidMatch[1]:'';
      var col=extractUserColorFromLink($(this));
      var innerHtml=$(this).html();
      if(n)authors.push(n);
      if(uid)authorIds.push(uid);
      authorColors.push(col);
      authorHtmls.push(innerHtml||n);
    });
    return false
  }
});
  for (var key in sectionsHtml) {
    sectionsHtml[key] = processDownloadLinks(sectionsHtml[key]);
  }
  return{
    type:'practice',problemId:pid,title:title,difficulty:diff,permission:null,
    authors:authors,authorIds:authorIds,authorColors:authorColors,authorHtmls:authorHtmls,meta:meta,tags:tags,sections:sections,sectionsHtml:sectionsHtml,
    samples:samples,
    actions:[]
  };
}

function parseContestProblem(html,b){var $=require('cheerio').load(html);var h2=$('h2').first().text();var om=h2.match(/^#(\d+)/);var title=h2.replace(/^#\d+\.\s*/,'').replace(/\s*\(tab\)$/,'').trim();var pr=parsePracticeProblem(html,b);return{type:'contest',order:(om?om[1]:'')||'',title:title,meta:pr.meta,tags:pr.tags,sections:pr.sections,sectionsHtml:pr.sectionsHtml,samples:pr.samples||[],actions:pr.actions};}

// =====================================================
// 评测状态解析模块 (重构版)
// =====================================================

/**
 * 解析评测状态列表页面
 * 支持: status.php, status.php?test=xxx, status.php?command=raw, 以及带过滤器的页面
 */
function parseStatusPage(html, baseUrl) {



  var $ = require('cheerio').load(html);
  var records = [];

  // 第一部分: 表格解析
  var statusTable = findStatusTable($);


  if (statusTable) {
    var columnMap = parseStatusTableHeader($, statusTable);


    var rowCount = 0;
    statusTable.find('tr').each(function(rowIndex) {
      if (rowIndex === 0) return;
      var row = $(this);
      if (row.find('th').length > 0) return;
      
      rowCount++;
      var record = parseStatusTableRow($, row, columnMap, baseUrl);
      if (record) {

        records.push(record);
      } else {

      }
    });

  }

  // 第二部分: Raw 格式解析
  if (records.length === 0) {

    records = parseStatusRawFormat($);

  }

  // 第三部分: 分页信息
  var pagination = parseStatusPagination($);


  return {
    records: records,
    currentPage: pagination.currentPage,
    totalPages: pagination.totalPages,
    hasMore: pagination.currentPage < pagination.totalPages
  };
}

/**
 * 查找评测状态表格
 */
function findStatusTable($) {
  var table = $('#tablelist');
  
  if (!table.length) {
    table = $('table').filter(function() {
      var header = $(this).find('th').first().text().trim();
      return header === 'ID' || header === '编号' || header.includes('运行') || header.includes('记录');
    }).first();
  }
  
  if (!table.length) {
    table = $('table').first();
  }
  
  return table.length ? table : null;
}

/**
 * 解析表格表头
 */
function parseStatusTableHeader($, table) {
  var ths = table.find('tr').first().find('th');
  
  var columnMap = {
    id: 0, problem: 1, user: 2, score: 3,
    time: 4, memory: 5, codeLen: 6,
    compiler: 7, submitTime: 8, status: 3
  };

  ths.each(function(index) {
    var text = $(this).text().trim().toLowerCase();
    
    if (text.includes('id') || text === '#') columnMap.id = index;
    if (text.includes('题目') || text.includes('problem')) columnMap.problem = index;
    if (text.includes('用户') || text.includes('user') || text.includes('姓名')) columnMap.user = index;
    if (text.includes('分数') || text.includes('score')) columnMap.score = index;
    if (text.includes('时间') && !text.includes('提交')) columnMap.time = index;
    if (text.includes('内存') || text.includes('memory')) columnMap.memory = index;
    if (text.includes('长度') || text.includes('len')) columnMap.codeLen = index;
    if (text.includes('语言') || text.includes('compiler') || text.includes('编译器')) columnMap.compiler = index;
    if (text.includes('提交') && text.includes('时间')) columnMap.submitTime = index;
    if (text.includes('状态') || text.includes('status')) columnMap.status = index;
  });

  return columnMap;
}

/**
 * 解析单行评测记录
 */
function parseStatusTableRow($, row, columnMap, baseUrl) {
  var tds = row.find('td');
  if (tds.length < 6) return null;

  logger.logObj('[DEBUG parseStatusTableRow] Column map', columnMap);

  function getCell(idx, offset) {
    offset = offset || 0;
    var actualIdx = idx - offset;
    if (actualIdx < 0 || actualIdx >= tds.length) return { text: '', html: '', link: null, colspan: 1 };
    var cell = tds.eq(actualIdx);
    var link = cell.find('a').first();
    var colspan = parseInt(cell.attr('colspan')) || 1;
    return {
      text: cell.text().trim(),
      html: cell.html() || '',
      link: link.length ? link : null,
      colspan: colspan
    };
  }

  // 评测 ID
  var idCell = getCell(columnMap.id);
  var recordId = idCell.link ? idCell.link.text().trim() : idCell.text;
  if (!recordId || !recordId.match(/\d+/)) return null;

  // 题目信息
  var probCell = getCell(columnMap.problem);
  var problemId = probCell.link ? probCell.link.text().trim() : probCell.text;

  // 用户（支持委托递交 "user1 ← user2" 多链接模式）
  var userCell = getCell(columnMap.user);
  var user = userCell.link ? userCell.link.text().trim() : userCell.text;
  var userId = '';
  var userColor='';
  var userDelegation = null; // [{user, userId, userColor}, ...]
  var userHtml = userCell.html;
  // 获取单元格中所有用户链接，检查是否有多链接（委托递交）
  var allUserLinks = tds.eq(columnMap.user).find('a[href*="user_show"]');
  if (allUserLinks.length > 1) {
    // 委托递交模式：取最后一个链接作为实际递交者
    userDelegation = [];
    allUserLinks.each(function() {
      var $a = $(this);
      var href = $a.attr('href') || '';
      var uid = (href.match(/[?&]id=(\d+)/) || [])[1] || '';
      var name = $a.text().trim();
      var color = extractUserColorFromLink($a);
      var uh = $a.html() || '';
      if (uh && uh.indexOf('<') < 0) uh = '';
      userDelegation.push({user: name, userId: uid, userColor: color || '#2563EB', userHtml: uh});
    });
    // 主用户 = 最后一个
    var last = userDelegation[userDelegation.length - 1];
    user = last.user;
    userId = last.userId;
    userColor = last.userColor;
  } else {
    // 单用户模式
    if (userCell.link) {
      var userHref = userCell.link.attr('href') || '';
      var userIdMatch = userHref.match(/[?&]id=(\d+)/);
      if (userIdMatch) userId = userIdMatch[1];
    }
    // 提取用户颜色 - 优先从嵌套span提取有意义颜色（跳过black/white/gray装饰色）
    if(userCell.link){userColor=extractUserColorFromLink(userCell.link);}
    if(!userColor){var uh=userCell.html||'';var fcm=uh.match(/<font\s+[^>]*color\s*=\s*["']([^"']+)["']/i);if(fcm)userColor=fcm[1];}
    if(!userColor){var scm=userCell.html.match(/style\s*=\s*["'][^"']*color\s*:\s*([^;"']+)/i);if(scm)userColor=scm[1].trim();}
  }


  // 分数和状态
  var scoreCell = getCell(columnMap.score);
  var scoreColspan = scoreCell.colspan;
  

  
  // 检查是否正在评测（合并了分数/时间/内存列）
  var isRunning = false;
  var statusText = '';
  var rawStatus = '';
  var score = '0';
  
  // 检测合并单元格或 judging.gif
  if (scoreColspan > 1 || scoreCell.html.includes('judging.gif')) {
    isRunning = true;
    // 从合并单元格中提取状态文字
    var statusLink = scoreCell.link;
    if (statusLink.length) {
      statusText = statusLink.text().trim();
      rawStatus = statusText;
    } else {
      statusText = scoreCell.text;
      rawStatus = statusText;
    }
    // 尝试从状态文字中提取进度数字
    var progressMatch = statusText.match(/评测\s*(\d+)\/(\d+)/);
    if (progressMatch) {
      score = progressMatch[1] + '/' + progressMatch[2];
    }
  } else {
    // 正常情况：分数列没有合并
    var scoreMatch = scoreCell.text.match(/\d+/);
    score = scoreMatch ? scoreMatch[0] : '0';
    statusText = extractStatusFromRow($, tds, columnMap, score);
    rawStatus = statusText;
  }

  // 计算合并单元格造成的索引偏移
  var offset = scoreColspan > 1 ? (scoreColspan - 1) : 0;

  // 获取时间和内存（注意合并单元格的情况）
  var time = '';
  var memory = '';
  if (!isRunning) {
    time = getCell(columnMap.time).text;
    memory = getCell(columnMap.memory).text;
  }
  
  // 特判：如果时间列包含编译错误相关文字，说明是 CE 记录
  var isCE = false;
  if (time && (time.includes('编译错误') || time.includes('Compile Error') || time.includes('CE'))) {
    statusText = 'Compile Error';
    rawStatus = 'Compile Error';
    isRunning = false;
    score = '0';
    time = '';
    memory = '';
    isCE = true;
  }

  // CE 记录可能存在列偏移，需要调整
  var ceOffset = isCE ? 1 : 0;
  var codeLenCell = getCell(columnMap.codeLen, offset + ceOffset);
  var compilerCell = getCell(columnMap.compiler, offset + ceOffset);
  var submitTimeCell = getCell(columnMap.submitTime, offset + ceOffset);


  return {
    id: recordId,
    problemId: problemId,
    problemUrl: probCell.link && probCell.link.attr('href') ? baseUrl + '/OnlineJudge/' + probCell.link.attr('href') : '',
    user: user,
    userId: userId,
    userColor: userColor,
    userHtml: userHtml,
    userDelegation: userDelegation,
    score: score,
    status: statusText,
    rawStatus: rawStatus,
    isRunning: isRunning,
    time: time,
    memory: memory,
    codeLen: codeLenCell.text,
    compiler: compilerCell.text,
    submitTime: submitTimeCell.text
  };
}

/**
 * 提取评测状态
 */
function extractStatusFromRow($, tds, columnMap, score) {
  var scoreCell = tds.eq(columnMap.score);
  var fontEl = scoreCell.find('font').first();
  
  if (fontEl.length) return fontEl.text().trim();
  
  if (columnMap.status !== columnMap.score && columnMap.status >= 0) {
    var statusCell = tds.eq(columnMap.status);
    var statusText = statusCell.text().replace(/\d+/g, '').trim();
    if (statusText) return statusText;
  }
  
  var scoreNum = parseInt(score) || 0;
  if (scoreNum >= 100) return 'Accepted';
  
  return 'Wrong Answer';
}

/**
 * 解析 raw 格式
 */
function parseStatusRawFormat($) {
  var records = [];
  var rawText = $('body').text();
  var lines = rawText.split('\n');
  
  lines.forEach(function(line) {
    line = line.trim();
    if (!line) return;
    
    var parts = line.split('\t');
    if (parts.length < 9) return;
    
    var recordId = parts[0].trim();
    if (!recordId.match(/^\d+$/)) return;
    
    records.push({
      id: recordId,
      problemId: parts[1] || '',
      problemUrl: '',
      user: parts[2] || '',
      score: parts[3] || '0',
      status: parts[4] || '',
      time: parts[5] || '',
      memory: parts[6] || '',
      codeLen: parts[7] || '',
      compiler: parts[8] || '',
      submitTime: parts[9] || ''
    });
  });
  
  return records;
}

/**
 * 解析分页信息
 */
function parseStatusPagination($) {
  var currentPage = 1;
  var totalPages = 1;
  
  var bodyText = $('body').text();
  var pageMatch = bodyText.match(/第\s*(\d+)\s*页/);
  if (pageMatch) currentPage = parseInt(pageMatch[1]);
  
  $('a[href*="page="]').each(function() {
    var href = $(this).attr('href') || '';
    var match = href.match(/page=(\d+)/);
    if (match) {
      var page = parseInt(match[1]);
      if (page > totalPages) totalPages = page;
    }
  });
  
  totalPages = Math.max(currentPage, totalPages);
  
  return { currentPage, totalPages };
}

// =====================================================
// 评测详情解析模块 (重构版)
// =====================================================

/**
 * 解析评测详情页面
 */
function parseStatusDetail(html, baseUrl, sourceHtml) {
  var $ = require('cheerio').load(html);
  
  // 基本信息
  var titleText = $('h2').first().text();
  var recordIdMatch = titleText.match(/R(\d+)/);
  var recordId = recordIdMatch ? recordIdMatch[1] : '';

  // 源代码提取
  var sourceCode = '';
  
  if (sourceHtml) {
    var src$ = require('cheerio').load(sourceHtml);
    sourceCode = src$('pre').first().text() || '';
  }
  
  if (!sourceCode || sourceCode.length < 30) {
    $('#content pre').each(function() {
      var code = $(this).text();
      if (code && code.length > 30) {
        sourceCode = code;
        return false;
      }
    });
  }

  // 概要信息
  var summary = parseDetailSummary($);

  // 测试点
  var testCases = parseDetailTestCases($);

  // 子任务
  var subTasks = parseDetailSubTasks($);

  // 编译信息
  var compileInfo = parseDetailCompileInfo($);

  return {
    recordId: recordId,
    summary: summary,
    sourceCode: sourceCode,
    testCases: testCases,
    subTasks: subTasks,
    compileInfo: compileInfo,
    problemUrl: null
  };
}

/**
 * 解析概要信息
 */
function parseDetailSummary($) {
  var summary = {
    user: '', userId: '', userColor: '', problemId: '', totalTime: '',
    compiler: '', score: '0', submitTime: '', evalTime: ''
  };
  
  var infoCells = $('#content table').first().find('tr').eq(1).find('td');
  
  infoCells.each(function(index) {
    var text = $(this).text().trim().replace('(我)', '').trim();
    
    switch(index) {
      case 0:
        summary.user = text;
        // 提取用户链接中的userId 和 委托递交信息
        var allUserLinks = $(this).find('a[href*="user_show.php"]');
        if (allUserLinks.length > 1) {
          // 委托递交模式：提取所有用户信息
          var delegation = [];
          allUserLinks.each(function() {
            var $a = $(this);
            var href = $a.attr('href') || '';
            var uid = (href.match(/[?&]id=(\d+)/) || [])[1] || '';
            var name = $a.text().trim();
            var color = extractUserColorFromLink($a);
            var uh = $a.html() || '';
            if (uh && uh.indexOf('<') < 0) uh = '';
            delegation.push({user: name, userId: uid, userColor: color || '#2563EB', userHtml: uh});
          });
          summary.userDelegation = delegation;
          // 主用户 = 最后一个
          var last = delegation[delegation.length - 1];
          summary.user = last.user;
          summary.userId = last.userId;
          summary.userColor = last.userColor;
          summary.userHtml = last.userHtml || '';
        } else if (allUserLinks.length === 1) {
          var userLink = allUserLinks.first();
          var userHref = userLink.attr('href') || '';
          var idMatch = userHref.match(/[?&]id=(\d+)/);
          if (idMatch) summary.userId = idMatch[1];
          // 提取用户颜色（支持嵌套span的多色用户名）
          var uc = extractUserColorFromLink(userLink);
          if (uc) summary.userColor = uc;
          // 提取用户链接内部HTML，保留多色样式
          var uh = userLink.html() || '';
          if (uh && uh.indexOf('<') >= 0 && uh.indexOf('>') >= 0) summary.userHtml = uh;
        }
        break;
      case 1: summary.problemId = text; break;
      case 2: summary.totalTime = text; break;
      case 3: summary.compiler = text; break;
      case 4:
        var scoreMatch = text.match(/\d+/);
        summary.score = scoreMatch ? scoreMatch[0] : '0';
        break;
      case 5: summary.submitTime = text; break;
      case 6: summary.evalTime = text; break;
    }
  });
  
  return summary;
}

/**
 * 解析测试点详情
 */
function parseDetailTestCases($) {
  var testCases = [];
  
  $('#content table').each(function() {
    var table = $(this);
    var header = table.find('th').first().text().trim();
    
    if (header === '测试点') {
      table.find('tr').each(function() {
        var tds = $(this).find('td');
        if (tds.length < 6) return;
        
        var statusCell = tds.eq(3);
        var status = statusCell.find('font').first().text().trim() || statusCell.text().trim();
        
        testCases.push({
          id: tds.eq(0).text().trim(),
          fullScore: tds.eq(1).text().trim(),
          score: tds.eq(2).text().trim(),
          status: status,
          time: tds.eq(4).text().trim(),
          memory: tds.eq(5).text().trim()
        });
      });
      return false;
    }
  });
  
  testCases.sort(function(a, b) {
    return (parseInt(a.id) || 0) - (parseInt(b.id) || 0);
  });
  
  return testCases;
}

/**
 * 解析子任务信息
 */
function parseDetailSubTasks($) {
  var subTasks = [];
  
  $('#content table').each(function() {
    var table = $(this);
    var header = table.find('th').first().text().trim();
    
    if (header === '子任务' || header === 'Subtask') {
      table.find('tr').each(function() {
        var tds = $(this).find('td');
        if (tds.length < 6) return;
        
        subTasks.push({
          id: tds.eq(0).text().trim(),
          method: tds.eq(1).text().trim(),
          weight: tds.eq(2).text().trim(),
          fullScore: tds.eq(3).text().trim(),
          score: tds.eq(4).text().trim(),
          testPoints: tds.eq(5).text().trim()
        });
      });
      return false;
    }
  });
  
  return subTasks;
}

/**
 * 解析编译信息
 */
function parseDetailCompileInfo($) {
  var compileInfo = '(无编译信息)';
  
  $('#content table').each(function() {
    var table = $(this);
    var header = table.find('th').first().text().trim();
    
    if (header.includes('编译')) {
      var content = table.find('td').first();
      if (content.length) compileInfo = content.text().trim();
      return false;
    }
  });
  
  return compileInfo;
}

// =====================================================
// 其他解析函数 (保持不变)
// =====================================================

function parseProblemListPage(html,b){
  var $=require('cheerio').load(html);
  var problems=[];

  
  
  var tablesFound = $('#content table#tablelist').length;

  
  $('#content table#tablelist').each(function(){
    var h=$(this).find('th').first().text();

    if(h!=='Mark'&&h!=='ID'&&!h.includes('题目')){

      return;
    }
    
    var markIdx=0,idIdx=1,titleIdx=2,rateIdx=3,levelIdx=4;
    $(this).find('tr').first().find('th').each(function(i){
      var th=$(this).text().trim();

      if(th==='Mark')markIdx=i;
      else if(th==='ID')idIdx=i;
      else if(th.includes('题目'))titleIdx=i;
      else if(th.includes('通过')||th.includes('率'))rateIdx=i;
      else if(th.includes('Level')||th.includes('难度'))levelIdx=i;
    });

    
    var rowCount = 0;
    $(this).find('tr').each(function(){
      rowCount++;
      var tds=$(this).find('td');
      if(tds.length<5){

        return;
      }
      
      var markTd=tds.eq(markIdx);
      var mark='';
      var markImg=markTd.find('img').first();
      if(markImg.length){
        var imgSrc=markImg.attr('src')||'';

        if(imgSrc.includes('ac.jpg'))mark='ac';
        else if(imgSrc.includes('ua.jpg'))mark='attempted';
      }
      if(!mark){
        var markContent=markTd.html()||'';
        var markText=markTd.text().trim();

        if(markText.includes('AC')||markText.includes('✓')||markContent.includes('color:#2ea043')||markContent.includes('color:#008000'))mark='ac';
        else if(markText.includes('*')||markText.includes('●')||markContent.includes('color:#fa5a05')||markContent.includes('color:#ffc107'))mark='attempted';
      }
      
      var idText = tds.eq(idIdx).text().trim();
      var nl=tds.eq(titleIdx).find('a');
      var nh=tds.eq(titleIdx).html()||'';
      var nt=nl.text();
      

      
      if(nt.includes('隐藏')||nh.includes('color:gray')){
        problems.push({id:idText,name:'题目被隐藏',isHidden:true,url:'',passRate:null,acCount:null,subCount:null,level:null,mark:mark});
        return;
      }
      
      var pm=nh.match(/<font[^>]*>\(([^)]+)\)<\/font>/);
      var rc=tds.eq(rateIdx);
      var pr=null,ac=null,sc=null;
      var rs=rc.find('span[style*="color"]').first();
      if(rs.length)pr=rs.text().replace('%','');
      var rl=rc.find('a');
      if(rl.length>=2){ac=$(rl[0]).text();sc=$(rl[1]).text();}
      
      var levelText = tds.eq(levelIdx).find('strong').text()||tds.eq(levelIdx).text();
      var url = nl.attr('href')?b+'/OnlineJudge/'+nl.attr('href'):'';
      
      var problem = {id:idText,name:nt,permission:pm?pm[1]:null,url:url,passRate:pr,acCount:ac,subCount:sc,level:levelText,isHidden:false,mark:mark};

      problems.push(problem);
    });
  });
  

  
  return{problems:problems,...extractPagination($)};
}

// =====================================================
// Parse Tag List Page (tag_list.php)
// Returns: { tags: [{id, name, count}], ...pagination }
//   id = numeric tagId (as string)
//   name = display name of the tag
//   count = optional, number of problems tagged
// =====================================================
function parseTagList(html, _b) {
  var $ = require('cheerio').load(html);
  var tags = [];
  var seenIds = new Set();
  var table = null;
  var $content = $('#content');
  if ($content.length) {
    $content.find('table#tablelist').each(function() {
      if ($(this).closest('#ftoolbarshow').length > 0) return;
      table = $(this);
      return false;
    });
  }
  if (!table) table = $('table#tablelist').not('#ftoolbarshow table#tablelist').first();
  if (!table || !table.length) table = $('table').first();

  if (table && table.length) {
    table.find('tr').each(function() {
      var $tr = $(this);
      var $tds = $tr.find('td');
      if ($tds.length < 2) return; // skip header (<th> only) or invalid rows

      // Try to extract tag id from first td / any link with href="problem_list.php?tag=..."
      var tagId = '';
      var tagName = '';
      var tagCount = '';

      // Find all links pointing to problem_list.php?tag=
      $tr.find('a[href*="problem_list.php?tag="]').each(function() {
        var href = $(this).attr('href') || '';
        var m = href.match(/tag=([0-9]+)/);
        if (m && !tagId) tagId = m[1];
        if (!tagName) {
          var txt = $(this).text().trim();
          if (txt) tagName = txt;
        }
      });

      // Fallback: extract id from first td
      if (!tagId) {
        var firstCell = $tds.eq(0);
        var t = firstCell.text().trim();
        if (t && /^\d+$/.test(t)) tagId = t;
        if (!tagName) {
          var secCell = $tds.eq(1);
          var name = secCell.text().trim();
          if (name) tagName = name;
        }
      }

      // Fallback name: second td
      if (!tagName) {
        tagName = $tds.eq(1).text().trim();
      }
      // Fallback count: 3rd or last td as numeric count
      if ($tds.length >= 3) {
        var last = $tds.eq($tds.length - 1).text().trim();
        if (/^\d+$/.test(last)) tagCount = last;
      }

      if (tagId && tagName && !seenIds.has(tagId)) {
        seenIds.add(tagId);
        var tagObj = { id: String(tagId), name: tagName };
        if (tagCount) tagObj.count = String(tagCount);
        tags.push(tagObj);
      }
    });
  }


  if (tags.length) {

  }

  // --- 从页面 JS 的 fullname_map = {"51": "二分", ...} 中补充子标签，保证标签全面 ---
  try {
    var scriptBlocks = [];
    if ($ && $.html) {
      $('script').each(function() {
        var sc = $(this).html() || '';
        if (sc && sc.indexOf('fullname_map') >= 0) scriptBlocks.push(sc);
      });
    } else {
      var m;
      var re = /<script[\s\S]*?>([\s\S]*?)<\/script>/gi;
      var htmlSrc = (typeof html === 'string') ? html : '';
      while ((m = re.exec(htmlSrc)) !== null) {
        if (m[1] && m[1].indexOf('fullname_map') >= 0) scriptBlocks.push(m[1]);
      }
    }
    var combined = scriptBlocks.join('\n');
    if (combined) {
      var fullObj = null;
      var fm = combined.match(/fullname_map\s*=\s*(\{[\s\S]*?\})\s*;/);
      if (fm && fm[1]) {
        try { fullObj = JSON.parse(fm[1]); } catch (_e) {
          try {
            var unescaped = fm[1].replace(/\\"/g, '\u0001').replace(/\\'/g, '\u0002');
            var kvPairs = {};
            var pairRe = /"([0-9]+)"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
            var pm;
            while ((pm = pairRe.exec(unescaped)) !== null) {
              var id = pm[1];
              var nm = pm[2].replace(/\u0001/g, '"').replace(/\u0002/g, "'").replace(/\\"/g, '"');
              kvPairs[id] = nm;
            }
            fullObj = kvPairs;
          } catch (_e2) { fullObj = null; }
        }
      }
      if (!fullObj) {
        var fallback = {};
        var pairRe2 = /"([0-9]+)"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/g;
        var pm2;
        while ((pm2 = pairRe2.exec(combined)) !== null) {
          fallback[pm2[1]] = pm2[2];
        }
        if (Object.keys(fallback).length > 0) fullObj = fallback;
      }
      if (fullObj) {
        Object.keys(fullObj).forEach(function(idStr) {
          var tname = String(fullObj[idStr] || '').trim();
          if (!idStr || !tname) return;
          if (seenIds.has(String(idStr))) return;
          seenIds.add(String(idStr));
          tags.push({ id: String(idStr), name: tname });
        });

      }
    }
  } catch (err) {

  }

  return { tags: tags, ...extractPagination($) };
}

function parseDiscussionList(html,b,page){
  var $=require('cheerio').load(html);
  var discussions=[];
  var contentDiv=$('#content');
  var table=null;
  if(contentDiv.length){
    contentDiv.find('table#tablelist').each(function(){
      var tbl=$(this);
      if(tbl.closest('#ftoolbarshow').length>0)return;
      table=tbl;
      return false;
    });
  }
  if(!table)table=$('table#tablelist').not('#ftoolbarshow table#tablelist').first();
  if(!table.length)table=$('table').first();
  table.find('tr').each(function(){
    var tds=$(this).find('td');
    if(tds.length<2)return;
    var id='',title='',href='',author='',authorId='',time='',replies='0';
    var idTd=tds.eq(0);
    var titleTd=tds.eq(1);
    id=idTd.text().trim().replace(/[^\d]/g,'');
    var titleLink=titleTd.find('a').first();
    if(titleLink.length){
      title=titleLink.text().trim();
      href=titleLink.attr('href')||'';
    }else{
      title=titleTd.text().trim();
    }
    if(tds.length>=3){
      var authorTd=tds.eq(2);
      var authorLink=authorTd.find('a[href*="user_show.php"]').first();
      if(authorLink.length){
        author=authorLink.text().trim();
        var authorHref=authorLink.attr('href')||'';
        var idMatch=authorHref.match(/[?&]id=(\d+)/);
        if(idMatch)authorId=idMatch[1];
      }else{
        author=authorTd.text().trim();
      }
    }
    if(tds.length>=4){
      time=tds.eq(3).text().trim();
    }
    if(tds.length>=5){
      replies=tds.eq(4).text().trim().replace(/[^\d]/g,'')||'0';
    }
    if(!id&&href){
      var hm=href.match(/id=(\d+)/);
      if(hm)id=hm[1];
    }
    if(id&&title){
      discussions.push({
        id:id,
        title:title.replace(/\s+/g,' ').trim(),
        author:author,
        authorId:authorId,
        time:time,
        replies:replies,
        url:href?b+'/OnlineJudge/'+href:'',
        problemId:''
      });
    }
  });
  var currentPage=page||1,totalPages=1;
  var paginationP=contentDiv.length?contentDiv.find('p[align="center"]').first():$('p[align="center"]').first();
  if(paginationP.length){
    var maxPage=0;
    paginationP.find('a').each(function(){
      var href=$(this).attr('href')||'';
      var pm=href.match(/page=(\d+)/);
      if(pm){
        var pp=parseInt(pm[1]);
        if(pp>maxPage)maxPage=pp;
      }
    });
    totalPages=Math.max(currentPage,maxPage+1);
  }else{
    var pagination=extractPagination($);
    totalPages=pagination.totalPages||1;
  }
  return{discussions:discussions,currentPage:currentPage,totalPages:totalPages};
}

function parseDiscussionShow(html,_b){
  var $=require('cheerio').load(html);
  var title='';
  var contentHtml='';
  var contentText='';
  var did='';
  var author='';
  var authorId='';
  var time='';
  var problemId='';

  // 不再做全局关键词检查（页面脚注或回复框可能含"请先登录"字样导致误判）

  // 提取标题 - 从 h2 标签
  var titleEl=$('#content h2').first();
  if(titleEl.length){
    title=titleEl.text().trim();
    // 提取讨论ID - 从标题中的 DCxx 格式
    var idMatch=title.match(/DC(\d+)/i);
    if(idMatch)did=idMatch[1];
  }

  // 提取讨论ID - 从URL参数或页面链接
  if(!did){
    var enterLink=$('#content a[href*="discuss_discuss.php"]').first();
    if(enterLink.length){
      var href=enterLink.attr('href')||'';
      var dm=href.match(/did=(\d+)/);
      if(dm)did=dm[1];
    }
  }

  // 提取讨论内容 - 从 content div 中的非标题元素
  var contentDiv=$('#content');
  if(contentDiv.length){
    // 移除不需要的元素
    var contentClone=contentDiv.clone();
    contentClone.find('h2,script,style,div#ftoolbarshow,a[href*="discuss_discuss.php"]').remove();

    // 提取内容段落
    var paragraphs=[];
    var textParts=[];

    // 首先尝试提取 p 标签
    contentClone.find('p').each(function(){
      var p=$(this);
      var pt=p.text().trim();
      if(pt.length>0&&!pt.includes('没有权限')&&!pt.includes('请先登录')){
        paragraphs.push(p.html()||pt);
        textParts.push(pt);
      }
    });

    // 如果没有 p 标签，尝试提取其他内容
    if(paragraphs.length===0){
      contentClone.children().each(function(){
        var el=$(this);
        var tag=el.prop('tagName');
        if(tag&&tag!=='H2'&&tag!=='DIV'&&tag!=='CENTER'&&tag!=='TABLE'){
          var ht=el.html()||'';
          var tt=el.text().trim();
          if(tt.length>0&&!tt.includes('没有权限')&&!tt.includes('请先登录')){
            paragraphs.push(ht);
            textParts.push(tt);
          }
        }
      });
    }

    // 最后尝试提取所有文本
    if(paragraphs.length===0){
      var allText=contentClone.text().trim();
      if(allText.length>0&&!allText.includes('没有权限')&&!allText.includes('请先登录')){
        contentText=allText;
        contentHtml=contentClone.html()||'';
      }
    }else{
      contentHtml=paragraphs.join('<br/>');
      contentText=textParts.join('\n');
    }
  }

  // 提取作者和时间信息 - 从标题附近的内容
  var titleNext=titleEl.next();
  if(titleNext.length){
    var infoText=titleNext.text()||'';
    // 提取作者
    var authorLink=titleNext.find('a[href*="user_show.php"]').first();
    if(authorLink.length){
      author=authorLink.text().trim();
      var href=authorLink.attr('href')||'';
      var idMatch=href.match(/[?&]id=(\d+)/);
      if(idMatch)authorId=idMatch[1];
    }
    // 提取时间
    var timeMatch=infoText.match(/\d{4}[-\/]\d{1,2}[-\/]\d{1,2}\s*\d{1,2}:\d{1,2}:\d{1,2}/);
    if(timeMatch)time=timeMatch[0];
  }

  // 提取关联的题目ID - 从链接
  var probLink=$('#content a[href*="problem_show.php"]').first();
  if(probLink.length){
    var phref=probLink.attr('href')||'';
    var pidMatch=phref.match(/id=(\d+)/);
    if(pidMatch)problemId=pidMatch[1];
  }

  return{
    id:did,
    title:title,
    content:contentText,
    contentHtml:contentHtml,
    author:author,
    authorId:authorId,
    time:time,
    problemId:problemId
  };
}

function parseDiscussionPosts(html,b,page){
  var $=require('cheerio').load(html);
  var posts=[];
  var title='';
  var did='';

  // debug: 打印页面结构信息
  var hasContent=$('#content').length>0;
  var tableListCnt=$('table#tablelist').length;
  var discussLinks=$('a[href*="discuss_discuss.php"]').length;
  var pageLinks=$('a[href*="page="]').length;
  var pageTitle=$('title').text().trim();
  // 不再做全局关键词检查（页面底部回复框可能含"请先登录"字样导致误判），
  // 如果真正无权限访问，posts 自然为空

  // 提取标题 - 从 h2 标签
  var titleEl=$('#content h2').first();
  if(titleEl.length){
    title=titleEl.text().trim();
    // 提取讨论ID
    var idMatch=title.match(/DC(\d+)/i);
    if(idMatch)did=idMatch[1];
  }

  // 提取帖子列表 - 从 tablelist 表格
  var contentDiv=$('#content');
  var tables=contentDiv.length?contentDiv.find('table#tablelist'):$('table#tablelist');

  tables.each(function(){
    var tbl=$(this);
    // 跳过浮动工具栏中的表格
    if(tbl.closest('#ftoolbarshow').length>0)return;

    var th=tbl.find('th').first();
    var td=tbl.find('td').first();
    if(!th.length||!td.length)return;

    var thText=th.text().trim();

    // 检查是否是帖子行 - 包含楼层信息（楼或#数字）
    if(!thText.includes('\u697c')&&!thText.match(/#\d+/))return;

    // 提取楼层数
    var floor='';
    var fm=thText.match(/#(\d+)\s*\u697c/);
    if(fm)floor=fm[1];
    if(!floor){
      fm=thText.match(/#(\d+)/);
      if(fm)floor=fm[1];
    }

    // 提取作者信息
    var author='';
    var authorId='';
    var authorLink=th.find('a[href*="user_show.php"]').first();
    if(authorLink.length){
      author=authorLink.text().trim();
      var href=authorLink.attr('href')||'';
      var idMatch=href.match(/[?&]id=(\d+)/);
      if(idMatch)authorId=idMatch[1];
    }else{
      // 从文本中提取作者
      var am=thText.match(/\u697c\s+(.+?)\s+\u53d1\u8868/);
      if(am)author=am[1].trim();
      else{
        // 尝试其他格式
        am=thText.match(/作者[:：]\s*(\S+)/);
        if(am)author=am[1].trim();
      }
    }

    // 提取时间信息
    var time='';
    var tm=thText.match(/\u53d1\u8868\u4e8e\s+(.+)$/);
    if(tm)time=tm[1].trim();
    else{
      // 尝试其他时间格式
      tm=thText.match(/\d{4}[-\/]\d{1,2}[-\/]\d{1,2}\s*\d{1,2}:\d{1,2}:\d{1,2}/);
      if(tm)time=tm[0];
    }
    // 去掉时间中混入的按钮文字（如"删除"）
    time=time.replace(/\s*删除\s*/g,'').trim();

    // 提取帖子内容（先排除按钮等交互元素）
    var contentHtml=(td.html()||'').replace(/<script[\s\S]*?<\/script>/gi,'').replace(/<style[\s\S]*?<\/style>/gi,'').trim();
    // 复制 td 并移除按钮/表单元素后再取纯文本，避免删除按钮文字混入
    var tdClean=td.clone();
    tdClean.find('button,input,select,textarea,.del-btn,form').remove();
    var contentText=tdClean.text().trim();

    // 提取删除链接（如果有）
    var delUrl='';
    var delLink=th.find('a[href*="delete="]').first();
    if(!delLink.length) delLink=tbl.find('a[href*="delete="]').first();
    if(delLink.length) delUrl=delLink.attr('href')||'';

    if(floor||author||contentText){
      posts.push({
        id:floor||posts.length.toString(),
        floor:floor||posts.length.toString(),
        author:author,
        authorId:authorId,
        time:time,
        content:contentText,
        contentHtml:contentHtml,
        deleteUrl:delUrl
      });
    }
  });

  // 提取分页信息 — 搜索全文档中 discuss_discuss.php 的 page 链接
  var currentPage=page||0,totalPages=1;
  var allPageNums=[];
  $('a[href*="discuss_discuss.php"][href*="page="]').each(function(){
    var href=$(this).attr('href')||'';
    var pm=href.match(/[?&]page=(\d+)/);
    if(pm){
      var pp=parseInt(pm[1]);
      if(allPageNums.indexOf(pp)===-1)allPageNums.push(pp);
    }
  });
  if(allPageNums.length>0){
    var maxPage=Math.max.apply(null,allPageNums);
    totalPages=Math.max(maxPage+1,currentPage+1);
  }else{
    // 降级：尝试搜索通用 page= 链接
    $('a[href*="page="]').each(function(){
      var href=$(this).attr('href')||'';
      var pm=href.match(/[?&]page=(\d+)/);
      if(pm){
        var pp=parseInt(pm[1]);
        if(allPageNums.indexOf(pp)===-1)allPageNums.push(pp);
      }
    });
    if(allPageNums.length>0){
      totalPages=Math.max.apply(null,allPageNums)+1;
    }else{
      totalPages=1;
    }
  }
  return{
    posts:posts,
    title:title,
    id:did,
    currentPage:currentPage,
    totalPages:totalPages
  };
}

function parseProblemDiscussionPage(html,b,page){
  var $=require('cheerio').load(html);
  var discussions=[];
  var title=$('h2').first().text().trim()||'';
  var contentDiv=$('#content');
  var tables=contentDiv.length?contentDiv.find('table#tablelist'):$('table#tablelist');
  tables.each(function(){
    var tbl=$(this);
    if(tbl.closest('#ftoolbarshow').length>0)return;
    var th=tbl.find('th').first();
    var td=tbl.find('td').first();
    if(!th.length||!td.length)return;
    var thText=th.text().trim();
    if(!thText.includes('\u697c')&&!thText.match(/#\d+/))return;
    var floor='';
    var author='';
    var time='';
    var fm=thText.match(/#(\d+)\s*\u697c/);
    if(fm)floor=fm[1];
    if(!floor){
      fm=thText.match(/#(\d+)/);
      if(fm)floor=fm[1];
    }
    var authorLink=th.find('a[href*="user_show.php"]').first();
    var author='';
    var authorId='';
    if(authorLink.length){
      author=authorLink.text().trim();
      var href=authorLink.attr('href')||'';
      var idMatch=href.match(/[?&]id=(\d+)/);
      if(idMatch)authorId=idMatch[1];
    }else{
      var am=thText.match(/\u697c\s+(.+?)\s+\u53d1\u8868/);
      if(am)author=am[1].trim();
    }
    var tm=thText.match(/\u53d1\u8868\u4e8a\s+(.+)$/);
    if(tm)time=tm[1].trim();
    var contentHtml=(td.html()||'').replace(/<script[\s\S]*?<\/script>/gi,'').replace(/<style[\s\S]*?<\/style>/gi,'').trim();
    var contentText=td.text().trim();
    if(floor||author||contentText){
      discussions.push({
        id:floor,
        floor:floor,
        author:author,
        authorId:authorId,
        time:time,
        content:contentText,
        contentHtml:contentHtml,
        replies:[],
        url:''
      });
    }
  });
  var currentPage=(page||0)+1,totalPages=1;
  var paginationP=contentDiv.find('p[align="center"]').first();
  if(paginationP.length){
    var maxPage=0;
    paginationP.find('a').each(function(){
      var href=$(this).attr('href')||'';
      var pm=href.match(/page=(\d+)/);
      if(pm){
        var pp=parseInt(pm[1]);
        if(pp>maxPage)maxPage=pp;
      }
    });
    totalPages=maxPage+1;
  }
  return{discussions:discussions,title:title,problemId:'',currentPage:currentPage,totalPages:totalPages};
}

function parseUserPage(html,b){
  // ===== 快速行号提取（YZOJ 用户主页模板固定结构） =====
  var _lines = html.split('\n');
  var _L195=(_lines[194]||'').trim(); // <h2>...user_show.php?id=...
  var _L210=(_lines[209]||'').trim(); // <td width="20%">真实姓名</td>
  var _L215=(_lines[214]||'').trim(); // <td><a href="status.php?uid=">提交次数</a></td>
  var _L222=(_lines[221]||'').trim(); // <td><a href="status.php?uid=&status=1">解决题数</a></td>
  var _L226=(_lines[225]||'').trim(); // <td>学校</td>
  var _L230=(_lines[229]||'').trim(); // <td>邮箱</td>
  var _L239=(_lines[238]||'').trim(); // Morris.Area 折线图数据

  var _userId_line='',_username_line='',_userColor_line='',_userHtml_line='';
  if(_L195){
    var _idM=_L195.match(/user_show\.php\?id=(\d+)/);
    if(_idM)_userId_line=_idM[1];
    var _aM=_L195.match(/<a[^>]*>([\s\S]*?)<\/a>/);
    if(_aM){_username_line=_aM[1].replace(/<[^>]+>/g,'').replace(/&nbsp;/g,' ').replace(/\(我\)/g,'').replace('（我）','').trim();_userHtml_line=_aM[1];}
    var _cM=_L195.match(/style\s*=\s*["'][^"']*color\s*:\s*([^;"'\]>]+)/i);
    if(_cM){
      var _c=_cM[1].trim().replace(/[，。)\]}]+$/g,'').trim();
      if(!/^#(000000|FFFFFF|FFF|000|888|999|AAA|BBB|CCC|DDD|EEE)$/i.test(_c)&&!/^(black|white|gray|grey|silver)$/i.test(_c)){_userColor_line=_c;if(/^[0-9a-fA-F]{6}$/.test(_userColor_line))_userColor_line='#'+_userColor_line;if(/^[0-9a-fA-F]{3}$/.test(_userColor_line))_userColor_line='#'+_userColor_line;}
    }
  }
  var _realName_line='',_school_line='',_email_line='',_submissionCount_line=0,_solvedCount_line=0;
  if(_L210){var _m=_L210.match(/<td[^>]*>([^<]*)<\/td>/);if(_m)_realName_line=_m[1].trim();}
  if(_L215){var _m=_L215.match(/>(\d+)<\/a>/);if(_m)_submissionCount_line=parseInt(_m[1])||0;}
  if(_L222){var _m=_L222.match(/>(\d+)<\/a>/);if(_m)_solvedCount_line=parseInt(_m[1])||0;}
  if(_L226){var _m=_L226.match(/<td[^>]*>([^<]*)<\/td>/);if(_m)_school_line=_m[1].trim();}
  if(_L230){var _m=_L230.match(/<td[^>]*>([^<]*)<\/td>/);if(_m)_email_line=_m[1].trim();}
  var _activityData_line=[];
  if(_L239){
    var _dM=_L239.match(/data\s*:\s*(\[[\s\S]*?\])/);
    if(_dM){try{var _r=_dM[1].replace(/(\{|\,)\s*([a-zA-Z_\-][a-zA-Z0-9_\-]*)\s*:/g,'$1"$2":').replace(/,\s*\]/g,']');var _p=JSON.parse(_r);if(Array.isArray(_p))_activityData_line=_p.slice(-12);}catch(_e){}}
  }
  var _lineOk = !!_username_line;

  var $=require('cheerio').load(html);
  var h2El=$('h2').first();
  var h2=h2El.text().trim();
  var userId=_userId_line||'';
  var username=_username_line||'';
  var userLinkInH2=h2El.find('a[href*="user_show.php"]').first();

  // ===== 提取真实网页颜色代码 =====
  var userColor=_userColor_line||'';
  // 1) 优先 h2 里的用户链接的 inline style color
  function extractColorFromStyle(style){
    if(!style)return '';
    var m=style.match(/color\s*:\s*([^;!"'`<>]+)/i);
    if(!m)return '';
    return m[1].trim();
  }
  // 如果行号未提取到颜色，执行完整 DOM 颜色提取
  if (!userColor) {
  var candidateEls=[];
  if(userLinkInH2.length){
    candidateEls.push(userLinkInH2);
    userLinkInH2.find('span,strong,font').each(function(){candidateEls.push($(this));});
  }
  candidateEls.push(h2El);
  h2El.find('strong,font,span').each(function(){candidateEls.push($(this));});
  var contentUserLinks=$('#content a[href*="user_show.php"]');
  if(!contentUserLinks.length)contentUserLinks=$('body a[href*="user_show.php"]');
  contentUserLinks.slice(0,3).each(function(){
    var l=$(this);
    if(l.closest('footer, #footer, .footer, .foot, .copyright, .contrib, #foot, [id*="footer"], [class*="footer"], [class*="copyright"], [id*="contrib"], [class*="contrib"]').length)return true;
    candidateEls.push(l);
  });
  // body 内第一个包含用户名的元素（如果是带 style=color 的 span）
  // 跳过 black/white/gray 等装饰性颜色，取第一个有意义的彩色
  var _decCol=/^#(000000|FFFFFF|FFF|000|888|999|AAA|BBB|CCC|DDD|EEE)$/i;
  var _decNam=/^(black|white|gray|grey|silver)$/i;
  var _fallbackCol='';
  for(var ci=0;ci<candidateEls.length;ci++){
    var el=candidateEls[ci];
    var _c=extractColorFromStyle(el.attr('style')||'');
    if(!_c)continue;
    if(_decCol.test(_c)||_decNam.test(_c)){if(!_fallbackCol)_fallbackCol=_c;continue;}
    userColor=_c;
    break;
  }
  if(!userColor)userColor=_fallbackCol;
  // 2) 如果没有 inline color，看 h2Html 里的 color: （style 标签内的局部样式）
  if(!userColor){
    // 尝试找 <style> 块里 color 值，根据 h2 选择器近似匹配
    var styleBlocks=[];
    $('style').each(function(){styleBlocks.push($(this).html()||'');});
    // 简单兜底：h2El.find('*') color 仍为空时，在 full html 里查找 style="color:#xx;" 并包含 username 的周围节点
    var h2InnerHtml=h2El.html()||'';
    var colorPat=/style\s*=\s*["'][^"']*?color\s*:\s*([^"';\s]+)/ig;
    var match;
    while((match=colorPat.exec(h2InnerHtml))!==null){
      if(match[1]){userColor=match[1].trim();break;}
    }
    if(!userColor){
      var contentAreaHtml=$('#content').html()||$('body').html()||'';
      var pat=/style\s*=\s*["'][^"']*?color\s*:\s*([^"';\s!]+)[^"']*?["'][^>]*>\s*[^<>]*?(?=<|$)/g;
      var m2;
      var h2UserNameHint=userLinkInH2.length?userLinkInH2.text().replace(/\(我\)/g,'').trim():'';
      while((m2=pat.exec(contentAreaHtml))!==null){
        var candidateColor=m2[1];
        var surround=m2[0]||'';
        if(/user_show/.test(surround)){userColor=candidateColor;break;}
        if(h2UserNameHint){
          var hn=h2UserNameHint.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
          if(new RegExp(hn).test(surround)){userColor=candidateColor;break;}
        }
      }
    }
  }
  // 3) 清理颜色值，去除可能的结尾标点，补充 #
  if(userColor){
    userColor=userColor.replace(/[，。)\]}]+$/g,'').trim();
    if(/^[0-9a-fA-F]{6}$/.test(userColor))userColor='#'+userColor;
    if(/^[0-9a-fA-F]{3}$/.test(userColor))userColor='#'+userColor;
  }
  } // end if(!userColor) — 行号提取成功则跳过 cheerio 颜色查找

  // ===== 提取头图 =====
  var headerImgUrl='';
  var bannerSelectors=[
    'div.user-header, div.profile-header, div.header-banner, div.user-banner, div.top-banner, div.banner',
    'div#header, div.header, section.user-cover, .cover-image'
  ];
  var bannerEls=[];
  for(var bi=0;bi<bannerSelectors.length;bi++){
    $(bannerSelectors[bi]).each(function(){bannerEls.push($(this));});
  }
  for(var bj=0;bj<bannerEls.length;bj++){
    var bel=bannerEls[bj];
    var bStyle=bel.attr('style')||'';
    var bm=bStyle.match(/background-image\s*:\s*url\(["']?([^"')]+)["']?\)/i);
    if(bm&&bm[1]){headerImgUrl=bm[1];break;}
    var img=bel.find('img').first();
    if(img.length){
      var src=img.attr('src')||img.attr('data-src')||'';
      if(src){headerImgUrl=src;break;}
    }
  }
  // 兜底：如果 ojserver 有 header_image_url 字段会在 merge 时覆盖，这里不用再兜底

  var honorTitles=['超级大神犇','大神犇','大神','中犇','小犇','超级大研究员','大研究员','研究员','职业程序员','专家','远程家','程序员','初学者','学习者','Master','Grandmaster','Expert','Specialist','Pupil','Newbie','Legend','Candidate'];
  var _honorAc = ac.build(honorTitles);
  function _stripHonorTitles(s){
    var r=s||'';
    if (_honorAc && ac.test(r, _honorAc)) {
      var matches = ac.match(r, _honorAc);
      for (var hi = matches.length - 1; hi >= 0; hi--) {
        r = r.split(honorTitles[matches[hi]]).join('');
      }
    }
    return r.replace(/^\s*-\s*/,'').replace(/\s*-\s*$/,'').trim();
  }

  var userHtml=_userHtml_line||'';
  if (!_lineOk) {
    if(userLinkInH2.length){
      username=_stripHonorTitles(userLinkInH2.text().replace(/\(我\)/g,'').replace('（我）','')).trim();
      userHtml=userLinkInH2.html()||'';
      if(!userId){
        var href=userLinkInH2.attr('href')||'';
        var uidM=href.match(/[?&]id=(\d+)/);
        if(uidM)userId=uidM[1];
      }
    }
    if(!username){
      var allUserLinks=$('#content a[href*="user_show.php"]');
      if(!allUserLinks.length)allUserLinks=$('body a[href*="user_show.php"]');
      for(var i=0;i<allUserLinks.length;i++){
        var linkEl=$(allUserLinks[i]);
        if(linkEl.closest('footer, #footer, .footer, .foot, .copyright, .contrib, #foot, [id*="footer"], [class*="footer"], [class*="copyright"], [id*="contrib"], [class*="contrib"]').length)continue;
        var linkText=_stripHonorTitles(linkEl.text().replace(/\(我\)/g,'').replace('（我）','')).trim();
        if(linkText&&linkText.length>=2&&!honorTitles.includes(linkText)){
          username=linkText;
          if(!userHtml)userHtml=linkEl.html()||'';
          break;
        }
      }
    }
    if(!username||honorTitles.includes(username)){
      var h2Html=h2El.html()||'';
      var strongMatch=h2Html.match(/<strong[^>]*>([^<]+)<\/strong>/g)||[];
      for(var si=0;si<strongMatch.length;si++){
        var m=strongMatch[si].match(/<strong[^>]*>([^<]+)<\/strong>/);
        if(m){
          var possibleName=m[1].trim();
          if(!honorTitles.includes(possibleName)&&possibleName.length>=2){
            username=possibleName;
            break;
          }
        }
      }
      if(!username||honorTitles.includes(username)){
        var text=h2.replace(/id=\d+/g,'').trim();
        text=text.replace(/\([^)]*\)/g,'').replace(/\[[^\]]*\]/g,'').trim();
        text=text.replace(/[-&nbsp;\s\u00A0\u3000]+/g,' ').trim();
        var parts=text.split(/\s+/).filter(function(p){return p.length>0;});
        for(var pi=0;pi<parts.length;pi++){
          var part=parts[pi].trim();
          if(honorTitles.includes(part))continue;
          // 不跳过纯数字（可能是手机号用户名），但跳过明显是 UID 的短数字（≤4位且不等于整体文本）
          if(/^\d{1,4}$/.test(part)&&part!==text.replace(/\s/g,''))continue;
          if(part.length<2)continue;
          username=part;
          break;
        }
        if((!username||honorTitles.includes(username))&&parts.length>0){
          for(var pi2=parts.length-1;pi2>=0;pi2--){
            var part2=parts[pi2].trim();
            if(!honorTitles.includes(part2)&&!/^\d{1,4}$/.test(part2)&&part2.length>=2){
              username=part2;
              break;
            }
          }
          // 最后兜底：如果所有部分都是纯数字且没有提取到用户名，取最长的数字片段
          if(!username||honorTitles.includes(username)){
            var longest='';
            for(var pi3=0;pi3<parts.length;pi3++){
              var p3=parts[pi3].trim();
              if(p3.length>longest.length&&!/^[A-Za-z]+$/.test(p3)){
                longest=p3;
              }
            }
            if(longest)username=longest;
          }
        }
      }
    }
  }
  var realName=_realName_line||'',school=_school_line||'',email=_email_line||'',signature='',solvedCount=_solvedCount_line||0,submissionCount=_submissionCount_line||0,rank='';
  var fullText=$('body').text()||'';
  var fullHtml=$('html').text()||'';
  // 封禁用户检测：YZOJ 被封禁用户通常在页面会有明确关键字
  // 没有 username 或 uid 且页面含有 封禁/禁用/注销/不存在/无法查看 等关键字，才认为是封禁用户
  var isBanned=false;
  // 优先检测 "用户不存在" / "用户未找到" 的独立页面（不含用户数据）
  if(/用户不存在/.test(fullHtml)||/用户未找到/.test(fullHtml)||/不存在该用户/.test(fullHtml)){
    // 检查是否真的没解析到用户数据（说明是纯错误页面）
    if(!username&&!userId){return null;}
  }
  // 移除"未登录"，因为很多页面都可能包含这个词，不应该作为封禁判断依据
  var banKeywords=['封禁','禁用','注销','该用户已','账户已','账号已','无法查看','无权限查看','访问受限'];
  var _banAc = ac.build(banKeywords);
  // 排除 "不存在" 在第一轮检查，后面单独处理
  if (_banAc && (ac.test(fullText, _banAc) || ac.test(fullHtml, _banAc))) { isBanned = true; }
  // 独立检查 "不存在"：只在主要内容区域中出现时才触发
  if(!isBanned){
    var contentText=$('#content').text()||'';
    if(contentText.includes('不存在')){isBanned=true;}
  }
  // 如果已经解析到用户名或用户ID，说明用户正常存在，不应判定为封禁
  if(isBanned&&(username||userId)){isBanned=false;}
  // 如果 h2 中找不到 user_show 链接，且整个页面也找不到 user_show 链接（登录状态下的用户页一般不应该），也视为异常状态
  if(!isBanned){
    var anyUserLink=$('a[href*="user_show.php"]');
    var hasTable=$('#tablelist').length>0;
    // 只有在既没有用户链接，又没有表格数据，又没有用户名和ID时，才认为是封禁
    if(!anyUserLink.length&&!hasTable&&!username&&!userId){isBanned=true;}
  }
  var solvedProblems=[];
  var recentSubmissions=[];
  var activityData=[];
  var bioHtml='';var bioText='';
  var contentDiv=$('#content');
  // ===== 解析用户信息表格（info） =====
  // 遍历所有 #tablelist，先找用户信息表（通常在内容区最上面的窄表）
  var infoRows=[];
  var infoTable=null;
  var contentTablelist=contentDiv.find('table#tablelist');
  var candidates=contentTablelist.length?contentTablelist:$('#tablelist');
  candidates.each(function(){
    var tbl=$(this);
    if(tbl.closest('#ftoolbarshow').length>0)return true;
    var thRow=tbl.find('tr').first();
    var headers=thRow.find('th,td').map(function(){return $(this).text().trim();}).get();
    var hasInfoCol=false;
    headers.forEach(function(h){if(/真实姓名|学校|E-mail|提交次数|解决题数|签名|用户组|注册时间|Rating|积分|排名/.test(h))hasInfoCol=true;});
    var firstTds=tbl.find('tr').first().find('td');
    if(firstTds.length<2&&!hasInfoCol){
      // 检查第二行
      var secTr=tbl.find('tr').eq(1).find('td');
      if(secTr.length>=2){
        var l0=secTr.eq(0).text().trim();
        if(/真实姓名|学校|E-mail|提交次数|解决题数|签名|用户组|注册时间|Rating|积分|排名/.test(l0))hasInfoCol=true;
      }
    }
    if(hasInfoCol){infoTable=tbl;return false;}
  });
  if(infoTable){
    infoTable.find('tr').each(function(){
      var cells=$(this).find('td');
      if(cells.length<2)return;
      for(var ci=0;ci<cells.length-1;ci+=2){
        var label=cells.eq(ci).text().trim();var value=cells.eq(ci+1).text().trim();
        if(!label)continue;
        infoRows.push({label:label,value:value,cells:cells,idx:ci+1});
        if(label.includes('真实姓名'))realName=value;
        else if(/提交次数/.test(label)){
          var sm=value.match(/(\d+)/);submissionCount=sm?parseInt(sm[1]):0;
        }
        else if(/解决题数|已解决|通过题数/.test(label)){
          var sm=value.match(/(\d+)/);solvedCount=sm?parseInt(sm[1]):0;
        }
        else if(/学校|学院|班级/.test(label))school=value;
        else if(/E-mail|邮箱/.test(label))email=value;
        else if(/签名|个性签名|个人签名/.test(label))signature=value;
        else if(/排名|Rank|名次/.test(label)){
          var rm=value.match(/(\d+)/);rank=rm?rm[1]:value;
        }
      }
    });
  }
  // ===== 用户组/权限判断封禁：用户组值为负数则为封禁 =====
  if(!isBanned){
    for(var ri=0;ri<infoRows.length;ri++){
      if(/用户组|权限|身份/.test(infoRows[ri].label)){
        var permVal=infoRows[ri].value.replace(/[Lv.]/g,'').trim();
        var permNum=parseInt(permVal);
        if(!isNaN(permNum)&&permNum<0){
          isBanned=true;
        }
        break;
      }
    }
  }
  // ===== 解析"已解决题目列表" =====
  // YZOJ 通常有两种结构：a) 单独的#acl div b) 另一个独立表格包含大量problem_show链接
  var solvedArea=null;
  var aclDiv=$('#acl');
  if(aclDiv.length){solvedArea=aclDiv;}
  else{
    // 找包含problem_show链接最多的表格，且不是 infoTable（infoTable 中 solved 很少）
    var infoId=infoTable?infoTable.attr('id')+'_'+infoTable.find('tr').length:'';
    var best=null;var bestCount=-1;
    $('table').each(function(){
      var tbl=$(this);
      if(tbl.closest('#ftoolbarshow').length>0)return true;
      if(infoTable&&tbl.is(infoTable))return true;
      var links=tbl.find('a[href*="problem_show.php"]');
      var userLinks=tbl.find('a[href*="user_show.php"]');
      var sc=links.length*10-userLinks.length*2;
      if(links.length>=3&&sc>bestCount){bestCount=sc;best=tbl;}
    });
    solvedArea=best;
  }
  if(solvedArea){
    solvedArea.find('a[href*="problem_show.php"]').each(function(){
      var a=$(this);
      var href=a.attr('href')||'';
      var pidMatch=href.match(/id=(\d+)/);
      var _pidM2 = a.text().trim().match(/^P?(\d+)/);
      var pid=pidMatch?pidMatch[1]:((_pidM2?_pidM2[1]:'')||'');
      if(!pid)return;
      var pText=a.text().trim();
      var pName=pText;
      if(/^P?\d+/.test(pText)){
        var sp=pText.split(/\s/);if(sp.length>1)pName=sp.slice(1).join(' ').trim()||pText;
      }
      var pUrl=b+'/OnlineJudge/'+(href.startsWith('http')||href.startsWith('/')?href.replace(/^\/+/,''):href);
      if(!href) pUrl=b+'/OnlineJudge/problem_show.php?id='+pid;
      var already=false;
      for(var si=0;si<solvedProblems.length;si++){if(solvedProblems[si].id===pid){already=true;break;}}
      var pNameHtml = a.html() || pName;
      if(!already)solvedProblems.push({id:pid,name:pName,nameHtml:pNameHtml,url:pUrl});
    });
  }
  // 如果 solvedProblems 仍空，兜底从 info 表格第三列中取
  if(solvedProblems.length===0&&infoTable){
    infoTable.find('a[href*="problem_show.php"]').each(function(){
      var href=$(this).attr('href')||'';
      var pidMatch=href.match(/id=(\d+)/);
      var pid=pidMatch?pidMatch[1]:'';
      if(pid){
        var pName=$(this).text().trim();
        solvedProblems.push({id:pid,name:pName,url:b+'/OnlineJudge/'+href});
      }
    });
  }
  // 确保 solvedCount 至少等于已解决列表长度
  if(solvedProblems.length>0&&(!solvedCount||solvedCount<solvedProblems.length)){
    solvedCount=solvedProblems.length;
  }
  // ===== 解析活动数据 (Morris.Area) =====
  var scriptContent=$('script').filter(function(){
    return $(this).text().includes('Morris.Area');
  }).first().text();
  if(scriptContent){
    var dataStart=scriptContent.indexOf('data: [');
    if(dataStart!=-1){
      var dataEnd=scriptContent.indexOf('],', dataStart);
      if(dataEnd===-1){
        dataEnd=scriptContent.indexOf(']', dataStart);
      }
      if(dataEnd!=-1){
        try{
          var rawStr=scriptContent.substring(dataStart+6, dataEnd+1);
          var jsonStr=rawStr.replace(/(\{|\,)\s*([a-zA-Z_\-][a-zA-Z0-9_\-]*)\s*:/g, '$1"$2":').replace(/,\s*\]/g, ']');
          activityData=JSON.parse(jsonStr).slice(-12);
        }catch(e){}
      }
    }
  }
  // ===== 解析 bio/介绍 =====
  var introBlock=$('div.user-intro, div.intro, div.bio, div.description, div.profile-bio, div.userinfo, #user-intro');
  if(introBlock.length){
    var tmp=introBlock.first().clone();
    tmp.find('script,style,table#tablelist,form,input,button').remove();
    bioHtml=tmp.html()||'';
    bioText=tmp.text().trim();
  }else if(contentDiv.length){
    // 找标题为介绍/个人说明/简介的 h3/h2 块
    var heading=null;
    contentDiv.find('h2,h3').each(function(){
      var t=$(this).text().trim();
      if(/个人简介|个人介绍|简介|自我介绍|About|Signature|个人说明/.test(t)){heading=$(this);return false;}
    });
    if(heading){
      var bioParts=[];var bioHtmlParts=[];
      heading.nextAll().each(function(){
        var n=$(this);
        if(n.is('h2,h3'))return false;
        bioParts.push(n.text().trim());
        bioHtmlParts.push(n.html?n.html():'');
      });
      bioText=bioParts.join('\n').trim();
      bioHtml=bioHtmlParts.join('\n').trim();
    }
  }
  if(!signature&&bioText){signature=bioText.slice(0,80);}
  // 封禁用户：标记为已封禁，前端显示灰色
  if(isBanned&&solvedCount>=0){solvedCount=-2;}
  return{
    id:userId,
    username:username,
    nickname:realName||username,
    realName:realName,
    school:school,
    email:email,
    signature:signature,
    bio:bioText,
    bio_html:bioHtml,
    solvedCount:solvedCount,
    submissionCount:submissionCount,
    rank:rank,
    solvedProblems:solvedProblems,
    recentSubmissions:recentSubmissions,
    activityData:activityData,
    isBanned:isBanned,
    color:userColor||'',
    userHtml:userHtml||'',
    header_image_url:headerImgUrl||'',
    headerImg:headerImgUrl||''
  };
}

function parseSolutionsPage(html,b,page){
  var $=require('cheerio').load(html);
  var solutions=[];
  var title=$('h2').first().text().trim()||'';
  var contentDiv=$('#content');
  var tables=contentDiv.length?contentDiv.find('table#tablelist'):$('table#tablelist');
  tables.each(function(){
    var tbl=$(this);
    if(tbl.closest('#ftoolbarshow').length>0)return;
    var th=tbl.find('th').first();
    var headerText=th.text().trim();
    if(!headerText.match(/^#\d+楼/))return;
    var floorMatch=headerText.match(/^#(\d+)楼/);
    var floor=floorMatch?floorMatch[1]:'';
    var author='';
    var authorId='';
    var authorLink=th.find('a[href*="user_show.php"]').first();
    if(authorLink.length){
      author=authorLink.text().trim();
      var href=authorLink.attr('href')||'';
      var idMatch=href.match(/[?&]id=(\d+)/);
      if(idMatch)authorId=idMatch[1];
    }else{
      var authorMatch=headerText.match(/^#\d+楼\s+(.+?)\s+发表于/);
      if(authorMatch)author=authorMatch[1];
    }
    var timeMatch=headerText.match(/发表于\s+(.+)$/);
    var time=timeMatch?timeMatch[1]:'';
    var td=tbl.find('td').first();
    var contentHtml=td.html()||'';
    var contentText=td.text().trim();
    contentHtml=contentHtml.replace(/<script[\s\S]*?<\/script>/gi,'').replace(/<style[\s\S]*?<\/style>/gi,'');
    solutions.push({
      id:floor,
      title:'#'+floor+'楼 - '+author,
      author:author,
      authorId:authorId,
      time:time,
      floor:floor,
      contentHtml:contentHtml,
      content:contentText,
      url:''
    });
  });
  if(solutions.length===0){
    var contentHtml=$('#content').html()||'';
    contentHtml=contentHtml.replace(/<script[\s\S]*?<\/script>/gi,'').replace(/<style[\s\S]*?<\/style>/gi,'');
    var text=$('#content').text().trim();
    if(text){
      solutions.push({id:'',title:'题解',author:'',time:'',contentHtml:contentHtml,content:text});
    }
  }
  var currentPage=(page||0)+1,totalPages=1;
  var paginationP=contentDiv.find('p[align="center"]').first();
  if(paginationP.length){
    var maxPage=0;
    paginationP.find('a').each(function(){
      var href=$(this).attr('href')||'';
      var pm=href.match(/page=(\d+)/);
      if(pm){
        var pp=parseInt(pm[1]);
        if(pp>maxPage)maxPage=pp;
      }
    });
    totalPages=maxPage+1;
  }
  return{solutions:solutions,problemTitle:title,currentPage:currentPage,totalPages:totalPages};
}

function parseProblemStatusPage(html,b){
  var $=require('cheerio').load(html);
  var records=[];
  var dataTable=null;
  $('table#tablelist').each(function(){
    var tbl=$(this);
    var ths=tbl.find('tr').first().find('th');
    if(ths.length>=5){
      var firstTh=ths.first().text().trim();
      if(firstTh==='#'||firstTh.includes('编号')){
        dataTable=tbl;
        return false;
      }
    }
  });
  if(!dataTable)return{records:records};
  var headerRow=dataTable.find('tr').first();
  var ths=headerRow.find('th');
  var colMap={idx:-1,id:-1,user:-1,time:-1,memory:-1,codelen:-1,compiler:-1,submittime:-1};
  ths.each(function(i){
    var t=$(this).text().trim();
    if(t==='#')colMap.idx=i;
    if(t.includes('记录ID')||t.includes('ID')||t.includes('编号'))colMap.id=i;
    if(t.includes('用户')||t.includes('user'))colMap.user=i;
    if(t.includes('总耗时')||(t.includes('时间')&&!t.includes('提交')))colMap.time=i;
    if(t.includes('内存')||t.includes('memory'))colMap.memory=i;
    if(t.includes('代码长度')||t.includes('长度'))colMap.codelen=i;
    if(t.includes('编译器')||t.includes('语言')||t.includes('compiler'))colMap.compiler=i;
    if(t.includes('提交时间')||t.includes('提交'))colMap.submittime=i;
  });
  dataTable.find('tr').each(function(ri){
    if(ri===0)return;
    var tds=$(this).find('td');
    if(tds.length<5)return;
    var get=function(idx){if(idx>=0&&idx<tds.length){var el=tds.eq(idx);return {text:el.text().trim(),html:el.html()||'',a:el.find('a').first()};}return{text:'',html:'',a:null};};
    var idCell=get(colMap.id>=0?colMap.id:1);
    var sid=idCell.a.length?idCell.a.text().trim():idCell.text;
    if(!sid||!sid.match(/\d+/))return;
    var userCell=get(colMap.user>=0?colMap.user:2);
    var user=userCell.a.length?userCell.a.text().trim():userCell.text;
    var userId='';
    if(userCell.a.length){
      var uHref=userCell.a.attr('href')||'';
      var uidM=uHref.match(/[?&]id=(\d+)/);
      if(uidM) userId=uidM[1];
    }
    var userColor='';
    var userHtml=userCell.html;
    if(userHtml){
      var styleM=userHtml.match(/color\s*:\s*([^;"'`<>]+)/i);
      if(styleM) userColor=styleM[1].trim();
    }
    var timeCell=get(colMap.time>=0?colMap.time:3);
    var memCell=get(colMap.memory>=0?colMap.memory:4);
    var compilerCell=get(colMap.compiler>=0?colMap.compiler:6);
    var submitTimeCell=get(colMap.submittime>=0?colMap.submittime:7);
    records.push({
      id:sid,user:user,userId:userId,userColor:userColor,userHtml:userHtml,
      time:timeCell.text,
      memory:memCell.text,compiler:compilerCell.text,
      submitTime:submitTimeCell.text,
      score:'',status:''
    });
  });
  return{records:records};
}

function parseSolutionDetail(html,_b){
  var $=require('cheerio').load(html);
  var title=$('h2').first().text().trim();
  var author='',created_at='',content='',content_html='',problem_id='';
  var metaText=$('.sol-meta, .meta, #content font').first().text()||'';
  var m=metaText.match(/(\S+)\s+\u00B7\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/);
  if(m){author=m[1];created_at=m[2];}
  var contentDiv=$('#content');
  if(contentDiv.length){
    var tmp=contentDiv.clone();
    tmp.find('script,style').remove();
    content_html=tmp.html()||'';
    content=tmp.text().trim();
  }else{
    content_html=$('body').html()||'';
    content=$('body').text().trim();
  }
  var urlMatch=html.match(/problem_show\.php\?id=(\d+)/);
  if(urlMatch)problem_id=urlMatch[1];
  return{title:title,author:author,created_at:created_at,content:content,content_html:content_html,problem_id:problem_id};
}

function parseRanklist(html, baseUrl, requestedPage) {
  var $=require('cheerio').load(html);
  var records=[];
  function extractColorFromStyle(style){
    if(!style)return '';
    var m=style.match(/color\s*:\s*([^;!"'`<>]+)/i);
    if(!m)return '';
    var c=m[1].trim().replace(/[,，。\]}]+$/g,'').trim();
    if(c&&/^[0-9a-fA-F]{6}$/.test(c))c='#'+c;
    if(c&&/^[0-9a-fA-F]{3}$/.test(c))c='#'+c;
    return c;
  }
  var dataTable=null;
  var contentTablelist=$('#content').length?$('#content').find('table#tablelist'):$('#tablelist');
  var candidates=[];
  contentTablelist.each(function(){
    var tbl=$(this);
    if(tbl.closest('#ftoolbarshow').length>0)return true;
    var thRow=tbl.find('tr').first();
    var ths=thRow.find('th');
    if(ths.length>=5){
      var firstTh=ths.first().text().trim();
      var tblText=ths.text();
      var score=0;
      if(firstTh==='#'||firstTh.includes('排名'))score+=10;
      if(tblText.includes('用户名')||tblText.includes('用户'))score+=8;
      if(tblText.includes('Level')||tblText.includes('Lv')||tblText.includes('等级'))score+=5;
      if(tblText.includes('解决')||tblText.includes('Solved')||tblText.includes('已解决'))score+=5;
      if(tblText.includes('尝试')||tblText.includes('提交次数')||tblText.includes('Submission'))score+=5;
      if(tblText.includes('通过率')||tblText.includes('比率')||tblText.includes('Ratio'))score+=5;
      if(tbl.find('a[href*="user_show.php"]').length>0)score+=15;
      if(score>=10)candidates.push({tbl:tbl,score:score,ncol:ths.length});
    }
  });
  if(!dataTable && candidates.length>0){
    candidates.sort(function(a,b){return b.score-a.score;});
    dataTable=candidates[0].tbl;
  }
  if(!dataTable){
    var allTables=$('table#tablelist').not('#ftoolbarshow table#tablelist');
    var bestScore=0;
    allTables.each(function(){
      var tbl=$(this);
      var ths=tbl.find('tr').first().find('th');
      if(ths.length<5)return true;
      var sc=0;
      if(tbl.find('a[href*="user_show.php"]').length>0)sc+=30;
      var thText=ths.text();
      if(ths.first().text().trim()==='#')sc+=5;
      if(thText.includes('用户名')||thText.includes('解决')||thText.includes('通过率'))sc+=5;
      if(sc>bestScore){bestScore=sc;dataTable=tbl;}
    });
  }
  if(!dataTable)return{records:records,currentPage:1,totalPages:1};

  var colMap={rank:-1,level:-1,username:-1,realname:-1,solved:-1,submitted:-1,ratio:-1};
  var thCount=0;
  dataTable.find('tr').first().find('th').each(function(i){
    thCount++;
    var t=$(this).text().trim();
    if(t==='#'||t.includes('排名')){if(colMap.rank===-1)colMap.rank=i;}
    if(t==='Level'||t.includes('等级')||(t.length<=5&&t.indexOf('Lv')===0)){if(colMap.level===-1)colMap.level=i;}
    if(t.includes('用户名')||(t.length<=4&&t.includes('用户')&&!t.includes('数'))||t==='Name'){
      if(colMap.username===-1)colMap.username=i;else if(colMap.realname===-1)colMap.realname=i;
    }
    if(t.includes('真实姓名')||(t.length<=3&&t==='姓名')){colMap.realname=i;}
    if(t.includes('解决')||t.includes('Solved')||t.includes('已解决')){if(colMap.solved===-1)colMap.solved=i;}
    if(t.includes('尝试')||t.includes('提交次数')||t.includes('Submission')){if(colMap.submitted===-1)colMap.submitted=i;}
    if(t.includes('通过率')||t.includes('比率')||t.includes('Ratio')){if(colMap.ratio===-1)colMap.ratio=i;}
  });
  if(thCount>=6&&thCount<=8){
    if(thCount===7){
      if(colMap.rank===-1)colMap.rank=0;
      if(colMap.level===-1)colMap.level=1;
      if(colMap.username===-1)colMap.username=2;
      if(colMap.realname===-1)colMap.realname=3;
      if(colMap.solved===-1)colMap.solved=4;
      if(colMap.submitted===-1)colMap.submitted=5;
      if(colMap.ratio===-1)colMap.ratio=6;
    }else if(thCount===6){
      if(colMap.rank===-1)colMap.rank=0;
      if(colMap.username===-1)colMap.username=1;
      if(colMap.realname===-1)colMap.realname=2;
      if(colMap.solved===-1)colMap.solved=3;
      if(colMap.submitted===-1)colMap.submitted=4;
      if(colMap.ratio===-1)colMap.ratio=5;
    }else if(thCount===8){
      if(colMap.rank===-1)colMap.rank=0;
      if(colMap.level===-1)colMap.level=1;
      if(colMap.username===-1)colMap.username=2;
      if(colMap.realname===-1)colMap.realname=3;
      if(colMap.solved===-1)colMap.solved=5;
      if(colMap.submitted===-1)colMap.submitted=6;
      if(colMap.ratio===-1)colMap.ratio=7;
    }
  }else{
    if(colMap.rank===-1)colMap.rank=0;
    if(colMap.username===-1)colMap.username=2;
  }

  dataTable.find('tr').each(function(ri){
    if(ri===0)return;
    var row=$(this);
    if(row.find('th').length>0)return;
    var tds=row.find('td');
    if(tds.length<4)return;
    function getCell(idx){if(idx<0||idx>=tds.length)return {text:'',html:'',a:null,el:tds.eq(0)};var el=tds.eq(idx);return{text:el.text().trim(),html:el.html()||'',a:el.find('a[href*="user_show.php"]').first(),el:el};}
    var rankCell=getCell(colMap.rank);
    var rank=rankCell.text;
    var levelCell=colMap.level>=0?getCell(colMap.level):{text:'',html:'',a:null,el:null};
    var level='';
    if(levelCell.el){
      var lvEl=levelCell.el.find('strong,span').first();
      if(lvEl.length)level=lvEl.text().trim();
      if(!level)level=levelCell.text;
    }

    var userCell=getCell(colMap.username);
    var userLinkInCell=null;
    if(userCell.el){
      var uAs=userCell.el.find('a[href*="user_show.php"]');
      if(uAs.length)userLinkInCell=uAs.first();
    }
    var username='';
    var userId='';
    var userHtml='';
    if(userLinkInCell&&userLinkInCell.length){
      username=cln(userLinkInCell.text());
      var hr=userLinkInCell.attr('href')||'';
      var idMm=hr.match(/[?&]id=(\d+)/);
      if(idMm)userId=idMm[1];
      // 提取用户链接内部的HTML（保留多色span等格式）
      var innerHtml=userLinkInCell.html()||'';
      userHtml=innerHtml.replace(/<\/?(strong|b|i|u|em|span|font)[^>]*>/gi,function(m){return m;}).trim();
    }else{
      username=cln(userCell.text);
    }
    username=String(username||'').replace(/\s+\d+(\.\d+)?\s*$/,'').trim();
    username=username.replace(/\u00a0.*$/,'').trim();

    var userColor='';
    var colorCandidates=[];
    if(userLinkInCell&&userLinkInCell.length){
      colorCandidates.push(userLinkInCell.attr('style')||'');
      userLinkInCell.find('span,strong,font').each(function(){colorCandidates.push($(this).attr('style')||'');});
      colorCandidates.push(userCell.el.attr('style')||'');
      userCell.el.find('span,strong,font').each(function(){colorCandidates.push($(this).attr('style')||'');});
    }
    for(var ci2=0;ci2<colorCandidates.length;ci2++){
      var cc=extractColorFromStyle(colorCandidates[ci2]);
      if(cc){userColor=cc;break;}
    }
    if(!userColor&&userCell.html){
      var colPat=/style\s*=\s*["'][^"']*?color\s*:\s*([^"';\s!]+)/ig;
      var colMatch;
      while((colMatch=colPat.exec(userCell.html))!==null){
        if(colMatch[1]){
          var candCol=colMatch[1].replace(/[,，。\]}]+$/g,'').trim();
          if(/^#[0-9a-fA-F]{3,8}$|^[a-zA-Z]{3,20}$|^rgb/.test(candCol)||/^[0-9a-fA-F]{6}$/.test(candCol)){
            if(/^[0-9a-fA-F]{6}$/.test(candCol))candCol='#'+candCol;
            if(/^[0-9a-fA-F]{3}$/.test(candCol))candCol='#'+candCol;
            userColor=candCol;break;
          }
        }
      }
    }

    var realnameCell=colMap.realname>=0?getCell(colMap.realname):{text:''};
    var realname=realnameCell.text;
    var solvedCell=colMap.solved>=0?getCell(colMap.solved):{text:'0'};
    var solved=cln(solvedCell.text).replace(/[^\d]/g,'');
    var submittedCell=colMap.submitted>=0?getCell(colMap.submitted):{text:'0'};
    var submitted=cln(submittedCell.text).replace(/[^\d]/g,'');
    var ratioCell=colMap.ratio>=0?getCell(colMap.ratio):{text:''};
    var ratio=cln(ratioCell.text);

    if((username&&userId)||rank){
      records.push({
        rank:rank,
        level:level,
        userId:userId,
        username:username,
        nickname:realname,
        realname:realname,
        solved:solved||'0',
        submitted:submitted||'0',
        ratio:ratio,
        color:userColor,
        userColor:userColor,
        userHtml:userHtml,
        solvedCount:parseInt(solved)||0
      });
    }
  });

  var cp=(requestedPage!=null&&!isNaN(requestedPage))?parseInt(requestedPage):1,tp=1;
  var pagiP=$('#pagelist').last();
  if(!pagiP.length)pagiP=$('p[align="center"],p[style*="text-align: center"],p[style*="text-align:center"]').last();
  if(pagiP.length){
    var links=pagiP.find('a[href*="page="]');
    var maxP=0;
    var firstHref='';
    if(links.length>0){
      firstHref=links.first().attr('href')||'';
    }
    links.each(function(){
      var href2=$(this).attr('href')||'';
      var mm3=href2.match(/page=(\d+)/);
      if(mm3){
        var pn=parseInt(mm3[1]);if(pn>maxP)maxP=pn;
      }
      var at=$(this).text().trim();
      var rangeM=at.match(/(\d+)\s*-\s*\d+/);
      if(rangeM){
        var firstNum=parseInt(rangeM[1]);
        var pguess=Math.ceil(firstNum/50);
        if(pguess>maxP)maxP=pguess;
      }
    });
    tp=Math.max(maxP,1,cp);
    if(!requestedPage){
      var curM=pagiP.text().match(/第\s*(\d+)\s*页/);
      if(curM&&curM[1]){cp=parseInt(curM[1]);}
      else{
        var firstPageMatch=firstHref.match(/page=(\d+)/);
        if(firstPageMatch){cp=parseInt(firstPageMatch[1])||1;}
        if(tp>=2&&cp>=tp){cp=1;}
      }
    }
  }
  return{records:records,currentPage:cp,totalPages:tp};
}

function parseProblemPassStatus(html) {
  var $ = require('cheerio').load(html);
  var mark = '';
  // 找所有包含"状态："的文本块 / td / div / 中心块
  // 模式 1: <td>状态：<a href="status_details.php?id=xx"><span style="color:green">已通过</span></a></td>
  // 查找所有含"状态："的元素，取文本最短的（最内层/最具体），避免匹配到外层大容器
  var statusCells = $('td, div, center, p').filter(function() {
    var txt = $(this).clone().find('script,style').remove().end().text();
    return /状态\s*[：:]/.test(txt);
  });
  // 手动找出文本最短的元素（cheerio 无 sort 方法）
  var shortestEl = null, shortestLen = Infinity;
  statusCells.each(function() {
    var len = $(this).clone().find('script,style').remove().end().text().length;
    if (len < shortestLen) { shortestLen = len; shortestEl = this; }
  });
  statusCells = shortestEl ? $(shortestEl) : statusCells.first();
  var statusHtml = '';
  var statusText = '';
  if (statusCells.length) {
    statusHtml = statusCells.html() || '';
    statusText = statusCells.text().replace(/\s+/g,'');
  }
  if (!statusText) {
    // fallback: 正则直接抓
    var m = html.match(/状态\s*[：:]\s*([\s\S]*?)(?:<\/td>|<\/div>|<\/p>|<\/center>|标签\s*[：:]|$)/i);
    if (m && m[1]) {
      statusHtml = m[1];
      statusText = String(m[1]).replace(/<[^>]*>/g,'').replace(/\s+/g,'');
    }
  }
  if (statusText) {
    // 去掉"状态："前缀再分析
    var cleanStatus = statusText.replace(/^状态\s*[：:]\s*/, '');
    // 只保留"标签"之前的状态值，去除同一容器中其他字段的干扰
    cleanStatus = cleanStatus.split(/[：:]\s*标签/)[0].trim();
    // 优先检测"未提交"/"尚未尝试"
    if (/^未提交/.test(cleanStatus) || /尚未尝试|未尝试/.test(cleanStatus)) {
      mark = '';
    } else if (/未通过/.test(statusText)) {
      mark = 'attempted';
    } else if (/已通过|Accept|正确通过/.test(statusText)) {
      mark = 'ac';
    } else if (/错误答案|Wrong|TimeLimit|MemoryLimit|Runtime|OutputLimit|Compile|Presentation|运行超时|超内存|未提交过/.test(statusText)) {
      mark = 'attempted';
    } else if (/^通过$/.test(cleanStatus)) {
      mark = 'ac';
    } else if (/[无未]提交|未做题/.test(statusText)) {
      mark = '';
    } else if (statusHtml && /color\s*:\s*green/i.test(statusHtml)) {
      mark = 'ac';
    } else if ((statusHtml && /status_details\.php|status\.php/.test(statusHtml)) || /尝试过|Attempted|Failed/.test(statusText)) {
      mark = 'attempted';
    }
  }
  return mark;
}

module.exports={parseHomepage:parseHomepage,parsePracticeProblem:parsePracticeProblem,parseContestProblem:parseContestProblem,parseStatusDetail:parseStatusDetail,parseStatusPage:parseStatusPage,parseProblemListPage:parseProblemListPage,parseTagList:parseTagList,parseScheduledContests:parseScheduledContests,parseActiveContests:parseActiveContests,parsePastContests:parsePastContests,parseContestDetail:parseContestDetail,parseContestResult:parseContestResult,parseDiscussionList:parseDiscussionList,parseDiscussionShow:parseDiscussionShow,parseDiscussionPosts:parseDiscussionPosts,parseProblemDiscussionPage:parseProblemDiscussionPage,parseUserPage:parseUserPage,parseSolutionsPage:parseSolutionsPage,parseSolutionDetail:parseSolutionDetail,parseProblemStatusPage:parseProblemStatusPage,parseRanklist:parseRanklist,parseProblemPassStatus:parseProblemPassStatus,escapeHtml:esc};