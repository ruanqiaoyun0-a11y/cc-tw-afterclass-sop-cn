// ============================================================
// MiMo 代理（零依赖 Node）—— 持有 API Key，前端永不直接接触 Key
// 运行：MIMO_API_KEY=xxxx node glm-proxy.js   （或把 key 放进同目录 mimo.key）
// 可选环境变量：
//   PORT       监听端口（默认 3000）
//   MIMO_MODEL 模型名（默认 mimo-v2.5-pro）
//   MIMO_BASE_URL OpenAI 兼容基址（默认 https://api.xiaomimimo.com/v1）
// 端点：
//   GET  /health  -> { ok, model, key }
//   POST /chat    { scenario:{title,html,objection}, history:[{role,content}] } -> { reply }
//   POST /score   { scenario, transcript } -> { dims, total, weak, comment }
// 上游为 OpenAI 兼容接口：{BASE_URL}/chat/completions
// ============================================================
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const MODEL = process.env.MIMO_MODEL || 'mimo-v2.5-pro';
const BASE_URL = (process.env.MIMO_BASE_URL || 'https://api.xiaomimimo.com/v1').replace(/\/$/, '');
const ENDPOINT = BASE_URL + '/chat/completions';

function loadKey() {
  if (process.env.MIMO_API_KEY) return process.env.MIMO_API_KEY;
  try { return fs.readFileSync(path.join(__dirname, 'mimo.key'), 'utf8').trim(); } catch (e) { return ''; }
}
const API_KEY = loadKey();

// OpenAI 兼容调用：messages -> { choices:[{ message:{ content } }] }
function callMiMo(messages, opts, cb) {
  opts = opts || {};
  const body = JSON.stringify({
    model: MODEL,
    stream: false,
    messages: messages,
    max_tokens: opts.max_tokens || 700,
    temperature: typeof opts.temperature === 'number' ? opts.temperature : 0.9,
    top_p: typeof opts.top_p === 'number' ? opts.top_p : 0.9
  });
  const u = new URL(ENDPOINT);
  const req = https.request({
    hostname: u.hostname, path: u.pathname, method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + API_KEY,
      'Accept': 'application/json'
    }
  }, (res) => {
    let d = '';
    res.on('data', c => d += c);
    res.on('end', () => { try { cb(null, JSON.parse(d)); } catch (e) { cb(e, d); } });
  });
  req.on('error', e => cb(e));
  req.write(body);
  req.end();
}

function sendJSON(res, code, obj) {
  const s = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST,GET,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type' });
  res.end(s);
}

function readBody(req, cb) {
  let d = '';
  req.on('data', c => d += c);
  req.on('end', () => { try { cb(null, JSON.parse(d || '{}')); } catch (e) { cb(e, {}); } });
}

// 兼容「推理模型」：正文 content 可能为空，真正内容在 reasoning_content
function getMessageText(data, includeReasoning) {
  const m = data && data.choices && data.choices[0] && data.choices[0].message;
  if (!m) return '';
  if (m.content) return m.content;
  if (includeReasoning && m.reasoning_content) return m.reasoning_content;
  return '';
}

// 从文本里抽出第一个完整 JSON 对象（兼容 ```json 包裹 / 前后多余文字）
function extractJSON(text) {
  if (!text) return null;
  let t = String(text).replace(/```json|```/g, '').trim();
  try { return JSON.parse(t); } catch (e) {}
  const a = t.indexOf('{'); const b = t.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch (e) {} }
  return null;
}

const CHAT_SYS = (sc) => `你是台湾教培机构的「家长」角色，正在接一通课后回访电话。
【学员与场景】${sc && sc.html ? sc.html : '（未提供）'}
【你最在意的异议】${sc && sc.objection ? sc.objection : '（未提供）'}
要求：
- 全程用中文（台湾家长口吻，简体即可），贴合上面家长的性格与顾虑。
- 每次只回 1–3 句，像真实家长一样简短、有情绪。
- 若 CC 话术到位（共情、解读报告、观念强化、产品价值、化解异议、软关单），你可逐渐松口、表示想了解；若 CC 生硬/只推销/忽略你的顾虑，你要提出质疑或敷衍。
- 绝不跳出家长角色，不要给 CC 打分或教学。`;

const SCORE_SYS = `你是严格的台湾 CC 课后电话能力评委。依据下面 6 个维度为 CC 的整通电话表现打分（每维 0–权重分，权重见下），并返回 JSON：
{
  "dims": {
    "流程完整度": <0-15>,
    "报告解读": <0-20>,
    "产品匹配": <0-15>,
    "异议处理": <0-20>,
    "多次软关单": <0-15>,
    "沟通共情": <0-15>
  },
  "total": <六维之和 0-100>,
  "weak": ["未覆盖的维度名"],
  "comment": "一句话总评与改进建议"
}
只返回 JSON，不要多余解释。维度说明：流程完整度=是否走完 共情→解读→观念→产品→报价→异议→关单；报告解读=是否用 2优1缺 讲清强弱；产品匹配=是否对应师资/体系/课纲/练习/闭环；异议处理=是否 yes…but… 化解；多次软关单=是否多次软性推进成交；沟通共情=语气是否共情、称呼家长自然。`;

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { sendJSON(res, 204, {}); return; }
  if (req.url === '/health' && req.method === 'GET') { sendJSON(res, 200, { ok: true, model: MODEL, key: API_KEY ? 'set' : 'missing' }); return; }

  if (req.url === '/chat' && req.method === 'POST') {
    readBody(req, (err, body) => {
      if (err) return sendJSON(res, 400, { error: 'bad json' });
      const sc = body.scenario || {};
      const history = Array.isArray(body.history) ? body.history : [];
      // 把 assistant 当成家长、user 当成 CC，喂给模型维持角色一致性
      const convo = history.slice(-12).map(m => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content
      }));
      const messages = [{ role: 'system', content: CHAT_SYS(sc) }].concat(convo);
      callMiMo(messages, { temperature: 0.95, top_p: 0.9, max_tokens: 1000 }, (e, data) => {
        if (e) return sendJSON(res, 502, { error: 'mimo_error', detail: String(e) });
        const reply = getMessageText(data, false);
        if (!reply) return sendJSON(res, 502, { error: 'empty_reply', raw: getMessageText(data, true) });
        sendJSON(res, 200, { reply: reply });
      });
    });
    return;
  }

  if (req.url === '/score' && req.method === 'POST') {
    readBody(req, (err, body) => {
      if (err) return sendJSON(res, 400, { error: 'bad json' });
      const sc = body.scenario || {};
      const transcript = body.transcript || '';
      const userMsg = `【学员场景】${(sc && sc.html) || ''}\n【家长异议】${(sc && sc.objection) || ''}\n\n【CC 这通电话的逐句实录】\n${transcript}\n\n请按系统指示输出 JSON 评分。`;
      const messages = [
        { role: 'system', content: SCORE_SYS },
        { role: 'user', content: userMsg }
      ];
      callMiMo(messages, { temperature: 0.2, top_p: 0.8, max_tokens: 3000 }, (e, data) => {
        if (e) return sendJSON(res, 502, { error: 'mimo_error', detail: String(e) });
        // 推理模型可能把 JSON 放在 reasoning_content，这里统一抽取
        const text = getMessageText(data, true);
        let parsed = extractJSON(text);
        if (!parsed) return sendJSON(res, 502, { error: 'bad_score', raw: text ? text.slice(0, 800) : '(empty)' });
        // 模型若漏给 total，则按维度求和兜底
        if (typeof parsed.total !== 'number' && parsed.dims) {
          parsed.total = Object.values(parsed.dims).reduce((s, v) => s + (Number(v) || 0), 0);
        }
        sendJSON(res, 200, parsed);
      });
    });
    return;
  }

  sendJSON(res, 404, { error: 'not found' });
});

server.listen(PORT, () => console.log(`MiMo proxy on http://localhost:${PORT}  (model=${MODEL}, endpoint=${ENDPOINT}, key=${API_KEY ? 'set' : 'MISSING'})`));
