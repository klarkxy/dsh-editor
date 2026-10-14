import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { collectStyles } from '../design-system/layers.ts'
import {
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  DataList,
  Dialog,
  Disclosure,
  EmptyState,
  Field,
  Flex,
  Heading,
  IconButton,
  Input,
  Kbd,
  ListRow,
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
  MenuTrigger,
  Notice,
  Popover,
  Progress,
  RadioGroup,
  ScrollArea,
  SearchField,
  SegmentedControl,
  Select,
  Separator,
  Slider,
  Spinner,
  Switch,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  Text,
  TextArea,
  UiRoot,
} from './index.ts'
import './switch.styles.ts'

const html = (node: ReactNode) =>
  renderToStaticMarkup(createElement(UiRoot, { theme: 'light' }, node))

describe('UiRoot', () => {
  it('renders theme attribute and portal root', () => {
    const out = html('x')
    expect(out).toContain('data-dsh-theme="light"')
    expect(out).toContain('data-dsh-portal-root')
    const dark = renderToStaticMarkup(createElement(UiRoot, { theme: 'dark' }, 'x'))
    expect(dark).toContain('data-dsh-theme="dark"')
  })
})

describe('Button', () => {
  it('renders variant and size data attributes', () => {
    const out = html(createElement(Button, { variant: 'danger', size: 'lg' }, '删'))
    expect(out).toContain('data-variant="danger"')
    expect(out).toContain('data-size="lg"')
    expect(out).toContain('type="button"')
  })

  it('loading sets aria-busy and disables the button', () => {
    const out = html(createElement(Button, { loading: true }, '存'))
    expect(out).toContain('aria-busy="true"')
    expect(out).toContain('disabled=""')
    expect(out).toContain('dsh-spinner')
  })
})

describe('IconButton', () => {
  it('sets aria-label from the required label', () => {
    const out = html(createElement(IconButton, { label: '关闭面板' }))
    expect(out).toContain('aria-label="关闭面板"')
    expect(out).toContain('dsh-icon-button')
  })

  it('supports toggle pressed state', () => {
    const out = html(createElement(IconButton, { label: '书签', pressed: true }))
    expect(out).toContain('aria-pressed="true"')
  })
})

describe('Kbd / Badge / Spinner / EmptyState', () => {
  it('Kbd renders tokens with separators', () => {
    const out = html(createElement(Kbd, null, 'Ctrl+Alt+T'))
    expect(out).toContain('<kbd')
    expect(out).toContain('Ctrl')
    expect(out).toContain('Alt')
    expect(out).toContain('T')
  })

  it('Badge renders tone', () => {
    const out = html(createElement(Badge, { tone: 'success' }, '完成'))
    expect(out).toContain('data-tone="success"')
  })

  it('Spinner is an aria-hidden progressbar', () => {
    const out = html(createElement(Spinner))
    expect(out).toContain('role="progressbar"')
    expect(out).toContain('aria-hidden="true"')
  })

  it('EmptyState renders title, body and actions', () => {
    const out = html(createElement(EmptyState, {
      title: '暂无作品',
      body: '新建一部开始写作',
      actions: createElement(Button, null, '新建'),
    }))
    expect(out).toContain('dsh-empty-state')
    expect(out).toContain('暂无作品')
    expect(out).toContain('新建一部开始写作')
    expect(out).toContain('新建')
  })
})

describe('Notice', () => {
  it('uses role=alert for warning and danger, status otherwise', () => {
    expect(html(createElement(Notice, { tone: 'warning' }, 'w'))).toContain('role="alert"')
    expect(html(createElement(Notice, { tone: 'danger' }, 'd'))).toContain('role="alert"')
    expect(html(createElement(Notice, { tone: 'info' }, 'i'))).toContain('role="status"')
    expect(html(createElement(Notice, { tone: 'success' }, 's'))).toContain('role="status"')
  })

  it('renders title, body and action', () => {
    const out = html(createElement(Notice, {
      tone: 'info', title: '提示', action: createElement(Button, { variant: 'ghost' }, '知道了'),
    }, '正文'))
    expect(out).toContain('提示')
    expect(out).toContain('正文')
    expect(out).toContain('知道了')
  })
})

describe('ListRow', () => {
  it('renders label, meta, selected state', () => {
    const out = html(createElement(ListRow, { label: '第一章', meta: '2.1k', selected: true }))
    expect(out).toContain('aria-current="page"')
    expect(out).toContain('data-selected="true"')
    expect(out).toContain('第一章')
    expect(out).toContain('2.1k')
  })

  it('is keyboard-interactive only when selectable', () => {
    const plain = html(createElement(ListRow, { label: 'a' }))
    expect(plain).not.toContain('role="button"')
    const clickable = html(createElement(ListRow, { label: 'a', onSelect() {} }))
    expect(clickable).toContain('role="button"')
    expect(clickable).toContain('tabindex="0"')
  })
})

describe('fields', () => {
  it('Field links label, control and error via ids and marks invalid', () => {
    const out = html(createElement(Field, {
      label: '作者名', description: '显示在封面', error: '必填',
      children: createElement(Input, { 'aria-label': '作者名' }),
    }))
    expect(out).toContain('dsh-field')
    expect(out).toContain('必填')
    expect(out).toContain('role="alert"')
    expect(out).toContain('aria-invalid="true"')
    expect(out).toContain('aria-describedby')
    expect(out.match(/for="[^"]+"/)).toBeTruthy()
  })

  it('Input renders size and invalid state', () => {
    const out = html(createElement(Input, { 'aria-label': 'x', size: 'sm', invalid: true }))
    expect(out).toContain('data-size="sm"')
    expect(out).toContain('data-invalid="true"')
    expect(out).toContain('aria-invalid="true"')
  })

  it('SearchField renders search type and labelled clear button', () => {
    const out = html(createElement(SearchField, {
      value: 'abc', onChange() {}, onClear() {}, clearLabel: '清空',
    }))
    expect(out).toContain('type="search"')
    expect(out).toContain('aria-label="清空"')
    expect(out).toContain('dsh-search-field')
  })

  it('TextArea autoresizes between minRows and maxRows', () => {
    const out = html(createElement(TextArea, { 'aria-label': 'x', minRows: 3, maxRows: 6, value: 'abc' }))
    expect(out).toContain('dsh-textarea')
    expect(out).toContain('rows="3"')
    expect(out).toContain('abc')
  })
})

describe('switch rows', () => {
  it('renders label wrapping the switch so the whole row toggles', () => {
    const out = html(createElement(Switch, {
      checked: true, onCheckedChange() {},
      label: '打字机滚动', description: '光标保持在屏幕中部', shortcut: 'Ctrl+Alt+T',
    }))
    expect(out).toContain('<label class="dsh-switch-row')
    expect(out).toContain('role="switch"')
    expect(out).toContain('aria-checked="true"')
    expect(out).toContain('打字机滚动')
    expect(out).toContain('光标保持在屏幕中部')
    expect(out).toContain('<kbd')
  })

  it('switch row styles enforce a 40px hit area', () => {
    const rowBlock = collectStyles().match(/\.dsh-switch-row\s*\{[^}]*\}/)?.[0] ?? ''
    expect(rowBlock).toContain('min-height: 40px')
  })
})

describe('selection controls', () => {
  it('Checkbox renders label row with role=checkbox', () => {
    const out = html(createElement(Checkbox, { checked: true, onCheckedChange() {}, label: '记住选择' }))
    expect(out).toContain('role="checkbox"')
    expect(out).toContain('记住选择')
  })

  it('Checkbox renders a distinct minus glyph for indeterminate', () => {
    const out = html(createElement(Checkbox, { checked: 'indeterminate' as const, onCheckedChange() {}, label: '目录半选' }))
    expect(out).toContain('data-state="indeterminate"')
    expect(out).toContain('dsh-checkbox__glyph--minus')
    expect(out).toContain('dsh-checkbox__glyph--check')
  })

  it('RadioGroup renders radiogroup with checked item', () => {
    const out = html(createElement(RadioGroup, {
      value: 'b',
      options: [{ value: 'a', label: '甲' }, { value: 'b', label: '乙' }],
    }))
    expect(out).toContain('role="radiogroup"')
    expect(out).toContain('data-state="checked"')
    expect(out).toContain('乙')
  })

  it('Select renders a labelled combobox trigger', () => {
    const out = html(createElement(Select, {
      'aria-label': '字体', value: 'kai',
      options: [{ value: 'kai', label: '楷体' }, { value: 'song', label: '宋体' }],
    }))
    expect(out).toContain('role="combobox"')
    expect(out).toContain('aria-label="字体"')
    expect(out).toContain('dsh-select')
  })

  it('Select open list renders options with check indicator slot', () => {
    const out = html(createElement(Select, {
      'aria-label': 'x', value: 'a', open: true,
      options: [{ value: 'a', label: '选项A' }, { value: 'b', label: '选项B', description: '说明' }],
    }))
    expect(out).toContain('选项A')
    expect(out).toContain('选项B')
    expect(out).toContain('说明')
    expect(out).toContain('dsh-menu__check')
  })

  it('SegmentedControl marks the active option', () => {
    const out = html(createElement(SegmentedControl, {
      'aria-label': '纸宽', value: 'mid',
      options: [{ value: 'narrow', label: '窄' }, { value: 'mid', label: '中' }, { value: 'wide', label: '宽' }],
    }))
    expect(out).toContain('aria-label="纸宽"')
    const onSegment = out.match(/<button[^>]*data-state="on"[^>]*>([^<]*)<\/button>/)
    expect(onSegment?.[1]).toBe('中')
  })

  it('Slider renders a labelled slider thumb', () => {
    const out = html(createElement(Slider, { 'aria-label': '字号', value: [18], min: 14, max: 24 }))
    expect(out).toContain('role="slider"')
    expect(out).toContain('aria-label="字号"')
    expect(out).toContain('aria-valuemin="14"')
    expect(out).toContain('aria-valuemax="24"')
  })
})

describe('Menu', () => {
  it('renders items with label, shortcut, danger tone and separator', () => {
    const out = html(createElement(Menu, { open: true, modal: false },
      createElement(MenuTrigger, null, createElement('button', null, '触发')),
      createElement(MenuContent, null,
        createElement(MenuLabel, null, '章节'),
        createElement(MenuItem, { shortcut: 'F2' }, '重命名'),
        createElement(MenuItem, { tone: 'danger', shortcut: 'Del' }, '删除'),
        createElement(MenuSeparator),
        createElement(MenuItem, { disabled: true }, '禁用项'))))
    expect(out).toContain('role="menu"')
    expect(out).toContain('重命名')
    expect(out).toContain('删除')
    expect(out).toContain('data-tone="danger"')
    expect(out).toContain('aria-disabled="true"')
    expect(out.match(/<kbd[^>]*>F2<\/kbd>/)).toBeTruthy()
    expect(out.match(/<kbd[^>]*>Del<\/kbd>/)).toBeTruthy()
    expect(out).toContain('role="separator"')
  })

  it('renders submenu trigger and content', () => {
    const out = html(createElement(Menu, { open: true, modal: false },
      createElement(MenuTrigger, null, createElement('button', null, '触发')),
      createElement(MenuContent, null,
        createElement(MenuSub, null,
          createElement(MenuSubTrigger, null, '移动到'),
          createElement(MenuSubContent, null, createElement(MenuItem, null, '第二章'))))))
    expect(out).toContain('移动到')
  })
})

describe('overlay components', () => {
  it('Dialog renders title, description, close button and footer', () => {
    const out = html(createElement(Dialog, {
      open: true, onOpenChange() {}, title: '导出章节', description: '选择格式', closeLabel: '关闭',
      footer: createElement(Button, null, '导出'),
    }, createElement('p', null, 'body')))
    expect(out).toContain('role="dialog"')
    expect(out).toContain('导出章节')
    expect(out).toContain('选择格式')
    expect(out).toContain('aria-label="关闭"')
    expect(out).toContain('dsh-overlay')
  })

  it('ConfirmDialog renders alertdialog with busy semantics', () => {
    const out = html(createElement(ConfirmDialog, {
      open: true, title: '删除章节？', message: '不可恢复',
      confirmLabel: '删除', cancelLabel: '取消', tone: 'danger', busy: true,
      onConfirm() {},
    }))
    expect(out).toContain('role="alertdialog"')
    expect(out).toContain('删除章节？')
    expect(out).toContain('不可恢复')
    expect(out).toContain('aria-busy="true"')
    const buttons = out.match(/<button[^>]*disabled=""[^>]*>/g) ?? []
    expect(buttons.length).toBe(2)
  })

  it('Popover renders trigger and content', () => {
    const out = html(createElement(Popover, {
      open: true, content: createElement('div', null, 'pop-body'), 'aria-label': '详情',
      trigger: createElement('button', null, 'trig'),
    }))
    expect(out).toContain('pop-body')
    expect(out).toContain('dsh-popover')
  })
})

describe('layout primitives', () => {
  it('Flex maps direction/gap/align to data attributes', () => {
    const out = html(createElement(Flex, {
      direction: 'column', gap: '3', align: 'center', p: '2',
    }, 'row'))
    expect(out).toContain('dsh-flex')
    expect(out).toContain('data-direction="column"')
    expect(out).toContain('data-gap="3"')
    expect(out).toContain('data-align="center"')
    expect(out).toContain('data-p="2"')
  })

  it('Box honours the as tag and min-width escape hatch', () => {
    const out = html(createElement(Box, { as: 'section', minWidth: '0' }, 'box'))
    expect(out).toContain('<section')
    expect(out).toContain('data-min-width="0"')
  })

  it('Separator renders role=separator with orientation', () => {
    const out = html(createElement(Separator, { orientation: 'vertical' }))
    expect(out).toContain('role="separator"')
    expect(out).toContain('aria-orientation="vertical"')
  })

  it('ScrollArea marks the scroll axis and keeps overflow styles in css', () => {
    const out = html(createElement(ScrollArea, { scrollbars: 'vertical' }, 'content'))
    expect(out).toContain('dsh-scroll-area')
    expect(out).toContain('data-scrollbars="vertical"')
    expect(out).toContain('content')
  })
})

describe('typography and card primitives', () => {
  it('Text maps Radix color names to semantic tones and numeric sizes to the scale', () => {
    const out = html(createElement(Text, { color: 'gray', size: '2', weight: 'medium' }, 'meta'))
    expect(out).toContain('dsh-text')
    expect(out).toContain('data-tone="muted"')
    expect(out).toContain('data-size="base"')
    expect(out).toContain('data-weight="medium"')
  })

  it('Text passes htmlFor through when rendered as label', () => {
    const out = html(createElement(Text, { as: 'label', htmlFor: 'f1' }, '标签'))
    expect(out).toContain('<label')
    expect(out).toContain('for="f1"')
  })

  it('Heading renders the requested level', () => {
    const out = html(createElement(Heading, { as: 'h3', size: '4' }, '章标题'))
    expect(out).toContain('<h3')
    expect(out).toContain('data-size="lg"')
    expect(out).toContain('章标题')
  })

  it('Card renders a flat surface with a Radix-compatible size scale', () => {
    const out = html(createElement(Card, { size: '1' }, '卡片'))
    expect(out).toContain('dsh-card')
    expect(out).toContain('data-size="1"')
  })

  it('DataList renders semantic dl/dt/dd', () => {
    const out = html(createElement(DataList.Root, null,
      createElement(DataList.Item, null,
        createElement(DataList.Label, null, '字数'),
        createElement(DataList.Value, null, '2.1k'))))
    expect(out).toContain('<dl')
    expect(out).toContain('<dt')
    expect(out).toContain('<dd')
    expect(out).toContain('字数')
    expect(out).toContain('2.1k')
  })

  it('Progress exposes progressbar semantics and clamps value', () => {
    const out = html(createElement(Progress, { 'aria-label': '导出进度', value: 40, max: 100 }))
    expect(out).toContain('role="progressbar"')
    expect(out).toContain('aria-valuenow="40"')
    expect(out).toContain('data-state="determinate"')
    const indeterminate = html(createElement(Progress, { 'aria-label': '加载' }))
    expect(indeterminate).toContain('data-state="indeterminate"')
  })
})

describe('tabs and disclosure', () => {
  it('Tabs renders tablist with active state and panels', () => {
    const out = html(createElement(Tabs, { value: 't2' },
      createElement(TabList, null,
        createElement(Tab, { value: 't1' }, '一'),
        createElement(Tab, { value: 't2' }, '二')),
      createElement(TabPanel, { value: 't1' }, createElement('p', null, 'c1')),
      createElement(TabPanel, { value: 't2' }, createElement('p', null, 'c2'))))
    expect(out).toContain('role="tablist"')
    expect(out).toContain('role="tab"')
    expect(out).toContain('aria-selected="true"')
    expect(out).toContain('c2')
  })

  it('Disclosure renders trigger with chevron and content', () => {
    const out = html(createElement(Disclosure, {
      open: true, summary: '高级信息',
    }, createElement('p', null, 'inner')))
    expect(out).toContain('aria-expanded="true"')
    expect(out).toContain('高级信息')
    expect(out).toContain('inner')
  })
})
