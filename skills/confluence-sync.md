---
name: "confluence-sync"
description: "Confluence 文档同步 CLI 工具，支持将本地 Markdown 文件上传至 Confluence 并自动转换为 Confluence 页面格式，支持 Mermaid 图表自动渲染。当用户需要上传、更新、获取 Confluence 页面内容或管理附件时调用。"
---

# Confluence Sync

Confluence 文档同步 CLI 工具，支持将本地 Markdown 文件上传至 Confluence 并自动转换为 Confluence 页面格式。支持 Mermaid 图表自动渲染为图片。

## 功能特性

- 上传 Markdown 文件为 Confluence 页面（已存在同名页面则自动更新）
- 更新已有页面内容
- 上传文件作为页面附件
- 列出 parent 下的子页面
- 列出页面附件
- 获取页面内容（支持转换为 Markdown 格式）
- Mermaid 图表自动渲染为 PNG 图片

## 配置要求

使用前需要配置以下环境变量或 CLI 参数：

- `CONFLUENCE_BASE_URL`: Confluence 服务地址
- 认证方式（二选一）：
  - `CONFLUENCE_PAT`: Personal Access Token（推荐）
  - `CONFLUENCE_USERNAME` + `CONFLUENCE_API_TOKEN`: Basic Auth 认证

## 命令列表

### upload - 上传 Markdown 为新页面（已存在同名页面则自动更新）

```bash
confluence-sync upload --file <path> --parent <页面ID> [--title <标题>] [--dry-run] [--no-mermaid-to-img]
```

### update - 更新已有页面

```bash
confluence-sync update --file <path> --page-id <ID> [--minor-edit] [--no-mermaid-to-img]
```

### upload-file - 上传附件

```bash
confluence-sync upload-file --page-id <ID> --file <path> [--name <文件名>]
```

### list-pages - 列出 parent 下的子页面

```bash
confluence-sync list-pages --parent <页面ID>
```

### list-files - 列出页面附件

```bash
confluence-sync list-files --page-id <ID>
```

### get-content - 获取页面内容

```bash
confluence-sync get-content --page-id <ID> [--markdown]
```

使用 `--markdown` 参数可将 Confluence 内容转换为 Markdown 格式输出。

## Mermaid 支持

Markdown 中的 ```` ```mermaid ```` 代码块自动通过 sebastianjs 渲染为 PNG 图片（本地离线渲染，无需外网、无需浏览器），作为附件上传。默认开启，使用 `--no-mermaid-to-img` 可禁用。渲染失败时保留原始代码块，不阻塞上传。

## 使用示例

```bash
# 上传（--parent 必填，已存在同名子页面则自动更新）
confluence-sync upload --file README.md --title "项目文档" --parent 27263539

# 更新（--page-id 必填）
confluence-sync update --file README.md --page-id 123456

# 列出 parent 下的子页面
confluence-sync list-pages --parent 27263539

# 上传附件
confluence-sync upload-file --page-id 123456 --file image.png

# 获取页面内容
confluence-sync get-content --page-id 123456 --markdown
```

## 注意事项

1. 使用前请确保已正确配置认证信息
2. Personal Access Token 需要在 Confluence 个人设置中生成
3. 上传附件时，如果附件已存在会自动更新
4. 使用 `--dry-run` 参数可以预览转换结果而不实际上传
