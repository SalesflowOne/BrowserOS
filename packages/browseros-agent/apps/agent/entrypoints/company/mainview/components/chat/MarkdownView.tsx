import { cn } from '@company/lib/utils'
import { type ComponentProps, type FC, Fragment, type ReactNode } from 'react'
import { Streamdown } from 'streamdown'

// Streamdown <2 doesn't export `Components` or accept the `plugins` prop;
// derive the components type from the component itself.
type StreamdownComponents = ComponentProps<typeof Streamdown>['components']

interface Props {
  /**
   * - `block`: full GitHub-flavored markdown: paragraphs, headings,
   *   lists, fenced code, tables, etc. Used for announcement bodies
   *   and any other long-form prose.
   * - `inline`: same parser, but block-level nodes (headings, lists,
   *   paragraphs, code fences, blockquotes, hr) are unwrapped into
   *   their children so the output sits on a single line. Used for
   *   announcement titles, where the agent may still want `**bold**`
   *   or `[label](url)` but not a heading or list. Renders inside a
   *   `<span>` instead of the default block container.
   */
  mode?: 'block' | 'inline'
  source: string
  className?: string
}

// `block` mode wires through to Streamdown unchanged. `inline` mode
// overrides the block-level renderers with Fragments so they emit only
// their children, keeping the output on a single line while still
// supporting `<strong>`, `<em>`, `<code>`, `<a>`, `<del>`.
//
// Link interception is handled by Streamdown's built-in linkSafety
// modal: every `http(s)://` click prompts a "Copy / Open" dialog
// before navigating, matching the chat surface's existing behaviour
// (which also relies on Streamdown's built-in modal: see
// ExternalLinkDialog.tsx header for the doc trail).
export const MarkdownView: FC<Props> = ({
  mode = 'block',
  source,
  className,
}) => {
  if (mode === 'inline') {
    return (
      <span className={cn('inline-markdown', className)}>
        <Streamdown
          mode="static"
          parseIncompleteMarkdown={false}
          components={INLINE_COMPONENTS}
          className="contents"
        >
          {source}
        </Streamdown>
      </span>
    )
  }
  return (
    <Streamdown
      mode="static"
      className={cn(
        'size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
        className,
      )}
    >
      {source}
    </Streamdown>
  )
}

// Unwrap every block-level node into its children so the rendered
// output stays inline. Hard-break + horizontal-rule are dropped
// outright (a single-line title has no use for either). Fenced code
// blocks degrade to `<code>` so the agent can still mark identifiers
// in titles without inserting a giant block element.
function inlineUnwrap(props: { children?: ReactNode }) {
  return <Fragment>{props.children}</Fragment>
}

const INLINE_COMPONENTS = {
  h1: inlineUnwrap,
  h2: inlineUnwrap,
  h3: inlineUnwrap,
  h4: inlineUnwrap,
  h5: inlineUnwrap,
  h6: inlineUnwrap,
  p: inlineUnwrap,
  ul: inlineUnwrap,
  ol: inlineUnwrap,
  li: inlineUnwrap,
  blockquote: inlineUnwrap,
  pre: (props: { children?: ReactNode }) => (
    <code className="inline-code">{props.children}</code>
  ),
  hr: () => null,
  br: () => <span> </span>,
  table: inlineUnwrap,
  thead: inlineUnwrap,
  tbody: inlineUnwrap,
  tr: inlineUnwrap,
  th: inlineUnwrap,
  td: inlineUnwrap,
} as unknown as StreamdownComponents
