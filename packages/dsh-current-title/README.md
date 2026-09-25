# @klarkxy/dsh-current-title

Keep a DSH session title aligned with the current human task.

[简体中文](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-current-title/docs/README.zh-CN.md)

Migrated from [`dsh-plugins/dsh-current-title`](https://github.com/klarkxy/dsh-plugins/tree/main/plugins/dsh-current-title). Title type labels stay bilingual (`功能` / `Feature`, and the rest of the fixed vocabulary). Generation uses `@klarkxy/dsh-ai-services` purpose `current-title.generate` on the weak role.

The bundle insert is enabled after installation. It does not permanently turn off the built-in first-prompt title provider: this entry claims the native `sessionTitle` slot only while active, and disabling restores that owner when this package still owns the slot and the displaced loader entry is unchanged. Locale follows the host preference automatically; there is no settings page.

## Install

Requires Node.js ≥22 and DSH `0.1.7-rc.2`. The **当前标题** entry starts enabled and can be disabled in plugin settings. Native title storage and scheduling come from host `sessionTitle`; generation needs `@klarkxy/dsh-ai-services`.

```sh
npm install @klarkxy/dsh-current-title
```

## Host RPC

Channel `/dsh-current-title` requires the host authorization policy.

- `status` — current settings, slot support and ownership, and per-session title state (title, source kind, generating, pinned) when `sessionId` is given.
- `settings` — update the stored locale mode with compare-and-swap (`{ locale, expectedRevision }`). The stored mode is `auto`, so type labels follow the host locale preference.
- `regenerate` — regenerate one session's title (`{ sessionId }`); fails with `not-found` for an unknown session and `unavailable` while the title provider is inactive.

## Title shape

```text
0903 | 修复 | 登录回调失败
```

Only recent real human `user/message` events are used. Plugin auxiliary messages are ignored. A manual rename is kept by native title storage. Disable cancels work and drops late results.

## License

[SATA License 2.1](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-current-title/LICENSE), including attribution for the original `dsh-plugins` sources.

Hosts that bundle this feature usually enable it by default; where the host supports live plugin switching, toggling needs no restart. Standalone DSH must load `@klarkxy/dsh-ai-services` before this package; installation or removal may require a restart when the host asks for one.
