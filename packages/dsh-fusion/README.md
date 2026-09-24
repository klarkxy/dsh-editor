# Fusion

Fusion pairs the current assistant with one persistent native Sidekick. The Lead delegates a bounded task, reads the exact result, and accepts it or requests a revision. DeepSeek Harness remains responsible for sessions, tools, permissions, models and execution history.

The plugin is preinstalled in DSH Editor and **disabled by default**. Enable **Fusion 协作** in Settings → Plugins. There is no additional conversation switch. Existing writing conversations participate when enabled; child sessions do not become new Leads.

In Editor, the Lead handles discussion, planning, maintenance and review. The Writer produces an exact candidate. Review approval does not change your manuscript: open the candidate preview and choose **采用** to apply it. Host checks the original source versions and any unsaved drafts before writing. If the source changed, preserve the candidate and request a new revision against the current text.

Text proposals for both manuscripts and outlines go through the Writer because the ordinary-folder project model does not reliably classify file contents. Structural operations and supported maintenance tools remain with the Lead. Candidate text never streams into the manuscript.

In native Web, the Sidekick uses the existing native tool and permission system. The collaboration card links to its native execution record. Generic tasks can already have changed files during execution; their accepted result is a review status, not a pending manuscript application.

## Model and lifecycle

Fusion registers the `fusion.sidekick` purpose with the shared AI services model settings. Its default is the host Chat role. A pair keeps the route selected when it was created; changed settings apply to new pairs. Fantasy models require explicit configuration.

At most one task runs in each pair. Revisions and later tasks reuse the same native child session. Stop cancels participating work; closing a card only closes the view. Disabling the plugin stops owned work and preserves its records and candidates.

A process restart does not replay uncertain messages or file writes. Inspect the task card and native history before explicitly resuming or notifying the Lead again. If application was interrupted, Fusion compares the persisted write intent with the current file. It never retries an uncertain write automatically or overwrites later author edits.

## Package use

This package has no dependency on private Editor packages. Install its bundle together with `@klarkxy/dsh-ai-services` on compatible DSH `0.1.7-alpha.1`. Enable its `fusion` entry through the host plugin configuration. The native Web adapter uses the existing conversation and child-session navigation.

The Editor Host supplies a narrow `fusionWriting` service. Only Host code receives that application port; browser commands supply stored candidate identity and author actions, never replacement candidate content or a new destination.

## Development checks

- `pnpm test:fusion`: deterministic service/native boundary tests and type checking.
- `pnpm exec vitest run packages/dsh-editor-workbench/src/fusion-host.spec.ts`: Host file authority and version checks.
- `pnpm test:e2e:fusion`: Editor and standalone Web on the isolated real native runtime with a local deterministic model fixture, after workspace build and desktop runtime preparation.

Deterministic integration tests establish wiring and lifecycle behavior. They do not measure live model writing quality or provider cache savings.
