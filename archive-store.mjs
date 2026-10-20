// Embedded archive management. Name-list cleanup follows the inspected database
// approach, using only this tool's prefixes and modern Tavern Helper wrappers.
export function createCharacterArchiveBridge({ helper, scope, records, persist }) {
  const OWNER = 'tw-character-archive-v1';
  let tail = Promise.resolve();
  /** @param {() => Promise<any>} fn @returns {Promise<any>} */
  const serial = fn => { const result = tail.then(fn); tail = result.then(() => {}, () => {}); return result; };
  const clone = value => JSON.parse(JSON.stringify(value));
  const actor = value => JSON.stringify(JSON.parse(value).slice(0, 2));
  const check = token => { if (scope() !== token) throw Error('聊天已经切换，人物管理停止操作'); };
  const own = entry => entry?.extra?.twArchive?.owner === OWNER;
  const save = async next => {
    const result = await persist(clone(next));
    if (!result?.saved || result.storageType === 'memory') throw Error('人物登记未能可靠保存，停止写入');
  };
  function ready() {
    for (const key of ['getWorldbook', 'getWorldbookNames', 'createWorldbookEntries', 'updateWorldbookWith', 'deleteWorldbookEntries']) {
      if (typeof helper()?.[key] !== 'function') throw Error('酒馆助手缺少 ' + key);
    }
    const token = scope(); actor(token); return token;
  }
  function validate(book, entries, token) {
    check(token);
    if (!helper().getWorldbookNames().includes(book)) throw Error('所选已有世界书不存在');
    if (!Array.isArray(entries) || entries.length !== 2 || new Set(entries.map(e => e.extra?.twArchive?.kind)).size !== 2) throw Error('必须登记一对人物条目');
    const id = entries[0]?.extra?.twArchive?.id;
    for (const e of entries) {
      const meta = e.extra?.twArchive;
      if (!own(e) || meta.scope !== token || !id || meta.id !== id || !['archive', 'live'].includes(meta.kind) ||
          !e.name?.startsWith('TW-CharacterArchive-v1-') || (meta.kind === 'archive' && e.enabled)) throw Error('人物条目标记不正确');
    }
    return id;
  }
  const selected = (all, record) => all.filter(e => own(e) && e.extra.twArchive.scope === record.scope && e.extra.twArchive.id === record.id);
  const fingerprint = all => JSON.stringify([...all].sort((a, b) => a.uid - b.uid));
  /** @returns {Promise<{deleted: number}>} */
  async function cleanupCore({ allCurrentActor = false } = {}) {
    const token = ready(), list = clone(records()); let deleted = 0;
    for (const record of list) {
      if (actor(record.scope) !== actor(token) || (!allCurrentActor && record.scope === token)) continue;
      check(token);
      const book = await helper().getWorldbook(record.book); check(token);
      const matches = e => selected([e], record).length > 0 || record.names.includes(e.name);
      const expected = book.filter(matches).map(e => e.uid);
      const result = await helper().deleteWorldbookEntries(record.book, e => { check(token); return matches(e); });
      check(token);
      const actual = result?.deleted_entries?.map(e => e.uid);
      if (!actual || actual.length !== expected.length || expected.some(uid => !actual.includes(uid))) throw Error('人物管理删除返回不一致；登记保留，可重试');
      const remaining = await helper().getWorldbook(record.book); check(token);
      if (remaining.some(matches)) throw Error('人物管理写后仍读到旧人物，登记保留');
      deleted += actual.length;
      await save(records().filter(r => !(r.book === record.book && r.scope === record.scope && r.id === record.id)));
    }
    return { deleted };
  }
  return Object.freeze({
    protocol: 1,
    capabilities: () => { ready(); return { create: true, update: true, cleanup: true, lifecycle: 'chat-created' }; },
    create: (book, entries) => serial(async () => {
      const token = ready(), id = validate(book, entries, token);
      const list = clone(records());
      if (list.some(r => r.book === book && r.scope === token && r.id === id)) throw Error('档案已有登记；请先重读或清理，不重复创建');
      const current = await helper().getWorldbook(book); check(token);
      if (current.some(e => entries.some(n => n.name === e.name))) throw Error('人物条目名称冲突');
      // Register intent first: a partial host write can still be found after reload.
      const record = { book, scope: token, id, names: entries.map(e => e.name) };
      await save([...list, record]); check(token);
      await helper().createWorldbookEntries(book, clone(entries)); check(token);
      const written = selected(await helper().getWorldbook(book), record); check(token);
      if (written.length !== 2 || entries.some(n => !written.some(e => e.name === n.name && e.content === n.content && e.enabled === n.enabled))) throw Error('人物写后核验失败；保留登记，请检查后清理');
    }),
    update: (book, expected, entries) => serial(async () => {
      const token = ready(), id = validate(book, entries, token);
      const list = clone(records()), record = list.find(r => r.book === book && r.scope === token && r.id === id);
      if (!record) throw Error('档案尚未登记；请清理旧版遗留后重新建档');
      await helper().updateWorldbookWith(book, current => {
        check(token);
        const before = selected(current, record);
        if (fingerprint(before) !== expected) throw Error('档案已被其他窗口修改');
        if (before.length !== 2 || new Set(entries.map(e => e.uid)).size !== 2 || entries.some(e => !before.some(n => n.uid === e.uid && n.extra.twArchive.kind === e.extra.twArchive.kind))) throw Error('人物更新的条目编号不匹配');
        return current.map(e => selected([e], record).length ? { ...e, ...clone(entries.find(n => n.uid === e.uid)) } : e);
      }); check(token);
      const written = selected(await helper().getWorldbook(book), record); check(token);
      if (written.length !== 2 || entries.some(n => !written.some(e => e.uid === n.uid && e.name === n.name && e.content === n.content && e.enabled === n.enabled))) throw Error('人物更新写后核验失败；请重读档案');
      record.names = entries.map(e => e.name); await save(list);
    }),
    cleanup: options => serial(() => cleanupCore(options)),
    cleanupUnregistered: ({ allCurrentActor = false } = {}) => serial(async () => {
      const token = ready(); let deleted = 0;
      const prefixes = ['TW-CharacterArchive-v1-ARCHIVE-', 'TW-CharacterArchive-v1-LIVE-', '【人物档案·完整】', '【人物档案·参与】'];
      // Recover old releases or missing browser registration without relying on extra.
      // Keep every registered entry; cleanupCore already handled its ownership.
      for (const book of helper().getWorldbookNames()) {
        check(token);
        const entries = await helper().getWorldbook(book); check(token);
        const registered = records().filter(r => r.book === book);
        const candidates = entries.filter(e => {
          if (!prefixes.some(p => typeof e.name === 'string' && e.name.startsWith(p))) return false;
          if (registered.some(r => r.names.includes(e.name) || selected([e], r).length)) return false;
          const meta = e.extra?.twArchive;
          if (meta?.scope) {
            // An invalid legacy identity is ambiguous: retain rather than guess.
            try {
              const value = JSON.parse(meta.scope);
              if (!Array.isArray(value) || value.length !== 3) return false;
              if (actor(meta.scope) !== actor(token)) return false;
              if (!allCurrentActor && meta.scope === token) return false;
            } catch { return false; }
          }
          return true;
        });
        if (!candidates.length) continue;
        const ids = new Set(candidates.map(e => e.uid));
        const result = await helper().deleteWorldbookEntries(book, e => { check(token); return ids.has(e.uid); }); check(token);
        const actual = result?.deleted_entries || [];
        if (actual.length !== ids.size || actual.some(e => !ids.has(e.uid))) throw Error('专用名称找回删除返回不一致：' + book);
        const remaining = await helper().getWorldbook(book); check(token);
        if (remaining.some(e => ids.has(e.uid))) throw Error('专用名称找回删除后仍读到旧条目：' + book);
        deleted += actual.length;
      }
      return { deleted };
    }),
    inspect: () => clone(records()),
  });
}
