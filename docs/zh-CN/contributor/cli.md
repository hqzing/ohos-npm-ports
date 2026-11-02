# npm-ports 命令行工具

`npm-ports` 用于创建、编辑、构建、打包、滚动更新和验证 JavaScript class NPMBUILD port。运行时使用 Node.js 26.13.0。

## 安装与 port 参数

在仓库根目录执行：

```sh
export PATH="$PWD/cli:$PATH"
```

`<port>` 可以是发布短名、带版本线的短名或完整目录：

```sh
npm-ports info parcel-watcher
npm-ports info lightningcss@1.32
npm-ports info ports/p/parcel-watcher
```

## 创建和编辑配方

```sh
npm-ports create <upstream> [--set-name <port>] [--set-version <version>] [--no-fetch]
npm-ports edit <port>
```

`create` 默认查询 registry，取得最新版本和 tarball 并计算 SHA-256，生成 `ports/<首字母>/<port>/NPMBUILD`。scoped 上游默认扁平化为 `scope-name`，可用 `--set-name` 覆盖。`--set-version` 指定版本，`--no-fetch` 不访问 registry 并留空待补字段。已有 port 不会被覆盖。

`create` 和 `edit` 使用 `VISUAL`、`EDITOR` 指定的编辑器，默认 vim。`edit` 一次只接受一个 port。

## 查询与静态检查

```sh
npm-ports list
npm-ports info <port|--all> [--json]
npm-ports lint [port|--all]
```

`list` 列出全部 port，`info` 查看上游、版本、dist-tag、产物和测试声明。

`lint` 检查 ESM 语法、class 元数据、版本线、发布短名冲突、产物路径、bump 可编辑声明、资源、测试布局、孤立 patch、revision、发布边界、签名逻辑、连续空行和 build/test/docs 分区。lint 不能替代真实构建，也不能证明上游 patch 仍兼容。

## 构建与打包

```sh
npm-ports prepare <port>
npm-ports build <port>
npm-ports package <port>
npm-ports pack <port> [--no-build]
```

构建顺序为 `prepare() → build() → package() → normalize`：

- `prepare`：执行 `prepare()`。
- `build`：自动执行 `prepare()` 和 `build()`。
- `package`：再执行 `package()`，随后统一注入包名、repository、最终版本和槽位引用。
- `pack`：完成构建与 normalize，统一签名并生成 npm tarball。`--no-build` 复用已经生成的发布目录。

主包和槽位分别在同一 Node 进程内执行钩子，主包与槽位之间隔离。没有 `check()` 钩子；构建和产物断言放在 `build()`、`package()` 或 normalize，安装后功能验证放在 `test()`。

## 安装后测试

```sh
npm-ports test <port> [--no-build]
```

`test` 通过临时 Verdaccio 和实际 consumer fixture 安装 tarball，再调用配方唯一的 `test()`。本地和 CI 使用同一执行器、模块解析上下文和报告格式。`--no-build` 复用已有 artifact；依赖的已发布 port 可以自动下载。

`check` 暂时作为 `test` 的兼容别名，新文档和新配方只使用 `test`。

发布安装与 integrity 验证使用：

```sh
npm-ports validate-publish <port>
```

它打包全部产物，发布到临时 Verdaccio，校验 tarball 和 integrity，并在干净目录实际安装。推荐顺序见 [验证标准](verification.md)。

## 上游升级与修订

```sh
npm-ports bump <port|--all> [--write] [--registry URL]
npm-ports bump-pr <port> [--no-draft] [--base main]
npm-ports revision <port> [--set N]
```

- `bump` 根据 `upstream` 查询 npm dist-tags 和版本列表。主 port 跟随指定 dist-tag，`@` port 只选择版本线内最高 semver。
- `bump --write` 精确修改顶部 `version`、`static revision`、主 `source` / `sha256` 及所有引用 `${version}` 的资源摘要，并将 revision 重置为 1。固定 commit、工具链和独立版本资源保持锁定，不做全局替换。
- `bump-pr` 一次只处理一个 port，按目标版本创建分支、提交、普通推送和 PR。默认草稿，`--no-draft` 用于已配置的 GitHub App。已有开放 PR 修改同一 port 时跳过，不强推、不覆盖。
- `revision` 在上游版本不变时递增修订号。只有需要发布新产物时才递增；纯格式或语言迁移不递增。

升级或修订后必须执行真实构建和安装测试，不能只改元数据。

## 发布

```sh
npm-ports publish <port> [--dry-run] [--registry URL] [--skip-existing] [--expect-sha SHA]
```

`publish` 只发布已生成的 tarball，不重新执行生命周期。日常验证使用 `--dry-run` 或临时 Verdaccio。正式发布由 CI 的独立发布 job 完成，不要在 NPMBUILD 内执行 `npm publish`。

命令总览可随时通过 `npm-ports --help` 查看。
