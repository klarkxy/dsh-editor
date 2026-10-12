# model

这里存放从 `client/*.tsx` 抽出的纯逻辑：类型、常量、纯函数与其私有辅助。
本目录文件不得 import React 或任何 `.tsx` 文件；需要 React、JSX 或 hook 的代码留在原 `.tsx`。
组件文件按需从本目录 import；只有包外仍在使用的符号才从原 `.tsx` 继续 re-export。
