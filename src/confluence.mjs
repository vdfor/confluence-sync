import axios from 'axios';
import { marked } from 'marked';
import { nanoid } from 'nanoid';
import { extname, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// ── Mermaid 处理 ─────────────────────────────────────────────────────────────

let sebastianRenderer = null;
let cjkFontRegistry = null;

/** 项目内置 CJK 字体（思源黑体可变） */
const PROJECT_FONT_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fonts');
const CJK_FONT_FILE = join(PROJECT_FONT_DIR, 'SourceHanSansSC-VF.ttf');

async function getSebastianRenderer() {
  if (!sebastianRenderer) {
    const sebastian = await import('sebastianjs');
    sebastianRenderer = { renderPng: sebastian.renderPng, dispose: sebastian.dispose };
  }
  return sebastianRenderer;
}

/**
 * 创建注册了项目内置 CJK 字体的 FontRegistry
 * mermaid 节点标题默认用 bold，所以需要同时覆盖 regular + bold + italic
 */
async function getCjkFontRegistry() {
  if (cjkFontRegistry) return cjkFontRegistry;

  const { FontRegistry } = await import('sebastianjs/src/geometry/fonts.js');
  const registry = new FontRegistry();

  // 注册思源黑体 SC 可变字体，覆盖所有字重（variable font 可以自己插值不同 weight）
  // 家族名用常见别名，CSS font-family 匹配时能命中
  registry.registerFont(CJK_FONT_FILE, { family: 'Source Han Sans SC', weight: 400 });
  registry.registerFont(CJK_FONT_FILE, { family: 'Source Han Sans SC', weight: 700 });
  registry.registerFont(CJK_FONT_FILE, { family: 'Source Han Sans SC', weight: 400, italic: true });
  registry.registerFont(CJK_FONT_FILE, { family: 'Source Han Sans SC', weight: 700, italic: true });

  // 也注册成 generic 别名（mermaid 默认字体栈里有 sans-serif）
  registry.registerFont(CJK_FONT_FILE, { family: 'sans-serif', weight: 400 });
  registry.registerFont(CJK_FONT_FILE, { family: 'sans-serif', weight: 700 });

  registry.setDefaultFamily('Source Han Sans SC');
  cjkFontRegistry = registry;
  return registry;
}

/**
 * 检测并替换 markdown 中的 ```mermaid 代码块为图片占位符
 * 使用 sebastianjs（本地、零浏览器、零外网依赖）渲染为 PNG
 *
 * @param {string} md - 原始 markdown
 * @returns {{ md: string, images: { file: string, name: string }[], hasMermaid: boolean }}
 */
export async function preprocessMermaid(md) {
  const mermaidRe = /```mermaid\s*\n([\s\S]*?)```/gi;
  const matches = [...md.matchAll(mermaidRe)];
  if (!matches.length) return { md, images: [], hasMermaid: false };

  const { renderPng } = await getSebastianRenderer();
  const fontRegistry = await getCjkFontRegistry();
  const images = [];
  let result = md;
  let offset = 0;

  for (let i = 0; i < matches.length; i++) {
    const block = matches[i];
    const code = block[1];
    const id = nanoid();
    const name = `mermaid-${id}.png`;
    const file = `${tmpdir()}/${name}`;

    try {
      const t0 = Date.now();
      const { data: pngBuffer } = await renderPng(code, {
        background: 'white',
        fontFamily: 'Source Han Sans SC',
        fontRegistry,
        textAsPaths: true,  // resvg 对 CJK <text> 光栅化有问题，转成字形轮廓路径绕开
        scale: 3,           // 3x 高分辨率让路径光栅化更平滑
      });
      const t1 = Date.now();
      await writeFile(file, pngBuffer);
      images.push({ file, name });

      const replacement = `![${name}](${name})`;
      const start = block.index + offset;
      const end = start + block[0].length;
      result = result.slice(0, start) + replacement + result.slice(end);
      offset += replacement.length - block[0].length;
      console.log(`  📐 Mermaid 图表 ${i + 1} 渲染完成 → ${name} (${pngBuffer.length}B, ${t1 - t0}ms)`);
    } catch (err) {
      console.warn(`  ⚠️  Mermaid 图表 ${i + 1} 渲染失败：${err.message}，保留原始代码块`);
    }
  }

  return { md: result, images, hasMermaid: images.length > 0 };
}

/**
 * 清理临时图片文件
 */
async function cleanupMermaidImages(images) {
  for (const img of images) {
    try { await unlink(img.file); } catch {}
  }
}

// ── 配置 ──────────────────────────────────────────────────────────────────────
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
 * 按 ID 获取页面元信息（含版本号、space）
 */
export async function getPageById(id) {
  ensureApi();
  const { data } = await api.get(`/content/${id}`, {
    params: { expand: 'version,ancestors,space' },
  });
  return data;
}

/**
 * 列出指定 parent 下的子页面
 */
export async function listChildPages(parentId, limit = 50) {
  ensureApi();
  const { data } = await api.get(`/content/${parentId}/child/page`, {
    params: { limit, expand: 'version' },
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
 * 创建新页面（有 parentId 即可，Confluence 自动推断 space）
 */
export async function createPage(parentId, title, bodyHtml) {
  ensureApi();
  const payload = {
    type: 'page',
    title,
    body: { storage: { value: bodyHtml, representation: 'storage' } },
    ancestors: parentId ? [{ id: parentId }] : undefined,
  };
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

// ── HTML 转义 ────────────────────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
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
          else if (tok.text) out += escapeHtml(tok.text);
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
          out += tok.tokens ? renderInline(tok.tokens) : escapeHtml(tok.text);
          break;
        case 'strong':
          out += `<strong>${renderInline(tok.tokens)}</strong>`;
          break;
        case 'em':
          out += `<em>${renderInline(tok.tokens)}</em>`;
          break;
        case 'codespan':
          out += `<code>${escapeHtml(tok.text)}</code>`;
          break;
        case 'del':
          out += `<s>${renderInline(tok.tokens)}</s>`;
          break;
        case 'link':
          out += `<a href="${escapeHtml(tok.href)}">${renderInline(tok.tokens)}</a>`;
          break;
        case 'image':
          out += `<ac:image><ri:attachment ri:filename="${escapeHtml(tok.href)}" /></ac:image>`;
          break;
        case 'br':
          out += '<br/>';
          break;
        case 'escape':
          out += tok.text;
          break;
        case 'html':
          // marked 识别的 inline HTML（如 <div>foo</div>、<即实际未使用>）
          // 我们不支持用户写原生 HTML → 一律转义
          out += escapeHtml(tok.text);
          break;
        default:
          out += tok.text || '';
      }
    }
    return out;
  }

  return renderTokens(tokens);
}

// ── Confluence Storage Format → Markdown ─────────────────────────────────────

/**
 * 将 Confluence storage format（XHTML）转换为 Markdown
 * @param {string} html - Confluence storage format HTML
 * @returns {string} Markdown 文本
 */
export function confluenceToMd(html) {
  if (!html) return '';

  let md = html;

  // 代码块：<ac:structured-macro ac:name="code">
  md = md.replace(/<ac:structured-macro\s+ac:name="code">[\s\S]*?<ac:parameter\s+ac:name="language">([\s\S]*?)<\/ac:parameter>[\s\S]*?<ac:plain-text-body><!\[CDATA\[([\s\S]*?)\]\]><\/ac:plain-text-body>[\s\S]*?<\/ac:structured-macro>/g,
    (_, lang, code) => `\n\`\`\`${lang}\n${code}\n\`\`\`\n`);

  // 标题
  md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n');
  md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n');
  md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n');
  md = md.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '\n#### $1\n');
  md = md.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, '\n##### $1\n');
  md = md.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, '\n###### $1\n');

  // 粗体、斜体、删除线、行内代码
  md = md.replace(/<strong>([\s\S]*?)<\/strong>/gi, '**$1**');
  md = md.replace(/<b>([\s\S]*?)<\/b>/gi, '**$1**');
  md = md.replace(/<em>([\s\S]*?)<\/em>/gi, '*$1*');
  md = md.replace(/<i>([\s\S]*?)<\/i>/gi, '*$1*');
  md = md.replace(/<s>([\s\S]*?)<\/s>/gi, '~~$1~~');
  md = md.replace(/<del>([\s\S]*?)<\/del>/gi, '~~$1~~');
  md = md.replace(/<code>([\s\S]*?)<\/code>/gi, '`$1`');

  // 链接
  md = md.replace(/<a\s+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');

  // 图片：<ac:image><ri:attachment ri:filename="xxx" /></ac:image>
  md = md.replace(/<ac:image>[\s\S]*?<ri:attachment\s+ri:filename="([^"]*)"[\s\S]*?\/>[\s\S]*?<\/ac:image>/gi, '![]($1)');

  // 普通图片
  md = md.replace(/<img\s+[^>]*src="([^"]*)"[^>]*\/?>/gi, '![]($1)');

  // 水平线
  md = md.replace(/<hr\s*\/?>/gi, '\n---\n');

  // 换行
  md = md.replace(/<br\s*\/?>/gi, '\n');

  // 段落
  md = md.replace(/<p>([\s\S]*?)<\/p>/gi, '\n$1\n');

  // 引用块
  md = md.replace(/<blockquote>([\s\S]*?)<\/blockquote>/gi, (_, content) => {
    return content.split('\n').map(line => `> ${line}`).join('\n');
  });

  // 无序列表
  md = md.replace(/<ul>([\s\S]*?)<\/ul>/gi, (_, content) => {
    return content.replace(/<li>([\s\S]*?)<\/li>/gi, '- $1\n');
  });

  // 有序列表
  md = md.replace(/<ol>([\s\S]*?)<\/ol>/gi, (_, content) => {
    let i = 0;
    return content.replace(/<li>([\s\S]*?)<\/li>/gi, () => `${++i}. $1\n`);
  });

  // 表格
  md = md.replace(/<table>([\s\S]*?)<\/table>/gi, (_, tableContent) => {
    let rows = [];
    // 表头
    const headerMatch = tableContent.match(/<thead>([\s\S]*?)<\/thead>/i);
    if (headerMatch) {
      const cells = headerMatch[1].match(/<th[^>]*>([\s\S]*?)<\/th>/gi) || [];
      rows.push(cells.map(c => c.replace(/<th[^>]*>([\s\S]*?)<\/th>/i, '$1').trim()));
      rows.push(rows[0].map(() => '---'));
    }
    // 表体
    const bodyMatch = tableContent.match(/<tbody>([\s\S]*?)<\/tbody>/i);
    if (bodyMatch) {
      const trMatches = bodyMatch[1].match(/<tr>([\s\S]*?)<\/tr>/gi) || [];
      for (const tr of trMatches) {
        const cells = tr.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [];
        rows.push(cells.map(c => c.replace(/<td[^>]*>([\s\S]*?)<\/td>/i, '$1').trim()));
      }
    }
    return '\n' + rows.map(r => '| ' + r.join(' | ') + ' |').join('\n') + '\n';
  });

  // 移除剩余 HTML 标签
  md = md.replace(/<[^>]+>/g, '');

  // 清理多余空行
  md = md.replace(/\n{3,}/g, '\n\n');

  return md.trim();
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
 * 上传 Markdown 文件到 Confluence
 * @param {object} opts
 * @param {string} opts.filePath - 本地 .md 文件路径
 * @param {string} [opts.title] - 页面标题（默认取文件名）
 * @param {string} opts.parentId - 父页面 ID（数字）
 * @param {boolean} [opts.dryRun] - 仅打印转换结果
 */
export async function uploadMarkdown(opts) {
  const { filePath, title: optTitle, parentId: parentRaw, dryRun = false, mermaid = true } = opts;
  const fs = await import('node:fs');
  const path = await import('node:path');

  let md = fs.readFileSync(filePath, 'utf-8');
  const title = optTitle || path.basename(filePath, extname(filePath));

  // 必须有 parentId
  if (!parentRaw || !/^\d+$/.test(parentRaw)) {
    throw new Error('upload 需要 --parent <数字页面ID> 作为父页面');
  }

  const parentPage = await getPageById(parentRaw);
  console.log(`  父页面：${parentPage.title} (ID: ${parentPage.id}, Space: ${parentPage.space?.key})`);

  // Mermaid 预处理
  let mermaidImages = [];
  if (mermaid) {
    const result = await preprocessMermaid(md);
    md = result.md;
    mermaidImages = result.images;
  }

  const bodyHtml = mdToConfluence(md);

  if (dryRun) {
    console.log('── 转换结果（dry-run）────────────────────────');
    console.log(`  标题: ${title}`);
    console.log(`  父页面: ${parentPage.title} (ID: ${parentPage.id})`);
    if (mermaidImages.length) console.log(`  Mermaid 图片: ${mermaidImages.length} 张`);
    console.log('  Body:\n' + bodyHtml);
    return null;
  }

  try {
    // 检查 parent 下是否已有同名子页面
    const children = await listChildPages(parentPage.id, 500);
    const existing = children.find(c => c.title === title);

    let page;
    if (existing) {
      console.log(`  父页面下已存在同名页面「${title}」(ID: ${existing.id})，将更新…`);
      page = await updatePage(existing.id, title, bodyHtml, existing.version.number);
    } else {
      page = await createPage(parentPage.id, title, bodyHtml);
    }

    // 上传 mermaid 图片作为附件
    if (mermaidImages.length) {
      console.log('  📎 上传 Mermaid 图片附件…');
      for (const img of mermaidImages) {
        await uploadAttachment(page.id, img.file, img.name);
        console.log(`    ✅ ${img.name}`);
      }
    }

    console.log(`  ✅ ${existing ? '更新' : '创建'}完成 → ${baseUrl}/pages/viewpage.action?pageId=${page.id}`);
    return page;
  } finally {
    await cleanupMermaidImages(mermaidImages);
  }
}

/**
 * 更新指定页面（通过 page-id 定位）
 */
export async function updateMarkdown(opts) {
  const { pageId, filePath, minorEdit = false, mermaid = true } = opts;
  const fs = await import('node:fs');

  if (!pageId || !/^\d+$/.test(pageId)) {
    throw new Error('update 需要 --page-id <数字页面ID>');
  }

  let md = fs.readFileSync(filePath, 'utf-8');

  // Mermaid 预处理
  let mermaidImages = [];
  if (mermaid) {
    const result = await preprocessMermaid(md);
    md = result.md;
    mermaidImages = result.images;
  }

  const bodyHtml = mdToConfluence(md);

  const page = await getPageById(pageId);

  try {
    console.log(`  目标页面：${page.title} (ID: ${page.id}, Space: ${page.space?.key}, 当前版本: ${page.version.number})`);
    const updated = await updatePage(page.id, page.title, bodyHtml, page.version.number, minorEdit);

    // 上传 mermaid 图片作为附件
    if (mermaidImages.length) {
      console.log('  📎 上传 Mermaid 图片附件…');
      for (const img of mermaidImages) {
        await uploadAttachment(page.id, img.file, img.name);
        console.log(`    ✅ ${img.name}`);
      }
    }

    console.log(`  ✅ 更新完成 → ${baseUrl}/pages/viewpage.action?pageId=${updated.id}`);
    return updated;
  } finally {
    await cleanupMermaidImages(mermaidImages);
  }
}

// ── 导出配置 ──────────────────────────────────────────────────────────────────
export function getBaseUrl() { return baseUrl; }
