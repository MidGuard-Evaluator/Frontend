"use client";
import { useEffect, useState } from "react";
import ReactCrop, { type Crop, type PercentCrop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import { Badge, Button, Modal } from "@/components/ui";
import { useStore } from "@/lib/store";
import type { Rect, ScriptImage } from "@/lib/types";

const DEFAULT_HEADER_CROP: PercentCrop = { unit: "%", x: 5, y: 2.4, width: 90, height: 12.5 };

export function StudentPageCropperModal({
  scriptId,
  image,
  open,
  onClose,
}: {
  scriptId: string;
  image: ScriptImage | null;
  open: boolean;
  onClose: () => void;
}) {
  const { state, user, actions } = useStore();
  const [crop, setCrop] = useState<Crop>(image?.maskRect ? { unit: "%", ...image.maskRect } : DEFAULT_HEADER_CROP);
  const [busy, setBusy] = useState(false);

  // Accessibility & inspection controls
  const [zoom, setZoom] = useState<number>(100);
  const [rotation, setRotation] = useState<number>(0);
  const [contrastHigh, setContrastHigh] = useState<boolean>(false);
  const [invertDark, setInvertDark] = useState<boolean>(false);

  useEffect(() => {
    if (!image) return;
    setCrop(image.maskRect ? { unit: "%", ...image.maskRect } : DEFAULT_HEADER_CROP);
    setZoom(100);
    setRotation(0);
    setContrastHigh(false);
    setInvertDark(false);
  }, [image]);

  if (!image) return null;

  const script = state.scripts.find((s) => s.id === scriptId);
  const studentIndex = user?.studentId ?? user?.username ?? "Student";
  const scriptCode = script?.pseudonymousCode ?? "Unassigned";

  function toPercentRect(c: Crop): Rect {
    // If unit is '%', values are already percentages of the image.
    // If unit is 'px', convert to percentage using the image natural or client dimensions.
    if (c.unit === "%") {
      return {
        x: Math.max(0, Math.min(99, Number((c.x ?? 0).toFixed(2)))),
        y: Math.max(0, Math.min(99, Number((c.y ?? 0).toFixed(2)))),
        width: Math.max(1, Math.min(100, Number((c.width ?? 10).toFixed(2)))),
        height: Math.max(1, Math.min(100, Number((c.height ?? 10).toFixed(2)))),
      };
    }

    // fallback when crop emitted in pixels
    const el = document.querySelector<HTMLImageElement>("#student-crop-img");
    const w = el?.width || image?.width || 1;
    const h = el?.height || image?.height || 1;
    return {
      x: Math.max(0, Math.min(99, Number((((c.x ?? 0) / w) * 100).toFixed(2)))),
      y: Math.max(0, Math.min(99, Number((((c.y ?? 0) / h) * 100).toFixed(2)))),
      width: Math.max(1, Math.min(100, Number((((c.width ?? 10) / w) * 100).toFixed(2)))),
      height: Math.max(1, Math.min(100, Number((((c.height ?? 10) / h) * 100).toFixed(2)))),
    };
  }

  async function handleApplyMask() {
    if (!image) return;
    setBusy(true);
    await actions.applyMask(scriptId, image.id, toPercentRect(crop));
    setBusy(false);
    onClose();
  }

  function handleSetNoHeader() {
    if (!image) return;
    actions.setNoHeader(scriptId, image.id);
    onClose();
  }

  function resetView() {
    setZoom(100);
    setRotation(0);
    setContrastHigh(false);
    setInvertDark(false);
  }

  const filterStyle = [
    contrastHigh ? "contrast(150%) brightness(95%)" : "",
    invertDark ? "invert(90%) hue-rotate(180deg)" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Modal
      open={open}
      maxWidth="max-w-4xl"
      title={`Header Masking & Privacy Crop — Page ${image.pageNumber}`}
      onClose={onClose}
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-3">
          <Button size="sm" onClick={handleSetNoHeader} disabled={busy}>
            No Header on this page
          </Button>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" onClick={handleApplyMask} disabled={busy}>
              {busy ? "Applying mask..." : "Apply Header Mask"}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-indigo-100 bg-indigo-50/60 px-3 py-2 text-xs text-slate-700">
          <div>
            Index <span className="font-mono font-semibold text-slate-900">{studentIndex}</span> is linked to pseudonymous Script ID{" "}
            <span className="font-mono font-semibold text-indigo-700">{scriptCode}</span>.
          </div>
          <span className="text-[11px] text-slate-500">Header region is masked before external OCR / AI calls</span>
        </div>

        <p className="text-xs text-slate-600">
          Adjust the selection box over your handwritten header (student name, index number, etc.) to mask it before OCR and grading. If this page has no identifying header, click <strong>No Header on this page</strong>.
        </p>

        {/* Accessibility & Zoom Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2 text-xs">
          {/* Zoom controls */}
          <div className="flex items-center gap-1.5">
            <span className="font-medium text-slate-600">Zoom:</span>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(50, z - 25))}
              className="rounded border border-slate-200 bg-white px-2 py-1 font-semibold hover:bg-slate-100 disabled:opacity-40"
              disabled={zoom <= 50}
              title="Zoom out"
              aria-label="Zoom out"
            >
              −
            </button>
            <span className="w-12 text-center font-mono font-medium text-slate-800">{zoom}%</span>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(250, z + 25))}
              className="rounded border border-slate-200 bg-white px-2 py-1 font-semibold hover:bg-slate-100 disabled:opacity-40"
              disabled={zoom >= 250}
              title="Zoom in"
              aria-label="Zoom in"
            >
              +
            </button>
          </div>

          {/* Orientation & Accessibility Toggles */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setRotation((r) => (r + 90) % 360)}
              className="rounded border border-slate-200 bg-white px-2.5 py-1 text-slate-700 hover:bg-slate-100"
              title="Rotate 90 degrees clockwise"
            >
              Rotate 90° {rotation > 0 ? `(${rotation}°)` : ""}
            </button>

            <button
              type="button"
              onClick={() => setContrastHigh((v) => !v)}
              className={`rounded px-2.5 py-1 transition ${
                contrastHigh
                  ? "bg-slate-900 font-medium text-white"
                  : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
              }`}
              title="High contrast filter for faint pencil handwriting"
            >
              High Contrast
            </button>

            <button
              type="button"
              onClick={() => setInvertDark((v) => !v)}
              className={`rounded px-2.5 py-1 transition ${
                invertDark
                  ? "bg-indigo-600 font-medium text-white"
                  : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
              }`}
              title="Inverted dark reading mode"
            >
              Invert Colors
            </button>

            {(zoom !== 100 || rotation !== 0 || contrastHigh || invertDark) && (
              <button
                type="button"
                onClick={resetView}
                className="text-[11px] text-slate-500 underline hover:text-slate-800"
              >
                Reset view
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-medium text-slate-500">Status:</span>
            <Badge tone={image.maskStatus === "MASKED" ? "green" : image.maskStatus === "NO_HEADER" ? "slate" : "amber"}>
              {image.maskStatus === "MASKED" ? "Masked" : image.maskStatus === "NO_HEADER" ? "No header" : "Mask pending"}
            </Badge>
          </div>
        </div>

        {/* Viewport container with scroll & zoom */}
        <div className="max-h-[62vh] min-h-[360px] overflow-auto rounded-lg border border-slate-200 bg-slate-900/5 p-4 flex items-center justify-center">
          <div
            style={{
              width: `${zoom}%`,
              transform: rotation ? `rotate(${rotation}deg)` : undefined,
              transition: "transform 0.15s ease",
            }}
            className="flex justify-center"
          >
            <ReactCrop crop={crop} onChange={(c, percentCrop) => setCrop(percentCrop)} className="max-w-full">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                id="student-crop-img"
                src={image.originalUrl}
                alt={`Page ${image.pageNumber}`}
                style={{ filter: filterStyle || undefined }}
                className="max-h-[58vh] w-auto object-contain select-none"
                draggable={false}
              />
            </ReactCrop>
          </div>
        </div>
      </div>
    </Modal>
  );
}
