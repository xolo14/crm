import PayslipPrintTemplate from "./PayslipPrintTemplate";
import type { Payslip } from "@/types/payslip";

interface PayslipPreviewProps {
  payslip: Payslip;
  scale?: number;
}

/**
 * Scaled-down read-only preview used inside the Generate tab.
 * The template renders at full A4 width (794px) and is scaled via CSS so the
 * visual fidelity is identical to the printed output.
 */
export default function PayslipPreview({ payslip, scale = 0.55 }: PayslipPreviewProps) {
  const previewHeight = Math.round(1123 * scale) + 40; // a bit of breathing room

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="relative inline-flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#2ed573] opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#2ed573]" />
          </span>
          <span className="text-sm font-semibold text-[#0f2318]">Live Preview</span>
        </div>
        <span className="text-[10px] uppercase tracking-wide text-gray-400">A4 · scaled {(scale * 100).toFixed(0)}%</span>
      </div>
      <div
        className="overflow-hidden rounded-lg border border-gray-200 bg-gray-50"
        style={{ height: previewHeight }}
      >
        <div
          style={{
            transform: `scale(${scale})`,
            transformOrigin: "top left",
            width: 794,
          }}
        >
          <PayslipPrintTemplate payslip={payslip} />
        </div>
      </div>
    </div>
  );
}
