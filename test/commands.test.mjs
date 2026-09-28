import assert from 'node:assert/strict';
import test from 'node:test';
import { apply } from '../lib/index.js';

let guard;
apply({
  settings: { describe: () => [], configure: () => () => {} },
  effect: (fn) => fn(), tools: { guard: (fn) => { guard = fn; } },
}, { get: () => ({ enforce: true, useForceWithLease: true }) });
const check = (command) => guard({ name: 'bash', arguments: { command } });

for (const command of [
  'true&&git push --force', 'git push --force;true',
  'git push > /tmp/log --force', 'git push 2>/tmp/log -f',
  'git push -vf', 'git push origin +HEAD:main',
  'git commit --allow-empty-message -m ""',
  'git commit --allow-empty-message --message=',
  'git commit -am bad', 'git -C /tmp commit -m bad',
  'git commit -m "fix: valid"\ngit commit -m bad',
  'git push --force-with-lease --force',
]) test(`denies ${JSON.stringify(command)}`, () => assert.equal(typeof check(command), 'string'));

for (const command of [
  'echo git push --force', 'printf "%s" "git" "push" "--force"',
  '# git push --force\necho safe', 'git push\necho --force',
  'git commit -m "fix: valid"', 'git commit -m "fix: valid" -m "body"',
  'git commit -m "fix: preserve ; and >"',
  'git commit -m "fix: preserve\nbody"',
  'git commit -m "fix: valid" -- -mfile',
  'git push --force-with-lease', 'git push -o --force origin main',
  'git push --repo +repository main',
  'gh pr create --title "fix: valid" --body "description"',
  'gh pr create --title "fix: valid" --body-file body.md',
  'gh pr create -t "fix: valid" -F -',
]) test(`allows ${JSON.stringify(command)}`, () => assert.equal(check(command), undefined));

test('rejects empty PR arguments and accepts quoted operator text as content', () => {
  assert.equal(typeof check('gh pr create --title "" --body text'), 'string');
  assert.equal(check('gh pr create --title ";" --body "|"'), undefined);
});

test('handles comments, continuations, explicit executable paths and assignment prefixes', () => {
  for (const command of ['# comment\ngit push -f', 'git push \\\n-f', 'LC_ALL=C /usr/bin/git push -f', '2>/tmp/log git push -f', 'gh pr new -t title']) {
    assert.equal(typeof check(command), 'string', command);
  }
});

test('does not fabricate values or execute unsupported shell syntax', () => {
  for (const command of ['git commit -m "$MESSAGE"', 'git commit -m "${MESSAGE:-fallback}"', 'echo $(git push -f)', 'cat <<EOF\ngit push -f\nEOF', 'git commit -m "unfinished']) {
    assert.equal(check(command), undefined, command);
  }
  assert.equal(check("git commit -m 'fix: keep $MESSAGE literally'"), undefined);
});
