// Host half of dsh-git-conventions.
//
// Registers a user-settings namespace and guards the `bash` tool so that
// git commit / push / gh pr create calls follow the configured conventions.
// The rule text lives entirely in settings; this module only encodes the
// generic Conventional Commits shape check and command parsing.
//
// i18n: default rule text and denial messages are bilingual (zh / en). The
// active language comes from the host's `locale.preference` setting (see
// @deepseek-ai/dsh-client-locale); absence falls back to zh — the browser
// derived locale is only visible client-side. Language and user overrides are
// resolved lazily per guard call, so switches take effect immediately.
// User-stored rule text always wins and is language-independent.
//
// Default rule text lives in the constants below AND in the client dictionary
// (`default.commit` / `default.pr` keys in lib/client.js) — keep both in sync.
import z from 'schemastery';

const NAMESPACE = 'git-conventions';

const COMMIT_INSTRUCTIONS_ZH = [
  '提交说明需遵循 Conventional Commits 规范：',
  '- 格式：<type>(<scope>): <subject>',
  '- type 必填，常用：feat / fix / docs / style / refactor / perf / test / build / ci / chore / revert',
  '- subject 使用祈使句、现在时，首字母小写，不以句号结尾',
  '- 破坏性变更：type 后加 !，或在正文写 BREAKING CHANGE',
  '- 示例：feat(agent): 新增 git 提交规范拦截'
].join('\n');

const COMMIT_INSTRUCTIONS_EN = [
  'Commit messages must follow the Conventional Commits spec:',
  '- Format: <type>(<scope>): <subject>',
  '- type is required; common: feat / fix / docs / style / refactor / perf / test / build / ci / chore / revert',
  '- subject is imperative, present tense, lowercase-first, with no trailing period',
  '- Breaking change: append ! after type, or write BREAKING CHANGE in the body',
  '- Example: feat(agent): add git commit convention interception'
].join('\n');

const PR_INSTRUCTIONS_ZH = [
  '拉取请求需满足以下模板：',
  '- 标题：简洁概括本次变更，使用祈使句',
  '- 描述需包含：',
  '  1. 变更动机与背景',
  '  2. 主要改动内容',
  '  3. 测试与验证方式',
  '  4. 影响范围与风险'
].join('\n');

const PR_INSTRUCTIONS_EN = [
  'Pull requests must satisfy the following template:',
  '- Title: summarize the change concisely, in the imperative mood',
  '- Description must cover:',
  '  1. Motivation and background',
  '  2. Main changes',
  '  3. Testing and verification',
  '  4. Impact and risk'
].join('\n');

// Bilingual framing for denial messages. The rule text itself is echoed
// verbatim from settings; only the framing around it is translated here.
const MSG = {
  zh: {
    commitDenied: '提交信息不符合配置的提交说明规则：',
    prDenied: 'gh pr create 不符合配置的拉取请求指令：',
    rulesLabel: '当前提交说明规则：',
    prRulesLabel: '当前拉取请求指令：',
    rewriteCommit: '请重写后重新提交。',
    rewritePr: '请补齐标题与描述后重新提交。',
    forceHint: '检测到 git push 使用裸 --force（或 -f）。已启用 "push 使用 --force-with-lease"，请改用 --force-with-lease 后重新提交。',
    format: '提交首行需符合 "<type>(<scope>): <subject>" 格式，例如 "feat(agent): 说明"',
    emptySubject: 'subject（冒号后的说明）不能为空',
    trailingPeriod: 'subject 不应以句号结尾',
    missingTitle: '缺少 --title（PR 标题）',
    missingBody: '缺少 --body（PR 描述）'
  },
  en: {
    commitDenied: 'Commit message does not conform to the configured commit rules:',
    prDenied: 'gh pr create does not conform to the configured pull request instructions:',
    rulesLabel: 'Current commit rules:',
    prRulesLabel: 'Current pull request instructions:',
    rewriteCommit: 'Please rewrite and commit again.',
    rewritePr: 'Please provide a title and description, then retry.',
    forceHint: 'git push with a bare --force (or -f) was detected. "Use --force-with-lease for push" is enabled — switch to --force-with-lease and retry.',
    format: 'The first line must match "<type>(<scope>): <subject>", e.g. "feat(agent): ..."',
    emptySubject: 'subject (text after the colon) must not be empty',
    trailingPeriod: 'subject must not end with a period',
    missingTitle: 'missing --title (PR title)',
    missingBody: 'missing --body (PR description)'
  }
};

const Config = z.object({
  commitInstructions: z.string().default(''),
  prInstructions: z.string().default(''),
  enforce: z.boolean().default(true),
  useForceWithLease: z.boolean().default(true)
});

// Read the host's explicit locale preference. Absence falls back to zh; the
// browser-derived locale is only visible client-side. Failures degrade to zh.
function localeOf(ctx) {
  try {
    const locale = ctx.settings.get('locale');
    return locale && locale.preference === 'en' ? 'en' : 'zh';
  } catch {
    return 'zh';
  }
}

function defaultCommit(lang) {
  return lang === 'en' ? COMMIT_INSTRUCTIONS_EN : COMMIT_INSTRUCTIONS_ZH;
}

function defaultPr(lang) {
  return lang === 'en' ? PR_INSTRUCTIONS_EN : PR_INSTRUCTIONS_ZH;
}

// The user's own stored rule text for a field, or undefined when the user has
// not overridden it (presence in the raw user section marks an override).
function userOverride(ctx, field) {
  try {
    const descriptor = ctx.settings.describe().find((d) => d.ns === NAMESPACE);
    const user = descriptor && descriptor.user;
    if (user && typeof user[field] === 'string' && user[field].trim() !== '') return user[field];
  } catch {
    // settings unavailable — treat as no override
  }
  return undefined;
}

// Effective rule text for a field: the user's stored text wins; otherwise the
// locale default applies.
function resolveRules(ctx, field, lang) {
  const overridden = userOverride(ctx, field);
  if (overridden !== undefined) return overridden;
  return field === 'commitInstructions' ? defaultCommit(lang) : defaultPr(lang);
}

export const name = 'dsh-git-conventions';
export const inject = ['tools', 'settings'];

export function apply(ctx) {
  // No composition `base` layer: the default rule text is resolved lazily per
  // guard call (locale + user-override aware), so a language switch or a saved
  // override takes effect immediately — no restart needed. The client renders
  // the same defaults from its own locale dictionary (keep in sync with the
  // `default.commit` / `default.pr` keys in lib/client.js).
  const scope = ctx.settings.register(NAMESPACE, Config, { applies: 'live' });

  ctx.tools.guard((execution) => {
    if (!execution || execution.name !== 'bash') return undefined;
    const args = execution.arguments;
    if (!args || typeof args !== 'object' || typeof args.command !== 'string') return undefined;

    const config = scope.get();
    if (!config || config.enforce !== true) return undefined;

    const lang = localeOf(ctx);
    return inspectCommand(tokenize(args.command), config, lang, {
      commitRules: resolveRules(ctx, 'commitInstructions', lang),
      prRules: resolveRules(ctx, 'prInstructions', lang)
    });
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
// Problem texts are localized per `lang`.
function validateCommitSubject(message, lang) {
  const firstLine = String(message == null ? '' : message).split('\n')[0].trim();
  const problems = [];
  const m = MSG[lang] || MSG.zh;
  const match = /^([a-z][a-z0-9_-]*)(\(([^()]*)\))?(!)?:\s*(.+)$/.exec(firstLine);
  if (!match) {
    problems.push(m.format);
  } else {
    const subject = match[5].trim();
    if (subject.length === 0) problems.push(m.emptySubject);
    if (/[.。]$/.test(subject)) problems.push(m.trailingPeriod);
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
  if (title == null || title.trim() === '') problems.push('title');
  if (body == null || body.trim() === '') problems.push('body');
  return problems;
}

function commitDenial(problems, rules, lang) {
  const m = MSG[lang] || MSG.zh;
  const lines = [m.commitDenied];
  for (const p of problems) lines.push('  - ' + p);
  lines.push('', m.rulesLabel, String(rules == null ? '' : rules).trim(), '', m.rewriteCommit);
  return lines.join('\n');
}

function prDenial(problems, rules, lang) {
  const m = MSG[lang] || MSG.zh;
  const lines = [m.prDenied];
  for (const p of problems) lines.push('  - ' + (p === 'title' ? m.missingTitle : m.missingBody));
  lines.push('', m.prRulesLabel, String(rules == null ? '' : rules).trim(), '', m.rewritePr);
  return lines.join('\n');
}

function inspectCommand(tokens, config, lang, defaults) {
  const m = MSG[lang] || MSG.zh;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === 'git') {
      const found = gitSubcommand(tokens, i);
      if (found.subcommand === 'commit') {
        const rules = defaults.commitRules;
        if (typeof rules === 'string' && rules.trim() !== '') {
          const msg = extractCommitMessage(tokens, found.index);
          if (msg.hasInline) {
            const problems = validateCommitSubject(msg.inline, lang);
            if (problems.length > 0) return commitDenial(problems, rules, lang);
          }
        }
      } else if (found.subcommand === 'push') {
        if (config.useForceWithLease === true && hasBareForce(tokens, found.index)) {
          return m.forceHint;
        }
      }
    } else if (t === 'gh') {
      const createIndex = ghPrCreateIndex(tokens, i);
      if (createIndex >= 0) {
        const rules = defaults.prRules;
        if (typeof rules === 'string' && rules.trim() !== '') {
          const problems = checkPr(tokens, createIndex);
          if (problems.length > 0) return prDenial(problems, rules, lang);
        }
      }
    }
  }
  return undefined;
}
