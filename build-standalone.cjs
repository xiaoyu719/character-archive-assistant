const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const out = path.join(__dirname, 'standalone-v0.3.1');
fs.mkdirSync(out, { recursive: true });
let core = fs.readFileSync(path.join(__dirname, 'core.cjs'), 'utf8')
  .replaceAll("+ d.name, enabled:", "+ d.name + ' :: ' + id, enabled:")
  .replaceAll('projection(d, Math.max(1, level))', 'projection(d, level)')
  .replaceAll('projection(draft.data, Math.max(1, draft.level))', 'projection(draft.data, draft.level)');
const store = fs.readFileSync(path.join(__dirname, 'archive-store.mjs'), 'utf8').replace('export function createCharacterArchiveBridge', 'globalThis.TWCreateArchiveStore = function createCharacterArchiveBridge');
let runtime = fs.readFileSync(path.join(__dirname, 'runtime.js'), 'utf8');
const adapter = fs.readFileSync(path.join(__dirname, 'standalone-adapter.js'), 'utf8');
runtime = runtime.replace('  function chatKey() {', adapter + '\n  function chatKey() {')
  .replace('  const compatible = missing.length === 0;', "  try { readArchiveRecords(); host.localStorage.getItem(archiveStorageKey); } catch (e) { missing.push('本机登记存储不可用：' + e.message); }\n  const compatible = missing.length === 0;")
  .replace('脚本 0.1.9 已加载', '独立脚本 0.3.1 已加载')
  .replace('这不是数据库子插件，不读写数据库表，也不插入聊天消息。', '人物条目的创建、持久登记和删除全部内置；只依赖酒馆助手，不需要数据库。登记保存在当前浏览器，清除网站数据会丢失登记；可按专用名称找回清理。');
const start = runtime.indexOf('    cleanup = cleanup.then(async () => {');
const end = runtime.indexOf('    return cleanup;', start);
if (start < 0 || end < start) throw Error('Cleanup anchor missing');
runtime = runtime.slice(0, start) + `    cleanup = cleanup.then(async () => {
      check();
      const result = await archiveStore.cleanup({ allCurrentActor: manual }); check();
      const legacy = await archiveStore.cleanupUnregistered({ allCurrentActor: manual }); check();
      lastCleanupNotice = '人物清理：登记删除 ' + result.deleted + ' 条，专用名称找回删除 ' + legacy.deleted + ' 条。';
      tell(lastCleanupNotice); record(lastCleanupNotice);
    }).catch(e => { if (!disposed) { lastCleanupNotice = '人物清理未完成：' + e.message; record(lastCleanupNotice); tell(lastCleanupNotice, true); } });
` + runtime.slice(end);
runtime = runtime.replace('清理本书的人物生成条目', '清理此角色人物及旧版遗留条目');
runtime = runtime.replace('新聊天已建立，正在清理这张卡此前聊天的人物条目…', '正在按持久登记和专用名称清理人物条目…');
const content = core + '\n' + store + ';\n' + runtime;
new vm.Script(content);
if (content.includes('AutoCardUpdaterAPI') || content.includes('characterArchiveV1')) throw Error('独立脚本残留数据库依赖');
const previous = JSON.parse(fs.readFileSync(path.join(__dirname, 'script-metadata.json'), 'utf8'));
const value = { ...previous, name: '人物档案助手 · 独立建档 0.3.1', content,
  info: '内置条目创建、持久登记、更新与清理；只依赖酒馆助手，不需要安装或修改数据库。新聊天事件触发清理；保留当前聊天人物。跨书按本工具专用名称找回旧条目，无法识别归属的旧版条目也会被清理。Tauritavern实机待验。' };
fs.writeFileSync(path.join(out, 'component-spec.json'), JSON.stringify({ schemaVersion: 1, deliveryMode: 'component', kind: 'helper-script', items: [{ artifactName: 'character-archive', value }] }, null, 2));
fs.writeFileSync(path.join(out, 'candidate-source.js'), content);
fs.writeFileSync(path.join(__dirname, 'character-archive.script.json'), JSON.stringify(value, null, 2) + '\n');
console.log(out);
