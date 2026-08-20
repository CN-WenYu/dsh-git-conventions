# @deepseek-ai/dsh-git-conventions

为 DeepSeek Harness 的可配置 Git 提交 / 推送 / 拉取请求规范插件（静态插件，Host + Client 双端）。规则由用户在设置页配置，持久化交给宿主 settings 提供方（`dsh-settings-file` → `settings.yaml`），拦截逻辑不写死任何规则文本。

## 安装

在目标 profile 安装（`dsh plugin add` 会读取 `dsh.bundle.patch` 并把包名追加进 `dsh.profile.bundles`）：

```sh
dsh plugin --profile web add <本包路径>
```

重启 `dsh web` 后，设置页会出现独立的“Git 规范”页。

本地开发用 `dsh plugin --profile web add <工作区路径>` 会建立 `link:` 依赖（改源码后重启即生效）；此时宿主 `import z from 'schemastery'` 按模块真实路径解析，需要在工作区补一个可解析的依赖，例如：

```sh
mkdir -p node_modules
ln -s ~/.dsh/profiles/web/node_modules/schemastery node_modules/schemastery
```

发布到 npm 后按包名安装时无需该链接（包被复制进 profile 的 `node_modules`，依赖沿 profile 正常解析）。

## 配置项

命名空间 `git-conventions`：

| 字段 | 类型 | 默认 | 含义 |
|---|---|---|---|
| `commitInstructions` | string | Conventional Commits 中文规范 | 提交说明规则，违规时作为重写提示回显 |
| `prInstructions` | string | PR 模板规范 | 拉取请求标题/描述规则 |
| `enforce` | boolean | true | 是否强制拦截；关闭后全部放行 |
| `useForceWithLease` | boolean | true | `git push` 出现裸 `--force` 时提醒改用 `--force-with-lease` |

设置变更即时生效，无需重启。

## 拦截行为

Host 端通过 `ctx.tools.guard()`（单调守卫）拦截 `bash` 工具：

- `git commit` 带 `-m`/`--message` 时，提取信息并做 Conventional Commits 结构校验；不合规则 deny，reason 包含具体不合规点、当前配置的完整规则和“请重写后重新提交”。
- `git push` 含裸 `--force`/`-f` 且 `useForceWithLease=true` 时，提醒改用 `--force-with-lease`。
- `gh pr create` 缺少 `--title` 或 `--body` 时，按 `prInstructions` 回显并拒绝。

## 已知限制

- `tools/execute` 管道不提供参数改写（“注入”），因此 PR 的“校验/注入”实现为校验：缺少标题/描述时拒绝并给出补齐提示。
- 守卫是同步的，无法读取 `-F`/`--file` 指向的文件，因此基于文件的消息不拦截（仅处理 `-m`/`--message` 内联消息）。
- 结构校验是通用 Conventional Commits 形状检查；具体规则文本以设置页配置为准，并在拒绝原因中原样回显。
