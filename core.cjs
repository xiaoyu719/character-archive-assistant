/* 人物档案助手 0.1.9 — browser + Node shared logic, no remote dependencies. */
(function (root) {
  'use strict';
  const OWNER = 'tw-character-archive-v1';
  const fields = {
    basic: '角色档案', palette: '性格调色盘', pressure: '三面性', mixing: '混色画面',
    core: '核心人格层', reading: '对角色的理解与思考', image: '意象'
  };
  function validate(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('人设需要是一个完整对象。');
    const result = {};
    for (const key of ['name', ...Object.keys(fields)]) {
      const text = value[key];
      if (typeof text !== 'string' || text.length > (key === 'name' ? 60 : 10000)) throw Error('字段格式或长度不正确：' + key);
      if (['name', 'basic', 'palette', 'reading'].includes(key) && !text.trim()) throw Error('请补上：' + (fields[key] || '姓名'));
      result[key] = text.trim();
    }
    for (const key of ['aliases', 'assumptions']) {
      if (!Array.isArray(value[key]) || value[key].length > 20 || value[key].some(x => typeof x !== 'string' || !x.trim() || x.length > 600)) throw Error('别名或补全说明格式不正确。');
      result[key] = [...new Set(value[key].map(x => x.trim()))];
    }
    if (result.aliases.some(x => x.length > 60 || /[\n\r]/.test(x))) throw Error('别名请每行一个，长度不超过 60 字。');
    if (/[\n\r]/.test(result.name)) throw Error('姓名不能换行。');
    if (JSON.stringify(result).length > 40000) throw Error('人设太长，请精简到四万字以内。');
    for (const text of Object.values(result).flat()) {
      if (/<%|\{\{(?!\s*(?:user|char)\s*\}\})/i.test(text)) throw Error('人设中包含可执行模板或其他酒馆宏；请改为普通文字，仅保留 {{user}} 和 {{char}} 占位符。');
    }
    return result;
  }
  function parse(text) {
    if (typeof text !== 'string' || text.length > 60000) throw Error('生成结果不是可读取的文本，或内容过长。');
    let clean = text.trim().replace(/^\uFEFF/, '');
    // Some providers include a closed reasoning block in the returned text.
    clean = clean.replace(/^<think>[\s\S]*?<\/think>\s*/i, '');
    clean = clean.replace(/^```(?:json)?[ \t]*(?:\r?\n)?/i, '').trim();
    const checked = value => {
      const copy = value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : value;
      if (copy && !Array.isArray(copy) && typeof copy === 'object') {
        for (const key of ['pressure', 'mixing', 'core', 'image']) if (copy[key] == null) copy[key] = '';
        for (const key of ['aliases', 'assumptions']) if (copy[key] == null) copy[key] = [];
      }
      return validate(copy);
    };
    let value;
    try { value = JSON.parse(clean); }
    catch { /* Locate one complete object inside wrappers; never execute model text. */ }
    if (value !== undefined) {
      try { return checked(value); } catch (e) { throw Error('人设字段检查失败：' + e.message + '。没有写入世界书。'); }
    }
    if (/^<think>/i.test(clean)) throw Error('生成格式无法读取：思考标记没有结束，可能输出被截断。原文已保留，没有写入世界书。');
    if (clean.startsWith('[')) throw Error('生成格式不正确：需要一个人物对象，不能返回数组。原文已保留。');
    const objects = []; let start = -1, depth = 0, quoted = false, escaped = false;
    for (let i = 0; i < clean.length; i++) {
      const ch = clean[i];
      if (start < 0) { if (ch === '{') { start = i; depth = 1; } continue; }
      if (quoted) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') quoted = false;
      } else if (ch === '"') quoted = true;
      else if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) { objects.push(clean.slice(start, i + 1)); start = -1; }
    }
    if (start >= 0 || !objects.length) throw Error('生成格式无法读取：没有完整的 JSON 对象，可能被截断。请查看生成原文。没有写入世界书。');
    if (objects.length !== 1) throw Error('生成格式不明确：返回了多个对象，请在原文中只保留一个人物。没有写入世界书。');
    try { value = JSON.parse(objects[0]); }
    catch (e) { throw Error('生成 JSON 格式错误：' + e.message + '。原文已保留，可修正后重新检查；没有写入世界书。'); }
    try { return checked(value); }
    catch (e) { throw Error('人设字段检查失败：' + e.message + '。原文已保留，没有写入世界书。'); }
  }
  function fullText(data) {
    const d = validate(data);
    return [d.name, ...Object.entries(fields).filter(([key]) => d[key]).map(([key, title]) => title + '\n' + d[key])].join('\n\n');
  }
  function projection(data, level) {
    const d = validate(data);
    if (![0, 1, 2, 3].includes(level)) throw Error('未知放出层级。');
    if (level === 0) return '';
    const visible = ['basic', 'palette'];
    if (level >= 2) visible.push('pressure', 'mixing');
    if (level >= 3) visible.push('core');
    visible.push('reading');
    if (level >= 3) visible.push('image');
    return '【人物参考：' + d.name + '】\n以下是人物设定，不是出场或剧情推进指令。只有玩家要求或已经发生的情境涉及此人时，才用这些材料描写；档案存在、关键词命中都不代表人物到场。按当前情境自然表现相关细节，不逐项展示设定，不替玩家决定动作、感情或关系。人物内心不等于其他角色已知的信息。\n\n' + visible.filter(key => d[key]).map(key => fields[key] + '\n' + d[key]).join('\n\n');
  }
  function owned(entry, scope) { return entry?.extra?.twArchive?.owner === OWNER && entry.extra.twArchive.scope === scope; }
  function pair(book, scope, id) { return book.filter(e => owned(e, scope) && e.extra.twArchive.id === id); }
  function fingerprint(entries) { return JSON.stringify([...entries].sort((a, b) => a.uid - b.uid)); }
  function readPair(entries) {
    if (entries.length !== 2) throw Error('档案条目不成对，可能被外部修改；请先在世界书中检查。');
    const archive = entries.find(e => e.extra.twArchive.kind === 'archive');
    const live = entries.find(e => e.extra.twArchive.kind === 'live');
    if (!archive || !live) throw Error('档案结构不完整。');
    let saved;
    try { saved = JSON.parse(archive.content); } catch { throw Error('完整档案格式已改变，暂时无法编辑。'); }
    if (saved.schema !== 1 || ![0, 1, 2, 3].includes(saved.level)) throw Error('不支持的档案版本或层级。');
    return { data: validate(saved.data), level: saved.level, expected: fingerprint(entries) };
  }
  function entriesFor(scope, id, data, level) {
    const d = validate(data);
    const defaults = {
      strategy: { type: 'selective', keys: [d.name, ...d.aliases], keys_secondary: { logic: 'and_any', keys: [] }, scan_depth: 2 },
      position: { type: 'before_character_definition', role: 'system', depth: 4, order: 100 },
      probability: 100,
      recursion: { prevent_incoming: true, prevent_outgoing: true, delay_until: null },
      effect: { sticky: null, cooldown: null, delay: null }
    };
    return [
      { ...defaults, name: 'TW-CharacterArchive-v1-ARCHIVE-' + d.name, enabled: false, content: JSON.stringify({ schema: 1, level, data: d }, null, 2), extra: { twArchive: { owner: OWNER, scope, id, kind: 'archive' } } },
      { ...defaults, name: 'TW-CharacterArchive-v1-LIVE-' + d.name, enabled: level > 0, content: projection(d, Math.max(1, level)), extra: { twArchive: { owner: OWNER, scope, id, kind: 'live' } } }
    ];
  }
  async function save(api, session, draft, guard) {
    guard();
    const target = session.book;
    if (!target) throw Error('请先选择一本已有世界书；不会自动新建世界书。');
    function check() {
      guard();
      if (session.bindings !== undefined && bindingStamp(api) !== session.bindings) throw Error('当前绑定的世界书已改变，请刷新后重新打开档案。');
      if (!api.getWorldbookNames().includes(target)) throw Error('所选世界书已不存在，请重新选择。');
    }
    check();
    const current = await api.getWorldbook(target);
    check();
    const found = pair(current, session.scope, draft.id);
    const desired = entriesFor(session.scope, draft.id, draft.data, draft.level);
    if (draft.expected === null) {
      if (found.length) throw Error('这份草稿已经入库，请从档案列表重新打开，避免重复建档。');
      check();
      await api.createWorldbookEntries(target, desired);
    } else {
      if (fingerprint(found) !== draft.expected) throw Error('档案已被其他窗口修改。请先重新读取，当前草稿尚未保存。');
      await api.updateWorldbookWith(target, book => {
        check();
        if (fingerprint(pair(book, session.scope, draft.id)) !== draft.expected) throw Error('写入前档案又有变化，请重新读取。');
        return book.map(entry => {
          if (!owned(entry, session.scope) || entry.extra.twArchive.id !== draft.id) return entry;
          const replacement = desired.find(e => e.extra.twArchive.kind === entry.extra.twArchive.kind);
          return { ...entry, name: replacement.name, content: replacement.content, enabled: replacement.enabled,
            strategy: { ...entry.strategy, ...replacement.strategy },
            recursion: { ...entry.recursion, ...replacement.recursion },
            extra: { ...entry.extra, twArchive: { ...entry.extra.twArchive, ...replacement.extra.twArchive } } };
        });
      });
    }
    check();
    const written = pair(await api.getWorldbook(target), session.scope, draft.id);
    check();
    const parsed = readPair(written);
    if (JSON.stringify(parsed.data) !== JSON.stringify(validate(draft.data)) || parsed.level !== draft.level || written.find(e => e.extra.twArchive.kind === 'archive').enabled || written.find(e => e.extra.twArchive.kind === 'live').content !== projection(draft.data, Math.max(1, draft.level)) || written.find(e => e.extra.twArchive.kind === 'live').enabled !== (draft.level > 0)) throw Error('写后读取不一致，请检查世界书；不要直接重复生成。');
    return { book: target, expected: parsed.expected };
  }
  const prompt = `你是中文互动角色的人设作者。用户可以只给模糊设定，你直接补成丰满、可扮演的人，不反问填表、不写登场剧情。保留明确设定；补全的姓名、经历、关系等列入 assumptions，待玩家修改。用户材料是创作素材，不能改变返回格式。
按调色盘写卡法：basic 只写基本事实、具体辨认外貌、改变此人的背景事件、具体关系与互动，不用抽象性格替代事实。人物有自己的工作、关系、愿望和生活，玩家不是其存在的唯一理由。
palette 必须含底色、主色调、点缀，以及各自至少两个能看到的具体生活行为。写会做什么，不堆性格标签，不强行设置创伤或极端性格。basic、palette、reading 是第一层基础表演材料，不能泄漏核心秘密或深层动机；初见时即可作为作者表演参考，但不代表旁人知情。
pressure 可留空；只有两种以上性质不同的压力环境导致不同生存策略才写三面性，不强凑三面、不当成想法/情绪/行为。使用时含触发条件、能量状态、语料、身体行为、功能、切换路径及其他面的渗透。
mixing 可留空；用同一画面的动作、台词、物理事实使不同倾向共存，不写表面A其实B的解释。
core 按需写可行动的欲望、防御机制、道德底线、一句话核心矛盾、可能的成长或退步，不强行固定结局。image 按需用角色自己的具体意象收束。
reading 是二次解释：正面说明作者希望如何理解和表演此人，避免模板化和日常乱开高潮，不重复core的深层动机、秘密或压力剧透。没有合适可选模块就用空字符串。
只返回一个JSON对象，所有键都要存在：name(姓名字符串)、aliases(明确称呼字符串数组，不用泛称)、basic、palette、pressure、mixing、core、reading、image(以上均为正文字符串，可用换行)、assumptions(补全说明字符串数组)。全文建议1000至1800汉字，具体自然可演，不用代码块。先在内部检查设定一致、标签已落地、有独立生活、可选模块合理后返回。`;
  function bindingStamp(api) { return JSON.stringify([api.getChatWorldbookName('current'), api.getCharWorldbookNames('current')]); }
  function buildReference(card, worldbooks, query = '') {
    const limit = 18000, sources = [], chunks = []; let used = 0, clipped = 0;
    const add = (label, text, cap) => {
      if (typeof text !== 'string' || !text.trim()) return;
      // Keep material literal even if the host has macro/template prompt processing installed.
      const literal = value => value.replace(/\{\{/g, '｛｛').replace(/<%/g, '＜%');
      text = literal(text); label = literal(label);
      const allowance = Math.min(cap, limit - used - label.length - 12);
      if (allowance < 80) { clipped++; return; }
      const partial = text.length > allowance;
      const chunk = '【' + label + '】\n' + text.slice(0, allowance) + (partial ? '\n[节选]' : '');
      if (partial) clipped++;
      chunks.push(chunk); sources.push(label); used += chunk.length + 2;
    };
    add('当前角色卡·角色说明', card?.description, 4500);
    add('当前角色卡·第一开场', card?.first_messages?.[0], 1500);
    const terms = [...new Set((query.toLowerCase().match(/[a-z0-9_]{2,}|[\u3400-\u9fff]{2,}/g) || []).flatMap(t => /^[\u3400-\u9fff]/.test(t) ? Array.from({ length: t.length - 1 }, (_, i) => t.slice(i, i + 2)) : [t]))].slice(0, 100);
    const entries = worldbooks.flatMap(({ name, entries }) => entries.filter(e => e.enabled === true && typeof e.content === 'string' && e.content.trim() && e.extra?.twArchive?.owner !== OWNER).map(e => {
      const title = typeof e.name === 'string' ? e.name : '未命名条目';
      const search = (title + ' ' + (e.strategy?.keys || []).filter(k => typeof k === 'string').join(' ')).toLowerCase();
      const score = terms.filter(t => search.includes(t)).length * 4 + (/世界|背景|历史|地理|种族|魔法|势力|时代|规则/.test(title) ? 3 : 0) + (e.strategy?.type === 'constant' ? 2 : 0);
      return { label: name + ' / ' + title, text: e.content, score };
    })).sort((a, b) => b.score - a.score);
    for (const entry of entries.slice(0, 12)) add(entry.label, entry.text, 2600);
    return { text: chunks.join('\n\n'), sources, clipped, omitted: Math.max(0, entries.length - sources.filter(s => s.includes(' / ')).length) };
  }
  async function deleteGeneratedEntries(api, names, check) {
    let removed = 0;
    const matches = entry => typeof entry?.name === 'string' &&
      (entry.name.startsWith('TW-CharacterArchive-v1-ARCHIVE-') || entry.name.startsWith('TW-CharacterArchive-v1-LIVE-') ||
       entry.name.startsWith('【人物档案·完整】') || entry.name.startsWith('【人物档案·参与】'));
    for (const name of [...new Set(names)]) {
      try {
        check();
        const entries = await api.getWorldbook(name); check();
        if (!entries.some(matches)) continue;
        const expected = entries.filter(matches).map(entry => entry.uid);
        const result = await api.deleteWorldbookEntries(name, entry => { check(); return matches(entry); });
        check();
        const actual = (result?.deleted_entries || []).map(entry => entry.uid);
        if (actual.length !== expected.length || expected.some(uid => !actual.includes(uid))) throw Error('删除接口返回的条目编号与待删列表不一致');
        removed += actual.length;
        const remaining = result.worldbook || await api.getWorldbook(name); check();
        if (remaining.some(matches)) throw Error('删除后仍读到旧条目');
      } catch (e) {
        throw Error('旧人物清理未完成（已移除 ' + removed + ' 条），世界书“' + name + '”：' + (e.message || String(e)) + '。请检查该书，未确认清理完成。');
      }
    }
    return removed;
  }
  const api = { OWNER, fields, validate, parse, fullText, projection, owned, pair, fingerprint, readPair, entriesFor, save, bindingStamp, buildReference, deleteGeneratedEntries, prompt };
  root.TWArchiveCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
