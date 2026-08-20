# @deepseek-ai/dsh-git-conventions

**简体中文** | [English](./README.en.md)

为 DeepSeek Harness 的可配置 Git 提交 / 推送 / 拉取请求规范插件（静态插件，Host + Client 双端）。规则由用户在设置页配置，持久化交给宿主 settings 提供方（`dsh-settings-file` → `settings.yaml`），拦截逻辑不写死任何规则文本。

## 功能特性

- **提交说明结构校验**：对 `git commit -m` 的内联消息做 Conventional Commits 形状检查，不合规即拒绝，并回显具体不合规点与当前规则
- **推送安全提示**：`git push` 使用裸 `--force` / `-f` 时，提醒改用 `--force-with-lease`
- **PR 完整性校验**：`gh pr create` 缺少 `--title` / `--body` 时拒绝，并给出补齐提示
- **规则零硬编码**：所有规则文本来自设置页配置，修改后即时生效，无需重启
- **一键放行**：关闭「强制拦截」后守卫不再介入，全部命令放行
- **多语言**：设置页与拦截消息支持简体中文 / 英文，跟随宿主语言偏好，无需额外配置

## 截图

设置页中的「Git 规范」面板（深色 / 浅色模式；图中规则文本为默认中文示例，可在设置页改为任意语言）：

![Git 规范设置面板（深色）](assets/git-conventions-settings.png)

![Git 规范设置面板（浅色）](assets/git-conventions-settings-light.png)

## 安装

在目标 profile 安装（`dsh plugin add` 会读取 `dsh.bundle.patch` 并把包名追加进 `dsh.profile.bundles`）：

```sh
dsh plugin --profile web add <本包路径>
```

重启 `dsh web` 后，设置页会出现独立的「Git 规范」页。

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
| `commitInstructions` | string | Conventional Commits 规范（跟随语言 zh/en） | 提交说明规则，违规时作为重写提示回显 |
| `prInstructions` | string | PR 模板规范（跟随语言 zh/en） | 拉取请求标题/描述规则 |
| `enforce` | boolean | true | 是否强制拦截；关闭后全部放行 |
| `useForceWithLease` | boolean | true | `git push` 出现裸 `--force` 时提醒改用 `--force-with-lease` |

设置变更即时生效，无需重启。

## 国际化

插件界面与拦截消息支持简体中文（`zh`）与英文（`en`），语言跟随宿主 locale 偏好：

- **切换方式**：dsh 设置页「通用设置 → 语言」选择，持久化为 `settings.yaml` 的 `locale.preference`。未显式选择时，客户端回退到浏览器语言，服务端回退到中文。
- **界面文案与默认规则文本**（设置页标题、标签、按钮、状态提示、输入框占位符、拦截兜底规则）均切换后即时生效，无需重启。
- **自定义规则文本**与语言无关：一旦保存，始终优先于默认规则。

## 使用示例

### 合规：正常放行

```sh
git commit -m "feat(agent): 新增 git 提交规范拦截"
git commit -m "fix(commit): 修正 subject 校验的空消息边界"
git push --force-with-lease
gh pr create --title "feat: 支持 scope 校验" \
  --body "动机与背景 / 主要改动 / 测试与验证 / 影响范围"
```

### 违规：被拦截

```sh
# 缺少 <type>(<scope>): <subject> 前缀 → 拒绝
git commit -m "新增提交规范拦截"

# subject 以句号结尾 → 拒绝
git commit -m "feat: 新增提交规范拦截。"

# 裸 --force（useForceWithLease=true 时）→ 提醒改用 --force-with-lease
git push --force
git push -f

# 缺少 PR 标题或描述 → 拒绝
gh pr create --title "feat: 新增校验"          # 缺 --body
gh pr create --body "缺少标题"                  # 缺 --title
```

拦截时 reason 会列出具体不合规点、当前配置的完整规则文本，并提示「请重写后重新提交」。以 `git commit` 为例，agent 收到的拒绝消息形如：

```
提交信息不符合配置的提交说明规则：
  - 提交首行需符合 "<type>(<scope>): <subject>" 格式，例如 "feat(agent): 说明"

当前提交说明规则：
提交说明需遵循 Conventional Commits 规范：
- 格式：<type>(<scope>): <subject>
- type 必填，常用：feat / fix / docs / style / refactor / perf / test / build / ci / chore / revert
- subject 使用祈使句、现在时，首字母小写，不以句号结尾
- 破坏性变更：type 后加 !，或在正文写 BREAKING CHANGE
- 示例：feat(agent): 新增 git 提交规范拦截

请重写后重新提交。
```

### 不被拦截的情况

- `git commit -F commit-msg.txt`：基于文件的提交消息（守卫同步执行，无法读取文件内容）
- 关闭「强制拦截」（`enforce=false`）后的所有命令
- 规则文本留空（或清空）时，回退到当前语言的默认规则，校验仍然生效

## 实现方式

Host 端通过 `ctx.tools.guard()`（单调守卫）拦截 `bash` 工具：

- `git commit` 带 `-m`/`--message` 时，提取信息并做 Conventional Commits 结构校验；不合规则 deny，reason 包含具体不合规点、当前配置的完整规则和「请重写后重新提交」。
- `git push` 含裸 `--force`/`-f` 且 `useForceWithLease=true` 时，提醒改用 `--force-with-lease`。
- `gh pr create` 缺少 `--title` 或 `--body` 时，按 `prInstructions` 回显并拒绝。

## 已知限制

- `tools/execute` 管道不提供参数改写（“注入”），因此 PR 的“校验/注入”实现为校验：缺少标题/描述时拒绝并给出补齐提示。
- 守卫是同步的，无法读取 `-F`/`--file` 指向的文件，因此基于文件的消息不拦截（仅处理 `-m`/`--message` 内联消息）。
- 结构校验是通用 Conventional Commits 形状检查；具体规则文本以设置页配置为准，并在拒绝原因中原样回显。

## 许可证

MIT License © 2026 雨果，详见 [LICENSE](LICENSE)。
