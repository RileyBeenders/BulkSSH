interface Props {
  page: number
  pages: number
  onPage: (page: number) => void
}

// Above this many pages, numbered buttons give way to just prev/next.
const MAX_NUMBERED = 12

export function Pager({ page, pages, onPage }: Props): React.JSX.Element {
  return (
    <nav className="pager" aria-label="Pages">
      <button onClick={() => onPage(page - 1)} disabled={page === 0} title="Previous page (Ctrl+PageUp)" aria-label="Previous page">
        ‹
      </button>
      {pages <= MAX_NUMBERED &&
        Array.from({ length: pages }, (_, i) => (
          <button
            key={i}
            className={i === page ? 'current' : undefined}
            aria-current={i === page ? 'page' : undefined}
            onClick={() => onPage(i)}
          >
            {i + 1}
          </button>
        ))}
      <button onClick={() => onPage(page + 1)} disabled={page >= pages - 1} title="Next page (Ctrl+PageDown)" aria-label="Next page">
        ›
      </button>
      <span className="muted">
        Page {page + 1} of {pages}
      </span>
    </nav>
  )
}
