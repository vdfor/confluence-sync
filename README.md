# @vdfor/confluence-sync

Confluence 文档同步 CLI 工具，支持将本地 Markdown 文件上传至 Confluence 并自动转换为 Confluence 页面格式。

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
# 必填：Confluence 服务地址
export CONFLUENCE_BASE_URL="https://your-confluence-instance.com"

# 必填：Space Key
export CONFLUENCE_SPACE_KEY="YOUR_SPACE_KEY"

# 认证方式（二选一）
# 方式1（推荐）：Personal Access Token
export CONFLUENCE_PAT="your-personal-access-token"

# 方式2：Basic Auth
export CONFLUENCE_USERNAME="your-username"
export CONFLUENCE_API_TOKEN="your-api-token"
```

### 方式2：CLI 参数（优先于环境变量）

```bash
confluence-sync upload --file test.md \
  --base-url https://your-confluence-instance.com \
  --space-key YOUR_SPACE_KEY \
  --pat your-token
```

## 命令

### upload - 上传 Markdown 为新页面

```bash
confluence-sync upload --file <path> [--title <标题>] [--space <key>] [--parent <ID或标题>] [--dry-run]
```

### update - 更新已有页面

```bash
confluence-sync update --file <path> (--page-id <ID> | --title <标题>) [--space <key>] [--minor-edit]
```

### upload-file - 上传附件

```bash
confluence-sync upload-file --page-id <ID> --file <path> [--name <文件名>]
```

### list-pages - 列出空间页面

```bash
confluence-sync list-pages [--space <key>]
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

## 配置参数

| 参数 | 说明 |
|------|------|
| `--base-url` | Confluence 服务地址 |
| `--space-key` | Space Key |
| `--pat` | Personal Access Token |
| `--username` | Confluence 登录名 |
| `--api-token` | API Token 或密码 |
| `--space` | Space Key（覆盖默认值） |
| `--file` | 本地文件路径 |
| `--title` | 页面标题 |
| `--page-id` | 页面 ID |
| `--parent` | 父页面 ID 或标题 |
| `--dry-run` | 仅打印转换结果，不实际上传 |
| `--minor-edit` | 标记为小修改（不通知关注者） |
| `--markdown` | get-content 时输出为 Markdown 格式 |

## 示例

```bash
# 上传 Markdown 文件
confluence-sync upload --file README.md --title "项目文档" --space MYSPACE

# 更新已有页面
confluence-sync update --file README.md --page-id 123456

# 上传附件
confluence-sync upload-file --page-id 123456 --file image.png

# 列出空间所有页面
confluence-sync list-pages --space MYSPACE

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
confluence-sync upload --file README.md --title "项目文档" --space MYSPACE
confluence-sync get-content --page-id 123456 --markdown
```

## License

MIT
