# dsh-editor-cards

Desktop-only character-card and worldbook plugin. Host owns `/dsh-editor-cards`
(`cards.list` / `cards.references` / `cards.metaSet` / `cards.create`) and
reuses `dsh-manuscript/host-api` `withWorkspaceWrite` for writes. Client
contributes the sidebar list, center detail overlay, and `cards-character` /
`cards-worldbook` commands. Proofread still scans cards through
`dsh-editor-cards/host-api`.
