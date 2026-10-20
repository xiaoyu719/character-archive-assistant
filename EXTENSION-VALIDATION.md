# v0.4.0 扩展入口验证

目的：将同一套人物功能包装成可通过仓库链接安装的浏览器扩展。宿主通过根目录 manifest.json 加载 index.js，再加载本仓库 extension-runtime.js。没有通过远程代码加载器或自动导入酒馆助手脚本绕过扩展安装。

已通过：

- 扩展 manifest、入口路径、生命周期导出静态校验。
- 38 项离线测试：原35项，加主窗口TavernHelper与宿主事件联动、扩展启停清理、酒馆助手迟加载重试3项。
- 入口联动用例运行实际生成的运行代码，只提供主窗口TavernHelper和getContext，没有注入脚本iframe的全局API。覆盖生成、初始关闭空条目、主动启用和填输入、新聊天删除。
- npm run build 生成扩展运行代码；不改已初测的人设、条目结构或存储键。禁用/删除扩展移除窗口、计时器和监听，不删除世界书档案或浏览器登记。

尚未验证：真实客户端粘贴仓库链接安装、扩展管理里的启停、刷新后加载顺序、具体用户版本的TavernHelper实现、移动端。用户此前“初步测试合格”只针对v0.3.1脚本版，不算v0.4.0扩展安装验收。没有真实宿主能力快照，未把模拟对象冒充现场捕获。

安装方式依据：TauriTavern 固定提交 f6126b4fc9243eb3990f2c0bad86e2afcb502f22，src/scripts/extensions.js 中 installExtension、manifest.json 加载和导出生命周期hook调用。主窗口TavernHelper公开接口依据JS-Slash-Runner声明和数据库源码快照中Window['TavernHelper']的使用。完整来源见PROVENANCE.md。版本最低值未擅自填写，先检查必需能力；失败显示等待/重试入口。
