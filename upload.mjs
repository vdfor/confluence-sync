#!/usr/bin/env node
/**
 * Confluence 文档同步 CLI
 *
 * 环境变量：
 *   CONFLUENCE_BASE_URL           - Confluence 服务地址
 *   认证方式（二选一）：
 *     方式1 PAT： CONFLUENCE_PAT  - Personal Access Token
 *     方式2 Auth： CONFLUENCE_USERNAME + CONFLUENCE_API_TOKEN
 *
 * 用法：
 *   confluence-sync upload      --file <path> --parent <页面ID> [--title <标题>] [--dry-run] [--no-mermaid-to-img]
 *   confluence-sync update      --file <path> --page-id <ID> [--minor-edit] [--no-mermaid-to-img]
 *   confluence-sync upload-file --page-id <ID> --file <path> [--name <文件名>]
 *   confluence-sync list-pages  --parent <页面ID>
 *   confluence-sync list-files  --page-id <ID>
 *   confluence-sync get-content --page-id <ID> [--markdown]
 *
 * 可选配置参数（优先于环境变量）：
 *   --base-url    Confluence 服务地址
 *   --pat         Personal Access Token
 *   --username    Confluence 登录名
 *   --api-token   API Token 或密码
 */

import {
  uploadMarkdown,
  updateMarkdown,
  uploadAttachment,
  listChildPages,
  listAttachments,
  getPageById,
  getPageContent,
  confluenceToMd,
  getBaseUrl,
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
  list-pages    列出 parent 页面下的子页面
  list-files    列出页面的所有附件
  get-content   获取页面的 HTML 内容

upload 选项:
  --file        本地 .md 文件路径（必填）
  --parent      父页面 ID（数字，必填）
  --title       页面标题（默认取文件名）
  --dry-run     仅打印转换结果，不实际上传
  --no-mermaid-to-img  禁用 Mermaid 图表自动渲染

update 选项:
  --file        本地 .md 文件路径（必填）
  --page-id     目标页面 ID（数字，必填）
  --minor-edit  标记为小修改（不通知关注者）
  --no-mermaid-to-img  禁用 Mermaid 图表自动渲染

upload-file 选项:
  --page-id     目标页面 ID（必填）
  --file        本地文件路径（必填）
  --name        覆盖文件名

list-pages 选项:
  --parent      父页面 ID（数字，必填）

list-files 选项:
  --page-id     页面 ID（必填）

get-content 选项:
  --page-id     页面 ID（必填）
  --markdown    输出为 Markdown 格式

配置参数（优先于环境变量）:
  --base-url    Confluence 服务地址
  --pat         Personal Access Token
  --username    Confluence 登录名
  --api-token   API Token 或密码

环境变量:
  CONFLUENCE_BASE_URL   Confluence 服务地址
  认证方式（二选一）:
    CONFLUENCE_PAT              Personal Access Token
    CONFLUENCE_USERNAME + CONFLUENCE_API_TOKEN  Basic Auth

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
    pat: args['pat'],
    username: args['username'],
    apiToken: args['api-token'],
  });
  const baseUrl = getBaseUrl();

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
          parentId: args.parent,
          dryRun: args['dry-run'] === true,
          mermaid: args['no-mermaid-to-img'] !== true,
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
        if (!args['page-id']) {
          console.error('错误：--page-id 必填');
          process.exit(1);
        }
        const result = await updateMarkdown({
          pageId: args['page-id'],
          filePath: args.file,
          minorEdit: args['minor-edit'] === true,
          mermaid: args['no-mermaid-to-img'] !== true,
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
        if (!args.parent || !/^\d+$/.test(args.parent)) {
          console.error('错误：--parent <数字页面ID> 必填');
          process.exit(1);
        }
        const parentPage = await getPageById(args.parent);
        console.log(`父页面：${parentPage.title} (ID: ${parentPage.id}, Space: ${parentPage.space?.key})\n`);
        const pages = await listChildPages(parentPage.id);
        if (!pages.length) {
          console.log('  （无子页面）');
        } else {
          const maxId = Math.max(...pages.map(p => String(p.id).length));
          for (const p of pages) {
            const id = String(p.id).padEnd(maxId);
            console.log(`  ${id}  v${p.version?.number ?? '?'}  ${p.title}`);
          }
          console.log(`\n共 ${pages.length} 个子页面`);
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
