import React, { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { Check, Copy } from 'lucide-react'
import 'katex/dist/katex.min.css'

interface MarkdownRendererProps {
  content: string
  className?: string
}

function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    if (!code) return
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {
      const textarea = document.createElement('textarea')
      textarea.value = code
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const cleanLang = (language || 'text').replace(/^language-/, '').toLowerCase()

  return (
    <div className="my-3 rounded-xl overflow-hidden border border-[#2F3130] bg-[#1A1C1B] shadow-sm">
      {/* Code Header Bar */}
      <div className="flex items-center justify-between px-3.5 py-1.5 bg-[#252726] border-b border-[#333534] select-none text-[11px]">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-[#FF5F56]/80" />
            <div className="w-2.5 h-2.5 rounded-full bg-[#FFBD2E]/80" />
            <div className="w-2.5 h-2.5 rounded-full bg-[#27C93F]/80" />
          </div>
          <span className="font-mono text-[#A0A2A1] uppercase tracking-wider text-[10px] font-semibold ml-1">
            {cleanLang}
          </span>
        </div>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1 text-[#A0A2A1] hover:text-white px-2 py-0.5 rounded hover:bg-[#333534] transition-colors cursor-pointer"
          title="复制代码"
        >
          {copied ? (
            <>
              <Check size={12} className="text-emerald-400" />
              <span className="text-emerald-400 text-[10px] font-medium">已复制</span>
            </>
          ) : (
            <>
              <Copy size={12} />
              <span className="text-[10px]">复制</span>
            </>
          )}
        </button>
      </div>

      {/* Code Highlighting Body */}
      <div className="p-3 text-[12px] font-mono overflow-x-auto selection:bg-[#2D63ED]/40 custom-scrollbar">
        <SyntaxHighlighter
          language={cleanLang || 'text'}
          style={vscDarkPlus}
          customStyle={{
            margin: 0,
            padding: 0,
            background: 'transparent',
            fontSize: '12px',
            lineHeight: '1.6',
          }}
          codeTagProps={{
            style: {
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
            },
          }}
        >
          {code}
        </SyntaxHighlighter>
      </div>
    </div>
  )
}

function preprocessLatex(content: string): string {
  if (!content) return ''

  let text = content

  // 1. Code fences ```math or ```latex -> $$ ... $$
  text = text.replace(/```(?:math|latex)\s*([\s\S]*?)\s*```/gi, (_, math) => `\n$$\n${math.trim()}\n$$\n`)

  // 2. Standard LaTeX block math: \[ ... \] -> $$ ... $$
  text = text.replace(/\\\[([\s\S]*?)\\\]/g, (_, math) => `\n$$\n${math.trim()}\n$$\n`)

  // 3. Standard LaTeX inline math: \( ... \) -> $ ... $
  text = text.replace(/\\\(([\s\S]*?)\\\)/g, (_, math) => `$${math.trim()}$`)

  // 4. Bracketed block math lines: [ <math> ]
  // e.g. [ T(n) = aT\left(\frac{n}{b}\right) + f(n) ] or [ T(n) = \begin{cases} ... \end{cases} ]
  text = text.replace(/(^|[\n:\s])\[\s*([\s\S]*?\\(?:frac|left|right|begin|end|Theta|sum|int|sqrt|alpha|beta|gamma|lambda|sigma|partial|cases|cdot|times|neq|le|ge|leq|geq|log|omega|Omega|infty)[^\]]*?)\s*\](?!\()/g, 
    (_, prefix, math) => `${prefix}\n$$\n${math.trim()}\n$$\n`
  )

  // 5. Parenthesized formulas at list items or standalone words:
  // e.g. "• ( \log_b a = 1 )", "• ( a = 2 )", "• ( f(n) = O(n) )"
  text = text.replace(/(^|[\n\s•\-\*])\(\s*(\\[a-zA-Z]+[^)]*?|[a-zA-Z0-9_\^]+\s*=\s*[^)]+)\s*\)([\s\.,:;\n]|$)/g,
    (_, prefix, math, suffix) => {
      if (/\\left\s*$/i.test(prefix) || /[a-zA-Z0-9_\\]$/.test(prefix)) {
        return `${prefix}(${math})${suffix}`
      }
      return `${prefix}$${math.trim()}$${suffix}`
    }
  )

  return text
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content, className = '' }) => {
  const processedContent = React.useMemo(() => preprocessLatex(content), [content])

  return (
    <div className={`markdown-body select-text cursor-text text-xs leading-relaxed text-[#1A1C1B] ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: false }]]}
        components={{
          h1: ({ children }) => (
            <h1 className="text-base font-bold text-[#1A1C1B] mt-4 mb-2 pb-1 border-b border-[#E8E8E6] first:mt-0">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-sm font-bold text-[#1A1C1B] mt-3.5 mb-1.5 pb-0.5 border-b border-[#F0EFEB] first:mt-0">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-[13px] font-semibold text-[#1A1C1B] mt-3 mb-1 first:mt-0">
              {children}
            </h3>
          ),
          h4: ({ children }) => (
            <h4 className="text-xs font-semibold text-[#1A1C1B] mt-2.5 mb-1 first:mt-0">
              {children}
            </h4>
          ),
          p: ({ children }) => (
            <p className="my-1.5 leading-relaxed font-normal last:mb-0">
              {children}
            </p>
          ),
          ul: ({ children }) => (
            <ul className="list-disc list-outside ml-4 my-1.5 space-y-1">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal list-outside ml-4 my-1.5 space-y-1">
              {children}
            </ol>
          ),
          li: ({ children }) => (
            <li className="leading-relaxed pl-0.5">
              {children}
            </li>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-[#2D63ED]/60 bg-[#FAF9F7] pl-3 py-1 my-2 text-[#555] italic rounded-r-lg">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-3 border-t border-[#E8E8E6]" />,
          table: ({ children }) => (
            <div className="my-2.5 overflow-x-auto rounded-lg border border-[#E8E8E6]">
              <table className="min-w-full text-xs text-left divide-y divide-[#E8E8E6]">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-[#FAF9F7] text-[#1A1C1B] font-semibold">
              {children}
            </thead>
          ),
          tbody: ({ children }) => (
            <tbody className="divide-y divide-[#E8E8E6] bg-white">
              {children}
            </tbody>
          ),
          tr: ({ children }) => <tr className="hover:bg-[#FAF9F7]/50 transition-colors">{children}</tr>,
          th: ({ children }) => <th className="px-3 py-2 text-[11px] font-semibold">{children}</th>,
          td: ({ children }) => <td className="px-3 py-2 text-[11px] leading-relaxed">{children}</td>,
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#2D63ED] hover:underline font-medium break-all"
            >
              {children}
            </a>
          ),
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || '')
            const isInline = !match && !String(children).includes('\n')
            if (isInline) {
              return (
                <code
                  className="px-1.5 py-0.5 mx-0.5 rounded bg-[#EAE9E5] text-[#1A1C1B] font-mono text-[11px] font-normal"
                  {...props}
                >
                  {children}
                </code>
              )
            }
            return (
              <CodeBlock
                language={match ? match[1] : ''}
                code={String(children).replace(/\n$/, '')}
              />
            )
          },
        }}
      >
        {processedContent}
      </ReactMarkdown>
    </div>
  )
}
