const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const C = require('./core.cjs');
const sample = require('./fixture.cjs');
function store() {
  let book = [{ uid: 42, name: '用户原条目', content: '必须保留', extra: { custom: 9 } }];
  let binding = 'book', writes = 0; const targets = [];
  const api = {
    getChatWorldbookName: () => binding,
    getCharWorldbookNames: () => ({ primary: null, additional: [] }),
    getWorldbookNames: () => ['book', 'chosen'],
    getWorldbook: async () => structuredClone(book),
    createWorldbookEntries: async (name, entries) => { writes++; targets.push(name); book.push(...entries.map((e, i) => ({ ...structuredClone(e), uid: 100 + i }))); },
    updateWorldbookWith: async (name, fn) => { const next = fn(structuredClone(book)); writes++; targets.push(name); book = next; },
    deleteWorldbookEntries: async (name, predicate) => {
      const deleted_entries = book.filter(predicate); book = book.filter(entry => !predicate(entry)); writes++; targets.push(name);
      return { worldbook: structuredClone(book), deleted_entries: structuredClone(deleted_entries) };
    }
  };
  return { api, targets, get book() { return book; }, get writes() { return writes; }, setBinding: x => { binding = x; } };
}
const draft = () => ({ id: 'stable-draft', data: structuredClone(sample), level: 0, expected: null });
const session = { scope: 'chat-a', book: 'book', bindings: JSON.stringify(['book', { primary: null, additional: [] }]) };
test('模型格式异常、超长、缺少必需人设会被拒绝', () => {
  assert.equal(C.parse('```json\n' + JSON.stringify(sample) + '\n```').name, sample.name);
  for (const v of ['不是JSON', '[]', JSON.stringify({ ...sample, palette: '' }), JSON.stringify({ ...sample, aliases: [8] }), 'a'.repeat(60001)]) assert.throws(() => C.parse(v));
  assert.throws(() => C.validate({ ...sample, basic: '<% write() %>' }), /可执行/);
  assert.throws(() => C.validate({ ...sample, basic: '{{setvar::x::1}}' }), /可执行/);
  assert.ok(C.validate({ ...sample, basic: '{{user}}遇见{{char}}' }));
});
test('只有选中的层级可进入参与条目，补全说明始终不进模型', () => {
  assert.equal(C.projection(sample, 0), '');
  assert.ok(!C.projection(sample, 1).includes(sample.core));
  assert.ok(!C.projection(sample, 1).includes(sample.mixing));
  assert.ok(C.projection(sample, 2).includes(sample.mixing));
  assert.ok(!C.projection(sample, 2).includes(sample.core));
  assert.ok(C.projection(sample, 3).includes(sample.core));
  assert.ok(!C.projection(sample, 3).includes(sample.assumptions[0]));
});
test('背景节选保留当前卡与相关启用条目，排除关闭条目和自身档案，并严格限长', () => {
  const books = [{ name: '世界背景', entries: [
    { name: '关闭的秘密', enabled: false, content: '不得进入参考' },
    { name: '魔法规则', enabled: true, content: '本世界法师只能使用符文。{{setvar::x::1}} <% write() %>', strategy: { keys: ['法师'], type: 'selective' } },
    { name: '本工具旧档案', enabled: true, content: '不重复作为生成背景', extra: { twArchive: { owner: C.OWNER } } },
    ...Array.from({ length: 30 }, (_, i) => ({ name: '条目' + i, enabled: true, content: '长正文'.repeat(3000) }))
  ] }];
  const result = C.buildReference({ description: '这是符文城市。', first_messages: ['钟声响起。'] }, books, '法师');
  assert.ok(result.text.includes('这是符文城市')); assert.ok(result.text.includes('钟声响起')); assert.ok(result.text.includes('法师只能使用符文'));
  assert.ok(!result.text.includes('不得进入参考')); assert.ok(!result.text.includes('不重复作为生成背景'));
  assert.ok(result.text.length <= 18000); assert.ok(result.omitted > 0); assert.ok(result.clipped > 0);
  assert.ok(!result.text.includes('{{')); assert.ok(!result.text.includes('<%'));
});
test('首次保存只增加一对；重复保存更新原UID，保留其他条目及未知字段', async () => {
  const s = store(); const d = draft(); const untouched = structuredClone(s.book[0]);
  const result = await C.save(s.api, session, d, () => {});
  assert.equal(s.book.length, 3); assert.deepEqual(s.book[0], untouched);
  assert.ok(C.pair(s.book, 'chat-a', d.id).every(e => !e.enabled));
  assert.ok(s.book[2].content.includes(sample.basic));
  s.book[1].extra.otherPlugin = 17;
  d.expected = C.fingerprint(C.pair(s.book, 'chat-a', d.id)); d.level = 2;
  const uids = s.book.map(e => e.uid);
  await C.save(s.api, session, d, () => {});
  assert.deepEqual(s.book.map(e => e.uid), uids); assert.equal(s.book[1].extra.otherPlugin, 17);
  assert.equal(s.book[2].enabled, true); assert.deepEqual(s.book[0], untouched);
  assert.notEqual(result.expected, C.fingerprint(C.pair(s.book, 'chat-a', d.id)));
});

test('相同草稿重复新建、外部修改、跨聊天及世界书换绑均阻止覆盖', async () => {
  const s = store(); const d = draft(); const result = await C.save(s.api, session, d, () => {});
  await assert.rejects(C.save(s.api, session, d, () => {}), /已经入库/);
  d.expected = result.expected; s.book[1].name = '外部修改';
  await assert.rejects(C.save(s.api, session, d, () => {}), /其他窗口/);
  assert.equal(C.pair(s.book, 'chat-b', d.id).length, 0);
  await assert.rejects(C.save(s.api, session, d, () => { throw Error('聊天已经切换'); }), /聊天已经切换/);
  s.setBinding('other'); await assert.rejects(C.save(s.api, session, d, () => {}), /世界书已改变/);
  assert.equal(s.writes, 1);
});
test('异步读取期间换绑及更新回调前冲突阻止写入', async () => {
  const s = store(); const originalRead = s.api.getWorldbook;
  s.api.getWorldbook = async () => { const data = await originalRead(); s.setBinding('changed'); return data; };
  await assert.rejects(C.save(s.api, session, draft(), () => {}), /世界书已改变/);
  assert.equal(s.writes, 0);
  const t = store(); const d = draft(); const saved = await C.save(t.api, session, d, () => {}); d.expected = saved.expected;
  const update = t.api.updateWorldbookWith;
  t.api.updateWorldbookWith = async (name, fn) => { t.book[1].content += ' '; return update(name, fn); };
  await assert.rejects(C.save(t.api, session, d, () => {}), /又有变化/); assert.equal(t.writes, 1);
});
test('没有目标拒绝保存；指定已有书无需聊天绑定；永不创建或改绑世界书', async () => {
  const s = store(); s.setBinding(null);
  await assert.rejects(C.save(s.api, { scope: 'chat-a', book: null }, draft(), () => {}), /先选择/);
  assert.equal(s.writes, 0);
  await C.save(s.api, { scope: 'chat-a', book: 'chosen', bindings: C.bindingStamp(s.api) }, draft(), () => {});
  assert.equal(s.api.getChatWorldbookName(), null); assert.equal(s.book.length, 3);
  assert.deepEqual(s.targets, ['chosen']);
  assert.throws(() => C.readPair([s.book[1]]), /不成对/);
});
const content = fs.readFileSync(__dirname + '/core.cjs', 'utf8') + '\n' + fs.readFileSync(__dirname + '/runtime.js', 'utf8');
function ui({ missing = false, delay = null } = {}) {
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', url: 'https://offline.invalid/' });
  const w = dom.window; const s = store(); let chat = 'A', messages = [{ is_user: true }]; const callbacks = new Map(); let calls = 0; const requests = [];
  w.__input = '';
  Object.assign(w, s.api, { SillyTavern: { getContext: () => ({ chatId: chat, chat: messages, characterId: 'c', substituteParams: () => w.__input, SlashCommandParser: { commands: { setinput: { callback: (_, text) => { w.__input = text; return text; } } } } }) },
    getCharacter: async () => ({ description: '原卡设定：蒸汽港口，没有超能力。', first_messages: ['煤气灯下的街角。'] }),
    generateRaw: async request => { calls++; requests.push(request); return delay ? await delay : JSON.stringify(sample); },
    stopGenerationById: () => true, eventOn: (event, cb) => { callbacks.set(event, cb); return { stop: () => callbacks.delete(event) }; },
    getButtonEvent: name => 'button-' + name, tavern_events: { CHAT_CHANGED: 'chat-changed', CHAT_CREATED: 'chat-created' }, confirm: () => true });
  if (missing) delete w.generateRaw;
  w.eval(content);
  const tick = () => new Promise(resolve => setTimeout(resolve, 8));
  return { w, s, callbacks, requests, tick, shadow: w.document.querySelector('#tw-character-archive').shadowRoot, get calls() { return calls; }, setChat(next, nextMessages = [{ is_user: true }]) { chat = next; messages = nextMessages; }, change(next = 'B', nextMessages = [{ is_user: true }]) { chat = next; messages = nextMessages; callbacks.get('chat-changed')(); } };
}

test('新建通知直接清理同角色其他聊天档案，无需切换前记忆；普通切换不删除', async () => {
  const t = ui(), q = s => t.shadow.querySelector(s);
  q('.launch').click(); await t.tick(); q('textarea').value = '人设'; q('.primary').click(); await t.tick();
  q('.editor .primary').click(); await t.tick();
  const original = structuredClone(t.s.book[0]);
  assert.equal(t.s.book.length, 3);
  t.change(); await t.tick(); assert.equal(t.s.book.length, 3);
  t.change('A'); await t.tick(); assert.equal(t.s.book.length, 3);
  t.s.book.push(...C.entriesFor(JSON.stringify(['', 'c', 'another-chat']), 'other', sample, 1));
  t.s.book.push({ uid: 999, extra: { twArchive: { owner: C.OWNER, scope: JSON.stringify(['', 'c', 'A']), kind: 'future' } } });
  t.change('C'); t.callbacks.get('chat-created')(); await t.tick();
  assert.equal(t.s.book.length, 2); assert.deepEqual(t.s.book[0], original);
  assert.equal(t.s.book[1].uid, 999);
  assert.match(q('.status').textContent, /删除 4 条/);
  t.callbacks.get('chat-created')(); await t.tick(); assert.equal(t.s.book.length, 2);
  t.w.close();
});

test('运行实例从新聊天开场才加载时，CHAT_CREATED 仍清理旧档案', async () => {
  const t = ui();
  t.s.book.push(...C.entriesFor(JSON.stringify(['', 'c', 'older-chat']), 'old', sample, 1));
  t.setChat('new-chat');
  t.callbacks.get('chat-created')(); await t.tick();
  assert.equal(t.s.book.length, 1);
  t.shadow.querySelector('.launch').click(); await t.tick();
  assert.match(t.shadow.querySelector('.status').textContent, /删除 2 条旧人物条目/);
  t.w.close();
});

test('启动、普通切换和打开浮窗均不猜测新聊天；手动删除能单独验证删除接口', async () => {
  const t = ui();
  t.s.book.push(...C.entriesFor(JSON.stringify(['', 'c', 'older-chat']), 'old', sample, 1));
  t.setChat('new-chat', [{ is_user: false }]); t.w.eval(content); await t.tick();
  const shadow = t.w.document.querySelector('#tw-character-archive').shadowRoot;
  shadow.querySelector('.launch').click(); await t.tick();
  assert.equal(t.s.book.length, 3);
  [...shadow.querySelectorAll('button')].find(b => b.textContent === '清理本书的人物生成条目').click(); await t.tick();
  assert.equal(t.s.book.length, 1);
  assert.match(shadow.querySelector('[aria-label="清理运行记录"]').value, /手动清理/);
  assert.match(shadow.querySelector('[aria-label="清理运行记录"]').value, /删除接口返回：2 条/);
  assert.equal(t.calls, 0); t.w.close();
});

test('玩家已发言的聊天不触发开场清理；当前聊天档案保留', async () => {
  const t = ui();
  t.s.book.push(...C.entriesFor(JSON.stringify(['', 'c', 'older-chat']), 'old', sample, 1));
  t.s.book.push(...C.entriesFor(JSON.stringify(['', 'c', 'existing-chat']), 'current', sample, 1));
  t.setChat('existing-chat', [{ is_user: false }, { is_user: true }]);
  t.w.eval(content);
  await t.tick();
  assert.equal(t.s.book.length, 5);
  t.w.close();
});

test('按前缀跨书清理生成条目，不用聊天身份筛选并核验删除结果', async () => {
  const scope = JSON.stringify(['g', 'c', 'old']), current = JSON.stringify(['g', 'c', 'new']);
  const old = C.entriesFor(scope, 'old-id', sample, 1);
  const data = new Map([['a', structuredClone(old)], ['b', structuredClone(old)]]);
  const api = { getWorldbook: async name => structuredClone(data.get(name)), deleteWorldbookEntries: async (name, predicate) => {
    const before = data.get(name), deleted_entries = before.filter(predicate), worldbook = before.filter(entry => !predicate(entry));
    data.set(name, worldbook); return { worldbook: structuredClone(worldbook), deleted_entries: structuredClone(deleted_entries) };
  } };
  assert.equal(await C.deleteGeneratedEntries(api, ['a', 'b', 'a'], () => {}), 4);
  assert.ok([...data.values()].every(entries => entries.length === 0));
  const protectedEntries = C.entriesFor(current, 'current-id', sample, 1);
  data.set('a', [...old, ...protectedEntries]);
  assert.equal(await C.deleteGeneratedEntries(api, ['a'], () => {}), 4);
  assert.equal(data.get('a').length, 0);
  await assert.rejects(C.deleteGeneratedEntries({ ...api, getWorldbook: async () => { throw Error('读取失败'); } }, ['a'], () => {}), /清理未完成.*读取失败/);
  let checks = 0;
  await assert.rejects(C.deleteGeneratedEntries(api, ['a'], () => { if (++checks > 1) throw Error('聊天再次切换'); }), /聊天再次切换/);
});

test('按数据库式固定名称前缀识别丢失 extra 标记的旧人物条目', async () => {
  const current = JSON.stringify(['g', 'c', 'new']);
  const unmarked = C.entriesFor('old-scope', 'old-id', sample, 1).map(e => {
    const copy = structuredClone(e); delete copy.extra;
    copy.name = copy.name.replace(/^TW-CharacterArchive-v1-ARCHIVE-/, '【人物档案·完整】').replace(/^TW-CharacterArchive-v1-LIVE-/, '【人物档案·参与】');
    return copy;
  });
  const currentPair = C.entriesFor(current, 'current-id', sample, 1);
  const book = [...unmarked, ...currentPair, { uid: 99, name: '用户自己的档案', content: '保留' }, { uid: 100, name: 'TavernDB-ACU-ReadableDataTable-main', content: '数据库资料保留' }];
  const data = new Map([['book', book]]);
  const api = {
    getWorldbook: async name => structuredClone(data.get(name)),
    deleteWorldbookEntries: async (name, predicate) => {
      const before = data.get(name), deleted_entries = before.filter(predicate), worldbook = before.filter(e => !predicate(e));
      data.set(name, worldbook); return { worldbook: structuredClone(worldbook), deleted_entries: structuredClone(deleted_entries) };
    }
  };
  assert.equal(await C.deleteGeneratedEntries(api, ['book'], () => {}), 4);
  assert.deepEqual(data.get('book').map(e => e.uid), [99, 100]);
});

test('新建清理异步读取期间再切换，不删除旧人物', async () => {
  const t = ui(); const scope = JSON.stringify(['', 'c', 'A']);
  t.s.book.push(...C.entriesFor(scope, 'old-id', sample, 1));
  const original = t.w.getWorldbook; let resolve;
  t.w.getWorldbook = async () => await new Promise(r => { resolve = r; });
  t.w.eval(content);
  t.change('B'); t.callbacks.get('chat-created')(); await t.tick();
  t.change('C'); resolve(await original('book')); await t.tick();
  assert.equal(t.s.writes, 0); assert.equal(t.s.book.length, 3);
  assert.match(t.w.document.querySelector('#tw-character-archive').shadowRoot.querySelector('.status').textContent, /清理未完成/);
  t.w.close();
});
test('浮窗真实源码离线交互：无后台生成，预览、保存、关闭重开、卸载清理', async () => {
  const t = ui(); const q = selector => t.shadow.querySelector(selector);
  assert.equal(t.calls, 0); q('.launch').click(); await t.tick(); assert.equal(t.s.writes, 0);
  q('textarea').value = '修钟表的人'; q('.primary').click(); await t.tick();
  assert.equal(t.calls, 1); assert.equal(q('.editor').hidden, false); assert.equal(t.s.writes, 0);
  const name = q('input'); name.value = '<img src=x onerror=alert(1)>'; name.dispatchEvent(new t.w.Event('input', { bubbles: true }));
  q('.editor select').value = '1'; q('.editor select').dispatchEvent(new t.w.Event('change'));
  assert.equal(t.shadow.querySelectorAll('img').length, 0);
  q('.editor .primary').click(); await t.tick(); assert.equal(t.s.book.length, 3);
  q('header button').click(); assert.equal(q('.panel').hidden, true); q('.launch').click(); assert.equal(q('.panel').hidden, false);
  t.w.__twCharacterArchiveTrial.destroy(); assert.equal(t.callbacks.size, 0); assert.equal(t.w.document.querySelector('#tw-character-archive'), null); t.w.close();
});
test('缺接口时不调用模型、不写库；重复挂载只有一个窗口', async () => {
  const t = ui({ missing: true }); t.shadow.querySelector('.launch').click(); await t.tick();
  assert.equal(t.shadow.querySelector('.primary').disabled, true); assert.match(t.shadow.querySelector('.status').textContent, /缺少/);
  assert.equal(t.s.writes, 0); t.w.eval(content); assert.equal(t.w.document.querySelectorAll('#tw-character-archive').length, 1); t.w.close();
});
test('生成过程中换聊天：迟到的结果不能进入新聊天或写库', async () => {
  let resolve; const promise = new Promise(r => { resolve = r; }); const t = ui({ delay: promise });
  t.shadow.querySelector('.launch').click(); await t.tick(); t.shadow.querySelector('textarea').value = '模糊设定'; t.shadow.querySelector('.primary').click();
  await t.tick(); t.change(); resolve(JSON.stringify(sample)); await t.tick();
  assert.equal(t.shadow.querySelector('.editor').hidden, true); assert.equal(t.s.writes, 0); assert.match(t.shadow.querySelector('.status').textContent, /切换/); t.w.close();
});
test('优先使用角色现有世界书；手动选书不写入，准备登场才保存启用且不再调用模型', async () => {
  const t = ui(); const q = selector => t.shadow.querySelector(selector);
  t.w.getChatWorldbookName = () => null;
  t.w.getCharWorldbookNames = () => ({ primary: 'chosen', additional: [] });
  const oldContext = t.w.SillyTavern.getContext;
  t.w.SillyTavern.getContext = () => ({ ...oldContext(), characterId: 'c' });
  // Remount so the API capability bindings use this host fixture.
  t.w.eval(content); const s = t.w.document.querySelector('#tw-character-archive').shadowRoot;
  s.querySelector('.launch').click(); await t.tick();
  assert.equal(s.querySelector('[aria-label="目标世界书"]').value, 'chosen'); assert.equal(t.s.writes, 0);
  s.querySelector('textarea').value = '模糊设定'; s.querySelector('.primary').click(); await t.tick();
  const buttons = [...s.querySelectorAll('button')]; buttons.find(b => b.textContent === '启用角色并填入登场请求').click(); await t.tick();
  assert.equal(t.s.writes, 1); assert.equal(t.s.book[2].enabled, true); assert.ok(t.s.book[2].content.includes(sample.basic));
  assert.deepEqual(t.s.targets, ['chosen']);
  assert.equal(t.calls, 1); assert.match(t.w.__input, /许闻迟/); assert.equal(s.querySelector('.panel').hidden, true); t.w.close();
});
test('登场保留现有草稿、重复点击不重复填入；缺输入接口时不先启用', async () => {
  const t = ui(); const q = selector => t.shadow.querySelector(selector);
  q('.launch').click(); await t.tick(); q('textarea').value = '模糊设定'; q('.primary').click(); await t.tick();
  t.w.__input = '我走到门口。';
  q('input').value = '许闻迟|/send';
  const button = [...t.shadow.querySelectorAll('button')].find(b => b.textContent === '启用角色并填入登场请求');
  button.click(); await t.tick();
  assert.ok(t.w.__input.startsWith('我走到门口。\n\n')); assert.ok(t.w.__input.includes('许闻迟|/send'));
  const first = t.w.__input; q('.launch').click(); button.click(); await t.tick();
  assert.equal(t.w.__input, first); assert.equal(t.calls, 1); t.w.close();
  const u = ui(); u.shadow.querySelector('.launch').click(); await u.tick(); u.shadow.querySelector('textarea').value = '人设'; u.shadow.querySelector('.primary').click(); await u.tick();
  u.w.SillyTavern.getContext = () => ({ chatId: 'A', characterId: 'c' });
  [...u.shadow.querySelectorAll('button')].find(b => b.textContent === '启用角色并填入登场请求').click(); await u.tick();
  assert.equal(u.s.writes, 0); assert.equal(u.w.__input, ''); assert.match(u.shadow.querySelector('.status').textContent, /输入接口/); u.w.close();
});
test('生成实际携带当前卡和启用世界书；关闭参考后不发送背景；读取不写数据', async () => {
  const t = ui(); const q = selector => t.shadow.querySelector(selector);
  t.s.book.push({ uid: 88, name: '蒸汽港口世界', enabled: true, content: '城市以蒸汽机驱动，没有魔法。', strategy: { type: 'constant', keys: [] } });
  q('.launch').click(); await t.tick(); q('textarea').value = '会修钟的人';
  [...t.shadow.querySelectorAll('button')].find(b => b.textContent === '读取／刷新参考').click(); await t.tick();
  assert.equal(t.calls, 0); assert.equal(t.s.writes, 0);
  assert.match(q('.reference textarea').value, /没有魔法/);
  q('.primary').click(); await t.tick();
  const prompt = t.requests[0].ordered_prompts[1].content; assert.match(prompt, /原卡设定/); assert.match(prompt, /没有魔法/);
  q('[aria-label="生成参考范围"]').value = 'none'; q('[aria-label="生成参考范围"]').dispatchEvent(new t.w.Event('change'));
  q('.primary').click(); await t.tick();
  assert.ok(!t.requests[1].ordered_prompts[1].content.includes('原卡设定')); assert.equal(t.s.writes, 0); t.w.close();
});
test('读取背景期间换聊天不调用生成，不会把旧背景留到新聊天', async () => {
  const t = ui(); let resolve;
  t.w.getCharacter = () => new Promise(r => { resolve = r; });
  t.shadow.querySelector('.launch').click(); await t.tick(); t.shadow.querySelector('textarea').value = '人设'; t.shadow.querySelector('.primary').click(); await t.tick();
  t.change(); resolve({ description: '旧聊天的背景', first_messages: [] }); await t.tick();
  assert.equal(t.calls, 0); assert.equal(t.s.writes, 0); assert.equal(t.shadow.querySelector('.reference textarea').value, ''); t.w.close();
});
