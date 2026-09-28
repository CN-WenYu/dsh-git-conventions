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
import z from '@deepseek-ai/schemastery';
import parse from 'shell-quote/parse.js';

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
    forceHint: '检测到 git push 使用 --force、-f 或 +refspec 强制更新。已启用 "push 使用 --force-with-lease"，请改用 --force-with-lease 后重新提交。',
    format: '提交首行需符合 "<type>(<scope>): <subject>" 格式，例如 "feat(agent): 说明"',
    emptySubject: 'subject（冒号后的说明）不能为空',
    trailingPeriod: 'subject 不应以句号结尾',
    missingTitle: '缺少 --title（PR 标题）',
    missingBody: '缺少 --body 或 --body-file（PR 描述或来源）'
  },
  en: {
    commitDenied: 'Commit message does not conform to the configured commit rules:',
    prDenied: 'gh pr create does not conform to the configured pull request instructions:',
    rulesLabel: 'Current commit rules:',
    prRulesLabel: 'Current pull request instructions:',
    rewriteCommit: 'Please rewrite and commit again.',
    rewritePr: 'Please provide a title and description, then retry.',
    forceHint: 'git push with --force, -f, or a +refspec was detected. "Use --force-with-lease for push" is enabled — switch to --force-with-lease and retry.',
    format: 'The first line must match "<type>(<scope>): <subject>", e.g. "feat(agent): ..."',
    emptySubject: 'subject (text after the colon) must not be empty',
    trailingPeriod: 'subject must not end with a period',
    missingTitle: 'missing --title (PR title)',
    missingBody: 'missing --body or --body-file (PR description or source)'
  }
};

export const Config = z.object({
  commitInstructions: z.string().default(''),
  prInstructions: z.string().default(''),
  enforce: z.boolean().default(true),
  useForceWithLease: z.boolean().default(true)
}).volatile();

// Read the host's explicit locale preference. Absence falls back to zh; the
// browser-derived locale is only visible client-side. Failures degrade to zh.
function localeOf(ctx) {
  try {
    const locale = ctx.settings.describe().find((entry) => entry.ns === 'locale')?.value;
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

// Explicit config text wins; empty fields follow the current locale.
function resolveRules(config, field, lang) {
  const value = config[field];
  if (typeof value === 'string' && value.trim() !== '') return value;
  return field === 'commitInstructions' ? defaultCommit(lang) : defaultPr(lang);
}

export const name = 'dsh-git-conventions';
export const inject = ['tools', 'settings'];

export function apply(ctx, configRef) {
  // No composition `base` layer: the default rule text is resolved lazily per
  // guard call (locale + user-override aware), so a language switch or a saved
  // override takes effect immediately — no restart needed. The client renders
  // the same defaults from its own locale dictionary (keep in sync with the
  // `default.commit` / `default.pr` keys in lib/client.js).
  ctx.effect(() => ctx.settings.configure({ auto: false }));

  ctx.tools.guard((execution) => {
    if (!execution || execution.name !== 'bash') return undefined;
    const args = execution.arguments;
    if (!args || typeof args !== 'object' || typeof args.command !== 'string') return undefined;

    const config = configRef.get();
    if (!config || config.enforce !== true) return undefined;

    const lang = localeOf(ctx);
    for (const tokens of shellCommands(args.command)) {
      const denial = inspectCommand(tokens, config, lang, {
        commitRules: resolveRules(config, 'commitInstructions', lang),
        prRules: resolveRules(config, 'prInstructions', lang)
      });
      if (denial) return denial;
    }
    return undefined;
  });
}

// shell-quote owns word quoting. Preserve the line/comment boundaries it drops.
// ponytail: static simple commands only; use a Bash AST if compound scripts become a requirement.
function shellCommands(command) {
  let source = '';
  let quote = null;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (c === '\\' && quote !== "'" && i + 1 < command.length) {
      if (command[i + 1] !== '\n') source += c + command[i + 1];
      i++; continue;
    }
    if (!quote && c === '#' && (i === 0 || /[\s;&|()<>]/.test(command[i - 1]))) {
      while (i < command.length && command[i] !== '\n') i++;
      source += ';'; continue;
    }
    if (quote !== "'" && (c === '`' || (c === '$' && /[('"]/.test(command[i + 1] ?? '')))) return [];
    if (!quote && (c === '(' || c === ')' || (c === '<' && command[i + 1] === '<'))) return [];
    if (c === quote) quote = null;
    else if (!quote && (c === "'" || c === '"')) quote = c;
    if (!quote && /\d/.test(c) && (i === 0 || /[\s;&|]/.test(command[i - 1]))) {
      const fd = /^\d+(?=[<>])/.exec(command.slice(i));
      if (fd) { i += fd[0].length - 1; continue; }
    }
    source += c === '\n' && !quote ? ';' : c;
  }
  if (quote) return [];
  let parsed;
  try { parsed = parse(source, () => ({ unknown: true })); }
  catch { return []; } // Unsupported substitutions must not become invented argv.
  const commands = [];
  let words = [];
  let unknown = false;
  for (let i = 0; i <= parsed.length; i++) {
    const token = parsed[i];
    if (token === undefined || [';', '&&', '||', '|', '|&', '&'].includes(token?.op)) {
      if (!unknown && words.length) commands.push(words);
      words = []; unknown = false;
    } else if (['>', '>>', '<', '>&', '<&'].includes(token?.op)) {
      if (typeof parsed[++i] !== 'string') unknown = true;
    } else if (typeof token === 'string') words.push(token);
    else unknown = true;
  }
  return commands;
}

// After a `git` token, skip global options until the subcommand appears.
function gitSubcommand(tokens, gitIndex) {
  let j = gitIndex + 1;
  while (j < tokens.length) {
    const t = tokens[j];
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

// Inspect inline messages only; file contents remain outside this guard.
function extractCommitMessage(tokens, startIndex) {
  const messages = [];
  for (let j = startIndex + 1; j < tokens.length; j++) {
    const t = tokens[j];
    if (t === '--') break;
    if (t === '--message') messages.push(tokens[++j] ?? '');
    else if (t.startsWith('--message=')) messages.push(t.slice(10));
    else if (['--file', '--author', '--date', '--cleanup', '--reuse-message', '--reedit-message', '--fixup', '--squash', '--template', '--trailer', '--pathspec-from-file'].includes(t)) j++;
    else if (/^-[^-]/.test(t)) {
      for (let k = 1; k < t.length; k++) {
        if ('mFCctU'.includes(t[k])) {
          const value = t.slice(k + 1) || tokens[++j] || '';
          if (t[k] === 'm') messages.push(value);
          break;
        }
      }
    }
  }
  return { inline: messages.join('\n'), hasInline: messages.length > 0 };
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
  let options = true;
  let repository = false;
  for (let j = startIndex + 1; j < tokens.length; j++) {
    const t = tokens[j];
    if (options && t === '--') { options = false; continue; }
    if (options && t === '--force') return true;
    if (options && ['--repo', '--receive-pack', '--exec', '--push-option'].includes(t)) {
      if (t === '--repo') repository = true;
      j++; continue;
    }
    if (options && t.startsWith('--')) {
      if (t.startsWith('--repo=')) repository = true;
      continue;
    }
    if (options && /^-[^-]/.test(t)) {
      for (let k = 1; k < t.length; k++) {
        if (t[k] === 'f') return true;
        if (t[k] === 'o') { if (k === t.length - 1) j++; break; }
      }
      continue;
    }
    if (!repository) repository = true;
    else if (t.startsWith('+')) return true;
  }
  return false;
}

// gh [global flags] pr create -> index of the `create` token, or -1.
function ghPrCreateIndex(tokens, ghIndex) {
  let j = ghIndex + 1;
  while (j < tokens.length) {
    const t = tokens[j];
    if (t === '-R' || t === '--repo' || t === '-H' || t === '--hostname') { j += 2; continue; }
    if (t[0] === '-') { j += 1; continue; }
    if (t === 'pr') {
      let k = j + 1;
      while (k < tokens.length && tokens[k][0] === '-') k += 1;
      if (k < tokens.length && ['create', 'new'].includes(tokens[k])) return k;
      return -1;
    }
    return -1;
  }
  return -1;
}

function checkPr(tokens, createIndex) {
  let title = '';
  let body = '';
  for (let j = createIndex + 1; j < tokens.length; j++) {
    const t = tokens[j];
    if (t === '--') break;
    if (t === '-t' || t === '--title') title = tokens[++j] ?? '';
    else if (t.startsWith('--title=')) title = t.slice(8);
    else if (['-b', '--body', '-F', '--body-file'].includes(t)) body = tokens[++j] ?? '';
    else if (t.startsWith('--body=')) body = t.slice(7);
    else if (t.startsWith('--body-file=')) body = t.slice(12);
    else if (/^-[tbF].+/.test(t)) {
      if (t[1] === 't') title = t.slice(2);
      else body = t.slice(2);
    } else if (['-a', '--assignee', '-B', '--base', '-H', '--head', '-l', '--label', '-m', '--milestone', '-p', '--project', '-r', '--reviewer', '-T', '--template', '-R', '--repo', '--recover'].includes(t)) j++;
  }
  const problems = [];
  if (!title.trim()) problems.push('title');
  if (!body.trim()) problems.push('body');
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
  let i = 0;
  while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i] ?? '')) i++;
  const t = (tokens[i] ?? '').split('/').pop();
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
  return undefined;
}
