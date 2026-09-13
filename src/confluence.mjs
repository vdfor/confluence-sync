import axios from 'axios';
import { marked } from 'marked';
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';

// ── 配置 ──────────────────────────────────────────────────────────────────────
const config = JSON.parse(readFileSync(new URL('../config.json', import.meta.url), 'utf-8'));
const { spaceKey: defaultSpaceKey } = config;

let baseUrl = process.env.CONFLUENCE_BASE_URL;
let pat = process.env.CONFLUENCE_PAT;
let username = process.env.CONFLUENCE_USERNAME;
let apiToken = process.env.CONFLUENCE_API_TOKEN;
let api;

/**
 * 用 CLI 参数覆盖环境变量配置，需在其他函数调用前执行
 * @param {object} [opts]
 * @param {string} [opts.baseUrl]
 * @param {string} [opts.pat]
 * @param {string} [opts.username]
 * @param {string} [opts.apiToken]
 */
export function configure(opts = {}) {
  if (opts.baseUrl) baseUrl = opts.baseUrl;
  if (opts.pat) pat = opts.pat;
  if (opts.username) username = opts.username;
  if (opts.apiToken) apiToken = opts.apiToken;
}

function ensureApi() {
  if (api) return;

  if (!baseUrl) {
    console.error('请设置环境变量 CONFLUENCE_BASE_URL 或使用 --base-url 参数');
    console.error('  export CONFLUENCE_BASE_URL="https://your-confluence-instance.com"');
    process.exit(1);
  }

  if (!pat && (!username || !apiToken)) {
    console.error('请设置认证信息（二选一）：');
    console.error('  方式1 PAT：        export CONFLUENCE_PAT="your-personal-access-token"');
    console.error('  方式2 Basic Auth： export CONFLUENCE_USERNAME="your-username" CONFLUENCE_API_TOKEN="your-token"');
    process.exit(1);
  }

  const authHeaders = pat ? { Authorization: `Bearer ${pat}` } : {};
  api = axios.create({
    baseURL: `${baseUrl}/rest/api`,
    ...(pat ? {} : { auth: { username, password: apiToken } }),
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    timeout: 30000,
  });
}

function logAxiosError(err) {
  const status = err.response?.status;
  const data = err.response?.data;
  if (status) console.error(`  HTTP ${status}:`, typeof data === 'string' ? data : JSON.stringify(data, null, 2));
}

// ── 页面查询 ──────────────────────────────────────────────────────────────────

/**
 * 按 ID 获取页面元信息（含版本号）
 */
export async function getPageById(id) {
  ensureApi();
  const { data } = await api.get(`/content/${id}`, {
    params: { expand: 'version,ancestors' },
  });
  return data;
}

/**
 * 按 spaceKey + title 获取页面（仅返回第一个匹配）
 */
export async function getPageByTitle(spaceKey, title) {
  ensureApi();
  const { data } = await api.get('/content', {
    params: {
      spaceKey,
      title,
      expand: 'version',
      limit: 1,
    },
  });
  return data.results?.[0] || null;
}

/**
 * 列出 space 下所有页面（分页）
 */
export async function listPages(spaceKey, limit = 25) {
  ensureApi();
  const { data } = await api.get('/content', {
    params: {
      spaceKey,
      type: 'page',
      expand: 'version',
      limit,
    },
  });
  return data.results;
}

/**
 * 获取页面 body.storage
 */
export async function getPageContent(id) {
  ensureApi();
  const { data } = await api.get(`/content/${id}`, {
    params: { expand: 'body.storage' },
  });
  return data;
}

// ── 页面创建 / 更新 ───────────────────────────────────────────────────────────

/**
 * 创建新页面
 */
export async function createPage(spaceKey, title, bodyHtml, parentId) {
  ensureApi();
  const payload = {
    type: 'page',
    title,
    space: { key: spaceKey },
    body: { storage: { value: bodyHtml, representation: 'storage' } },
  };
  if (parentId) {
    payload.ancestors = [{ id: parentId }];
  }
  try {
    const { data } = await api.post('/content', payload);
    return data;
  } catch (err) {
    console.error('创建页面失败：');
    logAxiosError(err);
    throw err;
  }
}

/**
 * 更新已有页面（需要传入当前版本号，自动 +1）
 */
export async function updatePage(id, title, bodyHtml, currentVersion, minorEdit = false) {
  ensureApi();
  const payload = {
    id,
    type: 'page',
    title,
    body: { storage: { value: bodyHtml, representation: 'storage' } },
    version: { number: currentVersion + 1, minorEdit },
  };
  try {
    const { data } = await api.put(`/content/${id}`, payload);
    return data;
  } catch (err) {
    console.error('更新页面失败：');
    logAxiosError(err);
    throw err;
  }
}

// ── Markdown → Confluence Storage Format ───────────────────────────────────────

/**
 * 将 Markdown 文本转换为 Confluence storage format（XHTML）
 * 使用 marked 词法分析器遍历 token 树，支持嵌套列表
 */
export function mdToConfluence(md) {
  const tokens = marked.lexer(md);

  function renderTokens(toks, listDepth = 0) {
    let out = '';
    for (const tok of toks) {
      switch (tok.type) {
        case 'heading':
          out += `<h${tok.depth}>${renderInline(tok.tokens)}</h${tok.depth}>`;
          break;
        case 'paragraph':
          out += `<p>${renderInline(tok.tokens)}</p>`;
          break;
        case 'code':
          out += `<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">${tok.lang || 'text'}</ac:parameter><ac:plain-text-body><![CDATA[${tok.text}]]></ac:plain-text-body></ac:structured-macro>`;
          break;
        case 'blockquote':
          out += `<blockquote>${renderTokens(tok.tokens, listDepth)}</blockquote>`;
          break;
        case 'list': {
          const tag = tok.ordered ? 'ol' : 'ul';
          out += `<${tag}>`;
          for (const item of tok.items) {
            out += `<li>${renderTokens(item.tokens, listDepth + 1)}</li>`;
          }
          out += `</${tag}>`;
          break;
        }
        case 'table': {
          out += '<table>';
          out += '<thead><tr>';
          for (const cell of tok.header) {
            const align = cell.align ? ` style="text-align:${cell.align}"` : '';
            out += `<th${align}>${renderInline(cell.tokens)}</th>`;
          }
          out += '</tr></thead><tbody>';
          for (const row of tok.rows) {
            out += '<tr>';
            for (const cell of row) {
              const align = cell.align ? ` style="text-align:${cell.align}"` : '';
              out += `<td${align}>${renderInline(cell.tokens)}</td>`;
            }
            out += '</tr>';
          }
          out += '</tbody></table>';
          break;
        }
        case 'hr':
          out += '<hr/>';
          break;
        case 'space':
          break;
        default:
          if (tok.tokens) out += renderTokens(tok.tokens, listDepth);
          else if (tok.text) out += tok.text;
      }
    }
    return out;
  }

  function renderInline(toks) {
    if (!toks) return '';
    let out = '';
    for (const tok of toks) {
      switch (tok.type) {
        case 'text':
          out += tok.tokens ? renderInline(tok.tokens) : tok.text;
          break;
        case 'strong':
          out += `<strong>${renderInline(tok.tokens)}</strong>`;
          break;
        case 'em':
          out += `<em>${renderInline(tok.tokens)}</em>`;
          break;
        case 'codespan':
          out += `<code>${tok.text}</code>`;
          break;
        case 'del':
          out += `<s>${renderInline(tok.tokens)}</s>`;
          break;
        case 'link':
          out += `<a href="${tok.href}">${renderInline(tok.tokens)}</a>`;
          break;
        case 'image':
          out += `<ac:image><ri:attachment ri:filename="${tok.href}" /></ac:image>`;
          break;
        case 'br':
          out += '<br/>';
          break;
        case 'escape':
          out += tok.text;
          break;
        default:
          out += tok.text || '';
      }
    }
    return out;
  }

  return renderTokens(tokens);
}

// ── 文件上传（附件）────────────────────────────────────────────────────────────

/**
 * 上传文件为页面附件
 * @param {string} pageId - 目标页面 ID
 * @param {string} filePath - 本地文件路径
 * @param {string} [fileName] - 可选覆盖文件名
 */
export async function uploadAttachment(pageId, filePath, fileName) {
  ensureApi();
  const FormData = (await import('form-data')).default;
  const fs = await import('node:fs');
  const path = await import('node:path');

  const name = fileName || path.basename(filePath);
  const form = new FormData();
  form.append('file', fs.createReadStream(filePath), name);

  try {
    const { data } = await api.post(`/content/${pageId}/child/attachment`, form, {
      headers: {
        ...form.getHeaders(),
        'X-Atlassian-Token': 'no-check',
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });
    return data;
  } catch (err) {
    // 如果附件已存在，改为更新
    if (err.response?.status === 400 || err.response?.status === 409) {
      console.log(`  附件 ${name} 已存在，尝试更新…`);
      return updateAttachment(pageId, filePath, name);
    }
    console.error('上传附件失败：');
    logAxiosError(err);
    throw err;
  }
}

/**
 * 更新已有附件（按文件名匹配）
 */
async function updateAttachment(pageId, filePath, fileName) {
  ensureApi();
  const FormData = (await import('form-data')).default;
  const fs = await import('node:fs');
  const { data: existing } = await api.get(`/content/${pageId}/child/attachment`, {
    params: { filename: fileName },
  });
  const match = existing.results?.find(r => r.title === fileName);
  if (!match) throw new Error(`未找到附件 ${fileName}`);
  const form = new FormData();
  form.append('file', fs.createReadStream(filePath), fileName);
  const { data } = await api.post(
    `/content/${pageId}/child/attachment/${match.id}/data`,
    form,
    {
      headers: {
        ...form.getHeaders(),
        'X-Atlassian-Token': 'no-check',
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    },
  );
  return data;
}

/**
 * 列出页面的所有附件
 */
export async function listAttachments(pageId) {
  ensureApi();
  const { data } = await api.get(`/content/${pageId}/child/attachment`);
  return data.results;
}

// ── 高级业务流程 ──────────────────────────────────────────────────────────────

/**
 * 查找父页面 ID（支持按 title 或直接 ID）
 */
async function resolveParentId(parentIdentifier, spaceKey) {
  if (!parentIdentifier) return null;
  // 如果是纯数字，当作 ID
  if (/^\d+$/.test(parentIdentifier)) {
    const page = await getPageById(parentIdentifier);
    console.log(`  父页面：${page.title} (ID: ${page.id})`);
    return page.id;
  }
  // 否则按 title 查找
  const page = await getPageByTitle(spaceKey, parentIdentifier);
  if (!page) {
    throw new Error(`未找到父页面「${parentIdentifier}」（space: ${spaceKey}）`);
  }
  console.log(`  父页面：${page.title} (ID: ${page.id})`);
  return page.id;
}

/**
 * 上传 Markdown 文件到 Confluence
 * @param {object} opts
 * @param {string} opts.filePath - 本地 .md 文件路径
 * @param {string} [opts.title] - 页面标题（默认取文件名）
 * @param {string} [opts.spaceKey] - space key
 * @param {string} [opts.parentId] - 父页面 ID 或标题
 * @param {boolean} [opts.dryRun] - 仅打印转换结果
 */
export async function uploadMarkdown(opts) {
  const { filePath, title: optTitle, spaceKey = defaultSpaceKey, parentId: parentRaw, dryRun = false } = opts;
  const fs = await import('node:fs');
  const path = await import('node:path');

  const md = fs.readFileSync(filePath, 'utf-8');
  const title = optTitle || path.basename(filePath, extname(filePath));
  const bodyHtml = mdToConfluence(md);

  if (dryRun) {
    console.log('── 转换结果（dry-run）────────────────────────');
    console.log(`  标题: ${title}`);
    console.log(`  Space: ${spaceKey}`);
    console.log('  Body:\n' + bodyHtml);
    return null;
  }

  // 查找父页面
  const parentId = await resolveParentId(parentRaw, spaceKey);

  // 检查是否已存在同名页面
  const existing = await getPageByTitle(spaceKey, title);
  if (existing) {
    console.log(`  页面「${title}」已存在 (ID: ${existing.id})，将更新…`);
    const updated = await updatePage(existing.id, title, bodyHtml, existing.version.number);
    console.log(`  ✅ 更新完成 → ${baseUrl}/pages/viewpage.action?pageId=${updated.id}`);
    return updated;
  }

  const page = await createPage(spaceKey, title, bodyHtml, parentId);
  console.log(`  ✅ 创建完成 → ${baseUrl}/pages/viewpage.action?pageId=${page.id}`);
  return page;
}

/**
 * 更新指定页面（通过 ID 或 space+title 查找）
 */
export async function updateMarkdown(opts) {
  const { pageId, title: searchTitle, filePath, spaceKey = defaultSpaceKey, minorEdit = false } = opts;
  const fs = await import('node:fs');

  const md = fs.readFileSync(filePath, 'utf-8');
  const bodyHtml = mdToConfluence(md);

  let page;
  if (pageId) {
    page = await getPageById(pageId);
  } else if (searchTitle) {
    page = await getPageByTitle(spaceKey, searchTitle);
    if (!page) throw new Error(`未找到页面「${searchTitle}」（space: ${spaceKey}）`);
  } else {
    throw new Error('必须指定 --page-id 或 --title 来定位目标页面');
  }

  console.log(`  目标页面：${page.title} (ID: ${page.id}, 当前版本: ${page.version.number})`);
  const updated = await updatePage(page.id, page.title, bodyHtml, page.version.number, minorEdit);
  console.log(`  ✅ 更新完成 → ${baseUrl}/pages/viewpage.action?pageId=${updated.id}`);
  return updated;
}

// ── 导出配置 ──────────────────────────────────────────────────────────────────
export { defaultSpaceKey };
export function getBaseUrl() { return baseUrl; }
