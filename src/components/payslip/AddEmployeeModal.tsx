import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { Employee } from "@/types/payslip";
import { formatINR } from "@/types/payslip";
import { generateEmployeeCode } from "@/utils/payslipIDGenerator";

interface TeamMember {
  id: string;
  full_name: string;
  email: string;
  phone?: string | null;
  role?: string | null;
  org_id?: string | null;
  org_name?: string | null;
  is_active?: number | boolean;
}

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;

const DEPARTMENTS = ["Technology", "Sales", "Operations", "Human Resources", "Finance", "Marketing", "Other"];

function nextEmployeeIndex(employees: Employee[]): number {
  let max = 0;
  for (const e of employees) {
    const m = e.employeeCode.match(/SYNC-EMP-(\d+)/i);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max + 1;
}

interface AddEmployeeModalProps {
  open: boolean;
  employee: Employee | null;
  existingEmployees: Employee[];
  onSave: (e: Employee) => void | Promise<void>;
  onClose: () => void;
}

export default function AddEmployeeModal({ open, employee, existingEmployees, onSave, onClose }: AddEmployeeModalProps) {
  const { toast } = useToast();
  const { role } = useAuth();
  const normalizedRole = (() => {
    const r = String(role || "").toLowerCase();
    if (r === "superadmin") return "super_admin";
    if (r === "organisation") return "org";
    return r;
  })();
  const isEdit = !!employee;

  const [selectedMemberId, setSelectedMemberId] = useState<string>("");
  const [manualEntry, setManualEntry] = useState(false);
  const [memberPickerOpen, setMemberPickerOpen] = useState(false);

  const teamQuery = useQuery({
    queryKey: ["payslip-team-roster", normalizedRole],
    queryFn: async () => {
      // Backend already scopes: super_admin (no org_id) sees all; admin/org sees own org.
      const res = await api.team.list();
      return Array.isArray(res?.data) ? (res.data as TeamMember[]) : [];
    },
    enabled: open,
    staleTime: 60_000,
  });

  const members: TeamMember[] = useMemo(() => {
    const list = teamQuery.data ?? [];
    return list.filter((m) => m.is_active === undefined || m.is_active === 1 || m.is_active === true);
  }, [teamQuery.data]);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [joiningDate, setJoiningDate] = useState("");
  const [designation, setDesignation] = useState("");
  const [department, setDepartment] = useState("Technology");
  const [ctc, setCtc] = useState<number>(0);
  const [pfApplicable, setPfApplicable] = useState(true);
  const [ptApplicable, setPtApplicable] = useState(true);
  const [panNumber, setPanNumber] = useState("");
  const [bankName, setBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [ifscCode, setIfscCode] = useState("");
  const [employeeCode, setEmployeeCode] = useState("");
  const [employeeCodeTouched, setEmployeeCodeTouched] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const suggestedCode = useMemo(() => {
    if (employee) return employee.employeeCode;
    return generateEmployeeCode(nextEmployeeIndex(existingEmployees));
  }, [employee, existingEmployees]);

  const monthly = ctc > 0 ? ctc / 12 : 0;
  const previewBasic = Math.round(monthly * 0.4);
  const previewHra = Math.round(monthly * 0.2);

  useEffect(() => {
    if (!open) return;
    if (employee) {
      setName(employee.name);
      setEmail(employee.email);
      setPhone(employee.phone);
      setJoiningDate(employee.joiningDate);
      setDesignation(employee.designation);
      setDepartment(DEPARTMENTS.includes(employee.department) ? employee.department : "Other");
      setCtc(employee.ctc);
      setPfApplicable(employee.pfApplicable);
      setPtApplicable(employee.ptApplicable);
      setPanNumber(employee.panNumber);
      setBankName(employee.bankName);
      setAccountNumber(employee.accountNumber);
      setIfscCode(employee.ifscCode);
      setEmployeeCode(employee.employeeCode);
      setEmployeeCodeTouched(true);
      // Edit mode: assume the row is already linked to a CRM user only if name is exact match.
      setSelectedMemberId("");
      setManualEntry(true);
    } else {
      setName("");
      setEmail("");
      setPhone("");
      setJoiningDate("");
      setDesignation("");
      setDepartment("Technology");
      setCtc(0);
      setPfApplicable(true);
      setPtApplicable(true);
      setPanNumber("");
      setBankName("");
      setAccountNumber("");
      setIfscCode("");
      setEmployeeCode("");
      setEmployeeCodeTouched(false);
      setSelectedMemberId("");
      setManualEntry(false);
    }
    setErrors({});
  }, [open, employee]);

  // Keep the auto-suggested code in sync while the user hasn't touched it manually.
  useEffect(() => {
    if (!open || employee) return;
    if (employeeCodeTouched) return;
    setEmployeeCode(suggestedCode);
  }, [open, employee, suggestedCode, employeeCodeTouched]);

  function handleSelectMember(member: TeamMember) {
    setSelectedMemberId(member.id);
    setManualEntry(false);
    setName(member.full_name ?? "");
    setEmail(member.email ?? "");
    setPhone(String(member.phone ?? ""));
    setMemberPickerOpen(false);
    setErrors((prev) => {
      const next = { ...prev };
      delete next.name;
      delete next.email;
      delete next.phone;
      return next;
    });
  }

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = "Required";
    if (!email.trim()) e.email = "Required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) e.email = "Invalid email";
    if (!phone.trim()) e.phone = "Required";
    if (!joiningDate) e.joiningDate = "Required";
    if (!designation.trim()) e.designation = "Required";
    if (!department) e.department = "Required";
    if (!ctc || ctc <= 0) e.ctc = "Enter a valid annual CTC";

    const code = employeeCode.trim().toUpperCase();
    if (!code) {
      e.employeeCode = "Required";
    } else if (!/^[A-Z0-9][A-Z0-9_\-]{1,29}$/.test(code)) {
      e.employeeCode = "Use 2–30 chars: letters, digits, dashes or underscores";
    } else {
      const clash = existingEmployees.find(
        (x) => x.employeeCode.toUpperCase() === code && x.id !== (employee?.id ?? ""),
      );
      if (clash) e.employeeCode = `Already used by ${clash.name}`;
    }

    const pan = panNumber.trim().toUpperCase();
    if (!pan) e.panNumber = "Required";
    else if (!PAN_RE.test(pan)) e.panNumber = "Invalid PAN (format ABCDE1234F)";
    if (!bankName.trim()) e.bankName = "Required";
    if (!accountNumber.trim()) e.accountNumber = "Required";
    const ifsc = ifscCode.trim().toUpperCase();
    if (!ifsc) e.ifscCode = "Required";
    else if (!IFSC_RE.test(ifsc)) e.ifscCode = "Invalid IFSC (11 chars, e.g. HDFC0001234)";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) {
      toast({ title: "Fix validation errors", variant: "destructive" });
      return;
    }
    const now = new Date().toISOString();
    const pan = panNumber.trim().toUpperCase();
    const ifsc = ifscCode.trim().toUpperCase();
    const code = employeeCode.trim().toUpperCase();
    const payload: Employee = employee
      ? {
          ...employee,
          employeeCode: code,
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim(),
          joiningDate,
          designation: designation.trim(),
          department,
          ctc: Number(ctc),
          pfApplicable,
          ptApplicable,
          panNumber: pan,
          bankName: bankName.trim(),
          accountNumber: accountNumber.trim(),
          ifscCode: ifsc,
        }
      : {
          id: `emp_${crypto.randomUUID()}`,
          employeeCode: code,
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim(),
          joiningDate,
          designation: designation.trim(),
          department,
          ctc: Number(ctc),
          pfApplicable,
          ptApplicable,
          panNumber: pan,
          bankName: bankName.trim(),
          accountNumber: accountNumber.trim(),
          ifscCode: ifsc,
          createdAt: now,
        };

    setSaving(true);
    try {
      await Promise.resolve(onSave(payload));
      toast({
        title: isEdit ? "Employee updated" : "Employee added successfully",
        description: `${payload.name} · ${payload.employeeCode}`,
      });
      onClose();
    } catch {
      /* parent already toasts on failure; keep modal open */
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit employee" : "Add employee"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-2">
          <section className="space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wide text-[#0f2318]">Personal details</h4>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>Full name *</Label>
                <button
                  type="button"
                  className="text-[11px] font-semibold text-[#0f5230] underline-offset-2 hover:underline"
                  onClick={() => {
                    setManualEntry((m) => !m);
                    if (!manualEntry) {
                      setSelectedMemberId("");
                    }
                  }}
                >
                  {manualEntry ? "Pick from team list" : "Enter manually"}
                </button>
              </div>

              {manualEntry ? (
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Type the employee's full name"
                  className="rounded-lg focus-visible:ring-[#2ed573]"
                />
              ) : (
                <Popover open={memberPickerOpen} onOpenChange={setMemberPickerOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      role="combobox"
                      aria-expanded={memberPickerOpen}
                      className={cn(
                        "h-10 w-full justify-between rounded-lg border-gray-200 font-normal",
                        !name && "text-gray-500",
                      )}
                    >
                      {name ? (
                        <span className="truncate">
                          {name}
                          {selectedMemberId && (
                            <span className="ml-2 text-[10px] uppercase tracking-wide text-gray-400">selected</span>
                          )}
                        </span>
                      ) : (
                        <span>
                          {teamQuery.isLoading
                            ? "Loading team members…"
                            : normalizedRole === "super_admin"
                              ? "Select a team member (all organisations)"
                              : "Select a team member from your organisation"}
                        </span>
                      )}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                    <Command>
                      <CommandInput placeholder="Search by name, email, or role…" />
                      <CommandList>
                        <CommandEmpty>
                          {teamQuery.isLoading ? "Loading…" : "No team members found."}
                        </CommandEmpty>
                        <CommandGroup>
                          {members.map((m) => {
                            const meta = [m.role, normalizedRole === "super_admin" ? m.org_name : null]
                              .filter(Boolean)
                              .join(" · ");
                            const search = `${m.full_name} ${m.email} ${m.role ?? ""} ${m.org_name ?? ""}`;
                            return (
                              <CommandItem
                                key={m.id}
                                value={`${m.id} ${search}`}
                                onSelect={() => handleSelectMember(m)}
                                className="flex items-start gap-2"
                              >
                                <Check
                                  className={cn(
                                    "mt-0.5 h-4 w-4 shrink-0",
                                    selectedMemberId === m.id ? "opacity-100 text-[#2ed573]" : "opacity-0",
                                  )}
                                />
                                <div className="min-w-0 flex-1">
                                  <div className="truncate text-sm font-medium text-[#0f2318]">{m.full_name || m.email}</div>
                                  <div className="truncate text-[11px] text-gray-500">
                                    {m.email}
                                    {meta ? ` · ${meta}` : ""}
                                  </div>
                                </div>
                              </CommandItem>
                            );
                          })}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              )}
              {errors.name && <p className="text-xs text-red-600">{errors.name}</p>}
              {!manualEntry && !selectedMemberId && (
                <p className="text-[11px] text-gray-500">
                  Pick a member to auto-fill name, email and phone. Use “Enter manually” for non-CRM staff.
                </p>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Email *</Label>
                <Input
                  type="email"
                  value={email}
                  readOnly={!manualEntry && !!selectedMemberId}
                  onChange={(e) => setEmail(e.target.value)}
                  className={cn(
                    "rounded-lg focus-visible:ring-[#2ed573]",
                    !manualEntry && !!selectedMemberId && "bg-gray-50 text-gray-700",
                  )}
                />
                {errors.email && <p className="text-xs text-red-600">{errors.email}</p>}
              </div>
              <div className="space-y-1.5">
                <Label>Phone *</Label>
                <Input
                  type="tel"
                  value={phone}
                  readOnly={!manualEntry && !!selectedMemberId}
                  onChange={(e) => setPhone(e.target.value)}
                  className={cn(
                    "rounded-lg focus-visible:ring-[#2ed573]",
                    !manualEntry && !!selectedMemberId && "bg-gray-50 text-gray-700",
                  )}
                />
                {errors.phone && <p className="text-xs text-red-600">{errors.phone}</p>}
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Joining date *</Label>
                <Input
                  type="date"
                  value={joiningDate}
                  onChange={(e) => setJoiningDate(e.target.value)}
                  className="rounded-lg focus-visible:ring-[#2ed573]"
                />
                {errors.joiningDate && <p className="text-xs text-red-600">{errors.joiningDate}</p>}
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wide text-[#0f2318]">Job details</h4>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Designation *</Label>
                <Input value={designation} onChange={(e) => setDesignation(e.target.value)} className="rounded-lg focus-visible:ring-[#2ed573]" />
                {errors.designation && <p className="text-xs text-red-600">{errors.designation}</p>}
              </div>
              <div className="space-y-1.5">
                <Label>Department *</Label>
                <Select value={department} onValueChange={setDepartment}>
                  <SelectTrigger className="rounded-lg">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DEPARTMENTS.map((d) => (
                      <SelectItem key={d} value={d}>
                        {d}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <div className="flex items-center justify-between">
                  <Label>Employee ID *</Label>
                  {!employee && (
                    <button
                      type="button"
                      className="text-[11px] font-semibold text-[#0f5230] underline-offset-2 hover:underline"
                      onClick={() => {
                        setEmployeeCode(suggestedCode);
                        setEmployeeCodeTouched(false);
                        setErrors((prev) => {
                          const next = { ...prev };
                          delete next.employeeCode;
                          return next;
                        });
                      }}
                    >
                      Reset to {suggestedCode}
                    </button>
                  )}
                </div>
                <Input
                  value={employeeCode}
                  onChange={(e) => {
                    setEmployeeCode(e.target.value.toUpperCase().slice(0, 30));
                    setEmployeeCodeTouched(true);
                  }}
                  className="rounded-lg font-mono text-sm focus-visible:ring-[#2ed573]"
                  placeholder={suggestedCode || "SYNC-EMP-001"}
                  maxLength={30}
                />
                {errors.employeeCode ? (
                  <p className="text-xs text-red-600">{errors.employeeCode}</p>
                ) : (
                  <p className="text-[11px] text-gray-500">
                    Letters, digits, dashes or underscores. Must be unique within your organisation.
                  </p>
                )}
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wide text-[#0f2318]">Compensation</h4>
            <div className="space-y-1.5">
              <Label>Annual CTC (₹) *</Label>
              <Input type="number" min={0} value={ctc || ""} onChange={(e) => setCtc(Number(e.target.value) || 0)} className="rounded-lg focus-visible:ring-[#2ed573]" />
              {errors.ctc && <p className="text-xs text-red-600">{errors.ctc}</p>}
            </div>
            {ctc > 0 && (
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
                <div>
                  Monthly: <span className="font-semibold text-[#0f2318]">₹ {formatINR(Math.round(monthly))}</span>
                </div>
                <div className="mt-1 text-xs">
                  Basic (40%): ₹ {formatINR(previewBasic)} · HRA (20%): ₹ {formatINR(previewHra)}
                </div>
              </div>
            )}
            <div className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2">
              <div>
                <div className="text-sm font-medium">PF applicable</div>
                <div className="text-xs text-gray-500">12% of basic (employee + employer)</div>
              </div>
              <Switch checked={pfApplicable} onCheckedChange={setPfApplicable} className="data-[state=checked]:bg-[#2ed573]" />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2">
              <div>
                <div className="text-sm font-medium">PT applicable</div>
                <div className="text-xs text-gray-500">₹200 / month when applicable</div>
              </div>
              <Switch checked={ptApplicable} onCheckedChange={setPtApplicable} className="data-[state=checked]:bg-[#2ed573]" />
            </div>
          </section>

          <section className="space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wide text-[#0f2318]">Tax & bank</h4>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label>PAN *</Label>
                <Input
                  value={panNumber}
                  onChange={(e) => setPanNumber(e.target.value.toUpperCase().slice(0, 10))}
                  className="rounded-lg font-mono focus-visible:ring-[#2ed573]"
                  maxLength={10}
                />
                {errors.panNumber && <p className="text-xs text-red-600">{errors.panNumber}</p>}
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Bank name *</Label>
                <Input value={bankName} onChange={(e) => setBankName(e.target.value)} className="rounded-lg focus-visible:ring-[#2ed573]" />
                {errors.bankName && <p className="text-xs text-red-600">{errors.bankName}</p>}
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Account number *</Label>
                <Input value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} className="rounded-lg focus-visible:ring-[#2ed573]" />
                {errors.accountNumber && <p className="text-xs text-red-600">{errors.accountNumber}</p>}
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>IFSC *</Label>
                <Input
                  value={ifscCode}
                  onChange={(e) => setIfscCode(e.target.value.toUpperCase().slice(0, 11))}
                  className="rounded-lg font-mono focus-visible:ring-[#2ed573]"
                  maxLength={11}
                />
                {errors.ifscCode && <p className="text-xs text-red-600">{errors.ifscCode}</p>}
              </div>
            </div>
          </section>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" className="rounded-lg border-gray-200" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" className="rounded-lg bg-[#2ed573] font-semibold text-[#0f2318]" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save employee"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
