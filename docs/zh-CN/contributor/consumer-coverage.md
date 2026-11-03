# Consumer 覆盖

每个需要接入功能测试矩阵的 NPMBUILD 配方在 class 末尾提供有效 `test()`。primary 配方分别运行五 OS consumer；槽位与主包放在同一配方，由该配方的 artifact 和测试共同覆盖，不再作为独立 support port。缺少 `test()` 不会跳过五平台通用安装验证，可设置 CONSUMER_REQUIRE_ALL=true 将功能测试覆盖改为强制。

测试始终针对安装后的包。默认使用最小 Node 工程，API、CLI、数据库、Bun、终端与浏览器测试由各配方的 `test()` 实现。前端模板按需使用，专属 fixture 放在配方内。测试协议见 `.github/fixtures/consumer/README.md`。
