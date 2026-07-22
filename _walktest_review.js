const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');
const html = fs.readFileSync('index.html', 'utf8');
let errors = 0, checks = 0;
function ok(name, cond) { checks++; if (!cond) { errors++; console.log('FAIL: ' + name); } else { console.log('PASS: ' + name); } }

const vc = new VirtualConsole();
vc.on('jsdomError', e => { errors++; console.log('JSDOM_ERR: ' + (e.detail || e.message)); });
vc.on('error', (...a) => { errors++; console.log('CONSOLE_ERR: ' + a.join(' ')); });

const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true,
  url: 'https://ruanqiaoyun0-a11y.github.io/cc-tw-afterclass-sop-cn/',
  virtualConsole: vc,
  beforeParse(window) {
    window.scrollTo = () => {};
    if (window.HTMLElement) window.HTMLElement.prototype.scrollIntoView = () => {};
    window.print = () => {};
    window.fetch = () => Promise.resolve({ json: () => Promise.resolve({ reply: 'x' }) });
  }
});
const { window } = dom;

setTimeout(() => {
  try {
    // 1) section exists
    const total = window.eval('courseData.sections.length');
    ok('章节数 = 14（新增 s11b）', total === 14);
    const sids = window.eval('courseData.sections.map(s=>s.id).join(",")');
    ok('s11b 存在于 s11 与 s12 之间', /s11,s11b,s12/.test(sids));
    const finalIdx = window.eval('courseData.sections.findIndex(s=>s.id==="s12")');
    ok('终极考核现位于 index 13', finalIdx === 13);

    // 2) cert element exists
    ok('证书含课后流程梳理得分元素', !!window.document.getElementById('certReviewScore'));

    // 3) 未通过前，终极考核(index13) 被锁
    ok('未梳理时无法进入终极考核', window.canNavigateTo(13).ok === false);

    // 4) single choice selection
    const cards = window.document.querySelectorAll('#reviewMCWrap .quiz-card');
    ok('单选题卡片 = 3', cards.length === 3);
    window.selectReviewMC(cards[0].querySelector('[data-option="1"]'), 1, 'rq1');
    window.selectReviewMC(cards[1].querySelector('[data-option="1"]'), 1, 'rq2');
    window.selectReviewMC(cards[2].querySelector('[data-option="1"]'), 1, 'rq3');
    ok('单选 rq1 记录 = 1', window.eval('reviewMC["rq1"]') === 1);

    // 5) multiple choice toggle
    const mcards = window.document.querySelectorAll('#reviewMMCWrap .quiz-card');
    ok('多选题卡片 = 3', mcards.length === 3);
    [0,1,2,3].forEach(i => window.selectReviewMMC(mcards[0].querySelector('[data-option="'+i+'"]'), i, 'rq4'));
    [0,1].forEach(i => window.selectReviewMMC(mcards[1].querySelector('[data-option="'+i+'"]'), i, 'rq5'));
    [0,1,3].forEach(i => window.selectReviewMMC(mcards[2].querySelector('[data-option="'+i+'"]'), i, 'rq6'));
    ok('多选 rq4 记录集合 = [0,1,2,3]', JSON.stringify(window.eval('reviewMMC["rq4"]')) === '[0,1,2,3]');

    // 6) submit all correct
    window.submitReview();
    ok('全对 → reviewScore = 6', window.eval('reviewScore') === 6);
    ok('全对 → reviewPassed = true', window.eval('reviewPassed') === true);
    // 终极考核(index13) 还需 quiz1-5 + 章中测验，先置齐前置以孤立验证「梳理」闸门
    window.eval('quiz1Answered=quiz2Answered=quiz3Answered=quiz4Answered=quiz5Answered=midtestPassed=true;');
    ok('全对 + 前置齐 → 解锁终极考核', window.canNavigateTo(13).ok === true);
    window.eval('reviewPassed=false;');
    ok('梳理未过 → 锁住终极考核', window.canNavigateTo(13).ok === false);
    window.eval('reviewPassed=true;');
    const fb = window.document.getElementById('reviewFeedback');
    ok('反馈区显示通过', /通过/.test(fb.textContent));

    // 7) partial wrong → score 4 (rq1,rq5 错)，仍过（≥4）
    window.resetReview();
    window.selectReviewMC(cards[0].querySelector('[data-option="0"]'), 0, 'rq1'); // wrong
    window.selectReviewMC(cards[1].querySelector('[data-option="1"]'), 1, 'rq2'); // correct
    window.selectReviewMC(cards[2].querySelector('[data-option="1"]'), 1, 'rq3'); // correct
    [0,1,2,3].forEach(i => window.selectReviewMMC(mcards[0].querySelector('[data-option="'+i+'"]'), i, 'rq4')); // correct
    [0,1,2].forEach(i => window.selectReviewMMC(mcards[1].querySelector('[data-option="'+i+'"]'), i, 'rq5')); // wrong (C included)
    [0,1,3].forEach(i => window.selectReviewMMC(mcards[2].querySelector('[data-option="'+i+'"]'), i, 'rq6')); // correct
    window.submitReview();
    ok('部分错(rq1,rq5) → reviewScore = 4', window.eval('reviewScore') === 4);
    ok('4/6 → reviewPassed = true（≥4 通过）', window.eval('reviewPassed') === true);
    window.resetReview();
    window.selectReviewMC(cards[0].querySelector('[data-option="0"]'), 0, 'rq1'); // wrong
    window.selectReviewMC(cards[1].querySelector('[data-option="0"]'), 0, 'rq2'); // wrong
    window.selectReviewMC(cards[2].querySelector('[data-option="0"]'), 0, 'rq3'); // wrong
    [0,1,2,3].forEach(i => window.selectReviewMMC(mcards[0].querySelector('[data-option="'+i+'"]'), i, 'rq4')); // correct
    [0,1].forEach(i => window.selectReviewMMC(mcards[1].querySelector('[data-option="'+i+'"]'), i, 'rq5')); // correct
    [0,1,3].forEach(i => window.selectReviewMMC(mcards[2].querySelector('[data-option="'+i+'"]'), i, 'rq6')); // correct
    window.submitReview();
    ok('3/6 → reviewPassed = false', window.eval('reviewPassed') === false);

    // 8) certificate gating includes reviewPassed
    const src = window.eval('checkCertificate.toString()');
    ok('checkCertificate 含 reviewPassed 条件', /reviewPassed/.test(src));

    console.log('\n=== ' + (errors ? ('有 ' + errors + ' 个失败') : '全部通过') + ' (' + checks + ' 项) ===');
    process.exit(errors ? 1 : 0);
  } catch (e) {
    console.log('TEST_EXCEPTION: ' + (e && e.stack ? e.stack : e));
    process.exit(1);
  }
}, 300);
