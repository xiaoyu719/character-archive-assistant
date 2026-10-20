const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
let source = fs.readFileSync(path.join(__dirname, 'standalone-v0.3.1/candidate-source.js'), 'utf8');
// The extension owns host-event subscriptions; the script-manager button is absent.
source = source.replace(", 'getButtonEvent'", '')
  .replace("    stops.push(api.eventOn(api.getButtonEvent('人物档案'), open));", '')
  .replace('独立脚本 0.3.1 已加载', '扩展 0.4.0 已加载');
if (source.includes('getButtonEvent')) throw Error('扩展不能依赖脚本iframe按钮接口');
new vm.Script(source);
const output = '/* Generated from the tested archive sources. Run npm run build. */\n' +
  'export function mountArchive(helperApi) {\n' +
  '  (function (globalThis) {\n' + source + '\n  })(helperApi);\n' +
  "  const runtime = window.__twCharacterArchiveTrial;\n" +
  "  if (!runtime?.destroy) throw Error('人物档案窗口未能启动');\n" +
  '  return () => runtime.destroy();\n}\n';
fs.writeFileSync(path.join(__dirname, 'extension-runtime.js'), output);
console.log('已生成扩展入口使用的人物运行代码');
