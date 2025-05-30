"use client"

import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import { useState, useEffect, useCallback } from "react"
import { useTheme } from "next-themes"
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/cjs/styles/prism';

// Custom styles for code blocks
const customCodeStyles = `
.code-wrapper .code-block,
.code-wrapper .code-block pre {
  background-color: transparent !important;
  margin: 0 !important;
  padding: 0 !important;
  font-family: inherit !important;
}
.code-wrapper .code-block code {
  display: inline-block;
  min-width: 100%;
}
`

const codeVariants = cva(
  "font-mono rounded-md cursor-pointer overflow-auto transition-all duration-200 relative shadow-inner",
  {
    variants: {
      display: {
        inline: "inline-flex bg-secondary py-0 px-1",
        block: "block bg-secondary p-2 mt-2 mb-4",
      },
      fontSize: {
        xs: "text-xs",
        sm: "text-sm",
        md: "text-md",
        lg: "text-lg",
      },
    },
    defaultVariants: {
      display: "inline",
      fontSize: "xs",
    },
  },
)

interface CodeProps
  extends Omit<
      React.HTMLAttributes<HTMLDivElement>,
      keyof VariantProps<typeof codeVariants>
    >,
    VariantProps<typeof codeVariants> {
  code: string
  fontSize?: "xs" | "sm" | "md" | "lg"
  language?: string
  background?: string
}

const Code = ({
  code,
  language = "tsx",
  display,
  fontSize,
  className,
  background,
  style,
  ...props
}: CodeProps) => {
  const [isCopied, setIsCopied] = useState(false)
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === "dark";

  const handleCopyClick = async () => {
    if (isCopied) return
    await navigator.clipboard.writeText(code)
    setIsCopied(true)
    toast.success("Copied to clipboard", {
      duration: 1500,
      className: "select-none",
    })

    setTimeout(() => {
      setIsCopied(false)
    }, 1000)
  }

  return (
    <>
      <style>{customCodeStyles}</style>
      <div
        onClick={handleCopyClick}
        role="button"
        tabIndex={0}
        aria-label="Click to copy code"
        className={cn(
          "code-wrapper",
          codeVariants({ fontSize, display }),
          className,
          "focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:outline-none",
          "relative",
          isCopied &&
            "before:absolute before:inset-0 before:rounded-md before:pointer-events-none before:bg-emerald-400/5 before:border before:border-emerald-400/20 before:animate-copy-success",
        )}
        style={{
          backgroundColor: background,
          ...style,
        }}
        {...props}
      >
        <div className="code-block">
          <SyntaxHighlighter
            language={language || 'typescript'}
            style={isDark ? oneDark : oneLight}
            customStyle={{
              backgroundColor: 'transparent',
              padding: 0,
              margin: 0,
              borderRadius: 0,
            }}
            codeTagProps={{
              style: {
                fontFamily: 'inherit',
              },
            }}
          >
            {code}
          </SyntaxHighlighter>
        </div>
      </div>
    </>
  )
}

Code.displayName = "Code"

export { Code }