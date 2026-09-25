# DSH Editor 宣传片：H3 制作前方案

> 本文档为已完成工作的历史留档，仅供查证。

状态：供审阅。尚未调用 H3、生成镜头或制作成片。实机演示另见 [独立实机演示方案](live-demo-preproduction.md)。

## 定位

**写作有人搭手，落笔由你做主。**

这是一支约 28 秒的品牌宣传片：用 H3 生成纸张与蓝色墨迹的四个意象镜头，讲“卡住、讨论、选择、继续写”的过程。片中不展示或模拟产品界面。具体功能、操作速度与效果由另一支真实录屏演示证明。

默认规格为中文、16:9 横版。面向第一次听说 DSH Editor 的写作者。暖白、深蓝和克制的镜头运动呼应现有看板娘；中文、产品名、原版看板娘和下载信息全部在后期叠加，不交给 H3 绘制。静音观看也应能看懂。

## 28 秒分镜与文案

| 时间 | H3 画面 | 后期屏幕文案 | 旁白草稿 |
| --- | --- | --- | --- |
| 0–7 秒 | 暖白纸面上一道深蓝墨迹写到一半，停住。第 1 秒叠加小幅 DSH Editor 名称。 | 下一句，卡住了？ | “有时候，写作会卡在下一句。” |
| 7–14 秒 | 墨迹缓慢分成几条思路，纸面保持干净、可读。 | 和 AI 搭档聊聊思路。 | “和搭档聊聊，也许就有了新的角度。” |
| 14–21 秒 | 几条蓝线中有一条继续向前，其余轻轻淡出。 | 建议可以很多，决定留给你。 | “建议可以很多，写下哪一句，由你决定。” |
| 21–28 秒 | 纸页翻过，深蓝纸带移向边缘，在中间留下稳定留白。后期叠加原版看板娘、产品名与下载入口。 | 写作有人搭手，落笔由你做主。<br>下载 DSH Editor | “DSH Editor。写作有人搭手，落笔由你做主。” |

以上是候选旁白。正式制作时按粗剪节奏调整，不为凑齐所有句子挤压画面。产品名在开头与结尾都出现，结尾给观众明确的下一步。

## 素材清单

| 素材 | 来源与处理 |
| --- | --- |
| 看板娘原图 | 仓库 docs/assets/mascot.webp；片尾在后期叠加，不让 H3 重绘。 |
| 应用图标 | 仓库 apps/desktop/build/icon.png；可作为片尾角标。 |
| 产品名与下载入口 | 以 README.md 和正式下载页为准；导出前核对链接。 |
| H3 镜头 1–4 | 获批后生成。先用 768P 试镜，每镜 7 秒、16:9；必要时再决定是否重试或做 2K。 |
| 字幕、旁白和配乐 | 后期单独制作；整片只用一条声音主线。配乐须原创或有商用许可。 |

## H3 提示词草案

沿用官方 h3-prompt-writing 的 T2VA 结构。所有镜头共用暖白纸张、深海蓝与钴蓝、柔和侧光、克制的慢镜头；没有人物、文字、标志、屏幕或产品界面。独立生成后用剪辑衔接，不假定 H3 能自动保持画面连续。提交参数草案：model MiniMax-H3、ratio 16:9、duration 7、resolution 768P。正式提交前核对中国区价格与额度。

### 镜头 1：停住的一句

~~~text
integrated_multimodal_description: [Shot 1] From 00:00.000 to 00:07.000, a restrained top-down close shot of one clean warm-ivory sheet on a matte writing desk. A thin cobalt-blue ink line travels gently from the lower left toward the center and then pauses completely at 00:05.000. Soft side light reveals the paper texture. The camera makes a very slow, small push-in. Keep the upper right uncluttered for a title added later. No letters, interface, logo, person, or book cover.
overall_soundscape: Quiet indoor room tone, one faint paper rustle, and a subtle ink movement that stops with the line. No speech.
non_diegetic_music: N/A
~~~

### 镜头 2：想法展开

~~~text
integrated_multimodal_description: [Shot 1] From 00:00.000 to 00:07.000, on the same warm-ivory paper surface and in the same soft side light, a cobalt-blue ink line slowly branches into three clean, distinct paths. The branches spread with modest, deliberate motion and leave a clear area across the upper third for captions added later. The camera stays nearly still, with a slight lateral drift. The composition remains simple and calm. No letters, interface, logo, person, or book cover.
overall_soundscape: Quiet room tone with three soft ink-like strokes and a faint paper texture. No speech.
non_diegetic_music: N/A
~~~

### 镜头 3：作出选择

~~~text
integrated_multimodal_description: [Shot 1] From 00:00.000 to 00:07.000, a close view of three cobalt-blue ink paths on warm-ivory paper. One path continues smoothly toward the right while the other two become lighter and still; nothing is erased abruptly. The camera follows the moving path at very low speed and small amplitude, then settles. Keep the top left open for a caption added later. No letters, interface, logo, person, or book cover.
overall_soundscape: A soft continuous paper ambience and one gentle ink movement, ending in quiet. No speech.
non_diegetic_music: N/A
~~~

### 镜头 4：片尾留白

~~~text
integrated_multimodal_description: [Shot 1] From 00:00.000 to 00:07.000, a warm-ivory paper page turns slowly in close view. Narrow navy and cobalt paper-like ribbons settle at the far left and right edges. The camera makes a very small pull-back. By 00:05.000 the center becomes clean, still, and spacious, ready for the original mascot, product name, and download message added later in editing. No letters, interface, logo, person, or book cover.
overall_soundscape: One soft page turn over quiet interior room tone, fading to stillness. No speech.
non_diegetic_music: N/A
~~~

试镜时重点看伪文字、纸张与墨迹是否稳定、字幕空间是否足够，以及四镜能否连成同一视觉世界。若重复生成仍无法保持统一，就缩减 H3 镜头并用平面动画衔接。

## 制作与批准点

1. 先审阅本方案的主张、画面与文案；同时独立审阅实机演示方案。
2. 你认可宣传片方案后，核对 H3 中国区账户权限、当时价格与预期生成次数，再提交付费任务。创建接口是 POST https://api.minimax.cn/v2/video_generation；用任务 ID 查询结果。
3. 审看四个试镜结果，再决定重做、升级分辨率或改用平面动画。没有自动追加付费生成。
4. 加入字幕、原版看板娘、品牌字和下载信息，统一声音；检查静音观看、手机尺寸可读性与下载链接，再导出 MP4。

**宣传片批准不自动等于实机演示批准；两支片可以分别修改、分别开始。** 当前不会读取或展示 .env 中的密钥值。

## 依据

- 产品定位：仓库 README.md 与 docs/user-guide.md。
- [MiniMax H3 视频 API](https://platform.minimax.cn/docs/api-reference/video-generation-v2-create)及[任务查询](https://platform.minimax.cn/docs/api-reference/video-generation-v2-query)。
- [官方 H3 提示词技能](https://github.com/MiniMax-AI/MiniMax-H3/tree/d21241f0a4b3acbb34c97dae47fa417b7065e438/skills/h3-prompt-writing)。
- [Google ABCDs 视频创意指南](https://www.thinkwithgoogle.com/_qs/documents/15987/ABCDs_PDFPlaybook_April2022_Final.pdf)：这里只借用尽早出现品牌、聚焦一个信息、结尾明确指向下一步的结构原则。
