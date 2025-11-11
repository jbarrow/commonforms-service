import React, { useEffect, useRef, useState } from "react";

type ModelChoice = "small" | "large"; // map UI → API

type JobState = "enqueued" | "running" | "success" | "error";

interface PreparationConfig {
  model: ModelChoice; // "small" or "large"
  use_signatures: boolean; // API: create signature fields
  clear_fields: boolean; // API: clear existing fields first
  sensitivity: number;
}

interface PrepareRequest {
  documentId: string; // returned from upload
  config: PreparationConfig;
}

interface PrepareResponse {
  job_id: string;
  state: JobState;
  message?: string;
}

interface JobStatusResponse {
  state: JobState;
  download_url?: string; // optional direct URL if your API returns one
  message?: string;
}

const API_BASE = "https://jbarrow--form-preparation-form-preparation.modal.run";
const POLL_MS = 1500;

const API = {
  async upload(file: File): Promise<{ documentId: string }> {
    const form = new FormData();
    form.append("file", file, file.name);
    const res = await fetch(`${API_BASE}/upload`, { method: "POST", body: form });
    if (!res.ok) throw new Error(`Upload failed (${res.status})`);
    return res.json();
  },

  async startPrepare(req: PrepareRequest): Promise<PrepareResponse> {
    const res = await fetch(`${API_BASE}/prepare`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
    if (!res.ok) throw new Error(`Prepare failed (${res.status})`);
    return res.json();
  },

  async getStatus(jobId: string): Promise<JobStatusResponse> {
    const res = await fetch(`${API_BASE}/jobs/${jobId}`, { method: "GET" });
    if (!res.ok) throw new Error(`Status failed (${res.status})`);
    return res.json();
  },
};


export function mapChoiceToModel(choice: "quick" | "standard" | "enhanced"): ModelChoice {
  return choice === "enhanced" ? "large" : "small";
}

export function buildPrepareRequest(
  documentId: string,
  choice: "quick" | "standard" | "enhanced",
  useTextboxesForSignatures: boolean,
  clearExisting: boolean,
  sensitivity: number,
): PrepareRequest {
  return {
    documentId,
    config: {
      model: mapChoiceToModel(choice),
      use_signatures: !useTextboxesForSignatures,
      clear_fields: clearExisting,
      sensitivity: sensitivity
    },
  };
}

// =====================
// UI helpers
// =====================

const Card: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = "" }) => (
  <div className={`border-2 border-neutral-900 bg-white shadow-[6px_6px_0_0_#111] ${className}`}>{children}</div>
);

const Pill: React.FC<{ tone: "idle" | "ok" | "warn" | "err" | "info"; children: React.ReactNode }> = ({ tone, children }) => {
  const map: Record<string, string> = {
    idle: "bg-neutral-200 text-neutral-800",
    ok: "bg-green-200 text-green-950",
    warn: "bg-yellow-200 text-yellow-950",
    err: "bg-red-200 text-red-950",
    info: "bg-blue-200 text-blue-950",
  };
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 font-mono text-xs ${map[tone]}`}>{children}</span>;
};

// =====================
// Main Component
// =====================

export default function FillableFormPage() {
  // Upload state
  const [file, setFile] = useState<File | null>(null);
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  // Pipeline state
  const [choice, setChoice] = useState<"quick" | "standard" | "enhanced">("standard");

  // Advanced (UI-only extras besides API fields)
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [sensitivity, setSensitivity] = useState(50); // UI only
  const [useTextboxesForSignatures, setUseTextboxesForSignatures] = useState(false); // maps inversely to use_signatures
  const [clearExisting, setClearExisting] = useState(false);

  // Job state
  const [jobId, setJobId] = useState<string | null>(null);
  const [state, setState] = useState<JobState | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const working = state === "enqueued" || state === "running";

  // Poller
  useEffect(() => {
    if (!jobId) return;
    let timer: ReturnType<typeof setInterval> | null = null;

    const tick = async () => {
      try {
        const res = await API.getStatus(jobId);
        setState(res.state);
        if (res.download_url) setDownloadUrl(res.download_url);
        if (res.state === "success" || res.state === "error") {
          if (timer) clearInterval(timer);
        }
      } catch (e: any) {
        setState("error");
        setError(e?.message ?? "Polling failed");
        if (timer) clearInterval(timer);
      }
    };

    tick(); // immediate
    timer = setInterval(tick, POLL_MS);
    return () => { if(timer) { clearInterval(timer) } };
  }, [jobId]);

  // Handlers
  const onPickFile = () => fileInputRef.current?.click();
  const onFileChange: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setError(null);
    setUploading(true);
    try {
      const { documentId } = await API.upload(f);
      setDocumentId(documentId);
    } catch (err: any) {
      setError(err?.message ?? "Upload failed");
      setFile(null);
      setDocumentId(null);
    } finally {
      setUploading(false);
      if (e.currentTarget) { e.currentTarget.value = "" }; // allow re-picking same file
    }
  };

  const onStart = async () => {
    if (!documentId) return;
    setError(null);
    setState("enqueued");
    setJobId(null);
    setDownloadUrl(null);
    try {
      const req: PrepareRequest = buildPrepareRequest(
        documentId,
        choice,
        useTextboxesForSignatures,
        clearExisting,
        sensitivity,
      );
      const res = await API.startPrepare(req);
      setJobId(res.job_id);
      setState(res.state);
    } catch (e: any) {
      setError(e?.message ?? "Failed to start job");
      setState("error");
    }
  };

  const onReset = () => {
    setFile(null);
    setDocumentId(null);
    setJobId(null);
    setState(null);
    setDownloadUrl(null);
    setError(null);
  };

  // UI bits
  const PipelineCard: React.FC<{
    id: "quick" | "standard" | "enhanced";
    title: string;
    desc: string[];
  }> = ({ id, title, desc }) => {
    const active = choice === id;
    return (
      <button
        type="button"
        onClick={() => setChoice(id)}
        className={`flex w-full flex-col gap-2 border p-4 text-left transition ${
          active ? "border-neutral-900" : "border-neutral-300 hover:bg-neutral-50"
        }`}
      >
        <div className="flex items-center gap-2">
          <div className={`h-8 w-8 rounded ${active ? "bg-yellow-300" : "bg-neutral-200"}`} />
          <div className="font-mono text-lg">{title}</div>
        </div>
        <ul className="ml-10 list-disc space-y-1 font-mono text-xs text-neutral-700">
          {desc.map((d, i) => (
            <li key={i}>{d}</li>
          ))}
        </ul>
      </button>
    );
  };

  return (
    <div className="min-h-screen bg-[#f3f3ef] text-neutral-900">
      <main className="mx-auto max-w-4xl px-6 py-10">
        <Card className="p-6">
          <div className="flex items-start gap-3">
            <div className="mt-1 h-3 w-3 rounded-full bg-yellow-400" />
            <div>
              <h1 className="font-mono text-2xl">PDF &rarr; Fillable Form AI</h1>
              <p className="mt-1 max-w-2xl font-mono text-sm text-neutral-700">
                Upload your PDF and get a fillable form. <a target="_blank" href="https://github.com/jbarrow/commonforms">Our AI automatically detects</a> and insert the form fields for you.
              </p>
            </div>
          </div>

          {/* File picker */}
          <div className="mt-6">
            <label className="font-mono text-sm">Select a PDF to Upload <span className="text-neutral-500">(1 file)</span></label>
            <div className="mt-2 flex items-center gap-3">
              <input ref={fileInputRef} type="file" accept="application/pdf" className="hidden" onChange={onFileChange} />
              <button
                type="button"
                onClick={onPickFile}
                disabled={uploading}
                className={`border px-4 py-2 font-mono text-sm ${uploading ? "cursor-not-allowed bg-neutral-100" : "bg-white hover:bg-neutral-50"}`}
              >
                {uploading ? "Uploading…" : "Choose File"}
              </button>
              <span className="font-mono text-sm text-neutral-700">{file ? file.name : "no file selected"}</span>
              {file && (
                <button onClick={onReset} className="font-mono text-xs text-neutral-600 underline">remove</button>
              )}
            </div>
          </div>

          {/* Pipeline */}
          <div className="mt-8">
            <div className="font-mono text-sm">Select an AI Pipeline</div>
            <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
              <PipelineCard id="quick" title="Quick" desc={["Takes 0.5–2 seconds", "Best for scans", "Highest sensitivity"]} />
              <PipelineCard id="standard" title="Standard" desc={["Takes 2–4 seconds", "Best for most forms", "Balanced sensitivity"]} />
            </div>
          </div>

          {/* Advanced Settings */}
          <div className="mt-6">
            <button
              type="button"
              className="font-mono text-sm text-neutral-700 underline"
              onClick={() => setAdvancedOpen((v) => !v)}
            >
              {advancedOpen ? "Hide Advanced Settings" : "Show Advanced Settings"}
            </button>

            {advancedOpen && (
              <div className="mt-4 rounded border border-neutral-200 p-4">
                <div className="font-mono text-sm text-neutral-800">Detection Sensitivity</div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={sensitivity}
                  onChange={(e) => setSensitivity(parseInt(e.target.value, 10))}
                  className="mt-2 w-full"
                />
                <div className="mt-1 flex justify-between font-mono text-xs text-neutral-600">
                  <span>Fewer Form Fields</span>
                  <span>Default</span>
                  <span>More Form Fields</span>
                </div>

                <div className="mt-4 grid gap-2">
                  <Toggle label="Use Textboxes for Signatures" value={useTextboxesForSignatures} onChange={setUseTextboxesForSignatures} />
                  <Toggle label="Clear Existing Fields" value={clearExisting} onChange={setClearExisting} />
                </div>
              </div>
            )}
          </div>

          {/* Action row */}
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={!documentId || working}
              onClick={onStart}
              className={`border px-5 py-2 font-mono text-sm ${
                !documentId || working ? "cursor-not-allowed bg-neutral-100" : "bg-yellow-300 hover:brightness-95"
              }`}
            >
              Upload and Process
            </button>

            {/* Status chips */}
            {state && (
              <div className="flex items-center gap-2">
                {state === "enqueued" && <Pill tone="info">Queued</Pill>}
                {state === "running" && <Pill tone="warn">Processing…</Pill>}
                {state === "success" && <Pill tone="ok">Ready</Pill>}
                {state === "error" && <Pill tone="err">Error</Pill>}
              </div>
            )}

            {downloadUrl && state === "success" && (
              <a
                href={downloadUrl}
                download={file ? file.name.replace(/\.pdf$/i, "_fillable.pdf") : "fillable.pdf"}
                className="ml-auto border border-neutral-900 bg-white px-4 py-2 font-mono text-sm hover:bg-neutral-50"
              >
                Download Fillable PDF
              </a>
            )}

            {error && <div className="font-mono text-sm text-red-600">{error}</div>}
          </div>
        </Card>
      </main>
    </div>
  );
}

// =====================
// Small Toggle component
// =====================
function Toggle({ label, value, onChange, disabled }: { label: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={`flex items-center justify-between gap-4 font-mono text-sm ${disabled ? "opacity-50" : ""}`}>
      <span>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        onClick={() => !disabled && onChange(!value)}
        className={`h-6 w-11 rounded-full border transition ${
          value ? "border-neutral-900 bg-yellow-300" : "border-neutral-300 bg-white"
        }`}
      >
        <span className={`ml-0.5 mt-0.5 inline-block h-5 w-5 rounded-full bg-white shadow transition ${value ? "translate-x-5" : ""}`} />
      </button>
    </label>
  );
}

