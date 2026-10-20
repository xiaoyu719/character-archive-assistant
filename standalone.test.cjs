const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const C = require('./core.cjs');
const sample = require('./fixture.cjs');

const factory = import(pathToFileURL(path.join(__dirname, 'archive-store.mjs')).href);
const scope = (chat, char = 'c') => JSON.stringify(['', char, chat]);
async function setup() {
  let active = scope('A'), list = [], writes = 0, persistFail = false, deleteFail = false;
  const books = new Map([['chosen', [{ uid: 9, name: '用户条目', content: '不动', extra: { custom: 1 } }]], ['other', []]]);
  let uid = 20;
  const helper = {
    getWorldbookNames: () => [...books.keys()],
    getWorldbook: async name => structuredClone(books.get(name)),
    createWorldbookEntries: async (name, entries) => { writes++; books.get(name).push(...structuredClone(entries).map(e => ({ ...e, uid: uid++ }))); },
    updateWorldbookWith: async (name, fn) => { writes++; books.set(name, await fn(structuredClone(books.get(name)))); },
    deleteWorldbookEntries: async (name, predicate) => {
      if (deleteFail) throw Error('模拟删除失败');
      writes++; const before = books.get(name), deleted_entries = before.filter(predicate), worldbook = before.filter(e => !predicate(e));
      books.set(name, worldbook); return structuredClone({ worldbook, deleted_entries });
    },
  };
  const options = { helper: () => helper, scope: () => active, records: () => list,
    persist: async next => { if (persistFail) return { saved: false }; list = structuredClone(next); return { saved: true, storageType: 'tavern' }; } };
  const { createCharacterArchiveBridge } = await factory;
  const bridge = createCharacterArchiveBridge(options);
  function entries(id = 'one') { return C.entriesFor(active, id, sample, 0).map(e => ({ ...e, name: e.name + ' :: ' + id, content: e.extra.twArchive.kind === 'live' ? '' : e.content })); }
  return { bridge, helper, books, entries, reload: () => createCharacterArchiveBridge(options),
    setScope: value => { active = value; }, failSave: () => { persistFail = true; }, failDelete: value => { deleteFail = value; }, get writes() { return writes; } };
}
test('真实桥模块：先登记再创建两条关闭条目，空参与条目；登记跨实例保留', async () => {
  const s = await setup(); await s.bridge.create('chosen', s.entries());
  assert.equal(s.books.get('chosen').length, 3); assert.equal(s.reload().inspect().length, 1);
  assert.ok(s.books.get('chosen').slice(1).every(e => !e.enabled)); assert.equal(s.books.get('chosen')[2].content, '');
  await assert.rejects(s.bridge.create('chosen', s.entries()), /已有登记/);
});
test('新聊天初始化删除旧登记，保留当前聊天新人物、其他角色和数据库/用户条目', async () => {
  const s = await setup(); const original = structuredClone(s.books.get('chosen')[0]);
  s.books.get('chosen').push({ uid: 10, name: 'TavernDB-ACU-ReadableDataTable', content: '数据库' });
  await s.bridge.create('chosen', s.entries('old'));
  s.setScope(scope('B')); await s.bridge.create('other', s.entries('current'));
  s.setScope(scope('X', 'different')); await s.bridge.create('chosen', s.entries('different'));
  s.setScope(scope('B'));
  const result = await s.reload().cleanup(); assert.equal(result.deleted, 2);
  assert.deepEqual(s.books.get('chosen')[0], original); assert.equal(s.books.get('chosen')[1].content, '数据库');
  assert.equal(s.books.get('chosen').length, 4); assert.equal(s.books.get('other').length, 2);
  assert.equal((await s.bridge.cleanup()).deleted, 0);
});
test('登记失败不写世界书；删除失败保留登记且重试可删', async () => {
  const s = await setup(); s.failSave(); await assert.rejects(s.bridge.create('chosen', s.entries()), /可靠保存/); assert.equal(s.writes, 0);
  const t = await setup(); await t.bridge.create('chosen', t.entries()); t.setScope(scope('B')); t.failDelete(true);
  await assert.rejects(t.bridge.cleanup(), /删除失败/); assert.equal(t.bridge.inspect().length, 1);
  t.failDelete(false); assert.equal((await t.bridge.cleanup()).deleted, 2); assert.equal(t.bridge.inspect().length, 0);
});
test('更新按原UID并检查冲突，不改无关条目；重读后手动清理同角色登记', async () => {
  const s = await setup(); await s.bridge.create('chosen', s.entries());
  const current = s.books.get('chosen').slice(1), expected = C.fingerprint(current);
  const next = structuredClone(current); next[1].enabled = true; next[1].content = C.projection(sample, 1);
  await s.bridge.update('chosen', expected, next); assert.equal(s.books.get('chosen')[2].enabled, true);
  await assert.rejects(s.bridge.update('chosen', expected, next), /其他窗口/);
  assert.equal((await s.bridge.cleanup()).deleted, 0);
  assert.equal((await s.bridge.cleanup({ allCurrentActor: true })).deleted, 2);
});
test('读取期间切聊天阻止建档；缺接口明确报错', async () => {
  const s = await setup(); const get = s.helper.getWorldbook;
  s.helper.getWorldbook = async n => { const value = await get(n); s.setScope(scope('B')); return value; };
  await assert.rejects(s.bridge.create('chosen', s.entries()), /聊天已经切换/); assert.equal(s.writes, 0);
  delete s.helper.deleteWorldbookEntries; assert.throws(() => s.bridge.capabilities(), /缺少/);
});
test('独立浮窗连接内置管理：模糊设定生成、关闭空档案、主动登场填输入、新聊天由脚本清理', async () => {
  const { JSDOM } = require('jsdom');
  const s = await setup(); let chat = 'A', input = '', calls = 0; const events = new Map();
  const dom = new JSDOM('<body></body>', { runScripts: 'outside-only', url: 'https://offline.invalid/' });
  const w = dom.window;
  Object.assign(w, s.helper, { structuredClone, 
    getChatWorldbookName: () => 'chosen', getCharWorldbookNames: () => ({ primary: null, additional: [] }),
    SillyTavern: { getContext: () => ({ chatId: chat, characterId: 'c', chat: [], substituteParams: () => input,
      SlashCommandParser: { commands: { setinput: { callback: (_, text) => { input = text; return text; } } } } }) },
    getCharacter: async () => ({ description: '蒸汽城市的钟表师' }),
    generateRaw: async () => { calls++; return JSON.stringify(sample); }, stopGenerationById: () => true,
    eventOn: (event, cb) => { events.set(event, cb); return { stop: () => events.delete(event) }; },
    getButtonEvent: n => 'button-' + n, tavern_events: { CHAT_CHANGED: 'changed', CHAT_CREATED: 'created' }, confirm: () => true });
  const source = fs.readFileSync(path.join(__dirname, 'standalone-v0.3.1/candidate-source.js'), 'utf8');
  const tick = () => new Promise(resolve => setTimeout(resolve, 20));
  try {
    w.eval(source); const shadow = w.document.querySelector('#tw-character-archive').shadowRoot;
    const q = x => shadow.querySelector(x);
    assert.equal(calls, 0); q('.launch').click(); await tick();
    q('textarea').value = '有秘密的钟表师'; q('.primary').click(); await tick();
    assert.equal(calls, 1); assert.equal(s.writes, 0);
    q('.editor .primary').click(); await tick();
    assert.equal(s.books.get('chosen').length, 3);
    assert.ok(s.books.get('chosen').slice(1).every(e => !e.enabled));
    assert.equal(s.books.get('chosen')[2].content, '');
    [...shadow.querySelectorAll('button')].find(b => b.textContent === '启用角色并填入登场请求').click(); await tick();
    assert.equal(s.books.get('chosen')[2].enabled, true); assert.ok(input.includes(sample.name)); assert.equal(calls, 1);
    assert.equal(JSON.parse(w.localStorage.getItem('tw-character-archive-registry-v1')).length, 1);
    w.eval(source); // Recreate the script; browser registration must survive.
    chat = 'old-existing'; s.setScope(scope(chat)); events.get('changed')(); await tick();
    assert.equal(s.books.get('chosen').length, 3, '普通切换聊天不删除');
    chat = 'B'; s.setScope(scope('B')); events.get('changed')(); events.get('created')(); await tick();
    assert.equal(s.books.get('chosen').length, 1, '独立脚本直接执行新聊天清理');
    assert.equal(JSON.parse(w.localStorage.getItem('tw-character-archive-registry-v1')).length, 0);
    delete w.AutoCardUpdaterAPI; w.eval(source);
    const disabled = w.document.querySelector('#tw-character-archive').shadowRoot;
    disabled.querySelector('.launch').click(); await tick();
    assert.equal(disabled.querySelector('.primary').disabled, false); assert.equal(calls, 1);
  } finally { w.close(); }
});

test('按数据库式专用名称找回跨书旧版遗留，保留数据库、用户和当前/其他角色人物', async () => {
  const s = await setup(); await s.bridge.create('chosen', s.entries('current'));
  const old = s.entries('old').map((e, i) => ({ ...e, uid: 500 + i, name: e.name.replace('TW-CharacterArchive-v1-ARCHIVE-', '【人物档案·完整】').replace('TW-CharacterArchive-v1-LIVE-', '【人物档案·参与】') }));
  for (const e of old) delete e.extra;
  s.books.get('other').push(...old, { uid: 600, name: 'TavernDB-ACU-ImportantPersonsIndex', content: '数据库' });
  const foreign = s.entries('foreign').map((e, i) => ({ ...e, uid: 700 + i, extra: { twArchive: { ...e.extra.twArchive, scope: scope('X', 'other-character') } } }));
  s.books.get('other').push(...foreign);
  assert.equal((await s.bridge.cleanupUnregistered()).deleted, 2);
  assert.equal(s.books.get('chosen').length, 3); assert.equal(s.books.get('other').length, 3);
  assert.equal((await s.bridge.cleanupUnregistered()).deleted, 0);
});

test('登记丢失后专用英文名仍可找回；删除失败可重试', async () => {
  const s = await setup(); const old = s.entries('lost').map((e, i) => ({ ...e, uid: 800 + i }));
  s.books.get('other').push(...old); s.setScope(scope('B')); s.failDelete(true);
  await assert.rejects(s.bridge.cleanupUnregistered(), /删除失败/);
  assert.equal(s.books.get('other').length, 2); s.failDelete(false);
  assert.equal((await s.bridge.cleanupUnregistered()).deleted, 2);
});

test('已登记条目丢失extra时按精确名称删除；不碰同名相似用户条目', async () => {
  const s = await setup(); await s.bridge.create('chosen', s.entries());
  for (const e of s.books.get('chosen').slice(1)) delete e.extra;
  s.books.get('chosen').push({ uid: 880, name: '我的TW-CharacterArchive-v1-ARCHIVE-笔记', content: '保留' });
  s.setScope(scope('B')); assert.equal((await s.bridge.cleanup()).deleted, 2);
  assert.equal(s.books.get('chosen').length, 2);
});

test('桥拒绝错UID更新，并发现宿主静默漏写', async () => {
  const s = await setup(); await s.bridge.create('chosen', s.entries());
  const current = s.books.get('chosen').slice(1), next = structuredClone(current); next[1].uid = 999;
  await assert.rejects(s.bridge.update('chosen', C.fingerprint(current), next), /编号不匹配/);
  const t = await setup(); t.helper.createWorldbookEntries = async () => {};
  await assert.rejects(t.bridge.create('chosen', t.entries()), /写后核验/); assert.equal(t.bridge.inspect().length, 1);
});
