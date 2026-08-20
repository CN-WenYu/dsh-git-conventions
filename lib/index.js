// Host half of @deepseek-ai/dsh-git-conventions.
//
// Registers a user-settings namespace and guards the `bash` tool so that
// git commit / push / gh pr create calls follow the configured conventions.
// The rule text lives entirely in settings; this module only encodes the
// generic Conventional Commits shape check and command parsing.
import z from 'schemastery';

const NAMESPACE = 'git-conventions';

const DEFAULT_COMMIT_INSTRUCTIONS = [
  '提交说明需遵循 Conventional Commits 规范：',
  '- 格式：<type>(<scope>): <subject>',
  '- type 必填，常用：feat / fix / docs / style / refactor / perf / test / build / ci / chore / revert',
  '- subject 使用祈使句、现在时，首字母小写，不以句号结尾',
  '- 破坏性变更：type 后加 !，或在正文写 BREAKING CHANGE',
  '- 示例：feat(agent): 新增 git 提交规范拦截'
].join('\n');

const DEFAULT_PR_INSTRUCTIONS = [
  '拉取请求需满足以下模板：',
  '- 标题：简洁概括本次变更，使用祈使句',
  '- 描述需包含：',
  '  1. 变更动机与背景',
  '  2. 主要改动内容',
  '  3. 测试与验证方式',
  '  4. 影响范围与风险'
].join('\n');

const Config = z.object({
  commitInstructions: z.string().default(''),
  prInstructions: z.string().default(''),
  enforce: z.boolean().default(true),
  useForceWithLease: z.boolean().default(true)
});

// Composition base layer: the default rule text the client renders as
// placeholder and the guard enforces when the user has not overridden it.
const BASE = {
  commitInstructions: DEFAULT_COMMIT_INSTRUCTIONS,
  prInstructions: DEFAULT_PR_INSTRUCTIONS
};

export const name = 'dsh-git-conventions';
export const inject = ['tools', 'settings'];

export function apply(ctx) {
  const scope = ctx.settings.register(NAMESPACE, Config, { applies: 'live', base: BASE });

  ctx.tools.guard((execution) => {
    if (!execution || execution.name !== 'bash') return undefined;
    const args = execution.arguments;
    if (!args || typeof args !== 'object' || typeof args.command !== 'string') return undefined;

    const config = scope.get();
    if (!config || config.enforce !== true) return undefined;

    return inspectCommand(tokenize(args.command), config);
  });
}

const COMMAND_SEPARATORS = ['&&', '||', ';', '|', '|&', '>', '>>', '<', '&'];

function isSeparator(token) {
  return COMMAND_SEPARATORS.indexOf(token) !== -1;
}

function isWhitespace(ch) {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
}

// Shell-aware argv tokenizer: handles single/double quotes and backslash
// escapes, including a quoted section attached to a flag such as -m"msg".
function tokenize(command) {
  const tokens = [];
  let i = 0;
  const n = command.length;
  while (i < n) {
    if (isWhitespace(command[i])) { i++; continue; }
    let buf = '';
    while (i < n) {
      const c = command[i];
      if (isWhitespace(c)) break;
      if (c === '"' || c === "'") {
        const quote = c;
        i++;
        while (i < n && command[i] !== quote) {
          if (command[i] === '\\' && i + 1 < n) { buf += command[i + 1]; i += 2; continue; }
          buf += command[i]; i++;
        }
        if (i < n) i++;
        continue;
      }
      if (c === '\\' && i + 1 < n) { buf += command[i + 1]; i += 2; continue; }
      buf += c; i++;
    }
    if (buf.length > 0) tokens.push(buf);
  }
  return tokens;
}

// After a `git` token, skip global options until the subcommand appears.
function gitSubcommand(tokens, gitIndex) {
  let j = gitIndex + 1;
  while (j < tokens.length) {
    const t = tokens[j];
    if (isSeparator(t)) return { subcommand: null, index: -1 };
    if (t === '-C' || t === '-c' || t === '--git-dir' || t === '--work-tree' || t === '--namespace' || t === '--super-prefix' || t === '--config-env') {
      j += 2; continue;
    }
    if (t.indexOf('--git-dir=') === 0 || t.indexOf('--work-tree=') === 0 || t.indexOf('--namespace=') === 0 || t.indexOf('--config-env=') === 0 || t.indexOf('--super-prefix=') === 0) {
      j += 1; continue;
    }
    if (t[0] === '-') { j += 1; continue; }
    return { subcommand: t, index: j };
  }
  return { subcommand: null, index: -1 };
}

// Extract the commit message carried by -m/--message (inline) and record
// -F/--file paths. File-backed messages cannot be read synchronously here,
// so they are left alone rather than falsely blocked.
function extractCommitMessage(tokens, startIndex) {
  const messages = [];
  const files = [];
  let hasInline = false;
  let hasFile = false;
  const pushMessage = (v) => { if (v != null && v !== '') { messages.push(v); hasInline = true; } };
  for (let j = startIndex + 1; j < tokens.length; j++) {
    const t = tokens[j];
    if (isSeparator(t)) break;
    if (t === '-m' || t === '--message') {
      if (j + 1 < tokens.length) { pushMessage(tokens[j + 1]); j++; }
    } else if (t.indexOf('--message=') === 0) {
      pushMessage(t.slice('--message='.length));
    } else if (t[0] === '-' && t[1] === 'm' && t.length > 2) {
      pushMessage(t.slice(2));
    } else if (t[0] === '-' && t[1] !== '-') {
      const mIdx = t.indexOf('m');
      if (mIdx >= 2) {
        const after = t.slice(mIdx + 1);
        if (after !== '') pushMessage(after);
        else if (j + 1 < tokens.length) { pushMessage(tokens[j + 1]); j++; }
      }
    } else if (t === '-F' || t === '--file') {
      if (j + 1 < tokens.length) { files.push(tokens[j + 1]); hasFile = true; j++; }
    } else if (t.indexOf('--file=') === 0) {
      files.push(t.slice('--file='.length)); hasFile = true;
    }
  }
  return { inline: messages.join('\n'), hasInline, files, hasFile };
}

// Generic Conventional Commits structural check. The prose rules are echoed
// verbatim from settings; this only validates the machine-checkable shape.
function validateCommitSubject(message) {
  const firstLine = String(message == null ? '' : message).split('\n')[0].trim();
  const problems = [];
  const match = /^([a-z][a-z0-9_-]*)(\(([^()]*)\))?(!)?:\s*(.+)$/.exec(firstLine);
  if (!match) {
    problems.push('提交首行需符合 "<type>(<scope>): <subject>" 格式，例如 "feat(agent): 说明"');
  } else {
    const subject = match[5].trim();
    if (subject.length === 0) problems.push('subject（冒号后的说明）不能为空');
    if (/[.。]$/.test(subject)) problems.push('subject 不应以句号结尾');
  }
  return problems;
}

function hasBareForce(tokens, startIndex) {
  for (let j = startIndex + 1; j < tokens.length; j++) {
    const t = tokens[j];
    if (isSeparator(t)) break;
    if (t === '--force' || t === '-f') return true;
  }
  return false;
}

// gh [global flags] pr create -> index of the `create` token, or -1.
function ghPrCreateIndex(tokens, ghIndex) {
  let j = ghIndex + 1;
  while (j < tokens.length) {
    const t = tokens[j];
    if (isSeparator(t)) return -1;
    if (t === '-R' || t === '--repo' || t === '-H' || t === '--hostname') { j += 2; continue; }
    if (t[0] === '-') { j += 1; continue; }
    if (t === 'pr') {
      let k = j + 1;
      while (k < tokens.length && !isSeparator(tokens[k]) && tokens[k][0] === '-') k += 1;
      if (k < tokens.length && tokens[k] === 'create') return k;
      return -1;
    }
    return -1;
  }
  return -1;
}

function checkPr(tokens, createIndex) {
  let title = null;
  let body = null;
  for (let j = createIndex + 1; j < tokens.length; j++) {
    const t = tokens[j];
    if (isSeparator(t)) break;
    if (t === '-t' || t === '--title') { if (j + 1 < tokens.length) { title = tokens[j + 1]; j++; } }
    else if (t.indexOf('--title=') === 0) { title = t.slice('--title='.length); }
    else if (t === '-b' || t === '--body') { if (j + 1 < tokens.length) { body = tokens[j + 1]; j++; } }
    else if (t.indexOf('--body=') === 0) { body = t.slice('--body='.length); }
  }
  const problems = [];
  if (title == null || title.trim() === '') problems.push('缺少 --title（PR 标题）');
  if (body == null || body.trim() === '') problems.push('缺少 --body（PR 描述）');
  return problems;
}

function commitDenial(problems, instructions) {
  const lines = ['提交信息不符合配置的提交说明规则：'];
  for (const p of problems) lines.push('  - ' + p);
  lines.push('', '当前提交说明规则：', String(instructions == null ? '' : instructions).trim(), '', '请重写后重新提交。');
  return lines.join('\n');
}

function prDenial(problems, instructions) {
  const lines = ['gh pr create 不符合配置的拉取请求指令：'];
  for (const p of problems) lines.push('  - ' + p);
  lines.push('', '当前拉取请求指令：', String(instructions == null ? '' : instructions).trim(), '', '请补齐标题与描述后重新提交。');
  return lines.join('\n');
}

function inspectCommand(tokens, config) {
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === 'git') {
      const found = gitSubcommand(tokens, i);
      if (found.subcommand === 'commit') {
        const rules = config.commitInstructions;
        if (typeof rules === 'string' && rules.trim() !== '') {
          const msg = extractCommitMessage(tokens, found.index);
          if (msg.hasInline) {
            const problems = validateCommitSubject(msg.inline);
            if (problems.length > 0) return commitDenial(problems, rules);
          }
        }
      } else if (found.subcommand === 'push') {
        if (config.useForceWithLease === true && hasBareForce(tokens, found.index)) {
          return '检测到 git push 使用裸 --force（或 -f）。已启用 "push 使用 --force-with-lease"，请改用 --force-with-lease 后重新提交。';
        }
      }
    } else if (t === 'gh') {
      const createIndex = ghPrCreateIndex(tokens, i);
      if (createIndex >= 0) {
        const rules = config.prInstructions;
        if (typeof rules === 'string' && rules.trim() !== '') {
          const problems = checkPr(tokens, createIndex);
          if (problems.length > 0) return prDenial(problems, rules);
        }
      }
    }
  }
  return undefined;
}
