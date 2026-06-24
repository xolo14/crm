import { useMemo, useRef, useState } from "react";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import { SaveButton } from "@/components/settings/ui/SaveButton";

interface Stage {
  id: string;
  name: string;
  color: string;
  probability: number;
  isDefault?: boolean;
}

const seedStages: Stage[] = [
  { id: "1", name: "Prospect", color: "#6366f1", probability: 10 },
  { id: "2", name: "Qualified", color: "#3b82f6", probability: 30 },
  { id: "3", name: "Proposal", color: "#2ed573", probability: 50 },
  { id: "4", name: "Negotiation", color: "#f59e0b", probability: 70 },
  { id: "5", name: "Closed Won", color: "#10b981", probability: 100, isDefault: true },
  { id: "6", name: "Closed Lost", color: "#ef4444", probability: 0 },
];

const presetColors = ["#8b5cf6", "#3b82f6", "#2ed573", "#f59e0b", "#f97316", "#ef4444", "#6b7280"];

export function PipelineStages() {
  const [stages, setStages] = useState<Stage[]>(seedStages);
  const [saving, setSaving] = useState(false);
  const dragId = useRef<string | null>(null);

  const activeStages = useMemo(() => stages.slice(0, 4), [stages]);
  const outcomeStages = useMemo(() => stages.slice(4), [stages]);

  const onSave = () => {
    setSaving(true);
    window.setTimeout(() => setSaving(false), 900);
  };

  const setDefault = (id: string) => {
    setStages((prev) => prev.map((stage) => ({ ...stage, isDefault: stage.id === id })));
  };

  const onDragStart = (id: string) => {
    dragId.current = id;
  };

  const onDrop = (targetId: string) => {
    if (!dragId.current || dragId.current === targetId) return;
    setStages((prev) => {
      const from = prev.findIndex((s) => s.id === dragId.current);
      const to = prev.findIndex((s) => s.id === targetId);
      if (from === -1 || to === -1) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
    dragId.current = null;
  };

  const addStage = () => {
    setStages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), name: "New Stage", color: "#3b82f6", probability: 25, isDefault: false },
    ]);
  };

  const deleteStage = (id: string) => {
    if (window.confirm("Delete this stage? Deals in this stage will move to the default stage.")) {
      setStages((prev) => prev.filter((stage) => stage.id !== id));
    }
  };

  const renderStage = (stage: Stage) => (
    <div
      key={stage.id}
      draggable
      onDragStart={() => onDragStart(stage.id)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={() => onDrop(stage.id)}
      className="rounded-xl border border-gray-200 bg-white p-4"
    >
      <div className="flex items-center gap-3">
        <GripVertical className="h-4 w-4 cursor-grab text-gray-400" />
        <button type="button" className="h-4 w-4 rounded-full border border-gray-200" style={{ backgroundColor: stage.color }} />
        <input
          value={stage.name}
          onChange={(e) => setStages((prev) => prev.map((s) => (s.id === stage.id ? { ...s, name: e.target.value } : s)))}
          className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm"
        />
        <input
          type="color"
          value={stage.color}
          onChange={(e) => setStages((prev) => prev.map((s) => (s.id === stage.id ? { ...s, color: e.target.value } : s)))}
          className="h-8 w-10 cursor-pointer rounded border border-gray-200"
        />
      </div>
      <div className="mt-3 flex items-center gap-3">
        <span className="text-xs text-gray-500">Probability:</span>
        <input
          type="range"
          min={0}
          max={100}
          value={stage.probability}
          onChange={(e) =>
            setStages((prev) => prev.map((s) => (s.id === stage.id ? { ...s, probability: Number(e.target.value) } : s)))
          }
          className="flex-1 accent-[#2ed573]"
        />
        <span className="w-10 text-xs font-medium text-gray-600">{stage.probability}%</span>
        <button
          type="button"
          onClick={() => setDefault(stage.id)}
          className={`rounded-full border px-3 py-1 text-xs ${
            stage.isDefault ? "border-[#2ed573] bg-[#e6faf0] text-[#0f5230]" : "border-gray-200 text-gray-500"
          }`}
        >
          Default
        </button>
        <button type="button" onClick={() => deleteStage(stage.id)} className="rounded-lg p-2 text-red-500 hover:bg-red-50">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-2 flex gap-2">
        {presetColors.map((color) => (
          <button
            key={color}
            type="button"
            onClick={() => setStages((prev) => prev.map((s) => (s.id === stage.id ? { ...s, color } : s)))}
            className="h-4 w-4 rounded-full border border-white shadow"
            style={{ backgroundColor: color }}
          />
        ))}
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-white p-4">
        <div>
          <h3 className="text-base font-semibold text-gray-900">Pipeline Stages</h3>
          <p className="text-sm text-gray-500">Configure your deal pipeline stages</p>
        </div>
        <button
          type="button"
          onClick={addStage}
          className="inline-flex items-center gap-2 rounded-lg bg-[#2ed573] px-4 py-2 text-sm font-semibold text-[#0f2318]"
        >
          <Plus className="h-4 w-4" />
          Add Stage
        </button>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Active Stages</p>
        {activeStages.map(renderStage)}
      </div>
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Outcome Stages</p>
        {outcomeStages.map(renderStage)}
      </div>
      <div className="flex justify-end">
        <SaveButton onClick={onSave} loading={saving} label="Save Pipeline" />
      </div>
    </div>
  );
}
