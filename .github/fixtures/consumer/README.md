# 通用预发布 consumer 验证

## 分工

- `.github/scripts/run-install-matrix.mjs`：全部 port 的默认安装验证，不要求 `test()`；自动校验 artifact、主包与槽位、安装版本和 bin。
- `ports/<首字母>/<port>/NPMBUILD` 的唯一 `test()`：可选的真实功能断言及工程场景。上游、版本和测试选项默认读取 class 元数据。
- `.github/scripts/consumer-plan.mjs`：自动发现测试、选择变化的 port、展开配套构建依赖，同时输出通用安装选择。CI 基础设施变化时只验证 `sentinel-ports.json` 里的哨兵 port。
- `.github/scripts/run-port-consumer.mjs`：artifact 校验、临时 Verdaccio、真实 npm alias overrides、安装/`npm ci`、执行 `testSetup()` / `test()` 和 baseline 结果对比。
- `projects/node/`：默认最小 npm 工程，不安装前端框架，不自动 build/start。需要专属工程时使用配方内 fixture。

## `test()` 协议

测试是 class 末尾的实例方法，始终针对安装后的包：

```js
import assert from 'node:assert/strict';
import { Port, requirePackage } from '../../../cli/recipe.mjs';

export default class Example extends Port {
  // static 元数据及构建钩子省略。

  static testPrerequisites = ['ports/c/companion'];

  async test() {
    const pkg = await importPackage('@upstream/package');
    assert.equal(pkg.actualFunction(), 'expected');
    return {
      result: { actualFunction: true },
      assets: [],
    };
  }
}
```

默认值：

- `testUpstream`：当前 `upstream`。
- `testUpstreamVersion`：当前 `version`。
- `testPortPackage`：`@ohos-npm-ports/<pkgname>`。
- `testProject`：`node`。
- `testFixture`：空，使用通用工程；设置后指向配方内包含 package.json 的目录。
- `testPrerequisites`：空数组，可声明其他 port 目录；其 `test()` 也会进入该工程，没有时仅带入构建产物。主配方的 packages 已包含槽位，不要把 slots/ 写成独立 prerequisite。
- `testPlatforms`：win32、linux、darwin、openharmony。缩减平台必须同时设置 `testPlatformReason`。
- `testRole`：默认 primary，support 用于仍有独立配套配方的场景。
- `testTimeout`：毫秒，默认 600000，上限 1800000。
- `testBrowser`：需要时声明 `chromium`。

`testSetup()` 是可选的安装前准备阶段，在 npm install/npm ci 前执行，不要求报告。正常功能阶段执行 `test()`，异常和超时均失败。

测试使用当前 consumer 工程根目录作为 cwd。`requirePackage()` / `importPackage()` 从该工程解析依赖，不从 port 目录解析。`recipeContext()` 提供 `mode`、`projectDir`、`primary`、`portVersion`、`npmCli`、`helper` 和 `tools`。`mode` 为 `local`、`baseline` 或 `overrides`。

`test()` 返回 `{ result, assets? }`，不写 `PORT_TEST_REPORT`。`result` 放跨模式可比较的功能结果；`assets` 放工程生成并要通过 HTTP 验证的资源，如 `{path:'/image.png',magic:'89504e470d0a1a0a'}` 或 `{path:'/style.css',includes:'.app{'}`。生成资源放到工程 `public/` 下。

内部共享 `test-tools.mjs` 仍可使用 runner 注入的 helper 环境，提供 packageRoot、bin、command、cli、write、report、bunScript。配方不应自行读取或写入报告环境变量。

## 默认安装矩阵与配套测试

全部 port 默认进入五平台通用安装矩阵，不要求 `test()`。`.github/scripts/run-install-matrix.mjs` 根据构建矩阵选择 port，校验 artifact 后在临时 Verdaccio 发布并安装主包，按 os/cpu 过滤检查槽位、实际安装版本和 bin，再执行 npm ci。全量 dispatch 覆盖全部 port，普通变更覆盖受影响 port，artifact replay 同样启用。四个桌面平台共用 `consumer-install` 矩阵，OpenHarmony 使用 `consumer-install-openharmony` 和 ci-runner。

有 `test()` 的 primary 另外形成五 OS 功能测试矩阵；它只补充真实 API、CLI、加载和工程行为，不是进入安装矩阵的门槛。缺 `test()` 的配方在覆盖报告中标记为 notice，设置 `CONSUMER_REQUIRE_ALL=true` 后仍可按功能测试覆盖要求改为失败。是否通过必须查看本轮各 OS job，不能沿用旧提交的绿色结果。

support 只用于仍有独立配套配方的场景，在依赖它的父包 job 中执行，不成为根依赖。prerequisites 引入配套构建产物与 alias overrides，但不重复执行其他 primary 的完整功能测试；这些主包各有自己的五 OS 门禁。

浏览器测试的 `PORT_TEST_BROWSER_ENDPOINT` 指向临时 Chromium CDP 服务。普通 OS 服务绑定 loopback；OpenHarmony consumer 在 ci-runner Docker 容器中执行，连接宿主 Docker bridge 上的浏览器代理，不开放公网端口。这里验证 OHOS 上的包及协议操作，不验证 OHOS 本地浏览器启动。

## 真实 overrides 和跨 OS 产物

每个 case 使用打包后的最小 `consumer-deps` 依赖包，正常声明上游包名与精确上游版本。根工程只通过 `overrides` 将传递依赖替换为 `npm:@ohos-npm-ports/<port>@<本次构建版本>`，并验证安装后的名称、版本、锁文件下载 URL 和 integrity。没有把 `file:` tarball 当作 override 的替代方案。

npm 不允许将根工程的直接依赖用不同 spec 的 override 替换（会报 `EOVERRIDE`）。直接依赖这些包的真实工程应修改 dependency 本身为 alias；本 harness 验证的是合法的传递依赖 overrides 路径。

构建 job 将本次临时 registry 中的精确 tarball 导出为 Actions artifact，携带来源 workflow commit SHA、port 目录、包名、版本与 SHA-512 integrity。各 OS job 下载 artifact，在各自的 loopback Verdaccio 重新发布同一批 tarball；不会跨 job 暴露 registry，不上传凭据、storage 或 `node_modules`。本次构建包禁用 npmjs 代理，其余依赖走 npmjs uplink。

Windows x64、Linux ARM64、Linux x86_64、macOS ARM64 分别运行原始 baseline 与 overrides 工程，比较功能结果；OpenHarmony ARM64 在 ci-runner 中运行 overrides 工程，因为上游原始 native bindings 通常不支持该平台。基于当前 OS 生成自己的 lockfile，再执行 `npm ci`；不共享不同 OS 的 lockfile。

Linux x86 指 x86_64，不包含 ia32。HTTP 检查覆盖生产页面、JS/CSS/图片资源，不包含浏览器 hydration、真机签名/沙箱或完整业务负载。

## 单 port × 五 OS 门禁

每个 consumer job 只能有一个 primary port（CONSUMER_PORT），仅允许带入它声明的 prerequisites。每个 primary 版本对应 5 个独立 consumer job（四个 OS job 加 OpenHarmony job）；任一 OS 失败，该版本不能算验证通过，整轮 CI 也不能成功。不会将不同 port 混在一个 job 中，再用整体成功推断某个包通过。

runner 不调用前端 build/start，也不读取 scenario.json。`test()` 自己决定检查内容；默认 Node 工程可执行 API、CLI、数据库等测试。报告的 result 必填，assets 仅是可选的前端检查数据。

`PORT_TEST_NPM_CLI` 指向该 job 的 npm CLI JS 文件，可用于跨平台执行 npm 命令（用 process.execPath 启动，避免依赖 npm.cmd 的 shell 行为）。

真实设备上的系统服务、签名和沙箱行为仍需在目标设备上验证。真机 harness 可以保留在 `tests/device/` 等目录。

## CI 基础设施约定

- `infrastructure.json` 是「改动后需全量验证」的唯一清单；`ci.yml` 的 `paths` 必须与之一致（`consumer-plan.test.mjs` 校验）。`*.md` 不触发全量。
- `build-infrastructure.json` 是其中会改变构建产物的子集（构建代码、构建脚本、工具版本），必须同时列在 `infrastructure.json`。只改清单里其余的文件时，只有哨兵 port 测试，且取 npm 上已发布的 tarball，不重新构建；改了这个子集里的文件，哨兵 port 重新构建。全部 port 的验证用手动 dispatch。`sentinel-ports.json` 里的 port 必须带 primary `test()` 且构建轻量。
- `.github/scripts/tool-versions.json` 固定 npm、Verdaccio、playwright-core 的精确版本；升级需单独提交。npm 安装带 `fetch-retries` 并对工具安装重试 3 次。
- 每个 OS 一个独立 consumer job（`consumer-tests-<os>-<arch>`），避免单个 matrix 超过 GitHub 的 256 项上限；共用步骤在 `.github/actions/consumer-job`。
- 失败时 runner 写 `FAIL ...` 到 step summary，并把 Verdaccio 日志、npm `_logs`、`.port-tests` 保存到 `.consumer-logs/`，由 `consumer-logs-*` artifact 上传（保留 3 天）。
- workflow 带 `concurrency`（PR 内新推送取消旧运行，main 不取消）和最小 `permissions`。
