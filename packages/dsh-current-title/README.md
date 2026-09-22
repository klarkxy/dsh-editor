# @klarkxy/dsh-current-title

Keep a DSH session title aligned with the current human task.

[简体中文](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-current-title/docs/README.zh-CN.md)

Migrated from [`dsh-plugins/dsh-current-title`](https://github.com/klarkxy/dsh-plugins/tree/main/plugins/dsh-current-title). Title type labels stay bilingual (`功能` / `Feature`, and the rest of the fixed vocabulary). Generation uses `@klarkxy/dsh-ai-services` purpose `current-title.generate` on the weak role.

The bundle insert is enabled after installation. It does not permanently turn off the built-in first-prompt title provider: this entry claims the native `sessionTitle` slot only while active, and disabling restores that owner when this package still owns the slot and the displaced loader entry is unchanged.

## Install

Requires Node.js ≥22 and DSH `0.1.5-rc.2`. The **当前标题** entry starts enabled and can be disabled in plugin settings. Native title storage and scheduling come from host `sessionTitle`; generation needs `@klarkxy/dsh-ai-services`.

## Title shape

```text
0903 | 修复 | 登录回调失败
```

Only recent real human `user/message` events are used. Plugin auxiliary messages are ignored. A manual rename is kept by native title storage; **重新生成** unpins and retries. Disable cancels work and drops late results.

## License

[SATA License 2.1](LICENSE), including attribution for the original `dsh-plugins` sources.

The Editor preinstalls this feature disabled. On pinned DSH 0.1.5-rc.2, a change to the active client module graph needs a page reload or app restart; save your work first. Standalone DSH must load the shared AI service bundle explicitly as well as this feature. New 0.1.0 packages are local candidates until published; use the corresponding tarballs in .pack for local installation.

For native web profiles, append the following entry to the profile directory's `cordis.patch.yml` and restart DSH (the Editor provides its own per-feature switch):

```yaml
- id: current-title
  disabled: false
```
