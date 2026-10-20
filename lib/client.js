// Browser half of dsh-git-conventions.
//
// Registers the "Git conventions" page as its own settings section
// (`settings.section`), which is what puts an entry in the settings navigation
// rail. The page edits this plugin entry's own Config through
// `ctx.configForms`, so the form is derived from the host Config schema — no
// hand-rolled persistence, no DOM patching.
//
// The default rule text is locale-dynamic (the `default.commit` / `default.pr`
// dictionary keys fill the textarea placeholders) and only a user override
// becomes a stored value. All colors use --dsw-alias-* tokens so the page
// follows the shell's light/dark theme.
//
// i18n: UI copy lives in the `git-conventions` locale namespace (zh / en), with
// the active language following the host locale preference.
window.__ModuleLoader__.load({
  id: "dsh-git-conventions",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    var React = require("react");
    var jsxRuntime = require("react/jsx-runtime");
    // react/jsx-runtime takes children on `props`, never as a positional argument
    // (its third parameter is the key). These helpers put children where the
    // runtime reads them, so a call can never silently drop the text.
    function element(type, props, children) {
      if (children === undefined) return jsxRuntime.jsx(type, props);
      return Array.isArray(children)
        ? jsxRuntime.jsxs(type, { ...props, children })
        : jsxRuntime.jsx(type, { ...props, children });
    }

    var NS = "git-conventions";

    // Entry id of the host half; also the settings namespace the form is keyed
    // by. Must match the `id` in cordis.patch.yml.
    var ENTRY_ID = "git-conventions";

    // Sorted after the built-in sections (general 0, plugins 15, ...), so the
    // plugin's entry sits at the end of the settings navigation rail.
    var SECTION_ORDER = 500;

    var inject = ["slots", "configForms", "locale"];

    // zh is the key-set source of truth; en mirrors it key-for-key.
    // `default.commit` / `default.pr` mirror the COMMIT_INSTRUCTIONS_* /
    // PR_INSTRUCTIONS_* constants in lib/index.js — keep both in sync.
    var zh = {
      title: "Git 规范",
      intro: "拦截 git 提交、强制推送与 gh pr create 的固定结构问题，并提供重写指引。保存后即时生效。",
      sectionRules: "规则文本",
      "label.commit": "提交说明",
      "label.pr": "拉取请求指令",
      hintRules: "这段文字只作为拒绝后的重写指引展示给模型，不参与结构校验。留空则使用当前语言的内置默认文本。",
      sectionChecks: "结构校验",
      "label.strictCommit": "校验提交说明格式（Conventional Commits）",
      "label.forceWithLease": "push 必须使用 --force-with-lease",
      "label.requirePrBody": "gh pr create 必须提供标题与描述",
      sectionScope: "作用范围",
      "label.enforce": "启用拦截",
      "label.tools": "监听的工具（逗号分隔）",
      hintTools: "只有这些工具的命令行参数会被检查，例如 bash、terminal_send。",
      save: "保存",
      saving: "保存中…",
      saved: "已保存",
      saveError: "保存失败：{message}",
      saveRefused: "宿主未接受设置，可能已被其他页面修改。请重新加载后重试。",
      reload: "重新加载设置",
      loading: "加载中…",
      unavailable: "Git 规范设置不可用：宿主未加载该插件，或设置服务未挂载。",
      readOnly: "本部署的设置为只读。",
      "default.commit": "提交说明需遵循 Conventional Commits 规范：\n- 格式：<type>(<scope>): <subject>\n- type 必填，常用：feat / fix / docs / style / refactor / perf / test / build / ci / chore / revert\n- subject 使用祈使句、现在时，首字母小写，不以句号结尾\n- 破坏性变更：type 后加 !，或在正文写 BREAKING CHANGE\n- 示例：feat(agent): 新增 git 提交规范拦截",
      "default.pr": "拉取请求需满足以下模板：\n- 标题：简洁概括本次变更，使用祈使句\n- 描述需包含：\n  1. 变更动机与背景\n  2. 主要改动内容\n  3. 测试与验证方式\n  4. 影响范围与风险"
    };
    var en = {
      title: "Git conventions",
      intro: "Blocks structural problems in git commits, forced pushes, and gh pr create calls, and guides the rewrite. Changes apply immediately.",
      sectionRules: "Rule text",
      "label.commit": "Commit instructions",
      "label.pr": "Pull request instructions",
      hintRules: "This text is shown to the model only as rewrite guidance after a denial; it is not parsed for checks. Leave it empty to use the built-in default for the current language.",
      sectionChecks: "Structural checks",
      "label.strictCommit": "Check commit message format (Conventional Commits)",
      "label.forceWithLease": "Push must use --force-with-lease",
      "label.requirePrBody": "gh pr create must have a title and description",
      sectionScope: "Scope",
      "label.enforce": "Enforce",
      "label.tools": "Watched tools (comma separated)",
      hintTools: "Only these tools' command arguments are inspected, e.g. bash, terminal_send.",
      save: "Save",
      saving: "Saving…",
      saved: "Saved",
      saveError: "Save failed: {message}",
      saveRefused: "The host refused the changes; settings may have changed elsewhere. Reload and retry.",
      reload: "Reload settings",
      loading: "Loading…",
      unavailable: "Git conventions settings unavailable: the host has not loaded this plugin, or no settings service is mounted.",
      readOnly: "This deployment stores settings read-only.",
      "default.commit": "Commit messages must follow the Conventional Commits spec:\n- Format: <type>(<scope>): <subject>\n- type is required; common: feat / fix / docs / style / refactor / perf / test / build / ci / chore / revert\n- subject is imperative, present tense, lowercase-first, with no trailing period\n- Breaking change: append ! after type, or write BREAKING CHANGE in the body\n- Example: feat(agent): add git commit convention interception",
      "default.pr": "Pull requests must satisfy the following template:\n- Title: summarize the change concisely, in the imperative mood\n- Description must cover:\n  1. Motivation and background\n  2. Main changes\n  3. Testing and verification\n  4. Impact and risk"
    };

    // Theme-adaptive via the shell's --dsw-alias-* token sheets. CSS has no line
    // comments, so every rule must stay inside these strings:
    // - brand-primary flips near-black (light) to near-white (dark); its label
    //   therefore comes from the paired --dsw-alias-label-primary-foreground
    //   token, never a hardcoded white.
    // - A disabled primary button falls back to a neutral surface with a readable
    //   label; dimming the brand fill (or via opacity) hid the text in dark mode,
    //   which surfaced as a "grey block with no text" in the settings page.
    var STYLE_ID = "dsh-git-conventions-style";
    var CSS = [
      ".gc-page{display:flex;flex-direction:column;gap:20px;max-width:760px;color:var(--dsw-alias-label-primary)}",
      ".gc-title{font-size:16px;font-weight:600;margin:0 0 6px;line-height:24px}",
      ".gc-hint{font-size:14px;line-height:22px;margin:0;color:var(--dsw-alias-label-tertiary)}",
      ".gc-section{display:flex;flex-direction:column;gap:12px;padding-top:16px;border-top:.5px solid var(--dsw-alias-border-l2)}",
      ".gc-section-title{font-size:14px;font-weight:600;margin:0;line-height:22px;color:var(--dsw-alias-label-primary)}",
      ".gc-label{font-size:14px;line-height:22px;margin-top:4px;color:var(--dsw-alias-label-primary)}",
      ".gc-textarea{width:100%;box-sizing:border-box;min-height:150px;padding:12px 14px;font-size:13px;line-height:1.7;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);resize:vertical;outline:none;transition:border-color 120ms ease}",
      ".gc-textarea::placeholder{color:var(--dsw-alias-label-tertiary)}",
      ".gc-textarea:focus{border-color:var(--dsw-alias-brand-primary)}",
      ".gc-input{width:100%;box-sizing:border-box;height:36px;padding:0 14px;font-size:14px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);outline:none}",
      ".gc-input:focus{border-color:var(--dsw-alias-brand-primary)}",
      ".gc-row{display:flex;align-items:center;gap:10px;min-height:24px}",
      ".gc-check{width:18px;height:18px;margin:0;flex:none;accent-color:var(--dsw-alias-brand-primary);cursor:pointer}",
      ".gc-check-label{font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary);cursor:pointer}",
      ".gc-actions{display:flex;align-items:center;gap:12px;padding-top:8px}",
      // Sized to the host's own settings buttons: 36px tall, 14px side padding,
      // 14px/22px type. The smaller variant read as cramped next to them.
      ".gc-button{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:4px;height:36px;padding:0 20px;font-size:14px;line-height:22px;font-family:inherit;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);cursor:pointer}",
      ".gc-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}",
      ".gc-button[data-variant=primary]{color:var(--dsw-alias-label-primary-foreground);background:var(--dsw-alias-brand-primary);border-color:transparent}",
      ".gc-button:disabled{cursor:default}",
      ".gc-button[data-variant=primary]:disabled{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2)}",
      ".gc-status-ok{font-size:13px;color:var(--dsw-alias-state-success-primary)}",
      ".gc-status-err{font-size:13px;color:var(--dsw-alias-state-error-primary)}",
      ".gc-unavailable{font-size:13px;color:var(--dsw-alias-label-tertiary)}"
    ].join("");
    // Deliberately untagged: the client loader deletes every <style data-plugin=X>
    // when it tears down or reloads package X (removeOwnedStyles), which would strip
    // this page's layout mid-session. An untagged tag survives, and the id check
    // keeps a re-materialized factory from stacking duplicates.
    if (typeof document !== "undefined" && document.getElementById(STYLE_ID) === null) {
      var styleTag = document.createElement("style");
      styleTag.id = STYLE_ID;
      styleTag.textContent = CSS;
      document.head.appendChild(styleTag);
    }

    // Fields this page edits. Anything else in the Config schema is left alone.
    var FIELDS = ["commitInstructions", "prInstructions", "strictCommit", "useForceWithLease", "requirePrBody", "enforce", "tools"];
    var CHECKBOXES = ["strictCommit", "useForceWithLease", "requirePrBody", "enforce"];

    function initialValues(snapshot) {
      var value = snapshot.value || {};
      var values = {};
      for (var i = 0; i < FIELDS.length; i++) {
        var field = FIELDS[i];
        if (Array.isArray(value[field])) values[field] = value[field].join(", ");
        else values[field] = value[field] === undefined ? (CHECKBOXES.indexOf(field) >= 0 ? true : "") : value[field];
      }
      return values;
    }

    function normalize(field, raw) {
      if (field === "tools") {
        return raw.split(",").map(function (item) { return item.trim(); }).filter(function (item) { return item !== ""; });
      }
      return raw;
    }

    // The page owns its own tab strip: the entry is reachable as a standalone
    // settings section, so it must not depend on the built-in Plugins page.
    // The form itself binds to the entry's Config through `scope`.
    function GitConventionsPage(props) {
      var t = props.t;
      var scope = props.scope;
      var snapshot = React.useSyncExternalStore(
        function subscribe(cb) { return scope.subscribe(cb); },
        function getSnapshot() { return scope.getSnapshot(); }
      );

      var editState = React.useState(null);
      var edit = editState[0];
      var setEdit = editState[1];
      var savingState = React.useState(false);
      var saving = savingState[0];
      var setSaving = savingState[1];
      var messageState = React.useState(null);
      var message = messageState[0];
      var setMessage = messageState[1];

      if (snapshot.status === "loading" || snapshot.status === "idle") {
        return element("p", { className: "gc-unavailable" }, t("loading"));
      }
      if (snapshot.status !== "ready") {
        return element("p", { className: "gc-unavailable" }, t("unavailable"));
      }

      var writable = snapshot.writable === true;
      var values = edit ? edit.values : initialValues(snapshot);

      function update(field, raw) {
        setMessage(null);
        setEdit({
          revision: edit ? edit.revision : snapshot.revision,
          values: Object.assign({}, values, { [field]: raw })
        });
      }

      async function save() {
        if (saving || !writable || !edit) return;
        var ops = [];
        for (var i = 0; i < FIELDS.length; i++) {
          var field = FIELDS[i];
          var next = normalize(field, edit.values[field]);
          var current = snapshot.value ? snapshot.value[field] : undefined;
          if (JSON.stringify(next) === JSON.stringify(current)) continue;
          // An empty rule text means "use the locale default", which is a clear,
          // not a stored empty string.
          if ((field === "commitInstructions" || field === "prInstructions") && String(next).trim() === "") {
            ops.push({ op: "unset", path: [field] });
            continue;
          }
          ops.push({ op: "set", path: [field], value: next });
        }
        if (ops.length === 0) { setEdit(null); setMessage(null); return; }
        setSaving(true);
        setMessage(null);
        try {
          if (!await scope.mutate(ops, edit.revision)) throw new Error(t("saveRefused"));
          setEdit(null);
          setMessage({ type: "ok", text: t("saved") });
        } catch (err) {
          setMessage({ type: "error", text: t("saveError", { message: err && err.message ? err.message : String(err) }) });
        } finally {
          setSaving(false);
        }
      }

      function textarea(field, labelKey, rows) {
        return [
          element("label", { key: labelKey + "-label", htmlFor: "gc-" + field, className: "gc-label" }, t(labelKey)),
          element("textarea", {
            key: field,
            className: "gc-textarea",
            id: "gc-" + field,
            disabled: !writable || saving,
            value: values[field],
            placeholder: t("default." + (field === "commitInstructions" ? "commit" : "pr")),
            rows: rows,
            onChange: function (e) { update(field, e.target.value); }
          })
        ];
      }

      function checkbox(field, labelKey) {
        return element("div", { key: field, className: "gc-row" }, [
          element("input", {
            type: "checkbox",
            id: "gc-" + field,
            className: "gc-check",
            disabled: !writable || saving,
            checked: values[field] !== false,
            onChange: function (e) { update(field, e.target.checked); }
          }),
          element("label", { htmlFor: "gc-" + field, className: "gc-check-label" }, t(labelKey))
        ]);
      }

      return element("div", { className: "gc-page" }, [
        element("h3", { className: "gc-title" }, t("title")),
        element("p", { className: "gc-hint" }, writable ? t("intro") : t("readOnly")),

        element("section", { className: "gc-section" }, [
          element("h4", { className: "gc-section-title" }, t("sectionRules")),
          element("p", { className: "gc-hint" }, t("hintRules")),
          ...textarea("commitInstructions", "label.commit", 7),
          ...textarea("prInstructions", "label.pr", 7)
        ]),

        element("section", { className: "gc-section" }, [
          element("h4", { className: "gc-section-title" }, t("sectionChecks")),
          checkbox("strictCommit", "label.strictCommit"),
          checkbox("useForceWithLease", "label.forceWithLease"),
          checkbox("requirePrBody", "label.requirePrBody")
        ]),

        element("section", { className: "gc-section" }, [
          element("h4", { className: "gc-section-title" }, t("sectionScope")),
          checkbox("enforce", "label.enforce"),
          element("label", { htmlFor: "gc-tools", className: "gc-label" }, t("label.tools")),
          element("input", {
            className: "gc-input",
            id: "gc-tools",
            type: "text",
            disabled: !writable || saving,
            value: values.tools,
            onChange: function (e) { update("tools", e.target.value); }
          }),
          element("p", { className: "gc-hint" }, t("hintTools"))
        ]),

        element("div", { className: "gc-actions" }, [
          element("button", {
            type: "button",
            className: "gc-button",
            "data-variant": "primary",
            disabled: !writable || saving || !edit,
            onClick: save
          }, saving ? t("saving") : t("save")),
          edit ? element("button", {
            type: "button",
            className: "gc-button",
            disabled: saving,
            onClick: function () { setEdit(null); setMessage(null); }
          }, t("reload")) : null,
          message ? element("span", {
            role: "status",
            "aria-live": "polite",
            className: message.type === "ok" ? "gc-status-ok" : "gc-status-err"
          }, message.text) : null
        ])
      ]);
    }

    function apply(ctx) {
      var t = ctx.locale.bind(NS);
      ctx.effect(function () {
        return ctx.locale.register(NS, { zh: zh, en: en });
      }, "git-conventions: dictionaries");

      // A settings section is what renders the entry in the settings navigation
      // rail; registering only a Plugins-page tab would hide it from that list.
      // Registered unconditionally, like the pre-0.2.0 page: gating on
      // `configForms.whileServed` skips the registration whenever the describe
      // snapshot has not landed yet, which leaves the section absent for the
      // rest of the session.
      var scope = ctx.configForms.get(ENTRY_ID);
      ctx.slots.inject("settings.section", function () {
        return ctx.slots.register({
          name: "settings.section",
          id: ENTRY_ID,
          order: SECTION_ORDER,
          label: function () { return t("title"); },
          locale: NS,
          inject: function () { return { scope: scope }; }
        }, GitConventionsPage);
      });
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
