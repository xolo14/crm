import { useState } from "react";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import { SettingsInput } from "@/components/settings/ui/SettingsInput";
import { SettingsSelect } from "@/components/settings/ui/SettingsSelect";

interface CustomField {
  id: string;
  name: string;
  type: string;
  required: boolean;
  placeholder: string;
  options: string[];
}

const seedContactFields: CustomField[] = [
  { id: "1", name: "Lead Source", type: "dropdown", required: false, placeholder: "", options: ["Website", "Referral", "Social", "Event"] },
  { id: "2", name: "College Name", type: "text", required: false, placeholder: "", options: [] },
  { id: "3", name: "Course Interest", type: "text", required: false, placeholder: "", options: [] },
  { id: "4", name: "Follow Up Date", type: "date", required: false, placeholder: "", options: [] },
];

const entities = ["contacts", "deals", "organizations", "students"];
const fieldTypes = ["text", "number", "date", "dropdown", "checkbox", "email", "phone", "url", "textarea"];

export function CustomFields() {
  const [activeEntity, setActiveEntity] = useState("contacts");
  const [fieldsByEntity, setFieldsByEntity] = useState<Record<string, CustomField[]>>({
    contacts: seedContactFields,
    deals: [],
    organizations: [],
    students: [],
  });

  const fields = fieldsByEntity[activeEntity] || [];

  const updateField = (id: string, partial: Partial<CustomField>) => {
    setFieldsByEntity((prev) => ({
      ...prev,
      [activeEntity]: prev[activeEntity].map((field) => (field.id === id ? { ...field, ...partial } : field)),
    }));
  };

  const addField = () => {
    setFieldsByEntity((prev) => ({
      ...prev,
      [activeEntity]: [
        ...prev[activeEntity],
        { id: crypto.randomUUID(), name: "New Field", type: "text", required: false, placeholder: "", options: [] },
      ],
    }));
  };

  const removeField = (id: string) => {
    setFieldsByEntity((prev) => ({
      ...prev,
      [activeEntity]: prev[activeEntity].filter((field) => field.id !== id),
    }));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 rounded-xl border border-gray-200 bg-white p-3">
        {entities.map((entity) => (
          <button
            type="button"
            key={entity}
            onClick={() => setActiveEntity(entity)}
            className={`rounded-lg px-4 py-2 text-sm capitalize ${activeEntity === entity ? "bg-[#e6faf0] text-[#0f5230]" : "text-gray-600 hover:bg-gray-100"}`}
          >
            {entity}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {fields.map((field) => (
          <div key={field.id} className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex items-center gap-3">
              <GripVertical className="h-4 w-4 text-gray-400" />
              <SettingsInput value={field.name} onChange={(v) => updateField(field.id, { name: v })} />
              <div className="w-44">
                <SettingsSelect
                  value={field.type}
                  onChange={(v) => updateField(field.id, { type: v })}
                  options={fieldTypes.map((type) => ({ value: type, label: type[0].toUpperCase() + type.slice(1) }))}
                />
              </div>
              <label className="inline-flex items-center gap-2 text-sm">
                <input type="checkbox" checked={field.required} onChange={(e) => updateField(field.id, { required: e.target.checked })} />
                Required
              </label>
            </div>
            <div className="mt-3 flex items-center gap-3">
              <span className="text-xs text-gray-500">Placeholder:</span>
              <SettingsInput value={field.placeholder} onChange={(v) => updateField(field.id, { placeholder: v })} />
              <button type="button" onClick={() => removeField(field.id)} className="rounded-lg p-2 text-red-500 hover:bg-red-50">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>

            {field.type === "dropdown" && (
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => updateField(field.id, { options: [...field.options, `Option ${field.options.length + 1}`] })}
                  className="mb-2 rounded-lg border border-gray-200 px-3 py-1 text-xs"
                >
                  + Add Option
                </button>
                <div className="flex flex-wrap gap-2">
                  {field.options.map((option) => (
                    <span key={option} className="rounded-full bg-gray-100 px-3 py-1 text-xs">
                      {option}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <button type="button" onClick={addField} className="inline-flex items-center gap-2 rounded-lg bg-[#2ed573] px-4 py-2 text-sm font-semibold text-[#0f2318]">
        <Plus className="h-4 w-4" />
        Add Custom Field
      </button>
    </div>
  );
}
