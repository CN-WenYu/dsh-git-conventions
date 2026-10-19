import assert from 'node:assert/strict';
import test from 'node:test';
import * as plugin from '../lib/index.js';
import { apply } from '../lib/index.js';

// Mount the host half the way the 0.2.x loader does: a volatile Config reaches
// `apply` as the cordis config reference, whose current value is read through
// `.get()` and which the loader updates in place on every live settings write.
function mount(config = {}, preferences = []) {
  let guard;
  const value = { enforce: true, tools: ['bash', 'terminal_send'], ...config };
  const configRef = { get: () => value };
  const ctx = {
    get: (name) => name === 'settings'
      ? { describe: () => preferences.map((preference) => ({ ns: 'locale', value: { preference } })) }
      : undefined,
    effect: (fn, label) => { assert.equal(typeof label, 'string'); return fn(); },
    tools: { guard: (fn) => { guard = fn; return () => {}; } }
  };
  apply(ctx, configRef);
  return { guard, value };
}

const bash = (command) => ({ name: 'bash', arguments: { description: 'run', command } });
const terminal = (text) => ({ name: 'terminal_send', arguments: { sessionId: 's', text } });

test('denies a malformed commit, a forced push, and a PR without body', () => {
  const { guard } = mount();
  assert.match(guard(bash('git commit -m bad')), /提交信息不符合/);
  assert.match(guard(bash('git push --force')), /force-with-lease/);
  assert.match(guard(bash('gh pr create --title "fix: x"')), /拉取请求指令/);
  assert.equal(guard(bash('git commit -m "fix: valid"')), undefined);
  assert.equal(guard(bash('git push --force-with-lease')), undefined);
});

test('every structural check is a switch that can be turned off independently', () => {
  const { guard: noCommit } = mount({ strictCommit: false });
  assert.equal(noCommit(bash('git commit -m bad')), undefined);
  assert.match(noCommit(bash('git push -f')), /force-with-lease/);

  assert.equal(mount({ useForceWithLease: false }).guard(bash('git push -f')), undefined);
  assert.equal(mount({ requirePrBody: false }).guard(bash('gh pr create --title "x"')), undefined);
});

test('enforce is read live, so a settings write applies without a remount', () => {
  const { guard, value } = mount();
  assert.match(guard(bash('git commit -m bad')), /提交信息/);
  value.enforce = false;
  assert.equal(guard(bash('git commit -m bad')), undefined);
  value.enforce = true;
  assert.match(guard(bash('git commit -m bad')), /提交信息/);
});

test('rule text and locale are resolved per call', () => {
  const { guard, value } = mount({ commitInstructions: '' }, ['en']);
  assert.match(guard(bash('git commit -m bad')), /Commit message does not conform/);
  value.commitInstructions = 'Owner rule';
  assert.match(guard(bash('git commit -m bad')), /Owner rule/);
  assert.match(mount({ commitInstructions: '自有规则' }, ['zh']).guard(bash('git commit -m bad')), /自有规则/);
});

test('only configured tools are inspected', () => {
  const { guard: onlyBash } = mount({ tools: ['bash'] });
  assert.match(onlyBash(bash('git push -f')), /force-with-lease/);
  assert.equal(onlyBash(terminal('git push -f')), undefined);
  assert.match(mount().guard(terminal('git push -f')), /force-with-lease/);
});

test('unknown or hostile argument shapes are ignored rather than invented', () => {
  const { guard } = mount();
  assert.equal(guard({ name: 'read', arguments: { command: 'git push -f' } }), undefined);
  assert.equal(guard({ name: 'bash', arguments: { command: 42 } }), undefined);
  assert.equal(guard({ name: 'bash', arguments: null }), undefined);
  assert.equal(guard({ name: 'bash' }), undefined);
  assert.equal(guard(undefined), undefined);
  assert.equal(guard(bash('git commit -m "$MESSAGE"')), undefined);
});

test('a plain-object config still works when no reference is supplied', () => {
  // Defensive path: a direct caller may pass the resolved value instead of the
  // cordis config reference.
  let guard;
  apply({
    get: () => undefined,
    effect: (fn) => fn(),
    tools: { guard: (fn) => { guard = fn; } }
  }, { enforce: true, strictCommit: true, useForceWithLease: true, requirePrBody: true, tools: ['bash'] });
  assert.match(guard(bash('git push -f')), /force-with-lease/);
});

test('exports the Config schema the loader mounts the entry with', () => {
  assert.equal(plugin.name, 'dsh-git-conventions');
  assert.deepEqual(plugin.inject, ['tools']);
  const result = plugin.Config['~standard'].validate({});
  assert.equal(result.issues, undefined);
  assert.equal(plugin.Config.meta.volatile, true);
  assert.deepEqual(result.value.get(), {
    commitInstructions: '',
    prInstructions: '',
    enforce: true,
    tools: ['bash', 'terminal_send'],
    strictCommit: true,
    useForceWithLease: true,
    requirePrBody: true
  });
});
