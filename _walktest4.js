// -*- coding: utf-8 -*-
// Stage 2c AI 对练 walkthrough: validates DOM, modal open, scenario load,
// proxy-call wiring, and CRITICALLY that NO API key ever reaches the browser.
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');
const html = fs.readFileSync('index.html', 'utf-8');
const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => errors.push('jsdomError: ' + (e.detail || e.message)));
vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

// File-level key-leakage guard (the key must NEVER appear in the static bundle)
const leak = html.match(/GLM_API_KEY|apiKey|api_key|Bearer\s|sk-[A-Za-z0-9]{12,}/);
if (leak) errors.push('KEY LEAK IN FILE: ' + leak[0]);

const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true,
  url: 'https://ruanqiaoyun0-a11y.github.io/cc-tw-afterclass-sop-cn/',
  virtualConsole: vc,
  beforeParse(window) {
    window.scrollTo = () => {};
    if (window.HTMLElement) window.HTMLElement.prototype.scrollIntoView = () => {};
    window.print = () => {};
    // Controllable fetch mock that records calls and inspects the body for keys.
    // State lives on window.__mock so the in-page eval can read it.
    window.__mock = { calls: 0, lastUrl: null, lastBody: null };
    window.fetch = function(url, opts) {
      window.__mock.calls++;
      window.__mock.lastUrl = url;
      window.__mock.lastBody = opts && opts.body ? opts.body : '';
      const isScore = (url || '').indexOf('/score') >= 0;
      const payload = isScore
        ? { dims: {'流程完整度':18,'报告解读':17,'产品匹配':15,'异议处理':15,'多次软关单':13,'沟通共情':12}, total: 90, weak: [], comment: '整体不错' }
        : { reply: '家长：那我再考虑一下。' };
      return Promise.resolve({ json: () => Promise.resolve(payload) });
    };
  }
});
const steps = []; let pass = true;
function ok(n,c,e){ steps.push((c?'PASS':'FAIL')+' | '+n+(e?(' | '+e):'')); if(!c) pass=false; }
function run() {
  const w = dom.window;
  w.eval(`(function(){
    globalThis.__R={steps:[],pass:true};
    function ok(n,c,e){ globalThis.__R.steps.push((c?'PASS':'FAIL')+' | '+n+(e?(' | '+e):'')); if(!c) globalThis.__R.pass=false; }

    ok('AI FAB 存在', !!document.getElementById('aiFab'));
    ok('AI Modal 存在', !!document.getElementById('aiModal'));
    ok('代理地址输入框存在', !!document.getElementById('aiProxyUrl'));
    ok('场景按钮=3个', document.querySelectorAll('.ai-scen button').length === 3, '实际='+document.querySelectorAll('.ai-scen button').length);
    ok('聊天区存在', !!document.getElementById('aiChat'));
    ok('评分区存在', !!document.getElementById('aiScore'));
    ok('输入框存在', !!document.getElementById('aiInput'));

    // open
    aiOpen();
    ok('aiOpen 打开弹窗(open class)', document.getElementById('aiModal').classList.contains('open'));
    ok('aiOpen 自动载入首个场景', !!aiScenario && aiScenario.title && document.getElementById('aiChat').innerHTML.indexOf(aiScenario.title) >= 0);

    // pick scenario 1
    aiPickScenario(1);
    ok('aiPickScenario(1) 切换场景', aiScenario === finalScenarios[1]);
    ok('场景按钮高亮切换', document.querySelectorAll('.ai-scen button')[1].classList.contains('active'));

    // no proxy -> aiSend should warn and NOT call fetch
    aiProxyUrl = '';
    var before = window.__mock.calls;
    aiSend();
    ok('无代理->aiSend 不发请求', window.__mock.calls === before);

    // set proxy, send a message
    aiProxyUrl = 'http://localhost:3000';
    aiHistory = [];
    document.getElementById('aiInput').value = '您好，我是暖暖的顾问老师';
    aiSend();
    ok('有代理->aiSend 调用代理/chat', window.__mock.calls > before && (window.__mock.lastUrl||'').indexOf('/chat') >= 0);
    ok('请求体含 scenario+history', /scenario/.test(window.__mock.lastBody||'') && /history/.test(window.__mock.lastBody||''));
    ok('请求体无密钥字段', !/apiKey|api_key|GLM_API_KEY|Bearer|sk-/.test(window.__mock.lastBody||''));

    // aiEndScore with too-short history
    aiHistory = [{role:'user',content:'hi'}];
    var b2 = window.__mock.calls;
    aiEndScore();
    ok('历史过短->aiEndScore 不发请求', window.__mock.calls === b2);

    // aiEndScore with enough history + proxy
    aiHistory = [
      {role:'user', content:'您好，我是顾问'},
      {role:'assistant', content:'家长：你好'},
      {role:'user', content:'这次报告进步很大'}
    ];
    aiEndScore();
    ok('有代理+足够历史->aiEndScore 调用代理/score', (window.__mock.lastUrl||'').indexOf('/score') >= 0);
    ok('评分请求体含 transcript', /transcript/.test(window.__mock.lastBody||''));
    ok('评分请求体无密钥字段', !/apiKey|api_key|GLM_API_KEY|Bearer|sk-/.test(window.__mock.lastBody||''));
  })()`);
  setTimeout(function(){
    const R = dom.window.__R; steps.push(...R.steps); if(!R.pass) pass=false;
    try { dom.window.eval('if (typeof timerInterval!=="undefined" && timerInterval) clearInterval(timerInterval);'); } catch(e){}
    console.log('===== STAGE2c AI 对练 REPORT =====');
    steps.forEach(s=>console.log(s));
    console.log('===== ERRORS ('+errors.length+') ====='); errors.forEach(e=>console.log(e));
    console.log('===== OVERALL: '+(pass&&errors.length===0?'ALL PASS ✅':'HAS FAILURES ❌')+' =====');
    try { dom.window.close(); } catch(e){}
    process.exit(pass&&errors.length===0?0:1);
  }, 800);
}
dom.window.addEventListener('DOMContentLoaded', () => setTimeout(run, 120));
setTimeout(() => { if (!dom.window.__done) { dom.window.__done=true; run(); } }, 6000);
