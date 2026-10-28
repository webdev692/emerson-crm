import { useState } from 'react'

export type RecordOption = { id: string; label: string }
type RecordSelectorProps = {
  label: string
  options: RecordOption[]
  name?: string
  required?: boolean
} & (
  | { multiple?: false; value: string; onChange: (value: string) => void }
  | { multiple: true; value: string[]; onChange: (value: string[]) => void }
)

/** Values are internal IDs; only the server-authorized response supplies options. */
export function RecordSelector({
  label,
  options,
  value,
  onChange,
  name,
  required = false,
  multiple,
}: RecordSelectorProps) {
  const [query, setQuery] = useState('')
  const selected = Array.isArray(value) ? value : [value]
  const visible = options.filter(
    (o) =>
      selected.includes(o.id) ||
      o.label.toLowerCase().includes(query.toLowerCase()),
  )
  return (
    <div className="record-selector">
      <input
        type="search"
        aria-label={`Search ${label.toLowerCase()}`}
        placeholder="Search by name or context…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <select
        aria-label={label}
        name={name}
        required={required}
        multiple={multiple}
        value={value}
        onChange={(e) => {
          if (multiple)
            onChange(Array.from(e.target.selectedOptions, (o) => o.value))
          else onChange(e.target.value)
        }}
      >
        {!multiple && <option value="">Select…</option>}
        {visible.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      {!visible.length && (
        <small>
          No accessible matches. Ask a manager to check access or create the
          linked record first.
        </small>
      )}
      {multiple && (
        <small>Use Ctrl or Command to select multiple staff members.</small>
      )}
    </div>
  )
}
