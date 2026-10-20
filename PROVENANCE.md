# 接口与流程依据

- 世界书读写、生成及事件接口：Tavern Helper / JS-Slash-Runner 类型声明，提交 `36d8889a99f1cf09d3d1f8aabd0eba33975dc64d`，`@types/function/worldbook.d.ts`、`generate.d.ts`、`character.d.ts`、`@types/iframe/event.d.ts`。
  - https://github.com/N0VI028/JS-Slash-Runner/tree/36d8889a99f1cf09d3d1f8aabd0eba33975dc64d
- 聊天输入接口核查：TauriTavern 提交 `f6126b4fc9243eb3990f2c0bad86e2afcb502f22`，`src/scripts/st-context.js`、`slash-commands/SlashCommandParser.js`、`slash-commands.js`、`macros.js`。目前直接调用已注册的 setinput 回调，属于依赖宿主内部接口的版本兼容点。
  - https://github.com/Darkatse/TauriTavern/tree/f6126b4fc9243eb3990f2c0bad86e2afcb502f22
- 专用名称、已知名称查找后删除的流程参考：AlbusKen/shujuku 提交 `708e66ba58dfe0a08d34cba7cb8730a8f8ff1e80`，`src/service/worldbook/pipeline.ts`。人物助手使用自己的名称空间和登记记录，自行完成管理，不调用或修改数据库。
  - https://github.com/AlbusKen/shujuku/tree/708e66ba58dfe0a08d34cba7cb8730a8f8ff1e80

声明和固定源码只证明对应版本的结构，不能证明所有最新宿主都一致。脚本保留接口存在检查，具体行为仍需对应宿主验证。

独立脚本稳定 ID：`6bf0fa34-0b9c-4dd0-864f-a6ca8658160c`。

v0.4.0 扩展安装入口依据上述TauriTavern提交的 `src/scripts/extensions.js`：仓库安装、根manifest读取、模块导出hook调用。主窗口API声明位于JS-Slash-Runner的 `@types/function/index.d.ts`，扩展仅依赖其中公开的Window.TavernHelper；事件订阅由宿主getContext().eventSource接管，去掉仅属于脚本iframe的getButtonEvent依赖。静态与离线验证记录见EXTENSION-VALIDATION.md，真实链接安装待验。
