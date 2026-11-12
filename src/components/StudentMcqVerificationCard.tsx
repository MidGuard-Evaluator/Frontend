"use client";
import { useState } from "react";
import { PageImage } from "@/components/PageImage";
import { Alert, Badge, Button, Card, CardHeader } from "@/components/ui";
import { imageToMaskedBase64 } from "@/lib/image-utils";
import { orderedImages } from "@/lib/logic";
import { useStore } from "@/lib/store";
import type { McqItem, Script } from "@/lib/types";

const OPTIONS = ["A", "B", "C", "D", "E", "BLANK"] as const;

export function StudentMcqVerificationCard({ script }: { script: Script }) {
  const { actions } = useStore();
  const pages = orderedImages(script);
  const extraction = script.mcqExtraction;

  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [activePageIdx, setActivePageIdx] = useState<number>(0);

  if (pages.length === 0) return null;

  const activePage = pages[Math.min(activePageIdx, pages.length - 1)] ?? pages[0];

  async function runMcqExtraction() {
    setBusy(true);
    setError(null);
    try {
      const encodedPages = await Promise.all(
        pages.map(async (p) => {
          const { mimeType, base64Data } = await imageToMaskedBase64(p);
          return { pageNumber: p.pageNumber, mimeType, base64Data };
        }),
      );

      const res = await fetch("/api/ocr/mcq", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scriptId: script.pseudonymousCode,
          images: encodedPages,
        }),
      });

      const data = (await res.json()) as {
        ok: boolean;
        model?: string;
        items?: McqItem[];
        error?: string;
      };

      if (!res.ok || !data.ok || !data.items) {
        setError(data.error || "Unable to extract MCQ answers from the uploaded sheet.");
        setBusy(false);
        return;
      }

      actions.setMcqExtraction(script.id, {
        extractedAt: new Date().toISOString(),
        model: data.model || "ocr-mcq",
        verified: false,
        items: data.items,
      });
    } catch {
      setError("Could not reach the extraction service. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function addMcqRow() {
    if (!extraction) return;
    const nextNum =
      extraction.items.length > 0 ? Math.max(...extraction.items.map((i) => i.questionNumber)) + 1 : 1;
    actions.setMcqExtraction(script.id, {
      ...extraction,
      verified: false,
      items: [
        ...extraction.items,
        { questionNumber: nextNum, selectedOption: "A", confidence: "unknown", edited: true },
      ],
    });
  }

  return (
    <Card>
      <CardHeader
        title="Extract & Verify MCQ Answers"
        sub="Extract multiple-choice selections from your answer sheet and verify them before sending to evaluation."
        right={
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={runMcqExtraction} disabled={busy}>
              {busy ? "Extracting..." : extraction ? "Re-run Extraction" : "Extract MCQ Answers"}
            </Button>
            {extraction && extraction.items.length > 0 && (
              <Button
                size="sm"
                variant="primary"
                onClick={() => actions.verifyMcqExtraction(script.id)}
                disabled={busy}
              >
                {extraction.verified ? "Verified & Sent to Evaluation" : "Confirm All & Send to Evaluation"}
              </Button>
            )}
          </div>
        }
      />

      <div className="space-y-4 p-5">
        {error && (
          <Alert tone="red" title="Extraction failed">
            {error}
          </Alert>
        )}

        {extraction?.verified && (
          <Alert tone="green" title="MCQ answers verified and sent to evaluation">
            All {extraction.items.length} multiple-choice responses for {script.pseudonymousCode} have been verified and queued for grading.
          </Alert>
        )}

        {!extraction ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/60 px-6 py-8 text-center">
            <p className="text-sm font-medium text-slate-800">Ready to extract MCQ answers from your uploaded sheet</p>
            <p className="mt-1 text-xs text-slate-500">
              Click below to automatically detect each question number and marked option (A–E) from your answer sheet.
            </p>
            <div className="mt-4">
              <Button variant="primary" onClick={runMcqExtraction} disabled={busy}>
                {busy ? "Extracting..." : "Extract MCQ Answers"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid gap-5 lg:grid-cols-12">
            {/* Left: Uploaded MCQ Sheet Preview (Header Masked) */}
            <div className="space-y-2.5 lg:col-span-5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-700">Uploaded MCQ Sheet</span>
                {pages.length > 1 && (
                  <div className="flex items-center gap-1">
                    {pages.map((p, idx) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setActivePageIdx(idx)}
                        className={`rounded px-2 py-0.5 text-[11px] font-medium ${
                          activePageIdx === idx
                            ? "bg-indigo-600 text-white"
                            : "border border-slate-200 bg-white text-slate-700"
                        }`}
                      >
                        P{p.pageNumber}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white p-2">
                <PageImage image={activePage} showMask={true} />
              </div>
            </div>

            {/* Right: Extracted MCQ Answer Grid */}
            <div className="space-y-3 lg:col-span-7">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-700">
                  Extracted MCQ Responses ({extraction.items.length} questions)
                </span>
                <button
                  type="button"
                  onClick={addMcqRow}
                  className="text-xs font-medium text-indigo-600 hover:underline"
                >
                  + Add question row
                </button>
              </div>

              {extraction.items.length === 0 ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs text-slate-500">
                  No MCQ items were detected on this image. You can add rows manually or upload a clearer MCQ sheet.
                </div>
              ) : (
                <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
                  {extraction.items.map((item) => {
                    const isLowConf = typeof item.confidence === "number" && item.confidence < 0.75;
                    const isMultiple = item.selectedOption === "MULTIPLE";
                    return (
                      <div
                        key={item.questionNumber}
                        className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-xs"
                      >
                        <div className="flex items-center gap-2.5">
                          <span className="w-9 rounded bg-slate-100 px-2 py-1 text-center font-mono font-semibold text-slate-800">
                            Q{item.questionNumber}
                          </span>
                          <div className="flex items-center gap-1">
                            {OPTIONS.map((opt) => {
                              const active = item.selectedOption === opt;
                              return (
                                <button
                                  key={opt}
                                  type="button"
                                  onClick={() => actions.updateMcqItem(script.id, item.questionNumber, opt)}
                                  className={`rounded-md px-2.5 py-1 font-mono text-xs font-semibold transition ${
                                    active
                                      ? opt === "BLANK"
                                        ? "bg-slate-700 text-white"
                                        : "bg-indigo-600 text-white shadow-xs"
                                      : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                                  }`}
                                >
                                  {opt === "BLANK" ? "Blank" : opt}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          {isMultiple && <Badge tone="red">Multiple marks detected</Badge>}
                          {item.edited && <Badge tone="indigo">Edited</Badge>}
                          <Badge tone={isLowConf ? "amber" : "slate"}>
                            {typeof item.confidence === "number"
                              ? `${Math.round(item.confidence * 100)}% conf`
                              : "Manual"}
                          </Badge>
                          {item.note && (
                            <span className="max-w-[180px] truncate text-[11px] text-amber-700" title={item.note}>
                              {item.note}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
