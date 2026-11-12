// Seed data for the demo. Script SCR-7F3A is already mapped and extracted; SCR-2B91 is freshly uploaded
// (pages out of order, headers not yet masked) so every Module 1 step can be demonstrated live.
import { extractAnswer, nowIso, versionText } from "./logic";
import { sampleBlocks } from "./mock-ocr";
import type { AnswerRecord, AnswerRegion, DownstreamRun, Script, ScriptImage, State } from "./types";

const HEADER_RECT = { x: 5.2, y: 2.4, width: 90.6, height: 12.8 };

function img(id: string, file: string, sampleKey: string, pageNumber: number, size: number): ScriptImage {
  return {
    id,
    fileName: file,
    fileFormat: "PNG",
    fileSizeBytes: size,
    originalUrl: `/samples/${file}`,
    maskStatus: "PENDING",
    pageNumber,
    width: 1000,
    height: 1414,
    sampleKey,
  };
}

export function buildSeed(): State {
  const t0 = new Date(Date.now() - 1000 * 60 * 60 * 26).toISOString();
  const t1 = new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString();

  const s1: Script = {
    id: "scr-1",
    pseudonymousCode: "SCR-7F3A",
    uploadedAt: t0,
    batchStatus: "COMPLETE",
    pagesConfirmed: true,
    mappingConfirmed: true,
    images: [
      { ...img("img-1a", "script1_page1.png", "s1p1", 1, 214_331), maskStatus: "MASKED", maskRect: HEADER_RECT },
      { ...img("img-1b", "script1_page2.png", "s1p2", 2, 158_904), maskStatus: "NO_HEADER" },
      { ...img("img-1c", "script1_page3.png", "s1p3", 3, 171_220), maskStatus: "NO_HEADER" },
    ],
  };
  const s2: Script = {
    id: "scr-2",
    pseudonymousCode: "SCR-2B91",
    uploadedAt: t1,
    batchStatus: "PARTIAL_FAILURE",
    pagesConfirmed: false,
    mappingConfirmed: false,
    // uploaded out of order: page 2 arrived first
    images: [img("img-2b", "script2_page2.png", "s2p2", 1, 132_877), img("img-2a", "script2_page1.png", "s2p1", 2, 176_045)],
  };

  // Regions for script 1 from the generated layout
  const qByKey: Record<string, string> = { Q1: "q1", Q2a: "q2", Q2b: "q2", Q3: "q3", Q4: "q4" };
  const regions: AnswerRegion[] = [];
  const pageOf: Record<string, string> = { s1p1: "img-1a", s1p2: "img-1b", s1p3: "img-1c" };
  for (const key of ["s1p1", "s1p2", "s1p3"]) {
    for (const b of sampleBlocks(key)) {
      const questionId = qByKey[b.key];
      regions.push({
        id: `reg-${key}-${b.key}`,
        scriptId: "scr-1",
        imageId: pageOf[key],
        questionId,
        sequenceOrder: regions.filter((r) => r.questionId === questionId).length + 1,
        bbox: { x: 9, y: b.top, width: 87, height: b.height },
      });
    }
  }

  const answers: AnswerRecord[] = ["q1", "q2", "q3", "q4"].map((qid) => {
    const regs = regions.filter((r) => r.questionId === qid).sort((a, b) => a.sequenceOrder - b.sequenceOrder);
    const { version, blankDetected } = extractAnswer(regs, s1.images);
    version.createdAt = t0;
    return {
      id: `ans-1-${qid}`,
      scriptId: "scr-1",
      questionId: qid,
      regionIds: regs.map((r) => r.id),
      blankDetected,
      blankConfirmed: false,
      activeVersion: 1,
      versions: [version],
      routingStatus: "NEEDS_REVIEW",
    };
  });

  // Q1 was already corrected and approved by the teacher (so M1-06 invalidation can be shown).
  const q1 = answers[0];
  const v1 = q1.versions[0];
  v1.spans = v1.spans.map((s) => (s.text === "thraed" ? { ...s, text: "thread", edited: true } : s));
  v1.flags = v1.flags.map((f) => ({ ...f, resolved: true, resolution: "Corrected 'thraed' to 'thread' after checking the image." }));
  v1.approvalStatus = "APPROVED";
  v1.approvedAt = new Date(Date.now() - 1000 * 60 * 60 * 20).toISOString();
  v1.approvedBy = "Dr. S. Silva (teacher)";
  q1.routingStatus = "READY_FOR_AI";
  void versionText;

  const runs: DownstreamRun[] = [
    { id: "run-eval-001", answerId: q1.id, boundTranscriptVersion: 1, kind: "EVALUATION", status: "COMPLETED", isStale: false, createdAt: new Date(Date.now() - 1000 * 60 * 60 * 19).toISOString() },
    { id: "run-fb-001", answerId: q1.id, boundTranscriptVersion: 1, kind: "FEEDBACK", status: "COMPLETED", isStale: false, createdAt: new Date(Date.now() - 1000 * 60 * 60 * 18).toISOString() },
  ];

  return {
    assessment: {
      id: "asm-mid-2026",
      title: "Mid Semester Examination 2026",
      course: "",
      retentionDays: 90,
      questions: [
        { id: "q1", number: "Q1", prompt: "Define a process and state two differences between a process and a thread.", maxMarks: 4 },
        { id: "q2", number: "Q2", prompt: "Explain what a deadlock is and list the four necessary (Coffman) conditions.", maxMarks: 5 },
        { id: "q3", number: "Q3", prompt: "What is the purpose of virtual memory?", maxMarks: 3 },
        { id: "q4", number: "Q4", prompt: "Distinguish between preemptive and non-preemptive scheduling.", maxMarks: 4 },
      ],
    },
    scripts: [s1, s2],
    failures: [
      { id: "fail-seed-1", fileName: "IMG_2041.HEIC", scriptCode: "SCR-2B91", reason: "Unsupported file type. Only JPEG and PNG images are accepted.", at: t1 },
    ],
    regions,
    answers,
    runs,
    identityMap: [],
    studentResults: {},
    reviewRequests: [],
    audit: [
      { id: "au-1", at: t0, actor: "Dr. S. Silva", action: "UPLOAD", detail: "Uploaded 3 images for SCR-7F3A (batch COMPLETE)" },
      { id: "au-2", at: t0, actor: "Dr. S. Silva", action: "MASK", detail: "Masked identifying header on SCR-7F3A page 1" },
      { id: "au-3", at: t0, actor: "Dr. S. Silva", action: "MAP", detail: "Mapped 5 regions to 4 questions on SCR-7F3A (Q2 joined across pages 1-2)" },
      { id: "au-4", at: v1.approvedAt!, actor: "Dr. S. Silva", action: "APPROVE", detail: "Approved SCR-7F3A Q1 transcript v1" },
      { id: "au-5", at: t1, actor: "Dr. S. Silva", action: "UPLOAD", detail: "Uploaded 2 of 3 images for SCR-2B91 (batch PARTIAL_FAILURE)" },
    ],
  };
}

export { nowIso };

