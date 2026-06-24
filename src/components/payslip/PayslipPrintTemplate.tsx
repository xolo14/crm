import { forwardRef, type CSSProperties } from "react";
import syncpediaIcon from "@/assets/syncpedia-icon.png";
import type { Payslip } from "@/types/payslip";
import { amountInWords, formatINR } from "@/types/payslip";

interface PayslipPrintTemplateProps {
  payslip: Payslip;
  /** When true, this instance is the print target. Only one element on the page
   * should have this flag set so the print stylesheet can isolate it. */
  isPrintTarget?: boolean;
}

const labelStyle: CSSProperties = { color: "#6b7280", fontSize: 11, marginBottom: 2 };
const valueStyle: CSSProperties = { color: "#0f2318", fontSize: 12, fontWeight: 600 };

function TableMoneyRow({ label, value, alt }: { label: string; value: number; alt: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        padding: "8px 14px",
        fontSize: 12,
        background: alt ? "#f9fafb" : "#ffffff",
        borderTop: "1px solid #f1f5f9",
      }}
    >
      <span style={{ color: "#374151" }}>{label}</span>
      <span style={{ color: "#0f2318", fontWeight: 600 }}>₹ {formatINR(value)}</span>
    </div>
  );
}

const PayslipPrintTemplate = forwardRef<HTMLDivElement, PayslipPrintTemplateProps>(function PayslipPrintTemplate(
  { payslip, isPrintTarget = false },
  ref,
) {
  const c = payslip.components;

  return (
    <>
      {isPrintTarget && (
        <style>{`
          @media print {
            body * { visibility: hidden !important; }
            #payslip-print-area, #payslip-print-area * { visibility: visible !important; }
            #payslip-print-area {
              position: absolute !important;
              top: 0 !important;
              left: 0 !important;
              width: 794px !important;
              box-shadow: none !important;
            }
            @page { size: A4 portrait; margin: 10mm; }
          }
        `}</style>
      )}
      <div
        ref={ref}
        id={isPrintTarget ? "payslip-print-area" : undefined}
        style={{
          width: 794,
          minHeight: 1123,
          background: "#ffffff",
          color: "#0f2318",
          fontFamily: "Arial, Helvetica, sans-serif",
          padding: 32,
          boxSizing: "border-box",
          margin: "0 auto",
        }}
      >
        {/* SECTION 1 — HEADER */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 24 }}>
          <div style={{ display: "flex", gap: 12 }}>
            <img
              src={syncpediaIcon}
              alt="SYNCPedia"
              style={{ width: 56, height: 56, objectFit: "contain", borderRadius: 6 }}
              crossOrigin="anonymous"
            />
            <div style={{ display: "flex", flexDirection: "column", justifyContent: "center" }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: "#0f2318" }}>SYNCPedia Technologies Pvt Ltd</div>
              <div style={{ fontSize: 11, color: "#6b7280", lineHeight: 1.4 }}>
                Plot No. 14, Road No. 2, KPHB Phase III,
                <br />
                Kukatpally, Hyderabad, Telangana 500072
              </div>
              <div style={{ fontSize: 10, color: "#6b7280", marginTop: 2 }}>CIN: U72900TG2022PTC161234</div>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#0f2318", letterSpacing: 0.5 }}>PAYSLIP</div>
            <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>For the Month of {payslip.monthLabel}</div>
            <div
              style={{
                fontSize: 12,
                color: "#6b7280",
                marginTop: 4,
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              }}
            >
              {payslip.id}
            </div>
          </div>
        </div>

        <div style={{ height: 2, background: "#0f2318", margin: "16px 0 20px" }} />

        {/* SECTION 2 — EMPLOYEE SUMMARY */}
        <div style={{ background: "#f9fafb", borderRadius: 8, padding: 16, border: "1px solid #e5e7eb" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <div style={labelStyle}>Employee Name</div>
              <div style={{ ...valueStyle, fontSize: 13 }}>{payslip.employeeName}</div>
              <div style={{ ...labelStyle, marginTop: 8 }}>Employee ID</div>
              <div style={valueStyle}>{payslip.employeeCode}</div>
              <div style={{ ...labelStyle, marginTop: 8 }}>Designation</div>
              <div style={valueStyle}>{payslip.designation}</div>
              <div style={{ ...labelStyle, marginTop: 8 }}>Department</div>
              <div style={valueStyle}>{payslip.department}</div>
            </div>
            <div>
              <div style={labelStyle}>PAN Number</div>
              <div style={valueStyle}>{payslip.panNumber || "—"}</div>
              <div style={{ ...labelStyle, marginTop: 8 }}>Bank Name</div>
              <div style={valueStyle}>{payslip.bankName || "—"}</div>
              <div style={{ ...labelStyle, marginTop: 8 }}>Account No</div>
              <div style={valueStyle}>{payslip.accountNumber || "—"}</div>
              <div style={{ ...labelStyle, marginTop: 8 }}>IFSC Code</div>
              <div style={valueStyle}>{payslip.ifscCode || "—"}</div>
            </div>
          </div>
          <div
            style={{
              marginTop: 14,
              paddingTop: 12,
              borderTop: "1px dashed #d1d5db",
              display: "flex",
              justifyContent: "space-between",
              fontSize: 11,
              color: "#374151",
            }}
          >
            <span>
              <strong style={{ color: "#0f2318" }}>Working Days:</strong> {payslip.workingDays}
            </span>
            <span>
              <strong style={{ color: "#0f2318" }}>Paid Days:</strong> {payslip.paidDays}
            </span>
            <span>
              <strong style={{ color: "#0f2318" }}>Pay Period:</strong> {payslip.monthLabel}
            </span>
          </div>
        </div>

        {/* SECTION 3 — EARNINGS vs DEDUCTIONS */}
        <div style={{ marginTop: 20, border: "1px solid #e5e7eb", borderRadius: 8, overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", background: "#0f2318", color: "#ffffff", fontSize: 12, fontWeight: 700 }}>
            <div style={{ padding: "10px 14px", borderRight: "1px solid rgba(255,255,255,0.15)" }}>EARNINGS</div>
            <div style={{ padding: "10px 14px" }}>DEDUCTIONS</div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
            <div style={{ borderRight: "1px solid #f1f5f9" }}>
              <TableMoneyRow label="Basic Salary" value={c.basic} alt={false} />
              <TableMoneyRow label="HRA" value={c.hra} alt />
              <TableMoneyRow label="Special Allowance" value={c.specialAllowance} alt={false} />
              <TableMoneyRow label="Other Allowance" value={c.otherAllowance} alt />
            </div>
            <div>
              <TableMoneyRow label="PF (Employee)" value={c.pfEmployee} alt={false} />
              <TableMoneyRow label="Professional Tax" value={c.professionalTax} alt />
              <TableMoneyRow label="TDS" value={c.tds} alt={false} />
              <TableMoneyRow label="Other Deductions" value={c.otherDeductions} alt />
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", background: "#f3f4f6", borderTop: "2px solid #0f2318", fontWeight: 700 }}>
            <div style={{ borderRight: "1px solid #e5e7eb" }}>
              <TableMoneyRow label="Gross Earnings" value={c.grossEarnings} alt={false} />
            </div>
            <div>
              <TableMoneyRow label="Total Deductions" value={c.totalDeductions} alt={false} />
            </div>
          </div>
        </div>

        {/* SECTION 4 — NET PAY BOX */}
        <div
          style={{
            marginTop: 20,
            background: "#e6faf0",
            border: "2px solid #2ed573",
            borderRadius: 12,
            padding: "16px 24px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 24,
          }}
        >
          <div>
            <div style={{ fontSize: 11, color: "#4b5563", textTransform: "uppercase", letterSpacing: 1.2, fontWeight: 600 }}>
              Total Net Payable
            </div>
            <div style={{ fontSize: 28, fontWeight: 800, color: "#0f2318", marginTop: 4 }}>
              ₹ {formatINR(c.netPay)}
            </div>
          </div>
          <div style={{ textAlign: "right", maxWidth: 380 }}>
            <div style={{ fontSize: 10, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.6 }}>Amount in Words</div>
            <div style={{ fontSize: 13, color: "#374151", fontStyle: "italic", marginTop: 4, lineHeight: 1.4 }}>
              {amountInWords(c.netPay)}
            </div>
          </div>
        </div>

        {/* SECTION 5 — PF EMPLOYER CONTRIBUTION */}
        {payslip.pfApplicable && (
          <div style={{ marginTop: 8, fontSize: 10, color: "#6b7280", fontStyle: "italic" }}>
            Employer PF Contribution (not included in net pay): ₹ {formatINR(c.pfEmployer)}
          </div>
        )}

      </div>
    </>
  );
});

export default PayslipPrintTemplate;
