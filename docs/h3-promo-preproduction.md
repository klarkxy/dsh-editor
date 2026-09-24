# DSH Editor 宣传片：H3 制作前方案

状态：**供审阅的制作方案**。尚未调用 MiniMax H3、录制产品画面或制作成片。

## 一句话方向

**写作有人搭手，落笔由你做主。**

让观众看到一个完整的小动作：作者写下内容、遇到卡点、向搭档寻求建议、预览改动、自己决定是否采用。用真实产品录屏证明功能；用 MiniMax H3 生成开场和收尾的氛围镜头。产品界面、中文标题、看板娘和下载信息都在后期叠加，避免生成画面里的文字和界面失真。

## 默认规格与观众

- 面向正在写小说、文章或其他长文的人；重点是“怎么把稿子继续写下去”。
- 中文，约 36 秒，16:9 横版，适合产品页、B 站和常规视频平台。若需要竖版，待横版通过后按竖屏重新排字幕与产品画面，不直接裁掉三栏界面。
- 基调：安静、可信、有一点蓝色墨水的想象力。底色用暖白与深蓝，呼应现有看板娘，不做夸张的科幻界面。
- 静音观看时仍能看懂；旁白是增强层，不承担唯一的信息传达。

## 36 秒脚本与分镜

| 时间 | 画面与来源 | 屏幕文案 | 旁白草稿 | 声音 |
| --- | --- | --- | --- | --- |
| 0–4 秒 | **H3 镜头 A**：暖白纸面上一道深蓝墨迹缓慢向前。后期从第 1 秒叠加小幅 DSH Editor 名称，画面保留主字幕空间。 | 下一句，从哪里开始？ | “有时，难的是下一句。” | 轻微纸张与墨迹声；音乐从低处进入。 |
| 4–10 秒 | **真实录屏**：新建或打开演示作品，进入三栏写作界面，在稿纸写入一句演示文字。 | 打开作品，继续写。 | “在 DSH Editor，先把想法写下来。” | 键盘与页面轻响。 |
| 10–16 秒 | **真实录屏**：在侧栏向写作搭档提问，呈现简短的讨论结果。只展示真实可用的操作。 | 卡住了，就讨论一下。 | “思路卡住，和搭档聊一聊。” | 音乐略向前。 |
| 16–24 秒 | **真实录屏**：选段改写或文件提案，突出“预览 → 作者点击应用”的连续动作。 | 建议先看，改动由你决定。 | “建议先预览，采用以后才会写进稿件。” | 点击“应用”时一个克制的确认音。 |
| 24–30 秒 | **真实录屏**：展示作品文件树和导出稿件入口，镜头最终回到完整稿纸。 | 作品留在自己的文件夹。 | “作品就在自己的文件夹里。” | 音乐收束，保留一拍停顿。 |
| 30–36 秒 | **H3 镜头 B**：深蓝纸带退向画面边缘，中央留白。后期放入原版看板娘、DSH Editor 字样与下载入口。 | 写作有人搭手，落笔由你做主。<br>下载 DSH Editor | “DSH Editor。写作有人搭手，落笔由你做主。” | 音乐落点，安静结束。 |

旁白为候选文案，正式配音前再按实际粗剪时长调整。画面中的演示文字只使用新建的虚构测试作品；不录入真实用户稿件、账号、密钥或个人资料。

## 已有素材与待制作素材

| 素材 | 位置或取得方式 | 用法 |
| --- | --- | --- |
| 看板娘原图 | `docs/assets/mascot.webp` | 结尾在后期叠加原图；不让 H3 重新绘制角色。 |
| 应用图标 | `apps/desktop/build/icon.png` | 结尾角标或片尾下载卡。 |
| 产品名称及下载地址 | `README.md` 的正式名称与 GitHub Releases 链接 | 开头品牌字与片尾下载卡，导出前核对最新地址。 |
| 产品录屏 | 待方案获批后，用干净的演示作品实录 | 写作、对话、改写预览、应用与导出。 |
| H3 氛围镜头 A、B | 待方案获批后调用中国区 H3 API | 只生成抽象纸张与蓝色墨迹；不生成产品 UI、标志或文字。 |
| 配乐与旁白 | 待确定成片语气后录制或选用具备商用许可的素材 | 全片共用一条声音主线；不要直接拼接两段 H3 随机音乐。 |

## H3 提示词草案

按 MiniMax 官方 `h3-prompt-writing` 的 T2VA 结构准备。两条都是 **文生视频**，不上传产品素材。生成参数先按 `model: MiniMax-H3`、`ratio: 16:9`、`resolution: 768P` 试镜；最终分辨率和次数在核对价格后决定。中文文案全部后期叠加。

### 镜头 A：4 秒

```text
integrated_multimodal_description: [Shot 1] From 00:00.000 to 00:04.000, a restrained top-down close shot of a single clean warm-ivory sheet on a matte writing desk. A thin cobalt-blue line of ink gradually extends from the lower left toward the center, then comes to rest. Soft morning light falls from the upper left; the paper texture remains visible. The camera makes a very slow, small push-in. Leave the upper right half uncluttered for a title added later in editing. No visible letters, interface, logo, person, or book cover.
overall_soundscape: Quiet interior room tone with a faint paper rustle and one soft ink-like movement. No speech.
non_diegetic_music: N/A
```

### 镜头 B：6 秒

```text
integrated_multimodal_description: [Shot 1] From 00:00.000 to 00:06.000, on a warm-ivory background, a few narrow navy and cobalt paper-like ribbons move slowly from the center toward the left and right edges. Their movement is smooth and modest, like a page settling after a turn. The camera stays nearly still with a slight pull-back. By the final second, the center is clean and stable, with generous empty space for the original mascot, product name, and download message added later in editing. No visible letters, interface, logo, person, or book cover.
overall_soundscape: A soft page-turn movement and quiet room tone, fading to stillness at the end. No speech.
non_diegetic_music: N/A
```

试镜检查：画面是否出现伪文字、脏污或不稳定的纸面；动作是否适合与真实录屏衔接；是否留足字幕安全区。若镜头 B 的纸带效果不稳，改用实拍/平面动画背景，不反复付费碰运气。

## 制作流程与批准点

1. **现在：确定方案。** 审阅主张、36 秒节奏、旁白、字幕、视觉方向和下载渠道。此阶段不调用 H3。
2. **获批后：采集真实产品证据。** 新建演示作品，隐藏个人信息与真实密钥；按脚本录制操作，逐项核对当前版本界面。先剪一版以录屏为主的无特效粗片。
3. **H3 试镜。** 核对中国区账号的 H3 权限和当时的价格后，提交镜头 A、B 的 768P 任务，记录任务 ID、参数和结果。每条先试一次，看结果再决定是否追加生成或升级 2K。中国区接口为 `POST https://api.minimax.cn/v2/video_generation`，成功后用 `GET /v2/query/video_generation/{task_id}` 取结果。
4. **合成与声音。** 保留真实录屏的 UI；在剪辑软件里加字幕、原版看板娘、产品名和下载信息。单独处理旁白、音乐与音效，检查静音版也能看懂。
5. **验收。** 核对功能演示真实、无泄露信息、片尾链接正确、手机尺寸文字可读、声音不压旁白；导出横版 MP4。竖版若需要，另做排版和镜头选择。

**需要你批准后才进行的事：** 向付费 H3 API 提交生成任务；录制正式产品画面；合成和导出宣传片。当前方案不会读取或展示 `.env` 中的密钥值。

## 依据

- 产品实际功能：仓库 `README.md`、`docs/user-guide.md`。
- MiniMax H3 视频 API：https://platform.minimax.cn/docs/api-reference/video-generation-v2-create
- H3 任务查询：https://platform.minimax.cn/docs/api-reference/video-generation-v2-query
- 官方 H3 提示词技能：https://github.com/MiniMax-AI/MiniMax-H3/tree/d21241f0a4b3acbb34c97dae47fa417b7065e438/skills/h3-prompt-writing
- Google 的 [ABCDs 视频创意指南](https://www.thinkwithgoogle.com/_qs/documents/15987/ABCDs_PDFPlaybook_April2022_Final.pdf)：尽早出现品牌、聚焦一个能让观众共鸣的内容、给出明确下一步。这里只借用其结构原则，不把指南里的广告效果数据外推到这支片子。
