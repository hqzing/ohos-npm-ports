# 验证标准

“构建成功”不等于“包能用”。验证分为构建与产物断言、发布安装和安装后功能测试三层。

## 1. 构建与产物断言

构建生命周期为 `prepare() → build() → package() → normalize`，不再有 `check()` 钩子：

- `prepare()` / `build()`：验证源码 hash、patch marker、编译结果和源码树约束。
- `package()`：验证发布目录、原生文件、生成布局和不依赖 normalize 的 manifest 内容。
- normalize：统一写入并验证包名、最终发布版本、repository 和同 port 槽位引用。
- pack：统一为 AArch64  ELF 签名；签名失败会中断打包。配方不需要调用签名工具或 `readelf`。

这些断言属于构建步骤本身，不是另一个测试块。只有安装后功能验证才写入 `test()`。

## 2. 本地提交前验证

在 ci-runner 容器中按顺序执行：

```sh
npm-ports lint <port>
npm-ports pack <port>
npm-ports validate-publish <port>
npm-ports test <port>
```

- `lint`：检查 ESM、class、元数据、patch 和静态约束。
- `pack`：执行完整构建、normalize、签名并生成 tarball。
- `validate-publish`：发布到临时 Verdaccio，校验 tarball 和 integrity，并在干净目录安装全部主包和槽位。
- `test`：使用同一临时 registry 与 consumer 执行器调用配方的 `test()`。没有 `test()` 的 port 仍需完成前三项和通用安装验证。

`check` 目前只是 `test` 的兼容别名，新流程不要继续依赖它。日常发布检查使用临时 registry，不发布到 npm 中心仓。

## 3. CI 发布前私仓校验

CI 先执行 `npm-ports package` 完成构建与 normalize，再执行 `npm-ports validate-publish`：

- dry-run 与真实本地发布的包清单一致。
- 主包和槽位按 packages 顺序发布。
- registry 下载的 tarball 来自本临时私仓，SHA-512 与 integrity 一致。
- 在干净目录执行包含 install 脚本的 npm install。
- 通过验证的同一 tarball 和 manifest 上传为 artifact，保留 7 天，不另做 bottle。

这一步在 PR 和 push 上都执行，不发布到中心仓，也不能代替功能测试。

## 4. 多平台 consumer 与唯一 `test()`

全部 port 默认进入五平台通用安装矩阵，不需要 `test()`。runner 下载本轮构建或已发布 artifact，在各平台的临时 Verdaccio 中安装主包，按 os/cpu 检查槽位、所有应安装的包、版本和 bin，再执行 npm ci。

`test()` 只承担额外的真实 API、CLI、加载和工程行为验证。普通 OS 比较 baseline 和 overrides 的结构化报告，OpenHarmony 验证 overrides。测试返回 `{ result, assets? }`，不再使用独立 `test.js` 或写报告环境变量。

本地 `npm-ports test` 与 CI 使用同一执行器。测试声明写在 class 末尾，setup 使用 `testSetup()`。通用安装通过不等于功能正确，因此原生加载和关键业务行为应在唯一 `test()` 中覆盖，而不是另建检查入口。

## 5. 验证边界

容器构建和跨平台 consumer 不等同于真机部署证明，不覆盖：

- 商用 HarmonyOS 设备的沙箱行为差异。
- 真机代码签名校验细节。
- 真实业务负载下的性能和稳定性。

发布前应根据目标设备补做真机验证。真机 harness 可以保留在 port 的 `tests/device/` 等目录，不必塞入 NPMBUILD。
