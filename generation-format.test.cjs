const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const C = require('./core.cjs');
const sample = require('./fixture.cjs');
const json = JSON.stringify(sample);

test('用户报错回归：json代码块单行、换行、缺收尾标记、外围说明均能读取完整对象', () => {
  for (const text of ['```json ' + json + ' ```', '```json\r\n' + json + '\r\n```', '```json\n' + json,
    '以下是人设：\n```json\n' + json + '\n```\n请审阅。', '<think>先检查设定。</think>\n```json ' + json + '```']) {
    assert.deepEqual(C.parse(text), C.validate(sample));
  }
});
test('字符串中的花括号引号反斜线不会截断对象，可选空字段可恢复', () => {
  const data = { ...sample, basic: sample.basic + ' 他写下了 {a} 和 "b"，路径是 C:\\clock。', aliases: null, assumptions: undefined, pressure: null, mixing: undefined };
  const parsed = C.parse('人设如下：```json ' + JSON.stringify(data) + ' ```');
  assert.equal(parsed.basic, data.basic); assert.deepEqual(parsed.aliases, []); assert.equal(parsed.mixing, '');
});
test('截断、多个对象、数组、缺必需字段与可执行宏仍拒绝', () => {
  for (const text of ['```json ' + json.slice(0, -10), json + '\n' + json, '```json [' + json + ']```',
    JSON.stringify({ ...sample, basic: '' }), JSON.stringify({ ...sample, palette: '{{setvar::x::1}}' })]) assert.throws(() => C.parse(text));
});
test('实际试用源码：格式失败保留原文，玩家修改后无额外模型调用恢复，切聊天清空', async () => {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<body></body>', { runScripts: 'outside-only', url: 'https://offline.invalid/' });
  const w = dom.window, events = new Map(); let calls = 0, writes = 0, chat = 'A';
  const broken = '```json {"name":"截断的人物"';
  Object.assign(w, { structuredClone, getWorldbookNames: () => ['book'], getWorldbook: async () => [],
    getChatWorldbookName: () => 'book', getCharWorldbookNames: () => ({ primary: null, additional: [] }),
    createWorldbookEntries: async () => { writes++; }, updateWorldbookWith: async () => { writes++; }, deleteWorldbookEntries: async () => { writes++; },
    getCharacter: async () => ({ description: '港口城市' }), generateRaw: async () => { calls++; return broken; }, stopGenerationById: () => true,
    eventOn: (e, cb) => { events.set(e, cb); return { stop: () => events.delete(e) }; }, getButtonEvent: n => n,
    tavern_events: { CHAT_CHANGED: 'changed', CHAT_CREATED: 'created' }, SillyTavern: { getContext: () => ({ characterId: 'c', chatId: chat }) }, confirm: () => true });
  const tick = () => new Promise(r => setTimeout(r, 20));
  try {
    w.eval(fs.readFileSync(__dirname + '/standalone-v0.3.1/candidate-source.js', 'utf8'));
    const q = s => w.document.querySelector('#tw-character-archive').shadowRoot.querySelector(s);
    q('.launch').click(); await tick(); q('textarea').value = '港口修钟的人'; q('.primary').click(); await tick();
    assert.equal(q('[aria-label="生成原文"]').value, broken); assert.match(q('.status').textContent, /没有完整/);
    assert.equal(writes, 0); assert.equal(calls, 1);
    q('[aria-label="生成原文"]').value = '```json ' + json + ' ```';
    [...q('.body').querySelectorAll('button')].find(b => b.textContent === '从原文重新检查').click(); await tick();
    assert.equal(q('.editor').hidden, false); assert.equal(q('.editor input').value, sample.name);
    assert.equal(calls, 1); assert.equal(writes, 0);
    chat = 'B'; events.get('changed')(); assert.equal(q('[aria-label="生成原文"]').value, '');
  } finally { w.close(); }
});
