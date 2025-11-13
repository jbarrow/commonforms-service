import React, { useEffect, useRef, useState } from "react";

type ModelChoice = "small" | "large";
type JobState = "enqueued" | "running" | "success" | "failure";

interface PreparationConfig {
  model: ModelChoice;
  sensitivity: number;
  use_signature_fields: boolean;
  keep_existing_fields: boolean;
}

interface PrepareRequest {
  documentId: string;
  config: PreparationConfig;
}

interface DocumentResponse {
  documentId: string;
  pages: number;
  size: number;
}

interface StatusResponse {
  status: JobState;
  run_time: number;
  queue_time: number;
}

//set API_BASE with your own modal username
const API_BASE = "https://<modal-username>--form-preparation-form-preparation.modal.run";
const POLL_MS = 1500;

const API = {
  async upload(file: File): Promise<DocumentResponse> {
    const form = new FormData();
    form.append("file", file, file.name);
    const res = await fetch(`${API_BASE}/upload`, { method: "POST", body: form });
    if (!res.ok) throw new Error(`Upload failed (${res.status})`);
    return res.json();
  },

  async startDetect(req: PrepareRequest): Promise<StatusResponse> {
    const res = await fetch(`${API_BASE}/detect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
    if (!res.ok) throw new Error(`Detect failed (${res.status})`);
    return res.json();
  },

  async pollStatus(documentId: string): Promise<StatusResponse> {
    const res = await fetch(`${API_BASE}/poll?documentId=${documentId}`, { method: "GET" });
    if (!res.ok) throw new Error(`Status failed (${res.status})`);
    return res.json();
  },

  getDownloadUrl(documentId: string): string {
    return `${API_BASE}/download?documentId=${documentId}`;
  },
};

export function mapChoiceToModel(choice: "quick" | "standard" | "enhanced"): ModelChoice {
  return choice === "enhanced" ? "large" : "small";
}

export function buildPrepareRequest(
  documentId: string,
  choice: "quick" | "standard" | "enhanced",
  useTextboxesForSignatures: boolean,
  keepExisting: boolean,
  sensitivity: number,
): PrepareRequest {
  return {
    documentId,
    config: {
      model: mapChoiceToModel(choice),
      sensitivity: sensitivity, // Convert 0-100 to 0-1 for API
      use_signature_fields: !useTextboxesForSignatures,
      keep_existing_fields: keepExisting,
    },
  };
}

// Main Component
export default function FormPreparation() {
  const [file, setFile] = useState<File | null>(null);
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const [choice, setChoice] = useState<"quick" | "standard" | "enhanced">("standard");

  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [sensitivity, setSensitivity] = useState(3);
  const [useTextboxesForSignatures, setUseTextboxesForSignatures] = useState(false);
  const [keepExisting, setKeepExisting] = useState(false);

  const [state, setState] = useState<JobState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const working = state === "enqueued" || state === "running";

  // Poller - polls using documentId instead of jobId
  useEffect(() => {
    if (!documentId || !state || state === "success" || state === "failure") return;
    let timer: ReturnType<typeof setInterval> | null = null;

    const tick = async () => {
      try {
        const res = await API.pollStatus(documentId);
        setState(res.status);
        if (res.status === "success") {
          // Automatically trigger download when ready
          window.location.href = API.getDownloadUrl(documentId);
        }
        if (res.status === "success" || res.status === "failure") {
          if (timer) clearInterval(timer);
        }
      } catch (e: any) {
        setState("failure");
        setError(e?.message ?? "Polling failed");
        if (timer) clearInterval(timer);
      }
    };

    tick();
    timer = setInterval(tick, POLL_MS);
    return () => { if(timer) { clearInterval(timer) } };
  }, [documentId, state]);

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
      if (e.currentTarget) { e.currentTarget.value = "" };
    }
  };

  const onStart = async () => {
    if (!documentId) return;
    setError(null);
    setState("enqueued");
    try {
      const req: PrepareRequest = buildPrepareRequest(
        documentId,
        choice,
        useTextboxesForSignatures,
        keepExisting,
        sensitivity,
      );
      const res = await API.startDetect(req);
      setState(res.status);
    } catch (e: any) {
      setError(e?.message ?? "Failed to start job");
      setState("failure");
    }
  };

  const onReset = () => {
    setFile(null);
    setDocumentId(null);
    setState(null);
    setError(null);
  };

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
        className={`flex w-full flex-col gap-3 border-2 p-5 text-left transition-all ${
          active
            ? "border-neutral-900 bg-yellow-50 shadow-[3px_3px_0_0_#111]"
            : "border-neutral-300 bg-white hover:border-neutral-400 hover:shadow-[2px_2px_0_0_#d4d4d4]"
        }`}
      >
        <div className="flex items-center gap-3">
          <div className={`h-10 w-10 flex items-center justify-center border-2 transition-all ${
            active
              ? "border-neutral-900 bg-yellow-300"
              : "border-neutral-300 bg-neutral-100"
          }`}>
            <span className="font-mono text-lg font-bold">{title[0]}</span>
          </div>
          <div className="font-mono text-lg font-bold">{title}</div>
        </div>
        <ul className="ml-[52px] space-y-1.5 font-mono text-xs text-neutral-600">
          {desc.map((d, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="text-neutral-400">•</span>
              <span>{d}</span>
            </li>
          ))}
        </ul>
      </button>
    );
  };

  return (
    <div className="min-h-screen bg-[#f3f3ef] text-neutral-900">
      <main className="mx-auto max-w-4xl px-6 py-10">
        <div className="border-2 border-neutral-900 bg-white shadow-[6px_6px_0_0_#111]">
          {/* Header */}
          <div className="bg-neutral-50 p-6 border-b-2 border-neutral-200">
            <h1 className="font-mono text-xl font-bold text-neutral-900">PDF &rarr; Fillable Form</h1>
            <p className="mt-1 font-mono text-sm text-neutral-600">
              Upload a PDF and automatically make it fillable using AI.&nbsp;
                  <a className="underline text-yellow-500 font-medium hover:text-yellow-400" href="https://github.com/jbarrow/commonforms" target="_blank">Built on our open models</a>.
            </p>
          </div>

          <div className="p-6 space-y-6">
            {/* File Upload Section */}
            <div>
              <label className="font-mono text-sm font-bold mb-2 block">Upload PDF</label>
              <div className="flex items-center gap-3 flex-wrap">
                <input ref={fileInputRef} type="file" accept="application/pdf" className="hidden" onChange={onFileChange} />
                <button
                  type="button"
                  onClick={onPickFile}
                  disabled={uploading || working}
                  className={`border-2 border-neutral-900 px-5 py-2 font-mono text-sm transition-all ${
                    uploading || working
                      ? "cursor-not-allowed bg-neutral-200 text-neutral-500"
                      : "bg-white hover:bg-neutral-50"
                  }`}
                >
                  {uploading ? "Uploading..." : "Choose File"}
                </button>

                {uploading && (
                  <div className="flex items-center gap-2 font-mono text-sm text-neutral-600">
                    <div className="h-3 w-3 border-2 border-neutral-600 border-t-transparent rounded-full animate-spin" />
                    <span>Uploading...</span>
                  </div>
                )}

                {file && !uploading && (
                  <div className="flex items-center gap-2 font-mono text-sm">
                    <span className="text-neutral-900">{file.name}</span>
                    <button onClick={onReset} className="text-neutral-600 hover:text-neutral-900">✕</button>
                  </div>
                )}

                {!file && !uploading && (
                  <span className="font-mono text-sm text-neutral-500">No file selected</span>
                )}
              </div>
            </div>

            {/* Pipeline Selection */}
            {file && (
              <div className="border-t-2 border-neutral-200 pt-6">
                <label className="font-mono text-sm font-bold mb-3 block">Select Pipeline</label>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <PipelineCard id="quick" title="Quick" desc={["Takes 0.5–2 seconds", "Best for scans", "Highest sensitivity"]} />
                  <PipelineCard id="standard" title="Standard" desc={["Takes 2–4 seconds", "Best for most forms", "Balanced sensitivity"]} />
                </div>
              </div>
            )}

            {/* Advanced Settings */}
            {file && (
              <div className="border-t-2 border-neutral-200 pt-6">
                <button
                  type="button"
                  className="font-mono text-sm font-bold mb-3 flex items-center gap-2 hover:text-neutral-600 transition-colors"
                  onClick={() => setAdvancedOpen((v) => !v)}
                >
                  <span className={`transition-transform ${advancedOpen ? "rotate-90" : ""}`}>▶</span>
                  <span>Advanced Settings</span>
                </button>

                {advancedOpen && (
                  <div className="pl-7 space-y-4">
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label className="font-mono text-sm">Detection Sensitivity</label>
                        <span className="font-mono text-sm text-neutral-600">{sensitivity}</span>
                      </div>
                      <input
                        type="range"
                        min={1}
                        max={5}
                        value={sensitivity}
                        onChange={(e) => setSensitivity(parseInt(e.target.value, 10))}
                        className="w-full"
                      />
                      <div className="mt-1 flex justify-between font-mono text-xs text-neutral-500">
                        <span>Conservative</span>
                        <span>Aggressive</span>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Toggle label="Use Textboxes for Signatures" value={useTextboxesForSignatures} onChange={setUseTextboxesForSignatures} />
                      <Toggle label="Keep Existing Fields" value={keepExisting} onChange={setKeepExisting} />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Action row */}
            {file && (
              <div className="border-t-2 border-neutral-200 pt-6">
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    disabled={!documentId || working}
                    onClick={onStart}
                    className={`border-2 border-neutral-900 px-6 py-3 font-mono text-sm font-bold transition-all ${
                      !documentId || working
                        ? "cursor-not-allowed bg-neutral-200 text-neutral-500"
                        : "bg-yellow-300 hover:bg-yellow-400"
                    }`}
                  >
                    {working ? "Processing..." : "Start Detection"}
                  </button>

                  {/* Status indicators */}
                  {state === "enqueued" && (
                    <div className="flex items-center gap-2 font-mono text-sm text-neutral-600">
                      <div className="h-2 w-2 bg-blue-600 rounded-full animate-pulse" />
                      <span>Queued</span>
                    </div>
                  )}
                  {state === "running" && (
                    <div className="flex items-center gap-2 font-mono text-sm text-neutral-600">
                      <div className="h-3 w-3 border-2 border-neutral-600 border-t-transparent rounded-full animate-spin" />
                      <span>Processing...</span>
                    </div>
                  )}
                  {state === "success" && (
                    <div className="flex items-center gap-2 font-mono text-sm text-green-600">
                      <span>✓</span>
                      <span>Complete</span>
                    </div>
                  )}
                  {state === "failure" && (
                    <div className="flex items-center gap-2 font-mono text-sm text-red-600">
                      <span>✕</span>
                      <span>Failed</span>
                    </div>
                  )}
                </div>

                {error && (
                  <div className="mt-3 p-3 bg-red-50 border border-red-200">
                    <span className="font-mono text-sm text-red-900">{error}</span>
                  </div>
                )}

                {documentId && state === "success" && (
                  <div className="mt-4 p-4 bg-green-50 border-2 border-green-600">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-sm font-bold">Your fillable PDF is ready</span>
                      <a
                        href={API.getDownloadUrl(documentId)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="border-2 border-neutral-900 bg-yellow-300 px-5 py-2 font-mono text-sm font-bold hover:bg-yellow-400 transition-colors"
                      >
                        Download PDF
                      </a>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer Notice */}
        <div className="mt-6 border-2 border-neutral-300 bg-white/50 backdrop-blur-sm p-5 shadow-[3px_3px_0_0_rgba(0,0,0,0.1)]">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <p className="font-mono text-xs text-neutral-600 leading-relaxed">
              All documents get auto-deleted shortly after running.
            </p>
            <a
              href="https://github.com/jbarrow/commonforms"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 font-mono text-xs font-medium text-neutral-900 hover:text-yellow-600 transition-colors whitespace-nowrap"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
              </svg>
              <span>View on GitHub</span>
            </a>
          </div>
        </div>
      </main>
    </div>
  );
}

// Toggle component
function Toggle({ label, value, onChange, disabled }: { label: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={`flex items-center justify-between gap-4 font-mono text-sm ${disabled ? "opacity-50" : ""}`}>
      <span>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        onClick={() => !disabled && onChange(!value)}
        className={`relative h-6 w-11 rounded-full border transition ${
          value ? "border-neutral-900 bg-yellow-300" : "border-neutral-300 bg-white"
        }`}
      >
        <span className={`absolute top-0.5 left-0.5 inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${value ? "translate-x-5" : ""}`} />
      </button>
    </label>
  );
}
