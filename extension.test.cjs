const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const sample = require('./fixture.cjs');

function host({ missingHelper = false } = {}) {
  const dom = new JSDOM('<body></body>', { runScripts: 'outside-only', url: 'https://offline.invalid/' });
  const w = dom.window, listeners = new Map(); let chat = 'A', input = '', calls = 0, entries = [{ uid: 1, name: '用户条目', content: '保留' }], uid = 10;
  w.structuredClone = structuredClone; w.confirm = () => true;
  const events = { CHAT_CHANGED: 'chat_id_changed', CHAT_CREATED: 'chat_created' };
  const source = {
    on: (event, fn) => { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(fn); },
    removeListener: (event, fn) => { listeners.get(event)?.delete(fn); }
  };
  w.SillyTavern = { getContext: () => ({ chatId: chat, characterId: 'c', eventSource: source, event_types: events,
    substituteParams: () => input, SlashCommandParser: { commands: { setinput: { callback: (_, text) => { input = text; } } } } }) };
  const helper = {
    getWorldbookNames: () => ['book'], getWorldbook: async () => structuredClone(entries),
    getChatWorldbookName: () => 'book', getCharWorldbookNames: () => ({ primary: null, additional: [] }),
    createWorldbookEntries: async (_, next) => { entries.push(...structuredClone(next).map(e => ({ ...e, uid: uid++ }))); },
    updateWorldbookWith: async (_, fn) => { entries = fn(structuredClone(entries)); },
    deleteWorldbookEntries: async (_, predicate) => {
      const deleted_entries = entries.filter(predicate); entries = entries.filter(e => !predicate(e));
      return { worldbook: structuredClone(entries), deleted_entries: structuredClone(deleted_entries) };
    },
    getCharacter: async () => ({ description: '蒸汽港口' }), generateRaw: async () => { calls++; return JSON.stringify(sample); }, stopGenerationById: () => true
  };
  if (!missingHelper) w.TavernHelper = helper;
  const runtime = fs.readFileSync(__dirname + '/extension-runtime.js', 'utf8').replace('export function mountArchive', 'function mountArchive');
  const entry = fs.readFileSync(__dirname + '/index.js', 'utf8').replace(/^import[^\n]+\n/, '').replace(/export function /g, 'function ');
  w.eval(runtime + '\n' + entry + '\nwindow.testHooks = { onEnable, onDisable };');
  return { w, helper, dom, tick: () => new Promise(r => setTimeout(r, 20)), get entries() { return entries; }, get calls() { return calls; }, get input() { return input; },
    listenerCount: () => [...listeners.values()].reduce((sum, list) => sum + list.size, 0),
    newChat: () => { chat = 'B'; for (const fn of listeners.get(events.CHAT_CHANGED) || []) fn('B'); for (const fn of listeners.get(events.CHAT_CREATED) || []) fn(); } };
}

test('扩展入口：仅提供主窗口TavernHelper和宿主事件，生成建档、主动登场及新聊天清理', async () => {
  const t = host();
  try {
    const q = s => t.w.document.querySelector('#tw-character-archive').shadowRoot.querySelector(s);
    assert.equal(t.calls, 0); assert.equal(t.listenerCount(), 2);
    q('.launch').click(); await t.tick(); q('textarea').value = '有秘密的修表师'; q('.primary').click(); await t.tick();
    q('.editor .primary').click(); await t.tick();
    assert.equal(t.entries.length, 3); assert.equal(t.entries[2].content, ''); assert.ok(t.entries.slice(1).every(e => !e.enabled));
    [...q('.body').querySelectorAll('button')].find(b => b.textContent === '启用角色并填入登场请求').click(); await t.tick();
    assert.equal(t.entries[2].enabled, true); assert.ok(t.input.includes(sample.name)); assert.equal(t.calls, 1);
    t.newChat(); await t.tick(); assert.equal(t.entries.length, 1); assert.equal(t.entries[0].name, '用户条目');
  } finally { t.w.testHooks.onDisable(); t.dom.window.close(); }
});
test('扩展禁用/重复启用不会残留窗口和事件，也不删除档案', async () => {
  const t = host();
  try {
    t.w.testHooks.onEnable(); assert.equal(t.w.document.querySelectorAll('#tw-character-archive').length, 1); assert.equal(t.listenerCount(), 2);
    t.w.testHooks.onDisable(); assert.equal(t.w.document.querySelector('#tw-character-archive'), null); assert.equal(t.listenerCount(), 0);
    assert.equal(t.entries.length, 1); t.w.testHooks.onEnable(); assert.equal(t.listenerCount(), 2);
  } finally { t.w.testHooks.onDisable(); t.dom.window.close(); }
});
test('酒馆助手迟加载时显示重试入口，重试成功并清除等待入口；禁用移除全部内容', () => {
  const t = host({ missingHelper: true });
  try {
    const waiting = t.w.document.querySelector('#tw-character-archive-extension-waiting');
    assert.ok(waiting); assert.equal(t.listenerCount(), 0); assert.equal(t.calls, 0);
    t.w.TavernHelper = t.helper; waiting.click();
    assert.equal(t.w.document.querySelector('#tw-character-archive-extension-waiting'), null);
    assert.ok(t.w.document.querySelector('#tw-character-archive')); assert.equal(t.listenerCount(), 2);
    t.w.testHooks.onDisable(); assert.equal(t.w.document.querySelector('#tw-character-archive'), null); assert.equal(t.listenerCount(), 0);
  } finally { t.w.testHooks.onDisable(); t.dom.window.close(); }
});
