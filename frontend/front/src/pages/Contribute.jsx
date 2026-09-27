import { useRef, useState } from 'react'
import { AlertTriangle, Check, CheckCircle2, ChevronDown, Copy, Download, FileUp, Loader2, Map as MapIcon, ShieldCheck, Trash2, X } from 'lucide-react'
import { Layout } from '../components/Layout'
import { ErrorState } from '../components/ui'
import { useAsync } from '../hooks/useAsync'
import { api } from '../lib/api'
import { downloadBlob } from '../lib/download'
import { fmtDateTime, fmtNum } from '../lib/format'

const MAX_BYTES = 5 * 1024 * 1024
const ID_PATTERN = /^[A-Z][A-Z0-9_]{1,15}$/

export default function Contribute() {
  const [file, setFile] = useState(null)
  const [drag, setDrag] = useState(false)
  const [form, setForm] = useState({ utility_id: '', utility_name: '', source_name: '', submitted_by: '', notes: '', attest: false, uploadToken: '' })
  const [touched, setTouched] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [advanced, setAdvanced] = useState(false)
  const fileInput = useRef(null)
  const userDatasets = useAsync((signal) => api.datasets({ source: 'user' }, { signal }), [result])

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

  const problems = {
    file: !file ? 'Choose a CSV file.' : file.size > MAX_BYTES ? 'File is over 5 MB.' : !/\.csv$/i.test(file.name) ? 'The file must be a .csv.' : null,
    utility_id: !ID_PATTERN.test(form.utility_id) ? '2–16 characters: capital letters, digits, underscore; starts with a letter (e.g. SANTEE).' : null,
    source_name: form.source_name.trim().length < 3 ? 'At least 3 characters: the filing or plan this data comes from.' : null,
    attest: !form.attest ? 'Required: confirm the data is public and contains no CEII.' : null,
  }
  const valid = !Object.values(problems).some(Boolean)

  const pick = (f) => {
    if (!f) return
    setFile(f)
    setResult(null)
    setError(null)
  }

  const submit = async (e) => {
    e.preventDefault()
    setTouched(true)
    if (!valid) return
    const fd = new FormData()
    fd.append('file', file)
    fd.append('utility_id', form.utility_id)
    fd.append('source_name', form.source_name.trim())
    fd.append('public_attestation', 'true')
    if (form.utility_name.trim()) fd.append('utility_name', form.utility_name.trim())
    if (form.submitted_by.trim()) fd.append('submitted_by', form.submitted_by.trim())
    if (form.notes.trim()) fd.append('notes', form.notes.trim())
    setSubmitting(true)
    setError(null)
    setResult(null)
    try {
      setResult(await api.uploadDataset(fd, { uploadToken: form.uploadToken.trim() || undefined }))
    } catch (err) {
      setError(err)
      if (err.status === 403 || err.status === 401) setAdvanced(true)
    } finally {
      setSubmitting(false)
    }
  }

  const show = (k) => touched && problems[k]

  return (
    <Layout active="contribute">
      <div className="mx-auto flex max-w-[1180px] flex-col gap-8 px-4 py-10 sm:px-10 lg:flex-row">
        <div className="min-w-0 flex-1">
          <h1 className="mb-1.5 text-2xl font-bold">Contribute a dataset</h1>
          <p className="mb-7 max-w-2xl text-[13px] text-fg-dim">
            Any utility can add its planned projects, with no account required. Valid rows are saved as community data, overlaps with every other utility are computed
            immediately, and invalid rows come back with a reason each. This is StreetVision’s path beyond DESC and Georgia Power.
          </p>

          <form onSubmit={submit} noValidate className="card space-y-7 p-6">
            <Step n="1" title="Download the template">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-ink-700 px-4 py-3">
                <p className="text-[12.5px] text-fg-dim">
                  One row per project. Location: <b className="text-fg">lat_a/lon_a</b> (a substation), plus <b className="text-fg">lat_b/lon_b</b> for a line, or{' '}
                  <b className="text-fg">geometry_wkt</b>. Optional <b className="text-fg">project_type</b>: line_rebuild, new_line, substation, area_package
                  (left blank, it’s worked out from the project name).
                </p>
                <a href={api.templateUrl} className="btn-ghost py-2 text-xs" download>
                  <Download className="h-3.5 w-3.5" /> projects_template.csv
                </a>
              </div>
            </Step>

            <Step n="2" title="Upload your file">
              <label
                onDragOver={(e) => {
                  e.preventDefault()
                  setDrag(true)
                }}
                onDragLeave={() => setDrag(false)}
                onDrop={(e) => {
                  e.preventDefault()
                  setDrag(false)
                  pick(e.dataTransfer.files?.[0])
                }}
                className={`flex cursor-pointer flex-col items-center rounded-xl border-[1.5px] border-dashed px-6 py-8 text-center transition-colors ${
                  drag ? 'border-brand-teal bg-brand-teal-dim/40' : show('file') ? 'border-brand-pink' : 'border-ink-500 hover:border-fg-faint'
                }`}
              >
                <input ref={fileInput} type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
                <FileUp className="mb-2 h-7 w-7 text-fg-faint" aria-hidden="true" />
                {file ? (
                  <span className="text-[13px]">
                    <b>{file.name}</b> <span className="text-fg-faint">· {fmtNum(file.size / 1024, 1)} KB</span>
                  </span>
                ) : (
                  <span className="text-[13px] text-fg-dim">
                    Drop a CSV here, or <span className="font-semibold text-brand-teal">browse files</span>
                  </span>
                )}
                <span className="mt-1 text-[11px] text-fg-faint">CSV in the template format · up to 5 MB</span>
              </label>
              {file && (
                <button
                  type="button"
                  className="mt-2 inline-flex items-center gap-1 text-[11.5px] text-fg-faint hover:text-fg"
                  onClick={() => {
                    setFile(null)
                    if (fileInput.current) fileInput.current.value = ''
                  }}
                >
                  <X className="h-3 w-3" /> Remove file
                </button>
              )}
              <FieldError msg={show('file')} />
            </Step>

            <Step n="3" title="Tell us about the source">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Utility ID *" hint="e.g. SANTEE. Reusing an ID adds to that utility." error={show('utility_id')}>
                  <input
                    className="input font-mono uppercase"
                    value={form.utility_id}
                    onChange={(e) => setForm((f) => ({ ...f, utility_id: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '') }))}
                    maxLength={16}
                    placeholder="SANTEE"
                    aria-invalid={!!show('utility_id')}
                    required
                  />
                </Field>
                <Field label="Utility name">
                  <input className="input" value={form.utility_name} onChange={set('utility_name')} maxLength={200} placeholder="Santee Cooper" />
                </Field>
                <Field
                  label="Source name / filing *"
                  hint="Uploading again with the same source name replaces your earlier version."
                  error={show('source_name')}
                  className="sm:col-span-2"
                >
                  <input className="input" value={form.source_name} onChange={set('source_name')} maxLength={200} placeholder="2026 Santee Cooper Transmission Plan" aria-invalid={!!show('source_name')} required />
                </Field>
                <Field label="Submitted by">
                  <input className="input" value={form.submitted_by} onChange={set('submitted_by')} maxLength={200} placeholder="Name or team (optional)" />
                </Field>
                <Field label="Notes">
                  <input className="input" value={form.notes} onChange={set('notes')} maxLength={2000} placeholder="Anything reviewers should know (optional)" />
                </Field>
              </div>
            </Step>

            <div>
              <label
                className={`flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3.5 ${
                  form.attest ? 'border-brand-teal bg-brand-teal-dim/50' : 'border-brand-pink bg-brand-pink-dim'
                }`}
              >
                <input type="checkbox" checked={form.attest} onChange={set('attest')} className="mt-0.5 h-4 w-4 shrink-0 accent-brand-teal" required />
                <span className="text-[12.5px] leading-relaxed">
                  <b>I confirm this is public data and contains no Critical Energy Infrastructure Information (CEII).</b>{' '}
                  <span className="text-fg-dim">Required. With no accounts, this attestation is what accountability rests on, and it’s stored with the dataset.</span>
                </span>
              </label>
              <FieldError msg={show('attest')} />
            </div>

            <div>
              <button type="button" onClick={() => setAdvanced((a) => !a)} className="flex items-center gap-1 text-[11.5px] text-fg-faint hover:text-fg-dim" aria-expanded={advanced}>
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${advanced ? 'rotate-180' : ''}`} /> Upload token (only if this server requires one)
              </button>
              {advanced && (
                <input className="input mt-2 max-w-sm font-mono" value={form.uploadToken} onChange={set('uploadToken')} placeholder="X-Upload-Token" autoComplete="off" />
              )}
            </div>

            <button type="submit" className="btn-primary w-full py-3 text-[13.5px]" disabled={submitting}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
              {submitting ? 'Validating and computing overlaps…' : 'Submit dataset'}
            </button>
          </form>

          <div aria-live="polite">
            {error && <UploadError error={error} />}
            {result && <UploadResult r={result} />}
          </div>
        </div>

        <div className="w-full shrink-0 space-y-5 lg:w-[340px]">
          <ManageCard datasets={userDatasets} onDeleted={userDatasets.reload} />
          <div className="card p-5 text-[12.5px] leading-relaxed text-fg-dim">
            <h2 className="mb-2 text-[13.5px] font-bold text-fg">What happens to uploads</h2>
            <ul className="list-disc space-y-1.5 pl-4">
              <li>Labeled “community submitted” everywhere, and filterable out with the Source filter.</li>
              <li>Can’t overwrite official DESC or Georgia Power projects.</li>
              <li>Compared against every other utility the moment they’re saved.</li>
              <li>Removable only with the delete token shown once after upload.</li>
            </ul>
          </div>
        </div>
      </div>
    </Layout>
  )
}

function Step({ n, title, children }) {
  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2.5 font-sans text-[13.5px] font-bold">
        <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-ink-600 text-[11px] text-fg-dim">{n}</span>
        {title}
      </h2>
      {children}
    </section>
  )
}

function Field({ label, hint, error, className = '', children }) {
  return (
    <label className={`block ${className}`}>
      <span className="label">{label}</span>
      {children}
      {error ? <FieldError msg={error} /> : hint && <span className="mt-1 block text-[11px] text-fg-faint">{hint}</span>}
    </label>
  )
}

function FieldError({ msg }) {
  if (!msg) return null
  return (
    <span role="alert" className="mt-1.5 flex items-center gap-1 text-[11.5px] text-brand-pink">
      <AlertTriangle className="h-3 w-3 shrink-0" /> {msg}
    </span>
  )
}

function RowErrors({ errors }) {
  if (!errors?.length) return null
  return (
    <div className="scroll-thin mt-3 max-h-56 overflow-y-auto rounded-lg border border-ink-500">
      <table className="w-full text-left text-[12px]">
        <thead className="sticky top-0 bg-ink-700 text-fg-faint">
          <tr>
            <th scope="col" className="px-3 py-2 font-semibold">Row</th>
            <th scope="col" className="px-3 py-2 font-semibold">Project</th>
            <th scope="col" className="px-3 py-2 font-semibold">Problem</th>
          </tr>
        </thead>
        <tbody>
          {errors.map((e, i) => (
            <tr key={i} className="border-t border-ink-600">
              <td className="px-3 py-2 font-mono text-fg-dim">{e.row}</td>
              <td className="px-3 py-2 font-mono text-fg-dim">{e.project_id ?? '—'}</td>
              <td className="px-3 py-2">{e.error}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function UploadError({ error }) {
  const hint =
    error.status === 403 || error.status === 401
      ? ' This server requires an upload token. Enter it under “Upload token” and try again.'
      : error.status === 413
        ? ' Split the file into smaller parts.'
        : ''
  return (
    <div role="alert" className="animate-in mt-5 rounded-2xl border border-brand-pink bg-brand-pink-dim p-5">
      <div className="mb-1 flex items-center gap-2 text-sm font-bold text-brand-pink">
        <AlertTriangle className="h-4 w-4" /> Upload not saved
      </div>
      <p className="text-[12.5px] text-fg">
        {error.message}
        {hint}
      </p>
      <RowErrors errors={error.errors} />
    </div>
  )
}

function UploadResult({ r }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(r.delete_token)
      setCopied(true)
    } catch {
      /* select the text manually */
    }
  }
  const saveToken = () =>
    downloadBlob(
      `streetvision-dataset-${r.dataset.dataset_id}-delete-token.txt`,
      `StreetVision dataset ${r.dataset.dataset_id} (${r.dataset.utility_id}: ${r.dataset.source_name})\nDelete token: ${r.delete_token}\n\nKeep this file. It is the only way to delete this upload.\n`,
      'text/plain',
    )
  return (
    <div className="animate-in mt-5 space-y-4">
      <div className="rounded-2xl border border-brand-teal bg-brand-teal-dim/60 p-5">
        <div className="mb-2 flex items-center gap-2 text-sm font-bold">
          <CheckCircle2 className="h-4 w-4 text-brand-teal" />
          {r.rows_accepted} of {r.rows_received} rows accepted · {r.new_overlaps} new overlap{r.new_overlaps === 1 ? '' : 's'} found
        </div>
        <p className="text-[12.5px] text-fg-dim">
          Saved as dataset <b className="text-fg">#{r.dataset.dataset_id}</b> for <b className="text-fg">{r.dataset.utility_id}</b>.
          {r.rows_rejected > 0 && ` ${r.rows_rejected} row${r.rows_rejected === 1 ? ' was' : 's were'} rejected; fix and re-upload with the same source name to replace this version.`}
        </p>
        <RowErrors errors={r.errors} />
        <div className="mt-4 flex flex-wrap gap-2">
          <a className="btn-primary py-2 text-xs" href={`/?utilities=${r.dataset.utility_id}`}>
            <MapIcon className="h-3.5 w-3.5" /> See {r.dataset.utility_id} overlaps on the map
          </a>
          <a className="btn-ghost py-2 text-xs" href={`/dataset/?id=${r.dataset.dataset_id}`}>
            View dataset page
          </a>
        </div>
      </div>
      <div className="rounded-2xl border border-brand-amber bg-brand-amber-dim p-5">
        <div className="mb-1 text-sm font-bold text-brand-amber">Save your delete token now</div>
        <p className="mb-3 text-[12.5px] text-fg-dim">It’s shown only once and can’t be recovered. It’s the only way to remove this upload later.</p>
        <div className="flex flex-wrap gap-2">
          <code className="min-w-0 flex-1 select-all break-all rounded-lg bg-ink px-3 py-2 font-mono text-[12px]">{r.delete_token}</code>
          <button type="button" className="btn-ghost py-2 text-xs" onClick={copy}>
            {copied ? <Check className="h-3.5 w-3.5 text-brand-teal" /> : <Copy className="h-3.5 w-3.5" />} {copied ? 'Copied' : 'Copy'}
          </button>
          <button type="button" className="btn-ghost py-2 text-xs" onClick={saveToken}>
            <Download className="h-3.5 w-3.5" /> Save .txt
          </button>
        </div>
      </div>
    </div>
  )
}

function ManageCard({ datasets, onDeleted }) {
  const [id, setId] = useState('')
  const [token, setToken] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const list = datasets.data ?? []
  const chosen = list.find((d) => String(d.dataset_id) === id)

  const del = async (e) => {
    e.preventDefault()
    if (!confirm) {
      setConfirm(true)
      return
    }
    setBusy(true)
    setMsg(null)
    try {
      const r = await api.deleteDataset(id, token.trim())
      setMsg({ ok: true, text: `Deleted dataset #${r.deleted}: ${r.projects_removed} projects and ${r.overlaps_removed} overlaps removed.` })
      setId('')
      setToken('')
      onDeleted()
    } catch (err) {
      setMsg({ ok: false, text: err.status === 403 ? 'That token doesn’t match this dataset.' : err.message })
    } finally {
      setBusy(false)
      setConfirm(false)
    }
  }

  return (
    <form onSubmit={del} className="card p-5">
      <h2 className="mb-2 flex items-center gap-2 font-sans text-[13.5px] font-bold">
        <ShieldCheck className="h-4 w-4 text-brand-teal" /> Manage a submission
      </h2>
      <p className="mb-4 text-[12px] leading-relaxed text-fg-dim">No accounts means no login to come back to. Use the delete token shown after your upload to remove your own dataset.</p>
      {datasets.error && <ErrorState error={datasets.error} className="mb-3 p-3" />}
      <label className="mb-3 block">
        <span className="label">Dataset</span>
        <select className="input" value={id} onChange={(e) => (setId(e.target.value), setConfirm(false))} required>
          <option value="">{list.length ? 'Choose a community dataset…' : 'No community datasets yet'}</option>
          {list.map((d) => (
            <option key={d.dataset_id} value={d.dataset_id}>
              #{d.dataset_id} · {d.utility_id} · {d.source_name.slice(0, 40)}
            </option>
          ))}
        </select>
      </label>
      {chosen && (
        <p className="mb-3 text-[11.5px] text-fg-faint">
          {chosen.projects} projects · submitted {fmtDateTime(chosen.created_at)}
          {chosen.submitted_by ? ` by ${chosen.submitted_by}` : ''}
        </p>
      )}
      <label className="mb-4 block">
        <span className="label">Delete token</span>
        <input className="input font-mono" value={token} onChange={(e) => (setToken(e.target.value), setConfirm(false))} placeholder="Paste token…" autoComplete="off" required />
      </label>
      <button type="submit" className={confirm ? 'btn-pink w-full' : 'btn-danger w-full'} disabled={busy || !id || !token.trim()}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
        {confirm ? 'Click again to permanently delete' : 'Delete dataset'}
      </button>
      {msg && (
        <p role="status" className={`mt-3 text-[12px] ${msg.ok ? 'text-brand-teal' : 'text-brand-pink'}`}>
          {msg.text}
        </p>
      )}
    </form>
  )
}
