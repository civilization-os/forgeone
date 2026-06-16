import { describe, it, expect } from 'vitest';

// ===== 直接从 App.tsx 中提取的纯解析函数（无 React/HLJS 依赖） =====

type InlineToken =
  | { type: 'text'; content: string }
  | { type: 'code'; content: string }
  | { type: 'bold'; content: string }
  | { type: 'italic'; content: string }
  | { type: 'strikethrough'; content: string }
  | { type: 'link'; text: string; url: string }
  | { type: 'auto_link'; url: string };

type FormattedSegment =
  | { type: 'text'; content: string }
  | { type: 'code'; content: string; language: string };

type MarkdownBlock =
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'unordered-list'; items: string[] }
  | { type: 'ordered-list'; items: string[] }
  | { type: 'blockquote'; lines: string[] }
  | { type: 'hr' }
  | { type: 'table'; headers: string[]; rows: string[][] };

function parseInlineTokens(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  const regex = /(\[([^\]]+)\]\(([^)]+)\))|(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(~~([^~]+)~~)|(`([^`\n]+)`)|((?:https?:\/\/|www\.)[^\s<>"']+)/gi;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ type: 'text', content: text.slice(lastIndex, match.index) });
    }
    if (match[1] !== undefined) {
      tokens.push({ type: 'link', text: match[2], url: match[3] });
    } else if (match[4] !== undefined) {
      tokens.push({ type: 'bold', content: match[5] });
    } else if (match[6] !== undefined) {
      tokens.push({ type: 'italic', content: match[7] });
    } else if (match[8] !== undefined) {
      tokens.push({ type: 'strikethrough', content: match[9] });
    } else if (match[10] !== undefined) {
      tokens.push({ type: 'code', content: match[11] });
    } else {
      tokens.push({ type: 'auto_link', url: match[0] });
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    tokens.push({ type: 'text', content: text.slice(lastIndex) });
  }

  return tokens.length ? tokens : [{ type: 'text', content: text }];
}

function parseFormattedSegments(text: string): FormattedSegment[] {
  const segments: FormattedSegment[] = [];
  const regex = /```([^\n`]*)\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', content: text.slice(lastIndex, match.index) });
    }
    segments.push({
      type: 'code',
      language: match[1].trim().toLowerCase(),
      content: match[2].replace(/\r/g, '').trim(),
    });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({ type: 'text', content: text.slice(lastIndex) });
  }

  return segments.length ? segments : [{ type: 'text', content: text }];
}

function parseMarkdownBlocks(text: string): MarkdownBlock[] {
  const normalized = text.replace(/\r/g, '');
  const lines = normalized.split('\n');
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  const flushParagraph = (buffer: string[]) => {
    const content = buffer.join('\n').trim();
    if (content) {
      blocks.push({ type: 'paragraph', text: content });
    }
    buffer.length = 0;
  };

  const paragraphBuffer: string[] = [];

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph(paragraphBuffer);
      index += 1;
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      flushParagraph(paragraphBuffer);
      blocks.push({
        type: 'heading',
        level: headingMatch[1].length,
        text: headingMatch[2].trim(),
      });
      index += 1;
      continue;
    }

    // --- 分割线
    if (/^(?:-{3,}|\*{3,}|_{3,})\s*$/.test(trimmed)) {
      flushParagraph(paragraphBuffer);
      blocks.push({ type: 'hr' });
      index += 1;
      continue;
    }

    // GFM 表格
    const tableSepPattern = /^\|[\s:-]+\|(?:[\s:-]+\|\s*)*$/;
    if (trimmed.startsWith('|') && index + 1 < lines.length && tableSepPattern.test(lines[index + 1].trim())) {
      flushParagraph(paragraphBuffer);
      const headers = trimmed.split('|').map(c => c.trim()).filter(Boolean);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length) {
        const rowLine = lines[index].trim();
        if (!rowLine.startsWith('|')) break;
        const cells = rowLine.split('|').map(c => c.trim()).filter(Boolean);
        if (cells.length === 0) { index += 1; continue; }
        rows.push(cells);
        index += 1;
      }
      blocks.push({ type: 'table', headers, rows });
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      flushParagraph(paragraphBuffer);
      const quoteLines: string[] = [];
      while (index < lines.length) {
        const current = lines[index].trim();
        if (!/^>\s?/.test(current)) break;
        quoteLines.push(current.replace(/^>\s?/, ''));
        index += 1;
      }
      blocks.push({ type: 'blockquote', lines: quoteLines });
      continue;
    }

    if (/^[-*+]\s+/.test(trimmed)) {
      flushParagraph(paragraphBuffer);
      const items: string[] = [];
      while (index < lines.length) {
        const current = lines[index];
        const trimmedLine = current.trim();
        const match = trimmedLine.match(/^[-*+]\s+(.+)$/);
        if (match) {
          items.push(match[1].trim());
          index += 1;
          continue;
        }
        // --- / *** / ___ 不是列表续行，中断列表
        if (/^(?:-{3,}|\*{3,}|_{3,})\s*$/.test(trimmedLine)) {
          break;
        }
        // ### heading 不是列表续行，中断列表
        if (/^#{1,4}\s/.test(trimmedLine)) {
          break;
        }
        if (items.length > 0 && /^\s/.test(current) && trimmedLine.length > 0) {
          const last = items.pop() || '';
          items.push(last + '\n' + trimmedLine);
          index += 1;
          continue;
        }
        if (trimmedLine.length === 0) {
          index += 1;
          continue;
        }
        break;
      }
      blocks.push({ type: 'unordered-list', items });
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      flushParagraph(paragraphBuffer);
      const items: string[] = [];
      while (index < lines.length) {
        const current = lines[index];
        const trimmedLine = current.trim();
        const match = trimmedLine.match(/^\d+\.\s+(.+)$/);
        if (match) {
          items.push(match[1].trim());
          index += 1;
          continue;
        }
        // --- / *** / ___ 不是列表续行，中断列表
        if (/^(?:-{3,}|\*{3,}|_{3,})\s*$/.test(trimmedLine)) {
          break;
        }
        // ### heading 不是列表续行，中断列表
        if (/^#{1,4}\s/.test(trimmedLine)) {
          break;
        }
        if (items.length > 0 && trimmedLine.length > 0) {
          const last = items.pop() || '';
          items.push(last + '\n' + trimmedLine);
          index += 1;
          continue;
        }
        if (trimmedLine.length === 0) {
          index += 1;
          continue;
        }
        break;
      }
      blocks.push({ type: 'ordered-list', items });
      continue;
    }

    paragraphBuffer.push(line);
    index += 1;
  }

  flushParagraph(paragraphBuffer);
  return blocks.length ? blocks : [{ type: 'paragraph', text: normalized }];
}

// ===== 测试用例 =====

describe('parseMarkdownBlocks', () => {
  describe('分割线 ---', () => {
    it('解析 "---" 为 hr', () => {
      const result = parseMarkdownBlocks('上面\n\n---\n\n下面');
      expect(result.filter(b => b.type === 'hr')).toHaveLength(1);
      expect(result[0].type).toBe('paragraph');
      expect(result[1].type).toBe('hr');
      expect(result[2].type).toBe('paragraph');
    });

    it('解析 "***" 和 "___"', () => {
      const r1 = parseMarkdownBlocks('a\n\n***\n\nb');
      expect(r1[1].type).toBe('hr');
      const r2 = parseMarkdownBlocks('a\n\n___\n\nb');
      expect(r2[1].type).toBe('hr');
    });

    it('不在列表项中误匹配 ---', () => {
      const result = parseMarkdownBlocks('- item with --- inside');
      expect(result[0].type).toBe('unordered-list');
    });
  });

  describe('GFM 表格', () => {
    it('解析基本表格', () => {
      const input = `| 名称 | 状态 |
|------|------|
| 文件读写 | 已启用 |
| 代码搜索 | 已启用 |`;
      const result = parseMarkdownBlocks(input);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('table');
      if (result[0].type === 'table') {
        expect(result[0].headers).toEqual(['名称', '状态']);
        expect(result[0].rows).toHaveLength(2);
        expect(result[0].rows[0]).toEqual(['文件读写', '已启用']);
        expect(result[0].rows[1]).toEqual(['代码搜索', '已启用']);
      }
    });

    it('表格前后有其他内容不混淆', () => {
      const input = `注：以下表格\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n结束。`;
      const result = parseMarkdownBlocks(input);
      const tables = result.filter(b => b.type === 'table');
      expect(tables).toHaveLength(1);
    });

    it('单列表格', () => {
      const input = `|工具|
|----|
| file_indexer |
| python_sandbox |`;
      const result = parseMarkdownBlocks(input);
      expect(result[0].type).toBe('table');
      if (result[0].type === 'table') {
        expect(result[0].headers).toEqual(['工具']);
        expect(result[0].rows).toHaveLength(2);
      }
    });

    it('空表格体（只有表头）', () => {
      const result = parseMarkdownBlocks('| H1 | H2 |\n|---|---|');
      expect(result[0].type).toBe('table');
      if (result[0].type === 'table') {
        expect(result[0].headers).toEqual(['H1', 'H2']);
        expect(result[0].rows).toEqual([]);
      }
    });
  });

  describe('与其它 block 类型的组合', () => {
    it('用户给的完整能力描述文本', () => {
      const input = `从我的运行时环境来看，我具备以下核心能力：

### 🔧 基础工具能力
- **文件读写** — 读取、写入工作区中的任意文件
- **代码搜索** — 按正则表达式搜索文件内容

### 🧩 插件/技能能力
1. **文件智能检索**（\`file_indexer\`，已启用）  
   对工作区文件内容做语义索引和向量检索。

2. **Python 沙箱执行**（\`python_sandbox\`，已启用）  
   在隔离的轻量容器中运行 Python 代码。

---

### 💬 对话与协作
- 自然语言对话，支持中文/混合语言
- 能保持目标锚定、工作集追踪`;
      
      const blocks = parseMarkdownBlocks(input);
      
      // 验证 block 类型序列
      const types = blocks.map(b => b.type);
      expect(types).toContain('paragraph');
      expect(types).toContain('heading');
      expect(types).toContain('unordered-list');
      expect(types).toContain('ordered-list');
      expect(types).toContain('hr');
      
      // --- 应在段落之后
      const hrIndex = blocks.findIndex(b => b.type === 'hr');
      expect(hrIndex).toBeGreaterThan(0);
      
      // 验证 heading 级别
      const headings = blocks.filter(b => b.type === 'heading') as { level: number; text: string }[];
      expect(headings[0].level).toBe(3);
      expect(headings[1].level).toBe(3);
      expect(headings[2].level).toBe(3);
      
      // 验证有序列表
      const ordered = blocks.find(b => b.type === 'ordered-list') as { items: string[] } | undefined;
      expect(ordered).toBeDefined();
      if (ordered) {
        expect(ordered.items.length).toBeGreaterThanOrEqual(2);
        expect(ordered.items[0]).toContain('文件智能检索');
      }
      
      // 验证无序列表（包含加粗标记）
      const unordered = blocks.find(b => b.type === 'unordered-list') as { items: string[] } | undefined;
      expect(unordered).toBeDefined();
    });
  });

  describe('带 emoji 和中文的 heading', () => {
    it('### ❌ 我不擅长（或不能做）', () => {
      const result = parseMarkdownBlocks('### ❌ 我不擅长（或不能做） 这种没有渲染');
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('heading');
      if (result[0].type === 'heading') {
        expect(result[0].level).toBe(3);
        expect(result[0].text).toBe('❌ 我不擅长（或不能做） 这种没有渲染');
      }
    });

    it('### 🔧 基础工具能力', () => {
      const result = parseMarkdownBlocks('### 🔧 基础工具能力');
      expect(result[0].type).toBe('heading');
      if (result[0].type === 'heading') {
        expect(result[0].level).toBe(3);
        expect(result[0].text).toBe('🔧 基础工具能力');
      }
    });

    it('### 🧩 插件/技能能力', () => {
      const result = parseMarkdownBlocks('### 🧩 插件/技能能力');
      expect(result[0].type).toBe('heading');
      if (result[0].type === 'heading') {
        expect(result[0].level).toBe(3);
        expect(result[0].text).toBe('🧩 插件/技能能力');
      }
    });
  });

  describe('边界情况', () => {
    it('空文本返回一个空段落', () => {
      const result = parseMarkdownBlocks('');
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('paragraph');
    });

    it('只有 --- 返回一个 hr', () => {
      const result = parseMarkdownBlocks('---');
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('hr');
    });

    it('连续分隔线', () => {
      const result = parseMarkdownBlocks('---\n\n***\n\n___');
      const hrs = result.filter(b => b.type === 'hr');
      expect(hrs).toHaveLength(3);
    });

    it('多个空行被折叠', () => {
      const result = parseMarkdownBlocks('a\n\n\n\nb');
      const paragraphs = result.filter(b => b.type === 'paragraph');
      expect(paragraphs).toHaveLength(2);
    });
  });
});

describe('parseInlineTokens', () => {
  it('解析加粗 **bold**', () => {
    const tokens = parseInlineTokens('支持**中文**和英文');
    expect(tokens).toContainEqual({ type: 'bold', content: '中文' });
  });

  it('解析行内代码 `code`', () => {
    const tokens = parseInlineTokens('运行 `file_indexer` 工具');
    expect(tokens).toContainEqual({ type: 'code', content: 'file_indexer' });
  });

  it('解析链接 [text](url)', () => {
    const tokens = parseInlineTokens('详见[文档](https://example.com)');
    expect(tokens).toContainEqual({ type: 'link', text: '文档', url: 'https://example.com' });
  });

  it('混合 token：加粗+代码+链接', () => {
    const text = '**工具** `file_indexer` 已[启用](https://x.com)';
    const tokens = parseInlineTokens(text);
    expect(tokens[0]).toEqual({ type: 'bold', content: '工具' });
    expect(tokens[1]).toEqual({ type: 'text', content: ' ' });
    expect(tokens[2]).toEqual({ type: 'code', content: 'file_indexer' });
    expect(tokens[3]).toEqual({ type: 'text', content: ' 已' });
    expect(tokens[4]).toEqual({ type: 'link', text: '启用', url: 'https://x.com' });
  });

  it('空文本', () => {
    const tokens = parseInlineTokens('');
    expect(tokens).toHaveLength(1);
    expect(tokens[0].type).toBe('text');
  });

  it('自动链接 URL', () => {
    const tokens = parseInlineTokens('访问 https://example.com 查看');
    const autoLink = tokens.find(t => t.type === 'auto_link');
    expect(autoLink).toBeDefined();
  });

  it('删除线 ~~text~~', () => {
    const tokens = parseInlineTokens('~~已废弃~~功能');
    expect(tokens).toContainEqual({ type: 'strikethrough', content: '已废弃' });
  });

  it('斜体 *italic*', () => {
    const tokens = parseInlineTokens('注意*斜体*文本');
    expect(tokens).toContainEqual({ type: 'italic', content: '斜体' });
  });
});

describe('全链路渲染（parseFormattedSegments → parseMarkdownBlocks）', () => {
  it('模型完整回答的渲染结构', () => {
    const input = `我是 **ForgeOne**，一个开放式的编码智能体运行时。我的核心能力围绕**软件开发和代码仓库交互**展开，主要包括：

### 🛠 我能帮你做什么

1. **代码理解与搜索**
   - 读取、搜索项目中的任何文件
   - 使用正则表达式查找代码模式（函数、类、引用等）
   - 按通配符模式（如 \`**/*.rs\`）查找文件

2. **代码修改与生成**
   - 精准编辑文件（基于搜索替换，不会破坏结构）
   - 创建、重命名、复制文件
   - 通过 shell 运行代码生成工具或脚本

3. **编译与诊断**
   - 运行 \`cargo check\` 获取编译器诊断
   - 分析错误和警告，并提供修复建议

4. **项目管理与版本控制**
   - 运行构建、测试、格式检查等命令
   - 执行 Git 操作（status, diff, log 等）

5. **上下文感知与问答**
   - 记住你当前的工作目标（working set）
   - 压缩历史对话，在长会话中保持效率
   - 针对你的项目上下文提供精准建议

### ❌ 我不擅长（或不能做）

- 访问外部网络（除工具允许的 shell 命令外）
- 执行任意的系统管理操作
- 生成超出工具集能力范围的回应

---

如果你想看具体能力的演示，例如让我搜索一段代码、修改一个文件，或者检查一个 Rust 项目的编译错误，随时告诉我！😊`;

    // 第一步：按代码块分段
    const segments = parseFormattedSegments(input);
    
    // 验证没有代码块（纯文本段落）
    expect(segments.every(s => s.type === 'text')).toBe(true);
    expect(segments).toHaveLength(1);

    // 第二步：解析 markdown 块
    const blocks = parseMarkdownBlocks(segments[0].content);
    const types = blocks.map(b => b.type);
    
    // 打印完整结构用于调试
    console.log('=== 全链路渲染结构 ===');
    blocks.forEach((b, i) => {
      if (b.type === 'heading') console.log(`  [${i}] heading level=${b.level} text="${b.text.slice(0, 40)}..."`);
      else if (b.type === 'paragraph') console.log(`  [${i}] paragraph text="${b.text.slice(0, 40)}..."`);
      else if (b.type === 'ordered-list') console.log(`  [${i}] ordered-list items=${b.items.length}`);
      else if (b.type === 'unordered-list') console.log(`  [${i}] unordered-list items=${b.items.length}`);
      else if (b.type === 'hr') console.log(`  [${i}] hr`);
      else if (b.type === 'blockquote') console.log(`  [${i}] blockquote lines=${b.lines.length}`);
      else if (b.type === 'table') console.log(`  [${i}] table headers=${b.headers.length} rows=${b.rows.length}`);
    });

    // 验证结构完整性
    expect(types[0]).toBe('paragraph');      // 引言段
    expect(types[1]).toBe('heading');         // ### 🛠 我能帮你做什么
    expect(types[2]).toBe('ordered-list');    // 1. 2. 3. 4. 5.
    expect(types[3]).toBe('heading');         // ### ❌ 我不擅长（或不能做）
    expect(types[4]).toBe('unordered-list');  // - 列表
    expect(types[5]).toBe('hr');              // ---
    expect(types[6]).toBe('paragraph');       // 结尾段

    // 验证 ### 🛠
    const h1 = blocks[1];
    if (h1.type === 'heading') {
      expect(h1.level).toBe(3);
      expect(h1.text).toContain('🛠');
    }

    // 验证 ### ❌
    const h2 = blocks[3];
    if (h2.type === 'heading') {
      expect(h2.level).toBe(3);
      expect(h2.text).toContain('❌');
      expect(h2.text).toContain('我不擅长');
    }

    // 验证 --- 是 hr
    expect(blocks[5].type).toBe('hr');

    // 验证有序列表有 5 项
    const ol = blocks[2];
    if (ol.type === 'ordered-list') {
      expect(ol.items).toHaveLength(5);
      expect(ol.items[0]).toContain('代码理解');
      expect(ol.items[1]).toContain('代码修改');
      expect(ol.items[2]).toContain('编译');
      expect(ol.items[3]).toContain('项目管理');
      expect(ol.items[4]).toContain('上下文感知');
      // 子 bullet 合并到了最后一项内容里
      expect(ol.items[4]).toContain('记住你当前的工作目标');
    }

    // 验证无序列表有 3 项
    const ul = blocks[4];
    if (ul.type === 'unordered-list') {
      expect(ul.items).toHaveLength(3);
    }
  });
});
