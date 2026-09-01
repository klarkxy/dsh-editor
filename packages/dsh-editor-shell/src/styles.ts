/* DSH Editor 界面样式。
 *
 * 全部为普通 CSS 字符串,由 client.ts 在渲染时通过 <style> 注入。
 * 分层与注入顺序(靠后的层覆盖靠前的层):
 *   1. redesignedStyles  基础布局 + 米黄/墨绿主题(含早期浅色版基底)
 *   2. homeStyles        首页品牌区(仅首页注入,插在 1 与 3 之间)
 *   3. playfulStyles     组件细节、动效与全局精修
 *   4. homePlayStyles    首页动效(仅首页注入)
 *
 * 排版约定:界面文字一律 var(--font-sans);稿纸正文与文学性装饰文字
 * 用 var(--font-sans)。新增颜色优先复用 :root 变量。
 */

export const redesignedStyles = `
/* ————————————————————————————————————————
   基础布局与主题(含早期浅色版基底)
   ———————————————————————————————————————— */
.shell{
  height:100vh;
  min-width:1280px;
  display:grid;
  grid-template-columns:220px minmax(0,1fr) 360px;
  grid-template-rows:40px minmax(0,1fr);
  background:#faf9f5;
  color:#171714;
  font:13px var(--font-sans)
}
.chrome{
  grid-column:1/-1;
  display:flex;
  gap:18px;
  align-items:center;
  padding:0 14px;
  border-bottom:1px solid #e3e0d6
}
.chrome>span{
  color:#6b6a64;
  overflow:hidden;
  text-overflow:ellipsis
}
.chrome>span.native-settings-control{
  overflow:visible
}
.workspace-select,.compact-control{
  display:flex;
  align-items:center;
  gap:6px;
  color:#6b6a64
}
.compact-control label{
  display:flex;
  align-items:center;
  gap:5px
}
.model-empty{
  align-items:flex-start;
  flex-wrap:wrap
}
.model-empty small{
  flex-basis:100%
}
.workspace-select select,.compact-control select{
  max-width:210px;
  border:0;
  background:transparent;
  color:#35342f
}
.sidebar{
  grid-column:1;
  border-right:1px solid #e3e0d6;
  min-height:0;
  display:flex;
  flex-direction:column;
  background:#f4f2ea
}
.side-title,.editor-header,.chat-header,.editor-tools{
  display:flex;
  align-items:center;
  justify-content:space-between;
  padding:8px 12px;
  border-bottom:1px solid #e3e0d6
}
.project-actions{
  display:flex;
  gap:3px;
  padding:6px;
  border-bottom:1px solid #e3e0d6
}
.project-actions button,.export-actions button{
  padding:4px 7px;
  border:1px solid #d2cec2;
  border-radius:3px;
  background:#fffef9;
  color:inherit;
  cursor:pointer
}
.export-actions{
  margin-left:auto;
  display:flex;
  align-items:center;
  gap:6px;
  color:#6b6a64
}
.export-actions span{
  max-width:180px;
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap
}
.session-list{
  padding:6px;
  border-bottom:1px solid #e3e0d6;
  display:flex;
  gap:3px;
  flex-direction:column;
  max-height:132px;
  overflow:auto
}
.session-list button,.tree-row{
  display:block;
  width:100%;
  padding:5px 7px;
  text-align:left;
  border:0;
  border-radius:3px;
  background:none;
  color:inherit;
  cursor:pointer
}
.session-list .selected,.tree-row[aria-current=page]{
  background:#e0e9f2;
  color:#1b365d
}
.tree{
  overflow:auto;
  min-height:0;
  padding:7px 0
}
.editor{
  grid-column:2;
  min-width:0;
  min-height:0;
  display:grid;
  position:relative;
  grid-template-rows:auto minmax(0,1fr) auto;
  background:#faf9f5
}
.editor-header{
  font-size:12px;
  color:#6b6a64
}
.paper-input{
  box-sizing:border-box;
  width:100%;
  height:100%;
  padding:42px max(48px,10%);
  border:0;
  resize:none;
  background:transparent;
  color:#171714;
  font:18px/1.9 var(--font-sans);
  outline:0
}
.ghost{
  position:absolute;
  left:10%;
  bottom:52px;
  max-width:58%;
  padding:5px 8px;
  color:#77746c;
  background:#f2f0e8;
  border-radius:3px;
  font:16px/1.8 var(--font-sans);
  pointer-events:none
}
.proposal{
  position:absolute;
  right:18px;
  bottom:54px;
  width:min(380px,48%);
  padding:12px;
  border:1px solid #d5d1c5;
  border-radius:5px;
  background:#fffef9;
  box-shadow:0 8px 28px #342f251a
}
.proposal p{
  margin:4px 0 10px;
  white-space:pre-wrap
}
.proposal div,.pending-card div{
  display:flex;
  gap:8px
}
.editor-tools{
  border-top:1px solid #e3e0d6;
  border-bottom:0;
  justify-content:flex-start;
  gap:9px;
  color:#6b6a64;
  overflow:auto
}
.chat{
  grid-column:3;
  min-width:0;
  min-height:0;
  border-left:1px solid #e3e0d6;
  display:grid;
  grid-template-rows:auto minmax(0,1fr) auto;
  background:#f4f2ea
}
.chat-header{
  align-items:flex-start;
  gap:8px
}
.chat-controls{
  display:grid;
  gap:4px;
  min-width:0
}
.chat-history{
  overflow:auto;
  padding:12px;
  display:flex;
  gap:9px;
  flex-direction:column
}
.chat-row,.pending-card{
  margin:0;
  padding:9px 10px;
  border:1px solid #dedbd1;
  border-radius:5px;
  background:#fffef9
}
.chat-row p,.pending-card p{
  margin:0;
  white-space:pre-wrap;
  line-height:1.6
}
.chat-row.user{
  margin-left:24px;
  background:#e0e9f2
}
.chat-row.tool,.chat-row.notice,.chat-row.unknown{
  font-size:12px;
  color:#504e49
}
.pending-card{
  display:grid;
  gap:8px;
  border-color:#c8a86a;
  background:#fffaf0
}
.pending-card fieldset{
  border:0;
  padding:0;
  margin:0;
  display:grid;
  gap:5px
}
.pending-card input{
  box-sizing:border-box;
  width:100%;
  padding:6px
}
.composer{
  border-top:1px solid #e3e0d6;
  padding:9px
}
.composer textarea{
  box-sizing:border-box;
  width:100%;
  min-height:66px;
  border:1px solid #d8d4c8;
  border-radius:4px;
  padding:7px;
  background:#fffef9;
  resize:vertical
}
.composer div{
  display:flex;
  justify-content:flex-end;
  gap:8px;
  padding-top:6px
}
.composer button,.editor-tools button,.proposal button,.pending-card button,.empty-paper button,.model-empty button,.home-actions button,.compact-control button,.proposal-card button{
  padding:4px 9px;
  border:1px solid #d2cec2;
  border-radius:3px;
  background:#fffef9;
  color:inherit;
  cursor:pointer
}
.warning{
  color:#8a3a30
}
.success{
  color:#2f6b42
}
.muted{
  color:#77746c
}
.pad{
  padding:8px
}
.empty-paper{
  grid-column:2;
  display:grid;
  place-content:center;
  gap:12px;
  padding:48px;
  text-align:center;
  font:16px/1.8 var(--font-sans)
}
.empty-paper h1{
  font-size:28px;
  font-weight:500
}
.home-actions{
  display:flex;
  justify-content:center;
  gap:10px
}
.no-session{
  display:block;
  min-width:0
}
.no-session .empty-paper{
  height:100vh
}
.proposal-card{
  display:grid;
  gap:9px;
  padding:10px;
  border:1px solid #c8a86a;
  border-radius:6px;
  background:#fffaf0
}
.proposal-card header,.proposal-card footer{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:7px
}
.proposal-card code{
  font-size:11px;
  color:#6b6a64
}
.proposal-diff{
  display:grid;
  gap:7px
}
.proposal-card pre{
  max-height:180px;
  margin:3px 0 0;
  padding:7px;
  overflow:auto;
  white-space:pre-wrap;
  border-radius:3px;
  background:#f4f2ea;
  font:12px/1.55 monospace
}
.proposal-card footer span{
  margin-right:auto;
  font-size:12px;
  color:#6b6a64
}
.proposal-card.expired{
  border-color:#b56a61
}
.proposal-card.applied{
  border-color:#6d9a78
}
button:focus-visible,textarea:focus-visible,select:focus-visible,input:focus-visible{
  outline:2px solid #1b365d;
  outline-offset:2px
}
@media(max-width:1320px){
  .shell{
    grid-template-columns:210px minmax(0,1fr) 340px
  }
  .paper-input{
    padding-inline:42px
  }
}
.shell{
  height:100dvh;
  min-width:1280px;
  grid-template-columns:248px minmax(520px,1fr) 384px;
  grid-template-rows:52px minmax(0,1fr);
  background:#f5f0e5;
  color:#253b32;
  font:14px/1.5 var(--font-sans)
}
.chrome{
  gap:14px;
  padding:0 20px;
  background:#fbf8ef;
  border-color:#d8d0bf
}
.chrome strong{
  font-family:var(--font-sans);
  font-weight:600;
  font-size:17px;
  letter-spacing:.04em
}
.chrome>span{
  color:#6d7468
}
.sidebar{
  background:#eee8da;
  border-color:#d8d0bf
}
.side-title,.editor-header,.chat-header,.editor-tools{
  padding:10px 14px;
  border-color:#ddd5c6
}
.side-title{
  font-weight:600;
  letter-spacing:.04em
}
.project-actions{
  display:block;
  padding:8px 12px;
  border-color:#ddd5c6
}
.project-actions summary{
  cursor:pointer;
  color:#647268
}
.project-actions div{
  display:flex;
  gap:6px;
  padding-top:7px
}
.project-actions button,.export-actions button,.settings-link{
  border-color:#c9c5b4;
  background:#fbf8ef;
  color:#304f41
}
.tree{
  padding:8px
}
.tree-row{
  padding:7px 8px;
  border-radius:4px;
  transition:transform 160ms ease,background-color 160ms ease,color 160ms ease
}
.tree-row:hover{
  background:#e1eadc;
  transform:translateX(2px)
}
.session-list .selected,.tree-row[aria-current=page]{
  background:#dbe8d7;
  color:#214838;
  font-weight:600
}
.index-status{
  display:grid;
  gap:6px;
  margin:10px 12px;
  padding:9px 10px;
  border-left:2px solid #5d806b;
  background:#f8f4e9;
  color:#53665a;
  font-size:12px
}
.index-status button{
  justify-self:start;
  padding:3px 0;
  border:0;
  background:transparent;
  color:#285c45;
  text-decoration:underline;
  cursor:pointer
}
.editor{
  background:#f8f3e8
}
.editor-header{
  color:#697269;
  background:#f3ecdf;
  font-variant-numeric:tabular-nums
}
.paper-input{
  margin:22px auto;
  width:min(100% - 48px,880px);
  height:calc(100% - 44px);
  padding:58px clamp(34px,7vw,92px);
  border:1px solid #e2dac9;
  border-radius:2px;
  background:#fffdf6;
  box-shadow:0 8px 26px #5a4d3510;
  color:#28382f;
  font:19px/1.95 var(--font-sans)
}
.editor-tools{
  background:#f3ecdf
}
.chat{
  border-color:#d8d0bf;
  background:#f0ebdf
}
.chat-header{
  background:#f7f3e9
}
.chat-row,.pending-card{
  border-color:#ddd5c6;
  border-radius:4px;
  background:#fffdf7
}
.chat-row.user{
  background:#dce9dd
}
.composer{
  border-color:#d8d0bf;
  background:#f7f3e9
}
.composer textarea{
  border-color:#cbc5b7;
  border-radius:3px;
  background:#fffdf7
}
.composer button,.editor-tools button,.proposal button,.pending-card button,.empty-paper button,.model-empty button,.home-actions button,.compact-control button,.proposal-card button{
  border-color:#bfc5b8;
  border-radius:3px;
  background:#fffdf7;
  color:#2c5744;
  transition:transform 160ms ease,background-color 160ms ease
}
.composer button:hover,.editor-tools button:hover,.proposal button:hover,.pending-card button:hover,.empty-paper button:hover,.model-empty button:hover,.home-actions button:hover,.compact-control button:hover,.proposal-card button:hover{
  background:#e1eadc;
  transform:translateY(-1px)
}
.empty-paper{
  background:#f8f3e8;
  color:#33483c
}
.no-session .empty-paper{
  height:100dvh
}
.settings-link{
  margin-left:auto;
  padding:5px 10px;
  cursor:pointer
}
.warning{
  color:#9a4b3b
}
.success{
  color:#356446
}
button:focus-visible,textarea:focus-visible,select:focus-visible,input:focus-visible{
  outline:2px solid #386a50;
  outline-offset:3px
}
@media(max-width:1320px){
  .shell{
    grid-template-columns:216px minmax(440px,1fr) 330px
  }
  .paper-input{
    width:calc(100% - 32px);
    padding-inline:42px
  }
}
@media(prefers-reduced-motion:reduce){
  *,*::before,*::after{
    scroll-behavior:auto!important;
    transition-duration:0.01ms!important;
    animation-duration:0.01ms!important
  }
}
`

export const homeStyles = `
/* ————————————————————————————————————————
   首页品牌区(仅首页注入)
   ———————————————————————————————————————— */
.brand-lockup{
  display:flex;
  align-items:center;
  gap:10px
}
.brand-lockup>div{
  display:grid;
  line-height:1.05
}
.brand-lockup small{
  margin-top:4px;
  color:#728078;
  font-size:10px;
  letter-spacing:.12em
}
.brand-mark{
  display:grid;
  width:28px;
  height:28px;
  place-content:center;
  border:1px solid #6c8575;
  border-radius:8px 3px 8px 3px;
  background:#e4ecdf;
  color:#285640;
  font:700 15px/1 var(--font-sans);
  transform:rotate(-2deg)
}
.local-state{
  padding-left:8px!important;
  border-left:1px solid #d7d0c1
}
.sidebar .side-title small{
  color:#889087;
  font-size:10px;
  font-weight:400
}
.workspace-caption{
  padding:14px 14px 4px;
  color:#7d857d;
  font-size:11px;
  letter-spacing:.08em
}
.workspace-empty{
  display:grid;
  justify-items:start;
  gap:5px;
  margin:18px 14px;
  padding:18px 14px;
  border:1px dashed #cfc8b8;
  border-radius:8px;
  background:#f5f0e4;
  color:#617066
}
.workspace-empty>span{
  color:#3f6a53;
  font-size:24px
}
.workspace-empty strong{
  font-size:13px
}
.workspace-empty small{
  line-height:1.6
}
.home-stage{
  display:grid;
  place-items:center;
  padding:54px;
  background:#f7f2e7;
  text-align:left
}
.home-card{
  box-sizing:border-box;
  width:min(650px,88%);
  padding:58px 62px 54px;
  border:1px solid #ddd3bf;
  border-left:4px solid #386a50;
  border-radius:5px 14px 5px 5px;
  background:#fffdf6;
  box-shadow:0 20px 55px #594b3214;
  animation:home-rise 320ms ease-out
}
.home-card h1{
  max-width:12em;
  margin:0 0 18px;
  color:#284b3a;
  font-size:34px;
  line-height:1.35;
  letter-spacing:-.03em
}
.home-eyebrow{
  margin:0 0 12px;
  color:#537263;
  font-size:12px;
  letter-spacing:.16em
}
.home-card>small{
  display:block;
  margin-top:22px;
  color:#7b827b;
  line-height:1.6
}
.home-actions{
  justify-content:flex-start;
  margin-top:28px;
  gap:12px
}
.home-actions button{
  min-width:116px;
  padding:9px 16px
}
.home-actions .primary-action{
  border-color:#315e48;
  background:#315e48;
  color:#fff
}
.home-actions .primary-action:hover{
  background:#284f3c
}
.empty-chat .chat-header>div{
  display:grid;
  gap:2px
}
.empty-chat .chat-header small{
  color:#7b847d;
  font-size:10px;
  letter-spacing:.08em
}
.chat-empty-body{
  display:grid;
  align-content:start;
  gap:22px;
  padding:28px 20px;
  color:#667168
}
.chat-empty-body p{
  margin:0;
  line-height:1.8
}
.chat-empty-body div{
  display:flex;
  flex-wrap:wrap;
  gap:8px
}
.chat-empty-body span{
  padding:5px 9px;
  border:1px solid #d5cebe;
  border-radius:3px;
  background:#faf6ec;
  color:#52705f;
  font-size:12px
}
@keyframes home-rise{
  from{
    opacity:0;
    transform:translateY(8px)
  }
  to{
    opacity:1;
    transform:translateY(0)
  }
}
@media(prefers-reduced-motion:reduce){
  .home-card{
    animation:none
  }
}
`

export const playfulStyles = `

:root {
  /* 字体:全局无衬线(Windows 雅黑 / macOS 苹方) */
  --font-sans: system-ui, "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif;
  --font-mono: ui-monospace, "SFMono-Regular", Consolas, monospace;

  /* 色板 */
  --ink: #173f30;
  --leaf: #3d755a;
  --mint: #dcebdd;
  --paper: #fffdf6;
  --sand: #f2ecdf;
  --line: #d8cfbd;

  /* 动效 */
  --ease: cubic-bezier(.22, 1, .36, 1);
}

/* ————————————————————————————————————————
   组件细节与动效
   ———————————————————————————————————————— */
.writing-settings{
  display:grid;
  gap:16px;
  color:#28382f
}
.writing-settings h2{
  margin:0;
  color:#4f514d;
  font-size:24px
}
.writing-settings fieldset{
  display:flex;
  flex-wrap:wrap;
  gap:10px 18px;
  margin:0;
  padding:14px 16px;
  border:1px solid #d8cfbd;
  border-radius:8px;
  background:#fbf8ef
}
.writing-settings fieldset legend{
  padding:0 5px;
  color:#42594c;
  font-weight:600
}
.writing-settings fieldset p{
  flex-basis:100%;
  margin:0;
  color:#69766e
}
.writing-settings fieldset label{
  display:flex;
  align-items:center;
  gap:6px
}
.writing-settings fieldset input{
  accent-color:#386a50
}
.writing-settings>button{
  justify-self:start;
  padding:7px 12px;
  border:1px solid #bfc5b8;
  border-radius:6px;
  background:#fffdf7;
  color:#2c5744
}
.author-preferences{
  display:grid!important;
  gap:6px;
  padding-top:13px;
  border-top:1px solid #ded6c7
}
.author-preferences>span{
  color:#294938;
  font-weight:600
}
.author-preferences textarea{
  box-sizing:border-box;
  width:100%;
  min-height:82px;
  padding:9px 10px;
  border:1px solid #cbc5b7;
  border-radius:10px 4px 10px 4px;
  background:#fffdf7;
  color:#28382f;
  font:13px/1.65 inherit;
  resize:vertical
}
.author-preferences textarea:focus{
  border-color:#6d8c79;
  outline:2px solid #386a50;
  outline-offset:2px
}
.author-preferences small{
  color:#69766e;
  font-size:11px
}
.sr-only{
  position:absolute!important;
  width:1px!important;
  height:1px!important;
  padding:0!important;
  margin:-1px!important;
  overflow:hidden!important;
  clip:rect(0,0,0,0)!important;
  white-space:nowrap!important;
  border:0!important
}
.search-panel{
  display:grid;
  gap:7px;
  padding:9px 10px;
  border-bottom:1px solid var(--line);
  background:#f5efe2
}
.search-panel form{
  display:grid;
  grid-template-columns:minmax(0,1fr) 34px;
  gap:5px
}
.search-panel input,.search-panel select{
  box-sizing:border-box;
  min-width:0;
  border:1px solid #c9c3b5;
  background:#fffdf7;
  color:#294638
}
.search-panel input{
  padding:7px 9px;
  border-radius:12px 3px 3px 12px
}
.search-panel form>button{
  padding:0;
  border:1px solid #b9c5b8;
  border-radius:3px 10px 10px 3px;
  background:#dfeadd;
  color:#285c45
}
.search-panel select{
  grid-column:1/-1;
  padding:4px 7px;
  border:0;
  background:transparent;
  color:#657168;
  font-size:11px
}
.search-summary{
  display:flex;
  gap:6px;
  flex-wrap:wrap;
  color:#687168;
  font-size:11px
}
.search-summary strong{
  color:#9a4b3b
}
.search-results{
  max-height:210px;
  margin:0;
  padding:0;
  overflow:auto;
  list-style:none;
  display:grid;
  gap:4px
}
.search-results button{
  box-sizing:border-box;
  width:100%;
  display:grid;
  gap:2px;
  padding:7px 8px;
  border:0;
  border-radius:5px;
  background:#fffaf0;
  text-align:left;
  color:#304a3d
}
.search-results button:hover:not(:disabled){
  background:#dfeadd;
  transform:translateX(2px)
}
.search-results button:disabled{
  opacity:.55
}
.search-results strong,.search-results span{
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap
}
.search-results strong{
  font-size:11px
}
.search-results span{
  font-size:11px;
  color:#687168
}
.search-panel p{
  margin:0;
  font-size:11px
}
.chapter-navigation{
  display:flex;
  align-items:center;
  gap:5px;
  margin-left:auto
}
.chapter-navigation button{
  width:26px;
  height:26px;
  padding:0;
  border:1px solid #c7c4b7;
  border-radius:50%;
  background:#fffdf7;
  color:#315b47;
  font-size:18px;
  line-height:1
}
.chapter-navigation span{
  min-width:48px;
  text-align:center;
  color:#6a746b;
  font-variant-numeric:tabular-nums
}
.editor-header>span:first-child{
  min-width:0;
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap
}
.editor-header>span:last-child{
  white-space:nowrap;
  margin-left:10px
}
.tree-file-row,.tree-directory-row{
  position:relative;
  display:flex;
  align-items:center
}
.tree-file-row .tree-main,.tree-directory-row .tree-row{
  min-width:0;
  padding-right:34px
}
.tree-file-row .tree-manage,.tree-directory-row .tree-directory-add{
  position:absolute;
  right:4px;
  width:28px;
  height:26px;
  padding:0;
  border:0;
  border-radius:50%;
  background:transparent;
  color:#667269;
  opacity:0
}
.tree-file-row:hover .tree-manage,.tree-file-row:focus-within .tree-manage,.tree-directory-row:hover .tree-directory-add,.tree-directory-row:focus-within .tree-directory-add{
  opacity:1
}
.tree-manage:hover,.tree-directory-add:hover{
  background:#d5e3d3!important;
  transform:none!important
}
.archive-panel{
  border-bottom:1px solid var(--line);
  background:#eee8da
}
.archive-panel>summary{
  display:flex;
  align-items:center;
  justify-content:space-between;
  padding:8px 12px;
  cursor:pointer;
  color:#596a60;
  list-style:none
}
.archive-panel>summary::-webkit-details-marker{
  display:none
}
.archive-panel>summary small{
  display:grid;
  place-items:center;
  min-width:19px;
  height:19px;
  border-radius:50%;
  background:#d5e3d3
}
.archive-list{
  display:grid;
  gap:6px;
  max-height:230px;
  padding:0 9px 9px;
  overflow:auto
}
.archive-list>p{
  margin:4px;
  font-size:11px
}
.archive-list article{
  display:flex;
  align-items:center;
  flex-wrap:wrap;
  gap:7px;
  padding:8px;
  border:1px solid #d7d0c1;
  border-radius:7px;
  background:#fffaf0
}
.archive-list article>div{
  min-width:0;
  display:grid;
  gap:1px;
  margin-right:auto
}
.archive-list article strong,.archive-list article small,.archive-list article code{
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap
}
.archive-list article small,.archive-list article code{
  color:#6c756d;
  font-size:10px
}
.archive-list article>button{
  flex:none;
  padding:4px 7px;
  border:1px solid #b9c5b8;
  border-radius:10px;
  background:#e3ecdf;
  color:#285c45
}
.archive-list article>p{
  flex-basis:100%;
  margin:0
}
.file-dialog-overlay{
  position:fixed;
  inset:0;
  z-index:30;
  display:grid;
  place-items:center;
  padding:24px;
  background:#272a2666;
  backdrop-filter:blur(4px)
}
.file-dialog{
  box-sizing:border-box;
  width:min(520px,100%);
  display:grid;
  gap:18px;
  padding:24px;
  border:1px solid #d8cfbd;
  border-radius:22px 6px 22px 6px;
  background:#fffdf6;
  box-shadow:0 28px 90px #2c2d2838
}
.file-dialog header,.file-dialog footer{
  display:flex;
  align-items:flex-start;
  justify-content:space-between;
  gap:12px
}
.file-dialog header>div{
  min-width:0;
  display:grid;
  gap:3px
}
.file-dialog h2{
  margin:0;
  color:#264b3a;
  font:600 26px/1.25 var(--font-sans)
}
.file-dialog small,.file-dialog code,.file-dialog p{
  color:#687168
}
.file-dialog code{
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap
}
.file-dialog-actions{
  display:grid;
  gap:8px
}
.file-dialog-actions>button{
  display:grid;
  gap:3px;
  padding:13px 14px;
  border:1px solid #d7d0c1;
  border-radius:12px 4px 12px 4px;
  background:#f8f3e8;
  text-align:left;
  color:#2f4e40
}
.file-dialog-actions>button span{
  color:#6c756d;
  font-size:12px
}
.file-dialog form,.archive-confirm{
  display:grid;
  gap:12px
}
.file-dialog label{
  display:grid;
  gap:6px
}
.file-dialog input,.file-dialog select{
  box-sizing:border-box;
  width:100%;
  padding:10px 11px;
  border:1px solid #c9c3b5;
  border-radius:8px;
  background:#fff
}
.file-dialog footer{
  justify-content:flex-end;
  align-items:center
}
.file-dialog footer button{
  padding:7px 12px;
  border:1px solid #bfc5b8;
  border-radius:12px 4px 12px 4px;
  background:#fff;
  color:#2c5744
}
.file-dialog footer .primary-action{
  background:#315e48;
  color:#fff
}
.file-dialog footer .danger-action{
  border-color:#a9695f;
  background:#8f4d43;
  color:#fff
}
.file-dialog>.warning{
  margin:0
}
.archive-confirm p{
  margin:0;
  line-height:1.7
}
button,summary,.tree-row{
  transition:transform 220ms var(--ease),background-color 220ms ease,border-color 220ms ease,color 220ms ease,box-shadow 220ms ease
}
button:active,.tree-row:active,summary:active{
  transform:scale(.96)
}
.icon-button{
  display:grid!important;
  place-items:center;
  min-width:30px!important;
  width:30px;
  height:30px;
  padding:0!important;
  border-radius:50%!important;
  font-size:17px;
  line-height:1
}
.icon-button:hover{
  transform:rotate(8deg) scale(1.06)!important
}
.shell>.sidebar{
  animation:panel-left 560ms 70ms var(--ease) both
}
.shell>.editor,.shell>.empty-paper{
  animation:panel-rise 560ms 120ms var(--ease) both
}
.shell>.chat{
  animation:panel-right 560ms 170ms var(--ease) both
}
.local-state{
  display:flex;
  align-items:center;
  gap:7px;
  border:0!important;
  padding:0!important;
  font-size:11px
}
.local-state i,.live-dot{
  display:inline-block;
  width:7px;
  height:7px;
  border-radius:50%;
  background:#4c8a68;
  box-shadow:0 0 0 0 #4c8a6866;
  animation:signal 2.2s ease-out infinite
}
.tree-row:hover{
  transform:translateX(4px)!important
}
.tree-row[aria-current=page]{
  box-shadow:inset 3px 0 #3d755a
}
.tree-row[aria-expanded=true]{
  color:var(--ink);
  font-weight:600
}
.paper-input{
  transition:transform 360ms var(--ease),box-shadow 360ms ease,border-color 360ms ease
}
.paper-input:focus{
  transform:translateY(-2px);
  border-color:#b9c9ba;
  box-shadow:0 18px 44px #4b67471c,0 0 0 4px #5c8a6820
}
.composer{
  transition:background-color 240ms ease,box-shadow 240ms ease
}
.composer:focus-within{
  background:#fffaf0;
  box-shadow:0 -12px 34px #5a4d3210
}
.composer textarea:focus{
  border-color:#73917d;
  box-shadow:0 0 0 3px #4d7d5d17
}
.empty-paper>p{
  max-width:34em;
  margin:0;
  text-align:center;
  color:#68776d;
  line-height:1.75
}
.chat-guide{
  display:grid;
  gap:13px;
  padding:14px;
  border:1px solid #d5cebe;
  border-left:3px solid #5d806b;
  border-radius:5px 14px 5px 5px;
  background:#faf6ec;
  color:#53665a
}
.chat-guide>header{
  display:grid;
  gap:4px
}
.chat-guide>header strong{
  color:#264b3a;
  font:600 18px/1.3 var(--font-sans)
}
.chat-guide>header small,.chat-guide>small{
  line-height:1.55
}
.chat-guide-examples{
  display:grid;
  grid-template-columns:1fr 1fr;
  gap:7px
}
.chat-guide-examples button{
  display:grid;
  gap:3px;
  min-width:0;
  padding:9px 10px;
  border:1px solid #d5cebe;
  border-radius:10px 3px 10px 10px;
  background:#fffdf7;
  text-align:left;
  color:#315640;
  cursor:pointer
}
.chat-guide-examples button:hover{
  border-color:#92a995;
  background:#e5eee2;
  transform:translateY(-1px)
}
.chat-guide-examples button strong{
  font-size:12px
}
.chat-guide-examples button span{
  color:#6b776e;
  font-size:10px;
  line-height:1.45
}
.proposal-help{
  display:block;
  margin-top:7px;
  color:#6b776e;
  font-size:11px;
  line-height:1.5
}
.ghost-suggestion{
  box-sizing:border-box;
  max-height:42%;
  display:grid;
  gap:8px;
  overflow:auto;
  padding:12px 14px;
  border:1px solid #b9cbb9;
  border-radius:14px 4px 14px 14px;
  background:#f5faef;
  box-shadow:0 12px 32px #3f624719;
  pointer-events:auto
}
.ghost-suggestion header{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:12px
}
.ghost-suggestion header small{
  color:#6b796f;
  font:11px/1.4 ui-monospace,Consolas,monospace
}
.ghost-suggestion strong,.proposal>strong{
  color:#28523f
}
.ghost-suggestion p{
  margin:0;
  overflow:auto;
  white-space:pre-wrap;
  line-height:1.7
}
.ghost-suggestion div,.ghost-suggestion nav,.proposal-actions{
  display:flex;
  gap:7px
}
.ghost-suggestion nav{
  justify-content:flex-end
}
.ghost-suggestion button,.proposal button{
  padding:5px 9px;
  border:1px solid #b8c5b7;
  border-radius:9px 3px 9px 9px;
  background:#fffdf7;
  color:#285640;
  cursor:pointer
}
.ghost-suggestion button:disabled{
  cursor:not-allowed;
  opacity:.45
}
.proposal{
  box-sizing:border-box;
  max-height:56%;
  overflow:auto
}
.selection-diff{
  display:grid!important;
  grid-template-columns:minmax(0,1fr) minmax(0,1fr);
  gap:8px!important;
  margin:9px 0
}
.selection-diff section{
  min-width:0;
  padding:8px;
  border:1px solid #ddd5c6;
  border-radius:7px;
  background:#f8f4e9
}
.selection-diff small{
  color:#68776d
}
.selection-diff p{
  max-height:150px;
  overflow:auto;
  white-space:pre-wrap;
  line-height:1.65
}
.proposal-actions{
  justify-content:flex-end
}
@media(max-width:1320px){
  .ghost-suggestion{
    max-width:72%
  }
  .proposal{
    width:min(430px,58%)
  }
}
.export-actions .settings-link{
  margin-left:0
}
.shortcut-overlay{
  position:fixed;
  z-index:60;
  inset:0;
  display:grid;
  place-items:center;
  padding:24px;
  background:#202a246b;
  backdrop-filter:blur(5px)
}
.shortcut-dialog{
  box-sizing:border-box;
  width:min(620px,100%);
  max-height:min(760px,calc(100dvh - 48px));
  display:grid;
  gap:14px;
  overflow:auto;
  padding:26px;
  border:1px solid #d8cfbd;
  border-radius:22px 6px 22px 6px;
  background:#fffdf6;
  box-shadow:0 30px 90px #222a2538
}
.shortcut-dialog header{
  display:flex;
  align-items:flex-start;
  justify-content:space-between;
  gap:18px
}
.shortcut-dialog header>div{
  display:grid;
  gap:4px
}
.shortcut-dialog h2,.shortcut-dialog p{
  margin:0
}
.shortcut-dialog h2{
  color:#244b39;
  font:600 28px/1.25 var(--font-sans)
}
.shortcut-dialog header small{
  color:#708078;
  font:10px/1 ui-monospace,Consolas,monospace;
  letter-spacing:.16em
}
.shortcut-dialog>p{
  color:#6c756d
}
.shortcut-dialog dl{
  display:grid;
  grid-template-columns:1fr 1fr;
  gap:7px;
  margin:0
}
.shortcut-dialog dl>div{
  display:flex;
  align-items:center;
  gap:12px;
  padding:10px 11px;
  border:1px solid #e0d8c9;
  border-radius:10px 3px 10px 10px;
  background:#f8f3e8
}
.shortcut-dialog dt{
  flex:none;
  min-width:112px;
  padding:3px 6px;
  border:1px solid #c7cebf;
  border-radius:5px;
  background:#fffdf7;
  color:#285640;
  font:11px/1.4 ui-monospace,Consolas,monospace
}
.shortcut-dialog dd{
  margin:0;
  color:#53645b;
  font-size:12px
}
@media(max-width:720px){
  .shortcut-dialog dl{
    grid-template-columns:1fr
  }
}
.workspace-row{
  position:relative;
  display:flex;
  align-items:center;
  margin:0 9px
}
.workspace-row>.tree-row{
  min-width:0;
  padding-right:38px
}
.workspace-manage{
  position:absolute;
  right:3px;
  opacity:0
}
.workspace-row:hover .workspace-manage,.workspace-row:focus-within .workspace-manage{
  opacity:1
}
.workspace-home-button{
  padding:4px 9px;
  border:1px solid #d0c8b8;
  border-radius:12px 3px 12px 12px;
  background:#f7f2e8;
  color:#456250;
  cursor:pointer
}
.workspace-current-manage{
  flex:none;
  padding:3px 6px!important;
  border:0!important;
  background:transparent!important;
  color:#65756b!important
}
.workspace-dialog form>footer .danger-link{
  margin-right:auto;
  border-color:transparent;
  background:transparent;
  color:#914b40
}
.workspace-dialog form>footer .danger-link:hover{
  background:#f4e5df
}
.workspace-dialog code{
  max-width:420px
}
.chat-row,.pending-card{
  animation:message-in 360ms var(--ease) both
}
.chat-row.user{
  transform-origin:right bottom
}
.chat-row.assistant{
  transform-origin:left bottom
}
.chat-row.tool strong::after{
  content:'···';
  display:inline-block;
  width:1.5em;
  overflow:hidden;
  vertical-align:bottom;
  animation:dots 1.2s steps(4,end) infinite
}
.index-status{
  animation:index-breathe 2.4s ease-in-out infinite
}
.index-status button:hover{
  transform:translateX(2px)
}
.export-actions{
  position:relative;
  z-index:12
}
.export-menu{
  position:relative
}
.export-menu summary{
  display:flex;
  align-items:center;
  gap:6px;
  padding:5px 10px;
  border:1px solid #c9c5b4;
  border-radius:16px;
  background:#fbf8ef;
  color:#304f41;
  cursor:pointer;
  list-style:none
}
.export-menu summary::-webkit-details-marker{
  display:none
}
.export-menu summary::after{
  content:'';
  width:5px;
  height:5px;
  margin-top:-2px;
  border-right:1.5px solid currentColor;
  border-bottom:1.5px solid currentColor;
  transform:rotate(45deg)
}
.export-menu[open] summary{
  background:#dce9dd
}
.export-menu[open] summary::after{
  margin-top:2px;
  transform:rotate(225deg)
}
.export-menu>div{
  position:absolute;
  z-index:13;
  top:calc(100% + 8px);
  right:0;
  display:grid;
  min-width:130px;
  padding:6px;
  border:1px solid #d8cfbd;
  border-radius:10px 3px 10px 10px;
  background:#fffdf6;
  box-shadow:0 16px 40px #4e42261f;
  animation:menu-pop 180ms var(--ease)
}
.export-menu>div button{
  border:0;
  background:transparent;
  text-align:left;
  padding:8px 10px;
  border-radius:6px
}
.export-menu>div button:hover{
  background:#e4eee1
}
.chat{
  position:relative
}
.conversation-setup{
  position:absolute;
  z-index:12;
  top:58px;
  right:12px;
  box-sizing:border-box;
  width:calc(100% - 24px);
  display:grid;
  gap:16px;
  padding:18px;
  border:1px solid #d8cfbd;
  border-radius:18px 5px 18px 18px;
  background:#fffdf6f5;
  box-shadow:0 22px 60px #4d41262b;
  backdrop-filter:blur(16px);
  animation:conversation-in 240ms var(--ease) both
}
.conversation-setup header,.conversation-setup footer{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:10px
}
.conversation-setup header{
  padding-bottom:4px
}
.conversation-setup header strong{
  font:600 22px/1.2 var(--font-sans);
  color:#173f30
}
.conversation-setup label{
  display:block
}
.conversation-setup select{
  box-sizing:border-box;
  width:100%;
  padding:10px 12px;
  border:0;
  border-bottom:1px solid #aeb9ad;
  background:transparent;
  color:#264838
}
.conversation-setup footer{
  justify-content:flex-end
}
.conversation-setup footer button{
  padding:7px 13px;
  border:0;
  border-radius:14px 4px 14px 14px;
  background:#ece6d9
}
.conversation-setup footer .primary-action{
  min-width:72px;
  background:#285c45;
  color:#fff;
  box-shadow:0 8px 20px #285c4526
}
.conversation-setup footer .primary-action:hover{
  transform:translateY(-2px)!important;
  box-shadow:0 12px 26px #285c4533
}
.brand-mark{
  animation:mark-arrive 620ms 120ms var(--ease) both
}
.brand-mark:hover{
  transform:rotate(7deg) scale(1.08)!important
}
.empty-paper-mark{
  display:block;
  color:#72927e;
  font-size:34px;
  animation:mark-float 3s ease-in-out infinite
}
.empty-paper h1{
  margin:0
}
.empty-paper>button{
  margin-inline:auto
}
@keyframes panel-left{
  from{
    opacity:0;
    transform:translateX(-18px)
  }
  to{
    opacity:1;
    transform:none
  }
}
@keyframes panel-right{
  from{
    opacity:0;
    transform:translateX(18px)
  }
  to{
    opacity:1;
    transform:none
  }
}
@keyframes panel-rise{
  from{
    opacity:0;
    transform:translateY(16px)
  }
  to{
    opacity:1;
    transform:none
  }
}
@keyframes message-in{
  from{
    opacity:0;
    transform:translateY(8px) scale(.98)
  }
  to{
    opacity:1;
    transform:none
  }
}
@keyframes menu-pop{
  from{
    opacity:0;
    transform:translateY(-5px) scale(.96)
  }
  to{
    opacity:1;
    transform:none
  }
}
@keyframes conversation-in{
  from{
    opacity:0;
    transform:translateY(-8px) scale(.96);
    transform-origin:top right
  }
  to{
    opacity:1;
    transform:none
  }
}
@keyframes signal{
  60%,100%{
    box-shadow:0 0 0 10px #4c8a6800
  }
}
@keyframes dots{
  0%{
    width:0
  }
  100%{
    width:1.5em
  }
}
@keyframes index-breathe{
  50%{
    border-left-color:#9db7a2;
    background:#f5f2e6
  }
}
@keyframes mark-arrive{
  from{
    opacity:0;
    transform:rotate(-18deg) scale(.6)
  }
  to{
    opacity:1;
    transform:rotate(-2deg) scale(1)
  }
}
@keyframes mark-float{
  50%{
    transform:translateY(-7px) rotate(5deg)
  }
}
@media(prefers-reduced-motion:reduce){
  .shell>.sidebar,.shell>.editor,.shell>.empty-paper,.shell>.chat,.chat-row,.pending-card,.conversation-setup,.brand-mark,.empty-paper-mark,.local-state i,.live-dot,.index-status{
    animation:none!important
  }
  .paper-input:focus,.tree-row:hover,.icon-button:hover{
    transform:none!important
  }
}
.shell:not(.no-session){
  grid-template-columns:248px minmax(0,1fr)
}
.chat{
  position:fixed;
  z-index:10;
  inset:52px 0 0 auto;
  width:min(404px,calc(100vw - 280px));
  grid-column:auto;
  border:1px solid #d8d0bf;
  border-right:0;
  border-bottom:0;
  border-radius:22px 0 0 0;
  box-shadow:-24px 0 64px #4d41261f;
  overflow:hidden
}
.chat-header{
  display:grid;
  grid-template-columns:auto minmax(0,1fr) auto;
  align-items:center
}
.conversation-select{
  grid-column:2;
  grid-row:1;
  min-width:0
}
.conversation-select select{
  box-sizing:border-box;
  width:100%;
  min-width:84px;
  max-width:none;
  padding:4px 22px 4px 7px;
  border:1px solid #d6d0c2;
  border-radius:4px;
  background:#fffdf7;
  color:#315640;
  text-overflow:ellipsis
}
.chat-controls{
  grid-column:1/-1;
  grid-row:2
}
.chat-controls .compact-control{
  min-width:0
}
.chat-controls .model-indicator{
  max-width:280px
}
.chat-header-actions{
  grid-column:3;
  grid-row:1;
  display:flex;
  gap:4px
}
.assistant-launcher{
  position:fixed;
  z-index:9;
  right:24px;
  bottom:24px;
  display:flex;
  align-items:center;
  gap:9px;
  padding:10px 15px 10px 10px;
  border:1px solid #95a89a;
  border-radius:22px 7px 22px 22px;
  background:#fffdf6ef;
  color:#244f3c;
  box-shadow:0 16px 42px #4d412626;
  backdrop-filter:blur(14px);
  cursor:pointer;
  animation:launcher-in 420ms var(--ease) both
}
.assistant-launcher span{
  display:grid;
  width:28px;
  height:28px;
  place-items:center;
  border-radius:50%;
  background:#dce9dd;
  font-size:17px;
  animation:mark-float 3s ease-in-out infinite
}
.assistant-launcher strong{
  font-size:13px
}
.assistant-launcher:hover{
  transform:translateY(-5px) rotate(-1deg);
  box-shadow:0 22px 50px #4d412633
}
@keyframes launcher-in{
  from{
    opacity:0;
    transform:translateY(12px) scale(.9)
  }
  to{
    opacity:1;
    transform:none
  }
}
@media(max-width:1320px){
  .shell:not(.no-session){
    grid-template-columns:216px minmax(0,1fr)
  }
}
@media(prefers-reduced-motion:reduce){
  .assistant-launcher,.assistant-launcher span{
    animation:none!important
  }
  .assistant-launcher:hover{
    transform:none!important
  }
}
.model-indicator{
  max-width:180px;
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
  color:#647268
}
.project-context-receipt{
  margin-top:7px;
  color:#637269;
  font-size:11px
}
.project-context-receipt summary{
  cursor:pointer
}
.project-context-receipt ul{
  display:grid;
  gap:3px;
  margin:6px 0 0;
  padding-left:16px
}
.project-context-receipt code{
  font-size:10px;
  color:#466354
}
.editor:has(>.worldbook-settings){
  grid-template-rows:auto auto minmax(0,1fr) auto
}
.worldbook-settings{
  display:grid;
  grid-template-columns:minmax(160px,1fr) auto 88px auto;
  align-items:end;
  gap:8px 12px;
  padding:10px 14px;
  border-bottom:1px solid #ddd5c6;
  background:#f7f3e9;
  color:#53665a
}
.worldbook-settings>div{
  grid-column:1/-1;
  display:flex;
  align-items:baseline;
  gap:9px;
  min-width:0
}
.worldbook-settings>div small{
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap
}
.worldbook-settings>div .warning{
  margin-left:auto
}
.worldbook-settings label{
  display:grid;
  gap:3px;
  font-size:11px
}
.worldbook-settings textarea,.worldbook-settings input[type=number],.worldbook-settings label:not(.worldbook-enabled)>input{
  box-sizing:border-box;
  width:100%;
  min-width:0;
  padding:6px 7px;
  border:1px solid #cbc5b7;
  border-radius:4px;
  background:#fffdf7;
  color:#28382f
}
.worldbook-settings textarea{
  min-height:30px;
  max-height:78px;
  resize:vertical;
  font:inherit
}
.worldbook-settings .worldbook-enabled{
  display:flex;
  align-items:center;
  gap:5px;
  padding-bottom:6px;
  white-space:nowrap
}
.worldbook-settings button{
  margin-bottom:0;
  padding:6px 9px;
  border:1px solid #bfc5b8;
  border-radius:3px;
  background:#fffdf7;
  color:#2c5744;
  cursor:pointer
}
.worldbook-settings button:hover{
  background:#e1eadc
}
.worldbook-settings button:disabled,.worldbook-settings input:disabled,.worldbook-settings textarea:disabled{
  cursor:not-allowed;
  opacity:.55
}
@media(max-width:1180px){
  .worldbook-settings>div small{
    display:none
  }
  .worldbook-settings{
    grid-template-columns:minmax(130px,1fr) auto 78px auto;
    gap-inline:8px
  }
}
.import-overlay{
  position:fixed;
  z-index:40;
  inset:0;
  display:grid;
  place-items:center;
  padding:24px;
  background:#1f2d2570
}
.import-dialog{
  box-sizing:border-box;
  width:min(520px,100%);
  display:grid;
  gap:14px;
  padding:24px;
  border:1px solid #d8cfbd;
  border-radius:16px 4px 16px 4px;
  background:#fffdf6;
  box-shadow:0 28px 80px #1c28221f
}
.import-dialog h2,.import-dialog p{
  margin:0
}
.import-dialog ul{
  max-height:170px;
  margin:0;
  overflow:auto;
  padding-left:20px;
  color:#5c6e62
}
.import-dialog footer{
  display:flex;
  justify-content:flex-end;
  flex-wrap:wrap;
  gap:8px
}
.import-dialog button{
  padding:7px 11px;
  border:1px solid #b9c8ba;
  border-radius:4px;
  background:#f5f1e6;
  color:#2c5744;
  cursor:pointer
}
.snapshot-library{
  width:min(620px,100%)
}
.snapshot-dialog{
  width:min(620px,100%)
}
.snapshot-list{
  display:grid;
  gap:8px;
  max-height:280px!important;
  padding:0!important;
  list-style:none
}
.snapshot-list li{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:12px;
  padding:10px;
  border:1px solid #ded6c7;
  border-radius:8px;
  background:#faf6ec
}
.snapshot-list li div{
  display:grid;
  gap:3px;
  min-width:0
}
.snapshot-list li strong{
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
  color:#294938
}
.snapshot-list li small{
  color:#6b776e
}
.layout-shell{
  grid-template-rows:52px minmax(0,1fr);
  overflow:hidden
}
.layout-shell>.sidebar,.layout-shell>.editor,.layout-shell>.empty-paper,.layout-shell>.project-view,.layout-shell>.chat,.layout-shell>.panel-resizer{
  grid-column:auto;
  grid-row:2;
  min-width:0
}
.layout-shell>.chat{
  position:relative;
  z-index:1;
  inset:auto;
  width:auto;
  min-width:0;
  border:0;
  border-left:1px solid #d8d0bf;
  border-radius:0;
  box-shadow:none;
  overflow:hidden
}
.layout-shell>.chat[hidden]{
  display:none!important
}
.layout-shell>.editor,.layout-shell>.project-view{
  grid-column:auto
}
.layout-shell>.sidebar{
  grid-column:auto
}
.layout-controls,.workspace-view-controls{
  display:flex;
  align-items:center;
  gap:3px;
  padding:3px;
  border:1px solid #d8d0bf;
  border-radius:15px 5px 15px 15px;
  background:#f1ecdf
}
.layout-controls button,.workspace-view-controls button{
  min-width:42px;
  padding:4px 8px;
  border:0;
  border-radius:11px 3px 11px 11px;
  background:transparent;
  color:#526b5d;
  cursor:pointer
}
.layout-controls button[aria-pressed=true],.workspace-view-controls button[aria-pressed=true]{
  background:#d8e6d8;
  color:#183f2f;
  font-weight:600
}
.layout-controls button:disabled{
  cursor:not-allowed;
  opacity:.45
}
.panel-resizer{
  position:relative;
  z-index:4;
  min-width:0;
  cursor:col-resize;
  touch-action:none;
  user-select:none;
  background:#e6dfd1;
  transition:background-color 140ms ease
}
.panel-resizer span{
  position:absolute;
  inset:0 2px;
  border-radius:4px;
  background:transparent
}
.panel-resizer:hover,.panel-resizer:focus-visible,.panel-resizer[aria-valuenow]{
  outline:0
}
.panel-resizer:hover span,.panel-resizer:focus-visible span{
  background:#6f927c
}
.layout-shell.focus-mode .paper-input{
  width:min(calc(100% - 64px),980px);
  padding-inline:clamp(52px,10vw,128px);
  box-shadow:0 14px 42px #4b674719
}
.layout-shell.focus-mode .editor-header{
  padding-inline:20px
}
.layout-shell.focus-mode .editor-tools{
  justify-content:center
}
.layout-shell.assistant-open .assistant-launcher{
  display:none
}
@media(max-width:1180px){
  .layout-controls button,.workspace-view-controls button{
    min-width:36px;
    padding-inline:6px
  }
  .layout-shell .paper-input{
    width:calc(100% - 28px);
    padding-inline:34px
  }
}
@media(prefers-reduced-motion:reduce){
  .panel-resizer{
    transition:none!important
  }
}
.chapter-status-control select{
  padding:4px 7px;
  border:1px solid #c8c4b7;
  border-radius:10px 3px 10px 10px;
  background:#fffdf7;
  color:#315640
}
.project-view{
  box-sizing:border-box;
  min-height:0;
  overflow:auto;
  padding:clamp(24px,4vw,54px);
  background:#f8f3e8
}
.project-view>header{
  display:flex;
  align-items:flex-start;
  justify-content:space-between;
  gap:20px;
  margin-bottom:24px
}
.project-view h1,.project-view h2,.project-view p{
  margin:0
}
.project-view h1{
  color:#234b38;
  font:600 34px/1.2 var(--font-sans)
}
.project-view>header small{
  color:#708078;
  font:10px/1 ui-monospace,Consolas,monospace;
  letter-spacing:.18em
}
.project-view button,.project-view select{
  padding:7px 10px;
  border:1px solid #bec8bb;
  border-radius:11px 3px 11px 11px;
  background:#fffdf7;
  color:#285640;
  cursor:pointer
}
.overview-metrics{
  display:grid;
  grid-template-columns:repeat(5,minmax(88px,1fr));
  gap:10px;
  margin-bottom:20px
}
.overview-metrics article{
  display:grid;
  gap:3px;
  padding:16px;
  border:1px solid #ddd4c4;
  border-radius:16px 4px 16px 16px;
  background:#fffdf7
}
.overview-metrics strong{
  color:#28513e;
  font:600 28px/1 var(--font-sans);
  font-variant-numeric:tabular-nums
}
.overview-metrics span{
  color:#708078;
  font-size:11px
}
.overview-recent{
  display:flex;
  align-items:center;
  gap:8px;
  margin-bottom:16px!important;
  color:#68776d
}
.overview-recent button{
  padding:2px 5px;
  border:0;
  background:transparent;
  font-weight:600
}
.overview-recent small{
  margin-left:auto
}
.overview-list{
  display:grid;
  gap:7px;
  margin:0;
  padding:0;
  list-style:none
}
.overview-list li{
  display:grid;
  grid-template-columns:minmax(0,1fr) 104px;
  align-items:center;
  gap:12px;
  padding:10px 12px;
  border:1px solid #ded6c7;
  border-radius:12px 4px 12px 12px;
  background:#fffaf0
}
.overview-open{
  display:grid!important;
  gap:3px!important;
  padding:0!important;
  border:0!important;
  background:transparent!important;
  text-align:left
}
.overview-open strong,.card-open strong{
  color:#294b3a
}
.overview-open small{
  color:#718078
}
.card-tabs{
  display:flex;
  gap:4px
}
.card-tabs button[aria-pressed=true]{
  background:#d8e6d8;
  font-weight:600
}
.chapter-board{
  display:grid;
  grid-template-columns:repeat(3,minmax(210px,1fr));
  gap:14px;
  align-items:start
}
.chapter-board>section{
  min-width:0;
  padding:10px;
  border:1px solid #ddd4c4;
  border-radius:18px 5px 18px 18px;
  background:#eee8da
}
.chapter-board h2{
  display:flex;
  justify-content:space-between;
  padding:4px 4px 12px;
  color:#345745;
  font-size:14px
}
.chapter-board h2 small{
  display:grid;
  width:22px;
  height:22px;
  place-items:center;
  border-radius:50%;
  background:#d7e5d6
}
.chapter-board>section>div,.outline-cards{
  display:grid;
  gap:9px
}
.chapter-board article,.outline-cards article{
  display:grid;
  gap:8px;
  padding:12px;
  border:1px solid #ddd5c6;
  border-radius:12px 4px 12px 12px;
  background:#fffdf7
}
.card-open{
  display:grid!important;
  gap:5px!important;
  padding:0!important;
  border:0!important;
  background:transparent!important;
  text-align:left
}
.card-open code{
  overflow:hidden;
  color:#718078;
  font-size:10px;
  text-overflow:ellipsis
}
.card-open p{
  min-height:2.8em;
  color:#53675b;
  line-height:1.45
}
.card-open small{
  color:#78837c
}
.outline-cards{
  grid-template-columns:repeat(auto-fill,minmax(230px,1fr))
}
.export-preview-dialog{
  width:min(680px,100%)
}
.export-summary{
  display:grid;
  grid-template-columns:2fr 1fr 1fr;
  gap:8px;
  margin:0
}
.export-summary>div{
  padding:10px;
  border:1px solid #ded6c7;
  border-radius:8px;
  background:#faf6ec
}
.export-summary dt{
  color:#718078;
  font-size:11px
}
.export-summary dd{
  margin:3px 0 0;
  color:#294b3a;
  font-weight:600
}
.export-chapters{
  display:grid;
  gap:4px;
  max-height:280px;
  margin:0;
  padding:0;
  overflow:auto;
  list-style:none
}
.export-chapters li{
  display:flex;
  justify-content:space-between;
  gap:12px;
  padding:7px 9px;
  border-bottom:1px solid #e3dccf
}
.export-chapters small{
  flex:none
}
@media(max-width:1100px){
  .overview-metrics{
    grid-template-columns:repeat(3,1fr)
  }
  .chapter-board{
    grid-template-columns:1fr
  }
  .workspace-view-controls{
    display:none
  }
}
.tree{
  flex:1 1 auto
}
.tree-marker{
  display:inline-block;
  width:14px;
  color:#718078;
  text-align:center
}
.layout-shell:has(.export-menu[open]){
  overflow:visible
}
/* ————————————————————————————————————————
   全局精修
   ———————————————————————————————————————— */
/* 全局长滚动条与选区 */
:root {
  scrollbar-width: thin;
  scrollbar-color: #c6beac transparent;
}
*::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}
*::-webkit-scrollbar-track {
  background: transparent;
}
*::-webkit-scrollbar-thumb {
  border: 3px solid transparent;
  border-radius: 8px;
  background: #c6beac;
  background-clip: padding-box;
}
*::-webkit-scrollbar-thumb:hover {
  background: #a9a190;
  background-clip: padding-box;
}
*::-webkit-scrollbar-corner {
  background: transparent;
}
::selection {
  background: #cfe3cf;
  color: #173f30;
}
.paper-input {
  caret-color: #315e48;
}
button:disabled {
  cursor: not-allowed;
}
`

export const homePlayStyles = `
/* ————————————————————————————————————————
   首页动效(仅首页注入)
   ———————————————————————————————————————— */
.no-session{
  grid-template-columns:230px minmax(560px,1fr) 300px;
  grid-template-rows:52px minmax(0,1fr);
  background:#f3eddf
}
.no-session .chrome{
  background:#fffaf0
}
.no-session .empty-paper{
  height:auto
}
.brand-lockup{
  gap:9px
}
.brand-lockup>strong{
  font-size:18px;
  letter-spacing:-.04em
}
.brand-mark{
  width:30px;
  height:30px;
  border:0;
  border-radius:50% 50% 50% 12%;
  background:#234f3b;
  color:#fff;
  font:700 13px/1 Georgia,serif;
  box-shadow:0 7px 18px #234f3b33
}
.sidebar .side-title{
  padding:16px 18px 12px;
  border:0
}
.workspace-caption{
  padding:12px 18px 5px
}
.workspace-empty{
  justify-items:center;
  gap:10px;
  margin:30px 18px;
  padding:22px 8px;
  border:0;
  background:transparent;
  color:#7e877f
}
.folder-glyph{
  position:relative;
  width:42px;
  height:30px;
  border:1px solid #a9b4aa;
  border-radius:4px 10px 7px 7px;
  background:#f8f3e8;
  transform:rotate(-3deg);
  animation:folder-wiggle 5s ease-in-out infinite
}
.folder-glyph::before{
  content:'';
  position:absolute;
  left:4px;
  top:-7px;
  width:17px;
  height:8px;
  border:1px solid #a9b4aa;
  border-bottom:0;
  border-radius:5px 5px 0 0;
  background:#f8f3e8
}
.home-stage{
  position:relative;
  isolation:isolate;
  display:grid;
  grid-template-columns:minmax(260px,.85fr) minmax(260px,.72fr);
  align-items:center;
  justify-content:center;
  gap:clamp(32px,6vw,90px);
  overflow:hidden;
  padding:clamp(40px,7vw,96px);
  background:radial-gradient(circle at 65% 46%,#fffaf0 0 16%,transparent 42%),#f7f2e7;
  text-align:left
}
.home-ink{
  position:absolute;
  z-index:-1;
  left:4%;
  bottom:-18%;
  color:#1f503b;
  font:700 clamp(360px,40vw,640px)/.8 var(--font-sans);
  opacity:.035;
  animation:ink-drift 12s ease-in-out infinite alternate
}
.home-card{
  width:auto;
  padding:0;
  border:0;
  border-radius:0;
  background:transparent;
  box-shadow:none;
  animation:copy-arrive 620ms 180ms var(--ease) both
}
.home-card h1{
  max-width:none;
  margin:2px 0 34px;
  color:#173f30;
  font-size:clamp(58px,6vw,86px);
  line-height:.98;
  letter-spacing:-.09em;
  text-wrap:balance
}
.home-eyebrow{
  margin:0 0 16px;
  color:#60806d;
  font:600 11px/1.2 ui-monospace,"SFMono-Regular",Consolas,monospace;
  letter-spacing:.24em
}
.home-actions{
  justify-content:flex-start;
  margin:0;
  gap:12px
}
.home-actions button{
  min-width:auto;
  padding:11px 18px;
  border:0;
  border-radius:18px 6px 18px 18px;
  background:#e5dfd2
}
.home-actions button:hover{
  transform:translateY(-4px) rotate(1deg)!important;
  box-shadow:0 12px 24px #4c3e2517
}
.home-actions .primary-action{
  display:flex;
  align-items:center;
  gap:18px;
  padding-left:20px;
  border:0;
  background:#244f3c;
  color:#fff;
  box-shadow:0 10px 28px #244f3c2b
}
.home-actions .primary-action span{
  transition:transform 220ms var(--ease)
}
.home-actions .primary-action:hover span{
  transform:translate(3px,-3px)
}
.paper-motion{
  position:relative;
  width:min(30vw,330px);
  aspect-ratio:.78;
  justify-self:center;
  perspective:900px;
  animation:paper-hover 5.8s ease-in-out infinite
}
.paper-sheet{
  position:absolute;
  inset:0;
  border:1px solid #ded4bf;
  background:#fffdf6;
  box-shadow:0 28px 56px #55472c1b
}
.sheet-back{
  transform:translate(25px,17px) rotate(8deg);
  border-radius:6px 18px 6px 6px;
  background:#e5eadc
}
.sheet-mid{
  transform:translate(10px,8px) rotate(3deg);
  border-radius:7px 16px 7px 7px;
  background:#f1e9d7
}
.sheet-front{
  display:grid;
  align-content:start;
  gap:10px;
  box-sizing:border-box;
  padding:24% 16%;
  border-radius:8px 24px 8px 8px;
  transform:rotate(-2deg);
  transition:transform 450ms var(--ease),box-shadow 450ms ease;
  color:#46614f;
  font:16px/1.9 var(--font-sans)
}
.paper-motion:hover .sheet-front{
  transform:translateY(-9px) rotate(-4deg);
  box-shadow:0 38px 70px #55472c28
}
.sheet-line{
  white-space:nowrap
}
.sheet-line i{
  display:inline-block;
  font-style:normal;
  opacity:0;
  transform:translateY(.25em);
  animation:char-write 14s linear infinite
}
.sheet-front b{
  width:2px;
  height:22px;
  margin-top:4px;
  background:#315e48;
  animation:cursor-blink .9s steps(1) infinite
}
.home-stage>.warning{
  position:absolute;
  left:50%;
  bottom:34px;
  transform:translateX(-50%);
  margin:0
}
.empty-chat .chat-header{
  align-items:center
}
.chat-empty-body{
  place-items:center;
  align-content:center;
  gap:20px;
  padding:28px
}
.chat-empty-body>small{
  color:#809087;
  font-size:11px;
  letter-spacing:.14em
}
.agent-orb{
  position:relative;
  display:grid;
  width:110px;
  height:110px;
  place-items:center;
  border:1px solid #8ca090;
  border-radius:45% 55% 52% 48%;
  color:#315e48;
  font-size:30px;
  animation:orb-morph 7s ease-in-out infinite
}
.agent-orb::before,.agent-orb::after{
  content:'';
  position:absolute;
  border-radius:50%
}
.agent-orb::before{
  inset:12px;
  border:1px dashed #9daf9f;
  animation:orb-spin 12s linear infinite
}
.agent-orb::after{
  width:9px;
  height:9px;
  right:5px;
  top:24px;
  background:#4e8867;
  box-shadow:0 0 0 6px #4e88671a
}
.agent-orb span{
  animation:mark-float 3s ease-in-out infinite
}
@keyframes copy-arrive{
  from{
    opacity:0;
    transform:translateX(-22px)
  }
  to{
    opacity:1;
    transform:none
  }
}
@keyframes ink-drift{
  to{
    transform:translate(5%,3%) rotate(-3deg)
  }
}
@keyframes paper-hover{
  50%{
    transform:translateY(-12px) rotate(.8deg)
  }
}
@keyframes char-write{
  0%{
    opacity:0;
    transform:translateY(.25em)
  }
  2.5%,84%{
    opacity:1;
    transform:none
  }
  90%,100%{
    opacity:0;
    transform:translateY(-.12em)
  }
}
@keyframes word-cycle{
  0%{
    opacity:0;
    transform:translateY(.22em)
  }
  4%,21%{
    opacity:1;
    transform:none
  }
  25%,100%{
    opacity:0;
    transform:translateY(-.16em)
  }
}
.home-words{
  display:inline-grid
}
.home-words i{
  grid-area:1/1;
  font-style:normal;
  white-space:nowrap;
  opacity:0;
  transform:translateY(.22em);
  animation:word-cycle 9.6s var(--ease) infinite
}
.home-words i:nth-child(2){
  animation-delay:2.4s
}
.home-words i:nth-child(3){
  animation-delay:4.8s
}
.home-words i:nth-child(4){
  animation-delay:7.2s
}
@keyframes cursor-blink{
  50%{
    opacity:0
  }
}
@keyframes folder-wiggle{
  50%{
    transform:translateY(-4px) rotate(2deg)
  }
}
@keyframes orb-spin{
  to{
    transform:rotate(360deg)
  }
}
@keyframes orb-morph{
  0%,100%{
    border-radius:45% 55% 52% 48%;
    transform:rotate(-2deg)
  }
  50%{
    border-radius:56% 44% 42% 58%;
    transform:translateY(-8px) rotate(3deg)
  }
}
@media(max-width:1180px){
  .no-session{
    grid-template-columns:210px minmax(480px,1fr) 250px
  }
  .home-stage{
    gap:28px;
    padding:48px
  }
  .home-card h1{
    font-size:58px
  }
  .paper-motion{
    width:250px
  }
}
@media(prefers-reduced-motion:reduce){
  .folder-glyph,.home-ink,.home-card,.paper-motion,.sheet-line i,.sheet-front b,.agent-orb,.agent-orb::before,.agent-orb span,.home-words i{
    animation:none!important
  }
  .sheet-line i{
    opacity:1;
    transform:none
  }
  .home-words i{
    opacity:0
  }
  .home-words i:first-child{
    opacity:1;
    transform:none
  }
}
.no-session{
  grid-template-columns:230px minmax(560px,1fr)
}
@media(max-width:1180px){
  .no-session{
    grid-template-columns:210px minmax(480px,1fr)
  }
}
.path-fallback{
  display:grid;
  gap:10px;
  margin-top:18px
}
.path-fallback label{
  display:grid;
  gap:6px;
  color:#52695b;
  font-size:12px
}
.path-fallback input{
  box-sizing:border-box;
  width:min(520px,100%);
  padding:10px 12px;
  border:1px solid #b9c3b8;
  border-radius:4px;
  background:#fffdf7;
  color:#253b32
}
.path-fallback>div{
  display:flex;
  gap:8px
}
.path-fallback button{
  padding:8px 13px;
  border:0;
  border-radius:14px 4px 14px 14px;
  background:#e5dfd2;
  color:#2c5744
}
.path-fallback .primary-action{
  background:#244f3c;
  color:#fff
}
.home-card>.warning{
  max-width:36em;
  margin:12px 0 0;
  font-size:13px
}
`
