"use client";
import { useMemo, useState } from "react";
import { PageImage } from "@/components/PageImage";
import { Alert, Badge, Button, Card, CardHeader } from "@/components/ui";
import { imageToMaskedBase64 } from "@/lib/image-utils";
import { orderedImages } from "@/lib/logic";
import { useStore } from "@/lib/store";
import type { McqItem, Script } from "@/lib/types";

const ALPHA_OPTIONS = ["A", "B", "C", "D", "E"] as const;
const NUMERIC_OPTIONS = ["1", "2", "3", "4", "5"] as const;
const RANGE_SIZE = 10;

type FilterMode = "ALL" | "NEEDS_REVIEW" | "EDITED";

function needsReview(item: McqItem): boolean {
  return (
    item.selectedOption === "MULTIPLE" ||
    item.selectedOption === "BLANK" ||
    Boolean(item.markedOptions && item.markedOptions.length > 1 && !item.edited)
  );
}

export function StudentMcqVerificationCard({ script }: { script: Script }) {
  const { actions } = useStore();
  const pages = orderedImages(script);
  const extraction = script.mcqExtraction;

  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [activePageIdx, setActivePageIdx] = useState<number>(0);
  const [filterMode, setFilterMode] = useState<FilterMode>("ALL");
  const [activeRange, setActiveRange] = useState<string>("ALL");
  const [compactGrid, setCompactGrid] = useState<boolean>(true);
  const [zoomSheet, setZoomSheet] = useState<boolean>(false);

  const items = extraction?.items ?? [];

  const activeOptions = useMemo(() => {
    if (extraction?.optionLabels && extraction.optionLabels.length >= 2) {
      return [...extraction.optionLabels, "BLANK"];
    }
    const hasNumeric =
      extraction?.optionStyle === "NUMERIC" ||
      items.some((i) => ["1", "2", "3", "4", "5"].includes(i.selectedOption));
    return [...(hasNumeric ? NUMERIC_OPTIONS : ALPHA_OPTIONS), "BLANK"];
  }, [extraction, items]);

  const summary = useMemo(() => {
    const flagged = items.filter(needsReview).length;
    const edited = items.filter((i) => i.edited).length;
    const unresolvedMultiples = items.filter((i) => i.selectedOption === "MULTIPLE").length;
    return { total: items.length, flagged, edited, unresolvedMultiples };
  }, [items]);

  const ranges = useMemo(() => {
    if (items.length <= RANGE_SIZE) return [];
    const maxQ = Math.max(...items.map((i) => i.questionNumber), items.length);
    const groups: Array<{ key: string; label: string; start: number; end: number }> = [];
    for (let start = 1; start <= maxQ; start += RANGE_SIZE) {
      const end = Math.min(start + RANGE_SIZE - 1, maxQ);
      groups.push({ key: `${start}-${end}`, label: `Q${start}–${end}`, start, end });
    }
    return groups;
  }, [items]);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (filterMode === "NEEDS_REVIEW" && !needsReview(item)) return false;
      if (filterMode === "EDITED" && !item.edited) return false;
      if (activeRange !== "ALL") {
        const [s, e] = activeRange.split("-").map(Number);
        if (item.questionNumber < s || item.questionNumber > e) return false;
      }
      return true;
    });
  }, [items, filterMode, activeRange]);

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
        optionStyle?: "ALPHA" | "NUMERIC";
        optionLabels?: string[];
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
        optionStyle: data.optionStyle,
        optionLabels: data.optionLabels,
        verified: false,
        items: data.items,
      });
      setFilterMode("ALL");
      setActiveRange("ALL");
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
    const defaultOpt = activeOptions[0] ?? "1";
    actions.setMcqExtraction(script.id, {
      ...extraction,
      verified: false,
      items: [
        ...extraction.items,
        { questionNumber: nextNum, selectedOption: defaultOpt, confidence: "unknown", edited: true },
      ],
    });
  }

  function handleOptionKeyDown(
    e: React.KeyboardEvent<HTMLButtonElement>,
    item: McqItem,
    currentOpt: string,
  ) {
    const hasMultiple = Boolean(item.markedOptions && item.markedOptions.length > 1);
    const allowed = hasMultiple
      ? activeOptions.filter((o) => item.markedOptions!.includes(o))
      : activeOptions;
    if (allowed.length === 0) return;

    const currAllowedIdx = Math.max(0, allowed.indexOf(currentOpt));
    let targetOpt: string | undefined;

    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      targetOpt = allowed[(currAllowedIdx + 1) % allowed.length];
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      targetOpt = allowed[(currAllowedIdx - 1 + allowed.length) % allowed.length];
    }

    if (targetOpt) {
      actions.updateMcqItem(script.id, item.questionNumber, targetOpt);
      const targetIdxInDom = activeOptions.indexOf(targetOpt);
      const btn = e.currentTarget.parentElement?.querySelectorAll("button")[targetIdxInDom] as
        | HTMLButtonElement
        | undefined;
      btn?.focus();
    }
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
                disabled={busy || summary.unresolvedMultiples > 0}
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

        {summary.unresolvedMultiples > 0 && (
          <Alert tone="amber" title="Invalid multiple-answer marks detected">
            Please resolve {summary.unresolvedMultiples} invalid question(s) marked with multiple options by selecting one of the marked choices before sending to evaluation.
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
              Click below to automatically detect each question number and marked option from your answer sheet.
            </p>
            <div className="mt-4">
              <Button variant="primary" onClick={runMcqExtraction} disabled={busy}>
                {busy ? "Extracting..." : "Extract MCQ Answers"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid items-start gap-5 lg:grid-cols-12">
            {/* Left: Sticky Uploaded MCQ Sheet Preview */}
            <div className="space-y-2.5 lg:sticky lg:top-4 lg:col-span-5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-700">Uploaded MCQ Sheet</span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setZoomSheet((z) => !z)}
                    className="rounded border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                  >
                    {zoomSheet ? "Fit Width" : "Zoom Sheet"}
                  </button>
                  {pages.length > 1 &&
                    pages.map((p, idx) => (
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
              </div>
              <div
                className={`rounded-xl border border-slate-200 bg-white p-2 ${
                  zoomSheet ? "max-h-[540px] overflow-auto" : "overflow-hidden"
                }`}
              >
                <div className={zoomSheet ? "w-[150%]" : "w-full"}>
                  <PageImage image={activePage} showMask={true} />
                </div>
              </div>
            </div>

            {/* Right: Compact, Accessible, Scroll-Bounded MCQ Verification Pane */}
            <div className="space-y-3 lg:col-span-7">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2">
                <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter MCQ responses">
                  <button
                    type="button"
                    onClick={() => setFilterMode("ALL")}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                      filterMode === "ALL"
                        ? "bg-slate-900 text-white"
                        : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100"
                    }`}
                  >
                    All ({summary.total})
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterMode("NEEDS_REVIEW")}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                      filterMode === "NEEDS_REVIEW"
                        ? "bg-amber-600 text-white"
                        : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100"
                    }`}
                  >
                    Needs Review ({summary.flagged})
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterMode("EDITED")}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                      filterMode === "EDITED"
                        ? "bg-indigo-600 text-white"
                        : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100"
                    }`}
                  >
                    Edited ({summary.edited})
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setCompactGrid((v) => !v)}
                    className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    {compactGrid ? "Single Column" : "2-Column Grid"}
                  </button>
                  <button
                    type="button"
                    onClick={addMcqRow}
                    className="text-xs font-medium text-indigo-600 hover:underline"
                  >
                    + Add row
                  </button>
                </div>
              </div>

              {ranges.length > 0 && (
                <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label="Question ranges">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeRange === "ALL"}
                    onClick={() => setActiveRange("ALL")}
                    className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition ${
                      activeRange === "ALL"
                        ? "bg-indigo-600 text-white"
                        : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    All Questions
                  </button>
                  {ranges.map((r) => (
                    <button
                      key={r.key}
                      type="button"
                      role="tab"
                      aria-selected={activeRange === r.key}
                      onClick={() => setActiveRange(r.key)}
                      className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition ${
                        activeRange === r.key
                          ? "bg-indigo-600 text-white"
                          : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              )}

              {filteredItems.length === 0 ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-center text-xs text-slate-500">
                  {items.length === 0
                    ? "No MCQ items were detected on this image. You can add rows manually or upload a clearer MCQ sheet."
                    : "No questions match the selected filter."}
                </div>
              ) : (
                <div
                  className={`max-h-[520px] overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 ${
                    compactGrid ? "grid grid-cols-1 gap-1.5 xl:grid-cols-2" : "divide-y divide-slate-100"
                  }`}
                >
                  {filteredItems.map((item) => {
                    const hasMultipleMarks = Array.isArray(item.markedOptions) && item.markedOptions.length > 1;
                    const isUnresolvedMultiple = item.selectedOption === "MULTIPLE";
                    const isBlank = item.selectedOption === "BLANK";

                    return (
                      <div
                        key={item.questionNumber}
                        className={`flex flex-col gap-1.5 rounded-lg px-2.5 py-1.5 text-xs ${
                          isUnresolvedMultiple
                            ? "border border-rose-300 bg-rose-50/70"
                            : hasMultipleMarks
                              ? "border border-indigo-200 bg-indigo-50/40"
                              : isBlank
                                ? "border border-amber-300 bg-amber-50/40"
                                : compactGrid
                                  ? "border border-slate-100 bg-slate-50/40"
                                  : ""
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5">
                            <span className="w-8 shrink-0 rounded bg-slate-100 py-0.5 text-center font-mono text-[11px] font-semibold text-slate-800">
                              Q{item.questionNumber}
                            </span>
                            <div
                              className="flex items-center gap-0.5"
                              role="radiogroup"
                              aria-label={`Question ${item.questionNumber} selected option`}
                            >
                              {activeOptions.map((opt) => {
                                const active = item.selectedOption === opt;
                                const isBlocked = hasMultipleMarks && !item.markedOptions!.includes(opt);
                                const isCandidate = isUnresolvedMultiple && hasMultipleMarks && !isBlocked;
                                return (
                                  <button
                                    key={opt}
                                    type="button"
                                    role="radio"
                                    aria-checked={active}
                                    aria-disabled={isBlocked}
                                    disabled={isBlocked}
                                    title={
                                      isBlocked
                                        ? "Blocked: this option was not marked on your answer sheet"
                                        : isCandidate
                                          ? `Marked on sheet — click to choose ${opt}`
                                          : undefined
                                    }
                                    aria-label={`Question ${item.questionNumber} option ${opt === "BLANK" ? "Blank" : opt}${isBlocked ? " (blocked)" : ""}`}
                                    onClick={() => actions.updateMcqItem(script.id, item.questionNumber, opt)}
                                    onKeyDown={(e) => handleOptionKeyDown(e, item, opt)}
                                    className={`rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                                      isBlocked
                                        ? "cursor-not-allowed border border-slate-200 bg-slate-100 text-slate-300 line-through opacity-50"
                                        : active
                                          ? opt === "BLANK"
                                            ? "bg-slate-700 text-white"
                                            : "bg-indigo-600 text-white shadow-xs"
                                          : isCandidate
                                            ? "border border-rose-400 bg-white text-rose-800 ring-1 ring-rose-300 hover:bg-rose-100"
                                            : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
                                    }`}
                                  >
                                    {opt === "BLANK" ? "—" : opt}
                                  </button>
                                );
                              })}
                            </div>
                          </div>

                          <div className="flex shrink-0 items-center gap-1">
                            {isUnresolvedMultiple && <Badge tone="red">Invalid: Multiple marks</Badge>}
                            {!isUnresolvedMultiple && hasMultipleMarks && (
                              <Badge tone="indigo">Resolved ({item.selectedOption})</Badge>
                            )}
                            {!hasMultipleMarks && item.edited && <Badge tone="indigo">Edited</Badge>}
                            {isBlank && <Badge tone="amber">Blank</Badge>}
                          </div>
                        </div>

                        {isUnresolvedMultiple && hasMultipleMarks && (
                          <p className="pl-9 text-[11px] font-medium text-rose-700">
                            Invalid mark: select one marked answer ({item.markedOptions!.join(" or ")}); others are blocked.
                          </p>
                        )}
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
