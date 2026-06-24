import { useState } from "react";
import { Plus } from "lucide-react";

interface TagItem {
  id: string;
  name: string;
  color: string;
  usageCount: number;
}

const initialTags: TagItem[] = [
  { id: "1", name: "Hot Lead", color: "#ef4444", usageCount: 24 },
  { id: "2", name: "Cold Lead", color: "#3b82f6", usageCount: 18 },
  { id: "3", name: "VIP", color: "#f59e0b", usageCount: 12 },
  { id: "4", name: "Follow Up", color: "#8b5cf6", usageCount: 33 },
  { id: "5", name: "Student", color: "#2ed573", usageCount: 21 },
  { id: "6", name: "Corporate", color: "#0f2318", usageCount: 9 },
];

export function TagsAndLabels() {
  const [tags, setTags] = useState<TagItem[]>(initialTags);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#2ed573");

  const addTag = () => {
    if (!newName.trim()) return;
    setTags((prev) => [...prev, { id: crypto.randomUUID(), name: newName, color: newColor, usageCount: 0 }]);
    setNewName("");
  };

  const deleteTag = (id: string) => setTags((prev) => prev.filter((tag) => tag.id !== id));
  const renameTag = (id: string) => {
    const name = window.prompt("Rename tag");
    if (name) setTags((prev) => prev.map((tag) => (tag.id === id ? { ...tag, name } : tag)));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-white p-4">
        <div>
          <h3 className="text-base font-semibold text-gray-900">Tags & Labels</h3>
          <p className="text-sm text-gray-500">Organize contacts and deals with tags</p>
        </div>
        <button type="button" onClick={addTag} className="inline-flex items-center gap-2 rounded-lg bg-[#2ed573] px-4 py-2 text-sm font-semibold text-[#0f2318]">
          <Plus className="h-4 w-4" />
          New Tag
        </button>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="mb-4 flex flex-wrap gap-2">
          {tags.map((tag) => (
            <span
              key={tag.id}
              style={{ background: `${tag.color}20`, color: tag.color }}
              className="cursor-pointer rounded-full px-3 py-1 text-sm font-medium"
              onClick={() => deleteTag(tag.id)}
            >
              {tag.name} ×
            </span>
          ))}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                <th className="py-2">Color</th>
                <th className="py-2">Name</th>
                <th className="py-2">Usage Count</th>
                <th className="py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {tags.map((tag) => (
                <tr key={tag.id} className="border-b border-gray-100">
                  <td className="py-2">
                    <span className="inline-block h-4 w-4 rounded-full" style={{ backgroundColor: tag.color }} />
                  </td>
                  <td className="py-2">{tag.name}</td>
                  <td className="py-2">{tag.usageCount}</td>
                  <td className="py-2">
                    <div className="flex gap-2 text-xs">
                      <button type="button" onClick={() => renameTag(tag.id)} className="text-blue-600">Rename</button>
                      <button type="button" className="text-amber-600">Change Color</button>
                      <button type="button" onClick={() => deleteTag(tag.id)} className="text-red-600">Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex items-center gap-2">
          <input type="color" value={newColor} onChange={(e) => setNewColor(e.target.value)} className="h-9 w-11 rounded border border-gray-200" />
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Tag name"
            className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm"
          />
          <button type="button" onClick={addTag} className="rounded-lg bg-[#2ed573] px-4 py-2 text-sm font-semibold text-[#0f2318]">
            Add Tag
          </button>
        </div>
      </div>
    </div>
  );
}
