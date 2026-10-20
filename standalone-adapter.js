  // All management lives in this script. No database global or private host hook.
  const archiveNative = { ...api };
  const archiveStorageKey = 'tw-character-archive-registry-v1';
  function readArchiveRecords() {
    const list = JSON.parse(host.localStorage.getItem(archiveStorageKey) || '[]');
    if (!Array.isArray(list) || list.some(r => !r || typeof r.book !== 'string' || typeof r.scope !== 'string' || typeof r.id !== 'string' || !Array.isArray(r.names) || r.names.some(n => typeof n !== 'string'))) throw Error('人物登记记录损坏，停止写入和删除');
    for (const r of list) { const s = JSON.parse(r.scope); if (!Array.isArray(s) || s.length !== 3) throw Error('人物登记身份损坏'); }
    return list;
  }
  const archiveStore = globalThis.TWCreateArchiveStore({
    helper: () => archiveNative, scope: () => chatKey(), records: readArchiveRecords,
    persist: next => {
      const text = JSON.stringify(next); host.localStorage.setItem(archiveStorageKey, text);
      if (host.localStorage.getItem(archiveStorageKey) !== text) throw Error('人物登记保存后读取不一致');
      return { saved: true, storageType: 'localStorage' };
    }
  });
  function getArchiveBridge() { return archiveStore; }
  api.createWorldbookEntries = (book, entries) => archiveStore.create(book, entries);
  api.updateWorldbookWith = async (book, update) => {
    const token = chatKey(); const current = await archiveNative.getWorldbook(book);
    if (chatKey() !== token) throw Error('聊天已经切换');
    const next = update(structuredClone(current));
    const changed = next.filter(e => JSON.stringify(e) !== JSON.stringify(current.find(old => old.uid === e.uid)));
    if (!changed.length) return current;
    const id = changed[0]?.extra?.twArchive?.id;
    const before = C.pair(current, token, id), after = C.pair(next, token, id);
    if (next.length !== current.length || changed.some(e => !after.includes(e))) throw Error('拒绝修改人物档案之外的条目');
    await archiveStore.update(book, C.fingerprint(before), after);
    return archiveNative.getWorldbook(book);
  };
  api.deleteWorldbookEntries = () => { throw Error('请通过人物登记清理删除'); };
