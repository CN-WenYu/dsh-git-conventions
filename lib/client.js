// Browser half of dsh-git-conventions.
//
// Registers a standalone "Git 规范" settings section bound to the
// git-conventions namespace via ctx.settingsScope. The default rule text is
// locale-dynamic (see the `default.commit` / `default.pr` dictionary keys) and
// only a user override becomes the stored value. All colors use --dsw-alias-*
// tokens so the form follows the shell's light/dark theme.
//
// i18n: UI copy and the settings-row label live in the `git-conventions`
// locale namespace (zh / en). The active language follows the host locale
// preference (settings → Language row), with the browser language as the
// fallback — provided by @deepseek-ai/dsh-client-locale.
window.__ModuleLoader__.load({
  id: "dsh-git-conventions",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    var React = require("react");
    var primitives = require("@deepseek-ai/dsh-client-ui-primitives");
    var Button = primitives.Button;

    var NAMESPACE = "git-conventions";
    var NS = "git-conventions";

    var inject = ["slots", "connection", "remote", "settingsScope", "locale"];

    // Dictionary namespace owned by this plugin. zh is the key-set source of
    // truth; en mirrors it key-for-key (bilingual balance is enforced at
    // registration). `{message}` placeholders are substituted by t().
    //
    // `default.commit` / `default.pr` are the locale-dynamic default rule
    // texts rendered as textarea placeholders; keep them in sync with the
    // COMMIT_INSTRUCTIONS_* / PR_INSTRUCTIONS_* constants in lib/index.js.
    var zh = {
      title: "Git 规范",
      hint: "在 AI 执行 git commit / push / gh pr create 时按下方规则校验；保存后即时生效，无需重启。",
      "label.commit": "提交说明",
      "label.pr": "拉取请求指令",
      "label.enforce": "强制拦截",
      "label.forceWithLease": "push 使用 --force-with-lease",
      save: "保存",
      saving: "保存中…",
      saved: "已保存",
      saveError: "保存失败：{message}",
      loading: "加载中…",
      unavailable: "Git 规范设置不可用：宿主未挂载 settings 服务。",
      "default.commit": "提交说明需遵循 Conventional Commits 规范：\n- 格式：<type>(<scope>): <subject>\n- type 必填，常用：feat / fix / docs / style / refactor / perf / test / build / ci / chore / revert\n- subject 使用祈使句、现在时，首字母小写，不以句号结尾\n- 破坏性变更：type 后加 !，或在正文写 BREAKING CHANGE\n- 示例：feat(agent): 新增 git 提交规范拦截",
      "default.pr": "拉取请求需满足以下模板：\n- 标题：简洁概括本次变更，使用祈使句\n- 描述需包含：\n  1. 变更动机与背景\n  2. 主要改动内容\n  3. 测试与验证方式\n  4. 影响范围与风险"
    };
    var en = {
      title: "Git Conventions",
      hint: "Validates git commit / push / gh pr create against the rules below when the AI runs them; changes take effect immediately, no restart needed.",
      "label.commit": "Commit instructions",
      "label.pr": "Pull request instructions",
      "label.enforce": "Enforce",
      "label.forceWithLease": "Use --force-with-lease for push",
      save: "Save",
      saving: "Saving…",
      saved: "Saved",
      saveError: "Save failed: {message}",
      loading: "Loading…",
      unavailable: "Git Conventions settings unavailable: the host has no settings service mounted.",
      "default.commit": "Commit messages must follow the Conventional Commits spec:\n- Format: <type>(<scope>): <subject>\n- type is required; common: feat / fix / docs / style / refactor / perf / test / build / ci / chore / revert\n- subject is imperative, present tense, lowercase-first, with no trailing period\n- Breaking change: append ! after type, or write BREAKING CHANGE in the body\n- Example: feat(agent): add git commit convention interception",
      "default.pr": "Pull requests must satisfy the following template:\n- Title: summarize the change concisely, in the imperative mood\n- Description must cover:\n  1. Motivation and background\n  2. Main changes\n  3. Testing and verification\n  4. Impact and risk"
    };

    // Injected by the module loader and cleaned up on unload (see client-modules
    // claimStyles). Theme-adaptive via the shell's --dsw-alias-* token sheets.
    var CSS = [
      ".gc-page{display:flex;flex-direction:column;gap:14px;padding:4px 4px 24px;max-width:680px}",
      ".gc-heading{font-size:17px;font-weight:600;margin:0;color:var(--dsw-alias-label-primary)}",
      ".gc-hint{font-size:13px;line-height:1.5;margin:0;color:var(--dsw-alias-label-secondary)}",
      ".gc-label{font-size:13px;font-weight:600;margin-top:6px;color:var(--dsw-alias-label-primary)}",
      ".gc-textarea{width:100%;box-sizing:border-box;min-height:132px;padding:10px 12px;font-size:13px;line-height:1.6;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;resize:vertical;outline:none;transition:border-color 120ms ease}",
      ".gc-textarea::placeholder{color:var(--dsw-alias-label-tertiary)}",
      ".gc-textarea:hover{border-color:var(--dsw-alias-border-l3)}",
      ".gc-textarea:focus{border-color:var(--dsw-alias-brand-primary)}",
      ".gc-row{display:flex;align-items:center;gap:8px;margin-top:6px}",
      ".gc-check{width:16px;height:16px;margin:0;accent-color:var(--dsw-alias-brand-primary);cursor:pointer}",
      ".gc-check-label{font-size:13px;color:var(--dsw-alias-label-primary);cursor:pointer}",
      ".gc-actions{display:flex;align-items:center;gap:12px;margin-top:10px}",
      ".gc-status-ok{font-size:13px;color:var(--dsw-alias-state-success-primary)}",
      ".gc-status-err{font-size:13px;color:var(--dsw-alias-state-error-primary)}",
      ".gc-unavailable{font-size:13px;color:var(--dsw-alias-label-secondary)}"
    ].join("");
    var styleEl = document.createElement("style");
    styleEl.textContent = CSS;
    document.head.appendChild(styleEl);

    function GitConventionsSection(props) {
      var t = props.t;
      var scope = props.scope;
      var snapshot = React.useSyncExternalStore(
        function subscribe(cb) { return scope.subscribe(cb); },
        function getSnapshot() { return scope.getSnapshot(); }
      );

      var status = snapshot.status;
      var value = snapshot.value || {};
      var user = snapshot.user || {};
      var writable = snapshot.writable;

      var draftState = React.useState(null);
      var draft = draftState[0];
      var setDraft = draftState[1];
      var savingState = React.useState(false);
      var saving = savingState[0];
      var setSaving = savingState[1];
      var messageState = React.useState(null);
      var message = messageState[0];
      var setMessage = messageState[1];

      React.useEffect(function () {
        if (draft === null && status === "ready" && snapshot.value) {
          setDraft({
            commitInstructions: user.commitInstructions == null ? "" : user.commitInstructions,
            prInstructions: user.prInstructions == null ? "" : user.prInstructions,
            enforce: value.enforce !== false,
            useForceWithLease: value.useForceWithLease !== false
          });
        }
      }, [status, draft, snapshot.value, user.commitInstructions, user.prInstructions, value.enforce, value.useForceWithLease]);

      if (status === "unavailable") {
        return React.createElement("div", { className: "gc-unavailable" }, t("unavailable"));
      }
      if (draft === null) {
        return React.createElement("div", { className: "gc-unavailable" }, t("loading"));
      }

      function update(field, val) {
        var next = {
          commitInstructions: draft.commitInstructions,
          prInstructions: draft.prInstructions,
          enforce: draft.enforce,
          useForceWithLease: draft.useForceWithLease
        };
        next[field] = val;
        setDraft(next);
      }

      function save() {
        if (saving) return;
        setSaving(true);
        setMessage(null);
        var tasks = [];
        var curCommit = user.commitInstructions == null ? "" : user.commitInstructions;
        var curPr = user.prInstructions == null ? "" : user.prInstructions;
        if (draft.commitInstructions !== curCommit) tasks.push(["commitInstructions", draft.commitInstructions]);
        if (draft.prInstructions !== curPr) tasks.push(["prInstructions", draft.prInstructions]);
        if (draft.enforce !== value.enforce) tasks.push(["enforce", draft.enforce]);
        if (draft.useForceWithLease !== value.useForceWithLease) tasks.push(["useForceWithLease", draft.useForceWithLease]);

        var chain = Promise.resolve();
        for (var i = 0; i < tasks.length; i++) {
          (function (field, val) {
            chain = chain.then(function () { return scope.set(field, val); });
          })(tasks[i][0], tasks[i][1]);
        }
        chain.then(function () {
          setMessage({ type: "ok", text: t("saved") });
        }).catch(function (err) {
          setMessage({ type: "error", text: t("saveError", { message: err && err.message ? err.message : String(err) }) });
        }).finally(function () {
          setSaving(false);
        });
      }

      // Default rule text is locale-dynamic (mirrors the constants in
      // lib/index.js), so a language switch refreshes the placeholder without
      // a restart. Once the user has stored their own text the input carries
      // it, and no placeholder is needed.
      function placeholderFor(field) {
        var stored = user[field];
        if (stored != null && stored !== "") return "";
        return t(field === "commitInstructions" ? "default.commit" : "default.pr");
      }

      return React.createElement(
        "div",
        { className: "gc-page" },
        React.createElement("h2", { className: "gc-heading" }, t("title")),
        React.createElement("p", { className: "gc-hint" }, t("hint")),

        React.createElement("label", { className: "gc-label" }, t("label.commit")),
        React.createElement("textarea", {
          className: "gc-textarea",
          value: draft.commitInstructions,
          placeholder: placeholderFor("commitInstructions"),
          rows: 7,
          onChange: function (e) { update("commitInstructions", e.target.value); }
        }),

        React.createElement("label", { className: "gc-label" }, t("label.pr")),
        React.createElement("textarea", {
          className: "gc-textarea",
          value: draft.prInstructions,
          placeholder: placeholderFor("prInstructions"),
          rows: 7,
          onChange: function (e) { update("prInstructions", e.target.value); }
        }),

        React.createElement(
          "div",
          { className: "gc-row" },
          React.createElement("input", {
            type: "checkbox",
            id: "gc-enforce",
            className: "gc-check",
            checked: draft.enforce,
            onChange: function (e) { update("enforce", e.target.checked); }
          }),
          React.createElement("label", { htmlFor: "gc-enforce", className: "gc-check-label" }, t("label.enforce"))
        ),
        React.createElement(
          "div",
          { className: "gc-row" },
          React.createElement("input", {
            type: "checkbox",
            id: "gc-force-lease",
            className: "gc-check",
            checked: draft.useForceWithLease,
            onChange: function (e) { update("useForceWithLease", e.target.checked); }
          }),
          React.createElement("label", { htmlFor: "gc-force-lease", className: "gc-check-label" }, t("label.forceWithLease"))
        ),

        React.createElement(
          "div",
          { className: "gc-actions" },
          React.createElement(
            Button,
            {
              type: "button",
              variant: "primary",
              size: "sm",
              disabled: writable === false || saving,
              onClick: save
            },
            saving ? t("saving") : t("save")
          ),
          message ? React.createElement(
            "span",
            { className: message.type === "ok" ? "gc-status-ok" : "gc-status-err" },
            message.text
          ) : null
        )
      );
    }

    function apply(ctx) {
      var scope = ctx.settingsScope.bind({ namespace: NAMESPACE });

      ctx.effect(function () {
        return ctx.locale.register(NS, { zh: zh, en: en });
      }, "git-conventions: dictionaries");

      ctx.slots.inject("settings.section", function () {
        return ctx.slots.register({
          name: "settings.section",
          id: "git-conventions",
          order: 500,
          label: function () { return ctx.locale.bind(NS)("title"); },
          locale: NS,
          inject: function () { return { scope: scope }; }
        }, GitConventionsSection);
      });
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
