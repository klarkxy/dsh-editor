import { memo, type ReactNode } from 'react'
import { Box } from '@radix-ui/themes'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { windowBridge } from './window-controls.tsx'

/*
 * 聊天回复的 Markdown 渲染。react-markdown 产出 React 节点、不经过
 * innerHTML,模型输出不可信也不构成 XSS;链接只允许 http(s),
 * 其余协议(file:、javascript:…)降级为纯文本,与原手写渲染器行为一致。
 * GFM 覆盖删除线等对话高频语法。
 */

function safeHref(url: string): string | undefined {
  const out = defaultUrlTransform(url)
  return /^https?:\/\//i.test(out) ? out : undefined
}

function PlainLink(props: { href?: string; children?: ReactNode }) {
  if (!props.href) return <>{props.children}</>
  const href = props.href
  /* 桌面端 shell 禁止窗内导航与新窗口(will-navigate/setWindowOpenHandler),
     外链统一交给主进程白名单校验后的系统浏览器;web 端退化为新标签页。 */
  return <a
    href={href}
    onClick={(event) => {
      event.preventDefault()
      const bridge = windowBridge()
      if (bridge?.openExternal) {
        bridge.openExternal(href)
        return
      }
      globalThis.open?.(href, '_blank', 'noopener,noreferrer')
    }}>
    {props.children}
  </a>
}

export const Markdown = memo(function Markdown(props: { text: string }) {
  return (
    <Box className="chat-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={safeHref}
        components={{ a: PlainLink }}
      >
        {props.text}
      </ReactMarkdown>
    </Box>
  )
})
