#!/usr/bin/env node
/**
 * Confluence 文档同步 CLI
 *
 * 环境变量（或通过 CLI 参数配置）：
 *   必填：             CONFLUENCE_BASE_URL   - Confluence 服务地址
 *                      CONFLUENCE_SPACE_KEY  - Space Key
 * 认证方式（二选一）：
 *   方式1 PAT：        CONFLUENCE_PAT       - Personal Access Token
 * 方式2 Basic Auth： CONFLUENCE_USERNAME   - Confluence 登录名（工号）
 *                      CONFLUENCE_API_TOKEN  - API Token 或密码
 *
 * 用法：
 *   confluence-sync upload   --file <path> [--title <标题>] [--space <key>] [--parent <ID或标题>] [--dry-run]
 *   confluence-sync update   --file <path> (--page-id <ID> | --title <标题>) [--space <key>] [--minor-edit]
 *   confluence-sync upload-file --page-id <ID> --file <path> [--name <文件名>]
 *   confluence-sync list-pages [--space <key>]
 *   confluence-sync list-files --page-id <ID>
 *   confluence-sync get-content --page-id <ID> [--markdown]
 *
 * 可选配置参数（优先于环境变量）：
 *   --base-url        Confluence 服务地址
 *   --space-key       Space Key
 *   --pat             Personal Access Token
 *   --username        Confluence 登录名
 *   --api-token       API Token 或密码
 */

import {
  uploadMarkdown,
  updateMarkdown,
  uploadAttachment,
  listPages,
  listAttachments,
  getPageContent,
  confluenceToMd,
  getBaseUrl,
  getSpaceKey,
  configure,
} from './src/confluence.mjs';

// ── 参数解析 ──────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = argv.slice(2);
  const command = args[0];
  const opts = {};

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (!next || next.startsWith('--')) {
        opts[key] = true;
      } else {
        opts[key] = next;
        i++;
      }
    }
  }
  return { command, ...opts };
}

function printUsage() {
  console.log(`
Confluence 文档同步工具

用法:
  confluence-sync <命令> [选项]

命令:
  upload        上传 Markdown 文件为新页面（已存在则更新）
  update        更新已有页面内容
  upload-file   上传文件作为页面附件
  list-pages    列出 space 下所有页面
  list-files    列出页面的所有附件
  get-content   获取页面的 HTML 内容

upload 选项:
  --file        本地 .md 文件路径（必填）
  --title       页面标题（默认取文件名）
  --space       Space Key（默认读 config.json）
  --parent      父页面 ID 或标题
  --dry-run     仅打印转换结果，不实际上传

update 选项:
  --file        本地 .md 文件路径（必填）
  --page-id     目标页面 ID
  --title       按标题查找目标页面（与 --page-id 二选一）
  --space       Space Key（默认读 config.json）
  --minor-edit  标记为小修改（不通知关注者）

upload-file 选项:
  --page-id     目标页面 ID（必填）
  --file        本地文件路径（必填）
  --name        覆盖文件名

list-pages 选项:
  --space       Space Key（默认读 config.json）

list-files 选项:
  --page-id     页面 ID（必填）

get-content 选项:
  --page-id     页面 ID（必填）
  --markdown    输出为 Markdown 格式（默认输出 Storage HTML）

配置参数（优先于环境变量）:
  --base-url        Confluence 服务地址
  --space-key       Space Key
  --pat             Personal Access Token
  --username        Confluence 登录名
  --api-token       API Token 或密码

环境变量:
  必填:
    CONFLUENCE_BASE_URL   Confluence 服务地址
    CONFLUENCE_SPACE_KEY  Space Key

  认证方式（二选一）:
    方式1 - Personal Access Token:
      CONFLUENCE_PAT        个人访问令牌

    方式2 - Basic Auth:
      CONFLUENCE_USERNAME   Confluence 登录名（工号）
      CONFLUENCE_API_TOKEN  API Token 或密码

`);
}

// ── 命令处理 ──────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv);
  const { command } = args;

  if (!command || command === 'help' || command === '--help') {
    printUsage();
    process.exit(0);
  }

  // 用 CLI 参数覆盖环境变量配置
  configure({
    baseUrl: args['base-url'],
    spaceKey: args['space-key'],
    pat: args['pat'],
    username: args['username'],
    apiToken: args['api-token'],
  });
  const baseUrl = getBaseUrl();
  const spaceKey = getSpaceKey();

  try {
    switch (command) {
      case 'upload': {
        if (!args.file) {
          console.error('错误：--file 必填');
          process.exit(1);
        }
        const result = await uploadMarkdown({
          filePath: args.file,
          title: args.title,
          spaceKey: args.space || spaceKey,
          parentId: args.parent,
          dryRun: args['dry-run'] === true,
        });
        if (result) {
          console.log('\n页面信息：');
          console.log(`  ID:      ${result.id}`);
          console.log(`  标题:    ${result.title}`);
          console.log(`  版本:    ${result.version?.number}`);
          console.log(`  链接:    ${baseUrl}/pages/viewpage.action?pageId=${result.id}`);
        }
        break;
      }

      case 'update': {
        if (!args.file) {
          console.error('错误：--file 必填');
          process.exit(1);
        }
        if (!args['page-id'] && !args.title) {
          console.error('错误：必须指定 --page-id 或 --title');
          process.exit(1);
        }
        const result = await updateMarkdown({
          pageId: args['page-id'],
          title: args.title,
          filePath: args.file,
          spaceKey: args.space || spaceKey,
          minorEdit: args['minor-edit'] === true,
        });
        console.log('\n页面信息：');
        console.log(`  ID:      ${result.id}`);
        console.log(`  标题:    ${result.title}`);
        console.log(`  版本:    ${result.version?.number}`);
        break;
      }

      case 'upload-file': {
        if (!args['page-id'] || !args.file) {
          console.error('错误：--page-id 和 --file 必填');
          process.exit(1);
        }
        console.log(`正在上传附件到页面 ${args['page-id']}…`);
        const result = await uploadAttachment(args['page-id'], args.file, args.name);
        const attached = result.results?.[0];
        console.log(`  ✅ 上传完成`);
        if (attached) {
          console.log(`  文件名:  ${attached.title}`);
          console.log(`  ID:      ${attached.id}`);
          console.log(`  链接:    ${baseUrl}${attached._links?.download}`);
        }
        break;
      }

      case 'list-pages': {
        const space = args.space || spaceKey;
        console.log(`Space: ${space}\n`);
        const pages = await listPages(space);
        if (!pages.length) {
          console.log('  （无页面）');
        } else {
          const maxId = Math.max(...pages.map(p => String(p.id).length));
          for (const p of pages) {
            const id = String(p.id).padEnd(maxId);
            console.log(`  ${id}  v${p.version?.number ?? '?'}  ${p.title}`);
          }
          console.log(`\n共 ${pages.length} 个页面`);
        }
        break;
      }

      case 'list-files': {
        if (!args['page-id']) {
          console.error('错误：--page-id 必填');
          process.exit(1);
        }
        console.log(`页面 ${args['page-id']} 的附件：\n`);
        const files = await listAttachments(args['page-id']);
        if (!files.length) {
          console.log('  （无附件）');
        } else {
          for (const f of files) {
            const mediaType = f.metadata?.mediaType || 'unknown';
            console.log(`  ${f.title}  (${mediaType})  ID: ${f.id}`);
          }
          console.log(`\n共 ${files.length} 个附件`);
        }
        break;
      }

      case 'get-content': {
        if (!args['page-id']) {
          console.error('错误：--page-id 必填');
          process.exit(1);
        }
        const page = await getPageContent(args['page-id']);
        console.log(`标题:    ${page.title}`);
        console.log(`Space:   ${page.space?.key}`);
        console.log(`版本:    ${page.version?.number}`);
        if (args.markdown) {
          console.log(`\n── Markdown ──────────────────────────────\n`);
          console.log(confluenceToMd(page.body.storage.value));
        } else {
          console.log(`\n── Storage HTML ──────────────────────────────\n`);
          console.log(page.body.storage.value);
        }
        break;
      }

      default:
        console.error(`未知命令：${command}`);
        printUsage();
        process.exit(1);
    }
  } catch (err) {
    console.error(`\n❌ 执行失败：${err.message}`);
    process.exit(1);
  }
}

main();
