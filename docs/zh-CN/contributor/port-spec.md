# NPMBUILD 配方规范

本文定义 port 目录、JavaScript class 配方、构建生命周期和安装后测试。命令用法见 [npm-ports 命令行工具](cli.md)，验证要求见 [验证标准](verification.md)。

## 1. port 目录与命名

```text
ports/<首字母>/<port>/
├── NPMBUILD                  # 必须：Node.js class 配方
├── patches/                  # 可选
├── tests/                    # 可选：测试辅助模块、fixture 和真机 harness
└── slots/<slot>/             # 可选：同版本、同 revision 的槽位辅助文件
```

每个 npm 包对应一个 port。port 目录使用发布短名，主包为 `@ohos-npm-ports/<pkgname>`。上游 scoped 包默认扁平化，例如 `@ast-grep/napi` 对应 `ports/a/ast-grep-napi`，`upstream` 精确保留上游名称。不同上游映射到同一短名会被 lint 阻断。

port 采用滚动更新，每个目录只保留最新版本数据。锁定旧版本时使用 `@<版本线>` 后缀，例如 `ports/l/lightningcss@1.32`。版本线通常使用 `@major`、`@major.minor` 或完整版本，0.x 通常至少保留 minor；这类 port 必须使用非 `latest` 的 dist-tag。

不再使用独立的 consumer `test.js` 或 port `README.md`。测试写入 NPMBUILD 的 `test()`，维护者文档写入顶部块注释。测试辅助模块、fixture、多进程测试和真机 harness 可以保留在 `tests/` 等目录，不应为了单文件化而删除真实覆盖。

## 2. 基本结构

NPMBUILD 是 Node.js 26.13.0 可直接加载的 ESM 文件，首行固定为：

```js
#!/usr/bin/env node
```

配方默认导出一个继承 `Port` 的 class。元数据使用 static class fields，生命周期使用实例方法。共享版本等值使用顶部常量，避免在方法中反复书写 `this`：

```js
#!/usr/bin/env node
/*
可选的维护者文档：使用限制、设备验证方式和示例。
*/
import { Port, resource, run, cd, fetchSource } from '../../../cli/recipe.mjs';
import { mkdirSync, rmSync } from 'node:fs';

const version = '1.2.3';

export default class Example extends Port {
  static pkgname = 'example';
  static upstream = '@upstream/example';
  static version = version;
  static revision = 1;
  static distTag = 'latest';
  static packages = [`build/example-${version}`];
  static source = `https://registry.npmjs.org/example/-/example-${version}.tgz`;
  static sha256 = '64 位小写十六进制摘要';
  static resources = [
    resource('source_archive', `https://github.com/example/example/archive/v${version}.tar.gz`, '64 位小写十六进制摘要'),
  ];

  prepare() {
    rmSync('build', { recursive: true, force: true });
    mkdirSync(`build/example-${version}`, { recursive: true });
    fetchSource('build/example.tgz');
    run('tar', ['-xzf', 'build/example.tgz', '-C', `build/example-${version}`, '--strip-components=1']);
  }

  build() {
    cd(`build/example-${version}`);
    // 编译并应用补丁。
  }

  package() {
    // 生成 packages 声明的发布目录；class 方法可以直接命名为 package。
  }

  test() {
    // 可选：验证安装后的包并返回 { result, assets? }。
  }
}
```

必填元数据为 `pkgname`、`upstream`、`version`、`revision`、`distTag`、`packages` 和 `build()`。`prepare()`、`package()`、`test()` 和槽位钩子按需实现。`build()` 是唯一必需的构建钩子。

`packages` 按发布顺序列出全部产物。主包只写输出目录，由 `pkgname` 推导发布名；其他发布包使用 `发布名:输出目录`。每个配方必须恰好有一个主包输出，所有发布名必须位于 `@ohos-npm-ports/` scope。

元数据使用 camelCase：`distTag`、`upstreamTag`、`testUpstream`、`testTimeout` 等。当前 port 的上游版本统一引用顶部 `version` 常量，不要在不同函数中重复抄写。跨 port 依赖的版本单独锁定，不能误用当前 port 的 revision。

## 3. 源码与资源

`source` 和 `sha256` 成对声明。附加资源集合使用 `resources`，单个声明使用 `resource(name, url, sha256)`：

```js
static source = `https://registry.npmjs.org/example/-/example-${version}.tgz`;
static sha256 = '主源码摘要';
static resources = [
  resource('source_archive', `https://github.com/example/example/archive/v${version}.tar.gz`, '源码包摘要'),
  resource('pinned_tool', 'https://example.com/tool-1.0.0.tar.gz', '固定工具摘要'),
];
```

下载必须使用 `fetchSource(output)` 和 `fetchResource(name, output)`。它们自动创建父目录、重试并校验 SHA-256。禁止在钩子中另写未校验的下载逻辑。资源名使用 `lower_snake_case`。

预览线可设置 `upstreamTag`。当 npm 预览版本与源码 tag 或 commit 没有可靠映射时，设置 `static bump = false` 并说明耦合原因。独立版本变量、固定工具链版本或 commit 锁定的资源由维护者配套升级，不能随主版本误更新。

## 4. 构建生命周期与执行规则

构建生命周期为：

```text
prepare → build → package → normalize
```

pack 和安装后测试是后续独立阶段：

```text
pack → 临时 registry / consumer 安装 → test
```

- `prepare()`：安装工具、下载、校验并解包。
- `build()`：编译，可在这里应用补丁并验证源码和 patch marker。
- `package()`：生成发布目录并验证产物布局；此时保持裸上游版本。
- normalize：框架统一注入全部发布包的名称、repository、最终发布版本和同 port 槽位引用，并验证这些字段。
- pack：统一为发布目录中的 AArch64 ELF 签名，再生成 npm tarball。
- `test()`：验证通过 npm 安装后的实际包。

不再有 `check()` 钩子。源码 pristine hash、patch marker 和源码树断言属于 `prepare()` / `build()`；产物目录和文件布局断言属于 `package()`；名称、最终版本、repository 和槽位引用由 normalize 统一验证；真实 `require()`、API、CLI 和工程行为属于唯一 `test()`。不要把原 `check()` 机械改名成 `test()` 后继续验证错误的目录形态。

主包或槽位在同一个 Node 进程内顺序执行构建钩子。模块顶层变量、`process.env` 和 cwd 可以在组件内传递。主包与槽位使用不同 Node 进程，彼此隔离。钩子抛异常或 Promise 拒绝都会停止后续阶段。

NPMBUILD 禁止执行 `npm publish`。tarball 生成和正式发布由 `npm-ports` 处理。签名及 `readelf` 检查也不属于配方；贡献者只需保留 loader 和真实功能验证。

## 5. 同步 helper 与隐式上下文

配方从 `cli/recipe.mjs` 导入辅助函数。执行器在调用钩子前绑定当前实例，因此不需要 `this` 或参数解构：

```js
import { Port, run, shell, runAsync, cd, fetchSource, fetchResource, readJson, writeJson } from '../../../cli/recipe.mjs';
```

默认以同步方式编写钩子：

```js
build() {
  fetchSource('source.tgz');
  run('tar', ['-xzf', 'source.tgz']);
  cd('source');
  run('npm', ['install']);
}
```

`run(command, args, options)` 默认不经过 shell，非零退出抛错。支持：

- `cwd`：命令工作目录。
- `env`：与当前环境合并。
- `input`：string/Buffer 标准输入，可替代输入重定向。
- `timeout`：毫秒。
- `capture`：收集 stdout、stderr 和 code。
- `allowExitCodes`：默认仅 `[0]`，用于明确接受预期退出码。

`shell(script, options)` 仅用于管道、重定向和复杂控制流，使用 Bash `-euo pipefail`。不得用大段 `shell()` 包住整个旧 Bash 钩子。跨平台测试优先 `run()` 和 Node API。`runAsync()` 只用于确有并发需求的场景；只有调用真实 Promise API 时才把钩子声明为 `async`。

`cd(path)` 保留 Bash 的 cwd 习惯，失败立即抛错。一次性命令优先 `run(..., { cwd })`。文件操作使用 `node:fs`，不实现 `rmRf` 等别名。JSON 高频操作可使用 `readJson(file)` 和 `writeJson(file, value)`。

这些 helper 只能在钩子内调用。隐式上下文不是安全沙箱：主包、槽位和 consumer 使用独立进程，异步钩子完成后才切换上下文。

## 6. version 与 revision

- `version` 只写上游版本，`revision` 从 1 开始，最终包版本是 `<version>-<revision>`。
- revision 是发布版本号，不是重新编译的开关。纯格式或语言迁移不递增；需要重新发布同一上游版本的新产物时必须递增。
- `static revision` 是当前 port 修订号的唯一来源，仅供框架使用。不要在配方其他位置复制或拼接它。
- 主包、槽位、构建断言和补丁只使用裸上游版本。补丁不得修改自身 package.json 的名称、版本、description 或 repository，也不得把固定上游版本保留为 hunk 上下文。
- 跨 port 依赖保留对方完整已发布版本，包括对方 revision。
- 上游升级后将 revision 重置为 1；只修复移植问题时递增 revision。

## 7. 槽位包

平台槽位不单独建立 port。主 port 在 `slots/<slot>/` 保存辅助文件，在同一个 class 中实现 `slot_<normalized>_<phase>()`，并在 `packages` 中先列槽位、再列主包：

```js
static packages = [
  '@ohos-npm-ports/example-openharmony-arm64:slots/openharmony-arm64/example-openharmony-arm64-1.2.3',
  'example-1.2.3',
];

slot_openharmony_arm64_build() {
  // 构建槽位。
}
```

主包和槽位共享 version 和 revision，统一构建、打包、artifact、私仓验证和发布。执行上下文中的 `dir` 始终是主 port 目录，`slotDir` 是当前主包或槽位工作目录，可通过 `recipeContext()` 查询。

## 8. 安装后测试

`test()` 是可选的唯一功能测试入口，始终针对安装后的包，而不是原始发布目录：

```js
test() {
  const pkg = requirePackage('example/package.json');
  return { result: { loaded: true }, assets: [] };
}
```

测试上下文通过 `recipeContext()` 查询，提供 `mode`、`projectDir`、`primary`、`portVersion`、`npmCli`、`helper` 和 `tools`。常用导入：

- `requirePackage(spec)`：从当前 consumer 项目加载 CJS 包。
- `importPackage(spec)`：从当前 consumer 项目解析并动态 import ESM。
- `recipeContext().tools`：绑定 `consumer-deps/package.json` 的 require。

`test()` 返回 `{ result: {...}, assets?: [...] }`，不再写 `PORT_TEST_REPORT`。runner 验证 JSON、保存报告，并在普通 OS 比较 baseline 与 overrides；OpenHarmony 只验证 overrides。`mode` 为 `local`、`baseline` 或 `overrides`。

可选测试声明使用 class 末尾的 static fields：

- `testUpstream`、`testUpstreamVersion`、`testPortPackage`：默认从当前 port 推导。
- `testProject`：默认 `node`。
- `testFixture`：可选本地 fixture。
- `testPrerequisites`：依赖 port 目录数组。
- `testPlatforms`、`testPlatformReason`：默认四个平台；缩减平台必须说明原因。
- `testRole`：`primary` 或 `support`。
- `testTimeout`：毫秒，默认 600000。
- `testBrowser`：可选浏览器服务。

安装前的 setup 使用 `testSetup()`，并与 `test()` 一起放在 class 末尾。`test()` 必须是最后一个 class 方法，测试声明必须连续，供 build/test/docs 分区识别。

## 9. 维护者文档与变更边界

port README 改为 shebang 后、首个 import 前的唯一块注释。内容可写使用限制和设备验证方法，不包含 `*/`，不进入 npm 包，也不设置 `readme` 字段。

NPMBUILD 分为顶部文档、build 区域和末尾 test 区域。只有 build 区域改变才必须重新构建；纯测试或文档变化复用已发布/replay artifact 并执行测试，不提示递增 revision。无法可靠识别分区时保守重建。

被构建钩子使用的辅助测试代码仍是 build 输入。lint 和真实构建不能相互替代：新增、升级或修订后必须按 [验证标准](verification.md) 完整验证。
