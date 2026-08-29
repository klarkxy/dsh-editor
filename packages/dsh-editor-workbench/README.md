# dsh-editor-workbench

Private Host-only plugin for DSH Editor project lifecycle and bounded project-context compilation.

It is bundled only in the desktop-owned `dsh-editor` profile. Its browser-safe wire contract is exported from `dsh-editor-workbench/contracts`; the Host implementation is not a public plugin API.

The Host injects only connection, sessions, workspace registry, filesystem, and sandbox policy. It derives every root from a live session and reuses `dsh-manuscript/host-api`; callers cannot supply a trusted cwd.

To replace this implementation, preserve `/dsh-editor-workbench` and its endpoint payloads, remove `editor-workbench` from the profile, then add exactly one replacement entry. Never load two handlers for the same channel.
