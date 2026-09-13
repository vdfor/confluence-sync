# @vdfor/confluence-sync

Confluence 文档同步 CLI 工具，支持将本地 Markdown 文件上传至 Confluence 并自动转换为 Confluence 页面格式。支持 Mermaid 图表自动渲染为图片。

## 安装

```bash
# pnpm
pnpm add -g @vdfor/confluence-sync

# npm
npm install -g @vdfor/confluence-sync

# yarn
yarn global add @vdfor/confluence-sync
```

## 配置

### 方式1：环境变量

```bash
# Confluence 服务地址
export CONFLUENCE_BASE_URL="https://your-confluence-instance.com"

# 认证方式（二选一）
# 方式1（推荐）：Personal Access Token
export CONFLUENCE_PAT="your-personal-access-token"

# 方式2：Basic Auth
export CONFLUENCE_USERNAME="your-username"
export CONFLUENCE_API_TOKEN="your-api-token"
```

### 方式2：CLI 参数（优先于环境变量）

```bash
confluence-sync upload --file test.md --parent 123456 \
  --base-url https://your-confluence-instance.com \
  --pat your-token
```

## 命令

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

## Mermaid 图表支持

Markdown 中的 ```` ```mermaid ```` 代码块会自动通过 [sebastianjs](https://github.com/creadri/sebastianjs) 渲染为 PNG 图片（本地离线渲染，无需外网、无需浏览器），上传后页面中显示为图片附件。

- 默认自动检测并转换，无 Mermaid 块时不影响正常流程
- Mermaid 渲染失败时保留原始代码块（降级处理，不阻塞上传）
- 使用 `--no-mermaid-to-img` 可禁用自动渲染

```bash
# 自动处理 mermaid（默认开启）
confluence-sync upload --file README.md --parent 27263539

# 禁用 mermaid 渲染
confluence-sync upload --file README.md --parent 27263539 --no-mermaid-to-img
```

## 配置参数

| 参数 | 说明 |
|------|------|
| `--base-url` | Confluence 服务地址（覆盖环境变量） |
| `--pat` | Personal Access Token（覆盖环境变量） |
| `--username` | Confluence 登录名（覆盖环境变量） |
| `--api-token` | API Token 或密码（覆盖环境变量） |
| `--file` | 本地文件路径 |
| `--title` | 页面标题（upload 时可选，默认取文件名） |
| `--parent` | 父页面 ID（数字，upload / list-pages 必填） |
| `--page-id` | 页面 ID（update / upload-file / list-files / get-content 必填） |
| `--dry-run` | 仅打印转换结果，不实际上传 |
| `--minor-edit` | 标记为小修改（不通知关注者） |
| `--markdown` | get-content 时输出为 Markdown 格式 |
| `--no-mermaid-to-img` | 禁用 Mermaid 图表自动渲染 |

## 示例

```bash
# 上传 Markdown 文件（自动按 title 匹配 parent 下已有页面则更新）
confluence-sync upload --file README.md --title "项目文档" --parent 27263539

# 更新已有页面
confluence-sync update --file README.md --page-id 123456

# 上传附件
confluence-sync upload-file --page-id 123456 --file image.png

# 列出 parent 下的子页面
confluence-sync list-pages --parent 27263539

# 获取页面内容
confluence-sync get-content --page-id 123456

# 获取页面内容并转换为 Markdown
confluence-sync get-content --page-id 123456 --markdown
```

## Skill 集成

本项目包含 Trae Skill，安装后可被智能体调用。

### 安装

```bash
pnpm add -g @vdfor/confluence-sync
```

### 使用

安装后，智能体可直接调用 `confluence-sync` 命令：

```bash
confluence-sync upload --file README.md --title "项目文档" --parent 27263539
confluence-sync update --file README.md --page-id 123456
confluence-sync get-content --page-id 123456 --markdown
```

## License

MIT
