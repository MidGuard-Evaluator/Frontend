"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { PageImage } from "@/components/PageImage";
import { StudentMcqVerificationCard } from "@/components/StudentMcqVerificationCard";
import { StudentOcrVerificationCard } from "@/components/StudentOcrVerificationCard";
import { StudentPageCropperModal } from "@/components/StudentPageCropperModal";
import { Alert, Badge, Button, Card, CardHeader, Modal, PageHeader } from "@/components/ui";
import { createMaskedCopy, formatBytes, loadImage, putBlob } from "@/lib/image-utils";
import { MAX_FILE_BYTES, MAX_IMAGES_PER_SCRIPT, orderedImages, pseudonym, uid } from "@/lib/logic";
import { useStore } from "@/lib/store";
import type { PaperType, Rect, Script, ScriptImage, UploadFailure } from "@/lib/types";

const AUTO_HEADER_RECT: Rect = { x: 5, y: 2.4, width: 90, height: 12.5 };

const PAPER_TYPE_OPTIONS: { value: PaperType; title: string; desc: string }[] = [
  {
    value: "STRUCTURED",
    title: "Structured / Written Script",
    desc: "Handwritten short-answer, derivation, or essay responses across up to 10 pages.",
  },
  {
    value: "MCQ",
    title: "Multiple-Choice (MCQ) Sheet",
    desc: "Bubble sheet or structured multiple-choice answer grid evaluated as a single sheet.",
  },
];

function paperTypeLabel(t?: PaperType): string {
  return PAPER_TYPE_OPTIONS.find((o) => o.value === t)?.title ?? "Not selected";
}

type StagedPage = {
  id: string;
  file: File;
  previewUrl?: string;
  width?: number;
  height?: number;
  error?: string;
  progress: number;
  status: "staged" | "uploading" | "done" | "failed";
};

const OK_TYPES = ["image/jpeg", "image/png"];
const OK_EXT = /\.(jpe?g|png)$/i;

export function StudentScriptUpload() {
  const { state, user, actions } = useStore();
  const studentId = user?.studentId ?? user?.username ?? "";

  // Locate this student's script via identity map or session pseudonymousCode
  const mappedEntry = state.identityMap.find((m) => m.realStudentId === studentId);
  const scriptCode = mappedEntry?.pseudonymousCode ?? user?.pseudonymousCode ?? undefined;
  const script: Script | undefined = scriptCode ? state.scripts.find((s) => s.pseudonymousCode === scriptCode) : undefined;

  const pages = useMemo(() => (script ? orderedImages(script) : []), [script]);
  const scriptAnswers = useMemo(
    () => (script ? state.answers.filter((a) => a.scriptId === script.id) : []),
    [script, state.answers],
  );
  const hasResultsReleased = (state.studentResults[studentId]?.length ?? 0) > 0;
  const hasApprovedTranscripts =
    Boolean(script?.mcqExtraction?.verified) ||
    scriptAnswers.some((a) =>
      a.versions.some((v) => v.version === a.activeVersion && v.approvalStatus === "APPROVED"),
    );
  const allMaskedOrNoHeader = pages.length > 0 && pages.every((p) => p.maskStatus !== "PENDING");

  const [staged, setStaged] = useState<StagedPage[]>([]);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "green" | "amber" | "red"; title: string; text: string } | null>(null);
  const [croppingImage, setCroppingImage] = useState<ScriptImage | null>(null);
  const [draggedPageIndex, setDraggedPageIndex] = useState<number | null>(null);
  const [dragOverPageIndex, setDragOverPageIndex] = useState<number | null>(null);
  const [paperType, setPaperType] = useState<PaperType | null>(script?.paperType ?? null);
  const [draftPaperType, setDraftPaperType] = useState<PaperType>(script?.paperType ?? "STRUCTURED");
  const [paperModalOpen, setPaperModalOpen] = useState<boolean>(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const initialPromptDone = useRef<boolean>(false);

  // Sync paperType when script loads or changes, and prompt on first visit if not chosen yet
  useEffect(() => {
    if (script?.paperType) {
      setPaperType(script.paperType);
      setDraftPaperType(script.paperType);
    } else if (!paperType && !initialPromptDone.current) {
      initialPromptDone.current = true;
      setPaperModalOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [script?.id, script?.paperType]);

  function confirmPaperTypeSelection() {
    setPaperType(draftPaperType);
    if (script) {
      actions.setScriptPaperType(script.id, draftPaperType);
    }
    setPaperModalOpen(false);
  }

  function handleClosePaperModal() {
    if (!paperType) {
      setPaperType(draftPaperType);
      if (script) {
        actions.setScriptPaperType(script.id, draftPaperType);
      }
    }
    setPaperModalOpen(false);
  }

  async function validateFile(file: File): Promise<StagedPage> {
    const item: StagedPage = { id: uid("stg"), file, progress: 0, status: "staged" };
    if (!OK_TYPES.includes(file.type) || !OK_EXT.test(file.name)) {
      item.error = `Unsupported file format (${file.type || "unknown"}). Only JPEG and PNG images are accepted.`;
    } else if (file.size > MAX_FILE_BYTES) {
      item.error = `File is ${formatBytes(file.size)}; maximum allowed size is 10 MB per page.`;
    } else {
      item.previewUrl = URL.createObjectURL(file);
      try {
        const im = await loadImage(item.previewUrl);
        item.width = im.naturalWidth;
        item.height = im.naturalHeight;
      } catch {
        item.error = "Unable to decode image. Please upload a valid JPEG or PNG file.";
      }
    }
    return item;
  }

  async function handleFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList);
    if (!files.length) return;
    const validated = await Promise.all(files.map(validateFile));
    setStaged((prev) => [...prev, ...validated]);
    setNotice(null);
  }

  async function submitFiles() {
    if (!staged.length) return;
    setBusy(true);
    setNotice(null);

    const pending = staged.filter((s) => s.status !== "done");
    setStaged((prev) => prev.map((s) => (s.status !== "done" ? { ...s, status: "uploading", progress: 0 } : s)));

    for (let step = 1; step <= 8; step++) {
      await new Promise((r) => setTimeout(r, 75));
      setStaged((prev) =>
        prev.map((s) =>
          s.status === "uploading" ? { ...s, progress: s.error ? Math.min(step * 12, 40) : Math.round((step / 8) * 100) } : s,
        ),
      );
    }

    const accepted: ScriptImage[] = [];
    const failures: UploadFailure[] = [];
    const nextStatus = new Map<string, StagedPage["status"]>();
    const targetCode = scriptCode || pseudonym();
    const existingCount = pages.length;

    for (const s of pending) {
      if (s.error) {
        failures.push({
          id: uid("fail"),
          fileName: s.file.name,
          scriptCode: targetCode,
          reason: s.error,
          at: new Date().toISOString(),
        });
        nextStatus.set(s.id, "failed");
        continue;
      }
      if (existingCount + accepted.length + 1 > MAX_IMAGES_PER_SCRIPT) {
        const reason = `Script cannot exceed ${MAX_IMAGES_PER_SCRIPT} pages.`;
        failures.push({
          id: uid("fail"),
          fileName: s.file.name,
          scriptCode: targetCode,
          reason,
          at: new Date().toISOString(),
        });
        s.error = reason;
        nextStatus.set(s.id, "failed");
        continue;
      }

      const blobKey = uid("blob");
      await putBlob(blobKey, s.file).catch(() => undefined);
      const url = s.previewUrl ?? URL.createObjectURL(s.file);
      const pageNum = existingCount + accepted.length + 1;
      const isCoverPage = pageNum === 1;
      const maskedUrl = isCoverPage ? await createMaskedCopy(url, AUTO_HEADER_RECT).catch(() => undefined) : undefined;

      accepted.push({
        id: uid("img"),
        fileName: s.file.name,
        fileFormat: s.file.type === "image/png" ? "PNG" : "JPEG",
        fileSizeBytes: s.file.size,
        originalUrl: url,
        maskedUrl,
        maskRect: isCoverPage ? AUTO_HEADER_RECT : undefined,
        maskStatus: isCoverPage ? "MASKED" : "NO_HEADER",
        pageNumber: pageNum,
        width: s.width ?? 1000,
        height: s.height ?? 1414,
        blobKey,
      });
      nextStatus.set(s.id, "done");
    }

    if (accepted.length > 0 || failures.length > 0) {
      actions.addUploads(
        accepted.length > 0
          ? [{ scriptId: script?.id, code: targetCode, realStudentId: studentId, paperType: paperType ?? "STRUCTURED", images: accepted }]
          : [],
        failures,
      );
    }

    // Clear completed uploads from the staging queue so they don't linger
    // (they are now directly visible and editable in the Submitted Script Pages cards below).
    // Keep only files with errors so the student can inspect the issue and retry.
    setStaged((prev) => prev.filter((s) => s.error || nextStatus.get(s.id) === "failed"));

    if (accepted.length > 0 && failures.length === 0) {
      setNotice({
        tone: "green",
        title: "Script pages uploaded & header masked",
        text: `${accepted.length} handwritten page(s) bound to ${targetCode} (Index ${studentId} linked and cover header automatically masked). Hover any page to adjust the mask crop.`,
      });
    } else if (accepted.length > 0 && failures.length > 0) {
      setNotice({
        tone: "amber",
        title: "Partial upload completed",
        text: `${accepted.length} page(s) uploaded, ${failures.length} rejected. Valid pages were preserved.`,
      });
    } else if (failures.length > 0) {
      setNotice({
        tone: "red",
        title: "Upload rejected",
        text: `${failures.length} file(s) failed validation. Only JPEG and PNG images up to 10 MB are accepted.`,
      });
    }
    setBusy(false);
  }

  function handleDropReorder(targetIdx: number) {
    if (!script || draggedPageIndex === null || draggedPageIndex === targetIdx) {
      setDraggedPageIndex(null);
      setDragOverPageIndex(null);
      return;
    }
    const reordered = [...pages];
    const [moved] = reordered.splice(draggedPageIndex, 1);
    reordered.splice(targetIdx, 0, moved);
    actions.reorderPages(
      script.id,
      reordered.map((p) => p.id),
    );
    setDraggedPageIndex(null);
    setDragOverPageIndex(null);
  }

  const remainingSlots = Math.max(0, MAX_IMAGES_PER_SCRIPT - pages.length);

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Script Submission"
        sub="Upload photographed or scanned handwritten answer pages (JPEG or PNG, max 10 MB per page, up to 10 pages)."
      />

      {/* Intake lifecycle status */}
      <Card className="p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-3.5 py-2.5">
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Script ID</div>
            <div className="mt-1 font-mono text-sm font-semibold text-slate-900">{scriptCode || "Not Assigned"}</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-3.5 py-2.5">
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">1. Uploaded pages</div>
            <div className="mt-1 flex items-center gap-2">
              <span className="text-sm font-semibold text-slate-900">
                {pages.length} / {MAX_IMAGES_PER_SCRIPT}
              </span>
              <Badge tone={pages.length > 0 ? "green" : "slate"}>{pages.length > 0 ? "Received" : "Pending"}</Badge>
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-3.5 py-2.5">
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">2. Privacy & order</div>
            <div className="mt-1 flex items-center gap-2">
              <Badge tone={script?.pagesConfirmed && allMaskedOrNoHeader ? "green" : pages.length > 0 ? "amber" : "slate"}>
                {script?.pagesConfirmed && allMaskedOrNoHeader ? "Verified" : pages.length > 0 ? "In progress" : "Waiting"}
              </Badge>
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-3.5 py-2.5">
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">3. Evaluation status</div>
            <div className="mt-1 flex items-center gap-2">
              <Badge tone={hasResultsReleased ? "green" : hasApprovedTranscripts ? "indigo" : "slate"}>
                {hasResultsReleased ? "Results released" : hasApprovedTranscripts ? "OCR approved" : "Pending review"}
              </Badge>
            </div>
          </div>
        </div>
      </Card>

      {notice && (
        <Alert tone={notice.tone} title={notice.title}>
          {notice.text}
        </Alert>
      )}

      {/* Upload dropzone */}
      <Card>
        <CardHeader
          title="Upload Handwritten Script Pages"
          sub={
            scriptCode
              ? `${remainingSlots} page slot(s) remaining for ${scriptCode}`
              : `Upload your handwritten exam script pages (max ${MAX_IMAGES_PER_SCRIPT} pages)`
          }
          right={
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setDraftPaperType(paperType ?? "STRUCTURED");
                  setPaperModalOpen(true);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
              >
                <span className="text-slate-500">Paper type:</span>
                <span className="font-semibold text-indigo-700">{paperTypeLabel(paperType ?? undefined)}</span>
                <span className="text-[11px] text-slate-400 underline">Change</span>
              </button>
              {staged.some((s) => s.status === "staged" || s.status === "failed") ? (
                <>
                  <Button size="sm" onClick={() => setStaged([])} disabled={busy}>
                    Clear queue
                  </Button>
                  <Button size="sm" variant="primary" onClick={submitFiles} disabled={busy}>
                    {busy ? "Uploading..." : `Upload ${staged.filter((s) => s.status !== "done").length} file(s)`}
                  </Button>
                </>
              ) : null}
            </div>
          }
        />

        <div className="space-y-4 p-5">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              if (!paperType) {
                setPaperModalOpen(true);
                return;
              }
              handleFiles(e.dataTransfer.files);
            }}
            onClick={() => {
              if (!paperType) {
                setPaperModalOpen(true);
                return;
              }
              inputRef.current?.click();
            }}
            className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-8 text-center transition ${
              drag ? "border-indigo-500 bg-indigo-50/60" : "border-slate-300 bg-slate-50/50 hover:border-indigo-400 hover:bg-slate-50"
            }`}
          >
            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,.jpg,.jpeg,.png"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files) handleFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <svg viewBox="0 0 24 24" className="h-8 w-8 text-indigo-500" fill="none" stroke="currentColor" strokeWidth={1.6}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 16V4m0 0l-4 4m4-4l4 4M4 20h16" />
            </svg>
            <p className="mt-2 text-sm font-medium text-slate-800">
              {paperType ? "Drop handwritten script photos here, or click to browse" : "Click to select question paper type before uploading"}
            </p>
            <p className="mt-1 text-xs text-slate-500">Accepted formats: JPEG (.jpg, .jpeg) and PNG (.png) · Max 10 MB per page · Max 10 pages</p>
          </div>

          {staged.length > 0 && (
            <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
              {staged.map((s) => (
                <div key={s.id} className="flex items-center gap-3 px-4 py-2.5 text-xs">
                  {s.previewUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={s.previewUrl} alt={s.file.name} className="h-11 w-9 rounded border border-slate-200 object-cover" />
                  ) : (
                    <div className="flex h-11 w-9 items-center justify-center rounded border border-rose-200 bg-rose-50 text-[10px] font-semibold text-rose-600">
                      ERR
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium text-slate-900">{s.file.name}</span>
                      <span className="text-slate-400">{formatBytes(s.file.size)}</span>
                    </div>
                    {s.error ? (
                      <p className="mt-0.5 text-rose-600">{s.error}</p>
                    ) : (
                      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                        <div
                          className={`h-full transition-all ${s.status === "done" ? "bg-emerald-500" : "bg-indigo-500"}`}
                          style={{ width: `${s.progress}%` }}
                        />
                      </div>
                    )}
                  </div>
                  <Badge tone={s.status === "done" ? "green" : s.error || s.status === "failed" ? "red" : "slate"}>
                    {s.status === "done" ? "Uploaded" : s.error || s.status === "failed" ? "Rejected" : "Ready"}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      {/* Uploaded script pages viewer */}
      <Card>
        <CardHeader
          title="Submitted Script Pages"
          sub="Verify page sequence and confirm that personal header details are masked prior to grading."
          right={
            script && pages.length > 0 && !script.pagesConfirmed ? (
              <Button size="sm" variant="primary" onClick={() => actions.confirmPages(script.id)}>
                Confirm page order
              </Button>
            ) : script?.pagesConfirmed ? (
              <Badge tone="green">Page order confirmed</Badge>
            ) : null
          }
        />
        <div className="p-5">
          {pages.length === 0 ? (
            <p className="text-sm text-slate-500">No handwritten script pages have been uploaded for your account yet.</p>
          ) : (
            <div className="grid grid-cols-1 items-stretch gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {pages.map((img, idx) => {
                const isDragging = draggedPageIndex === idx;
                const isOver = dragOverPageIndex === idx;
                const canReorder = script && !script.pagesConfirmed;

                return (
                  <div
                    key={img.id}
                    draggable={Boolean(canReorder)}
                    onDragStart={(e) => {
                      if (!canReorder) return;
                      setDraggedPageIndex(idx);
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", String(idx));
                    }}
                    onDragOver={(e) => {
                      if (!canReorder || draggedPageIndex === null) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      if (dragOverPageIndex !== idx) setDragOverPageIndex(idx);
                    }}
                    onDragLeave={() => {
                      if (dragOverPageIndex === idx) setDragOverPageIndex(null);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      handleDropReorder(idx);
                    }}
                    onDragEnd={() => {
                      setDraggedPageIndex(null);
                      setDragOverPageIndex(null);
                    }}
                    className={`flex flex-col justify-between overflow-hidden rounded-xl border bg-slate-50/40 shadow-xs transition-all ${
                      isDragging
                        ? "opacity-40 scale-[0.98] border-indigo-400"
                        : isOver
                        ? "border-indigo-500 ring-2 ring-indigo-400 bg-indigo-50/30"
                        : "border-slate-200"
                    }`}
                  >
                    {/* Card Header (Fixed Height with Drag Handle) */}
                    <div className="flex h-10 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-3.5 text-xs">
                      <div className="flex items-center gap-2">
                        {canReorder && (
                          <div
                            className="flex cursor-grab active:cursor-grabbing items-center text-slate-400 hover:text-slate-700"
                            title="Drag to reorder page"
                          >
                            <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor">
                              <path d="M7 4a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM7 10a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM7 16a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM16 4a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM16 10a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM16 16a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z" />
                            </svg>
                          </div>
                        )}
                        <span className="font-semibold text-slate-900">Page {img.pageNumber}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Badge tone={img.maskStatus === "MASKED" ? "green" : img.maskStatus === "NO_HEADER" ? "slate" : "amber"}>
                          {img.maskStatus === "MASKED" ? "Header masked" : img.maskStatus === "NO_HEADER" ? "No header" : "Mask pending"}
                        </Badge>
                      </div>
                    </div>

                    {/* Fixed-Height Aspect Ratio Viewport */}
                    <div className="p-3">
                      <div
                        onClick={() => setCroppingImage(img)}
                        className="group relative flex h-48 w-full cursor-pointer items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-900/5 transition hover:border-indigo-400"
                      >
                        <PageImage image={img} showMask={true} contain={true} className="h-full w-full" />
                        <div className="absolute inset-0 flex items-center justify-center bg-slate-900/40 opacity-0 transition group-hover:opacity-100">
                          <span className="flex items-center gap-1.5 rounded-lg bg-white/95 px-3 py-1.5 text-xs font-semibold text-slate-800 shadow-md">
                            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V7M7 3h10M7 21h10" />
                            </svg>
                            Crop / Mask Header
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Card Footer (Strictly Uniform Row) */}
                    <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-t border-slate-200 bg-white px-3.5 text-xs text-slate-600">
                      <span className="min-w-0 flex-1 truncate font-mono text-[11px]" title={img.fileName}>
                        {img.fileName}
                      </span>
                      {script && !script.pagesConfirmed && (
                        <button
                          type="button"
                          onClick={() => actions.removePage(script.id, img.id)}
                          className="rounded border border-rose-200 px-2 py-1 text-[11px] font-medium text-rose-600 hover:bg-rose-50"
                          title="Remove page"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Card>

      {script &&
        pages.length > 0 &&
        ((paperType ?? script.paperType) === "MCQ" ? (
          <StudentMcqVerificationCard script={script} />
        ) : (
          <StudentOcrVerificationCard script={script} />
        ))}

      <StudentPageCropperModal
        open={!!croppingImage}
        image={croppingImage}
        scriptId={script?.id ?? ""}
        onClose={() => setCroppingImage(null)}
      />

      {/* Question Paper Type Selector Pop-up Modal */}
      <Modal
        open={paperModalOpen}
        title="Select Question Paper Type"
        onClose={handleClosePaperModal}
        footer={
          <div className="flex w-full items-center justify-end gap-2">
            <Button size="sm" onClick={handleClosePaperModal}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" onClick={confirmPaperTypeSelection}>
              Confirm paper type
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <p className="text-xs text-slate-600">
            Select the format of the answer script you are uploading so the intake pipeline configures the appropriate extraction and evaluation mode.
          </p>
          <div className="space-y-2.5">
            {PAPER_TYPE_OPTIONS.map((opt) => {
              const selected = draftPaperType === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setDraftPaperType(opt.value)}
                  className={`flex w-full items-start gap-3 rounded-xl border p-3.5 text-left transition ${
                    selected
                      ? "border-indigo-600 bg-indigo-50/70 ring-1 ring-indigo-600"
                      : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                  }`}
                >
                  <span
                    className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                      selected ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-300 bg-white"
                    }`}
                  >
                    {selected && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold text-slate-900">{opt.title}</div>
                    <p className="mt-0.5 text-xs text-slate-500">{opt.desc}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </Modal>
    </div>
  );
}
