"use client";
import { useState } from "react";
import ReactCrop, { type Crop, type PercentCrop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import { RegionCrop } from "@/components/PageImage";
import { Alert, Badge, Button, Card, CardHeader, Modal } from "@/components/ui";
import { activeVersion, orderedImages } from "@/lib/logic";
import { useStore } from "@/lib/store";
import type { AnswerRegion, Question, Rect, Script, ScriptImage } from "@/lib/types";

const DEFAULT_Q_CROP: PercentCrop = { unit: "%", x: 6, y: 18, width: 88, height: 18 };

export function StudentOcrVerificationCard({ script }: { script: Script }) {
  const { state, actions } = useStore();
  const pages = orderedImages(script);
  const questions = state.assessment.questions;
  const scriptRegions = state.regions.filter((r) => r.scriptId === script.id);
  const scriptAnswers = state.answers.filter((a) => a.scriptId === script.id);

  const [mappingQuestion, setMappingQuestion] = useState<Question | null>(null);
  const [selectedPageId, setSelectedPageId] = useState<string>(pages[0]?.id ?? "");
  const [crop, setCrop] = useState<Crop>(DEFAULT_Q_CROP);
  const [replaceExisting, setReplaceExisting] = useState<boolean>(true);
  const [confirmedBanner, setConfirmedBanner] = useState<boolean>(false);

  if (pages.length === 0) return null;

  function toPercentRect(c: Crop): Rect {
    return {
      x: Math.max(0, Math.min(99, Number((c.x ?? 6).toFixed(2)))),
      y: Math.max(0, Math.min(99, Number((c.y ?? 18).toFixed(2)))),
      width: Math.max(1, Math.min(100, Number((c.width ?? 88).toFixed(2)))),
      height: Math.max(1, Math.min(100, Number((c.height ?? 18).toFixed(2)))),
    };
  }

  function runAutoSegmentAndExtract() {
    if (scriptRegions.length === 0 && pages.length > 0) {
      const slots: { y: number; height: number }[] = [
        { y: 16, height: 18 },
        { y: 36, height: 18 },
        { y: 56, height: 18 },
        { y: 76, height: 18 },
      ];
      questions.forEach((q, idx) => {
        const page = pages[Math.min(idx, pages.length - 1)] ?? pages[0];
        const slot = slots[idx % slots.length];
        actions.addRegion(script.id, page.id, q.id, {
          x: 6,
          y: slot.y,
          width: 88,
          height: slot.height,
        });
      });
    }
    if (!script.pagesConfirmed) {
      actions.confirmPages(script.id);
    }
    actions.confirmMappingAndExtract(script.id);
    setConfirmedBanner(false);
  }

  function openRegionCropModal(q: Question) {
    const existingRegs = scriptRegions.filter((r) => r.questionId === q.id);
    const firstReg = existingRegs[0];
    setMappingQuestion(q);
    setSelectedPageId(firstReg?.imageId ?? pages[0]?.id ?? "");
    setCrop(firstReg ? { unit: "%", ...firstReg.bbox } : DEFAULT_Q_CROP);
    setReplaceExisting(existingRegs.length > 0);
  }

  function saveQuestionRegion() {
    if (!mappingQuestion || !selectedPageId) return;
    if (replaceExisting) {
      const oldRegs = scriptRegions.filter((r) => r.questionId === mappingQuestion.id);
      oldRegs.forEach((r) => actions.deleteRegion(r.id));
    }
    actions.addRegion(script.id, selectedPageId, mappingQuestion.id, toPercentRect(crop));
    actions.confirmMappingAndExtract(script.id);
    setMappingQuestion(null);
  }

  function confirmAllAndSendToEvaluation() {
    if (scriptAnswers.length === 0) {
      runAutoSegmentAndExtract();
    }
    state.answers
      .filter((a) => a.scriptId === script.id)
      .forEach((a) => {
        const v = activeVersion(a);
        if (!v) return;
        v.flags.forEach((f) => {
          if (!f.resolved) actions.resolveFlag(a.id, f.id, "Verified by student prior to evaluation.");
        });
        if (v.approvalStatus !== "APPROVED" && a.routingStatus !== "NOT_ATTEMPTED") {
          actions.approve(a.id);
        }
      });
    setConfirmedBanner(true);
  }

  const allVerified =
    scriptAnswers.length === questions.length &&
    scriptAnswers.every((a) => {
      const v = activeVersion(a);
      return v?.approvalStatus === "APPROVED" || a.routingStatus === "NOT_ATTEMPTED" || a.routingStatus === "MANUAL_MARKING";
    });

  const activeModalPage: ScriptImage | undefined = pages.find((p) => p.id === selectedPageId) ?? pages[0];

  return (
    <Card>
      <CardHeader
        title="Extract & Verify OCR Answers"
        sub="Extract text from your uploaded script pages, verify or correct the OCR transcript against your handwriting, and send to evaluation."
        right={
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={runAutoSegmentAndExtract}>
              {scriptAnswers.length === 0 ? "Extract OCR Answers" : "Re-run OCR Extraction"}
            </Button>
            {scriptAnswers.length > 0 && (
              <Button size="sm" variant="primary" onClick={confirmAllAndSendToEvaluation}>
                {allVerified ? "Verified & Sent to Evaluation" : "Confirm All & Send to Evaluation"}
              </Button>
            )}
          </div>
        }
      />

      <div className="space-y-4 p-5">
        {confirmedBanner && (
          <Alert tone="green" title="OCR answers verified and sent to evaluation">
            Your cropped handwritten regions and verified OCR transcripts for {script.pseudonymousCode} have been locked and queued for evaluation.
          </Alert>
        )}

        {scriptAnswers.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/60 px-6 py-8 text-center">
            <p className="text-sm font-medium text-slate-800">Ready to extract answers from your uploaded script</p>
            <p className="mt-1 text-xs text-slate-500">
              Click <strong>Extract OCR Answers</strong> to segment your pages by question and inspect the extracted OCR text before submitting for grading.
            </p>
            <div className="mt-4">
              <Button variant="primary" onClick={runAutoSegmentAndExtract}>
                Extract OCR Answers
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {questions.map((q) => {
              const ans = scriptAnswers.find((a) => a.questionId === q.id);
              const ver = ans ? activeVersion(ans) : undefined;
              const qRegions: { region: AnswerRegion; image: ScriptImage }[] = scriptRegions
                .filter((r) => r.questionId === q.id)
                .sort((a, b) => a.sequenceOrder - b.sequenceOrder)
                .map((region) => {
                  const image = pages.find((p) => p.id === region.imageId);
                  return image ? { region, image } : null;
                })
                .filter((x): x is { region: AnswerRegion; image: ScriptImage } => x !== null);

              const isApproved = ver?.approvalStatus === "APPROVED";
              const isNotAttempted = ans?.routingStatus === "NOT_ATTEMPTED";
              const isManual = ans?.routingStatus === "MANUAL_MARKING";

              return (
                <div key={q.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/70 px-4 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <span className="rounded bg-indigo-600 px-2 py-0.5 text-xs font-semibold text-white">{q.number}</span>
                      <span className="text-xs font-medium text-slate-800">{q.prompt}</span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={isApproved ? "green" : isNotAttempted ? "slate" : isManual ? "amber" : "indigo"}>
                        {isApproved
                          ? "Verified"
                          : isNotAttempted
                          ? "Not attempted"
                          : isManual
                          ? "Diagram / Manual review"
                          : "Pending verification"}
                      </Badge>

                      <Button size="sm" onClick={() => openRegionCropModal(q)}>
                        Crop question region
                      </Button>

                      {ans && !isNotAttempted && (
                        <Button size="sm" onClick={() => actions.markNotAttempted(ans.id)}>
                          Mark blank
                        </Button>
                      )}

                      {ans && !isManual && (
                        <Button
                          size="sm"
                          onClick={() => actions.routeManual(ans.id, "Student flagged handwritten diagram or table")}
                        >
                          Has diagram / table
                        </Button>
                      )}

                      {ans && ver && !isApproved && !isNotAttempted && (
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() => {
                            ver.flags.forEach((f) => {
                              if (!f.resolved) actions.resolveFlag(ans.id, f.id, "Verified by student.");
                            });
                            actions.approve(ans.id);
                          }}
                        >
                          Verify answer
                        </Button>
                      )}

                      {ans && isApproved && (
                        <Button
                          size="sm"
                          onClick={() => actions.startNewVersion(ans.id, "Student re-opened transcript for correction")}
                        >
                          Edit text
                        </Button>
                      )}
                    </div>
                  </div>

                  <div className="grid gap-4 p-4 lg:grid-cols-12">
                    {/* Left: Cropped Handwritten Region(s) */}
                    <div className="space-y-2 lg:col-span-6">
                      <div className="flex items-center justify-between text-[11px] font-medium uppercase tracking-wide text-slate-500">
                        <span>Cropped Handwritten Region ({qRegions.length})</span>
                        <button
                          type="button"
                          onClick={() => openRegionCropModal(q)}
                          className="font-normal normal-case text-indigo-600 hover:underline"
                        >
                          Adjust crop / add continuation
                        </button>
                      </div>

                      {qRegions.length > 0 ? (
                        <div className="space-y-2">
                          {qRegions.map(({ region, image }, idx) => (
                            <div key={region.id} className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                              <div className="flex items-center justify-between border-b border-slate-200 bg-white px-2.5 py-1 text-[11px] text-slate-600">
                                <span>
                                  Page {image.pageNumber}
                                  {qRegions.length > 1 ? ` · Part ${idx + 1}` : ""}
                                </span>
                                {qRegions.length > 1 && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      actions.deleteRegion(region.id);
                                      actions.confirmMappingAndExtract(script.id);
                                    }}
                                    className="text-rose-600 hover:underline"
                                  >
                                    Remove part
                                  </button>
                                )}
                              </div>
                              <div className="p-2">
                                <RegionCrop image={image} rect={region.bbox} />
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-xs text-slate-500">
                          No region cropped for {q.number}. Click <strong>Crop question region</strong> to select where you wrote this answer.
                        </div>
                      )}
                    </div>

                    {/* Right: Extracted OCR Transcript Spans (Editable by Student) */}
                    <div className="space-y-2 lg:col-span-6">
                      <div className="flex items-center justify-between text-[11px] font-medium uppercase tracking-wide text-slate-500">
                        <span>Extracted OCR Text {ver ? `(v${ver.version})` : ""}</span>
                        {!isApproved && !isNotAttempted && (
                          <span className="font-normal normal-case text-slate-400">Click any line below to fix OCR typos</span>
                        )}
                      </div>

                      {isNotAttempted ? (
                        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">
                          Marked as not attempted (blank answer).
                        </div>
                      ) : ver && ver.spans.length > 0 ? (
                        <div className="space-y-1.5 rounded-lg border border-slate-200 bg-slate-50/50 p-3">
                          {ver.spans.map((sp) => (
                            <div key={sp.id} className="flex items-center gap-2 text-xs">
                              <span className="w-12 shrink-0 rounded bg-slate-200/70 px-1.5 py-1 text-center font-mono text-[10px] font-medium text-slate-700">
                                {sp.id}
                              </span>
                              <input
                                type="text"
                                value={sp.text}
                                disabled={isApproved}
                                onChange={(e) => ans && actions.editSpan(ans.id, sp.id, e.target.value)}
                                className="flex-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none disabled:bg-slate-100 disabled:text-slate-600"
                              />
                              {sp.edited && <Badge tone="indigo">Edited</Badge>}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">
                          No text extracted yet.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal for Cropping a Question Region on an Uploaded Page */}
      <Modal
        open={!!mappingQuestion}
        maxWidth="max-w-3xl"
        title={`Crop Answer Region — ${mappingQuestion?.number ?? ""}`}
        onClose={() => setMappingQuestion(null)}
        footer={
          <div className="flex w-full items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={!replaceExisting}
                onChange={(e) => setReplaceExisting(!e.target.checked)}
                className="rounded border-slate-300"
              />
              Add as multi-page continuation (keep existing crop)
            </label>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={() => setMappingQuestion(null)}>
                Cancel
              </Button>
              <Button size="sm" variant="primary" onClick={saveQuestionRegion}>
                Save Crop &amp; Extract OCR
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-slate-600">
              Select the page and drag the box around your handwritten answer for <strong>{mappingQuestion?.number}</strong>.
            </p>
            {pages.length > 1 && (
              <div className="flex items-center gap-1.5 text-xs">
                <span className="font-medium text-slate-600">Page:</span>
                {pages.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelectedPageId(p.id)}
                    className={`rounded px-2.5 py-1 font-medium transition ${
                      selectedPageId === p.id
                        ? "bg-indigo-600 text-white"
                        : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    Page {p.pageNumber}
                  </button>
                ))}
              </div>
            )}
          </div>

          {activeModalPage && (
            <div className="max-h-[60vh] overflow-auto rounded-lg border border-slate-200 bg-slate-900/5 p-3 flex justify-center">
              <ReactCrop crop={crop} onChange={(_, percentCrop) => setCrop(percentCrop)} className="max-w-full">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={activeModalPage.originalUrl}
                  alt={`Page ${activeModalPage.pageNumber}`}
                  className="max-h-[55vh] w-auto object-contain select-none"
                  draggable={false}
                />
              </ReactCrop>
            </div>
          )}
        </div>
      </Modal>
    </Card>
  );
}

