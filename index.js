import { mountArchive } from './extension-runtime.js';

const CONTROL = '__twCharacterArchiveExtension';
const REQUIRED = ['generateRaw', 'stopGenerationById', 'getChatWorldbookName', 'getCharWorldbookNames',
  'getWorldbookNames', 'getWorldbook', 'createWorldbookEntries', 'updateWorldbookWith', 'deleteWorldbookEntries'];
let timer = null, waiting = null, stopRuntime = null, active = false, attempts = 0, readyListener = null;

export function createHostAdapter(host) {
  const context = host.SillyTavern?.getContext?.();
  const helper = host.TavernHelper;
  if (!context?.eventSource?.on || !context.eventSource.removeListener || !context.event_types?.CHAT_CHANGED || !context.event_types?.CHAT_CREATED) {
    throw Error('宿主未提供完整的聊天事件接口');
  }
  const missing = REQUIRED.filter(name => typeof helper?.[name] !== 'function');
  if (missing.length) throw Error('酒馆助手尚未就绪或缺少接口：' + missing.join('、'));
  const api = {};
  for (const name of [...REQUIRED, 'getCharacter', 'getTavernVersion', 'getTavernHelperVersion']) {
    if (typeof helper[name] === 'function') api[name] = helper[name].bind(helper);
  }
  api.tavern_events = context.event_types;
  api.eventOn = (event, callback) => {
    context.eventSource.on(event, callback);
    return { stop: () => context.eventSource.removeListener(event, callback) };
  };
  return api;
}

function clearWaiting() { waiting?.remove(); waiting = null; }
function waitNotice(message) {
  if (!waiting) {
    waiting = document.createElement('button');
    waiting.type = 'button'; waiting.id = 'tw-character-archive-extension-waiting';
    waiting.style.cssText = 'position:fixed;right:18px;bottom:85px;z-index:2147483000;padding:12px;border-radius:8px;max-width:290px;background:#293328;color:#eee9de;border:1px solid #7a8e6b;cursor:pointer';
    waiting.addEventListener('click', () => { attempts = 0; attempt(); });
    document.body.append(waiting);
  }
  waiting.textContent = '人物档案：等待酒馆助手，点击重试'; waiting.title = message;
}
function attempt() {
  clearTimeout(timer); timer = null;
  if (!active || stopRuntime) return;
  try {
    const adapter = createHostAdapter(window);
    stopRuntime = mountArchive(adapter); clearWaiting();
  } catch (error) {
    waitNotice(error.message);
    if (++attempts < 30) timer = setTimeout(attempt, 1000);
  }
}
function start() {
  if (active) return;
  window[CONTROL]?.stop?.();
  active = true; attempts = 0; window[CONTROL] = { stop: onDisable };
  if (document.body) attempt();
  else {
    readyListener = () => { readyListener = null; if (active) attempt(); };
    document.addEventListener('DOMContentLoaded', readyListener, { once: true });
  }
  window.addEventListener('pagehide', onDisable, { once: true });
}
export function onActivate() { start(); }
export function onEnable() { start(); }
export function onDisable() {
  active = false; clearTimeout(timer); timer = null;
  if (readyListener) document.removeEventListener('DOMContentLoaded', readyListener);
  readyListener = null; stopRuntime?.(); stopRuntime = null; clearWaiting();
  window.removeEventListener('pagehide', onDisable);
  if (window[CONTROL]?.stop === onDisable) delete window[CONTROL];
}
export function onDelete() { onDisable(); }
export function onClean() { onDisable(); }

start();
