import { useEffect, useRef, useState } from 'react'
import { Badge, Button, Card, Dialog, Flex, Heading, Select, Text, TextArea, Theme } from '@radix-ui/themes'
import { DESIGN_SOURCE, LIGHT_TOKENS, DARK_TOKENS } from './tokens.ts'

/** Live reference using production Radix controls and the production tokens. */
export function DesignSystemGallery() {
  const [open, setOpen] = useState(false)
  const returnFocus = useRef<HTMLElement | null>(null)
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.isComposing || event.repeat || !event.ctrlKey || !event.altKey || !event.shiftKey || event.code !== 'KeyD') return
      if (document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')) return
      event.preventDefault()
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      setOpen(true)
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [])
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Content maxWidth="960px" aria-describedby="dsh-design-description"
        onCloseAutoFocus={(event) => {
          const target = returnFocus.current
          if (target?.isConnected) { event.preventDefault(); target.focus({ preventScroll: true }) }
        }}>
        <Dialog.Title>DSH UI / Design system</Dialog.Title>
        <Dialog.Description id="dsh-design-description" size="2" color="gray" mb="4">
          Official Kimi Web reference, adapted to the existing DSH React/Radix shell. Preview states only; no workspace writes.
        </Dialog.Description>
        <Flex direction={{ initial: 'column', md: 'row' }} gap="4">
          {(['light', 'dark'] as const).map((appearance) => (
            <Theme key={appearance} appearance={appearance} accentColor="blue" grayColor="gray" radius="medium" style={{ flex: 1, minWidth: 0, padding: 'var(--dsh-ui-space-4)', borderRadius: 'var(--dsh-ui-radius-lg)' }}>
              <Flex direction="column" gap="4">
                <Heading size="3">{appearance === 'light' ? 'Light' : 'Dark'}</Heading>
                <Flex gap="2" wrap="wrap">
                  {(['bg', 'sidebar', 'text', 'muted', 'accent'] as const).map((name) => (
                    <Flex key={name} direction="column" gap="1" style={{ minWidth: 40 }}>
                      <span aria-hidden="true" style={{ height: 28, borderRadius: 'var(--dsh-ui-radius-sm)', background: (appearance === 'light' ? LIGHT_TOKENS : DARK_TOKENS)[name], border: '1px solid var(--dsh-ui-line)' }} />
                      <Text size="1">{name}</Text>
                    </Flex>
                  ))}
                </Flex>
                <Flex gap="2" wrap="wrap">
                  <Button>Primary</Button><Button variant="outline">Secondary</Button>
                  <Button variant="ghost" color="gray">Ghost</Button><Button disabled>Disabled</Button>
                </Flex>
                <Flex gap="2" wrap="wrap">
                  <Badge color="gray">Waiting</Badge><Badge color="green">Completed</Badge>
                  <Badge color="amber">Approval</Badge><Badge color="red">Conflict</Badge>
                </Flex>
                <TextArea aria-label={`${appearance} sample input`} placeholder="写下你的想法 / Write a message" />
                <Select.Root defaultValue="one">
                  <Select.Trigger aria-label={`${appearance} sample menu`} />
                  <Select.Content><Select.Item value="one">First option</Select.Item><Select.Item value="two">Second option</Select.Item></Select.Content>
                </Select.Root>
                <Card className="proposal-card">
                  <Flex direction="column" gap="2">
                    <Text weight="medium">正文提案 / Proposal</Text>
                    <Text size="2">一个清楚的标题，一段可阅读的正文，只突出需要作者决定的操作。</Text>
                    <Flex className="proposal-actions" gap="2" justify="end"><Button variant="outline">Discard</Button><Button>Apply</Button></Flex>
                  </Flex>
                </Card>
              </Flex>
            </Theme>
          ))}
        </Flex>
        <Flex align="center" justify="between" gap="3" mt="4" wrap="wrap">
          <Text size="1" color="gray">Source: {DESIGN_SOURCE.repository} · {DESIGN_SOURCE.revision.slice(0, 12)}</Text>
          <Dialog.Close><Button variant="outline">Close / 关闭</Button></Dialog.Close>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  )
}
