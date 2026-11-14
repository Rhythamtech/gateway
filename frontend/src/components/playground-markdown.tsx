"use client"

import * as React from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Check, Copy } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { cn } from "cn"

function MarkdownCodeBlock({
  language,
  code,
}: {
  language?: string
  code: string
}) {
  const [copied, setCopied] = React.useState(false)

  const handleCopy = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      toast.success("Code copied to clipboard.")
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error("Unable to copy code.")
    }
  }, [code])

  return (
    <div className="my-3 overflow-hidden rounded-lg border border-border bg-muted/40 text-foreground">
      <div className="flex items-center justify-between border-b border-border/70 bg-muted/70 px-3 py-1.5 text-xs text-muted-foreground">
        <span className="font-mono text-[11px] font-medium uppercase tracking-wider">
          {language || "code"}
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={handleCopy}
          aria-label="Copy code snippet"
          className="size-6 text-muted-foreground hover:text-foreground"
        >
          {copied ? (
            <Check className="size-3 text-emerald-600 dark:text-emerald-400" />
          ) : (
            <Copy className="size-3" />
          )}
        </Button>
      </div>
      <div className="overflow-x-auto p-3">
        <pre className="font-mono text-xs leading-relaxed">
          <code>{code}</code>
        </pre>
      </div>
    </div>
  )
}

export function PlaygroundMarkdown({
  content,
  className,
}: {
  content: string
  className?: string
}) {
  return (
    <div
      className={cn(
        "max-w-full text-sm leading-relaxed [overflow-wrap:anywhere]",
        className
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p({ children }) {
            return (
              <p className="mb-3 leading-relaxed last:mb-0 [overflow-wrap:anywhere]">
                {children}
              </p>
            )
          },
          h1({ children }) {
            return (
              <h1 className="mt-5 mb-2.5 text-xl font-bold tracking-tight text-foreground first:mt-0">
                {children}
              </h1>
            )
          },
          h2({ children }) {
            return (
              <h2 className="mt-4 mb-2 text-lg font-semibold tracking-tight text-foreground first:mt-0">
                {children}
              </h2>
            )
          },
          h3({ children }) {
            return (
              <h3 className="mt-3.5 mb-1.5 text-base font-semibold text-foreground first:mt-0">
                {children}
              </h3>
            )
          },
          h4({ children }) {
            return (
              <h4 className="mt-3 mb-1 text-sm font-semibold text-foreground first:mt-0">
                {children}
              </h4>
            )
          },
          h5({ children }) {
            return (
              <h5 className="mt-2.5 mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground first:mt-0">
                {children}
              </h5>
            )
          },
          h6({ children }) {
            return (
              <h6 className="mt-2.5 mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground first:mt-0">
                {children}
              </h6>
            )
          },
          ul({ children }) {
            return (
              <ul className="my-2.5 ml-4 list-disc space-y-1 text-foreground/95">
                {children}
              </ul>
            )
          },
          ol({ children }) {
            return (
              <ol className="my-2.5 ml-4 list-decimal space-y-1 text-foreground/95">
                {children}
              </ol>
            )
          },
          li({ children }) {
            return (
              <li className="leading-relaxed [overflow-wrap:anywhere]">
                {children}
              </li>
            )
          },
          blockquote({ children }) {
            return (
              <blockquote className="my-3 border-l-2 border-primary/50 pl-3 italic text-muted-foreground">
                {children}
              </blockquote>
            )
          },
          hr() {
            return <hr className="my-4 border-border" />
          },
          a({ href, children }) {
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-primary underline underline-offset-4 hover:opacity-80 [overflow-wrap:anywhere]"
              >
                {children}
              </a>
            )
          },
          table({ children }) {
            return (
              <div className="my-3 w-full overflow-x-auto rounded-md border border-border">
                <table className="w-full border-collapse text-left text-xs sm:text-sm">
                  {children}
                </table>
              </div>
            )
          },
          thead({ children }) {
            return (
              <thead className="border-b border-border bg-muted/50 font-medium">
                {children}
              </thead>
            )
          },
          tbody({ children }) {
            return (
              <tbody className="divide-y divide-border">{children}</tbody>
            )
          },
          tr({ children }) {
            return (
              <tr className="transition-colors hover:bg-muted/20">
                {children}
              </tr>
            )
          },
          th({ children }) {
            return (
              <th className="px-3 py-2 font-semibold text-foreground">
                {children}
              </th>
            )
          },
          td({ children }) {
            return (
              <td className="px-3 py-2 align-top text-foreground/90 [overflow-wrap:anywhere]">
                {children}
              </td>
            )
          },
          strong({ children }) {
            return (
              <strong className="font-semibold text-foreground">
                {children}
              </strong>
            )
          },
          em({ children }) {
            return <em className="italic">{children}</em>
          },
          del({ children }) {
            return <del className="line-through opacity-70">{children}</del>
          },
          pre({ children }) {
            const isElement = React.isValidElement(children)
            const childProps = isElement
              ? (children.props as {
                  className?: string
                  children?: React.ReactNode
                })
              : null
            const match = /language-(\w+)/.exec(childProps?.className || "")
            const language = match ? match[1] : undefined
            const rawContent = isElement ? childProps?.children : children
            const codeString = String(rawContent || "").replace(/\n$/, "")

            return (
              <MarkdownCodeBlock language={language} code={codeString} />
            )
          },
          code({ className, children, ...props }) {
            return (
              <code
                className={cn(
                  "rounded bg-muted px-1.5 py-0.5 font-mono text-xs font-medium text-foreground [overflow-wrap:anywhere]",
                  className
                )}
                {...props}
              >
                {children}
              </code>
            )
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
